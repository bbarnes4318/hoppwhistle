/**
 * The daily rating engine.
 *
 * After the close of each business day, each agency's closing percentage is
 * recomputed over the trailing window (3 business days by default) and its rate
 * derived from the curve. That rate applies to the NEXT business day.
 *
 * ── What is deliberately absent ──────────────────────────────────────────────
 *
 * No minimum call threshold. An earlier draft required 250 delivered calls in
 * the window; that existed to stop a thin sample falling off a band edge, and
 * with a continuous curve there are no edges. Both launch agencies clear 450
 * calls in a 3-day window regardless.
 *
 * No band-movement rules. There are no bands. The rate moves to whatever the
 * curve returns. An earlier draft capped increases at one band per day;
 * simulation showed that machinery changed the effective rate by under a dollar
 * per application and it does not apply to a continuous curve. Do not
 * reintroduce it.
 *
 * No refunds, credits, reversals or make-goods. Not here, not in the schema,
 * not in the API. A carrier's decision after submission never returns money.
 *
 * ── The record ───────────────────────────────────────────────────────────────
 *
 * Every run writes one immutable `RateChange`: the agency, the effective
 * business day, the closing percentage and the two counts it came from, the
 * curve version, the previous rate and the new one. That is the row shown to an
 * agency that disputes its price, so it has to be complete enough to recompute
 * the rate from itself -- and `recomputeFromRecord()` below does exactly that,
 * reading nothing but the row and the curve version it names. The test that
 * matters asserts those two agree.
 *
 * ── Idempotence ──────────────────────────────────────────────────────────────
 *
 * One decision per agency per effective day, enforced by a unique index. A
 * second run for the same day writes nothing and returns the existing row: a
 * cron that fires twice, or an operator re-running by hand, must not be able to
 * produce a second, conflicting price.
 */

import { Prisma, PrismaClient, AgencyRatingStatus, RateChangeStatus } from '@prisma/client';

import { getPrismaClient } from '../../lib/prisma.js';

import { lastClosedBusinessDay, nextBusinessDay } from './business-day.js';
import type { BusinessDayKey } from './business-day.js';
import { countSubmittedApplicationsLifetime, measureTrailingWindow } from './measurement.js';
import type { MeasurementDeps } from './measurement.js';
import { rateFor, toRateCurve, toNumber } from './rate-curve.js';
import type { RateCurve } from './rate-curve.js';

const CURVE_INCLUDE = { anchors: true } as const;

/** The active curve version, or a thrown error naming what is missing. */
export async function loadActiveCurve(
  prisma: PrismaClient = getPrismaClient()
): Promise<RateCurve> {
  const settings = await prisma.ratingSettings.findUnique({ where: { id: 'global' } });

  if (settings?.activeCurveVersionId) {
    const row = await prisma.rateCurveVersion.findUnique({
      where: { id: settings.activeCurveVersionId },
      include: CURVE_INCLUDE,
    });
    if (row) return toRateCurve(row);
  }

  // Falling back to the newest non-retired version rather than to constants:
  // there is no rate curve in code to fall back to, and there must not be.
  const latest = await prisma.rateCurveVersion.findFirst({
    where: { retiredAt: null },
    orderBy: { version: 'desc' },
    include: CURVE_INCLUDE,
  });

  if (!latest) {
    throw new Error(
      'No rate curve version exists. The launch curve is seeded by the ' +
        '20260908000000_add_rating_engine migration; the engine will not invent one.'
    );
  }

  return toRateCurve(latest);
}

/** A specific curve version, for recomputing a historical decision. */
export async function loadCurveVersion(
  curveVersionId: string,
  prisma: PrismaClient = getPrismaClient()
): Promise<RateCurve> {
  const row = await prisma.rateCurveVersion.findUnique({
    where: { id: curveVersionId },
    include: CURVE_INCLUDE,
  });
  if (!row) throw new Error(`Rate curve version ${curveVersionId} not found`);
  return toRateCurve(row);
}

/** The trailing window length, in business days. Configurable; 3 by default. */
export async function loadWindowBusinessDays(
  prisma: PrismaClient = getPrismaClient()
): Promise<number> {
  const settings = await prisma.ratingSettings.findUnique({ where: { id: 'global' } });
  return settings?.windowBusinessDays ?? 3;
}

export interface RateAgencyOptions {
  tenantId: string;
  /** The business day that just closed. Defaults to the last closed day. */
  closedBusinessDay?: BusinessDayKey;
  prisma?: PrismaClient;
  now?: Date;
}

export interface RateAgencyResult {
  rateChangeId: string;
  tenantId: string;
  effectiveBusinessDay: BusinessDayKey;
  status: RateChangeStatus;
  deliveredCalls: number;
  submittedApplications: number;
  closingPct: number | null;
  previousRate: number | null;
  newRate: number | null;
  curveVersion: number;
  /** True when a decision for this day already existed and nothing was written. */
  alreadyRated: boolean;
}

/**
 * Rate one agency for the day that just closed.
 *
 * Writes one `RateChange`, updates `AgencyRatingState`, and raises a
 * `RatingReviewFlag` if the window came in below the curve's minimum.
 */
export async function rateAgencyForClosedDay(
  options: RateAgencyOptions
): Promise<RateAgencyResult> {
  const prisma = options.prisma ?? getPrismaClient();
  const now = options.now ?? new Date();
  const closedDay = options.closedBusinessDay ?? lastClosedBusinessDay(now);
  const effectiveBusinessDay = nextBusinessDay(closedDay);

  const existing = await prisma.rateChange.findUnique({
    where: {
      tenantId_effectiveBusinessDay: { tenantId: options.tenantId, effectiveBusinessDay },
    },
  });

  if (existing) {
    return {
      rateChangeId: existing.id,
      tenantId: existing.tenantId,
      effectiveBusinessDay: existing.effectiveBusinessDay,
      status: existing.status,
      deliveredCalls: existing.deliveredCalls,
      submittedApplications: existing.submittedApplications,
      closingPct: existing.closingPct === null ? null : toNumber(existing.closingPct),
      previousRate: existing.previousRate === null ? null : toNumber(existing.previousRate),
      newRate: existing.newRate === null ? null : toNumber(existing.newRate),
      curveVersion: existing.curveVersion,
      alreadyRated: true,
    };
  }

  const [curve, windowBusinessDays] = await Promise.all([
    loadActiveCurve(prisma),
    loadWindowBusinessDays(prisma),
  ]);

  const deps: MeasurementDeps = {
    calls: prisma.call,
    applications: prisma.insuranceCarrierApplication,
  };

  const measured = await measureTrailingWindow(
    deps,
    options.tenantId,
    closedDay,
    windowBusinessDays
  );

  const [state, openFlag, lifetimeApplications] = await Promise.all([
    prisma.agencyRatingState.findUnique({ where: { tenantId: options.tenantId } }),
    prisma.ratingReviewFlag.findFirst({
      where: { tenantId: options.tenantId, clearedAt: null },
      select: { id: true },
    }),
    countSubmittedApplicationsLifetime(deps, options.tenantId),
  ]);

  const previousRate = state?.currentRate == null ? null : toNumber(state.currentRate);

  let status: RateChangeStatus;
  let newRate: number | null;

  if (measured.closingPct === null) {
    // No delivered calls in the window. There is nothing to price from, so the
    // previous rate stands. Recorded rather than skipped: a gap in the history
    // must always mean "the engine did not run", never "it ran and said
    // nothing".
    status = RateChangeStatus.NO_DATA;
    newRate = previousRate;
  } else {
    const verdict = rateFor(curve, measured.closingPct);
    if (verdict.kind === 'BELOW_MINIMUM') {
      status = RateChangeStatus.BELOW_MINIMUM;
      newRate = null;
    } else {
      status = RateChangeStatus.APPLIED;
      newRate = verdict.rate;
    }
  }

  const written = await prisma.$transaction(async tx => {
    const rateChange = await tx.rateChange.create({
      data: {
        tenantId: options.tenantId,
        effectiveBusinessDay,
        windowStart: measured.window.start,
        windowEndExclusive: measured.window.endExclusive,
        windowBusinessDays,
        windowDayKeys: measured.window.dayKeys,
        deliveredCalls: measured.deliveredCalls,
        submittedApplications: measured.submittedApplications,
        closingPct:
          measured.closingPct === null ? null : new Prisma.Decimal(measured.closingPct.toFixed(6)),
        curveVersionId: curve.id,
        curveVersion: curve.version,
        previousRate: previousRate === null ? null : new Prisma.Decimal(previousRate),
        newRate: newRate === null ? null : new Prisma.Decimal(newRate),
        status,
        computedAt: now,
      },
    });

    /*
     * What the agency's own state becomes.
     *
     * The rate change above always records what the CURVE returned — that is
     * the measurement record, and it exists whatever commercial arrangement is
     * in force. What the agency is actually priced at is this, and there are
     * three cases where it is not the curve's answer:
     *
     *   OPENING_BLOCK  An opening rate and block were agreed. The brief is
     *                  explicit that daily rating begins from the first SETTLED
     *                  day, and Phase 2 settles nothing, so the engine records
     *                  the measurement and leaves the agreed rate in force.
     *                  Phase 3 decides when the block is done.
     *
     *   open review    An agency below the curve's minimum stays under review
     *                  until a platform admin clears the flag. A recovered
     *                  window does not un-flag it: "only a platform admin can
     *                  clear it" would mean nothing if the next day's numbers
     *                  could do it instead. The measurement is still recorded,
     *                  so the operator reviewing the flag can see the recovery.
     *
     *   below minimum  No rate at all. `currentRate` is nulled rather than left
     *                  showing yesterday's number: a stale rate on a paused
     *                  account is exactly the sort of thing that gets billed by
     *                  accident.
     */
    const heldByAgreement = state?.status === AgencyRatingStatus.OPENING_BLOCK;
    const heldByReview = openFlag !== null && status !== RateChangeStatus.BELOW_MINIMUM;

    const nextStatus = heldByAgreement
      ? AgencyRatingStatus.OPENING_BLOCK
      : status === RateChangeStatus.BELOW_MINIMUM || heldByReview
        ? AgencyRatingStatus.UNDER_REVIEW
        : AgencyRatingStatus.RATED;

    const appliedRate =
      heldByAgreement || heldByReview
        ? (state?.currentRate ?? null)
        : newRate === null
          ? null
          : new Prisma.Decimal(newRate);

    const stateFields = {
      status: nextStatus,
      currentRate: appliedRate,
      curveVersionId: curve.id,
      // The day the measurement covers, whatever rate is in force.
      currentRateBusinessDay: effectiveBusinessDay,
      lastRatedBusinessDay: closedDay,
      // Counted, not incremented. See countSubmittedApplicationsLifetime().
      introductoryApplicationsUsed: lifetimeApplications,
    };

    await tx.agencyRatingState.upsert({
      where: { tenantId: options.tenantId },
      create: { tenantId: options.tenantId, ...stateFields },
      update: stateFields,
    });

    if (status === RateChangeStatus.BELOW_MINIMUM && measured.closingPct !== null) {
      // One open flag at a time. A second consecutive day below the minimum is
      // the same review, not a new one.
      const open = await tx.ratingReviewFlag.findFirst({
        where: { tenantId: options.tenantId, clearedAt: null },
      });

      if (!open) {
        await tx.ratingReviewFlag.create({
          data: {
            tenantId: options.tenantId,
            rateChangeId: rateChange.id,
            closingPct: new Prisma.Decimal(measured.closingPct.toFixed(6)),
            deliveredCalls: measured.deliveredCalls,
            submittedApplications: measured.submittedApplications,
            raisedAt: now,
          },
        });
      }
    }

    return rateChange;
  });

  return {
    rateChangeId: written.id,
    tenantId: options.tenantId,
    effectiveBusinessDay,
    status,
    deliveredCalls: measured.deliveredCalls,
    submittedApplications: measured.submittedApplications,
    closingPct: measured.closingPct,
    previousRate,
    newRate,
    curveVersion: curve.version,
    alreadyRated: false,
  };
}

/**
 * Rate every active agency for the day that just closed.
 *
 * One agency failing does not stop the others: their rates are independent, and
 * a bad row for one must not leave the rest unpriced.
 */
export async function runDailyRating(
  options: { closedBusinessDay?: BusinessDayKey; prisma?: PrismaClient; now?: Date } = {}
): Promise<{
  closedBusinessDay: BusinessDayKey;
  effectiveBusinessDay: BusinessDayKey;
  results: RateAgencyResult[];
  failures: Array<{ tenantId: string; error: string }>;
}> {
  const prisma = options.prisma ?? getPrismaClient();
  const now = options.now ?? new Date();
  const closedBusinessDay = options.closedBusinessDay ?? lastClosedBusinessDay(now);

  const tenants = await prisma.tenant.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });

  const results: RateAgencyResult[] = [];
  const failures: Array<{ tenantId: string; error: string }> = [];

  for (const tenant of tenants) {
    try {
      results.push(
        await rateAgencyForClosedDay({
          tenantId: tenant.id,
          closedBusinessDay,
          prisma,
          now,
        })
      );
    } catch (err) {
      failures.push({
        tenantId: tenant.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return {
    closedBusinessDay,
    effectiveBusinessDay: nextBusinessDay(closedBusinessDay),
    results,
    failures,
  };
}

/**
 * Recompute a rating decision from its own stored values.
 *
 * This is the dispute answer: hand it a `rate_changes` row and it re-derives
 * the closing percentage from the two counts and the rate from the curve
 * version the row names, touching no live data. If this ever disagrees with
 * `newRate`, the row is not the record it claims to be.
 */
export async function recomputeFromRecord(
  rateChangeId: string,
  prisma: PrismaClient = getPrismaClient()
): Promise<{
  closingPct: number | null;
  rate: number | null;
  status: RateChangeStatus;
  matchesStoredRate: boolean;
}> {
  const row = await prisma.rateChange.findUnique({ where: { id: rateChangeId } });
  if (!row) throw new Error(`Rate change ${rateChangeId} not found`);

  const curve = await loadCurveVersion(row.curveVersionId, prisma);

  const closingPct =
    row.deliveredCalls > 0 ? (row.submittedApplications / row.deliveredCalls) * 100 : null;

  if (closingPct === null) {
    const storedRate = row.newRate === null ? null : toNumber(row.newRate);
    const previousRate = row.previousRate === null ? null : toNumber(row.previousRate);
    return {
      closingPct: null,
      rate: previousRate,
      status: RateChangeStatus.NO_DATA,
      matchesStoredRate: storedRate === previousRate,
    };
  }

  const verdict = rateFor(curve, closingPct);
  const storedRate = row.newRate === null ? null : toNumber(row.newRate);

  if (verdict.kind === 'BELOW_MINIMUM') {
    return {
      closingPct,
      rate: null,
      status: RateChangeStatus.BELOW_MINIMUM,
      matchesStoredRate: storedRate === null,
    };
  }

  return {
    closingPct,
    rate: verdict.rate,
    status: RateChangeStatus.APPLIED,
    matchesStoredRate: storedRate === verdict.rate,
  };
}

/**
 * Clear an agency's open review flag. Platform staff only -- the caller is
 * responsible for the capability check; this records who did it.
 *
 * An agency cannot clear its own flag, which is the entire point of the state.
 */
export async function clearReviewFlag(params: {
  flagId: string;
  clearedByUserId: string;
  note?: string;
  prisma?: PrismaClient;
  now?: Date;
}): Promise<{ cleared: boolean; tenantId: string | null }> {
  const prisma = params.prisma ?? getPrismaClient();
  const now = params.now ?? new Date();

  const flag = await prisma.ratingReviewFlag.findUnique({ where: { id: params.flagId } });
  if (!flag) return { cleared: false, tenantId: null };
  if (flag.clearedAt) return { cleared: false, tenantId: flag.tenantId };

  await prisma.$transaction(async tx => {
    await tx.ratingReviewFlag.update({
      where: { id: params.flagId },
      data: {
        clearedAt: now,
        clearedByUserId: params.clearedByUserId,
        clearedNote: params.note ?? null,
      },
    });

    // The agency comes off review, but does NOT get a rate back from here:
    // the next daily run prices it from the curve. Handing it a rate at the
    // moment a flag is cleared would be a price set by a button press rather
    // than by a measurement.
    await tx.agencyRatingState.updateMany({
      where: { tenantId: flag.tenantId, status: AgencyRatingStatus.UNDER_REVIEW },
      data: { status: AgencyRatingStatus.RATED },
    });
  });

  return { cleared: true, tenantId: flag.tenantId };
}
