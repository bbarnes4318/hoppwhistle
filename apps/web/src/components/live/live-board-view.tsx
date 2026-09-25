'use client';

import { AlertTriangle, Loader2 } from 'lucide-react';
import * as React from 'react';

import { Figure, FigureRow, count, pct } from '@/components/delivery/ledger';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

/**
 * The Live Board's presentation, shared by the two boards that exist.
 *
 * `/admin/live` is NetEnroll's cross-agency board: one row per agency.
 * `/live` is an agency's own board: one row per buyer. They answer the same
 * question -- who is on the phone right now, and is the day going anywhere --
 * so they must look the same, and the one way to guarantee that is for both to
 * render this. Each page owns its own data, polling and header; this owns the
 * figures, the table and the stale-board notice.
 */

export interface LiveBoardRow {
  id: string;
  name: string;
  callsInFlight: number;
  deliveredToday: number;
  applicationsToday: number;
  /** A percentage: 8.5 means 8.5%. Null when nothing was delivered yet. */
  closingPct: number | null;
  /** A small chip after the name, e.g. "test" for a non-production agency. */
  tag?: string;
  /** Always sorted last, whatever its activity -- the Unattributed row. */
  pinLast?: boolean;
}

export interface LiveBoardTotals {
  callsInFlight: number;
  deliveredToday: number;
  applicationsToday: number;
  closingPct: number | null;
}

/**
 * Busiest first, then the day's work, then by name.
 *
 * A board that sorts alphabetically buries the row with four calls up behind
 * three that are closed. The row somebody needs to see is the one with
 * something happening on it, so that is the row that rises. A pinned row stays
 * at the bottom: it is a remainder, not a competitor.
 */
export function byActivity(a: LiveBoardRow, b: LiveBoardRow): number {
  if (!!a.pinLast !== !!b.pinLast) return a.pinLast ? 1 : -1;
  if (b.callsInFlight !== a.callsInFlight) return b.callsInFlight - a.callsInFlight;
  if (b.deliveredToday !== a.deliveredToday) return b.deliveredToday - a.deliveredToday;
  return a.name.localeCompare(b.name);
}

export function formatAsOf(generatedAt: string): string {
  return new Date(generatedAt).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function LiveBoardLoading(): JSX.Element {
  return (
    <div className="flex items-center gap-2 py-12 text-ink-3">
      <Loader2 className="h-4 w-4 animate-spin" />
      Loading the floor
    </div>
  );
}

export interface LiveBoardViewProps {
  totals: LiveBoardTotals;
  /** The line under the hero figure. */
  heroSub: string;
  rows: LiveBoardRow[];
  /** The first column's heading: "Agency" or "Buyer". */
  rowLabel: string;
  emptyText: string;
  /** Set when the last poll failed; the last good board stays on screen. */
  error: string | null;
  asOf: string;
  footnote?: React.ReactNode;
}

export function LiveBoardView({
  totals,
  heroSub,
  rows,
  rowLabel,
  emptyText,
  error,
  asOf,
  footnote,
}: LiveBoardViewProps): JSX.Element {
  const sorted = [...rows].sort(byActivity);

  return (
    <>
      {/*
        A stale board is not a broken one. It keeps showing the last good
        numbers and says how old they are, rather than replacing the floor with
        an error the moment one poll misses.
      */}
      {error ? (
        <div className="flex items-center gap-2 rounded-control border border-ringing/40 bg-ringing-tint p-2 t-meta text-ringing-ink">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Not refreshing: {error} Showing the board as of {asOf}.
        </div>
      ) : null}

      <FigureRow>
        <Figure
          size="hero"
          label="Calls up right now"
          value={count(totals.callsInFlight)}
          sub={heroSub}
        />
        <Figure label="Delivered today" value={count(totals.deliveredToday)} />
        <Figure label="Applications today" value={count(totals.applicationsToday)} />
        <Figure
          label="Closing"
          value={totals.closingPct === null ? '—' : pct(totals.closingPct)}
          sub={
            totals.closingPct === null
              ? 'no calls delivered yet today'
              : 'applications over delivered calls'
          }
        />
      </FigureRow>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{rowLabel}</TableHead>
            <TableHead className="text-right">On calls</TableHead>
            <TableHead className="text-right">Delivered</TableHead>
            <TableHead className="text-right">Applications</TableHead>
            <TableHead className="text-right">Closing</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-12 text-center t-body text-ink-3">
                {emptyText}
              </TableCell>
            </TableRow>
          ) : (
            sorted.map(row => {
              const quiet = row.callsInFlight === 0 && row.deliveredToday === 0;
              return (
                <TableRow key={row.id} className={cn(quiet && 'text-ink-3')}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {/*
                        A live dot, and only when something is actually up. A
                        permanent indicator beside every row would be
                        decoration; this one is the thing the eye is looking for.
                        An idle row keeps an 8px transparent spacer in its place
                        so the names stay aligned.
                      */}
                      <span
                        className={cn(
                          'h-2 w-2 shrink-0 rounded-full',
                          row.callsInFlight > 0 && 'bg-live animate-pulse'
                        )}
                        aria-hidden="true"
                      />
                      <span className={cn('font-medium', row.pinLast && 'italic')}>{row.name}</span>
                      {row.tag ? (
                        <span className="rounded-control bg-sunken px-1 t-meta text-ink-3">
                          {row.tag}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right t-num">
                    {row.callsInFlight > 0 ? count(row.callsInFlight) : '—'}
                  </TableCell>
                  <TableCell className="text-right t-num">{count(row.deliveredToday)}</TableCell>
                  <TableCell className="text-right t-num">{count(row.applicationsToday)}</TableCell>
                  <TableCell className="text-right t-num">
                    {row.closingPct === null ? '—' : pct(row.closingPct)}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      {footnote ? <p className="t-meta text-ink-3">{footnote}</p> : null}
    </>
  );
}
