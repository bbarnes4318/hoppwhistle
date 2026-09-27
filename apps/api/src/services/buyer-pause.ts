/**
 * Why a buyer is paused.
 *
 * ── Two different pauses behind one status ───────────────────────────────────
 *
 * `Buyer.status = PAUSED` is written by two parties for two unrelated reasons:
 *
 *   WALLET_EMPTY  the platform, when a prepaid (UPFRONT) buyer's wallet cannot
 *                 cover a call (`buyer-billing-service.ts`). Topping the wallet
 *                 up is the whole remedy, so a credit resumes the buyer.
 *   MANUAL        the agency's OWNER or ADMIN, by hand, from the buyer's
 *                 record (`PATCH /api/v1/buyers/:buyerId`). A decision about
 *                 the relationship, not the balance: a top-up must NOT undo it.
 *
 * The status alone cannot tell them apart, and for as long as it was the only
 * record every credit resumed every paused buyer -- an owner who paused a
 * buyer for bad calls saw it routed to again the moment its wallet was
 * credited. So the reason is written beside the status, on
 * `Buyer.metadata.pauseReason`, by whoever pauses, and cleared by whoever
 * resumes. It is JSON metadata rather than a column so the change needs no
 * migration.
 *
 * ── Buyers paused before the reason was recorded ─────────────────────────────
 *
 * A buyer paused before this existed has no `pauseReason`. It is NOT assumed
 * to be a wallet pause: resuming a buyer an owner stopped on purpose is the
 * harmful mistake, and staying paused until somebody resumes it is the safe
 * one. But the audit trail already answers the question for most of them --
 * the billing service has always written `buyer.status.autopaused`, and the
 * PATCH route writes `buyer.update` with the status change -- so the latest of
 * those two decides. No audit row either way reads as MANUAL.
 */

import { BRAND_THEME_NAMES } from '@hopwhistle/shared';
import type { Prisma } from '@prisma/client';

import { getPrismaClient } from '../lib/prisma.js';
import { brandForTenant } from '../lib/tenant-brand.js';

export type BuyerPauseReason = 'WALLET_EMPTY' | 'MANUAL';

/** The buyer's metadata as an object, or an empty one when it is anything else. */
export function buyerMetadataOf(
  metadata: Prisma.JsonValue | null | undefined
): Record<string, unknown> {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
}

/** The reason as recorded, or null when none is (or the value is not one we know). */
export function recordedPauseReason(
  metadata: Prisma.JsonValue | null | undefined
): BuyerPauseReason | null {
  const value = buyerMetadataOf(metadata).pauseReason;
  return value === 'WALLET_EMPTY' || value === 'MANUAL' ? value : null;
}

/**
 * The metadata with `pauseReason` set, or removed when `reason` is null. Every
 * other key is kept: metadata is shared with whatever else writes to it.
 */
export function withPauseReason(
  metadata: Prisma.JsonValue | null | undefined,
  reason: BuyerPauseReason | null
): Prisma.InputJsonValue {
  const next = { ...buyerMetadataOf(metadata) };
  if (reason) next.pauseReason = reason;
  else delete next.pauseReason;
  return next as Prisma.InputJsonValue;
}

/**
 * Why this buyer is paused, or null when it is not.
 *
 * `client` is a transaction when the caller is inside one (a credit is), so the
 * legacy lookup reads the same snapshot the caller is about to write over.
 */
export async function resolvePauseReason(
  client: Prisma.TransactionClient,
  buyer: { id: string; status: string; metadata: Prisma.JsonValue | null }
): Promise<BuyerPauseReason | null> {
  if (buyer.status !== 'PAUSED') return null;

  const recorded = recordedPauseReason(buyer.metadata);
  if (recorded) return recorded;

  const latest = await client.auditLog.findFirst({
    where: {
      entityType: 'Buyer',
      entityId: buyer.id,
      OR: [
        { action: 'buyer.status.autopaused' },
        { action: 'buyer.update', changes: { path: ['status', 'after'], equals: 'PAUSED' } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    select: { action: true },
  });
  return latest?.action === 'buyer.status.autopaused' ? 'WALLET_EMPTY' : 'MANUAL';
}

/**
 * Who a buyer reads as having paused it: "Paused by <name>".
 *
 * The agency, as its buyers know it -- its brand name, else its theme's name,
 * else the agency's own name. The same order `email-brand.ts` names an agency
 * in the mail its buyers receive, so the banner and the inbox agree. A child
 * agency is named by its parent's brand when it has none (`brandForTenant`).
 */
export async function pausedByName(tenantId: string): Promise<string> {
  const [brand, tenant] = await Promise.all([
    brandForTenant(tenantId),
    getPrismaClient().tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
  ]);
  return (
    brand?.name?.trim() ||
    (brand ? BRAND_THEME_NAMES[brand.theme] : null) ||
    tenant?.name ||
    'your account manager'
  );
}
