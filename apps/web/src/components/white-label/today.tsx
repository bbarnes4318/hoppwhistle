'use client';

import { ArrowRight, CheckCircle2, RefreshCw } from 'lucide-react';
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

import { count, duration, pct } from '@/components/delivery/ledger';
import {
  AXIS_PROPS,
  CHART,
  COMPARISON_LINE,
  EmptyState,
  EntityBadge,
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
  chartTooltip,
  percentChange,
  tileDollars,
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
import { usePlatformContext } from '@/hooks/use-platform-context';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';
import { formatClock, formatDisplayDate } from '@/lib/format-time';
import { cn } from '@/lib/utils';

import type { WhiteLabelToday as TodayData, TodayPeriodKey } from './types';

/** Often enough to watch; the server caches each agency's answer for 15s. */
const REFRESH_MS = 30_000;

const PERIODS: Array<{ key: TodayPeriodKey; label: string }> = [
  { key: 'TODAY', label: 'Today' },
  { key: 'YESTERDAY', label: 'Yesterday' },
  { key: 'LAST_7_DAYS', label: 'Last 7 days' },
];

function periodOf(value: string | null | undefined): TodayPeriodKey {
  return PERIODS.some(p => p.key === value) ? (value as TodayPeriodKey) : 'TODAY';
}

const OUTCOMES = [
  { key: 'agents', label: 'Your agents', color: CHART.agents },
  { key: 'buyers', label: 'Buyers', color: CHART.buyers },
  { key: 'unanswered', label: 'Unanswered', color: CHART.unanswered },
  { key: 'blocked', label: 'Blocked', color: CHART.blocked },
] as const;

/**
 * Today: a white-label owner's first screen.
 *
 * ── What is on it ────────────────────────────────────────────────────────────
 *
 * Four hero figures (inbound calls, revenue, profit, applications), each
 * against its comparison and over the last seven days; calls by hour, split by
 * where they went; who is live right now; what needs a decision; and the
 * period's buyers and publishers. One endpoint, `GET
 * /api/v1/white-label/today?period=`, builds all of it; nothing is computed
 * here beyond a percentage change.
 *
 * ── The period ───────────────────────────────────────────────────────────────
 *
 * Today, Yesterday or the last seven days, in the URL (`?period=`) so a link
 * opens the same view. A period with no calls keeps its layout: the
 * comparison and the trend still say something, and nothing reads 0.0%.
 */
export function WhiteLabelToday(): JSX.Element {
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

  // The period the screen is showing now; an answer for another one is dropped.
  const periodRef = useRef(period);
  periodRef.current = period;

  const load = useCallback(async () => {
    const asked = periodRef.current;
    const response = await apiClient.get<Envelope<TodayData>>(
      `/api/v1/white-label/today?period=${asked}`
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

  function choose(next: TodayPeriodKey): void {
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
        <Notice title="Select an agency to see its day." />
      </div>
    );
  }

  const shown = data && data.period.key === period ? data : null;
  const busy = loading && !shown;

  return (
    <div className="page-canvas" data-testid="white-label-today" data-period={period}>
      <PageHeader
        description="Your calls, agents, buyers and money, and what needs you."
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
        <CallsByHour data={shown} period={period} className="lg:col-span-8" />
        <LiveNow data={data} className="lg:col-span-4" />
      </div>

      <NeedsAttention data={data} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <BuyersTable data={shown} />
        <PublishersTable data={shown} />
      </div>
    </div>
  );
}

/* ── Row 1: the four numbers ──────────────────────────────────────────────── */

function HeroFigures({ data, busy }: { data: TodayData | null; busy: boolean }): JSX.Element {
  const against = data ? `vs ${data.comparison.label}` : undefined;
  const series = (key: 'inbound' | 'revenue' | 'profit' | 'applications') =>
    data ? data.trend.map(row => row[key]) : [];
  const change = (key: 'inbound' | 'revenue' | 'profit' | 'applications') =>
    data ? percentChange(data.today[key], data.comparison[key]) : null;
  const text = (value: string) => (data ? value : '—');

  return (
    <section aria-label="The period at a glance" className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatTile
          size="hero"
          label="Inbound calls"
          loading={busy}
          figure={text(count(data?.today.inbound))}
          data-figure-label="Inbound calls"
          data-figure-value={count(data?.today.inbound)}
          delta={change('inbound')}
          deltaLabel={against}
          series={series('inbound')}
        />
        <StatTile
          size="hero"
          label="Revenue"
          tone="money"
          loading={busy}
          figure={text(tileDollars(data?.today.revenue))}
          data-figure-label="Revenue"
          data-figure-value={tileDollars(data?.today.revenue)}
          delta={change('revenue')}
          deltaLabel={against}
          series={series('revenue')}
        />
        <StatTile
          size="hero"
          label="Profit"
          tone="money"
          loading={busy}
          figure={text(tileDollars(data?.today.profit))}
          data-figure-label="Profit"
          data-figure-value={tileDollars(data?.today.profit)}
          delta={change('profit')}
          deltaLabel={against}
          series={series('profit')}
        />
        <StatTile
          size="hero"
          label="Applications"
          loading={busy}
          figure={text(count(data?.today.applications))}
          data-figure-label="Applications"
          data-figure-value={count(data?.today.applications)}
          delta={change('applications')}
          deltaLabel={against}
          series={series('applications')}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile
          label="Closing %"
          loading={busy}
          figure={text(pct(data?.today.closingPct ?? null, 1))}
          data-figure-label="Closing %"
          data-figure-value={pct(data?.today.closingPct ?? null, 1)}
          sub="Applications ÷ calls your agents answered"
        />
        <StatTile
          label="Billable calls"
          loading={busy}
          figure={text(count(data?.today.billable))}
          data-figure-label="Billable calls"
          data-figure-value={count(data?.today.billable)}
          sub={
            data && data.today.inbound > 0
              ? `${pct((data.today.billable / data.today.inbound) * 100, 1)} of inbound`
              : 'Of inbound calls'
          }
        />
        <StatTile
          label="Avg call length"
          loading={busy}
          figure={text(
            data?.today.avgCallSeconds == null ? '—' : duration(data.today.avgCallSeconds)
          )}
          data-figure-label="Avg call length"
          sub="Connected time, answered calls"
        />
      </div>
    </section>
  );
}

/* ── Row 2: calls by hour, and live now ───────────────────────────────────── */

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

function CallsByHour({
  data,
  period,
  className,
}: {
  data: TodayData | null;
  period: TodayPeriodKey;
  className?: string;
}): JSX.Element {
  const byDay = period === 'LAST_7_DAYS';

  // A day's hours from 6am to 10pm, widened to any hour that has calls.
  const rows = data?.byHour ?? [];
  const busyHours = rows
    .filter(row => row.agents + row.buyers + row.unanswered + row.blocked + row.comparison > 0)
    .map(row => row.hour ?? 0);
  const firstHour = Math.min(6, ...busyHours);
  const lastHour = Math.max(22, ...busyHours);
  const visible = byDay
    ? rows
    : rows.filter(row => (row.hour ?? 0) >= firstHour && (row.hour ?? 0) <= lastHour);
  const chartRows = visible.map(row => ({
    ...row,
    label: byDay ? dayLabel(row.day ?? '') : hourLabel(row.hour ?? 0),
  }));

  const totals = {
    agents: rows.reduce((sum, row) => sum + row.agents, 0),
    buyers: rows.reduce((sum, row) => sum + row.buyers, 0),
    unanswered: rows.reduce((sum, row) => sum + row.unanswered, 0),
    blocked: rows.reduce((sum, row) => sum + row.blocked, 0),
  };
  const inbound = totals.agents + totals.buyers + totals.unanswered + totals.blocked;
  const comparisonName = data
    ? period === 'TODAY'
      ? 'Yesterday'
      : data.comparison.label.replace(/^the /, '').replace(/^./, c => c.toUpperCase())
    : 'Comparison';

  return (
    <Panel className={cn('min-w-0', className)}>
      <PanelHeader>
        <PanelTitle>{byDay ? 'Calls by day' : 'Calls by hour'}</PanelTitle>
        <PanelDescription>
          {data
            ? inbound > 0
              ? `${count(inbound)} inbound calls, by where they went. Dashed: ${comparisonName.toLowerCase()}.`
              : `No inbound calls ${period === 'TODAY' ? 'yet today' : 'in this period'}. Dashed: ${comparisonName.toLowerCase()}.`
            : ' '}
        </PanelDescription>
      </PanelHeader>
      <PanelBody className="flex flex-col gap-4">
        <div className="h-[240px] w-full" data-chart="calls-by-hour">
          {data ? (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartRows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="label" {...AXIS_PROPS} interval={byDay ? 0 : 1} />
                <YAxis {...AXIS_PROPS} allowDecimals={false} width={36} />
                <Tooltip
                  cursor={{ fill: 'var(--sunken)' }}
                  content={chartTooltip({ dashed: ['comparison'] })}
                />
                {OUTCOMES.map((outcome, i) => (
                  <Bar
                    key={outcome.key}
                    dataKey={outcome.key}
                    name={outcome.label}
                    stackId="calls"
                    fill={outcome.color}
                    radius={i === OUTCOMES.length - 1 ? [3, 3, 0, 0] : 0}
                    maxBarSize={byDay ? 48 : 22}
                    isAnimationActive={false}
                  />
                ))}
                <Line
                  dataKey="comparison"
                  name={comparisonName}
                  type="monotone"
                  {...COMPARISON_LINE}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          ) : null}
        </div>
        {/* The legend is "Where your calls went": each part, and its share. */}
        <dl className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Where your calls went">
          {OUTCOMES.map(outcome => (
            <div key={outcome.key} className="min-w-0">
              <dt className="flex items-center gap-2 t-caption text-ink-2">
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: outcome.color }}
                />
                {outcome.label}
              </dt>
              <dd
                className={cn(
                  't-body tabular-nums',
                  totals[outcome.key] > 0 ? 'text-ink' : 'text-ink-3'
                )}
                data-part={outcome.key}
              >
                <span className="font-medium">{count(totals[outcome.key])}</span>{' '}
                <span className="t-meta text-ink-3">
                  {inbound > 0 ? pct((totals[outcome.key] / inbound) * 100, 1) : '—'}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </PanelBody>
    </Panel>
  );
}

const PRESENCE_DOT: Record<TodayData['agents'][number]['presence'], string> = {
  READY: 'bg-entity-agent',
  ON_CALL: 'bg-entity-buyer',
  AWAY: 'bg-entity-unanswered',
  OFFLINE: 'bg-rule-strong',
};

const PRESENCE_WORD: Record<TodayData['agents'][number]['presence'], string> = {
  READY: 'ready',
  ON_CALL: 'on a call',
  AWAY: 'away',
  OFFLINE: 'offline',
};

function LiveNow({ data, className }: { data: TodayData | null; className?: string }): JSX.Element {
  const buyers = data?.buyers.filter(buyer => buyer.kind === 'buyer') ?? [];
  return (
    <Panel className={cn('min-w-0', className)} data-live-now>
      <PanelHeader>
        <PanelTitle>Live now</PanelTitle>
        <PanelDescription>Whatever the period above</PanelDescription>
      </PanelHeader>
      <PanelBody className="flex flex-col gap-5">
        <div>
          <div className="t-caption text-ink-2">Calls up now</div>
          <div
            className={cn(
              't-kpi-hero mt-1',
              data && data.now.callsUp > 0 ? 'text-ink' : 'text-ink-3'
            )}
            data-figure-label="Calls up"
            data-figure-value={count(data?.now.callsUp)}
          >
            {data ? count(data.now.callsUp) : '—'}
          </div>
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="t-caption text-ink-2">Agents ready</span>
            <span
              className="t-body font-medium tabular-nums text-ink"
              data-figure-label="Agents ready"
              data-figure-value={`${count(data?.now.agentsReady)} of ${count(data?.now.agentsActive)}`}
            >
              {data ? `${count(data.now.agentsReady)} of ${count(data.now.agentsActive)}` : '—'}
            </span>
          </div>
          <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Agents right now">
            {(data?.agents ?? []).slice(0, 12).map(agent => (
              <li
                key={agent.id}
                className={cn('h-3 w-3 rounded-full', PRESENCE_DOT[agent.presence])}
                title={`${agent.name}: ${PRESENCE_WORD[agent.presence]}`}
                data-presence={agent.presence}
              >
                <span className="sr-only">{`${agent.name}: ${PRESENCE_WORD[agent.presence]}`}</span>
              </li>
            ))}
          </ul>
          {data ? (
            <p className="t-meta mt-1.5 text-ink-3">
              {`${count(data.now.agentsOnCall)} on a call`}
              {data.agents.length > 12 ? ` · first 12 of ${count(data.agents.length)} shown` : ''}
            </p>
          ) : null}
        </div>

        <div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="t-caption text-ink-2">Buyers taking calls</span>
            <span
              className="t-body font-medium tabular-nums text-ink"
              data-figure-label="Buyers taking calls"
              data-figure-value={`${count(data?.now.buyersTaking)} of ${count(data?.now.buyersActive)}`}
            >
              {data ? `${count(data.now.buyersTaking)} of ${count(data.now.buyersActive)}` : '—'}
            </span>
          </div>
          <ul className="mt-2 flex flex-col gap-2.5">
            {buyers.map(buyer => (
              <li key={buyer.id} className="min-w-0" data-cap-bar={buyer.id}>
                <div className="flex items-baseline justify-between gap-2 t-meta">
                  <span className="min-w-0 truncate text-ink">{buyer.name}</span>
                  <span className="shrink-0 tabular-nums text-ink-2">
                    {buyer.capMax === null
                      ? 'No cap'
                      : `${count(buyer.capUsed)} / ${count(buyer.capMax)}`}
                  </span>
                </div>
                <CapBar used={buyer.capUsed} max={buyer.capMax} atCap={buyer.atCap} />
              </li>
            ))}
          </ul>
        </div>
      </PanelBody>
    </Panel>
  );
}

function CapBar({
  used,
  max,
  atCap,
}: {
  used: number;
  max: number | null;
  atCap: boolean;
}): JSX.Element {
  if (max === null) return <span className="sr-only">No cap</span>;
  const share = max > 0 ? Math.min(100, (used / max) * 100) : 0;
  return (
    <div
      className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-sunken"
      role="img"
      aria-label={`${used} of ${max} calls today`}
    >
      <div
        className={cn('h-full rounded-full', atCap ? 'bg-dropped' : 'bg-entity-buyer')}
        style={{ width: `${share}%` }}
      />
    </div>
  );
}

/* ── Row 3: what needs a decision ─────────────────────────────────────────── */

interface AttentionCard {
  kind: string;
  headline: string;
  why: string;
  action: string;
  href: string;
  /** Blocking stops calls being taken; waiting is money or a decision that can sit. */
  severity: 'blocking' | 'waiting';
}

export function attentionCards(data: TodayData): AttentionCard[] {
  const cards: AttentionCard[] = [];
  const blocked = data.attention.find(item => item.kind === 'agents_blocked')?.count ?? 0;
  if (blocked > 0) {
    cards.push({
      kind: 'agents_blocked',
      headline: `${count(blocked)} ${blocked === 1 ? "agent can't" : "agents can't"} take calls`,
      why:
        data.agentBlockers
          .slice(0, 2)
          .map(b => `${count(b.count)} ${b.reason.charAt(0).toLowerCase()}${b.reason.slice(1)}`)
          .join(' · ') || 'See the roster for why',
      action: 'Fix in Agents',
      href: '/agents?tab=roster',
      severity: 'blocking',
    });
  }
  if (data.returnsWaiting.count > 0) {
    cards.push({
      kind: 'returns',
      headline: `${count(data.returnsWaiting.count)} ${data.returnsWaiting.count === 1 ? 'return' : 'returns'} waiting`,
      why: data.returnsWaiting.oldestAt
        ? `Oldest from ${formatDisplayDate(data.returnsWaiting.oldestAt).replace(/, \d{4}$/, '')}`
        : 'Waiting for a decision',
      action: 'Review returns',
      href: '/buyers?tab=returns',
      severity: 'waiting',
    });
  }
  const atCap = data.attention.find(item => item.kind === 'buyers_at_cap')?.count ?? 0;
  if (atCap > 0) {
    cards.push({
      kind: 'buyers_at_cap',
      headline: `${count(atCap)} ${atCap === 1 ? 'buyer is' : 'buyers are'} at today's cap`,
      why: 'Their calls go to the next buyer until midnight',
      action: 'Review buyers',
      href: '/buyers',
      severity: 'waiting',
    });
  }
  if (data.owedToPublishers.amount > 0) {
    cards.push({
      kind: 'payouts_owed',
      headline: `${tileDollars(data.owedToPublishers.amount)} owed to publishers`,
      why: `Across ${count(data.owedToPublishers.publishers)} ${data.owedToPublishers.publishers === 1 ? 'publisher' : 'publishers'}`,
      action: 'Pay publishers',
      href: '/publishers?tab=payouts',
      severity: 'waiting',
    });
  }
  return cards;
}

function NeedsAttention({ data }: { data: TodayData | null }): JSX.Element | null {
  if (!data) return null;
  const cards = attentionCards(data);
  return (
    <section aria-labelledby="needs-attention" className="flex flex-col gap-3">
      <h2 id="needs-attention" className="t-section text-ink">
        Needs attention
      </h2>
      {cards.length === 0 ? (
        <p
          className="flex items-center gap-2 rounded-card bg-live-tint px-4 py-3 t-body text-live-ink"
          data-all-clear
        >
          <CheckCircle2 aria-hidden className="h-4 w-4 shrink-0" />
          All clear. Nothing needs you right now.
        </p>
      ) : (
        <ul
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"
          aria-label="Needs attention"
        >
          {cards.map(card => (
            <li
              key={card.kind}
              data-attention={card.kind}
              data-severity={card.severity}
              className={cn(
                'flex min-w-0 flex-col gap-1 rounded-card border border-rule border-l-4 bg-surface p-4 shadow-card',
                card.severity === 'blocking' ? 'border-l-dropped' : 'border-l-entity-unanswered'
              )}
            >
              <p className="t-body font-semibold text-ink">{card.headline}</p>
              <p className="t-meta text-ink-2">{card.why}</p>
              <div className="mt-2">
                <Button asChild variant="outline" size="sm">
                  <Link href={card.href}>
                    {card.action}
                    <ArrowRight aria-hidden className="ml-1.5 h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ── Row 4: buyers and publishers ─────────────────────────────────────────── */

function SeeAll({ href, label }: { href: string; label: string }): JSX.Element {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 t-meta font-medium text-brand-ink hover:underline"
    >
      {label}
      <ArrowRight aria-hidden className="h-3 w-3" />
    </Link>
  );
}

function BuyersTable({ data }: { data: TodayData | null }): JSX.Element {
  const rows = (data?.buyers ?? []).filter(row => row.kind === 'buyer').slice(0, 5);
  return (
    <Panel className="min-w-0">
      <PanelHeader action={<SeeAll href="/buyers" label="See all buyers" />}>
        <PanelTitle>Buyers</PanelTitle>
        <PanelDescription>
          Calls, billable calls and revenue in the period; cap today
        </PanelDescription>
      </PanelHeader>
      <PanelBody flush>
        {!data ? null : rows.length === 0 ? (
          <EmptyState headline="No buyers yet." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Buyer</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Billable</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="w-[132px]">Cap today</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(buyer => (
                <TableRow key={buyer.id} data-buyer={buyer.id}>
                  <TableCell className="max-w-[220px]">
                    <Link
                      href={`/buyers?id=${encodeURIComponent(buyer.id)}`}
                      className="hover:underline"
                    >
                      <EntityBadge kind="buyer" name={buyer.name} />
                    </Link>
                  </TableCell>
                  <TableCell className={cn('text-right', buyer.calls === 0 && 'text-ink-3')}>
                    {count(buyer.calls)}
                  </TableCell>
                  <TableCell
                    className={cn('text-right', buyer.billable === 0 && 'text-ink-3')}
                    data-billable
                  >
                    {count(buyer.billable)}
                  </TableCell>
                  <TableCell
                    className={cn('text-right', buyer.revenue === 0 && 'text-ink-3')}
                    data-revenue
                  >
                    {buyer.revenue === 0 ? '—' : dollarsCents(buyer.revenue)}
                  </TableCell>
                  <TableCell data-cap>
                    <div className="flex flex-col">
                      <span className="t-meta tabular-nums text-ink-2">
                        {buyer.capMax === null
                          ? 'No cap'
                          : `${count(buyer.capUsed)} / ${count(buyer.capMax)}`}
                      </span>
                      <CapBar used={buyer.capUsed} max={buyer.capMax} atCap={buyer.atCap} />
                    </div>
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

function PublishersTable({ data }: { data: TodayData | null }): JSX.Element {
  const rows = (data?.publishers ?? []).slice(0, 5);
  return (
    <Panel className="min-w-0">
      <PanelHeader action={<SeeAll href="/publishers" label="See all publishers" />}>
        <PanelTitle>Top publishers</PanelTitle>
        <PanelDescription>By profit in the period</PanelDescription>
      </PanelHeader>
      <PanelBody flush>
        {!data ? null : rows.length === 0 ? (
          <EmptyState headline="No publisher calls in this period." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Publisher</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Billable</TableHead>
                <TableHead className="text-right">Payout</TableHead>
                <TableHead className="text-right">Profit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(row => (
                <TableRow key={row.publisherId} data-publisher={row.publisherId}>
                  <TableCell className="max-w-[220px] truncate font-medium">
                    {row.publisherName}
                  </TableCell>
                  <TableCell className="text-right">{count(row.calls)}</TableCell>
                  <TableCell className="text-right">{pct(row.billablePct, 1)}</TableCell>
                  <TableCell className={cn('text-right', row.payout === 0 && 'text-ink-3')}>
                    {row.payout === 0 ? '—' : dollarsCents(row.payout)}
                  </TableCell>
                  <TableCell className={cn('text-right', row.profit === 0 && 'text-ink-3')}>
                    {row.profit === 0 ? '—' : dollarsCents(row.profit)}
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

/** Cents, for a table: tables and statements keep them. */
function dollarsCents(value: number): string {
  return `${value < 0 ? '−' : ''}$${Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
