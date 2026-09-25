/**
 * Display formatters for times and dates. One answer per value type, so the
 * same instant reads the same way on every screen.
 *
 * All of these are display-only and use the viewer's locale clock. Anything
 * that is SENT somewhere -- a period key, a YYYY-MM-DD day label -- keeps its
 * own wire format and never passes through here.
 */

type DateInput = Date | string | number;

function toDate(value: DateInput): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A table timestamp: "Sep 24, 4:49 PM". 12-hour, no leading zero on the hour. */
export function formatTableDateTime(value: DateInput | null | undefined, fallback = '—'): string {
  if (value == null) return fallback;
  const d = toDate(value);
  if (!d) return fallback;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** A time of day: "3:26 AM", or "3:26:04 AM" with `seconds`. */
export function formatClock(
  value: DateInput | null | undefined,
  options: { seconds?: boolean } = {},
  fallback = '—'
): string {
  if (value == null) return fallback;
  const d = toDate(value);
  if (!d) return fallback;
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    ...(options.seconds ? { second: '2-digit' } : {}),
    hour12: true,
  });
}

/** A calendar date: "Sep 24, 2026". */
export function formatDisplayDate(value: DateInput | null | undefined, fallback = '—'): string {
  if (value == null) return fallback;
  const d = toDate(value);
  if (!d) return fallback;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** A date and time with the year, for a detail view: "Sep 24, 2026, 4:49:12 PM". */
export function formatFullDateTime(value: DateInput | null | undefined, fallback = '—'): string {
  if (value == null) return fallback;
  const d = toDate(value);
  if (!d) return fallback;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

/**
 * A YYYY-MM-DD day label as a calendar date: "2026-09-25" → "Sep 25, 2026".
 *
 * Parsed as a calendar day, not an instant: `new Date('2026-09-25')` is UTC
 * midnight, which is the previous evening anywhere west of Greenwich. The
 * label itself is unchanged wherever it is sent.
 */
export function formatDayLabel(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return day;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Two YYYY-MM-DD day labels as one range: "Aug 27 – Sep 25, 2026". The year
 * is written once when both ends share it.
 */
export function formatDayRange(from: string, to: string): string {
  const a = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from);
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(to);
  if (!a || !b) return `${from} – ${to}`;
  if (from === to) return formatDayLabel(from);
  const da = new Date(Number(a[1]), Number(a[2]) - 1, Number(a[3]));
  const sameYear = a[1] === b[1];
  const start = da.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return `${start} – ${formatDayLabel(to)}`;
}
