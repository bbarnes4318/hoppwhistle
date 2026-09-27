/**
 * A calendar day in New York, as the instants that bound it.
 *
 * The platform reckons every day in America/New_York (the API's
 * `services/rating/calendar-day.ts`). A date input hands back `YYYY-MM-DD`, and
 * `new Date('2026-09-10')` reads that as UTC midnight -- five hours before the
 * New York day starts, and a filter "to" that date stops at 8pm the evening
 * before. This turns the label into the day the rest of the product means.
 *
 * `lib/new-york-day.ts` names days; this bounds one.
 *
 * `[start, endExclusive)`: `endExclusive` is the next New York day's first
 * instant, so a whole day is covered whatever the DST offset.
 */

const PLATFORM_TIME_ZONE = 'America/New_York';

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
