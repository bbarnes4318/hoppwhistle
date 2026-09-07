/**
 * The business day. One definition, one place.
 *
 * ── Why this module exists at all ────────────────────────────────────────────
 *
 * Every number Phase 3 bills from is attributed to a day, and a day is only
 * unambiguous once you say which clock. An application submitted at 23:59:58
 * and one submitted four seconds later belong to different days and are priced
 * from different windows, so "which day" is a money question, not a formatting
 * one.
 *
 * The answer is: a business day is a calendar day in America/New_York, running
 * from 00:00:00.000 to 23:59:59.999 local. Nothing else in this codebase may
 * introduce a second timezone assumption for rating. Not `new Date()
 * .toISOString().slice(0,10)` (that is UTC, and for five hours every evening it
 * names tomorrow), not the server's local zone (which is UTC in production and
 * whatever the developer's laptop says otherwise), and not the browser's.
 *
 * ── "Business day" means calendar day ────────────────────────────────────────
 *
 * Deliberately NOT "weekday". Both launch agencies take calls at weekends, and
 * skipping Saturday and Sunday would silently price Monday off a window
 * stretching back to the previous Wednesday -- a stale sample, and one an
 * agency reading its own portal could not reconstruct. So the trailing window
 * is consecutive calendar days in New York, and the phrase "business day" here
 * means "the day as the business reckons it", which is the thing that ends at
 * 23:59:59 Eastern.
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

/** The one timezone the rating engine reckons days in. */
export const RATING_TIME_ZONE = 'America/New_York';

/** A business day, as `YYYY-MM-DD` in {@link RATING_TIME_ZONE}. */
export type BusinessDayKey = string;

const KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: RATING_TIME_ZONE,
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

function parseKey(key: BusinessDayKey): { year: number; month: number; day: number } {
  if (!KEY_PATTERN.test(key)) {
    throw new Error(`Not a business day key: ${JSON.stringify(key)} (expected YYYY-MM-DD)`);
  }
  const [year, month, day] = key.split('-').map(Number);
  return { year, month, day };
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/** The business day an instant falls in. */
export function businessDayOf(instant: Date): BusinessDayKey {
  const w = wallClockAt(instant);
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}`;
}

/** Today's business day, as of now. */
export function currentBusinessDay(now: Date = new Date()): BusinessDayKey {
  return businessDayOf(now);
}

/**
 * The half-open instant range of a business day: `[start, endExclusive)`.
 *
 * Half-open rather than inclusive-to-23:59:59.999, because the alternative
 * loses anything that happens in the last millisecond of the day and because
 * every query built on this is a `gte`/`lt` pair. The day still *ends* at
 * 23:59:59.999 local; `endExclusive` is the next day's first instant.
 */
export function businessDayBounds(key: BusinessDayKey): { start: Date; endExclusive: Date } {
  const { year, month, day } = parseKey(key);
  return {
    start: instantOf(year, month, day, 0, 0, 0, 0),
    endExclusive: instantOf(year, month, day + 1, 0, 0, 0, 0),
  };
}

/** The business day `offset` days after `key` (negative walks backwards). */
export function shiftBusinessDay(key: BusinessDayKey, offset: number): BusinessDayKey {
  const { year, month, day } = parseKey(key);
  // Anchored at local noon so adding days can never be knocked into the
  // neighbouring day by a DST transition, which moves the clock at 02:00.
  const anchor = instantOf(year, month, day + offset, 12, 0, 0, 0);
  return businessDayOf(anchor);
}

/** The business day before `key`. */
export function previousBusinessDay(key: BusinessDayKey): BusinessDayKey {
  return shiftBusinessDay(key, -1);
}

/** The business day after `key`. */
export function nextBusinessDay(key: BusinessDayKey): BusinessDayKey {
  return shiftBusinessDay(key, 1);
}

/** A window of business days, and the instants that bound it. */
export interface BusinessDayWindow {
  /** Oldest first. */
  dayKeys: BusinessDayKey[];
  start: Date;
  endExclusive: Date;
}

/**
 * The trailing window of `length` business days ending on `lastDay` inclusive.
 *
 * `trailingWindow('2026-09-07', 3)` is 5th, 6th and 7th of September.
 */
export function trailingWindow(lastDay: BusinessDayKey, length: number): BusinessDayWindow {
  if (!Number.isInteger(length) || length < 1) {
    throw new Error(`Window length must be a positive whole number of days, got ${length}`);
  }

  const dayKeys: BusinessDayKey[] = [];
  for (let i = length - 1; i >= 0; i--) {
    dayKeys.push(shiftBusinessDay(lastDay, -i));
  }

  return {
    dayKeys,
    start: businessDayBounds(dayKeys[0]).start,
    endExclusive: businessDayBounds(dayKeys[dayKeys.length - 1]).endExclusive,
  };
}

/**
 * The last business day that has fully closed, as of `now`.
 *
 * The engine runs after the close of a business day and rates the day that just
 * ended, so "which day closed?" has to be answered from the same clock the day
 * was measured in. A run at 00:05 New York on the 8th rates the 7th; a run at
 * 23:00 on the 7th rates the 6th, because the 7th is still open.
 */
export function lastClosedBusinessDay(now: Date = new Date()): BusinessDayKey {
  return previousBusinessDay(businessDayOf(now));
}
