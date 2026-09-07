'use client';

import { Loader2, User } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { CompactPageHeader, CompactPageShell } from '@/components/layout/compact-layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

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
  agencyClosingPct: number | null;
  agencyCallsTaken: number;
  agencyApplications: number;
}

function pct(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)}%`;
}

function duration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function MyDeliveryPage(): JSX.Element {
  const [view, setView] = useState<SelfView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await apiClient.get<SelfView>('/api/v1/delivery/me');
    setError(response.error ? response.error.message : null);
    setView(response.data ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  if (loading) {
    return (
      <CompactPageShell>
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
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
        <p className="text-sm text-muted-foreground">{error ?? 'Nothing recorded yet today.'}</p>
      </CompactPageShell>
    );
  }

  const aboveAverage =
    view.closingPct !== null &&
    view.agencyClosingPct !== null &&
    view.closingPct >= view.agencyClosingPct;

  return (
    <CompactPageShell fullHeight={false}>
      <CompactPageHeader
        title="My day"
        subtitle={`${view.calendarDay} · your calls, your applications, your closing percentage`}
        icon={User}
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Calls taken
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums">{view.callsTaken}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              of {view.agencyCallsTaken} across the agency
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Applications
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums">{view.applications}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              of {view.agencyApplications} across the agency
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              My closing percentage
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={cn(
                'text-3xl font-bold tabular-nums',
                view.closingPct === null
                  ? ''
                  : aboveAverage
                    ? 'text-emerald-500'
                    : 'text-amber-500'
              )}
            >
              {pct(view.closingPct)}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              agency average {pct(view.agencyClosingPct)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Talk time
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums">{duration(view.talkTimeSeconds)}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">connected, today</p>
          </CardContent>
        </Card>
      </div>
    </CompactPageShell>
  );
}
