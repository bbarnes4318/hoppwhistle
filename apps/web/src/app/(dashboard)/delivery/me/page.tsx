'use client';

import { RefreshCw } from 'lucide-react';
import { useCallback, useState } from 'react';

import { count, pct, points } from '@/components/delivery/ledger';
import {
  Notice,
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  StatTile,
} from '@/components/domain';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useLivePoll } from '@/hooks/use-live-poll';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';
import { formatClock } from '@/lib/format-time';
import { cn } from '@/lib/utils';

/**
 * An agent's own numbers, against the agency average.
 *
 * No pricing and no money, and that is a property of the endpoint rather than
 * of this file: `GET /api/v1/delivery/me` loads no rate, no balance, no overrun
 * and no charge, so there is nothing here to accidentally render. An agent's
 * own performance is theirs to see; what the agency pays for it is not.
 *
 * ── Why no "up 12% on yesterday" ─────────────────────────────────────────────
 *
 * Today is half a day when somebody looks at it, and yesterday is a whole one,
 * so a percentage between them says "down" every morning. The figures carry
 * what yesterday was, as a fact, and the shape of the week beside it; the one
 * comparison that is fair while the day is running is the closing percentage
 * against the agency's, which is measured over the same hours.
 */

interface DayFigures {
  day: string;
  callsTaken: number;
  applications: number;
  talkTimeSeconds: number;
}

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
  /** The last seven days, oldest first, the last being `calendarDay`. */
  trend?: DayFigures[];
}

/** Often enough to sit beside a softphone all day; see `useLivePoll`. */
const REFRESH_MS = 60_000;

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

/** A New York day key as "Tue, Sep 29". Read in UTC: the key is a date, not an instant. */
function dayLabel(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  if (!year || !month || !day) return key;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function dayLong(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  if (!year || !month || !day) return key;
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** Applications as a share of calls for one day; null when there were no calls. */
function closing(day: DayFigures): number | null {
  return day.callsTaken > 0 ? (day.applications / day.callsTaken) * 100 : null;
}

export default function MyDeliveryPage(): JSX.Element {
  const [view, setView] = useState<SelfView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    const response = await apiClient.get<Envelope<SelfView>>('/api/v1/delivery/me');
    setError(response.error ? response.error.message : null);
    setView(payload(response) ?? null);
    if (!response.error) setUpdatedAt(new Date());
  }, []);

  // Every agent on the floor has this open beside their softphone all day, so
  // it stops polling when the tab is not in front of them and refreshes the
  // moment it is. See `useLivePoll`.
  const { loading, refresh } = useLivePoll(load, { intervalMs: REFRESH_MS });

  if (loading && !view) {
    return (
      <div className="page-canvas">
        <PageHeader description="Your calls, your applications, your closing percentage." />
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {['Applications', 'My closing percentage', 'Calls taken', 'Talk time'].map(label => (
            <StatTile key={label} size="hero" label={label} loading />
          ))}
        </div>
      </div>
    );
  }

  if (error || !view) {
    return (
      <div className="page-canvas">
        <PageHeader description="Your calls, your applications, your closing percentage." />
        <Notice tone={error ? 'error' : 'info'}>{error ?? 'Nothing recorded yet today.'}</Notice>
      </div>
    );
  }

  const trend = view.trend ?? [];
  const yesterday = trend.length >= 2 ? trend[trend.length - 2] : null;
  const series = (pick: (d: DayFigures) => number) => trend.map(pick);
  const yesterdayText = (pick: (d: DayFigures) => string) =>
    yesterday ? `Yesterday ${pick(yesterday)}` : undefined;

  const gap =
    view.closingPct !== null && view.agencyClosingPct !== null
      ? view.closingPct - view.agencyClosingPct
      : null;
  const averageCall =
    view.callsTaken > 0 ? duration(Math.round(view.talkTimeSeconds / view.callsTaken)) : '—';

  return (
    <div className="page-canvas" data-testid="my-day">
      <PageHeader
        description={`${dayLong(view.calendarDay)} · your calls, your applications, your closing percentage.`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
              <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', loading && 'animate-spin')} />
              Refresh
            </Button>
            <span className="t-meta text-ink-3">
              {updatedAt ? `Updated ${formatClock(updatedAt)}` : ' '}
            </span>
          </>
        }
      />

      {/*
        The four numbers. Applications first: it is what the day is for. The
        closing percentage carries the one fair comparison -- against the
        agency, over the same hours -- and below the line is the thing to act
        on, so that is the only place a delta is coloured.
      */}
      <section aria-label="Today at a glance" className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatTile
          size="hero"
          label="Applications"
          data-figure-label="Applications"
          data-figure-value={count(view.applications)}
          figure={count(view.applications)}
          sub={
            yesterdayText(d => count(d.applications)) ??
            `of ${count(view.agencyApplications)} across the agency`
          }
          series={series(d => d.applications)}
        />
        <StatTile
          size="hero"
          label="My closing percentage"
          data-figure-label="My closing percentage"
          data-figure-value={pct(view.closingPct)}
          figure={pct(view.closingPct)}
          delta={
            gap === null
              ? null
              : {
                  value: `${points(gap)} pts`,
                  direction: gap > 0 ? 'up' : gap < 0 ? 'down' : 'flat',
                  good: 'up',
                }
          }
          deltaLabel={`vs agency ${pct(view.agencyClosingPct)}`}
          series={trend.length > 0 ? trend.map(d => closing(d) ?? 0) : undefined}
        />
        <StatTile
          size="hero"
          label="Calls taken"
          data-figure-label="Calls taken"
          data-figure-value={count(view.callsTaken)}
          figure={count(view.callsTaken)}
          sub={
            yesterdayText(d => count(d.callsTaken)) ??
            `of ${count(view.agencyCallsTaken)} across the agency`
          }
          series={series(d => d.callsTaken)}
        />
        <StatTile
          size="hero"
          label="Talk time"
          data-figure-label="Talk time"
          data-figure-value={duration(view.talkTimeSeconds)}
          figure={duration(view.talkTimeSeconds)}
          sub={yesterdayText(d => duration(d.talkTimeSeconds)) ?? 'connected, today'}
          series={series(d => d.talkTimeSeconds)}
        />
      </section>

      <section aria-label="Today, in more detail" className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatTile
          label="On the queue"
          data-figure-label="On the queue"
          data-figure-value={available(view.availableSeconds)}
          figure={available(view.availableSeconds)}
          sub="waiting for a call, today"
        />
        <StatTile
          label="Average call"
          data-figure-label="Average call"
          data-figure-value={averageCall}
          figure={averageCall}
          sub="connected time per call"
        />
        <StatTile
          label="Agency closing"
          data-figure-label="Agency today"
          data-figure-value={pct(view.agencyClosingPct)}
          figure={pct(view.agencyClosingPct)}
          sub={`${count(view.agencyApplications)} applications from ${count(
            view.agencyCallsTaken
          )} answered calls`}
        />
      </section>

      {trend.length > 0 ? <LastSevenDays days={trend} today={view.calendarDay} /> : null}
    </div>
  );
}

/* ── The week, day by day ─────────────────────────────────────────────────── */

function LastSevenDays({ days, today }: { days: DayFigures[]; today: string }): JSX.Element {
  // Newest first: the day you are in is the first row you read.
  const rows = [...days].reverse();
  const cell = (n: number) => cn('text-right tabular-nums', n === 0 && 'text-ink-3');
  return (
    <Panel className="min-w-0" data-testid="my-last-seven-days">
      <PanelHeader>
        <PanelTitle>Your last 7 days</PanelTitle>
        <PanelDescription>Calls you answered and applications you wrote, by day</PanelDescription>
      </PanelHeader>
      <PanelBody flush>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Day</TableHead>
              <TableHead className="text-right">Calls</TableHead>
              <TableHead className="text-right">Applications</TableHead>
              <TableHead className="text-right">Closing</TableHead>
              <TableHead className="text-right">Talk time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(day => {
              const share = closing(day);
              return (
                <TableRow key={day.day} data-day={day.day}>
                  <TableCell>
                    {dayLabel(day.day)}
                    {day.day === today ? (
                      <span className="ml-2 t-meta text-ink-3">today so far</span>
                    ) : null}
                  </TableCell>
                  <TableCell className={cell(day.callsTaken)}>{count(day.callsTaken)}</TableCell>
                  <TableCell className={cell(day.applications)}>
                    {count(day.applications)}
                  </TableCell>
                  <TableCell className={cell(share ?? 0)}>{pct(share)}</TableCell>
                  <TableCell className={cell(day.talkTimeSeconds)}>
                    {duration(day.talkTimeSeconds)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </PanelBody>
    </Panel>
  );
}
