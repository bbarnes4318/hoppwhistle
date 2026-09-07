/**
 * What an agency sees about its own rate.
 *
 * Four numbers, and the whole point is that they are not confusable:
 *
 *   todayClosingPct     today so far. Moves all day, prices nothing.
 *   windowClosingPct    the trailing Delivery Day window that ACTUALLY set the
 *                       current rate. This is the number the agency is paid on.
 *   currentRate         dollars per submitted application, today.
 *   trackingRate        what the curve would return if the window ending today
 *                       closed right now — tomorrow's rate, if nothing else
 *                       changes.
 *
 * An agency that mistakes the first for the second thinks its price changed at
 * 10am. An agency that mistakes the fourth for the third thinks it is being
 * paid a rate it is not yet being paid. Both are shaped like a billing dispute,
 * so each is labelled here and rendered distinctly in the portal.
 *
 * ── Delivery Days, and saying so ─────────────────────────────────────────────
 *
 * The window is the trailing three DELIVERY DAYS — calendar days on which this
 * agency was delivered at least one call — not the trailing three calendar
 * days. For a weekday-only agency, Monday's rate is set by the prior Thursday,
 * Friday and Monday, and the portal names those three days rather than saying
 * "3 days" and leaving the agency to guess which. An agency that cannot
 * reconstruct its own window cannot check its own price.
 *
 * Every number is computed server-side from the tenant on the authenticated
 * request. Nothing here accepts a rate, a price or a computed amount from the
 * browser, and there is no parameter that widens the scope beyond one agency.
 */

import type { PrismaClient } from '@prisma/client';
import { AgencyRatingStatus } from '@prisma/client';

import { getPrismaClient } from '../../lib/prisma.js';

import { currentCalendarDay } from './calendar-day.js';
import type { CalendarDayKey } from './calendar-day.js';
import { measureTrailingDeliveryDays } from './delivery-day.js';
import type { DeliveryDayDeps } from './delivery-day.js';
import { measureCalendarDay } from './measurement.js';
import { rateFor, toNumber } from './rate-curve.js';
import { loadActiveCurve, loadWindowSettings } from './rating-engine.js';

export interface RatingSummary {
  tenantId: string;
  /** Today, as a calendar day in `timeZone`. */
  calendarDay: CalendarDayKey;
  timeZone: string;

  status: AgencyRatingStatus;

  /** Today so far. Informational; it prices nothing. */
  today: {
    calendarDay: CalendarDayKey;
    deliveredCalls: number;
    submittedApplications: number;
    /** Null when no calls have been delivered yet today — never 0. */
    closingPct: number | null;
  };

  /** The trailing Delivery Day window that set the rate now in force. */
  ratingWindow: {
    /** Delivery Days asked for. */
    deliveryDays: number;
    /** How many were found. Fewer means a shorter sample, and it is shown. */
    daysFound: number;
    /** The actual days, oldest first, so the agency can reconstruct the window. */
    dayKeys: CalendarDayKey[];
    deliveredCalls: number;
    submittedApplications: number;
    closingPct: number | null;
  };

  /** The rate in force today. Null while under review — not zero. */
  currentRate: number | null;
  currentRateCalendarDay: CalendarDayKey | null;

  /**
   * Where today's performance is heading: the rate the curve would return for
   * the Delivery Day window ending today. Null when it cannot be computed, or
   * when that window is below the curve's minimum — in which case
   * `trackingBelowMinimum` says so rather than the rate quietly reading as null
   * for two different reasons.
   */
  trackingRate: number | null;
  trackingBelowMinimum: boolean;
  /** The Delivery Days `trackingRate` was computed over. */
  trackingDayKeys: CalendarDayKey[];

  curveVersion: number;

  /** The open review flag, if the agency is under review. */
  reviewFlag: {
    id: string;
    raisedAt: Date;
    closingPct: number;
    deliveredCalls: number;
    submittedApplications: number;
  } | null;

  /*
   * There is no `introductory` block, deliberately. Phase 2 showed an
   * introductory rate for an agency's first five applications; Phase 3 removed
   * the concept entirely. What an agency sees before its first settled Delivery
   * Day is `openingBlock`: the rate and block that were agreed and recorded.
   */
  openingBlock: {
    rate: number;
    applications: number | null;
    note: string | null;
  } | null;
}

export async function getRatingSummary(
  tenantId: string,
  options: { prisma?: PrismaClient; now?: Date } = {}
): Promise<RatingSummary> {
  const prisma = options.prisma ?? getPrismaClient();
  const now = options.now ?? new Date();
  const today = currentCalendarDay(now);

  const deps: DeliveryDayDeps = {
    calls: prisma.call,
    applications: prisma.insuranceCarrierApplication,
  };

  const [curve, windowSettings, state, openFlag] = await Promise.all([
    loadActiveCurve(prisma),
    loadWindowSettings(prisma),
    prisma.agencyRatingState.findUnique({ where: { tenantId } }),
    prisma.ratingReviewFlag.findFirst({
      where: { tenantId, clearedAt: null },
      orderBy: { raisedAt: 'desc' },
    }),
  ]);

  const [todayMeasurement, trackingMeasurement] = await Promise.all([
    measureCalendarDay(deps, tenantId, today),
    // The Delivery Day window ending TODAY: what tomorrow's rate is tracking
    // toward. Today counts as a Delivery Day as soon as one call lands, so this
    // becomes a three-day window during the morning rather than after it.
    measureTrailingDeliveryDays(
      deps,
      tenantId,
      today,
      windowSettings.windowDeliveryDays,
      windowSettings.deliveryDayLookback
    ),
  ]);

  /*
   * The window that actually set the current rate is the one the engine used,
   * recorded on the rate change for the current effective day. Recomputing it
   * here from live data would drift the moment a late call landed, and the
   * agency would see a "window percentage" that never matched the row it would
   * be shown in a dispute.
   */
  const appliedChange = state?.currentRateCalendarDay
    ? await prisma.rateChange.findUnique({
        where: {
          tenantId_effectiveCalendarDay: {
            tenantId,
            effectiveCalendarDay: state.currentRateCalendarDay,
          },
        },
      })
    : null;

  const ratingWindow = appliedChange
    ? {
        deliveryDays: appliedChange.windowDeliveryDays,
        daysFound: appliedChange.windowDaysFound,
        dayKeys: appliedChange.windowDayKeys,
        deliveredCalls: appliedChange.deliveredCalls,
        submittedApplications: appliedChange.submittedApplications,
        closingPct:
          appliedChange.closingPct === null ? null : toNumber(appliedChange.closingPct),
      }
    : {
        // Not yet rated. Show the shape of the window that WOULD be used, so
        // the portal never renders an empty box with no explanation.
        deliveryDays: windowSettings.windowDeliveryDays,
        daysFound: 0,
        dayKeys: [] as CalendarDayKey[],
        deliveredCalls: 0,
        submittedApplications: 0,
        closingPct: null,
      };

  let trackingRate: number | null = null;
  let trackingBelowMinimum = false;
  if (trackingMeasurement?.closingPct != null) {
    const verdict = rateFor(curve, trackingMeasurement.closingPct);
    if (verdict.kind === 'BELOW_MINIMUM') {
      trackingBelowMinimum = true;
    } else {
      trackingRate = verdict.rate;
    }
  }

  /*
   * An agency with no rating state row has not been priced at all. It is shown
   * as UNDER_REVIEW rather than as the retired INTRODUCTORY, because the
   * accurate statement is "there is no rate here yet" and INTRODUCTORY would
   * assert a price that no longer exists. Delivery is gated off for the same
   * agency by `NO_OPENING_AGREEMENT`.
   */
  const status = state?.status ?? AgencyRatingStatus.UNDER_REVIEW;

  return {
    tenantId,
    calendarDay: today,
    timeZone: 'America/New_York',
    status,
    today: {
      calendarDay: today,
      deliveredCalls: todayMeasurement.deliveredCalls,
      submittedApplications: todayMeasurement.submittedApplications,
      closingPct: todayMeasurement.closingPct,
    },
    ratingWindow,
    currentRate: resolveCurrentRate(state, status),
    currentRateCalendarDay: state?.currentRateCalendarDay ?? null,
    trackingRate,
    trackingBelowMinimum,
    trackingDayKeys: trackingMeasurement?.window.dayKeys ?? [],
    curveVersion: curve.version,
    reviewFlag: openFlag
      ? {
          id: openFlag.id,
          raisedAt: openFlag.raisedAt,
          closingPct: toNumber(openFlag.closingPct),
          deliveredCalls: openFlag.deliveredCalls,
          submittedApplications: openFlag.submittedApplications,
        }
      : null,
    openingBlock:
      status === AgencyRatingStatus.OPENING_BLOCK && state?.openingRate != null
        ? {
            rate: toNumber(state.openingRate),
            applications: state.openingBlockApplications,
            note: state.openingAgreementNote,
          }
        : null,
  };
}

/**
 * The rate in force, which is not always `state.currentRate`.
 *
 * Under review there is no rate at all — null, never zero, because a zero rate
 * renders as a price and this is the absence of one. On an agreed opening
 * block the rate is the agreed one, because the curve does not govern until the
 * first settled Delivery Day.
 *
 * There is no introductory branch. An agency with no agreed opening rate has no
 * rate, full stop — the curve is never asked to invent one and there is no
 * package to fall back to.
 */
function resolveCurrentRate(
  state: { currentRate: unknown; openingRate: unknown } | null,
  status: AgencyRatingStatus
): number | null {
  if (status === AgencyRatingStatus.UNDER_REVIEW) return null;

  if (status === AgencyRatingStatus.OPENING_BLOCK) {
    return state?.openingRate == null ? null : toNumber(state.openingRate as never);
  }

  return state?.currentRate == null ? null : toNumber(state.currentRate as never);
}
