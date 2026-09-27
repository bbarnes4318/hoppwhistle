/**
 * An agency buying and releasing its own phone numbers.
 *
 * ── Buying ───────────────────────────────────────────────────────────────────
 *
 * One transaction, holding a per-tenant Postgres advisory lock
 * (`pg_advisory_xact_lock` on a hash of the tenant id) from the quota check to
 * the commit:
 *
 *   1. The tenant gets a quota row if it has none (25 numbers).
 *   2. `checkPhoneNumberQuota` counts, under the lock, every number the tenant
 *      holds -- ACTIVE, and INACTIVE numbers not yet released at the carrier.
 *   3. The carrier sells the number.
 *   4. The PhoneNumber row and its charges (`number-charges.ts`) are written.
 *
 * The lock is what makes the quota real: two purchases racing for the last
 * slot run one after the other, and the second sees the first's number. It is
 * transaction-scoped, so it is released however the transaction ends.
 *
 * If the carrier sold the number and anything after that fails -- the insert,
 * the charge, the commit -- the number is released back to the carrier before
 * the error is returned. An agency is never left paying a carrier for a number
 * the platform has no record of.
 *
 * The number belongs to the agency, not to whoever clicked Buy: `userId` is
 * left null. It is attached to a campaign (optional, validated to the tenant)
 * through `didRouteService.syncDidRouteForNumber`, or left unattached.
 *
 * ── Releasing ────────────────────────────────────────────────────────────────
 *
 * The carrier first; if it refuses, nothing changes here and the caller is
 * told. Then, together: the number's DID routes are deleted, it becomes
 * RELEASED, and its monthly charge ends.
 */

import { Prisma } from '@prisma/client';

import { logger } from '../../lib/logger.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { auditLog } from '../audit.js';
import { provisioningService } from '../provisioning/provisioning-service.js';
import type { Provider, ProvisionedNumber, PurchaseNumberRequest } from '../provisioning/types.js';
import { phoneNumbersHeldWhere, quotaService } from '../quota-service.js';

import { endMonthlyCharge, recordPurchaseCharges } from './number-charges.js';

/** The quota a tenant is given on its first purchase if it has none. */
export const DEFAULT_MAX_PHONE_NUMBERS = 25;

/** The quota a child agency is given when it is created. */
export const CHILD_DEFAULT_MAX_PHONE_NUMBERS = 10;

/** Long enough for a carrier's purchase API, plus waiting on the tenant lock. */
const PURCHASE_TRANSACTION_TIMEOUT_MS = 90_000;

export class NumberPurchaseError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly detail?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'NumberPurchaseError';
  }
}

export interface PurchaseActor {
  userId?: string;
  ipAddress?: string;
  requestId?: string;
}

/** Make sure a tenant has a quota row, creating the default one if not. */
export async function ensureTenantQuota(
  db: Pick<Prisma.TransactionClient, 'tenantQuota'>,
  tenantId: string,
  maxPhoneNumbers: number = DEFAULT_MAX_PHONE_NUMBERS
): Promise<void> {
  await db.tenantQuota.upsert({
    where: { tenantId },
    create: { tenantId, maxPhoneNumbers },
    update: {},
  });
}

/** How many numbers a tenant holds, and its limit (null for none). */
export async function numberUsage(
  tenantId: string
): Promise<{ used: number; limit: number | null }> {
  const prisma = getPrismaClient();
  const [used, quota] = await Promise.all([
    prisma.phoneNumber.count({ where: phoneNumbersHeldWhere(tenantId) }),
    prisma.tenantQuota.findUnique({
      where: { tenantId },
      select: { maxPhoneNumbers: true, enabled: true },
    }),
  ]);
  // No row yet means the first purchase will create the default one.
  const limit = quota
    ? quota.enabled
      ? (quota.maxPhoneNumbers ?? null)
      : null
    : DEFAULT_MAX_PHONE_NUMBERS;
  return { used, limit };
}

/** A lock key for one tenant's number purchases, as a 32-bit hash. */
function lockKey(tenantId: string): string {
  return `phone-number-purchase:${tenantId}`;
}

/**
 * Buy one number for one agency. See the header for the order of events.
 *
 * Throws `NumberPurchaseError` for anything the caller should answer with a
 * specific status; anything else is a carrier or database failure.
 */
export async function purchaseNumberForTenant(params: {
  provider: Extract<Provider, 'fractel' | 'bulkvs'>;
  request: PurchaseNumberRequest;
  tenantId: string;
  campaignId?: string | null;
  actor?: PurchaseActor;
}): Promise<{
  id: string;
  number: string;
  provider: string;
  status: string;
  purchasedAt: Date | null;
}> {
  const { provider, request, tenantId } = params;
  const prisma = getPrismaClient();

  const campaignId = params.campaignId || null;
  if (campaignId) {
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, tenantId },
      select: { id: true },
    });
    if (!campaign) {
      throw new NumberPurchaseError(400, 'VALIDATION_ERROR', 'Campaign not found');
    }
  }

  let provisioned: ProvisionedNumber | null = null;

  try {
    const row = await prisma.$transaction(
      async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey(tenantId)}))`;

        await ensureTenantQuota(tx, tenantId);
        const quota = await quotaService.checkPhoneNumberQuota(tenantId, undefined, tx);
        if (!quota.allowed) {
          throw new NumberPurchaseError(
            403,
            'QUOTA_EXCEEDED',
            quota.limit !== undefined
              ? `You have used all ${quota.limit} of your numbers. Release one, or ask for a higher limit.`
              : quota.reason || 'Phone number quota exceeded',
            { current: quota.current, limit: quota.limit }
          );
        }

        provisioned = await provisioningService.purchaseAtCarrier(provider, request);
        const bought = provisioned;

        const data = {
          tenantId,
          userId: null,
          campaignId,
          number: bought.number,
          provider,
          status: 'ACTIVE' as const,
          releasedAt: null,
          capabilities: (bought.features ?? {}) as Prisma.InputJsonValue,
          purchasedAt: bought.purchasedAt || new Date(),
          metadata: {
            providerId: bought.providerId,
            ...(bought.metadata ?? {}),
          } as Prisma.InputJsonValue,
        };

        /*
         * A number this agency released before and has now bought back: the old
         * row is RELEASED, and (tenantId, number) is unique, so it is brought
         * back rather than duplicated. Its call history stays attached.
         */
        const previous = await tx.phoneNumber.findUnique({
          where: { tenantId_number: { tenantId, number: bought.number } },
          select: { id: true, status: true },
        });
        if (previous && previous.status !== 'RELEASED') {
          throw new NumberPurchaseError(
            409,
            'NUMBER_EXISTS',
            'This number is already on your account.'
          );
        }

        const saved = previous
          ? await tx.phoneNumber.update({ where: { id: previous.id }, data })
          : await tx.phoneNumber.create({ data });

        await recordPurchaseCharges(tx, { tenantId, phoneNumberId: saved.id });
        return saved;
      },
      { timeout: PURCHASE_TRANSACTION_TIMEOUT_MS, maxWait: PURCHASE_TRANSACTION_TIMEOUT_MS }
    );

    await auditLog({
      tenantId,
      userId: params.actor?.userId,
      action: 'number.purchased',
      entityType: 'PhoneNumber',
      entityId: row.id,
      changes: { number: row.number, provider, campaignId },
      ipAddress: params.actor?.ipAddress,
      requestId: params.actor?.requestId,
      success: true,
    });

    const { didRouteService } = await import('../did-route-service.js');
    await didRouteService.syncDidRouteForNumber(row.id, tenantId);

    return {
      id: row.id,
      number: row.number,
      provider,
      status: row.status,
      purchasedAt: row.purchasedAt,
    };
  } catch (error) {
    const sold = provisioned as ProvisionedNumber | null;
    if (sold) {
      // The carrier sold it and we could not record it. Give it back.
      try {
        await provisioningService.releaseAtCarrier(provider, sold.providerId ?? sold.number);
        logger.warn({
          msg: 'Number purchase rolled back at the carrier after the database write failed',
          tenantId,
          number: sold.number,
          provider,
        });
      } catch (releaseError) {
        logger.error({
          msg: 'Number purchased at the carrier, not recorded, AND not released. Release it by hand.',
          tenantId,
          number: sold.number,
          provider,
          providerId: sold.providerId,
          err: releaseError,
        });
      }
    }
    throw error;
  }
}

/**
 * Release one of an agency's numbers. Tenant-scoped: another agency's number
 * is "not found".
 */
export async function releaseNumberForTenant(params: {
  tenantId: string;
  numberId: string;
  actor?: PurchaseActor;
}): Promise<{ id: string; number: string; status: string }> {
  const prisma = getPrismaClient();
  const { tenantId, numberId } = params;

  const number = await prisma.phoneNumber.findFirst({
    where: { id: numberId, tenantId },
  });
  if (!number || number.status === 'RELEASED') {
    throw new NumberPurchaseError(404, 'NOT_FOUND', 'Phone number not found');
  }

  const provider = (number.provider as Provider | null) || 'local';
  const providerId =
    ((number.metadata as { providerId?: unknown } | null)?.providerId as string | undefined) ||
    number.number;

  /*
   * A number with no carrier behind it -- imported, or created by the local
   * adapter -- has nothing to give back; releasing it is only the bookkeeping
   * below. Every other number goes back to its carrier first.
   */
  if (provider !== 'local') {
    try {
      await provisioningService.releaseAtCarrier(provider, providerId);
    } catch (error) {
      logger.error({
        msg: 'Carrier refused to release a number',
        tenantId,
        numberId,
        provider,
        err: error,
      });
      throw new NumberPurchaseError(
        502,
        'RELEASE_FAILED',
        'The carrier did not release this number. Nothing has changed; try again.'
      );
    }
  }

  const now = new Date();
  const released = await prisma.$transaction(async tx => {
    await tx.didRoute.deleteMany({ where: { phoneNumberId: number.id } });
    const updated = await tx.phoneNumber.update({
      where: { id: number.id },
      data: { status: 'RELEASED', releasedAt: now, campaignId: null, userId: null },
    });
    await endMonthlyCharge(tx, number.id, now);
    return updated;
  });

  await auditLog({
    tenantId,
    userId: params.actor?.userId,
    action: 'number.released',
    entityType: 'PhoneNumber',
    entityId: number.id,
    changes: { number: number.number, provider, before: number.status, after: 'RELEASED' },
    ipAddress: params.actor?.ipAddress,
    requestId: params.actor?.requestId,
    success: true,
  });

  return { id: released.id, number: released.number, status: released.status };
}
