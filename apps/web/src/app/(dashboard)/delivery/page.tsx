'use client';

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Gauge,
  Loader2,
  PauseCircle,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

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
import { apiClient } from '@/lib/api';
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
  hoursWorked: number | null;
  occupancyPct: number | null;
  currentStatus: string;
}

type SortKey = 'closingPct' | 'callsTaken' | 'applications' | 'talkTimeSeconds' | 'name';

/** A percentage, or an em dash. Never a fabricated 0%. */
function pct(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)}%`;
}

/** Whole dollars, or an em dash. Under review there is no rate, not a $0 one. */
function dollars(value: number | null): string {
  return value === null ? '—' : `$${Math.round(value).toLocaleString()}`;
}

function duration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export default function DeliveryPage(): JSX.Element {
  const [today, setToday] = useState<DeliveryToday | null>(null);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('closingPct');
  const [sortAsc, setSortAsc] = useState(false);

  const load = useCallback(async () => {
    const [todayResponse, agentsResponse] = await Promise.all([
      apiClient.get<DeliveryToday>('/api/v1/delivery/today'),
      apiClient.get<{ agents: AgentRow[] }>('/api/v1/delivery/agents'),
    ]);

    setError(todayResponse.error ? todayResponse.error.message : null);
    setToday(todayResponse.data ?? null);
    setAgents(agentsResponse.data?.agents ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    // The panel is live: an agency at its ceiling wants to know within the
    // minute, not on a refresh. Thirty seconds is well inside the rate the
    // numbers actually move at, and every figure is server-computed.
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  const sortedAgents = useMemo(() => {
    const rows = [...agents];
    rows.sort((a, b) => {
      if (sortKey === 'name') {
        return sortAsc ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
      }
      // Nulls last in both directions: an agent who took no calls has no
      // percentage, and a null at the top of a "who needs coaching" list reads
      // as a finding.
      const av = a[sortKey];
      const bv = b[sortKey];
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
    setSortAsc(key === 'name');
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
          <CardTitle className="flex items-center gap-2 text-sm">
            <Users className="h-4 w-4" />
            Agents today
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
                  <TableHead className="text-right">Availability</TableHead>
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
                    <TableCell className="text-right font-medium tabular-nums">
                      {pct(agent.closingPct)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {duration(agent.talkTimeSeconds)}
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
