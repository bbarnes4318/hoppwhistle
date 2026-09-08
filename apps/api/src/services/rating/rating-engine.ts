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
 *
 * That holds for two runs starting TOGETHER as well as for one after another.
 * The pre-read makes the repeat case cheap; the unique index makes the
 * concurrent case correct, and the constraint violation is caught and the
 * existing decision returned rather than raised. Phase 3's settlement calls
 * this, so a run that raised because another run was rating the same agency at
 * the same moment would be an agency that did not get billed.
 */

import { Prisma, PrismaClient, AgencyRatingStatus, RateChangeStatus } from '@prisma/client';

import { getPrismaClient } from '../../lib/prisma.js';

import { lastClosedCalendarDay, nextCalendarDay, windowOf } from './calendar-day.js';
import type { CalendarDayKey } from './calendar-day.js';
import { measureTrailingDeliveryDays } from './delivery-day.js';
import type { DeliveryDayDeps } from './delivery-day.js';
import { effectiveRate, rateFor, toRateCurve, toNumber } from './rate-curve.js';
import type { RateCurve } from './rate-curve.js';
import { loadRateOffset } from './rate-offset.js';

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

/**
 * The trailing window length, in DELIVERY DAYS, and how far back to look for
 * them. Configurable; 3 and 60 by default.
 */
export async function loadWindowSettings(
  prisma: PrismaClient = getPrismaClient()
): Promise<{ windowDeliveryDays: number; deliveryDayLookback: number }> {
  const settings = await prisma.ratingSettings.findUnique({ where: { id: 'global' } });
  return {
    windowDeliveryDays: settings?.windowDeliveryDays ?? 3,
    deliveryDayLookback: settings?.deliveryDayLookback ?? 60,
  };
}

export interface RateAgencyOptions {
  tenantId: string;
  /** The business day that just closed. Defaults to the last closed day. */
  closedCalendarDay?: CalendarDayKey;
  prisma?: PrismaClient;
  now?: Date;
}

export interface RateAgencyResult {
  rateChangeId: string;
  tenantId: string;
  effectiveCalendarDay: CalendarDayKey;
  status: RateChangeStatus;
  deliveredCalls: number;
  submittedApplications: number;
  closingPct: number | null;
  /** The Delivery Days the counts came from, oldest first. */
  windowDayKeys: CalendarDayKey[];
  /** How many were found; fewer than requested is a shorter sample. */
  windowDaysFound: number;
  previousRate: number | null;
  /**
   * The EFFECTIVE rate: what the curve returned plus the agency's rate offset.
   * This is what the agency is priced at and what the settlement bills.
   */
  newRate: number | null;
  /** What the curve alone returned, before the offset. */
  curveRate: number | null;
  /** The offset in force when this decision was made. */
  rateOffset: number;
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
  const closedDay = options.closedCalendarDay ?? lastClosedCalendarDay(now);
  const effectiveCalendarDay = nextCalendarDay(closedDay);

  const existing = await prisma.rateChange.findUnique({
    where: {
      tenantId_effectiveCalendarDay: { tenantId: options.tenantId, effectiveCalendarDay },
    },
  });

  if (existing) {
    return {
      rateChangeId: existing.id,
      tenantId: existing.tenantId,
      effectiveCalendarDay: existing.effectiveCalendarDay,
      status: existing.status,
      deliveredCalls: existing.deliveredCalls,
      submittedApplications: existing.submittedApplications,
      closingPct: existing.closingPct === null ? null : toNumber(existing.closingPct),
      windowDayKeys: existing.windowDayKeys,
      windowDaysFound: existing.windowDaysFound,
      previousRate: existing.previousRate === null ? null : toNumber(existing.previousRate),
      newRate: existing.newRate === null ? null : toNumber(existing.newRate),
      curveRate: existing.curveRate === null ? null : toNumber(existing.curveRate),
      rateOffset: toNumber(existing.rateOffset),
      curveVersion: existing.curveVersion,
      alreadyRated: true,
    };
  }

  const [curve, windowSettings, rateOffset] = await Promise.all([
    loadActiveCurve(prisma),
    loadWindowSettings(prisma),
    /*
     * The agency's rate offset, read once and copied onto the row below.
     *
     * Copied rather than joined at read time, so changing an agency's offset
     * tomorrow does not silently restate what it was priced at today. A rate
     * change is an immutable record of a decision, and the offset was part of
     * that decision.
     */
    loadRateOffset(prisma, options.tenantId),
  ]);

  const deps: DeliveryDayDeps = {
    calls: prisma.call,
    applications: prisma.insuranceCarrierApplication,
  };

  /*
   * The trailing three DELIVERY DAYS ending on the day that just closed.
   *
   * Not calendar days. A weekday-only agency would have Monday priced off
   * Saturday and Sunday, two days on which it was delivered nothing, and a
   * third of its denominator would be zero for reasons unconnected to how it
   * performs. Not Business Days either: that term is reserved for contractual
   * notice periods and would be wrong for an agency that does work weekends.
   *
   * Null when the agency has no Delivery Days in the lookback at all -- it has
   * never been sent a call, or has not been sent one in two months. That is
   * NO_DATA below, and it is a different thing from a window whose days
   * happened to be quiet.
   */
  const measured = await measureTrailingDeliveryDays(
    deps,
    options.tenantId,
    closedDay,
    windowSettings.windowDeliveryDays,
    windowSettings.deliveryDayLookback
  );

  const [state, openFlag] = await Promise.all([
    prisma.agencyRatingState.findUnique({ where: { tenantId: options.tenantId } }),
    prisma.ratingReviewFlag.findFirst({
      where: { tenantId: options.tenantId, clearedAt: null },
      select: { id: true },
    }),
  ]);

  const previousRate = state?.currentRate == null ? null : toNumber(state.currentRate);

  let status: RateChangeStatus;
  /** What the curve alone returned. */
  let curveRate: number | null;
  /** The curve rate plus this agency's offset: what it is actually priced at. */
  let newRate: number | null;

  if (measured === null || measured.closingPct === null) {
    /*
     * No Delivery Days in the lookback: this agency has not been sent a call in
     * two months, or ever. There is nothing to price from, so the previous rate
     * stands.
     *
     * Recorded rather than skipped, so a gap in the history always means "the
     * engine did not run", never "it ran and said nothing". And deliberately
     * NOT a review flag: an agency that was sent no calls has not performed
     * below the floor, it has not performed at all, and flagging it would pause
     * delivery to an agency whose only fault is that delivery already stopped.
     *
     * `measured.closingPct === null` cannot happen once `measured` exists -- a
     * Delivery Day is by definition a day with at least one delivered call, so
     * the denominator is at least the number of days. It is checked anyway so
     * that a future change to the Delivery Day predicate cannot turn a
     * divide-by-zero into a rate.
     */
    status = RateChangeStatus.NO_DATA;
    /*
     * The previous rate stands, and it was already an effective rate -- the
     * curve rate plus whatever offset was in force when it was set. There is no
     * curve answer today because nothing was measured, so `curveRate` is the
     * effective rate less today's offset: the two parts still sum to what is
     * recorded, which is what makes the row recomputable from itself.
     */
    newRate = previousRate;
    curveRate = previousRate === null ? null : Number((previousRate - rateOffset).toFixed(2));
  } else {
    const verdict = rateFor(curve, measured.closingPct);
    if (verdict.kind === 'BELOW_MINIMUM') {
      status = RateChangeStatus.BELOW_MINIMUM;
      // No rate at all below the minimum. The offset is not added to the
      // absence of a rate: that would invent one.
      curveRate = null;
      newRate = null;
    } else {
      status = RateChangeStatus.APPLIED;
      curveRate = verdict.rate;
      newRate = effectiveRate(verdict.rate, rateOffset);
    }
  }

  /*
   * The window to record when there is none.
   *
   * A NO_DATA row still has to say what was looked at, or it is not a record.
   * The closed day, alone, with `windowDaysFound: 0` -- which reads exactly as
   * what happened: we looked, ending here, and found no Delivery Days.
   */
  const recordedWindow = measured?.window ?? {
    ...windowOf([closedDay]),
    requested: windowSettings.windowDeliveryDays,
    found: 0,
    lookbackDays: windowSettings.deliveryDayLookback,
  };

  const write = async () => prisma.$transaction(async tx => {
    const rateChange = await tx.rateChange.create({
      data: {
        tenantId: options.tenantId,
        effectiveCalendarDay,
        windowStart: recordedWindow.start,
        windowEndExclusive: recordedWindow.endExclusive,
        windowDeliveryDays: recordedWindow.requested,
        windowDaysFound: recordedWindow.found,
        windowDayKeys: measured ? recordedWindow.dayKeys : [],
        deliveredCalls: measured?.deliveredCalls ?? 0,
        submittedApplications: measured?.submittedApplications ?? 0,
        closingPct:
          measured?.closingPct == null
            ? null
            : new Prisma.Decimal(measured.closingPct.toFixed(6)),
        curveVersionId: curve.id,
        curveVersion: curve.version,
        previousRate: previousRate === null ? null : new Prisma.Decimal(previousRate),
        newRate: newRate === null ? null : new Prisma.Decimal(newRate),
        curveRate: curveRate === null ? null : new Prisma.Decimal(curveRate),
        rateOffset: new Prisma.Decimal(rateOffset.toFixed(2)),
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
     *   OPENING_BLOCK  An opening rate and block were agreed before the
     *                  agency's first Delivery Day. The agreed rate stands
     *                  until the settlement of that first day, after which the
     *                  curve governs -- there is no introductory package and no
     *                  first-N-applications count anywhere in this decision.
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
      currentRateCalendarDay: effectiveCalendarDay,
      lastRatedCalendarDay: closedDay,
    };

    await tx.agencyRatingState.upsert({
      where: { tenantId: options.tenantId },
      create: { tenantId: options.tenantId, ...stateFields },
      update: stateFields,
    });

    if (status === RateChangeStatus.BELOW_MINIMUM && measured?.closingPct != null) {
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

  /*
   * Idempotence under concurrency, not just under repetition.
   *
   * The `findUnique` above makes a re-run a no-op. It does not make two runs
   * STARTING TOGETHER a no-op: both find nothing and both write, and the loser
   * of the unique index on (tenantId, effectiveCalendarDay) raises. Phase 2
   * only ever ran this from a cron and a by-hand button, so that race was
   * theoretical. Phase 3's settlement calls it, and a settlement that raises
   * because another settlement was rating the same agency at the same moment is
   * an agency that does not get billed.
   *
   * So the constraint is caught and the existing decision returned. The index
   * is still what decides; this is reading the answer it gave.
   */
  let written: Awaited<ReturnType<typeof write>>;
  try {
    written = await write();
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
      throw error;
    }

    const raced = await prisma.rateChange.findUnique({
      where: {
        tenantId_effectiveCalendarDay: { tenantId: options.tenantId, effectiveCalendarDay },
      },
    });
    if (!raced) throw error;

    return {
      rateChangeId: raced.id,
      tenantId: raced.tenantId,
      effectiveCalendarDay: raced.effectiveCalendarDay,
      status: raced.status,
      deliveredCalls: raced.deliveredCalls,
      submittedApplications: raced.submittedApplications,
      closingPct: raced.closingPct === null ? null : toNumber(raced.closingPct),
      windowDayKeys: raced.windowDayKeys,
      windowDaysFound: raced.windowDaysFound,
      previousRate: raced.previousRate === null ? null : toNumber(raced.previousRate),
      newRate: raced.newRate === null ? null : toNumber(raced.newRate),
      curveRate: raced.curveRate === null ? null : toNumber(raced.curveRate),
      rateOffset: toNumber(raced.rateOffset),
      curveVersion: raced.curveVersion,
      alreadyRated: true,
    };
  }

  return {
    rateChangeId: written.id,
    tenantId: options.tenantId,
    effectiveCalendarDay,
    status,
    deliveredCalls: measured?.deliveredCalls ?? 0,
    submittedApplications: measured?.submittedApplications ?? 0,
    closingPct: measured?.closingPct ?? null,
    windowDayKeys: measured ? recordedWindow.dayKeys : [],
    windowDaysFound: recordedWindow.found,
    previousRate,
    newRate,
    curveRate,
    rateOffset,
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
  options: { closedCalendarDay?: CalendarDayKey; prisma?: PrismaClient; now?: Date } = {}
): Promise<{
  closedCalendarDay: CalendarDayKey;
  effectiveCalendarDay: CalendarDayKey;
  results: RateAgencyResult[];
  failures: Array<{ tenantId: string; error: string }>;
}> {
  const prisma = options.prisma ?? getPrismaClient();
  const now = options.now ?? new Date();
  const closedCalendarDay = options.closedCalendarDay ?? lastClosedCalendarDay(now);

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
          closedCalendarDay,
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
    closedCalendarDay,
    effectiveCalendarDay: nextCalendarDay(closedCalendarDay),
    results,
    failures,
  };
}

/**
 * Recompute a rating decision from its own stored values.
 *
 * This is the dispute answer: hand it a `rate_changes` row and it re-derives
 * the closing percentage from the two counts, the curve rate from the curve
 * version the row names, and the effective rate by adding the offset the row
 * itself records. It touches no live data -- in particular it does not read the
 * agency's CURRENT offset, because a rate that could be restated by a later
 * commercial change is not a record.
 *
 * If this ever disagrees with `newRate`, the row is not the record it claims to
 * be.
 */
export async function recomputeFromRecord(
  rateChangeId: string,
  prisma: PrismaClient = getPrismaClient()
): Promise<{
  closingPct: number | null;
  /** The effective rate: the curve rate plus the offset stored on the row. */
  rate: number | null;
  /** The curve's own answer, before the offset. */
  curveRate: number | null;
  /** The offset the row was priced with, read off the row. */
  rateOffset: number;
  status: RateChangeStatus;
  matchesStoredRate: boolean;
}> {
  const row = await prisma.rateChange.findUnique({ where: { id: rateChangeId } });
  if (!row) throw new Error(`Rate change ${rateChangeId} not found`);

  const curve = await loadCurveVersion(row.curveVersionId, prisma);
  const rateOffset = toNumber(row.rateOffset);

  const closingPct =
    row.deliveredCalls > 0 ? (row.submittedApplications / row.deliveredCalls) * 100 : null;

  if (closingPct === null) {
    const storedRate = row.newRate === null ? null : toNumber(row.newRate);
    const previousRate = row.previousRate === null ? null : toNumber(row.previousRate);
    return {
      closingPct: null,
      rate: previousRate,
      // No measurement, so the curve was never asked. The row's own curveRate
      // is what it recorded; reporting it keeps the two halves summing.
      curveRate: row.curveRate === null ? null : toNumber(row.curveRate),
      rateOffset,
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
      curveRate: null,
      rateOffset,
      status: RateChangeStatus.BELOW_MINIMUM,
      matchesStoredRate: storedRate === null,
    };
  }

  const recomputed = effectiveRate(verdict.rate, rateOffset);

  return {
    closingPct,
    rate: recomputed,
    curveRate: verdict.rate,
    rateOffset,
    status: RateChangeStatus.APPLIED,
    matchesStoredRate: storedRate === recomputed,
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
