'use client';

import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Figure, FigureRow, count, pct } from '@/components/delivery/ledger';
import { CompactPageHeader, CompactPageShell } from '@/components/layout/compact-layout';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * The Live Board: every agency, right now.
 *
 * ── Why this page did not exist ──────────────────────────────────────────────
 *
 * "Live board" has been in the sidebar since the nav was written, marked
 * `pending: true` — greyed out, unclickable, with a "Soon" chip. There was no
 * page file and there never had been. It was not hidden by a permission or
 * broken by a bug; nobody could see it because nobody had built it. The nav
 * entry was a note-to-self that shipped.
 *
 * ── What it answers that no other screen does ────────────────────────────────
 *
 * `/delivery` cross-agency answers "how did every agency do today" as money:
 * rate, block, overrun, margin, settlement state. That is the settled-day
 * reading and it is the right one for deciding what to charge.
 *
 * This is the floor. Who is on the phone THIS SECOND, per agency, beside the
 * two numbers that say whether the day is going anywhere. It is the screen you
 * leave open on a second monitor, which is why the interesting row sorts to the
 * top on its own and why an agency with nothing happening is stated plainly
 * rather than left for the reader to notice.
 *
 * The two "today" figures are the BILLING ones, from the module the nightly
 * settlement bills from. See `services/live/platform-board.ts`.
 *
 * ── No RoleGuard, deliberately ───────────────────────────────────────────────
 *
 * The same shape as `/admin/agencies`, the other cross-agency screen. `/admin/live`
 * is in `STAFF_ONLY_ROUTES`, so the dashboard layout redirects anyone who is not
 * staff before this renders, and `/api/v1/platform/live/board` is behind
 * `requirePlatformAdmin`, so the data refuses them regardless. Wrapping this in
 * `RoleGuard` would be worse than nothing: its `hasFullAccess` branch admits any
 * ADMIN or OWNER, which is precisely the agency principal this page is not for.
 */

interface BoardAgency {
  tenantId: string;
  name: string;
  slug: string;
  isNonProduction: boolean;
  callsInFlight: number;
  deliveredToday: number;
  applicationsToday: number;
  closingPct: number | null;
}

interface Board {
  generatedAt: string;
  day: string;
  timeZone: string;
  totals: {
    agencies: number;
    working: number;
    callsInFlight: number;
    deliveredToday: number;
    applicationsToday: number;
    closingPct: number | null;
  };
  agencies: BoardAgency[];
  includingNonProduction: boolean;
}

/** How often the board asks again. Matches the live strip above it. */
const POLL_MS = 5000;

/**
 * Busiest first, then the day's work, then by name.
 *
 * A board that sorts alphabetically buries the agency with four calls up behind
 * three that are closed. The row somebody needs to see is the one with
 * something happening on it, so that is the row that rises.
 */
function byActivity(a: BoardAgency, b: BoardAgency): number {
  if (b.callsInFlight !== a.callsInFlight) return b.callsInFlight - a.callsInFlight;
  if (b.deliveredToday !== a.deliveredToday) return b.deliveredToday - a.deliveredToday;
  return a.name.localeCompare(b.name);
}

export default function LiveBoardPage(): JSX.Element {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showNonProduction, setShowNonProduction] = useState(false);

  const load = useCallback(async () => {
    const response = await apiClient.get<Envelope<Board>>(
      `/api/v1/platform/live/board${showNonProduction ? '?includeNonProduction=true' : ''}`
    );
    const data = payload(response);
    if (data) {
      setBoard(data);
      setError(null);
    } else {
      /*
       * The last good board stays on screen. A polling page that blanks itself
       * on one failed request is worse than one that shows a number a few
       * seconds old and says so — the second monitor this lives on is glanced
       * at, not read.
       */
      setError(response.error?.message ?? 'The board could not be refreshed.');
    }
    setLoading(false);
  }, [showNonProduction]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (loading) {
    return (
      <CompactPageShell>
        <div className="flex items-center gap-2 py-12 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading the floor
        </div>
      </CompactPageShell>
    );
  }

  if (!board) {
    return (
      <CompactPageShell>
        <p className="t-body text-ink-3">{error ?? 'No live data yet.'}</p>
      </CompactPageShell>
    );
  }

  const rows = [...board.agencies].sort(byActivity);
  const asOf = new Date(board.generatedAt).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <CompactPageShell fullHeight={false}>
      <CompactPageHeader subtitle={`Every agency · ${board.day} · as of ${asOf} ${board.timeZone}`}>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowNonProduction(v => !v)}
            aria-pressed={showNonProduction}
          >
            {showNonProduction ? 'Hide test agencies' : 'Show test agencies'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-3 w-3" />
            Refresh
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/delivery">Delivery</Link>
          </Button>
        </div>
      </CompactPageHeader>

      {/*
        A stale board is not a broken one. It keeps showing the last good
        numbers and says how old they are, rather than replacing the floor with
        an error the moment one poll misses.
      */}
      {error ? (
        <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 t-meta">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Not refreshing: {error} Showing the board as of {asOf}.
        </div>
      ) : null}

      <FigureRow>
        <Figure
          size="hero"
          label="Calls up right now"
          value={count(board.totals.callsInFlight)}
          sub={`across ${count(board.totals.working)} of ${count(board.totals.agencies)} ${
            board.totals.agencies === 1 ? 'agency' : 'agencies'
          } working today`}
        />
        <Figure label="Delivered today" value={count(board.totals.deliveredToday)} />
        <Figure label="Applications today" value={count(board.totals.applicationsToday)} />
        <Figure
          label="Closing"
          value={board.totals.closingPct === null ? '—' : pct(board.totals.closingPct)}
          sub={
            board.totals.closingPct === null
              ? 'no calls delivered yet today'
              : 'applications over delivered calls'
          }
        />
      </FigureRow>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Agency</TableHead>
            <TableHead className="text-right">On calls</TableHead>
            <TableHead className="text-right">Delivered</TableHead>
            <TableHead className="text-right">Applications</TableHead>
            <TableHead className="text-right">Closing</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-12 text-center t-body text-ink-3">
                No active agencies.
              </TableCell>
            </TableRow>
          ) : (
            rows.map(agency => {
              const quiet = agency.callsInFlight === 0 && agency.deliveredToday === 0;
              return (
                <TableRow key={agency.tenantId} className={cn(quiet && 'text-ink-3')}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {/*
                        A live dot, and only when something is actually up. A
                        permanent indicator beside every agency would be
                        decoration; this one is the thing the eye is looking for.
                      */}
                      <span
                        className={cn(
                          'h-2 w-2 shrink-0 rounded-full',
                          agency.callsInFlight > 0 ? 'bg-live animate-pulse' : 'bg-rule'
                        )}
                        aria-hidden="true"
                      />
                      <span className="font-medium">{agency.name}</span>
                      {agency.isNonProduction ? (
                        <span className="rounded-control bg-sunken px-1 t-meta text-ink-3">
                          test
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {agency.callsInFlight > 0 ? count(agency.callsInFlight) : '—'}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {count(agency.deliveredToday)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {count(agency.applicationsToday)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {agency.closingPct === null ? '—' : pct(agency.closingPct)}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      <p className="t-meta text-ink-3">
        Delivered calls and submitted applications are the figures the nightly settlement bills
        from, so this board and an agency&rsquo;s invoice can never disagree. Closing is blank until
        a call has been delivered — an agency that has taken calls and written nothing reads 0%,
        which is a different thing from a quiet morning.
      </p>
    </CompactPageShell>
  );
}
