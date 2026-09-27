/**
 * Calendar days, in the one timezone the platform reckons days in.
 *
 * The API attributes everything it counts to a calendar day in
 * America/New_York (`apps/api/src/services/rating/calendar-day.ts`), and a
 * `from`/`to` pair of day keys is read on that clock. A screen that builds its
 * default range from `new Date().toISOString().slice(0, 10)` is asking in UTC,
 * which for five hours every evening names tomorrow; one that uses the
 * browser's local date is asking in whatever zone the laptop is set to. Either
 * way the range on the screen is not the range the server counts.
 */

export const PLATFORM_TIME_ZONE = 'America/New_York';

const dayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: PLATFORM_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The New York calendar day an instant falls on, as `YYYY-MM-DD`. */
export function newYorkDayKey(at: Date = new Date()): string {
  const parts = dayFormatter.formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(p => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * A day key moved by whole calendar days. Pure date arithmetic on the key, so
 * a DST change in between cannot move it by an hour into the wrong day.
 */
export function addDays(dayKey: string, days: number): string {
  const [year, month, day] = dayKey.split('-').map(Number);
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  return moved.toISOString().slice(0, 10);
}

/** The last `days` New York calendar days, ending today, as day keys. */
export function lastNewYorkDays(
  days: number,
  now: Date = new Date()
): { from: string; to: string } {
  const to = newYorkDayKey(now);
  return { from: addDays(to, -(days - 1)), to };
}

/* ── A day's bounds ──────────────────────────────────────────────────────────
 *
 * A date input hands back `YYYY-MM-DD`, and `new Date('2026-09-10')` reads that
 * as UTC midnight -- five hours before the New York day starts, so a filter
 * "to" that date stops at 8pm the evening before. `nyDayBounds` turns the label
 * into the day the rest of the product means: `[start, endExclusive)`, where
 * `endExclusive` is the next New York day's first instant, whatever the DST
 * offset.
 */

const KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

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

/** New York's offset from UTC, in milliseconds, at an instant. */
function offsetMsAt(instant: number): number {
  const parts = FORMATTER.formatToParts(new Date(instant));
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find(p => p.type === type)?.value ?? 0);
  const asIfUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second')
  );
  return asIfUtc - (instant - (instant % 1000));
}

/** The instant New York's clock reads midnight on that date. Two passes for DST. */
function nyMidnight(year: number, month: number, day: number): Date {
  const naive = Date.UTC(year, month - 1, day);
  let guess = naive;
  for (let i = 0; i < 2; i++) guess = naive - offsetMsAt(guess);
  return new Date(guess);
}

/** `YYYY-MM-DD` to its New York day's `[start, endExclusive)`, or null if malformed. */
export function nyDayBounds(key: string): { start: Date; endExclusive: Date } | null {
  const match = KEY_PATTERN.exec(key);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return { start: nyMidnight(year, month, day), endExclusive: nyMidnight(year, month, day + 1) };
}
