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
 *
 * ── Two switches, both explicit, both safe by default ────────────────────────
 *
 * ENROLMENT decides whether an agency is subject to any of this. Unenrolled is
 * the default and means untouched: not gated, not metered, not settled. It is
 * never inferred -- not from this row existing, not from a mandate, not from
 * ledger rows -- because an opt-in that can be arrived at accidentally is not
 * an opt-in, and the accident here stops an agency's phones.
 *
 * CHARGING decides whether an enrolled agency's settlement may place a debit.
 * Also false by default, so an agency can be enrolled and watched for as long
 * as it takes: the settlement computes everything and writes the full
 * immutable record, and only the Stripe charge is skipped.
 *
 * `enrolmentBlockers()` is the other half of enrolment. An agency cannot be
 * enrolled without a billing profile, a Daily Block, an agreed opening rate and
 * a valid payment instrument, because enrolment without them means the gate
 * refuses every call the moment it takes effect -- which is the failure this
 * whole switch exists to prevent, moved one step later.
 *
 * ── The rate offset ──────────────────────────────────────────────────────────
 *
 * `rateOffset` is dollars added to whatever the curve returns, at every point
 * on the curve. It is a term, so it is stored here; it is part of the price, so
 * it is READ through `services/rating/rate-offset.ts` and applied by
 * `effectiveRate()`. It is not a surcharge and there is no fee line anywhere:
 * see those two modules for why that distinction is the whole design.
 *
 * `maxDailyDebitFor()` therefore takes an EFFECTIVE rate. The maximum daily
 * debit on an Insertion Order is what a full day at the ceiling costs, and a
 * day at the ceiling costs the effective rate.
 *
 * ── ACH or card, and what that changes ───────────────────────────────────────
 *
 * `paymentMethod` decides which instrument the settlement debits and which
 * Overrun ceiling applies. It decides nothing about the price -- an agency's
 * offset is agreed and recorded, never derived from this column.
 *
 * A card-paying agency gets a flat 25% ceiling that does not rise with
 * settlement history. Overrun is unsecured credit and a card payment can be
 * taken back without our consent months later, so the clean-settlement schedule
 * -- which rewards a payment record with MORE credit -- is the wrong shape for
 * an instrument whose payment record can be undone. See `ceilingFor()`.
 */

import type { AgencyBillingProfile, PrismaClient } from '@prisma/client';
import { AchMandateStatus, AgencyPaymentMethod, SettlementPaymentStatus } from '@prisma/client';

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
 *
 * `rate` is the EFFECTIVE rate: the curve rate plus the agency's rate offset.
 * A maximum daily debit computed off the curve rate alone would be short by the
 * offset times the whole block plus ceiling every day, and a settlement at the
 * ceiling would halt on a cap that was never what the day actually costs.
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
 *
 * DRY_RUN breaks it too, for the same reason and more plainly: nothing was
 * charged, so nothing was paid. An agency must not accumulate ten dry-run days
 * and arrive at the doubled Overrun ceiling having never moved a cent.
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

/**
 * The Overrun ceiling percentage in force, and where it came from.
 *
 * Three sources, in this order:
 *
 *   PLATFORM_OVERRIDE   a platform admin set one. Replaces the rest outright
 *                       rather than capping it, because "reduce or withdraw at
 *                       any time" has to be able to say zero.
 *   CARD_EXPOSURE       the agency pays by card. A flat percentage that does
 *                       NOT rise with settlement history.
 *   CLEAN_SETTLEMENT_SCHEDULE
 *                       the ACH schedule: the lower percentage below the
 *                       threshold, the higher one at or beyond it.
 *
 * Why card is its own source rather than a smaller number on the same schedule:
 * the schedule extends MORE credit to an agency with a longer record of clean
 * settlements, and a card payment can be taken back without our consent up to
 * months after it settled. A run of clean card settlements is therefore not the
 * evidence the schedule treats it as, and letting one earn a 100% ceiling would
 * be extending unsecured credit against an instrument the counterparty can
 * reverse. The percentage is chargeback exposure we are choosing to carry, and
 * it is flat because the exposure does not shrink with time.
 */
export function ceilingFor(
  profile: AgencyBillingProfile | null,
  consecutiveClean: number
): { ceilingPct: number; ceilingSource: AgencyTerms['ceilingSource'] } {
  if (profile === null) return { ceilingPct: 0, ceilingSource: 'CLEAN_SETTLEMENT_SCHEDULE' };

  if (profile.ceilingPctOverride != null) {
    return {
      ceilingPct: toNumber(profile.ceilingPctOverride),
      ceilingSource: 'PLATFORM_OVERRIDE',
    };
  }

  if (profile.paymentMethod === AgencyPaymentMethod.CARD) {
    return { ceilingPct: toNumber(profile.ceilingPctCard), ceilingSource: 'CARD_EXPOSURE' };
  }

  return {
    ceilingPct:
      consecutiveClean >= profile.ceilingCleanSettlementThreshold
        ? toNumber(profile.ceilingPctAtThreshold)
        : toNumber(profile.ceilingPctBelowThreshold),
    ceilingSource: 'CLEAN_SETTLEMENT_SCHEDULE',
  };
}

/** One agency's terms, resolved. Every figure server-derived. */
export interface AgencyTerms {
  tenantId: string;
  profile: AgencyBillingProfile | null;
  /**
   * Whether this agency is subject to the billing system at all.
   *
   * False for an agency with no billing profile AND for one whose profile
   * exists but has never been enrolled. Everything else on this object is
   * meaningless while it is false, and every caller checks it first.
   */
  enrolled: boolean;
  enrolledAt: Date | null;
  /** Whether an enrolled agency's settlement may place a real debit. */
  chargesEnabled: boolean;
  dailyBlockApplications: number;
  /**
   * Dollars added to the curve rate, at every point on the curve. Zero unless a
   * platform admin agreed one. Not a fee and never itemised: see
   * `services/rating/rate-offset.ts`.
   */
  rateOffset: number;
  /** Which instrument the settlement debits. */
  paymentMethod: AgencyPaymentMethod;
  /** The ceiling actually in force, as a percentage above the Daily Block. */
  ceilingPct: number;
  /** Where that percentage came from, so the portal can say. */
  ceilingSource: 'PLATFORM_OVERRIDE' | 'CLEAN_SETTLEMENT_SCHEDULE' | 'CARD_EXPOSURE';
  ceilingApplications: number;
  consecutiveCleanSettlements: number;
  maxDailyDebit: number;
  /**
   * The status of the instrument this agency actually pays with -- the bank
   * mandate for an ACH agency, the saved card for a card one. One field rather
   * than two, because every caller wants the same answer: is there something
   * usable to debit.
   */
  mandateStatus: AchMandateStatus;
  hasValidMandate: boolean;
  stripeCustomerId: string | null;
  achPaymentMethodId: string | null;
  cardPaymentMethodId: string | null;
  /**
   * The Stripe payment method the settlement will debit, chosen by
   * `paymentMethod`. Resolved here so no caller picks an instrument by reading
   * two nullable columns and guessing.
   */
  settlementPaymentMethodId: string | null;
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

  const { ceilingPct, ceilingSource } = ceilingFor(profile, clean);

  /*
   * The instrument this agency actually pays with.
   *
   * `paymentMethod` picks it, and everything downstream reads these three
   * fields rather than the ACH columns directly -- so an agency that pays by
   * card is not reported as having no mandate, and the settlement does not
   * debit a bank account for an agency that never gave us one.
   */
  const paymentMethod = profile?.paymentMethod ?? AgencyPaymentMethod.ACH;
  const payingByCard = paymentMethod === AgencyPaymentMethod.CARD;

  const mandateStatus = payingByCard
    ? profile?.cardMandateStatus ?? AchMandateStatus.NONE
    : profile?.achMandateStatus ?? AchMandateStatus.NONE;

  const settlementPaymentMethodId = payingByCard
    ? profile?.cardPaymentMethodId ?? null
    : profile?.achPaymentMethodId ?? null;

  return {
    tenantId,
    profile,
    enrolled: profile?.billingEnrolledAt != null,
    enrolledAt: profile?.billingEnrolledAt ?? null,
    chargesEnabled: profile?.chargesEnabled === true,
    dailyBlockApplications,
    rateOffset: profile?.rateOffset == null ? 0 : toNumber(profile.rateOffset),
    paymentMethod,
    ceilingPct,
    ceilingSource,
    ceilingApplications: overrunCeilingApplications(dailyBlockApplications, ceilingPct),
    consecutiveCleanSettlements: clean,
    maxDailyDebit: profile === null ? 0 : toNumber(profile.maxDailyDebit),
    mandateStatus,
    hasValidMandate: mandateStatus === AchMandateStatus.ACTIVE && !!settlementPaymentMethodId,
    stripeCustomerId: profile?.stripeCustomerId ?? null,
    achPaymentMethodId: profile?.achPaymentMethodId ?? null,
    cardPaymentMethodId: profile?.cardPaymentMethodId ?? null,
    settlementPaymentMethodId,
    suspended: profile?.suspendedAt != null,
    suspensionReason: profile?.suspensionReason ?? null,
  };
}

/**
 * Is this agency subject to the billing system at all?
 *
 * The cheap form of the question, for the hot paths: the delivery gate asks it
 * on every call offered, and the consumption hook asks it every time an
 * application reaches submitted state. Both need one indexed lookup, not the
 * full terms with its settlement scan.
 *
 * A tenant with no billing profile is not enrolled. A tenant whose profile
 * exists but was never enrolled is not enrolled. There is no third answer and
 * no inference: `billingEnrolledAt` is set by an explicit act or it is null.
 */
export async function isEnrolledForBilling(
  prisma: Pick<PrismaClient, 'agencyBillingProfile'>,
  tenantId: string
): Promise<boolean> {
  const row = await prisma.agencyBillingProfile.findUnique({
    where: { tenantId },
    select: { billingEnrolledAt: true },
  });
  return row?.billingEnrolledAt != null;
}

/** Everything an agency is missing before it can be enrolled. */
export interface EnrolmentBlocker {
  code:
    | 'NO_BILLING_PROFILE'
    | 'NO_DAILY_BLOCK'
    | 'NO_MAX_DAILY_DEBIT'
    | 'NO_OPENING_RATE'
    | 'NO_VALID_MANDATE';
  message: string;
}

/**
 * What stands between this agency and being enrolled.
 *
 * ── Why enrolment is refused rather than just recorded ───────────────────────
 *
 * Enrolment takes effect on the next call offered. An agency enrolled without a
 * mandate is an agency whose phones stop that second -- the exact failure the
 * enrolment switch exists to prevent, moved one step later and made harder to
 * see, because now somebody did it on purpose.
 *
 * So every precondition the gate and the settlement will need is checked
 * up-front, and the refusal names each missing one rather than saying no. An
 * operator enrolling an agency at 9am should not have to discover the list one
 * failed enrolment at a time.
 *
 * Returns an empty array when the agency is ready.
 */
export function enrolmentBlockers(terms: AgencyTerms): EnrolmentBlocker[] {
  const blockers: EnrolmentBlocker[] = [];

  if (!terms.profile) {
    // Everything else is read off the profile, so this is the only blocker
    // worth reporting when it is missing -- the rest would all be "missing"
    // for the same single reason and would read as five problems.
    return [
      {
        code: 'NO_BILLING_PROFILE',
        message:
          'No billing profile. Record the agency terms first: ' +
          'PUT /api/v1/platform/delivery/agencies/:tenantId/terms',
      },
    ];
  }

  if (terms.dailyBlockApplications <= 0) {
    blockers.push({
      code: 'NO_DAILY_BLOCK',
      message:
        'No Daily Block. A block of zero means every application is Overrun and ' +
        'the ceiling is zero, so delivery would stop on the first application.',
    });
  }

  if (terms.maxDailyDebit <= 0) {
    blockers.push({
      code: 'NO_MAX_DAILY_DEBIT',
      message:
        'No maximum daily debit. It is a contractual commitment on the Insertion ' +
        'Order, and a settlement above it halts -- so a maximum of zero halts every ' +
        'settlement.',
    });
  }

  return blockers;
}

/**
 * The blockers that need a database read: the agreed opening rate, and the
 * mandate.
 *
 * Separate from `enrolmentBlockers` so that function stays a pure check over
 * terms already loaded, which is what makes it testable without a database.
 */
export async function enrolmentBlockersFor(
  tenantId: string,
  options: { prisma?: TermsClient & Pick<PrismaClient, 'agencyRatingState'> } = {}
): Promise<{ terms: AgencyTerms; blockers: EnrolmentBlocker[] }> {
  const prisma = options.prisma ?? getPrismaClient();
  const terms = await loadAgencyTerms(tenantId, { prisma });
  const blockers = enrolmentBlockers(terms);

  if (!terms.profile) return { terms, blockers };

  if (!terms.hasValidMandate) {
    const instrument =
      terms.paymentMethod === AgencyPaymentMethod.CARD ? 'card on file' : 'ACH mandate';
    blockers.push({
      code: 'NO_VALID_MANDATE',
      message:
        `No valid ${instrument} (status: ${terms.mandateStatus}). No payment method, no ` +
        'delivery -- enrolling without one stops this agency immediately.',
    });
  }

  /*
   * An opening rate agreed and recorded, or a rate already in force from a
   * previous settled day. Without one there is no price: the gate refuses with
   * NO_OPENING_AGREEMENT and the settlement has nothing to bill overrun at.
   */
  const state = await prisma.agencyRatingState.findUnique({
    where: { tenantId },
    select: { openingRate: true, currentRate: true },
  });

  if (state?.openingRate == null && state?.currentRate == null) {
    blockers.push({
      code: 'NO_OPENING_RATE',
      message:
        'No agreed opening rate. Record it first: ' +
        'PUT /api/v1/platform/rating/agencies/:tenantId/opening',
    });
  }

  return { terms, blockers };
}
