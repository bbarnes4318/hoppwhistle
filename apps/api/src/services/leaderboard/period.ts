/**
 * The periods the leaderboard can be read over, resolved in the platform's own
 * clock.
 *
 * ── Why the browser does not get to decide what "today" is ───────────────────
 *
 * Every other range picker in this product computes its dates in the BROWSER's
 * timezone. `/delivery/team` does it in so many words: `new Date()`, then
 * `getFullYear()/getMonth()/getDate()`. For an agency whose agents all sit in
 * New York that is invisible; for one with an agent in Los Angeles it is wrong
 * for three hours of every evening. At 21:30 in Los Angeles it is already
 * tomorrow in New York, so "Today" on that agent's screen asks the server for
 * yesterday -- and the server, which reckons every day in `PLATFORM_TIME_ZONE`,
 * answers correctly for the day it was asked about. The agent sees an empty
 * board and concludes the product lost their calls.
 *
 * So the client sends a NAME -- `THIS_WEEK` -- and the server resolves it. The
 * resolved `from` and `to` come back with the answer and the screen renders
 * those, which means what the agency reads and what was measured cannot
 * disagree. The custom picker is the one place a caller names dates, and those
 * are calendar-day LABELS (`YYYY-MM-DD`), not instants, so there is nothing in
 * them for a timezone to shift.
 *
 * ── One day boundary, and it is not defined here ─────────────────────────────
 *
 * Nothing in this file knows what timezone the platform reckons days in.
 * `calendar-day.ts` owns that and says, at length, that nothing else may
 * introduce a second assumption. Everything here is arithmetic on `YYYY-MM-DD`
 * LABELS -- which month a day is in, which week it starts, how many days a
 * month has -- and the one conversion to instants goes through
 * `calendarDayBounds`. Adding a month is not a timezone question, and treating
 * it as one is how a second assumption gets in.
 *
 * ── The week starts on Sunday ────────────────────────────────────────────────
 *
 * Stated because it is a convention, not a fact, and a leaderboard read on a
 * Monday morning shows a different set of people depending on the answer. US
 * call-centre weeks run Sunday to Saturday and the agencies on this platform
 * are US insurance floors, so `THIS_WEEK` on a Monday holds yesterday's
 * production. `dayOfWeek` already returns 0 for Sunday, so the arithmetic is
 * the identity.
 */

import {
  type CalendarDayKey,
  calendarDayBounds,
  currentCalendarDay,
  dayOfWeek,
  shiftCalendarDay,
} from '../rating/calendar-day.js';

/**
 * The named periods. `CUSTOM` is the calendar picker, and is the only one that
 * reads dates from the caller.
 */
export const PERIOD_KEYS = [
  'TODAY',
  'YESTERDAY',
  'THIS_WEEK',
  'LAST_WEEK',
  'THIS_MONTH',
  'LAST_MONTH',
  'THIS_YEAR',
  'LAST_YEAR',
  'CUSTOM',
] as const;

export type LeaderboardPeriodKey = (typeof PERIOD_KEYS)[number];

export function isPeriodKey(value: unknown): value is LeaderboardPeriodKey {
  return typeof value === 'string' && (PERIOD_KEYS as readonly string[]).includes(value);
}

export interface ResolvedPeriod {
  key: LeaderboardPeriodKey;
  /** What the screen calls it. Sent with the answer so both agree. */
  label: string;
  /** Inclusive first calendar day. */
  from: CalendarDayKey;
  /** Inclusive last calendar day. */
  to: CalendarDayKey;
  /** Inclusive day count. */
  days: number;
  /**
   * True when the last day of the period has fully closed.
   *
   * The whole board branches on this. An OPEN period is being compared against
   * a closed one, so a signed change in applications or premium against the
   * previous period is guaranteed to read as a fall right up until the last
   * hour -- a number that is arithmetically correct and tells the reader
   * nothing except what time it is. Rank survives the comparison because both
   * sides are ranked within their own period; absolute totals do not, and the
   * board only computes them when this is true.
   */
  complete: boolean;
  /** First instant of `from`. */
  start: Date;
  /** First instant of the day after `to`. */
  endExclusive: Date;
}

/* ── Label arithmetic ──────────────────────────────────────────────────────── */

function parts(key: CalendarDayKey): { year: number; month: number; day: number } {
  const [year, month, day] = key.split('-').map(Number);
  return { year, month, day };
}

function key(year: number, month: number, day: number): CalendarDayKey {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(
    2,
    '0'
  )}`;
}

/** Days in a month. `Date.UTC(y, m, 0)` is the last day of month `m`. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The first day of the month `key` falls in. */
function firstOfMonth(day: CalendarDayKey): CalendarDayKey {
  const { year, month } = parts(day);
  return key(year, month, 1);
}

/** The last day of the month `key` falls in. */
function lastOfMonth(day: CalendarDayKey): CalendarDayKey {
  const { year, month } = parts(day);
  return key(year, month, daysInMonth(year, month));
}

/**
 * The same day-of-month `offset` months away, clamped to the target month's
 * length. Only ever called on the FIRST of a month here, where clamping cannot
 * bite; it is written to handle the general case anyway so a later caller does
 * not discover that March 31st minus one month is March 3rd.
 */
function shiftMonth(day: CalendarDayKey, offset: number): CalendarDayKey {
  const { year, month, day: d } = parts(day);
  const zeroBased = year * 12 + (month - 1) + offset;
  const targetYear = Math.floor(zeroBased / 12);
  const targetMonth = (zeroBased % 12) + 1;
  return key(targetYear, targetMonth, Math.min(d, daysInMonth(targetYear, targetMonth)));
}

/** The Sunday on or before `day`. */
function startOfWeek(day: CalendarDayKey): CalendarDayKey {
  return shiftCalendarDay(day, -dayOfWeek(day));
}

/** Inclusive day count between two calendar days. */
export function daysBetween(from: CalendarDayKey, to: CalendarDayKey): number {
  const a = parts(from);
  const b = parts(to);
  const start = Date.UTC(a.year, a.month - 1, a.day);
  const end = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((end - start) / 86_400_000) + 1;
}

/* ── Resolution ────────────────────────────────────────────────────────────── */

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class PeriodError extends Error {}

export interface ResolveOptions {
  now?: Date;
  /** Required for `CUSTOM`, ignored otherwise. */
  from?: string;
  to?: string;
}

/**
 * Turn a period name into the two calendar days it covers.
 *
 * Throws `PeriodError` rather than falling back to a default range: a picker
 * that silently shows a different week from the one asked for is worse than an
 * error, on a screen people compare each other's numbers on.
 */
export function resolvePeriod(
  periodKey: LeaderboardPeriodKey,
  options: ResolveOptions = {}
): ResolvedPeriod {
  const now = options.now ?? new Date();
  const today = currentCalendarDay(now);

  const span = ((): { from: CalendarDayKey; to: CalendarDayKey; label: string } => {
    switch (periodKey) {
      case 'TODAY':
        return { from: today, to: today, label: 'Today' };

      case 'YESTERDAY': {
        const yesterday = shiftCalendarDay(today, -1);
        return { from: yesterday, to: yesterday, label: 'Yesterday' };
      }

      case 'THIS_WEEK': {
        /*
         * Ends TODAY, not on Saturday. A week that ran to its own last day
         * would append days that have not happened, and every per-day figure
         * derived from the span -- applications per day, calls per day --
         * would be divided by a denominator counting the future.
         */
        return { from: startOfWeek(today), to: today, label: 'This week' };
      }

      case 'LAST_WEEK': {
        const lastSunday = shiftCalendarDay(startOfWeek(today), -7);
        return { from: lastSunday, to: shiftCalendarDay(lastSunday, 6), label: 'Last week' };
      }

      case 'THIS_MONTH':
        return { from: firstOfMonth(today), to: today, label: 'This month' };

      case 'LAST_MONTH': {
        const first = shiftMonth(firstOfMonth(today), -1);
        return { from: first, to: lastOfMonth(first), label: 'Last month' };
      }

      case 'THIS_YEAR': {
        const { year } = parts(today);
        return { from: key(year, 1, 1), to: today, label: 'This year' };
      }

      case 'LAST_YEAR': {
        const { year } = parts(today);
        return { from: key(year - 1, 1, 1), to: key(year - 1, 12, 31), label: 'Last year' };
      }

      case 'CUSTOM': {
        const { from, to } = options;
        for (const [name, value] of [
          ['from', from],
          ['to', to],
        ] as const) {
          if (value === undefined || !DAY_PATTERN.test(value)) {
            throw new PeriodError(`${name} must be YYYY-MM-DD`);
          }
        }
        /*
         * Refused rather than silently swapped, for the same reason
         * `/delivery/agents/range` refuses it: a reversed range is a caller
         * bug, and quietly answering for the days they did not ask for hides
         * it.
         */
        if ((from as string) > (to as string)) {
          throw new PeriodError('from must not be after to');
        }
        return { from: from as string, to: to as string, label: `${from} → ${to}` };
      }
    }
  })();

  return {
    key: periodKey,
    label: span.label,
    from: span.from,
    to: span.to,
    days: daysBetween(span.from, span.to),
    // The period has closed only once its last day is behind today. A custom
    // range ending in the future is open by the same rule.
    complete: span.to < today,
    start: calendarDayBounds(span.from).start,
    endExclusive: calendarDayBounds(span.to).endExclusive,
  };
}

/**
 * The period this one is read against.
 *
 * ── Like for like, not "the N days before" ───────────────────────────────────
 *
 * The naive previous period is "the same number of days, immediately before",
 * and it is wrong for every calendar unit. The 28 days before a 31-day March
 * are not February; they are the 1st of February to the 28th, which is
 * February minus its last day. A month-on-month comparison that quietly drops
 * days is a comparison nobody can check.
 *
 * So each named period steps back by its OWN unit -- a week back for a week, a
 * month back for a month -- and only `CUSTOM`, which has no unit, falls back to
 * the equal-length span immediately before it.
 *
 * ── An open period is compared against a whole closed one ────────────────────
 *
 * `THIS_WEEK` on a Tuesday covers three days and its previous period is the
 * whole of last week, all seven. That is deliberate and it is why
 * `ResolvedPeriod.complete` exists: RANK movement between the two is
 * meaningful, because each side is ranked within itself, and a signed
 * difference in totals is not. The board shows the first always and the second
 * only when this period has closed.
 */
export function previousPeriodOf(
  period: ResolvedPeriod,
  options: { now?: Date } = {}
): ResolvedPeriod {
  const now = options.now ?? new Date();

  switch (period.key) {
    case 'TODAY':
      return resolvePeriod('YESTERDAY', { now });

    case 'THIS_WEEK':
      return resolvePeriod('LAST_WEEK', { now });

    case 'THIS_MONTH':
      return resolvePeriod('LAST_MONTH', { now });

    case 'THIS_YEAR':
      return resolvePeriod('LAST_YEAR', { now });

    case 'YESTERDAY': {
      const day = shiftCalendarDay(period.from, -1);
      return resolvePeriod('CUSTOM', { now, from: day, to: day });
    }

    case 'LAST_WEEK': {
      const from = shiftCalendarDay(period.from, -7);
      return resolvePeriod('CUSTOM', { now, from, to: shiftCalendarDay(from, 6) });
    }

    case 'LAST_MONTH': {
      const from = shiftMonth(period.from, -1);
      return resolvePeriod('CUSTOM', { now, from, to: lastOfMonth(from) });
    }

    case 'LAST_YEAR': {
      const { year } = parts(period.from);
      return resolvePeriod('CUSTOM', {
        now,
        from: key(year - 1, 1, 1),
        to: key(year - 1, 12, 31),
      });
    }

    case 'CUSTOM': {
      // No unit to step back by, so an equal-length span ending the day before.
      const to = shiftCalendarDay(period.from, -1);
      return resolvePeriod('CUSTOM', { now, from: shiftCalendarDay(to, -(period.days - 1)), to });
    }
  }
}
