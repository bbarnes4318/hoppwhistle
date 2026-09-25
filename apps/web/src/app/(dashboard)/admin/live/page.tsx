'use client';

import { RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { count } from '@/components/delivery/ledger';
import { PageHeader } from '@/components/layout/page-header';
import { LiveBoardLoading, LiveBoardView, formatAsOf } from '@/components/live/live-board-view';
import { Button } from '@/components/ui/button';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';

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
 * The figures and the table are `components/live/live-board-view.tsx`, which the
 * agency's own board at `/live` renders too, so the two look the same.
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

/** How often the board asks again. */
const POLL_MS = 5000;

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
      <div className="page-canvas">
        <LiveBoardLoading />
      </div>
    );
  }

  if (!board) {
    return (
      <div className="page-canvas">
        <p className="t-body text-ink-3">{error ?? 'No live data yet.'}</p>
      </div>
    );
  }

  const asOf = formatAsOf(board.generatedAt);

  return (
    <div className="page-canvas">
      <PageHeader
        description={`Every agency · ${board.day} · as of ${asOf} ${board.timeZone}`}
        actions={
          <>
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
          </>
        }
      />

      <LiveBoardView
        totals={board.totals}
        heroSub={`across ${count(board.totals.working)} of ${count(board.totals.agencies)} ${
          board.totals.agencies === 1 ? 'agency' : 'agencies'
        } working today`}
        rows={board.agencies.map(agency => ({
          id: agency.tenantId,
          name: agency.name,
          callsInFlight: agency.callsInFlight,
          deliveredToday: agency.deliveredToday,
          applicationsToday: agency.applicationsToday,
          closingPct: agency.closingPct,
          tag: agency.isNonProduction ? 'test' : undefined,
        }))}
        rowLabel="Agency"
        emptyText="No active agencies."
        error={error}
        asOf={asOf}
        footnote={
          <>
            Delivered calls and submitted applications are the figures the nightly settlement bills
            from, so this board and an agency&rsquo;s invoice can never disagree. Closing is blank
            until a call has been delivered — an agency that has taken calls and written nothing
            reads 0%, which is a different thing from a quiet morning.
          </>
        }
      />
    </div>
  );
}
