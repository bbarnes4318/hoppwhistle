/**
 * What an agency sees about its own rate.
 *
 * Four numbers, and the whole point is that they are not confusable:
 *
 *   todayClosingPct     today so far. Moves all day, prices nothing.
 *   windowClosingPct    the trailing window that ACTUALLY set the current
 *                       rate. This is the number the agency is paid on.
 *   currentRate         dollars per submitted application, today.
 *   trackingRate        what the curve would return if the window ending
 *                       today closed right now — tomorrow's rate, if nothing
 *                       else changes.
 *
 * An agency that mistakes the first for the second thinks its price changed at
 * 10am. An agency that mistakes the fourth for the third thinks it is being
 * paid a rate it is not yet being paid. Both are shaped like a billing dispute,
 * so each is labelled here and rendered distinctly in the portal.
 *
 * Every number is computed server-side from the tenant on the authenticated
 * request. Nothing here accepts a rate, a price or a computed amount from the
 * browser, and there is no parameter that widens the scope beyond one agency.
 */

import type { PrismaClient } from '@prisma/client';
import { AgencyRatingStatus } from '@prisma/client';

import { getPrismaClient } from '../../lib/prisma.js';

import { currentBusinessDay, trailingWindow } from './business-day.js';
import type { BusinessDayKey } from './business-day.js';
import {
  countSubmittedApplicationsLifetime,
  measureBusinessDay,
  measureTrailingWindow,
} from './measurement.js';
import type { MeasurementDeps } from './measurement.js';
import { rateFor, toNumber } from './rate-curve.js';
import { loadActiveCurve, loadWindowBusinessDays } from './rating-engine.js';

export interface RatingSummary {
  tenantId: string;
  businessDay: BusinessDayKey;
  timeZone: string;

  status: AgencyRatingStatus;

  /** Today so far. Informational; it prices nothing. */
  today: {
    businessDay: BusinessDayKey;
    deliveredCalls: number;
    submittedApplications: number;
    /** Null when no calls have been delivered yet today — never 0. */
    closingPct: number | null;
  };

  /** The trailing window that set the rate now in force. */
  ratingWindow: {
    businessDays: number;
    dayKeys: BusinessDayKey[];
    deliveredCalls: number;
    submittedApplications: number;
    closingPct: number | null;
  };

  /** The rate in force today. Null while under review — not zero. */
  currentRate: number | null;
  currentRateBusinessDay: BusinessDayKey | null;

  /**
   * Where today's performance is heading: the rate the curve would return for
   * the window ending today. Null when it cannot be computed, or when today's
   * window is below the curve's minimum — in which case `trackingBelowMinimum`
   * says so rather than the rate quietly reading as null for two reasons.
   */
  trackingRate: number | null;
  trackingBelowMinimum: boolean;

  curveVersion: number;

  /** The open review flag, if the agency is under review. */
  reviewFlag: {
    id: string;
    raisedAt: Date;
    closingPct: number;
    deliveredCalls: number;
    submittedApplications: number;
  } | null;

  /** The opening package, while it still applies. */
  introductory: {
    rate: number;
    applications: number;
    applicationsUsed: number;
  } | null;

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
  const today = currentBusinessDay(now);

  const deps: MeasurementDeps = {
    calls: prisma.call,
    applications: prisma.insuranceCarrierApplication,
  };

  const [curve, windowBusinessDays, state, openFlag] = await Promise.all([
    loadActiveCurve(prisma),
    loadWindowBusinessDays(prisma),
    prisma.agencyRatingState.findUnique({ where: { tenantId } }),
    prisma.ratingReviewFlag.findFirst({
      where: { tenantId, clearedAt: null },
      orderBy: { raisedAt: 'desc' },
    }),
  ]);

  const [todayMeasurement, trackingMeasurement, lifetimeApplications] = await Promise.all([
    measureBusinessDay(deps, tenantId, today),
    // The window ending TODAY: what tomorrow's rate is tracking toward.
    measureTrailingWindow(deps, tenantId, today, windowBusinessDays),
    // Counted live rather than read off the state row, so the portal shows the
    // truth between rating runs rather than the count as of the last one.
    countSubmittedApplicationsLifetime(deps, tenantId),
  ]);

  /*
   * The window that actually set the current rate is the one the engine used,
   * recorded on the rate change for the current effective day. Recomputing it
   * here from live data would drift the moment a late call landed, and the
   * agency would see a "window percentage" that never matched the row it would
   * be shown in a dispute.
   */
  const appliedChange = state?.currentRateBusinessDay
    ? await prisma.rateChange.findUnique({
        where: {
          tenantId_effectiveBusinessDay: {
            tenantId,
            effectiveBusinessDay: state.currentRateBusinessDay,
          },
        },
      })
    : null;

  const ratingWindow = appliedChange
    ? {
        businessDays: appliedChange.windowBusinessDays,
        dayKeys: appliedChange.windowDayKeys,
        deliveredCalls: appliedChange.deliveredCalls,
        submittedApplications: appliedChange.submittedApplications,
        closingPct:
          appliedChange.closingPct === null ? null : toNumber(appliedChange.closingPct),
      }
    : {
        // Not yet rated. Show the window that WOULD be used, with its shape, so
        // the portal never renders an empty box with no explanation.
        businessDays: windowBusinessDays,
        dayKeys: trailingWindow(today, windowBusinessDays).dayKeys,
        deliveredCalls: 0,
        submittedApplications: 0,
        closingPct: null,
      };

  let trackingRate: number | null = null;
  let trackingBelowMinimum = false;
  if (trackingMeasurement.closingPct !== null) {
    const verdict = rateFor(curve, trackingMeasurement.closingPct);
    if (verdict.kind === 'BELOW_MINIMUM') {
      trackingBelowMinimum = true;
    } else {
      trackingRate = verdict.rate;
    }
  }

  const status = state?.status ?? AgencyRatingStatus.INTRODUCTORY;

  return {
    tenantId,
    businessDay: today,
    timeZone: 'America/New_York',
    status,
    today: {
      businessDay: today,
      deliveredCalls: todayMeasurement.deliveredCalls,
      submittedApplications: todayMeasurement.submittedApplications,
      closingPct: todayMeasurement.closingPct,
    },
    ratingWindow,
    currentRate: resolveCurrentRate(state, curve.introductoryRate, status),
    currentRateBusinessDay: state?.currentRateBusinessDay ?? null,
    trackingRate,
    trackingBelowMinimum,
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
    introductory:
      status === AgencyRatingStatus.INTRODUCTORY
        ? {
            rate: curve.introductoryRate,
            applications: curve.introductoryApplications,
            applicationsUsed: lifetimeApplications,
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
 * renders as a price and this is the absence of one. On the introductory
 * package or an agreed opening block, the rate is that package's, because daily
 * rating has not started.
 */
function resolveCurrentRate(
  state: { currentRate: unknown; openingRate: unknown } | null,
  introductoryRate: number,
  status: AgencyRatingStatus
): number | null {
  if (status === AgencyRatingStatus.UNDER_REVIEW) return null;

  if (status === AgencyRatingStatus.OPENING_BLOCK) {
    return state?.openingRate == null ? null : toNumber(state.openingRate as never);
  }

  if (status === AgencyRatingStatus.INTRODUCTORY) {
    return state?.currentRate == null ? introductoryRate : toNumber(state.currentRate as never);
  }

  return state?.currentRate == null ? null : toNumber(state.currentRate as never);
}
