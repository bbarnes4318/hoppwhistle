/**
 * The Business Day: Monday to Friday, excluding US federal holidays, in
 * America/New_York.
 *
 * ── What this is for, and what it is NOT for ─────────────────────────────────
 *
 * Every contractual notice period in the signed agreement is counted in
 * Business Days:
 *
 *   - the settlement dispute window (5)
 *   - the delivery window (30)
 *   - the grace period on failed settlement (5)
 *
 * It is NOT the rating window. The rating window is counted in Delivery Days --
 * see `delivery-day.ts` -- and the two must never stand in for one another.
 *
 * ── Why this exists as its own module ────────────────────────────────────────
 *
 * Phase 2 read "business day" as "calendar day" for the rating window and wrote
 * that down as an assumption. The reading is defensible for rating and wrong
 * for everything else, because the term is doing four jobs and calendar days
 * silently SHORTEN all of them. A five-day dispute window opened on a Thursday
 * expires on the following Wednesday; read as calendar days it expires on
 * Monday, and the agency loses two days of a right it was granted in writing.
 * Nobody would see that happen: the shorter deadline is not an error message,
 * it is just an earlier date.
 *
 * So the term now means one thing, here, and the rating window does not use it.
 *
 * ── Inclusive counting ───────────────────────────────────────────────────────
 *
 * `businessDayPeriodEnd(start, n)` counts the START DAY as day 1. A five
 * Business Day period beginning Thursday is Thu, Fri, Mon, Tue, Wed and ends on
 * the Wednesday. `addBusinessDays(day, n)` is the other reading -- n Business
 * Days AFTER `day`, exclusive of it -- because "within 5 business days of
 * notice" and "a 5 business day period beginning on notice" are different
 * sentences and both appear in commercial writing. Naming them separately is
 * the point: a single ambiguous helper is how the off-by-one gets in.
 *
 * ── Holidays ─────────────────────────────────────────────────────────────────
 *
 * The eleven US federal holidays (5 U.S.C. 6103), including the OBSERVED day:
 * a fixed-date holiday falling on a Saturday is observed the preceding Friday,
 * and one falling on a Sunday the following Monday. The observed day is the one
 * offices are shut, so the observed day is the one that is not a Business Day.
 *
 * Computed rather than tabulated, so this does not quietly expire at the end of
 * a hardcoded list of years.
 */

import { calendarDayOf, dayOfWeek, shiftCalendarDay } from './calendar-day.js';
import type { CalendarDayKey } from './calendar-day.js';

/** The Business Day counts a contract can be written in. Not rating. */
export const CONTRACT_PERIODS = {
  /**
   * An agency has this many Business Days to dispute a settlement.
   * Phase 3 enforces it; the definition lives here so Phase 3 cannot reinvent
   * it as calendar days.
   */
  SETTLEMENT_DISPUTE_BUSINESS_DAYS: 5,
  /** The delivery window, in Business Days. */
  DELIVERY_BUSINESS_DAYS: 30,
  /** Grace period after a failed settlement, in Business Days. */
  SETTLEMENT_GRACE_BUSINESS_DAYS: 5,
} as const;

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

function key(year: number, month: number, day: number): CalendarDayKey {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** The nth (1-based) `weekday` of a month, e.g. the 3rd Monday of January. */
function nthWeekdayOf(year: number, month: number, weekday: number, n: number): CalendarDayKey {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const offset = (weekday - firstWeekday + 7) % 7;
  return key(year, month, 1 + offset + (n - 1) * 7);
}

/** The last `weekday` of a month, e.g. the last Monday of May. */
function lastWeekdayOf(year: number, month: number, weekday: number): CalendarDayKey {
  const lastDate = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const lastWeekday = new Date(Date.UTC(year, month - 1, lastDate)).getUTCDay();
  return key(year, month, lastDate - ((lastWeekday - weekday + 7) % 7));
}

/**
 * The observed date of a fixed-date holiday.
 *
 * 5 U.S.C. 6103(b): Saturday is observed the preceding Friday, Sunday the
 * following Monday. Without this, Independence Day 2026 (a Saturday) would
 * count as a working day and Friday the 3rd -- when the offices are actually
 * shut -- would not.
 */
function observed(dayKey: CalendarDayKey): CalendarDayKey {
  const weekday = dayOfWeek(dayKey);
  if (weekday === 6) return shiftCalendarDay(dayKey, -1); // Saturday -> Friday
  if (weekday === 0) return shiftCalendarDay(dayKey, 1); // Sunday -> Monday
  return dayKey;
}

const SUNDAY = 0;
const MONDAY = 1;
const THURSDAY = 4;

/**
 * The eleven US federal holidays for a year, as OBSERVED.
 *
 * Cached per year: this is called once per candidate day while walking a
 * period, and the answer for a year never changes.
 */
const holidayCache = new Map<number, Set<CalendarDayKey>>();

export function usFederalHolidays(year: number): ReadonlySet<CalendarDayKey> {
  const cached = holidayCache.get(year);
  if (cached) return cached;

  const days = new Set<CalendarDayKey>([
    observed(key(year, 1, 1)), // New Year's Day
    nthWeekdayOf(year, 1, MONDAY, 3), // Martin Luther King, Jr. Day
    nthWeekdayOf(year, 2, MONDAY, 3), // Washington's Birthday
    lastWeekdayOf(year, 5, MONDAY), // Memorial Day
    observed(key(year, 6, 19)), // Juneteenth
    observed(key(year, 7, 4)), // Independence Day
    nthWeekdayOf(year, 9, MONDAY, 1), // Labor Day
    nthWeekdayOf(year, 10, MONDAY, 2), // Columbus Day
    observed(key(year, 11, 11)), // Veterans Day
    nthWeekdayOf(year, 11, THURSDAY, 4), // Thanksgiving
    observed(key(year, 12, 25)), // Christmas Day
  ]);

  holidayCache.set(year, days);
  return days;
}

/** Whether a calendar day is a Business Day. */
export function isBusinessDay(dayKey: CalendarDayKey): boolean {
  const weekday = dayOfWeek(dayKey);
  if (weekday === SUNDAY || weekday === 6) return false;

  // New Year's Day observed on a Friday belongs to the PREVIOUS year's set
  // (1 Jan 2027 is a Friday; 1 Jan 2028 is a Saturday, observed Fri 31 Dec
  // 2027). Checking both years costs nothing and closes that edge.
  const year = Number(dayKey.slice(0, 4));
  return !usFederalHolidays(year).has(dayKey) && !usFederalHolidays(year + 1).has(dayKey);
}

/** The next Business Day strictly after `dayKey`. */
export function nextBusinessDay(dayKey: CalendarDayKey): CalendarDayKey {
  let cursor = shiftCalendarDay(dayKey, 1);
  // Bounded so a bug in `isBusinessDay` is a thrown error rather than a hang.
  // The longest possible run of non-Business Days is a holiday-flanked weekend;
  // 30 is far beyond it.
  for (let i = 0; i < 30; i++) {
    if (isBusinessDay(cursor)) return cursor;
    cursor = shiftCalendarDay(cursor, 1);
  }
  throw new Error(`No Business Day found within 30 days of ${dayKey}`);
}

/** The Business Day on or after `dayKey`. */
export function businessDayOnOrAfter(dayKey: CalendarDayKey): CalendarDayKey {
  return isBusinessDay(dayKey) ? dayKey : nextBusinessDay(dayKey);
}

/**
 * `count` Business Days AFTER `dayKey`, exclusive of `dayKey` itself.
 *
 * The "within N business days of X" reading. `addBusinessDays(thursday, 5)` is
 * the following Thursday.
 */
export function addBusinessDays(dayKey: CalendarDayKey, count: number): CalendarDayKey {
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`Business day count must be a non-negative whole number, got ${count}`);
  }
  let cursor = dayKey;
  for (let i = 0; i < count; i++) cursor = nextBusinessDay(cursor);
  return cursor;
}

/**
 * The last day of a period of `length` Business Days beginning on `startDay`,
 * counting `startDay` as day 1.
 *
 * A five Business Day period beginning Thursday is Thu, Fri, Mon, Tue, Wed and
 * ends on the Wednesday -- not the Monday a calendar-day count would give.
 *
 * If `startDay` is not itself a Business Day the period begins on the next one,
 * because a notice period cannot start on a day nobody is at work.
 */
export function businessDayPeriodEnd(
  startDay: CalendarDayKey,
  length: number
): CalendarDayKey {
  if (!Number.isInteger(length) || length < 1) {
    throw new Error(`A Business Day period must be at least one day, got ${length}`);
  }
  return addBusinessDays(businessDayOnOrAfter(startDay), length - 1);
}

/** Every Business Day in `[from, to]` inclusive, oldest first. */
export function businessDaysBetween(
  from: CalendarDayKey,
  to: CalendarDayKey
): CalendarDayKey[] {
  if (from > to) return [];
  const days: CalendarDayKey[] = [];
  let cursor = from;
  while (cursor <= to) {
    if (isBusinessDay(cursor)) days.push(cursor);
    cursor = shiftCalendarDay(cursor, 1);
  }
  return days;
}

/** The Business Day an instant falls in, or the next one if it falls outside. */
export function businessDayOf(instant: Date): CalendarDayKey {
  return businessDayOnOrAfter(calendarDayOf(instant));
}
