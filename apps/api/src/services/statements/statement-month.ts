/**
 * Statement months: `YYYY-MM` labels for America/New_York calendar months, and
 * the instants they run between.
 *
 * Built on `calendar-day.ts` and `period.ts`, like every other span in the
 * product, so the month on a statement is the month on Sales and Reports.
 */

import { resolvePeriod, type ResolvedPeriod } from '../leaderboard/period.js';
import { calendarDayOf, currentCalendarDay } from '../rating/calendar-day.js';

export type StatementMonth = string;

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isStatementMonth(value: unknown): value is StatementMonth {
  return typeof value === 'string' && MONTH_PATTERN.test(value);
}

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The month a calendar day or instant falls in, New York time. */
export function monthOf(instant: Date): StatementMonth {
  return calendarDayOf(instant).slice(0, 7);
}

/** This month, New York time. */
export function currentMonth(now: Date = new Date()): StatementMonth {
  return currentCalendarDay(now).slice(0, 7);
}

/** The month before `month`. */
export function previousMonth(month: StatementMonth): StatementMonth {
  const [year, mm] = month.split('-').map(Number);
  return mm === 1 ? `${year - 1}-12` : `${year}-${String(mm - 1).padStart(2, '0')}`;
}

/** The month after `month`. */
export function nextMonth(month: StatementMonth): StatementMonth {
  const [year, mm] = month.split('-').map(Number);
  return mm === 12 ? `${year + 1}-01` : `${year}-${String(mm + 1).padStart(2, '0')}`;
}

/** "August 2026". */
export function monthLabel(month: StatementMonth): string {
  const [year, mm] = month.split('-').map(Number);
  return new Date(Date.UTC(year, mm - 1, 1)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * The month as a resolved period: its first day to its last, or to today for
 * the month still running (the live "Month to date" statement).
 */
export function monthPeriod(month: StatementMonth, now: Date = new Date()): ResolvedPeriod {
  const [year, mm] = month.split('-').map(Number);
  const from = `${month}-01`;
  const last = `${month}-${String(daysIn(year, mm)).padStart(2, '0')}`;
  const today = currentCalendarDay(now);
  const to = last > today && from <= today ? today : last;
  return resolvePeriod('CUSTOM', { from, to, now });
}

/**
 * The UTC calendar month, which is how `number_charges` reckons its months
 * (`services/numbers/number-charges.ts`): a charge belongs to the month its
 * `periodStart` falls in.
 */
export function utcMonthBounds(month: StatementMonth): { start: Date; endExclusive: Date } {
  const [year, mm] = month.split('-').map(Number);
  return {
    start: new Date(Date.UTC(year, mm - 1, 1)),
    endExclusive: new Date(Date.UTC(year, mm, 1)),
  };
}
