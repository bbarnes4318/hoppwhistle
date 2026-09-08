'use client';

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Gauge,
  Loader2,
  PauseCircle,
  RefreshCw,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';

import { CompactPageHeader, CompactPageShell } from '@/components/layout/compact-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { cn } from '@/lib/utils';

/**
 * Delivery: what is left on the block, what today has cost, and who is closing.
 *
 * ── The two closing percentages are the thing to get right ───────────────────
 *
 * "Today so far" moves all day and prices nothing. "Rating window" is the
 * trailing Delivery Day window that ACTUALLY set the rate in force. They are
 * different numbers, and an agency that reads the first as the second thinks
 * its price changed at 10am. They are rendered in separate cards, labelled with
 * what each does, and the window one names the days it covers so the agency can
 * reconstruct it.
 *
 * The two rates are the same trap: "current rate" is what is being paid today,
 * "tonight's rate" is what the settlement will use and what tomorrow will be
 * priced at. The second is muted and explicitly provisional.
 *
 * ── Nulls render as em dashes, never as zeroes ───────────────────────────────
 *
 * A closing percentage with no delivered calls behind it, a rate under review,
 * an agent whose hours were never recorded: all em dashes. A fabricated 0% on
 * the screen a principal decides who to coach from is worse than an absent
 * number, and a $0 renders as a price.
 *
 * ── Not every agency is in the billing system ────────────────────────────────
 *
 * Billing is opt-in per agency and defaults to off. An agency that has not been
 * enrolled is not gated, not metered and not settled, and every figure the
 * server returns for it is a zero rather than a measurement. Rendering those
 * zeroes would tell a principal they have no credit and are about to stop
 * delivering, which is the opposite of the truth, so the page says plainly that
 * billing does not apply and shows nothing else.
 *
 * Every figure comes from the server. Nothing on this page sends a rate, an
 * amount or a quantity anywhere.
 */

interface DeliveryToday {
  calendarDay: string;
  timeZone: string;
  enrolled: boolean;
  chargesEnabled: boolean;
  callsRouted: number;
  callsInProgress: number;
  callsAnswered: number;
  applicationsSubmitted: number;
  todayClosingPct: number | null;
  windowClosingPct: number | null;
  windowDayKeys: string[];
  windowDaysFound: number;
  windowDeliveryDays: number;
  currentRate: number | null;
  trackingRate: number | null;
  trackingBelowMinimum: boolean;
  applicationsRemainingOnBlock: number;
  dailyBlockApplications: number;
  applicationsConsumedToday: number;
  overrunToday: number;
  overrunAmountTonight: number | null;
  overrunCeiling: number;
  distanceToCeiling: number;
  projectedTotalCharge: number | null;
  projectedNextBlockQuantity: number;
  delivering: boolean;
  holdReason: string | null;
  holdDetail: string | null;
  holdSince: string | null;
  mandate: { status: string; bankName: string | null; last4: string | null };
}

interface AgentRow {
  userId: string | null;
  name: string;
  email: string | null;
  callsTaken: number;
  applications: number;
  closingPct: number | null;
  talkTimeSeconds: number;
  /** Seconds on the queue today. Null when nothing was recorded for the day. */
  availableSeconds: number | null;
  statusSince: string | null;
  hoursWorked: number | null;
  occupancyPct: number | null;
  currentStatus: string;
}

interface AgentBreakdown {
  agencyClosingPct: number | null;
  agents: AgentRow[];
}

type SortKey =
  | 'closingPct'
  | 'callsTaken'
  | 'applications'
  | 'talkTimeSeconds'
  | 'availableSeconds'
  | 'name';

/** A percentage, or an em dash. Never a fabricated 0%. */
function pct(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)}%`;
}

/**
 * Dollars to the cent, or an em dash. Under review there is no rate, not a $0.
 *
 * Two decimal places because that is what the server stores and what the
 * settlement will debit. This rounded to whole dollars, so an overrun of
 * $2,948.50 read as $2,949 here and $2,948.50 on the bank statement -- a
 * fifty-cent discrepancy between the screen an agency checks and the charge
 * they are checking it against.
 */
function dollars(value: number | null): string {
  return value === null
    ? '—'
    : `$${value.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
}

function duration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/**
 * Time on the queue, or an em dash.
 *
 * Null means no status transitions were recorded for that agent on that day,
 * which is a different fact from "was never available". Presence was held only
 * in Redis before Phase 4 -- one key per agent, overwritten on every change --
 * so days before it have nothing to read. Rendering that as 0m would put a
 * coaching decision on a number nobody recorded.
 */
function available(seconds: number | null): string {
  return seconds === null ? '—' : duration(seconds);
}

export default function DeliveryPage(): JSX.Element {
  const [today, setToday] = useState<DeliveryToday | null>(null);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [agencyClosingPct, setAgencyClosingPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('closingPct');
  /*
   * Ascending, so the agents dragging the agency's rate are at the top.
   *
   * This defaulted to descending, which put the best closers first. That is a
   * leaderboard, and this is a work list: the screen exists so a principal can
   * find who to coach or pull off the queue, and burying them under the top
   * performers is the opposite of what it is for.
   */
  const [sortAsc, setSortAsc] = useState(true);

  const load = useCallback(async () => {
    // Both routes answer `{ data: ... }`, so both are unwrapped by name. Read
    // as bare bodies these were silently undefined: the panel rendered an
    // agency as unenrolled whatever it was, and the agent table was empty.
    const [todayResponse, agentsResponse] = await Promise.all([
      apiClient.get<Envelope<DeliveryToday>>('/api/v1/delivery/today'),
      apiClient.get<Envelope<AgentBreakdown>>('/api/v1/delivery/agents'),
    ]);

    const breakdown = payload(agentsResponse);

    setError(todayResponse.error ? todayResponse.error.message : null);
    setToday(payload(todayResponse) ?? null);
    setAgents(Array.isArray(breakdown?.agents) ? breakdown.agents : []);
    // The agency's own figure, served with the rows. Not summed from them: it
    // includes calls no agent is attributed on, so a client-side sum would give
    // a different number from the one the agency is priced on.
    setAgencyClosingPct(breakdown?.agencyClosingPct ?? null);
  }, []);

  /*
   * Live, but only while somebody is looking. See `useLivePoll`: a hidden tab
   * stops polling and refreshes the moment it comes back, and the interval is
   * jittered so the tabs a floor opened together do not stay in lockstep. At 45
   * agents with the panel open all day that is the difference between load that
   * scales with tabs open and load that scales with tabs being read.
   */
  const { loading, refresh } = useLivePoll(load, { intervalMs: 30_000 });

  const sortedAgents = useMemo(() => {
    const rows = [...agents];
    rows.sort((a, b) => {
      if (sortKey === 'name') {
        return sortAsc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
      }
      // Nulls last in both directions: an agent who took no calls has no
      // percentage, and a null at the top of a "who needs coaching" list reads
      // as a finding.
      const av: number | null = a[sortKey];
      const bv: number | null = b[sortKey];
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return sortAsc ? av - bv : bv - av;
    });
    return rows;
  }, [agents, sortKey, sortAsc]);

  function toggleSort(key: SortKey): void {
    if (key === sortKey) {
      setSortAsc(!sortAsc);
      return;
    }
    setSortKey(key);
    // Closing percentage and name read best ascending -- the agents who need
    // attention, and A first. Counts read best descending: the busiest first.
    setSortAsc(key === 'name' || key === 'closingPct');
  }

  function sortIcon(key: SortKey): JSX.Element | null {
    if (key !== sortKey) return null;
    return sortAsc ? (
      <ArrowUp className="ml-1 inline h-3 w-3" />
    ) : (
      <ArrowDown className="ml-1 inline h-3 w-3" />
    );
  }

  if (loading) {
    return (
      <CompactPageShell>
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading delivery
        </div>
      </CompactPageShell>
    );
  }

  if (error || !today) {
    return (
      <CompactPageShell>
        <CompactPageHeader title="Delivery" icon={Gauge} />
        <p className="text-sm text-muted-foreground">{error ?? 'No delivery data yet.'}</p>
      </CompactPageShell>
    );
  }

  /*
   * Not enrolled: billing does not apply to this agency at all. Every number
   * below would be a zero that means "not measured", and a principal reading
   * "0 remaining on the block" would reasonably conclude their phones are about
   * to stop.
   */
  if (!today.enrolled) {
    return (
      <CompactPageShell fullHeight={false}>
        <CompactPageHeader
          title="Delivery"
          subtitle={`${today.calendarDay} · ${today.timeZone}`}
          icon={Gauge}
        >
          <Badge variant="secondary">delivering</Badge>
        </CompactPageHeader>

        {/*
          Operational figures only. These are true whether or not an agency is
          in the billing system, and a principal running a floor needs them.
        */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Calls today
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold tabular-nums">{today.callsAnswered}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                answered by an agent · {today.callsRouted} routed
              </p>
              <p className="mt-2 flex items-center gap-1.5 text-xs font-medium">
                <span
                  className={cn(
                    'inline-block h-2 w-2 rounded-full',
                    today.callsInProgress > 0 ? 'bg-emerald-500' : 'bg-muted-foreground/40'
                  )}
                />
                <span className="tabular-nums">{today.callsInProgress}</span>
                <span className="font-normal text-muted-foreground">
                  {today.callsInProgress === 1 ? 'call in progress now' : 'calls in progress now'}
                </span>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Applications today
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold tabular-nums">{today.applicationsSubmitted}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">submitted today</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Today so far
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold tabular-nums">{pct(today.todayClosingPct)}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                applications as a share of answered calls
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardContent className="pt-6">
            <p className="text-sm font-medium">Billing is not enabled for this agency.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Calls are delivered without a prepaid block, an overrun ceiling or a nightly
              settlement. There is nothing to charge and nothing to run out of.
            </p>
            <p className="mt-2 text-[11px] text-muted-foreground">
              NetEnroll enables it per agency, once the terms and a bank mandate are in place.
            </p>
          </CardContent>
        </Card>
      </CompactPageShell>
    );
  }

  const windowLabel =
    today.windowDayKeys.length > 0
      ? today.windowDayKeys.join(', ')
      : `${today.windowDeliveryDays} delivery days`;

  return (
    <CompactPageShell fullHeight={false}>
      <CompactPageHeader
        title="Delivery"
        subtitle={`${today.calendarDay} · days end 23:59:59 ${today.timeZone}`}
        icon={Gauge}
      >
        <div className="flex items-center gap-2">
          <Badge variant={today.delivering ? 'secondary' : 'destructive'}>
            {today.delivering ? 'delivering' : 'paused'}
          </Badge>
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="mr-2 h-3 w-3" />
            Refresh
          </Button>
          <Link href="/delivery/settlements">
            <Button variant="outline" size="sm">
              Settlement history
            </Button>
          </Link>
        </div>
      </CompactPageHeader>

      {!today.delivering && (
        <div className="flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <PauseCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium">
              Delivery is paused
              {today.holdSince
                ? ` — since ${new Date(today.holdSince).toLocaleTimeString()}`
                : ''}
            </p>
            <p className="text-muted-foreground">{today.holdDetail}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Applications you have already paid for are untouched and available when delivery
              resumes: {today.applicationsRemainingOnBlock} remaining.
            </p>
          </div>
        </div>
      )}

      {!today.chargesEnabled && (
        <div className="flex items-start gap-2 rounded border border-sky-500/40 bg-sky-500/10 p-3 text-sm">
          <Gauge className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
          <div>
            <p className="font-medium">Settlements are running without charging</p>
            <p className="text-muted-foreground">
              Every figure on this page is real and each night&rsquo;s settlement is recorded in
              full, but no payment is taken. NetEnroll turns charging on separately.
            </p>
          </div>
        </div>
      )}

      {today.mandate.status !== 'ACTIVE' && (
        <div className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div>
            <p className="font-medium">No valid ACH mandate</p>
            <p className="text-muted-foreground">
              Delivery requires a verified bank mandate. Contact NetEnroll to set one up.
            </p>
          </div>
        </div>
      )}

      {/* ── Today ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Calls today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums">{today.callsAnswered}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              answered by an agent · {today.callsRouted} routed
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              answered is the delivered-call count your rate is measured on
            </p>
            {/*
              The only figure on this panel about this instant rather than the
              day. A principal watching the queue wants to know whether the
              floor is busy right now, and no daily total can tell them.
            */}
            <p className="mt-2 flex items-center gap-1.5 text-xs font-medium">
              <span
                className={cn(
                  'inline-block h-2 w-2 rounded-full',
                  today.callsInProgress > 0 ? 'bg-emerald-500' : 'bg-muted-foreground/40'
                )}
              />
              <span className="tabular-nums">{today.callsInProgress}</span>
              <span className="font-normal text-muted-foreground">
                {today.callsInProgress === 1 ? 'call in progress now' : 'calls in progress now'}
              </span>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Applications today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums">{today.applicationsSubmitted}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {today.applicationsConsumedToday} on the block · {today.overrunToday} overrun
            </p>
          </CardContent>
        </Card>

        {/* Today so far. Prices nothing, and says so. */}
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Today so far
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums text-muted-foreground">
              {pct(today.todayClosingPct)}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              closing percentage · does not set today&rsquo;s rate
            </p>
          </CardContent>
        </Card>

        {/* The window that set the rate. Deliberately not adjacent to "today". */}
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Rating window — sets the rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums">{pct(today.windowClosingPct)}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Delivery days: {windowLabel}
              {today.windowDaysFound < today.windowDeliveryDays
                ? ` · ${today.windowDaysFound} of ${today.windowDeliveryDays} found`
                : ''}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── The block, the overrun and tonight ───────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Remaining on the block
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums">
              {today.applicationsRemainingOnBlock}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              applications paid for and unused · daily block {today.dailyBlockApplications}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Overrun today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums">{today.overrunToday}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {dollars(today.overrunAmountTonight)} at tonight&rsquo;s rate
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Distance to the ceiling
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={cn(
                'text-3xl font-bold tabular-nums',
                today.distanceToCeiling === 0 && 'text-destructive'
              )}
            >
              {today.distanceToCeiling}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              more applications before delivery stops for today · ceiling{' '}
              {today.overrunCeiling}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Projected at settlement
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums text-muted-foreground">
              {dollars(today.projectedTotalCharge)}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              tonight&rsquo;s overrun plus a block of {today.projectedNextBlockQuantity} ·
              provisional
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── The two rates ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Current rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums">{dollars(today.currentRate)}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              per submitted application, today
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Tomorrow is tracking toward
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={cn(
                'text-3xl font-bold tabular-nums',
                today.trackingBelowMinimum ? 'text-amber-500' : 'text-muted-foreground'
              )}
            >
              {today.trackingBelowMinimum ? 'review' : dollars(today.trackingRate)}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {today.trackingBelowMinimum
                ? 'the window ending today is below the curve minimum'
                : 'what tonight will settle at, if today closed now · provisional'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Per agent ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Agents today
            </span>
            {/*
              The reference line. This table is the lever: an agency that moves
              its two worst closers off the queue raises its blended closing
              percentage, which lowers its rate. Reading who is above and who is
              below the agency's own figure is the whole decision, and it should
              not require holding a number in your head while you scan a column.

              Served by the server alongside the rows, not summed from them: the
              agency figure counts calls no agent is attributed on.
            */}
            <span className="flex items-center gap-2 text-[11px] font-normal text-muted-foreground">
              <span
                className="inline-block h-0 w-6 border-t-2 border-dashed border-sky-500"
                aria-hidden
              />
              Agency today {pct(agencyClosingPct)} — the line each agent is read against
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sortedAgents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No calls answered yet today.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead
                    className="cursor-pointer select-none"
                    onClick={() => toggleSort('name')}
                  >
                    Agent{sortIcon('name')}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right"
                    onClick={() => toggleSort('callsTaken')}
                  >
                    Calls{sortIcon('callsTaken')}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right"
                    onClick={() => toggleSort('applications')}
                  >
                    Applications{sortIcon('applications')}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right"
                    onClick={() => toggleSort('closingPct')}
                  >
                    Closing{sortIcon('closingPct')}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right"
                    onClick={() => toggleSort('talkTimeSeconds')}
                  >
                    Talk time{sortIcon('talkTimeSeconds')}
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none text-right"
                    onClick={() => toggleSort('availableSeconds')}
                    title="Time on the queue today, waiting for a call. A low closer who was available all day and one who was available for forty minutes are different problems."
                  >
                    On queue{sortIcon('availableSeconds')}
                  </TableHead>
                  <TableHead className="text-right">Occupancy</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedAgents.map(agent => (
                  <TableRow key={agent.userId ?? 'unattributed'}>
                    <TableCell
                      className={cn(
                        'font-medium',
                        agent.userId === null && 'italic text-muted-foreground'
                      )}
                      title={
                        agent.userId === null
                          ? 'Delivered calls with no agent recorded on them. Shown so this ' +
                            'table adds up to the agency total rather than quietly losing them.'
                          : (agent.email ?? undefined)
                      }
                    >
                      {agent.name}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{agent.callsTaken}</TableCell>
                    <TableCell className="text-right tabular-nums">{agent.applications}</TableCell>
                    {/*
                      Read against the agency's own figure rather than against
                      nothing. Muted where there is no comparison to make: an
                      agent with no calls has no percentage, and an agency with
                      no delivered calls has no line to be above or below.
                    */}
                    <TableCell
                      className={cn(
                        'text-right font-medium tabular-nums',
                        agent.closingPct !== null &&
                          agencyClosingPct !== null &&
                          (agent.closingPct >= agencyClosingPct
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-amber-600 dark:text-amber-400')
                      )}
                      title={
                        agent.closingPct !== null && agencyClosingPct !== null
                          ? `${(agent.closingPct - agencyClosingPct >= 0 ? '+' : '') + (agent.closingPct - agencyClosingPct).toFixed(2)} points against the agency's ${agencyClosingPct.toFixed(2)}% today`
                          : undefined
                      }
                    >
                      {pct(agent.closingPct)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {duration(agent.talkTimeSeconds)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {agent.availableSeconds === null ? (
                        <span title="No status transitions were recorded for this agent today. That is not the same as no time on the queue, so it is shown as absent rather than as zero.">
                          —
                        </span>
                      ) : (
                        available(agent.availableSeconds)
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {agent.occupancyPct === null ? (
                        <span title="Working hours have not been recorded for this agent today, so there is no denominator. An absent number, not 0%.">
                          —
                        </span>
                      ) : (
                        `${agent.occupancyPct.toFixed(0)}%`
                      )}
                    </TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">
                      {agent.currentStatus}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </CompactPageShell>
  );
}
