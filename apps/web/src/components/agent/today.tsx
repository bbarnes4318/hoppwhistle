'use client';

import { ArrowRight, CheckCircle2, Loader2, Phone, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { dispositionTone } from '@/app/(dashboard)/calls/call-columns';
import { count, duration, pct, points } from '@/components/delivery/ledger';
import {
  AXIS_PROPS,
  CHART,
  EmptyState,
  GRID_PROPS,
  Notice,
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  Segmented,
  SegmentedItem,
  StatTile,
  StatusChip,
  chartTooltip,
  formatEnumLabel,
} from '@/components/domain';
import { InlineRecordingPlayer } from '@/components/domain/inline-recording-player';
import { formatPhone } from '@/components/domain/phone-cell';
import { PageHeader } from '@/components/layout/page-header';
import { usePhone } from '@/components/phone';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuth } from '@/hooks/use-auth';
import { useLivePoll } from '@/hooks/use-live-poll';
import { usePlatformContext } from '@/hooks/use-platform-context';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';
import { DISPOSITION_LABELS } from '@/lib/call-dispositions';
import { formatClock } from '@/lib/format-time';
import { cn } from '@/lib/utils';

import type {
  AgentAttentionItem,
  AgentBucket,
  AgentToday as TodayData,
  AgentTodayPeriodKey,
  AgentTotals,
} from './types';

/** Beside a softphone all day; the same cadence My day had. See `useLivePoll`. */
const REFRESH_MS = 60_000;

const PERIODS: Array<{ key: AgentTodayPeriodKey; label: string }> = [
  { key: 'TODAY', label: 'Today' },
  { key: 'YESTERDAY', label: 'Yesterday' },
  { key: 'LAST_7_DAYS', label: 'Last 7 days' },
];

function periodOf(value: string | null | undefined): AgentTodayPeriodKey {
  return PERIODS.some(p => p.key === value) ? (value as AgentTodayPeriodKey) : 'TODAY';
}

/** Where the Follow-ups due tile, and "See all follow-ups", open the CRM. */
export const FOLLOW_UPS_DUE_HREF = '/insurance-leads?tab=prospects&followUp=DUE';

/**
 * Today: an agent's first screen.
 *
 * ── The owner's Today, through the agent's lens ──────────────────────────────
 *
 * Same page, same tiles, same chart system, same period control -- different
 * numbers. Four hero figures (calls answered, applications, closing %,
 * follow-ups due), then talk time, average call and time available; the
 * agent's own production by hour; where they stand on the floor; the
 * follow-ups that need doing; and their latest calls.
 *
 * ── What is not on it, and why that is not this file's doing ─────────────────
 *
 * No revenue, profit, payout, billing, rate, buyer or publisher. The endpoint,
 * `GET /api/v1/agent/today`, never loads them -- see the header of
 * `services/agent/agent-today.ts` on the API -- so there is nothing here to
 * forget to hide. It also takes no agent id: whose day this is comes from the
 * session, which is why a platform operator previewing the agency as AGENT
 * sees exactly this screen, with their own (empty) day in it.
 *
 * ── Comparisons that mean something ──────────────────────────────────────────
 *
 * Calls and applications are compared with the server's like-for-like window
 * (TODAY against yesterday up to the same clock time), and as a count, not a
 * percentage: one call against three is "+2", not "+200%". Closing is
 * compared with the agency's closing over the same window.
 */
export function AgentToday(): JSX.Element {
  return (
    <Suspense fallback={null}>
      <TodayScreen />
    </Suspense>
  );
}

function TodayScreen(): JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const period = periodOf(searchParams?.get('period'));

  const [data, setData] = useState<TodayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const platform = usePlatformContext();
  // A white-label agency's agents have no Leaderboard, so no standing on it.
  const { isWhiteLabelAgent } = useAuth();

  // The period the screen is showing now; an answer for another one is dropped.
  const periodRef = useRef(period);
  periodRef.current = period;

  const load = useCallback(async () => {
    const asked = periodRef.current;
    const response = await apiClient.get<Envelope<TodayData>>(
      `/api/v1/agent/today?period=${asked}`
    );
    if (asked !== periodRef.current) return 'ok' as const;
    if (response.error) {
      setError(response.error.message);
      return response.error.code === 'NO_ACTING_TENANT'
        ? ('refused' as const)
        : ('failed' as const);
    }
    setError(null);
    setData(payload(response) ?? null);
    return 'ok' as const;
  }, []);

  const { loading, refresh } = useLivePoll(load, {
    intervalMs: REFRESH_MS,
    enabled: !platform.loading && !platform.needsAgency,
  });

  // A new period is read at once, not at the next tick.
  const firstPeriod = useRef(true);
  useEffect(() => {
    if (firstPeriod.current) {
      firstPeriod.current = false;
      return;
    }
    setData(current => (current && current.period.key === period ? current : null));
    refresh();
  }, [period, refresh]);

  function choose(next: AgentTodayPeriodKey): void {
    if (next === period) return;
    const query = new URLSearchParams(searchParams?.toString() ?? '');
    if (next === 'TODAY') query.delete('period');
    else query.set('period', next);
    const qs = query.toString();
    router.replace(`${pathname ?? ''}${qs ? `?${qs}` : ''}`, { scroll: false });
  }

  if (platform.needsAgency) {
    return (
      <div className="page-canvas">
        <Notice title="Select an agency to see an agent's day." />
      </div>
    );
  }

  const shown = data && data.period.key === period ? data : null;
  const busy = loading && !shown;

  return (
    <div className="page-canvas" data-testid="agent-today" data-period={period}>
      <PageHeader
        description="Your production, follow-ups and pace for the day."
        actions={
          <>
            <Segmented role="group" aria-label="Period">
              {PERIODS.map(option => (
                <SegmentedItem
                  key={option.key}
                  active={option.key === period}
                  aria-pressed={option.key === period}
                  onClick={() => choose(option.key)}
                >
                  {option.label}
                </SegmentedItem>
              ))}
            </Segmented>
            <Button variant="outline" size="sm" onClick={refresh} disabled={busy}>
              <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', busy && 'animate-spin')} />
              Refresh
            </Button>
            <span className="t-meta text-ink-3" data-updated>
              {shown ? `Updated ${formatClock(shown.generatedAt)}` : ' '}
            </span>
          </>
        }
      />

      {error ? <Notice tone="error" title={error} /> : null}

      <HeroFigures data={shown} busy={busy} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Production
          data={shown}
          period={period}
          className={isWhiteLabelAgent ? 'lg:col-span-12' : 'lg:col-span-8'}
        />
        {isWhiteLabelAgent ? null : (
          <Standing data={shown} period={period} className="lg:col-span-4" />
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {/* Recent calls is the wider half: it carries a player in every row. */}
        <NeedsYourAttention data={data} className="xl:col-span-4" />
        <RecentCalls data={shown} period={period} className="xl:col-span-8" />
      </div>
    </div>
  );
}

/* ── Formatting ───────────────────────────────────────────────────────────── */

/** Hours and minutes: "1h 58m", "4m", "0m". For spans of a working day. */
export function hoursMinutes(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** A difference in counts, as the delta chip reads it. Never a percentage. */
function countDelta(
  now: number,
  then: number
): { value: string; direction: 'up' | 'down' | 'flat'; good: 'up' } {
  const diff = now - then;
  return {
    value: diff === 0 ? 'Even' : `${diff > 0 ? '+' : '−'}${count(Math.abs(diff))}`,
    direction: diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat',
    good: 'up',
  };
}

/** Applications as a share of calls for one day; null when there were no calls. */
function closingOf(calls: number, applications: number): number | null {
  return calls > 0 ? (applications / calls) * 100 : null;
}

/* ── Row 1: the numbers ───────────────────────────────────────────────────── */

function HeroFigures({ data, busy }: { data: TodayData | null; busy: boolean }): JSX.Element {
  const s = data?.summary;
  const c: (AgentTotals & { label: string }) | undefined = data?.comparison;
  const against = c ? `vs ${c.label}` : undefined;
  const trend = data?.trend ?? [];
  const agency = data?.agencyBenchmark.closingPct ?? null;
  const gap = s && s.closingPct !== null && agency !== null ? s.closingPct - agency : null;
  const text = (value: string) => (data ? value : '—');

  return (
    <section aria-label="Your day at a glance" className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatTile
          size="hero"
          label="Calls answered"
          loading={busy}
          figure={text(count(s?.callsAnswered))}
          data-figure-label="Calls answered"
          data-figure-value={count(s?.callsAnswered)}
          delta={s && c ? countDelta(s.callsAnswered, c.callsAnswered) : null}
          deltaLabel={against}
          series={trend.map(d => d.callsTaken)}
        />
        <StatTile
          size="hero"
          label="Applications"
          loading={busy}
          figure={text(count(s?.applications))}
          data-figure-label="Applications"
          data-figure-value={count(s?.applications)}
          delta={s && c ? countDelta(s.applications, c.applications) : null}
          deltaLabel={against}
          series={trend.map(d => d.applications)}
        />
        <StatTile
          size="hero"
          label="Closing %"
          loading={busy}
          figure={text(pct(s?.closingPct ?? null, 1))}
          data-figure-label="Closing %"
          data-figure-value={pct(s?.closingPct ?? null, 1)}
          delta={
            gap === null
              ? null
              : {
                  value: `${points(gap)} pts`,
                  direction: gap > 0 ? 'up' : gap < 0 ? 'down' : 'flat',
                  good: 'up',
                }
          }
          deltaLabel={gap === null ? undefined : `vs agency ${pct(agency, 1)}`}
          sub={
            gap === null && data
              ? s && s.callsAnswered === 0
                ? `No calls answered · agency ${pct(agency, 1)}`
                : `Agency ${pct(agency, 1)}`
              : undefined
          }
          series={trend.map(d => closingOf(d.callsTaken, d.applications) ?? 0)}
        />
        <Link
          href={FOLLOW_UPS_DUE_HREF}
          aria-label={`Follow-ups due: ${count(s?.followUpsDue)}. Open them in the CRM`}
          className="flex rounded-card text-left transition-shadow hover:shadow-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink [&>*]:flex-1"
          data-follow-ups-link
        >
          <StatTile
            size="hero"
            label="Follow-ups due"
            loading={busy}
            figure={text(count(s?.followUpsDue))}
            data-figure-label="Follow-ups due"
            data-figure-value={count(s?.followUpsDue)}
            sub={
              <span className="inline-flex items-center gap-1">
                Today or overdue · Open in CRM
                <ArrowRight aria-hidden className="h-3 w-3" />
              </span>
            }
          />
        </Link>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile
          label="Talk time"
          loading={busy}
          figure={text(s ? hoursMinutes(s.talkTimeSeconds) : '—')}
          data-figure-label="Talk time"
          data-figure-value={s ? hoursMinutes(s.talkTimeSeconds) : '—'}
          sub={c ? `Connected · ${hoursMinutes(c.talkTimeSeconds)} ${c.label}` : 'Connected'}
        />
        <StatTile
          label="Average call"
          loading={busy}
          figure={text(s?.averageCallSeconds == null ? '—' : duration(s.averageCallSeconds))}
          data-figure-label="Average call"
          data-figure-value={s?.averageCallSeconds == null ? '—' : duration(s.averageCallSeconds)}
          sub="Connected time per answered call"
        />
        <StatTile
          label="Time available"
          loading={busy}
          figure={text(s?.availableSeconds == null ? '—' : hoursMinutes(s.availableSeconds))}
          data-figure-label="Time available"
          data-figure-value={s?.availableSeconds == null ? '—' : hoursMinutes(s.availableSeconds)}
          sub={
            s && s.availableSeconds == null
              ? 'Nothing recorded on the queue'
              : 'Ready on the queue, from your softphone'
          }
        />
      </div>
    </section>
  );
}

/* ── Row 2: production, and standing ──────────────────────────────────────── */

function hourLabel(hour: number): string {
  if (hour === 0) return '12a';
  if (hour === 12) return '12p';
  return hour < 12 ? `${hour}a` : `${hour - 12}p`;
}

function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const weekday = new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short' });
  return `${weekday} ${d}`;
}

/** The hours worth drawing: 8a to 8p, widened to any hour with activity. */
export function visibleBuckets(rows: AgentBucket[], byDay: boolean): AgentBucket[] {
  if (byDay) return rows;
  const busyHours = rows
    .filter(row => row.callsAnswered + row.applications > 0)
    .map(row => row.hour ?? 0);
  const first = Math.min(8, ...busyHours);
  const last = Math.max(20, ...busyHours);
  return rows.filter(row => (row.hour ?? 0) >= first && (row.hour ?? 0) <= last);
}

/** A dot only where an application was written: a row of dots on zero is noise. */
function ApplicationDot(props: { cx?: number; cy?: number; value?: number; index?: number }) {
  if (!props.value || props.cx === undefined || props.cy === undefined) {
    return <g key={`dot-${props.index ?? 0}`} />;
  }
  return (
    <circle
      key={`dot-${props.index ?? 0}`}
      cx={props.cx}
      cy={props.cy}
      r={3.5}
      fill={CHART.brand}
      stroke="var(--surface)"
      strokeWidth={1.5}
    />
  );
}

const SERIES = [
  { key: 'callsAnswered', label: 'Calls answered', color: CHART.agents },
  { key: 'applications', label: 'Applications', color: CHART.brand },
] as const;

function Production({
  data,
  period,
  className,
}: {
  data: TodayData | null;
  period: AgentTodayPeriodKey;
  className?: string;
}): JSX.Element {
  const byDay = period === 'LAST_7_DAYS';
  const rows = data?.byHour ?? [];
  const chartRows = visibleBuckets(rows, byDay).map(row => ({
    ...row,
    label: byDay ? dayLabel(row.day ?? '') : hourLabel(row.hour ?? 0),
  }));
  const totals = {
    callsAnswered: rows.reduce((sum, row) => sum + row.callsAnswered, 0),
    applications: rows.reduce((sum, row) => sum + row.applications, 0),
  };
  const empty = data !== null && totals.callsAnswered + totals.applications === 0;

  return (
    <Panel className={cn('min-w-0', className)}>
      <PanelHeader>
        <PanelTitle>{byDay ? 'Your production by day' : 'Your production by hour'}</PanelTitle>
        <PanelDescription>
          {data
            ? empty
              ? `Nothing answered ${period === 'TODAY' ? 'yet today' : 'in this period'}.`
              : 'Calls you answered, and the applications you wrote.'
            : ' '}
        </PanelDescription>
      </PanelHeader>
      <PanelBody className="flex flex-col gap-4">
        <div className="h-[240px] w-full min-w-0" data-chart="agent-production">
          {data ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartRows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="label" {...AXIS_PROPS} interval={byDay ? 0 : 'preserveStartEnd'} />
                <YAxis {...AXIS_PROPS} allowDecimals={false} width={32} />
                <Tooltip cursor={{ fill: 'var(--sunken)' }} content={chartTooltip({})} />
                <Bar
                  dataKey="callsAnswered"
                  name="Calls answered"
                  fill={CHART.agents}
                  radius={[3, 3, 0, 0]}
                  maxBarSize={byDay ? 48 : 22}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="applications"
                  name="Applications"
                  type="monotone"
                  stroke={CHART.brand}
                  strokeWidth={2}
                  dot={ApplicationDot}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : null}
        </div>
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Your production">
          {SERIES.map(series => (
            <div key={series.key} className="min-w-0">
              <dt className="flex items-center gap-2 t-caption text-ink-2">
                <span
                  aria-hidden
                  className={cn(
                    'shrink-0',
                    series.key === 'applications'
                      ? 'h-0.5 w-3 rounded-full'
                      : 'h-2 w-2 rounded-full'
                  )}
                  style={{ backgroundColor: series.color }}
                />
                {series.label}
              </dt>
              <dd
                className={cn(
                  't-body font-medium tabular-nums',
                  totals[series.key] > 0 ? 'text-ink' : 'text-ink-3'
                )}
                data-part={series.key}
              >
                {data ? count(totals[series.key]) : '—'}
              </dd>
            </div>
          ))}
        </dl>
      </PanelBody>
    </Panel>
  );
}

/** The Leaderboard over the same window as this page. */
function leaderboardHref(data: TodayData | null, period: AgentTodayPeriodKey): string {
  if (period === 'LAST_7_DAYS') {
    return data
      ? `/leaderboard?period=CUSTOM&from=${data.period.from}&to=${data.period.to}`
      : '/leaderboard';
  }
  return `/leaderboard?period=${period}`;
}

function SeeAll({ href, label }: { href: string; label: string }): JSX.Element {
  return (
    <Link
      href={href}
      className="inline-flex min-h-[32px] items-center gap-1 t-meta font-medium text-brand-ink hover:underline"
    >
      {label}
      <ArrowRight aria-hidden className="h-3 w-3" />
    </Link>
  );
}

function Standing({
  data,
  period,
  className,
}: {
  data: TodayData | null;
  period: AgentTodayPeriodKey;
  className?: string;
}): JSX.Element {
  const standing = data?.standing ?? null;
  const ranked = standing?.rank != null;
  return (
    <Panel className={cn('flex min-w-0 flex-col', className)} data-standing>
      <PanelHeader action={<SeeAll href={leaderboardHref(data, period)} label="Leaderboard" />}>
        <PanelTitle>Your standing</PanelTitle>
        <PanelDescription>On the floor, over the same period</PanelDescription>
      </PanelHeader>
      <PanelBody className="flex flex-1 flex-col gap-5">
        <div>
          <div className="t-caption text-ink-2">Rank</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              className={cn('t-kpi-hero', ranked ? 'text-ink' : 'text-ink-3')}
              data-figure-label="Rank"
              data-figure-value={ranked ? `#${standing?.rank}` : '—'}
            >
              {ranked ? `#${standing?.rank}` : '—'}
            </span>
            {standing && standing.ranked > 0 ? (
              <span className="t-meta text-ink-3">of {count(standing.ranked)} on the floor</span>
            ) : null}
          </div>
          <p className="t-meta mt-1.5 text-ink-2" data-next-place>
            {!data
              ? ' '
              : !ranked
                ? 'Take a call to get on the board.'
                : standing?.next
                  ? `${standing.next.pointsBehind.toLocaleString()} ${
                      standing.next.pointsBehind === 1 ? 'point' : 'points'
                    } behind #${standing.next.rank}`
                  : 'Top of the floor.'}
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-4 border-t border-rule pt-4">
          {[
            { label: 'Points', value: standing ? count(standing.points) : '—' },
            { label: 'Calls', value: standing ? count(standing.calls) : '—' },
            { label: 'Applications', value: standing ? count(standing.applications) : '—' },
            { label: 'Closing %', value: standing ? pct(standing.closingPct, 1) : '—' },
          ].map(item => (
            <div key={item.label}>
              <dt className="t-caption text-ink-2">{item.label}</dt>
              <dd className="t-body font-medium tabular-nums text-ink">{item.value}</dd>
            </div>
          ))}
        </dl>
      </PanelBody>
    </Panel>
  );
}

/* ── Row 3: what to do next, and what just happened ───────────────────────── */

const STAGE_WORDS: Record<string, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  QUALIFIED: 'Qualified',
};

function stageLabel(stage: string | null): string {
  if (!stage) return 'Prospect';
  return STAGE_WORDS[stage] ?? formatEnumLabel(stage);
}

/** "Overdue · Sep 28" or "Due 3:00 PM". */
export function dueText(
  item: Pick<AgentAttentionItem, 'dueAt' | 'overdue'>,
  now = new Date()
): string {
  const due = new Date(item.dueAt);
  const sameDay = due.toDateString() === now.toDateString();
  if (!item.overdue) return `Due ${formatClock(due)}`;
  if (sameDay) return `Overdue · ${formatClock(due)}`;
  return `Overdue · ${due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

function NeedsYourAttention({
  data,
  className,
}: {
  data: TodayData | null;
  className?: string;
}): JSX.Element {
  const { makeCall } = usePhone();
  const { isReadOnlyPreview } = useAuth();
  const items = data?.attention ?? [];
  const more = data ? data.summary.followUpsDue - items.length : 0;

  return (
    <Panel className={cn('flex min-w-0 flex-col', className)} data-needs-attention>
      <PanelHeader
        action={
          data && data.summary.followUpsDue > 0 ? (
            <SeeAll href={FOLLOW_UPS_DUE_HREF} label="All follow-ups" />
          ) : null
        }
      >
        <PanelTitle>Needs your attention</PanelTitle>
        <PanelDescription>Follow-ups due today or overdue, oldest first</PanelDescription>
      </PanelHeader>
      <PanelBody flush className="flex-1">
        {!data ? null : items.length === 0 ? (
          <p
            className="m-4 flex items-center gap-2 rounded-card bg-live-tint px-4 py-3 t-body text-live-ink"
            data-all-clear
          >
            <CheckCircle2 aria-hidden className="h-4 w-4 shrink-0" />
            You&apos;re caught up. No follow-ups are due.
          </p>
        ) : (
          <ul className="divide-y divide-rule" aria-label="Follow-ups due">
            {items.map(item => (
              <li
                key={item.leadId}
                data-attention={item.kind}
                className="flex items-center gap-3 px-5 py-3 min-[1440px]:px-6"
              >
                <span
                  aria-hidden
                  className={cn(
                    'h-8 w-1 shrink-0 rounded-full',
                    item.overdue ? 'bg-dropped' : 'bg-entity-unanswered'
                  )}
                />
                <Link
                  href={`/insurance-leads/${encodeURIComponent(item.leadId)}`}
                  className="min-w-0 flex-1 rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink"
                >
                  <span className="block truncate t-body font-medium text-ink hover:underline">
                    {item.name}
                  </span>
                  <span className="block truncate t-meta text-ink-2">
                    {stageLabel(item.stage)} ·{' '}
                    <span className={item.overdue ? 'text-dropped-ink' : 'text-ink-2'}>
                      {dueText(item)}
                    </span>
                  </span>
                </Link>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 shrink-0"
                  disabled={isReadOnlyPreview}
                  onClick={() => void makeCall(item.phone)}
                  aria-label={`Call ${item.name}`}
                >
                  <Phone aria-hidden className="mr-1.5 h-3.5 w-3.5" />
                  Call
                </Button>
              </li>
            ))}
            {more > 0 ? (
              <li className="px-5 py-2.5 t-meta text-ink-3 min-[1440px]:px-6">
                {`and ${count(more)} more in the CRM`}
              </li>
            ) : null}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}

/**
 * The recording column: a player when there is a file, "Processing" while the
 * file is still being stored, and a dash for a call that was never recorded.
 */
function RecordingCell({ call }: { call: TodayData['recentCalls'][number] }): JSX.Element {
  if (call.recording) {
    return (
      <InlineRecordingPlayer
        recordingId={call.recording.id}
        durationSeconds={call.recording.durationSeconds ?? call.connectedSeconds}
        label={call.caller ? formatPhone(call.caller) : undefined}
        compact
      />
    );
  }
  if (call.recordingPending) {
    return (
      <span
        className="inline-flex items-center gap-1.5 t-meta text-ink-3"
        title="The recording is still being saved. It will appear here shortly."
      >
        <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
        Processing
      </span>
    );
  }
  return (
    <span className="t-meta text-ink-3" title="This call was not recorded">
      Not recorded
    </span>
  );
}

function RecentCalls({
  data,
  period,
  className,
}: {
  data: TodayData | null;
  period: AgentTodayPeriodKey;
  className?: string;
}): JSX.Element {
  const rows = data?.recentCalls ?? [];
  const sameDay = period !== 'LAST_7_DAYS';
  return (
    <Panel className={cn('min-w-0', className)} data-recent-calls>
      <PanelHeader action={<SeeAll href="/calls" label="View all calls" />}>
        <PanelTitle>Recent calls</PanelTitle>
        <PanelDescription>Your latest calls in the period, with their recordings</PanelDescription>
      </PanelHeader>
      <PanelBody flush>
        {!data ? null : rows.length === 0 ? (
          <EmptyState
            headline={period === 'TODAY' ? 'No calls yet today.' : 'No calls in this period.'}
            body="Calls you answer show up here with their disposition."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Caller</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Duration</TableHead>
                <TableHead>Disposition</TableHead>
                <TableHead className="hidden md:table-cell">Application</TableHead>
                <TableHead className="min-w-[132px] sm:w-[176px] sm:min-w-[160px]">
                  Recording
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(call => (
                <TableRow key={call.id} data-call={call.id}>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {sameDay
                      ? formatClock(call.at)
                      : `${new Date(call.at).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}, ${formatClock(call.at)}`}
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">
                    {call.caller ? formatPhone(call.caller) : '—'}
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap text-right tabular-nums sm:table-cell">
                    {call.connectedSeconds ? duration(call.connectedSeconds) : '—'}
                  </TableCell>
                  <TableCell>
                    {call.disposition ? (
                      <StatusChip
                        size="sm"
                        value={call.disposition}
                        tone={dispositionTone(call.disposition)}
                        label={
                          DISPOSITION_LABELS[call.disposition] ?? formatEnumLabel(call.disposition)
                        }
                      />
                    ) : (
                      <span className="t-meta text-ink-3">Not set</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell" data-application={call.application}>
                    {call.application ? (
                      <span className="inline-flex items-center gap-1 t-meta font-medium text-live-ink">
                        <CheckCircle2 aria-hidden className="h-3.5 w-3.5" />
                        Submitted
                      </span>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </TableCell>
                  <TableCell className="py-2" data-recording={call.recording?.id ?? 'none'}>
                    <RecordingCell call={call} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </PanelBody>
    </Panel>
  );
}
