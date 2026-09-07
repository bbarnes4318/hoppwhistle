/**
 * The Delivery Day: a calendar day on which NetEnroll delivered at least one
 * call to THAT agency.
 *
 * ── What this is for ─────────────────────────────────────────────────────────
 *
 * The rating window, and nothing else. Contractual notice periods are counted
 * in Business Days (`business-day.ts`); those two must never stand in for one
 * another.
 *
 * ── Why the rating window is not calendar days ───────────────────────────────
 *
 * Phase 2 rated over the trailing three calendar days. That is right for an
 * agency taking calls seven days a week and wrong for one that does not: an
 * agency working Monday to Friday would have Monday priced off Saturday and
 * Sunday -- two empty days -- and a third of its denominator would be zero for
 * no reason connected to how it performs. The measured closing percentage over
 * Sat+Sun+Mon is just Monday's, on a third of the sample, with the sampling
 * error that implies. On a curve where a point of closing percentage is worth
 * thirty dollars an application, that is money.
 *
 * The obvious repair -- exclude weekends -- is wrong the other way, for the
 * agency that does work weekends.
 *
 * ── Why it is not a schedule either ──────────────────────────────────────────
 *
 * The definition deliberately does NOT depend on knowing which days an agency
 * works. Asking, and storing the answer, would make the rate depend on a
 * configuration field somebody has to keep true, and a stale one would misprice
 * silently. "A day we delivered at least one call" is observable from the same
 * `calls` rows the closing percentage is already measured from, so it cannot
 * disagree with them and there is nothing to keep up to date.
 *
 * It is right in both directions with one rule:
 *
 *   weekday-only agency   Monday's window is the prior Thursday, Friday and
 *                         Monday. The weekend was not a Delivery Day because
 *                         nothing was delivered on it.
 *   seven-day agency      Monday's window is Saturday, Sunday and Monday.
 *
 * ── It is per agency ─────────────────────────────────────────────────────────
 *
 * Agency A's Delivery Days and agency B's are different sets. Two agencies
 * rated on the same date are rated over different windows, and that is correct:
 * the window is a property of what each was given.
 *
 * ── The window is not contiguous ─────────────────────────────────────────────
 *
 * Thu/Fri/Mon spans a weekend. Anything counting over the window must count
 * PER DAY and sum, never over `[start, endExclusive)`, or the excluded days
 * leak back into the denominator through the span. `measureDeliveryDayWindow`
 * below does it per day for exactly this reason.
 */

import type { PrismaClient } from '@prisma/client';

import { calendarDayBounds, previousCalendarDay, windowOf } from './calendar-day.js';
import type { CalendarDayKey, CalendarDayWindow } from './calendar-day.js';
import { deliveredCallWhere, measureCalendarDay } from './measurement.js';
import type { ClosingMeasurement, MeasurementDeps } from './measurement.js';

/**
 * How far back to look for Delivery Days before giving up.
 *
 * A window of three Delivery Days normally spans three to five calendar days.
 * This bound exists so an agency that stopped taking calls in March does not
 * cause an unbounded scan back through the year; it is not a business rule, and
 * a window that runs short of days is reported as short rather than padded.
 */
export const DEFAULT_DELIVERY_DAY_LOOKBACK = 60;

/**
 * Whether an agency was delivered any call at all on a calendar day.
 *
 * Uses `deliveredCallWhere` verbatim rather than restating the predicate, which
 * is the whole reason this walks day by day instead of issuing one
 * `SELECT DISTINCT date_trunc(...)`. That query would be one round trip instead
 * of up to `lookback`, and it would be a second definition of "delivered call"
 * written in SQL, free to drift from the one in `measurement.ts` that the
 * closing percentage is computed with. Two definitions of the denominator is
 * the failure this whole phase exists to prevent; the round trips are indexed
 * `LIMIT 1` lookups on `(tenantId, answeredAt)` and run twice a day.
 */
async function hadDeliveryOn(
  deps: DeliveryDayDeps,
  tenantId: string,
  day: CalendarDayKey
): Promise<boolean> {
  const row = await deps.calls.findFirst({
    where: deliveredCallWhere(tenantId, calendarDayBounds(day)),
    select: { id: true },
  });
  return row !== null;
}

export interface DeliveryDayDeps extends MeasurementDeps {
  calls: MeasurementDeps['calls'] & Pick<PrismaClient['call'], 'findFirst'>;
}

export interface DeliveryDayWindow extends CalendarDayWindow {
  /** How many Delivery Days were asked for. */
  requested: number;
  /**
   * How many were found. Less than `requested` when the agency has not been
   * delivered calls on that many days within the lookback -- a new agency, or
   * one that has stopped. Reported rather than padded: a window of two days is
   * a smaller sample and the row should say so.
   */
  found: number;
  /** Calendar days searched to find them, for the record. */
  lookbackDays: number;
}

/**
 * The trailing `count` Delivery Days ending on `lastDay` inclusive.
 *
 * `lastDay` itself is included only if it was a Delivery Day. Walks backwards a
 * calendar day at a time, keeping the days that had a delivery, and stops as
 * soon as it has `count` of them or has exhausted the lookback.
 *
 * Returns `null` when the agency has no Delivery Days at all in the lookback --
 * there is no window, which is a different thing from an empty one, and the
 * caller has to say so rather than divide by zero.
 */
export async function trailingDeliveryDays(
  deps: DeliveryDayDeps,
  tenantId: string,
  lastDay: CalendarDayKey,
  count: number,
  lookback: number = DEFAULT_DELIVERY_DAY_LOOKBACK
): Promise<DeliveryDayWindow | null> {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`Delivery Day window must be at least one day, got ${count}`);
  }

  const found: CalendarDayKey[] = [];
  let cursor = lastDay;

  for (let scanned = 0; scanned < lookback && found.length < count; scanned++) {
    if (await hadDeliveryOn(deps, tenantId, cursor)) found.push(cursor);
    cursor = previousCalendarDay(cursor);
  }

  if (found.length === 0) return null;

  return {
    ...windowOf(found),
    requested: count,
    found: found.length,
    lookbackDays: lookback,
  };
}

export interface DeliveryDayMeasurement extends ClosingMeasurement {
  window: DeliveryDayWindow;
}

/**
 * The closing percentage over a Delivery Day window.
 *
 * Summed per day, deliberately. The window is not contiguous -- Thu/Fri/Mon
 * spans a weekend -- so measuring over `[start, endExclusive)` would pull the
 * excluded days back in through the span and put an agency's weekend
 * applications into a window that excluded its weekend calls.
 */
export async function measureDeliveryDayWindow(
  deps: DeliveryDayDeps,
  tenantId: string,
  window: DeliveryDayWindow
): Promise<DeliveryDayMeasurement> {
  const perDay = await Promise.all(
    window.dayKeys.map(day => measureCalendarDay(deps, tenantId, day))
  );

  const deliveredCalls = perDay.reduce((sum, d) => sum + d.deliveredCalls, 0);
  const submittedApplications = perDay.reduce((sum, d) => sum + d.submittedApplications, 0);

  return {
    deliveredCalls,
    submittedApplications,
    closingPct: deliveredCalls > 0 ? (submittedApplications / deliveredCalls) * 100 : null,
    window,
  };
}

/**
 * Find the trailing Delivery Day window and measure it, in one call.
 *
 * Null when the agency has no Delivery Days in the lookback.
 */
export async function measureTrailingDeliveryDays(
  deps: DeliveryDayDeps,
  tenantId: string,
  lastDay: CalendarDayKey,
  count: number,
  lookback: number = DEFAULT_DELIVERY_DAY_LOOKBACK
): Promise<DeliveryDayMeasurement | null> {
  const window = await trailingDeliveryDays(deps, tenantId, lastDay, count, lookback);
  if (!window) return null;
  return measureDeliveryDayWindow(deps, tenantId, window);
}
