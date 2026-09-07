/**
 * Anveo inventory sync.
 *
 * The Numbers page reads one place: the `phone_numbers` table. A DID only ever
 * arrived there by being bought through `POST /api/v1/anveo/purchase`, so every
 * DID bought directly in the Anveo portal -- which is how the account's current
 * seven numbers were bought -- was invisible to the product even while it was
 * carrying live calls through the FreeSWITCH dialplan.
 *
 * `AnveoDIDService.listDids()` (the DID.LIST action) already existed and was
 * called from nowhere. This is the missing half: it reads Anveo's own inventory
 * and reconciles it into `phone_numbers` for a tenant.
 *
 * What the sync claims authority over is deliberately narrow. Anveo knows which
 * DIDs exist on the account, what they cost and where they forward; it knows
 * nothing about which campaign or agent a number serves, or whether an operator
 * deliberately parked it. So a row that already exists keeps its local
 * decisions -- status, campaign, user, pool membership -- and the sync only
 * fills in provenance: provider, carrier link, and the Anveo metadata.
 */

import type { Prisma } from '@prisma/client';

import { logger } from '../../lib/logger.js';
import { getPrismaClient } from '../../lib/prisma.js';

import { getAnveoDIDService, type AnveoDid } from './anveo-did-service.js';

/** The `phone_numbers.provider` value this sync writes and matches on. */
export const ANVEO_PROVIDER = 'anveo';

/** Marks rows this sync created, so an import can be told from a purchase. */
export const ANVEO_IMPORT_SOURCE = 'anveo-sync';

export interface AnveoSyncNumber {
  number: string;
  e164: string;
  areaCode: string;
  areaName: string;
  status: string;
  action: 'created' | 'updated' | 'unchanged';
}

export interface AnveoSyncResult {
  /** DIDs Anveo reported on the account. */
  found: number;
  created: number;
  updated: number;
  unchanged: number;
  /** The carrier the numbers were linked to, when one is configured. */
  carrier: { id: string; name: string } | null;
  numbers: AnveoSyncNumber[];
}

/**
 * Anveo returns E.164 without the leading `+` ("12548319807"). The rest of the
 * system stores `+1...`, and `phone_numbers` is unique on (tenantId, number),
 * so a mismatch here would create a duplicate rather than match an existing row.
 */
export function normalizeE164(e164: string): string {
  const digits = e164.replace(/[^\d]/g, '');
  return `+${digits}`;
}

/**
 * The carrier a synced Anveo number belongs to, if the tenant has one.
 *
 * Matched on `Carrier.numberProvider` -- the field the caller-ID waterfall
 * already uses to answer "which of our DIDs can this carrier attest to" -- and
 * falling back to the carrier code. We do not create a carrier when none
 * matches: a Carrier row is a routing participant, and inventing one as a side
 * effect of an inventory import would put an untested leg in the waterfall.
 * Without it the numbers still import and group under their provider.
 */
async function findAnveoCarrier(tenantId: string): Promise<{ id: string; name: string } | null> {
  const prisma = getPrismaClient();

  const carrier = await prisma.carrier.findFirst({
    where: {
      tenantId,
      OR: [
        { numberProvider: { equals: ANVEO_PROVIDER, mode: 'insensitive' } },
        { code: { equals: ANVEO_PROVIDER, mode: 'insensitive' } },
      ],
    },
    select: { id: true, name: true },
  });

  return carrier;
}

function metadataForDid(did: AnveoDid): Prisma.InputJsonObject {
  return {
    anveoDid: did.e164,
    didType: did.didType,
    areaCode: did.areaCode,
    areaName: did.areaName,
    countryName: did.countryName,
    monthly100: did.monthly100,
    ratePlanId: did.ratePlanId,
    title: did.title,
    callForwardType: did.callForwardType,
    callForwardTo: did.callForwardTo,
    anveoStatus: did.status,
    syncedAt: new Date().toISOString(),
  };
}

/**
 * Anveo's ORDER_DATE, when it sends one, is the closest thing to a purchase
 * date we have for a DID bought outside the product. An unparseable value is
 * dropped rather than guessed at.
 */
function purchasedAtFrom(did: AnveoDid): Date | undefined {
  if (!did.orderDate) return undefined;
  const parsed = new Date(did.orderDate);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * Reconcile the Anveo account's DIDs into `phone_numbers` for one tenant.
 *
 * The Anveo account is a platform-level credential, so every DID on it lands in
 * whichever tenant the caller is acting as -- the same rule the purchase flow
 * already follows. On a multi-tenant deployment that means syncing as the
 * tenant that owns the trunk, not "any admin".
 */
export async function syncAnveoNumbers(
  tenantId: string,
  options: { didType?: string } = {}
): Promise<AnveoSyncResult> {
  const prisma = getPrismaClient();
  const service = getAnveoDIDService();

  const dids = await service.listDids(options.didType ? { didType: options.didType } : undefined);

  logger.info({
    msg: 'Anveo DID.LIST returned inventory',
    tenantId,
    count: dids.length,
  });

  const carrier = await findAnveoCarrier(tenantId);
  const result: AnveoSyncResult = {
    found: dids.length,
    created: 0,
    updated: 0,
    unchanged: 0,
    carrier,
    numbers: [],
  };

  for (const did of dids) {
    if (!did.e164) continue;

    const number = normalizeE164(did.e164);
    const existing = await prisma.phoneNumber.findUnique({
      where: { tenantId_number: { tenantId, number } },
      select: { id: true, provider: true, carrierId: true },
    });

    if (!existing) {
      await prisma.phoneNumber.create({
        data: {
          tenantId,
          number,
          provider: ANVEO_PROVIDER,
          carrierId: carrier?.id ?? null,
          status: 'ACTIVE',
          capabilities: { voice: true, sms: Boolean(did.smsUrl) },
          purchasedAt: purchasedAtFrom(did),
          importSource: ANVEO_IMPORT_SOURCE,
          metadata: metadataForDid(did),
        },
      });

      result.created += 1;
      result.numbers.push({
        number,
        e164: did.e164,
        areaCode: did.areaCode,
        areaName: did.areaName,
        status: did.status,
        action: 'created',
      });
      continue;
    }

    // The row is already here. Only provenance is Anveo's to correct -- a
    // number imported from a CSV as provider `local`, say, is really an Anveo
    // DID and the caller-ID waterfall needs to know that. Status, campaign,
    // agent and pool membership are local decisions and stay untouched.
    const needsProvider = existing.provider !== ANVEO_PROVIDER;
    const needsCarrier = Boolean(carrier) && existing.carrierId !== carrier?.id;

    await prisma.phoneNumber.update({
      where: { id: existing.id },
      data: {
        provider: ANVEO_PROVIDER,
        ...(needsCarrier ? { carrierId: carrier?.id } : {}),
        metadata: metadataForDid(did),
      },
    });

    const changed = needsProvider || needsCarrier;
    if (changed) {
      result.updated += 1;
    } else {
      result.unchanged += 1;
    }

    result.numbers.push({
      number,
      e164: did.e164,
      areaCode: did.areaCode,
      areaName: did.areaName,
      status: did.status,
      action: changed ? 'updated' : 'unchanged',
    });
  }

  logger.info({
    msg: 'Anveo inventory sync complete',
    tenantId,
    found: result.found,
    created: result.created,
    updated: result.updated,
    unchanged: result.unchanged,
    carrierId: carrier?.id ?? null,
  });

  return result;
}
