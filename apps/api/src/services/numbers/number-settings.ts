/**
 * An agency's number limit and number pricing, as the two screens that set
 * them read and write them.
 *
 *   * Platform admins, on Admin -> Agencies: the limit and the price, for any
 *     agency (`routes/platform.ts`).
 *   * A white-label parent, on /network/agencies: the limit, for its own
 *     children only (`routes/network.ts`).
 *
 * The limit is `TenantQuota.maxPhoneNumbers`. The price is
 * `Tenant.metadata.numberPricing = { setup, monthly }`; see `number-charges.ts`.
 */

import { Prisma, type PrismaClient } from '@prisma/client';

import { pricingFromMetadata, type NumberPricing } from './number-charges.js';
import { numberUsage } from './number-purchase.js';

/** The largest limit either screen accepts. A sanity bound, not a policy. */
export const MAX_NUMBER_LIMIT = 10_000;

export interface NumberSettings {
  numbersLimit: number | null;
  numbersUsed: number;
  pricing: NumberPricing;
}

export async function readNumberSettings(
  prisma: PrismaClient,
  tenantId: string
): Promise<NumberSettings | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { metadata: true },
  });
  if (!tenant) return null;
  const usage = await numberUsage(tenantId);
  return {
    numbersLimit: usage.limit,
    numbersUsed: usage.used,
    pricing: pricingFromMetadata(tenant.metadata),
  };
}

/** A limit from a request body: a whole number in range, or an error. */
export function parseNumberLimit(value: unknown): { ok: true; value: number } | { ok: false } {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_NUMBER_LIMIT
  ) {
    return { ok: false };
  }
  return { ok: true, value };
}

/** A price from a request body: a non-negative amount in dollars, to the cent. */
export function parsePrice(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000) {
    return null;
  }
  return Math.round(value * 100) / 100;
}

export async function writeNumberLimit(
  prisma: PrismaClient | Prisma.TransactionClient,
  tenantId: string,
  maxPhoneNumbers: number
): Promise<void> {
  await prisma.tenantQuota.upsert({
    where: { tenantId },
    create: { tenantId, maxPhoneNumbers },
    update: { maxPhoneNumbers, enabled: true },
  });
}

export async function writeNumberPricing(
  prisma: PrismaClient,
  tenantId: string,
  metadata: unknown,
  pricing: NumberPricing
): Promise<void> {
  const current =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      metadata: { ...current, numberPricing: { ...pricing } } as Prisma.InputJsonValue,
    },
  });
}
