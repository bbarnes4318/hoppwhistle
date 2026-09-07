/**
 * An agency's commercial terms: the Daily Block, the Overrun ceiling, the
 * maximum daily debit, the ACH mandate, and whether a platform admin has
 * suspended the account.
 *
 * ── The arithmetic, with the launch numbers ──────────────────────────────────
 *
 * The Daily Block is a quantity of applications, not calls: one per licensed
 * agent per Delivery Day at launch. The Overrun ceiling is a percentage ABOVE
 * that block, in whole applications, and the maximum daily debit is what both
 * together cost at the applicable rate.
 *
 *   45 licensed agents, block 45, ceiling 50%, rate $134
 *     overrun ceiling  floor(45 x 0.50) = 22 applications
 *     maximum debit    (45 + 22) x $134 = $8,978
 *
 *   15 licensed agents, block 15, ceiling 50%, rate $134
 *     overrun ceiling  floor(15 x 0.50) = 7 applications
 *     maximum debit    (15 + 7) x $134 = $2,948
 *
 * Those are the two figures on the Insertion Orders, and `maxDailyDebitFor()`
 * below reproduces them exactly. The stored `maxDailyDebit` is still the
 * contractual number a platform admin recorded, not this computation: the
 * commitment is what was signed, and a settlement above it halts rather than
 * being quietly recomputed into range.
 *
 * ── The ceiling is discretionary ─────────────────────────────────────────────
 *
 * Overrun is credit extended at NetEnroll's discretion. `ceilingPctOverride`
 * lets a platform admin reduce it or withdraw it entirely (0) at any time, and
 * nothing an agency can reach sets it. No overrun at all is extended to an
 * agency with an unpaid settlement, which is decided in `delivery-gate.ts` from
 * the settlements themselves rather than by editing this row.
 */

import type { AgencyBillingProfile, PrismaClient } from '@prisma/client';
import { AchMandateStatus, SettlementPaymentStatus } from '@prisma/client';

import { getPrismaClient } from '../../lib/prisma.js';
import { toNumber } from '../rating/rate-curve.js';

export type TermsClient = Pick<PrismaClient, 'agencyBillingProfile' | 'dailySettlement'>;

/**
 * The Overrun ceiling in whole applications: how many an agency may submit
 * beyond its Daily Block on one Delivery Day.
 *
 * Floored, not rounded. A half application does not exist, and rounding a half
 * up would extend a credit nobody agreed to -- 45 x 1.5 is 67.5, and the
 * Insertion Order says 67.
 */
export function overrunCeilingApplications(
  dailyBlockApplications: number,
  ceilingPct: number
): number {
  if (dailyBlockApplications <= 0 || ceilingPct <= 0) return 0;
  return Math.floor((dailyBlockApplications * ceilingPct) / 100);
}

/**
 * What a Delivery Day can cost at most: the Daily Block plus the Overrun
 * ceiling, at one rate.
 *
 * This is the figure a platform admin puts on the Insertion Order. It is
 * offered as a computation so the number on the contract and the number in the
 * database come from the same arithmetic, and it is deliberately NOT what the
 * settlement compares against -- that compares against the stored commitment.
 */
export function maxDailyDebitFor(
  dailyBlockApplications: number,
  ceilingPct: number,
  rate: number
): number {
  const ceiling = overrunCeilingApplications(dailyBlockApplications, ceilingPct);
  return (dailyBlockApplications + ceiling) * rate;
}

/**
 * How many settlements in a row, ending with the most recent, were free of a
 * failed or unpaid debit.
 *
 * Counted from the settlements, never incremented into a column: a counter
 * would be wrong the first time a settlement was re-run or a payment status
 * arrived out of order, and this number decides how much credit is extended.
 *
 * PENDING breaks the streak. A settlement that has not been paid yet is not a
 * settlement free of unpaid debits, and being wrong in that direction extends
 * LESS credit rather than more.
 */
export async function consecutiveCleanSettlements(
  prisma: TermsClient,
  tenantId: string
): Promise<number> {
  const rows = await prisma.dailySettlement.findMany({
    where: { tenantId },
    select: { paymentStatus: true },
    orderBy: { deliveryDay: 'desc' },
    // Bounded: nothing above the configured threshold changes the answer, and
    // the threshold is a small number. Read a generous multiple of the largest
    // plausible one rather than the whole history.
    take: 200,
  });

  let clean = 0;
  for (const row of rows) {
    if (
      row.paymentStatus === SettlementPaymentStatus.SUCCEEDED ||
      row.paymentStatus === SettlementPaymentStatus.NOT_CHARGED
    ) {
      clean++;
      continue;
    }
    break;
  }
  return clean;
}

/** One agency's terms, resolved. Every figure server-derived. */
export interface AgencyTerms {
  tenantId: string;
  profile: AgencyBillingProfile | null;
  dailyBlockApplications: number;
  /** The ceiling actually in force, as a percentage above the Daily Block. */
  ceilingPct: number;
  /** Where that percentage came from, so the portal can say. */
  ceilingSource: 'PLATFORM_OVERRIDE' | 'CLEAN_SETTLEMENT_SCHEDULE';
  ceilingApplications: number;
  consecutiveCleanSettlements: number;
  maxDailyDebit: number;
  mandateStatus: AchMandateStatus;
  hasValidMandate: boolean;
  stripeCustomerId: string | null;
  achPaymentMethodId: string | null;
  suspended: boolean;
  suspensionReason: string | null;
}

export async function loadAgencyTerms(
  tenantId: string,
  options: { prisma?: TermsClient } = {}
): Promise<AgencyTerms> {
  const prisma = options.prisma ?? getPrismaClient();

  const [profile, clean] = await Promise.all([
    prisma.agencyBillingProfile.findUnique({ where: { tenantId } }),
    consecutiveCleanSettlements(prisma, tenantId),
  ]);

  const dailyBlockApplications = profile?.dailyBlockApplications ?? 0;

  /*
   * The ceiling schedule: 50% below the threshold, 100% at or beyond it, both
   * configurable per tenant. A platform admin's override replaces the schedule
   * outright rather than capping it, because "reduce or withdraw at any time"
   * has to be able to say zero.
   */
  const scheduled =
    profile === null
      ? 0
      : clean >= profile.ceilingCleanSettlementThreshold
        ? toNumber(profile.ceilingPctAtThreshold)
        : toNumber(profile.ceilingPctBelowThreshold);

  const override =
    profile?.ceilingPctOverride == null ? null : toNumber(profile.ceilingPctOverride);

  const ceilingPct = override ?? scheduled;

  return {
    tenantId,
    profile,
    dailyBlockApplications,
    ceilingPct,
    ceilingSource: override === null ? 'CLEAN_SETTLEMENT_SCHEDULE' : 'PLATFORM_OVERRIDE',
    ceilingApplications: overrunCeilingApplications(dailyBlockApplications, ceilingPct),
    consecutiveCleanSettlements: clean,
    maxDailyDebit: profile === null ? 0 : toNumber(profile.maxDailyDebit),
    mandateStatus: profile?.achMandateStatus ?? AchMandateStatus.NONE,
    hasValidMandate:
      profile?.achMandateStatus === AchMandateStatus.ACTIVE && !!profile.achPaymentMethodId,
    stripeCustomerId: profile?.stripeCustomerId ?? null,
    achPaymentMethodId: profile?.achPaymentMethodId ?? null,
    suspended: profile?.suspendedAt != null,
    suspensionReason: profile?.suspensionReason ?? null,
  };
}
