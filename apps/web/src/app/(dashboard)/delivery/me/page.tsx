'use client';

import { Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';

import { count, pct, points } from '@/components/delivery/ledger';
import { Notice, StatTile } from '@/components/domain';
import { PageHeader } from '@/components/layout/page-header';
import { useLivePoll } from '@/hooks/use-live-poll';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';

/**
 * An agent's own numbers, against the agency average.
 *
 * No pricing and no money, and that is a property of the endpoint rather than
 * of this file: `GET /api/v1/delivery/me` loads no rate, no balance, no overrun
 * and no charge, so there is nothing here to accidentally render. An agent's
 * own performance is theirs to see; what the agency pays for it is not.
 */

interface SelfView {
  calendarDay: string;
  callsTaken: number;
  applications: number;
  closingPct: number | null;
  talkTimeSeconds: number;
  /** Seconds on the queue today. Null when nothing was recorded. */
  availableSeconds: number | null;
  agencyClosingPct: number | null;
  agencyCallsTaken: number;
  agencyApplications: number;
}

function duration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Time on the queue, or an em dash when the day has no transitions recorded.
 * Absent and zero are different facts, and this is somebody's own day.
 */
function available(seconds: number | null): string {
  return seconds === null ? '—' : duration(seconds);
}

export default function MyDeliveryPage(): JSX.Element {
  const [view, setView] = useState<SelfView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await apiClient.get<Envelope<SelfView>>('/api/v1/delivery/me');
    setError(response.error ? response.error.message : null);
    setView(payload(response) ?? null);
  }, []);

  // Every agent on the floor has this open beside their softphone all day, so
  // it stops polling when the tab is not in front of them and refreshes the
  // moment it is. See `useLivePoll`.
  const { loading } = useLivePoll(load, { intervalMs: 60_000 });

  if (loading) {
    return (
      <div className="page-canvas min-h-full">
        <div className="flex flex-1 items-center justify-center py-20 t-body text-ink-3">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading your day
        </div>
      </div>
    );
  }

  if (error || !view) {
    return (
      <div className="page-canvas">
        <Notice tone={error ? 'error' : 'info'}>{error ?? 'Nothing recorded yet today.'}</Notice>
      </div>
    );
  }

  const delta =
    view.closingPct !== null && view.agencyClosingPct !== null
      ? view.closingPct - view.agencyClosingPct
      : null;

  return (
    <div className="page-canvas">
      <PageHeader
        description={`${view.calendarDay} · your calls, your applications, your closing percentage`}
      />

      {/*
        The one number: the agent's own closing percentage, against the
        agency's. Below the line is coloured, above is not — below is the
        thing to act on.
      */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <StatTile
          emphasis
          label="My closing percentage"
          data-figure-label="My closing percentage"
          data-figure-value={pct(view.closingPct)}
          figure={
            <span className={delta !== null && delta < 0 ? 'text-dropped-ink' : undefined}>
              {pct(view.closingPct)}
            </span>
          }
          sub={
            delta === null
              ? 'applications as a share of the calls you answered'
              : `${points(delta)} points against the agency's ${pct(view.agencyClosingPct)} today`
          }
        />
        <StatTile
          label="Agency today"
          data-figure-label="Agency today"
          data-figure-value={pct(view.agencyClosingPct)}
          figure={pct(view.agencyClosingPct)}
          sub={`${count(view.agencyApplications)} applications from ${count(
            view.agencyCallsTaken
          )} answered calls, across everyone`}
        />
      </div>

      <section className="space-y-3">
        <h2 className="t-section text-ink">Today</h2>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile
            label="Calls taken"
            data-figure-label="Calls taken"
            data-figure-value={count(view.callsTaken)}
            figure={count(view.callsTaken)}
            sub={`of ${count(view.agencyCallsTaken)} across the agency`}
          />
          <StatTile
            label="Applications"
            data-figure-label="Applications"
            data-figure-value={count(view.applications)}
            figure={count(view.applications)}
            sub={`of ${count(view.agencyApplications)} across the agency`}
          />
          <StatTile
            label="Talk time"
            data-figure-label="Talk time"
            data-figure-value={duration(view.talkTimeSeconds)}
            figure={duration(view.talkTimeSeconds)}
            sub="connected, today"
          />
          <StatTile
            label="On the queue"
            data-figure-label="On the queue"
            data-figure-value={available(view.availableSeconds)}
            figure={available(view.availableSeconds)}
            sub="waiting for a call, today"
          />
        </div>
      </section>
    </div>
  );
}
