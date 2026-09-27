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
