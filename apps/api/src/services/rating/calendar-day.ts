/**
 * The calendar day, in the one timezone this platform reckons days in.
 *
 * ── Why this module exists at all ────────────────────────────────────────────
 *
 * Every number Phase 3 bills from is attributed to a day, and a day is only
 * unambiguous once you say which clock. An application submitted at 23:59:58
 * and one submitted four seconds later belong to different days and are priced
 * from different windows, so "which day" is a money question, not a formatting
 * one.
 *
 * The answer is: a calendar day runs 00:00:00.000 to 23:59:59.999 in
 * America/New_York. Nothing else in this codebase may introduce a second
 * timezone assumption. Not `new Date().toISOString().slice(0,10)` (that is UTC,
 * and for five hours every evening it names tomorrow), not the server's local
 * zone (UTC in production, whatever the laptop says otherwise), and not the
 * browser's.
 *
 * ── This module is deliberately NOT called "business day" ────────────────────
 *
 * It was, and that was a mistake worth spelling out, because it is the kind
 * that costs a customer something without anyone noticing.
 *
 * "Business day" appears in the signed agreement four times and means the same
 * thing every time: a day on which business is transacted, i.e. Monday to
 * Friday excluding US federal holidays. It bounds a 5-day settlement dispute
 * window, a 30-day delivery window and a 5-day grace period on failed
 * settlement. Reading it as "calendar day" silently SHORTENS every one of those
 * notice periods -- a five-day dispute window opened on a Thursday would expire
 * on Monday instead of the following Wednesday, and the agency loses two days
 * of a right it was granted in writing.
 *
 * The rating window is a different thing again and needs neither: see
 * `delivery-day.ts`.
 *
 * So the vocabulary is now three words, and one file each:
 *
 *   Calendar day   (here)              a day on the wall clock in New York.
 *                                      The day boundary everything else is
 *                                      built from.
 *   Business day   (business-day.ts)   Mon-Fri excluding US federal holidays.
 *                                      Contractual notice periods ONLY.
 *   Delivery Day   (delivery-day.ts)   a calendar day on which NetEnroll
 *                                      delivered at least one call to THAT
 *                                      agency. The rating window ONLY.
 *
 * None of the three may stand in for another.
 *
 * ── Implementation ───────────────────────────────────────────────────────────
 *
 * `Intl.DateTimeFormat` with an explicit `timeZone`, which is the only
 * timezone database Node ships with and the only one that gets DST right
 * without a dependency. Converting a local wall-clock time back to an instant
 * takes two passes, because the offset you need depends on the instant you are
 * trying to find; two iterations converge everywhere, including across the DST
 * transitions, and the tests pin both of them.
 */

/**
 * The one timezone this platform reckons days in.
 *
 * Named for the platform rather than for rating, because contractual notice
 * periods are reckoned in it too and they are not rating.
 */
export const PLATFORM_TIME_ZONE = 'America/New_York';

/**
 * @deprecated Kept only so an import of the old name is a compile-time nudge
 * rather than a silent behaviour change. Use {@link PLATFORM_TIME_ZONE}.
 */
export const RATING_TIME_ZONE = PLATFORM_TIME_ZONE;

/**
 * A calendar day, as `YYYY-MM-DD` in {@link PLATFORM_TIME_ZONE}.
 *
 * A plain string rather than a `Date` throughout, so that no layer between the
 * database and the browser can shift it by a timezone. `Date` is an instant;
 * this is a label for a day, and the two are not interchangeable.
 */
export type CalendarDayKey = string;

const KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: PLATFORM_TIME_ZONE,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The wall-clock reading in New York at a given instant. */
function wallClockAt(instant: Date): WallClock {
  const parts = FORMATTER.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find(p => p.type === type);
    return part ? Number(part.value) : 0;
  };

  // `hour12: false` renders midnight as 24 in some ICU versions.
  const hour = get('hour') % 24;

  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour,
    minute: get('minute'),
    second: get('second'),
  };
}

/** New York's offset from UTC, in milliseconds, at a given instant. */
function offsetMsAt(instant: Date): number {
  const w = wallClockAt(instant);
  const asIfUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  // Millisecond component is not in the formatted parts; it is the same in both
  // clocks, so dropping it from both sides leaves the offset exact.
  return asIfUtc - (instant.getTime() - instant.getMilliseconds());
}

/**
 * The instant at which a New York wall-clock time occurs.
 *
 * Two passes: guess the offset from the naive instant, correct, then re-read
 * the offset at the corrected instant in case the first guess landed on the
 * wrong side of a DST transition.
 */
function instantOf(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  let guess = naive;
  for (let i = 0; i < 2; i++) {
    guess = naive - offsetMsAt(new Date(guess));
  }
  return new Date(guess);
}

function parseKey(key: CalendarDayKey): { year: number; month: number; day: number } {
  if (!KEY_PATTERN.test(key)) {
    throw new Error(`Not a calendar day key: ${JSON.stringify(key)} (expected YYYY-MM-DD)`);
  }
  const [year, month, day] = key.split('-').map(Number);
  return { year, month, day };
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** The calendar day an instant falls in. */
export function calendarDayOf(instant: Date): CalendarDayKey {
  const w = wallClockAt(instant);
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`;
}

/** Today's calendar day, as of now. */
export function currentCalendarDay(now: Date = new Date()): CalendarDayKey {
  return calendarDayOf(now);
}

/**
 * The half-open instant range of a calendar day: `[start, endExclusive)`.
 *
 * Half-open rather than inclusive-to-23:59:59.999, because the alternative
 * loses anything that happens in the last millisecond of the day and because
 * every query built on this is a `gte`/`lt` pair. The day still *ends* at
 * 23:59:59.999 local; `endExclusive` is the next day's first instant.
 */
export function calendarDayBounds(key: CalendarDayKey): { start: Date; endExclusive: Date } {
  const { year, month, day } = parseKey(key);
  return {
    start: instantOf(year, month, day, 0, 0, 0, 0),
    endExclusive: instantOf(year, month, day + 1, 0, 0, 0, 0),
  };
}

/** The calendar day `offset` days after `key` (negative walks backwards). */
export function shiftCalendarDay(key: CalendarDayKey, offset: number): CalendarDayKey {
  const { year, month, day } = parseKey(key);
  // Anchored at local noon so adding days can never be knocked into the
  // neighbouring day by a DST transition, which moves the clock at 02:00.
  const anchor = instantOf(year, month, day + offset, 12, 0, 0, 0);
  return calendarDayOf(anchor);
}

/** The calendar day before `key`. */
export function previousCalendarDay(key: CalendarDayKey): CalendarDayKey {
  return shiftCalendarDay(key, -1);
}

/** The calendar day after `key`. */
export function nextCalendarDay(key: CalendarDayKey): CalendarDayKey {
  return shiftCalendarDay(key, 1);
}

/**
 * Day of the week for a calendar day. 0 = Sunday .. 6 = Saturday.
 *
 * Deliberately computed from the date itself rather than from a New York
 * instant: `Date.UTC(y, m-1, d)` names that calendar date with no timezone in
 * the answer at all, which is exactly what is wanted. Going out to an instant
 * and back invites a DST off-by-one for the sake of nothing.
 *
 * `business-day.ts` is built on this.
 */
export function dayOfWeek(key: CalendarDayKey): number {
  const { year, month, day } = parseKey(key);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** A set of calendar days, and the instants that bound it. */
export interface CalendarDayWindow {
  /** Oldest first. Not necessarily contiguous -- see `delivery-day.ts`. */
  dayKeys: CalendarDayKey[];
  /** First instant of the earliest day. */
  start: Date;
  /** First instant of the day AFTER the latest day. */
  endExclusive: Date;
}

/**
 * Bound a set of calendar days.
 *
 * `start` and `endExclusive` span the whole range, INCLUDING any gap in the
 * middle. That matters for delivery-day windows, which are not contiguous: a
 * window of Thursday, Friday and Monday spans Saturday and Sunday too. Anything
 * counting over the window must count per day and sum, never over the span --
 * `delivery-day.ts` does, and says so.
 */
export function windowOf(dayKeys: CalendarDayKey[]): CalendarDayWindow {
  if (dayKeys.length === 0) {
    throw new Error('A calendar-day window needs at least one day');
  }
  const sorted = [...dayKeys].sort();
  return {
    dayKeys: sorted,
    start: calendarDayBounds(sorted[0]).start,
    endExclusive: calendarDayBounds(sorted[sorted.length - 1]).endExclusive,
  };
}

/**
 * The last calendar day that has fully closed, as of `now`.
 *
 * The rating engine runs after the close of a day and rates the day that just
 * ended, so "which day closed?" has to be answered from the same clock the day
 * was measured in. A run at 00:05 New York on the 8th rates the 7th; a run at
 * 23:00 on the 7th rates the 6th, because the 7th is still open.
 */
export function lastClosedCalendarDay(now: Date = new Date()): CalendarDayKey {
  return previousCalendarDay(calendarDayOf(now));
}
