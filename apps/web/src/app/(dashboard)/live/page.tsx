'use client';

import { RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { count } from '@/components/delivery/ledger';
import { PageHeader } from '@/components/layout/page-header';
import { LiveBoardLoading, LiveBoardView, formatAsOf } from '@/components/live/live-board-view';
import { Button } from '@/components/ui/button';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';

/**
 * An agency's own Live Board: its floor right now, by buyer.
 *
 * The agency counterpart of `/admin/live`, which is NetEnroll's cross-agency
 * board and stays staff-only. This one reads `/api/v1/delivery/live-board`,
 * which answers for the acting tenant on the session and nothing else -- the
 * browser never names an agency and never filters one out.
 *
 * Same presentation as the staff board (`components/live/live-board-view.tsx`)
 * so an owner and NetEnroll looking at the same agency see the same screen.
 * Polls every 30 seconds, the live strip's cadence: these figures move by the
 * delivered call, not by the second.
 */

interface AgencyBoardRow {
  id: string;
  name: string;
  kind: 'buyer' | 'agency' | 'unattributed';
  callsInFlight: number;
  deliveredToday: number;
  applicationsToday: number;
  closingPct: number | null;
}

interface AgencyBoard {
  generatedAt: string;
  day: string;
  timeZone: string;
  totals: {
    callsInFlight: number;
    deliveredToday: number;
    applicationsToday: number;
    closingPct: number | null;
  };
  rows: AgencyBoardRow[];
}

const POLL_MS = 30_000;

export default function AgencyLiveBoardPage(): JSX.Element {
  const [board, setBoard] = useState<AgencyBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const response = await apiClient.get<Envelope<AgencyBoard>>('/api/v1/delivery/live-board');
    const data = payload(response);
    if (data) {
      setBoard(data);
      setError(null);
    } else {
      // The last good board stays on screen; see the staff board for why.
      setError(response.error?.message ?? 'The board could not be refreshed.');
    }
    setLoading(false);
  }, []);

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
  const buyers = board.rows.filter(row => row.kind === 'buyer');
  const working = buyers.filter(row => row.callsInFlight > 0 || row.deliveredToday > 0).length;

  return (
    <div className="page-canvas">
      <PageHeader
        description={`Your agency · ${board.day} · as of ${asOf} ${board.timeZone}`}
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-3 w-3" />
            Refresh
          </Button>
        }
      />

      <LiveBoardView
        totals={board.totals}
        heroSub={
          buyers.length > 0
            ? `across ${count(working)} of ${count(buyers.length)} ${
                buyers.length === 1 ? 'buyer' : 'buyers'
              } working today`
            : 'on your floor right now'
        }
        rows={board.rows.map(row => ({
          id: row.id,
          name: row.name,
          callsInFlight: row.callsInFlight,
          deliveredToday: row.deliveredToday,
          applicationsToday: row.applicationsToday,
          closingPct: row.closingPct,
          pinLast: row.kind === 'unattributed',
        }))}
        rowLabel={buyers.length > 0 ? 'Buyer' : 'Agency'}
        emptyText="Nothing on the floor yet today."
        error={error}
        asOf={asOf}
        footnote={
          <>
            Delivered calls and submitted applications are the figures your nightly settlement is
            worked out from, so this board and your invoice never disagree. Unattributed is calls
            with no buyer and applications not linked to a call, so every column adds up to the
            figures above it.
          </>
        }
      />
    </div>
  );
}
