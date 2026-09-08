/**
 * An agency's rate offset: the dollars added to whatever the curve returns.
 *
 * ── What it is ───────────────────────────────────────────────────────────────
 *
 *     effective rate = curve rate for the closing percentage + rate offset
 *
 * A plain number agreed with the agency and recorded on its terms when they are
 * written. Zero by default, so an agency nobody agreed one with is priced
 * exactly off the curve. It applies at every point on the curve, not at a band
 * or above a threshold.
 *
 * ── What it is not ───────────────────────────────────────────────────────────
 *
 * It is NOT a surcharge, and that distinction is the reason it is built this
 * way rather than as a fee line. An itemised fee added to a price at the point
 * of payment is a regulated instrument: it requires card-network registration,
 * it is capped at 3%, it is prohibited on debit cards, and it is unlawful in
 * several states. A different price is none of those things. So there is no fee
 * column, no percentage applied to a settlement total, and nothing itemised
 * separately anywhere in this codebase -- the offset is part of the rate
 * everywhere a rate appears.
 *
 * It is also NOT derived from the payment method in code. `paymentMethod` says
 * which instrument the settlement debits; this says what the agency is priced
 * at. A platform admin sets the offset when agreeing terms, and why one exists
 * for a card-paying agency is a commercial matter rather than a rule the
 * software enforces.
 *
 * ── Why it lives here ────────────────────────────────────────────────────────
 *
 * It is STORED on `agency_billing_profiles`, because it is a commercial term.
 * It is READ here, in the rating layer, because it is part of the price and the
 * rating engine is what prices an agency. One function, so "what is this
 * agency's offset" has one answer and the settlement, the portal and the
 * maximum daily debit cannot each arrive at a different one.
 */

import type { PrismaClient } from '@prisma/client';

import { toNumber } from './rate-curve.js';

export type RateOffsetClient = Pick<PrismaClient, 'agencyBillingProfile'>;

/**
 * The offset in force for one agency, in dollars.
 *
 * Zero for an agency with no billing profile at all: an agency nobody has
 * agreed terms with is priced off the curve, not off a number that does not
 * exist. Zero rather than null throughout, because the offset is an addend and
 * "no offset" and "an offset of nothing" are the same fact.
 */
export async function loadRateOffset(
  prisma: RateOffsetClient,
  tenantId: string
): Promise<number> {
  const row = await prisma.agencyBillingProfile.findUnique({
    where: { tenantId },
    select: { rateOffset: true },
  });
  return row?.rateOffset == null ? 0 : toNumber(row.rateOffset);
}
