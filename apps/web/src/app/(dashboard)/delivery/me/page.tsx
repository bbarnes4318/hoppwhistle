'use client';

import { Loader2, User } from 'lucide-react';
import { useCallback, useState } from 'react';

import { Figure, FigureRow, SectionRule, count, pct, points } from '@/components/delivery/ledger';
import { CompactPageHeader, CompactPageShell } from '@/components/layout/compact-layout';
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
      <CompactPageShell>
        <div className="flex flex-1 items-center justify-center t-body text-ink-3">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading your day
        </div>
      </CompactPageShell>
    );
  }

  if (error || !view) {
    return (
      <CompactPageShell>
        <CompactPageHeader title="My day" icon={User} />
        <p className="t-body text-ink-3">{error ?? 'Nothing recorded yet today.'}</p>
      </CompactPageShell>
    );
  }

  const delta =
    view.closingPct !== null && view.agencyClosingPct !== null
      ? view.closingPct - view.agencyClosingPct
      : null;

  return (
    <CompactPageShell fullHeight={false}>
      <CompactPageHeader
        title="My day"
        subtitle={`${view.calendarDay} · your calls, your applications, your closing percentage`}
        icon={User}
      />

      {/*
        The one number: the agent's own closing percentage, against the
        agency's. Below the line is coloured, above is not — below is the
        thing to act on.
      */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:[&>*+*]:border-l md:[&>*+*]:border-rule md:[&>*+*]:pl-6">
        <Figure
          size="hero"
          label="My closing percentage"
          value={pct(view.closingPct)}
          tone={delta !== null && delta < 0 ? 'dropped' : 'ink'}
          sub={
            delta === null
              ? 'applications as a share of the calls you answered'
              : `${points(delta)} points against the agency's ${pct(view.agencyClosingPct)} today`
          }
        />
        <Figure
          label="Agency today"
          value={pct(view.agencyClosingPct)}
          sub={`${count(view.agencyApplications)} applications from ${count(
            view.agencyCallsTaken
          )} answered calls, across everyone`}
        />
      </div>

      <SectionRule>Today</SectionRule>
      <FigureRow>
        <Figure
          label="Calls taken"
          value={count(view.callsTaken)}
          sub={`of ${count(view.agencyCallsTaken)} across the agency`}
        />
        <Figure
          label="Applications"
          value={count(view.applications)}
          sub={`of ${count(view.agencyApplications)} across the agency`}
        />
        <Figure label="Talk time" value={duration(view.talkTimeSeconds)} sub="connected, today" />
        <Figure
          label="On the queue"
          value={available(view.availableSeconds)}
          sub="waiting for a call, today"
        />
      </FigureRow>
    </CompactPageShell>
  );
}
