'use client';

import { CalendarRange } from 'lucide-react';
import * as React from 'react';

import { Input } from '@/components/ui/input';
import { formatDayLabel, formatDayRange } from '@/lib/format-time';
import { cn } from '@/lib/utils';

import type { PeriodKey } from './types';

/**
 * The period control: eight named windows and a calendar range.
 *
 * ── The names go to the server, the dates do not ─────────────────────────────
 *
 * Pressing "This week" sends `?period=THIS_WEEK` and nothing else. It does NOT
 * compute a Sunday in the browser, because the browser's Sunday is not
 * necessarily the platform's: an agent in Los Angeles opening this at 21:30 is
 * already on tomorrow in New York, and a locally-computed "Today" would ask the
 * server for yesterday and get a correct, empty answer back.
 *
 * `/delivery/team` does compute its dates locally -- `new Date()` then
 * `getFullYear()/getMonth()/getDate()` -- and it is wrong in exactly that way
 * for exactly those three hours. This control does not repeat it.
 *
 * The custom range is the one place dates are typed, and those are day LABELS
 * (`YYYY-MM-DD`), which have no timezone in them to shift.
 *
 * ── The resolved range is rendered, not the requested one ────────────────────
 *
 * The caller passes `resolved`, which is what the server says it measured, and
 * that is what appears under the buttons. What the screen claims and what was
 * counted cannot drift apart if the screen only ever renders the second.
 */

const PRESETS: Array<{ key: PeriodKey; label: string }> = [
  { key: 'TODAY', label: 'Today' },
  { key: 'YESTERDAY', label: 'Yesterday' },
  { key: 'THIS_WEEK', label: 'This week' },
  { key: 'LAST_WEEK', label: 'Last week' },
  { key: 'THIS_MONTH', label: 'This month' },
  { key: 'LAST_MONTH', label: 'Last month' },
  { key: 'THIS_YEAR', label: 'This year' },
  { key: 'LAST_YEAR', label: 'Last year' },
];

export interface PeriodPickerProps {
  period: PeriodKey;
  from: string;
  to: string;
  /** What the server says it measured. Rendered under the control. */
  resolved: { from: string; to: string; days: number; complete: boolean } | null;
  onChange: (next: { period: PeriodKey; from: string; to: string }) => void;
  disabled?: boolean;
}

export function PeriodPicker({
  period,
  from,
  to,
  resolved,
  onChange,
  disabled,
}: PeriodPickerProps): JSX.Element {
  const custom = period === 'CUSTOM';

  /*
   * Caught here as well as on the server. The server refuses a reversed range
   * rather than silently swapping it, so without this the reader would see an
   * error for something they could have been told about before pressing
   * anything.
   */
  const reversed = custom && from > to;

  return (
    <div className="flex flex-col gap-2">
      <div className="inline-flex max-w-full items-center gap-0.5 self-start overflow-x-auto rounded-control bg-sunken p-1">
        {PRESETS.map(preset => (
          <button
            key={preset.key}
            type="button"
            disabled={disabled}
            onClick={() => onChange({ period: preset.key, from, to })}
            className={cn(
              'inline-flex h-7 shrink-0 items-center whitespace-nowrap rounded-[6px] px-3 text-sm font-medium',
              'transition-[color,background-color,box-shadow] duration-150 ease-out ne-motion',
              'disabled:cursor-not-allowed disabled:opacity-50 [@media(pointer:coarse)]:min-h-[40px]',
              period === preset.key
                ? 'bg-surface text-ink shadow-card'
                : 'text-ink-2 hover:text-ink'
            )}
          >
            {preset.label}
          </button>
        ))}

        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange({ period: 'CUSTOM', from, to })}
          className={cn(
            'inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[6px] px-3 text-sm font-medium',
            'transition-[color,background-color,box-shadow] duration-150 ease-out ne-motion',
            'disabled:cursor-not-allowed disabled:opacity-50 [@media(pointer:coarse)]:min-h-[40px]',
            custom ? 'bg-surface text-ink shadow-card' : 'text-ink-2 hover:text-ink'
          )}
        >
          <CalendarRange className="h-3.5 w-3.5" />
          Custom
        </button>
      </div>

      {custom ? (
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="t-label text-ink-3" htmlFor="leaderboard-from">
              From
            </label>
            <Input
              id="leaderboard-from"
              type="date"
              value={from}
              max={to}
              disabled={disabled}
              onChange={event => onChange({ period: 'CUSTOM', from: event.target.value, to })}
              className="h-9 w-[10.5rem]"
            />
          </div>
          <div>
            <label className="t-label text-ink-3" htmlFor="leaderboard-to">
              To
            </label>
            <Input
              id="leaderboard-to"
              type="date"
              value={to}
              min={from}
              disabled={disabled}
              onChange={event => onChange({ period: 'CUSTOM', from, to: event.target.value })}
              className="h-9 w-[10.5rem]"
            />
          </div>
          {reversed ? (
            <p className="pb-1.5 t-meta text-dropped-ink">The start date is after the end date.</p>
          ) : null}
        </div>
      ) : null}

      {resolved ? (
        <p className="t-meta text-ink-3">
          {/* Display only: `onChange` still carries the YYYY-MM-DD labels. */}
          {resolved.from === resolved.to
            ? formatDayLabel(resolved.from)
            : `${formatDayRange(resolved.from, resolved.to)} · ${resolved.days} day${
                resolved.days === 1 ? '' : 's'
              }`}
          {resolved.complete ? null : ' · still open'}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The period menu. The same eight names and a calendar range the picker above
 * offers, as one compact select so the whole control fits a toolbar row. The
 * names still go to the server verbatim; see the header of this file.
 *
 * Shared by every screen that measures over a period -- the Leaderboard and
 * Sales -- so a period means the same thing wherever it is picked.
 */
export const PERIOD_OPTIONS: Array<{ value: PeriodKey; label: string }> = [
  { value: 'TODAY', label: 'Today' },
  { value: 'YESTERDAY', label: 'Yesterday' },
  { value: 'THIS_WEEK', label: 'This week' },
  { value: 'LAST_WEEK', label: 'Last week' },
  { value: 'THIS_MONTH', label: 'This month' },
  { value: 'LAST_MONTH', label: 'Last month' },
  { value: 'THIS_YEAR', label: 'This year' },
  { value: 'LAST_YEAR', label: 'Last year' },
  { value: 'CUSTOM', label: 'Custom range' },
];

/** Whether a picker value is one of the period names. */
export function isPeriodKey(value: string | null | undefined): value is PeriodKey {
  return PERIOD_OPTIONS.some(option => option.value === value);
}

/** Whether a picker state is worth sending. Mirrors the server's own refusal. */
export function isSendable(period: PeriodKey, from: string, to: string): boolean {
  if (period !== 'CUSTOM') return true;
  return Boolean(from) && Boolean(to) && from <= to;
}

/** The query string for a picker state. Named periods carry no dates at all. */
export function periodQuery(period: PeriodKey, from: string, to: string): string {
  return period === 'CUSTOM'
    ? `period=CUSTOM&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    : `period=${period}`;
}

/** `YYYY-MM-DD` for a date this many days before today, in the browser's zone. */
export function localDayKey(offsetDays = 0): string {
  /*
   * The ONLY place a date is computed locally, and it is only ever a SEED for
   * the two custom-range inputs -- something to show in the boxes before the
   * reader picks their own. Nothing measured is derived from it: the moment
   * those values are sent they are day labels the server reads verbatim.
   */
  const date = new Date();
  date.setDate(date.getDate() - offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}
