/**
 * The calendar day an instant falls on, in the one timezone the platform
 * reckons days in.
 *
 * The API owns the full treatment (`apps/api/src/services/rating/calendar-day.ts`
 * explains why nothing may introduce a second timezone assumption). The worker
 * needs only the one conversion, to date its accrual-ledger rows by the day the
 * rest of the product reports them on, so it is repeated here rather than
 * pulling the API package into the worker.
 */

export const PLATFORM_TIME_ZONE = 'America/New_York';

const FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: PLATFORM_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** `YYYY-MM-DD` in America/New_York. */
export function calendarDayOf(instant: Date): string {
  const parts = FORMATTER.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find(part => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * A ledger row's `periodDate`: the New York calendar day, stored as that day's
 * label (UTC midnight of `YYYY-MM-DD`), which is how every reader parses it back.
 */
export function ledgerPeriodDate(instant: Date = new Date()): Date {
  return new Date(`${calendarDayOf(instant)}T00:00:00.000Z`);
}
