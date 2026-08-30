/**
 * Date range, resolved from the URL.
 *
 * The range lives in the query string rather than in component state, because
 * these pages render on the server: the URL is the only thing that can change
 * what the server fetches. It also means a range is linkable — "look at the
 * 21st with me" is a paste, not a description.
 */

export type RangeKey = '7d' | '30d' | '90d' | 'custom';

export interface ResolvedRange {
  key: RangeKey;
  /** ISO instants, inclusive of the whole end day. */
  startISO: string;
  endISO: string;
  /** yyyy-mm-dd, for date inputs and for round-tripping through the URL. */
  startDate: string;
  endDate: string;
  label: string;
  days: number;
}

const PRESET_DAYS: Record<Exclude<RangeKey, 'custom'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

export const RANGE_OPTIONS: Array<{ value: RangeKey; label: string }> = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'custom', label: 'Custom' },
];

function toDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isDay(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function daysBetween(startDate: string, endDate: string): number {
  const ms = Date.parse(`${endDate}T00:00:00.000Z`) - Date.parse(`${startDate}T00:00:00.000Z`);
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

export function resolveRange(params: {
  range?: string | string[];
  from?: string | string[];
  to?: string | string[];
}): ResolvedRange {
  const raw = Array.isArray(params.range) ? params.range[0] : params.range;
  const from = Array.isArray(params.from) ? params.from[0] : params.from;
  const to = Array.isArray(params.to) ? params.to[0] : params.to;

  if (raw === 'custom' && isDay(from) && isDay(to) && from <= to) {
    return {
      key: 'custom',
      startISO: `${from}T00:00:00.000Z`,
      endISO: `${to}T23:59:59.999Z`,
      startDate: from,
      endDate: to,
      label: `${from} to ${to}`,
      days: daysBetween(from, to),
    };
  }

  const key: Exclude<RangeKey, 'custom'> =
    raw === '7d' || raw === '90d' ? raw : raw === '30d' ? '30d' : '30d';
  const days = PRESET_DAYS[key];
  const end = new Date();
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  const startDate = toDay(start);
  const endDate = toDay(end);

  return {
    key,
    startISO: `${startDate}T00:00:00.000Z`,
    endISO: `${endDate}T23:59:59.999Z`,
    startDate,
    endDate,
    label: `Last ${days} days`,
    days,
  };
}

/** The trailing-30-day window the Targeting page reads history from. */
export function trailing30(): { startISO: string; endISO: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 29 * 86_400_000);
  return {
    startISO: `${toDay(start)}T00:00:00.000Z`,
    endISO: `${toDay(end)}T23:59:59.999Z`,
  };
}

export function firstParam(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.length > 0 ? v : undefined;
}

export function parsePage(value: string | string[] | undefined): number {
  const n = parseInt(firstParam(value) ?? '1', 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}
