/**
 * Every agency's rate, side by side.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * `/rating` answers one agency's question -- what am I paying, and what is it
 * tracking toward. NetEnroll staff have the same question about the whole
 * platform, and before this they could only answer it one agency at a time by
 * entering each in turn. So a platform admin with no acting tenant lands here
 * rather than on a prompt to pick somebody.
 *
 * Three columns and they are deliberately the three that move together: the
 * closing percentage the agency is producing, the rate it is being charged
 * today, and the rate that percentage is tracking toward. Reading them in one
 * row is what makes the curve legible -- an agency at 12% paying $149 and
 * tracking $144 is improving, and one paying $144 and tracking $159 is not.
 *
 * ── The rate includes the offset, here as everywhere ─────────────────────────
 *
 * `currentRate` and `trackingRate` are EFFECTIVE rates: the curve's answer plus
 * the agency's recorded rate offset. `curveRate` and `rateOffset` are reported
 * beside them so the two halves are visible, because an operator comparing two
 * agencies at the same closing percentage needs to see why they are paying
 * different prices. Nothing here is itemised as a fee: the offset is part of
 * the price.
 *
 * ── One agency's figures never come from another's ───────────────────────────
 *
 * Every row is measured per tenant. There is no pooled percentage and no
 * cross-tenant denominator anywhere in this file.
 */

import type { PrismaClient } from '@prisma/client';
import { AgencyRatingStatus } from '@prisma/client';

import { getPrismaClient } from '../../lib/prisma.js';

import { currentCalendarDay } from './calendar-day.js';
import type { CalendarDayKey } from './calendar-day.js';
import { measureTrailingDeliveryDays } from './delivery-day.js';
import type { DeliveryDayDeps } from './delivery-day.js';
import { measureCalendarDay } from './measurement.js';
import { effectiveRate, rateFor, toNumber } from './rate-curve.js';
import { loadActiveCurve, loadWindowSettings } from './rating-engine.js';

export interface PlatformRatingRow {
  tenantId: string;
  name: string;
  slug: string;
  isNonProduction: boolean;

  status: AgencyRatingStatus;

  /** Today so far. Moves all day and prices nothing. */
  todayClosingPct: number | null;
  todayDeliveredCalls: number;
  todaySubmittedApplications: number;

  /** The trailing Delivery Day window that ACTUALLY set the rate in force. */
  windowClosingPct: number | null;
  windowDayKeys: CalendarDayKey[];
  windowDaysFound: number;

  /** What the agency is charged today. Effective: curve rate plus its offset. */
  currentRate: number | null;
  /** The curve's own answer for the rate in force, when the curve set it. */
  curveRate: number | null;
  /** The agency's rate offset, in dollars. Zero for most agencies. */
  rateOffset: number;

  /**
   * What tomorrow is tracking toward, if today closed now. Provisional, and
   * effective -- the offset applies to it too.
   */
  trackingRate: number | null;
  /** True when the tracking window is below the curve's minimum: no rate. */
  trackingBelowMinimum: boolean;
  trackingClosingPct: number | null;

  /** True when there is an open review flag. No rate while it is open. */
  underReview: boolean;
}

/**
 * One row per agency, for the day named.
 *
 * `tenantId` narrows to one agency -- it is the acting tenant a platform admin
 * selected, resolved from their session by the route, never a tenant named in a
 * query string.
 */
export async function getPlatformRatingOverview(
  options: {
    prisma?: PrismaClient;
    now?: Date;
    includeNonProduction?: boolean;
    tenantId?: string;
  } = {}
): Promise<{
  calendarDay: CalendarDayKey;
  timeZone: string;
  curveVersion: number;
  agencies: PlatformRatingRow[];
  includingNonProduction: boolean;
}> {
  const prisma = options.prisma ?? getPrismaClient();
  const now = options.now ?? new Date();
  const today = currentCalendarDay(now);
  const includeNonProduction = options.includeNonProduction === true;

  const [curve, windowSettings, tenants] = await Promise.all([
    loadActiveCurve(prisma),
    loadWindowSettings(prisma),
    prisma.tenant.findMany({
      where: {
        status: 'ACTIVE',
        ...(options.tenantId ? { id: options.tenantId } : {}),
        ...(includeNonProduction ? {} : { isNonProduction: false }),
      },
      select: { id: true, name: true, slug: true, isNonProduction: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const deps: DeliveryDayDeps = {
    calls: prisma.call,
    applications: prisma.insuranceCarrierApplication,
  };

  /*
   * The tenants run together. Their figures are independent -- no agency's
   * percentage is derived from another's traffic -- and a sequential walk would
   * be five round trips per tenant awaited before the next tenant started.
   */
  const agencies = await Promise.all(
    tenants.map(async (tenant): Promise<PlatformRatingRow> => {
      const [state, openFlag, todayMeasurement, tracking, profile] = await Promise.all([
        prisma.agencyRatingState.findUnique({ where: { tenantId: tenant.id } }),
        prisma.ratingReviewFlag.findFirst({
          where: { tenantId: tenant.id, clearedAt: null },
          select: { id: true },
        }),
        measureCalendarDay(deps, tenant.id, today),
        measureTrailingDeliveryDays(
          deps,
          tenant.id,
          today,
          windowSettings.windowDeliveryDays,
          windowSettings.deliveryDayLookback
        ),
        prisma.agencyBillingProfile.findUnique({
          where: { tenantId: tenant.id },
          select: { rateOffset: true },
        }),
      ]);

      /*
       * The window that ACTUALLY set the rate in force is the one the engine
       * used, recorded on the rate change for the current effective day.
       * Recomputing it here would drift the moment a late call landed, and the
       * platform view would show a percentage that never matched the row an
       * agency would be shown in a dispute.
       */
      const appliedChange = state?.currentRateCalendarDay
        ? await prisma.rateChange.findUnique({
            where: {
              tenantId_effectiveCalendarDay: {
                tenantId: tenant.id,
                effectiveCalendarDay: state.currentRateCalendarDay,
              },
            },
          })
        : null;

      /*
       * The offset for the TRACKING rate is the agency's current one, because
       * tracking is a projection of what tomorrow would cost and tomorrow uses
       * whatever offset is in force then. The offset shown beside the CURRENT
       * rate is the one recorded on the rate change that set it -- what the
       * agency is actually being charged with, not what it would be charged
       * with if it were repriced today.
       */
      const currentOffset =
        appliedChange?.rateOffset == null ? 0 : toNumber(appliedChange.rateOffset);
      const liveOffset = profile?.rateOffset == null ? 0 : toNumber(profile.rateOffset);

      let trackingRate: number | null = null;
      let trackingBelowMinimum = false;
      if (tracking?.closingPct != null) {
        const verdict = rateFor(curve, tracking.closingPct);
        if (verdict.kind === 'BELOW_MINIMUM') trackingBelowMinimum = true;
        else trackingRate = effectiveRate(verdict.rate, liveOffset);
      }

      const status = state?.status ?? AgencyRatingStatus.UNDER_REVIEW;

      return {
        tenantId: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        isNonProduction: tenant.isNonProduction,
        status,
        todayClosingPct: todayMeasurement.closingPct,
        todayDeliveredCalls: todayMeasurement.deliveredCalls,
        todaySubmittedApplications: todayMeasurement.submittedApplications,
        windowClosingPct:
          appliedChange?.closingPct == null ? null : toNumber(appliedChange.closingPct),
        windowDayKeys: appliedChange?.windowDayKeys ?? [],
        windowDaysFound: appliedChange?.windowDaysFound ?? 0,
        /*
         * The rate in force. Under review there is no rate at all -- null,
         * never zero, because a zero renders as a price and this is the absence
         * of one. On an agreed opening block the agreed rate stands until the
         * first settled Delivery Day, which is the same rule
         * `rating-summary.ts` applies to an agency's own view.
         */
        currentRate:
          status === AgencyRatingStatus.UNDER_REVIEW
            ? null
            : status === AgencyRatingStatus.OPENING_BLOCK
              ? state?.openingRate == null
                ? null
                : toNumber(state.openingRate)
              : state?.currentRate == null
                ? null
                : toNumber(state.currentRate),
        curveRate: appliedChange?.curveRate == null ? null : toNumber(appliedChange.curveRate),
        rateOffset: appliedChange ? currentOffset : liveOffset,
        trackingRate,
        trackingBelowMinimum,
        trackingClosingPct: tracking?.closingPct ?? null,
        underReview: openFlag !== null || status === AgencyRatingStatus.UNDER_REVIEW,
      };
    })
  );

  return {
    calendarDay: today,
    timeZone: 'America/New_York',
    curveVersion: curve.version,
    agencies,
    includingNonProduction: includeNonProduction,
  };
}
