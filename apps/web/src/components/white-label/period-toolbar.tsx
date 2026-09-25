'use client';

import * as React from 'react';

import {
  Toolbar,
  ToolbarActions,
  ToolbarDateRange,
  ToolbarMeta,
  ToolbarSelect,
} from '@/components/domain';
import {
  isSendable,
  localDayKey,
  PERIOD_OPTIONS,
  periodQuery,
} from '@/components/leaderboard/period-picker';
import type { PeriodKey } from '@/components/leaderboard/types';
import { formatDayLabel, formatDayRange } from '@/lib/format-time';

import type { ResolvedPeriodView } from './types';

/**
 * The period a screen is measuring, and the query string for it.
 *
 * The same names the Leaderboard sends, so a white-label screen and the board
 * measure the same day. The browser never computes a range; see
 * `components/leaderboard/period-picker.tsx`.
 */
export function usePeriod(initial: PeriodKey = 'TODAY') {
  const [period, setPeriod] = React.useState<PeriodKey>(initial);
  const [from, setFrom] = React.useState(() => localDayKey(6));
  const [to, setTo] = React.useState(() => localDayKey(0));
  return {
    period,
    from,
    to,
    setPeriod,
    setFrom,
    setTo,
    sendable: isSendable(period, from, to),
    query: periodQuery(period, from, to),
  };
}

export type PeriodState = ReturnType<typeof usePeriod>;

/** The toolbar row: the period, the range the server measured, and actions. */
export function PeriodToolbar({
  state,
  resolved,
  label,
  children,
}: {
  state: PeriodState;
  /** What the server says it measured. Rendered, never the requested range. */
  resolved: ResolvedPeriodView | null;
  label: string;
  children?: React.ReactNode;
}): JSX.Element {
  const custom = state.period === 'CUSTOM';
  const reversed = custom && state.from > state.to;

  return (
    <Toolbar aria-label={label}>
      <ToolbarSelect
        label="Period"
        value={state.period}
        allValue={null}
        onChange={next => state.setPeriod(next as PeriodKey)}
        options={PERIOD_OPTIONS}
        className="xl:max-w-[150px]"
      />
      {custom ? (
        <ToolbarDateRange
          from={state.from}
          to={state.to}
          onFromChange={state.setFrom}
          onToChange={state.setTo}
        />
      ) : null}
      {reversed ? (
        <ToolbarMeta className="text-dropped-ink">
          The start date is after the end date.
        </ToolbarMeta>
      ) : resolved ? (
        <ToolbarMeta>
          {resolved.from === resolved.to
            ? formatDayLabel(resolved.from)
            : `${formatDayRange(resolved.from, resolved.to)} · ${resolved.days} day${
                resolved.days === 1 ? '' : 's'
              }`}
          {resolved.complete ? null : ' · still open'}
        </ToolbarMeta>
      ) : null}
      {children ? <ToolbarActions>{children}</ToolbarActions> : null}
    </Toolbar>
  );
}

/** Download a CSV the API produced, under the given file name. */
export function saveCsv(csv: string, fileName: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', fileName);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
