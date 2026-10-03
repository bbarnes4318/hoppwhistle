/**
 * How values are written on the agreements, and the hashing every piece of
 * evidence uses. Pure functions; the templates and the certificate share them
 * so a figure reads the same everywhere it appears.
 */

import { createHash } from 'crypto';

import { DAY_KEYS, type DayKey } from './terms.js';

export function sha256Hex(value: string | Buffer | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

/** HTML-escape a value substituted into a document or an email. */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** `$1,234.00`. */
export function money(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** `$160` when whole, otherwise `$175.50`. */
export function moneyShort(value: number): string {
  return Number.isInteger(value)
    ? `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    : money(value);
}

/** `YYYY-MM-DD` → `M/D/YYYY`, read as written: no timezone can shift it. */
export function formatIsoDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${m}/${d}/${y}`;
}

const ET = 'America/New_York';

/** Today's date in Eastern Time, as `YYYY-MM-DD`. */
export function etDateIso(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ET,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
  return parts;
}

/** A moment as an Eastern Time `M/D/YYYY`. */
export function etDate(at: Date): string {
  return formatIsoDate(etDateIso(at));
}

/** A moment in Eastern Time with the time, e.g. `10/3/2026, 2:05:09 PM EDT`. */
export function etDateTime(at: Date): string {
  return at.toLocaleString('en-US', {
    timeZone: ET,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });
}

/** A long Eastern Time date, e.g. `Monday, November 2, 2026`. */
export function etLongDate(at: Date): string {
  return at.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: ET,
  });
}

const DAY_NAMES: Record<DayKey, string> = {
  MON: 'Monday',
  TUE: 'Tuesday',
  WED: 'Wednesday',
  THU: 'Thursday',
  FRI: 'Friday',
  SAT: 'Saturday',
  SUN: 'Sunday',
};

/** "A, B and C". */
export function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * "Monday through Friday" for a contiguous run of three or more days,
 * otherwise "Monday, Wednesday and Friday".
 */
export function formatDeliveryDays(days: readonly string[]): string {
  const indexes = DAY_KEYS.map((key, i) => (days.includes(key) ? i : -1)).filter(i => i >= 0);
  if (indexes.length === 0) return '';
  const contiguous = indexes.every((value, i) => i === 0 || value === indexes[i - 1] + 1);
  if (contiguous && indexes.length >= 3) {
    return `${DAY_NAMES[DAY_KEYS[indexes[0]]]} through ${DAY_NAMES[DAY_KEYS[indexes[indexes.length - 1]]]}`;
  }
  return joinList(indexes.map(i => DAY_NAMES[DAY_KEYS[i]]));
}

/** `19:00` → `7:00 p.m.` */
export function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'a.m.' : 'p.m.';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** "10:00 a.m. to 7:00 p.m. Eastern Time". */
export function formatDeliveryHours(start: string, end: string): string {
  return `${formatClock(start)} to ${formatClock(end)} Eastern Time`;
}

export function formatFirstDeliveryDay(value: string | null | undefined): string {
  return value ? formatIsoDate(value) : 'The first Delivery Day after payment clears';
}

/** Canonical JSON: keys sorted recursively, no whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** `j***@domain.com`. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local.slice(0, 1)}***@${domain}`;
}

/** A file-name-safe slug of the agency's legal name. */
export function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 60) || 'agency'
  );
}
