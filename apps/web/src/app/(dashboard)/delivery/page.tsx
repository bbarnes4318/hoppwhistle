'use client';

import { ArrowDown, ArrowUp, Gauge, Loader2, PauseCircle, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { Fragment, useCallback, useMemo, useState } from 'react';

import { RoleGuard } from '@/components/auth/role-guard';
import { count, dollars, duration, pct, points } from '@/components/delivery/ledger';
import {
  Notice,
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  StatTile,
  Toolbar,
  ToolbarActions,
  ToolbarMeta,
} from '@/components/domain';
import { StatusChip } from '@/components/domain/status-chip';
import { PlatformDeliveryView } from '@/components/platform/platform-delivery-view';
import { Button } from '@/components/ui/button';
import { useLivePoll } from '@/hooks/use-live-poll';
import { usePlatformContext } from '@/hooks/use-platform-context';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Delivery: what is left on the block, what today has cost, and who is closing.
 *
 * ── Two readings of one page ─────────────────────────────────────────────────
 *
 * An agency sees its own figures, which is everything below. A platform admin
 * with no agency selected sees EVERY agency's — the same figures, one row each,
 * with platform totals across the top — because NetEnroll staff run the whole
 * platform and drilling into one agency is the exception, not the entry point.
 * Selecting an agency in the switcher narrows this page to that agency;
 * leaving returns to the platform-wide view. The switcher is a filter, not a
 * gate, and neither state is a prompt to choose somebody.
 *
 * An agency OWNER never reaches the platform-wide reading: `needsAgency` is
 * false for them (they hold no platform capability), and the endpoint behind it
 * refuses them 403 regardless of what this page renders.
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
  /** The curve half of the rate, when the curve set it. */
  curveRate: number | null;
  /** Dollars added to the curve rate. Part of the price, never a fee line. */
  rateOffset: number;
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
  /**
   * `valid` is the server's "can this agency be billed" answer, the rule the
   * delivery gate uses. `status` is the raw ACH column, NONE on purpose for an
   * agency that pays by card or is billed outside the platform, so it must not
   * decide the warning. Optional only for an API from before the field.
   */
  mandate: {
    status: string;
    valid?: boolean;
    paymentMethod?: 'ACH' | 'CARD';
    bankName: string | null;
    last4: string | null;
  };
}

interface AgentRow {
  userId: string | null;
  name: string;
  email: string | null;
  callsTaken: number;
  applications: number;
  /**
   * Total annualized premium on those applications.
   *
   * The counts drive the price; this is what says whether the production is
   * worth what it costs. Zero for an agent who submitted nothing, and zero for
   * one whose applications all came from the carrier automation, which records
   * no premium of its own.
   */
  annualizedPremium: number;
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
  /** The day's total annualized premium across every agent. */
  agencyAnnualizedPremium: number;
  agents: AgentRow[];
}

type SortKey =
  | 'closingPct'
  | 'callsTaken'
  | 'applications'
  | 'annualizedPremium'
  | 'talkTimeSeconds'
  | 'availableSeconds'
  | 'name';

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

/**
 * Which reading of this page to render.
 *
 * A component boundary rather than an early return inside one component: the
 * agency panel below calls `useLivePoll` and several `useState`s, and returning
 * before them would be a conditional hook. Splitting also means the agency
 * panel never mounts for an operator with no agency, so it never fires the
 * agency-scoped requests that would be refused 409.
 *
 * `loading` renders nothing rather than the agency panel. The first render
 * before `/platform/context` settles does not yet know whether this is staff,
 * and guessing "agency" for a platform admin is exactly the flash of a broken
 * page this is meant to remove.
 */
function DeliveryPage(): JSX.Element {
  const platform = usePlatformContext();

  if (platform.loading) {
    return (
      <div className="page-canvas min-h-full">
        <div className="flex flex-1 items-center justify-center t-body text-ink-3">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading delivery
        </div>
      </div>
    );
  }

  return platform.needsAgency ? <PlatformDeliveryView /> : <AgencyDeliveryPanel />;
}

/** One agency's own delivery panel: the acting tenant's, and nobody else's. */
function AgencyDeliveryPanel(): JSX.Element {
  const [today, setToday] = useState<DeliveryToday | null>(null);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [agencyClosingPct, setAgencyClosingPct] = useState<number | null>(null);
  /** The day's total annualized premium across the agency, served with the rows. */
  const [agencyPremium, setAgencyPremium] = useState(0);
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
    setAgencyPremium(breakdown?.agencyAnnualizedPremium ?? 0);
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
      <ArrowUp className="ml-1 inline h-3 w-3" aria-label="ascending" />
    ) : (
      <ArrowDown className="ml-1 inline h-3 w-3" aria-label="descending" />
    );
  }

  if (loading) {
    return (
      <div className="page-canvas min-h-full">
        <div className="flex flex-1 items-center justify-center t-body text-ink-3">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading delivery
        </div>
      </div>
    );
  }

  if (error || !today) {
    return (
      <div className="page-canvas">
        <p className="t-body text-ink-3">{error ?? 'No delivery data yet.'}</p>
      </div>
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
      <div className="page-canvas">
        {/* The day being read and the delivery state, on the one toolbar row. */}
        <Toolbar>
          <ToolbarMeta>{today.calendarDay}</ToolbarMeta>
          <ToolbarActions>
            <StatusChip value="ACTIVE" label="Delivering" tone="live" />
          </ToolbarActions>
        </Toolbar>

        {/*
          Operational figures only. These are true whether or not an agency is
          in the billing system, and a principal running a floor needs them.
        */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile
            label="Calls today"
            figure={count(today.callsAnswered)}
            sub={`answered by an agent · ${count(today.callsRouted)} routed`}
            data-figure-label="Calls today"
            data-figure-value={count(today.callsAnswered)}
          />
          <StatTile
            label="In progress now"
            figure={
              <span className={today.callsInProgress > 0 ? 'text-live-ink' : 'text-ink'}>
                {count(today.callsInProgress)}
              </span>
            }
            sub="this instant, not today"
            data-figure-label="In progress now"
            data-figure-value={count(today.callsInProgress)}
          />
          <StatTile
            label="Applications today"
            figure={count(today.applicationsSubmitted)}
            sub="submitted today"
            data-figure-label="Applications today"
            data-figure-value={count(today.applicationsSubmitted)}
          />
          <StatTile
            label="Today so far"
            figure={pct(today.todayClosingPct)}
            sub="applications as a share of answered calls"
            data-figure-label="Today so far"
            data-figure-value={pct(today.todayClosingPct)}
          />
        </div>

        <Notice tone="info" title="Billing is not enabled for this agency">
          <p className="max-w-prose">
            Calls are delivered without prepaid app credits or a nightly settlement.
            There is nothing to charge and nothing to run out of. NetEnroll enables it per agency,
            once the terms and a payment method are in place.
          </p>
        </Notice>
      </div>
    );
  }

  const windowLabel =
    today.windowDayKeys.length > 0
      ? today.windowDayKeys.join(', ')
      : `${today.windowDeliveryDays} delivery days`;

  return (
    <div className="page-canvas">
      {/*
        The calendar day being read, the delivery state and the page's actions
        share one row. There is no header blurb above it: the title is already
        in the topbar.
      */}
      <Toolbar>
        <ToolbarMeta>{today.calendarDay}</ToolbarMeta>
        {today.delivering ? (
          <StatusChip value="ACTIVE" label="Delivering" tone="live" />
        ) : (
          <StatusChip value="PAUSED" label="Paused" tone="blocked" />
        )}
        <ToolbarActions>
          <Button variant="outline" size="sm" className="h-8 text-xs" onClick={refresh}>
            <RefreshCw className="mr-1.5 h-3 w-3" />
            Refresh
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs" asChild>
            <Link href="/delivery/settlements">Settlement history</Link>
          </Button>
        </ToolbarActions>
      </Toolbar>

      {!today.delivering && (
        <Notice
          tone="warning"
          icon={PauseCircle}
          title={
            <>
              {today.holdReason === 'NO_CREDITS'
                ? 'Out of app credits — calls are paused'
                : 'Delivery is paused'}
              {today.holdSince ? ` — since ${new Date(today.holdSince).toLocaleTimeString()}` : ''}
            </>
          }
        >
          <p>{today.holdDetail}</p>
          {today.holdReason !== 'NO_CREDITS' && (
            <p className="t-meta mt-0.5">
              Applications you have already paid for are untouched and available when delivery
              resumes: {count(today.applicationsRemainingOnBlock)} remaining.
            </p>
          )}
        </Notice>
      )}

      {!today.chargesEnabled && (
        <Notice tone="info" icon={Gauge} title="Settlements are running without charging">
          Figures and settlements are real; no payment is taken until NetEnroll turns charging on.
        </Notice>
      )}

      {!(today.mandate.valid ?? today.mandate.status === 'ACTIVE') && (
        <Notice
          tone="warning"
          title={
            today.mandate.paymentMethod === 'CARD'
              ? 'No usable card on file'
              : 'No valid ACH mandate'
          }
        >
          {today.mandate.paymentMethod === 'CARD'
            ? 'Delivery requires a saved card. Contact NetEnroll to set one up.'
            : 'Delivery requires a verified bank mandate. Contact NetEnroll to set one up.'}
        </Notice>
      )}

      {/*
        ── The two numbers this screen is about ──────────────────────────────

        How many application credits are left, and what each one costs.
        Agencies pay up front: calls stop the moment credits reach zero and
        resume when more are added, so there is no running charge to project.
      */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <StatTile
          emphasis
          label="App credits remaining"
          figure={
            <span className={today.applicationsRemainingOnBlock === 0 ? 'text-dropped-ink' : undefined}>
              {count(today.applicationsRemainingOnBlock)}
            </span>
          }
          sub={`paid for and unused · daily block ${count(
            today.dailyBlockApplications
          )} · calls pause at 0`}
          data-figure-label="App credits remaining"
          data-figure-value={count(today.applicationsRemainingOnBlock)}
        />
        <StatTile
          emphasis
          label="Current rate"
          figure={dollars(today.currentRate)}
          data-figure-label="Current rate"
          data-figure-value={dollars(today.currentRate)}
          sub={
            <>
              per submitted application, today
              {/*
                An agreed rate offset is shown as part of the price, not as a
                fee beside it. There is deliberately no line anywhere on this
                page that adds anything to a charge.
              */}
              {today.rateOffset > 0 && (
                <>
                  {' '}
                  · {dollars(today.curveRate)} from the curve plus your agreed offset of{' '}
                  {dollars(today.rateOffset)}
                </>
              )}
            </>
          }
        />
      </div>

      {/*
        ── The rate, and what set it ─────────────────────────────────────────

        The trailing-window closing percentage lives HERE, beside the rate it
        produced and away from today's counts. "Today so far" is in the next
        group with the other things that happened today. They are different
        numbers with different jobs, and putting them side by side as two
        percentages is how an agency comes to believe its price moved at 10am.
      */}
      <section className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="t-section text-ink">What sets the rate</h2>
          <p className="t-meta text-ink-3">
            {"Tonight's settlement re-measures the window and sets tomorrow's rate."}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <StatTile
            label="Rating window closing"
            figure={pct(today.windowClosingPct)}
            data-figure-label="Rating window closing"
            data-figure-value={pct(today.windowClosingPct)}
            sub={
              <>
                set today&rsquo;s rate · Delivery Days {windowLabel}
                {today.windowDaysFound < today.windowDeliveryDays
                  ? ` · ${today.windowDaysFound} of ${today.windowDeliveryDays} found`
                  : ''}
              </>
            }
          />
          <StatTile
            label="Tomorrow is tracking toward"
            figure={
              <span className={today.trackingBelowMinimum ? 'text-ringing-ink' : 'text-ink-2'}>
                {today.trackingBelowMinimum ? 'review' : dollars(today.trackingRate)}
              </span>
            }
            data-figure-label="Tomorrow is tracking toward"
            data-figure-value={today.trackingBelowMinimum ? 'review' : dollars(today.trackingRate)}
            sub={
              today.trackingBelowMinimum
                ? 'the window ending today is below the curve minimum'
                : 'if today closed now · provisional'
            }
          />
        </div>
      </section>

      {/* ── Today ────────────────────────────────────────────────────────── */}
      <section className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="t-section text-ink">Today</h2>
          <p className="t-meta text-ink-3">
            {`${count(today.callsInProgress)} ${today.callsInProgress === 1 ? 'call' : 'calls'} in progress now`}
          </p>
        </div>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          <StatTile
            label="Calls answered"
            figure={count(today.callsAnswered)}
            sub={`${count(today.callsRouted)} routed · answered is what your rate is measured on`}
            data-figure-label="Calls answered"
            data-figure-value={count(today.callsAnswered)}
          />
          <StatTile
            label="Applications"
            figure={count(today.applicationsSubmitted)}
            sub={`${count(today.applicationsConsumedToday)} credits used today`}
            data-figure-label="Applications"
            data-figure-value={count(today.applicationsSubmitted)}
          />
          {/* Today so far. Prices nothing, and says so. */}
          <StatTile
            label="Closing today so far"
            figure={<span className="text-ink-2">{pct(today.todayClosingPct)}</span>}
            sub="moves all day · does not set today's rate"
            data-figure-label="Closing today so far"
            data-figure-value={pct(today.todayClosingPct)}
          />
        </div>
      </section>

      {/* ── Per agent ───────────────────────────────────────────────────── */}
      <AgentTable
        agents={sortedAgents}
        agencyClosingPct={agencyClosingPct}
        agencyPremium={agencyPremium}
        sortKey={sortKey}
        sortAsc={sortAsc}
        onSort={toggleSort}
        sortIcon={sortIcon}
      />
    </div>
  );
}

/**
 * Softphone presence, as a chip tone. Available is live; on a call is in
 * progress; away is a deliberate stop, so it takes the blocked violet rather
 * than a failure red; offline, unknown and "n/a" are neutral.
 */
function agentStatusTone(status: string): 'live' | 'ringing' | 'blocked' | 'neutral' {
  switch (status) {
    case 'available':
      return 'live';
    case 'on_call':
      return 'ringing';
    case 'away':
      return 'blocked';
    default:
      return 'neutral';
  }
}

/**
 * The per-agent table: the product's real lever.
 *
 * A principal decides who to coach or pull off the queue here. So: weakest
 * closer first, closing percentage the largest thing in the row, the agency's
 * own figure drawn THROUGH the table as a rule between the agents below it and
 * the agents above it, and a sticky header so 45 rows never scroll past the
 * column names. Every other column is support and set in the quieter data
 * face.
 */
function AgentTable({
  agents,
  agencyClosingPct,
  agencyPremium,
  sortKey,
  sortAsc,
  onSort,
  sortIcon,
}: {
  agents: AgentRow[];
  agencyClosingPct: number | null;
  agencyPremium: number;
  sortKey: SortKey;
  sortAsc: boolean;
  onSort: (key: SortKey) => void;
  sortIcon: (key: SortKey) => JSX.Element | null;
}): JSX.Element {
  /*
   * Where to draw the agency line. Only meaningful when the rows are ordered
   * by closing percentage: it goes before the first agent at or above the
   * agency figure (ascending) or the first one below it (descending). With any
   * other sort the reference is carried per row instead.
   */
  const lineBefore = useMemo(() => {
    if (sortKey !== 'closingPct' || agencyClosingPct === null) return -1;
    const index = agents.findIndex(a =>
      a.closingPct === null
        ? false
        : sortAsc
          ? a.closingPct >= agencyClosingPct
          : a.closingPct < agencyClosingPct
    );
    return index;
  }, [agents, sortKey, sortAsc, agencyClosingPct]);

  const header = (key: SortKey, label: string, extra?: { title?: string; numeric?: boolean }) => (
    <th
      scope="col"
      className={cn(extra?.numeric && 'num', 'cursor-pointer select-none')}
      aria-sort={sortKey === key ? (sortAsc ? 'ascending' : 'descending') : 'none'}
      title={extra?.title}
    >
      <button
        type="button"
        onClick={() => onSort(key)}
        className="t-label text-ink-3 hover:text-ink"
      >
        {label}
        {sortIcon(key)}
      </button>
    </th>
  );

  const agencyLine = (
    <tr aria-hidden className="bg-sunken">
      <td colSpan={10} className="!h-6 !border-b-0 !py-0">
        <span className="flex items-center gap-2 t-meta text-ink-2">
          <span className="h-px flex-1 border-t border-dashed border-ink-3" />
          agency {pct(agencyClosingPct)}
          <span className="h-px flex-1 border-t border-dashed border-ink-3" />
        </span>
      </td>
    </tr>
  );

  return (
    <Panel className="min-w-0">
      <PanelHeader>
        <PanelTitle>Agents today</PanelTitle>
        <PanelDescription>
          Agency today <span className="t-num font-medium text-ink">{pct(agencyClosingPct)}</span> —
          the line each agent is read against ·{' '}
          <span className="t-num font-medium text-ink">{dollars(agencyPremium)}</span> annualized
          premium
        </PanelDescription>
      </PanelHeader>

      {agents.length === 0 ? (
        <PanelBody>
          <p className="t-body text-ink-3">No calls answered yet today.</p>
        </PanelBody>
      ) : (
        <PanelBody flush className="max-h-[calc(100vh-12rem)] overflow-auto rounded-b-card">
          <table
            className={cn(
              'w-full border-collapse text-left t-body',
              '[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-sunken',
              '[&_thead_th]:h-10 [&_thead_th]:whitespace-nowrap [&_thead_th]:border-b [&_thead_th]:border-rule [&_thead_th]:px-3 [&_thead_th]:align-middle [&_thead_th]:t-label [&_thead_th]:text-ink-3',
              '[&_tbody_td]:h-row [&_tbody_td]:border-b [&_tbody_td]:border-rule [&_tbody_td]:px-3 [&_tbody_td]:py-0 [&_tbody_td]:align-middle',
              '[&_tbody_tr]:transition-colors [&_tbody_tr]:duration-150 [&_tbody_tr]:ease-out',
              '[&_tbody_tr:last-child_td]:border-b-0',
              '[&_th:first-child]:pl-5 [&_td:first-child]:pl-5 [&_th:last-child]:pr-5 [&_td:last-child]:pr-5',
              '[&_.num]:text-right [&_.num]:t-num [&_.num]:text-ink',
              '[&_th.num]:t-label [&_th.num]:text-ink-3'
            )}
          >
            <thead>
              <tr>
                {header('name', 'Agent')}
                {header('closingPct', 'Closing', { numeric: true })}
                <th
                  scope="col"
                  className="num"
                  title="Points against the agency's own figure today"
                >
                  vs agency
                </th>
                {header('callsTaken', 'Calls', { numeric: true })}
                {header('applications', 'Apps', { numeric: true })}
                {header('annualizedPremium', 'Premium', {
                  numeric: true,
                  title:
                    "Total annualized premium on the day's applications. The count is what " +
                    'the agency is charged on; this is what it bought.',
                })}
                {header('talkTimeSeconds', 'Talk', { numeric: true })}
                {header('availableSeconds', 'On queue', {
                  numeric: true,
                  title:
                    'Time on the queue today, waiting for a call. A low closer who was available all day and one who was available for forty minutes are different problems.',
                })}
                <th scope="col" className="num">
                  Occupancy
                </th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent, index) => {
                const delta =
                  agent.closingPct !== null && agencyClosingPct !== null
                    ? agent.closingPct - agencyClosingPct
                    : null;
                return (
                  <Fragment key={agent.userId ?? 'unattributed'}>
                    {index === lineBefore && agencyLine}
                    <tr className="hover:bg-sunken">
                      <td
                        className={cn(
                          'max-w-[16rem] truncate font-medium text-ink',
                          agent.userId === null && 'italic font-normal text-ink-3'
                        )}
                        title={
                          agent.userId === null
                            ? 'Delivered calls with no agent recorded on them. Shown so this ' +
                              'table adds up to the agency total rather than quietly losing them.'
                            : (agent.email ?? undefined)
                        }
                      >
                        {agent.name}
                      </td>
                      {/*
                        The one number in the row. Set a step larger and heavier
                        than the support columns; coloured only when it is BELOW
                        the agency line, because below is the finding and above
                        is the norm.
                      */}
                      <td
                        className={cn(
                          'num !t-figure !text-[15px] font-medium',
                          delta !== null && delta < 0 ? '!text-dropped-ink' : '!text-ink',
                          agent.closingPct === null && '!text-ink-3 !font-normal'
                        )}
                      >
                        {pct(agent.closingPct)}
                      </td>
                      <td
                        className={cn(
                          'num',
                          delta !== null && delta < 0 ? '!text-dropped-ink' : '!text-ink-3'
                        )}
                      >
                        {delta === null ? '—' : points(delta)}
                      </td>
                      <td className="num">{count(agent.callsTaken)}</td>
                      <td className="num">{count(agent.applications)}</td>
                      <td className="num">{dollars(agent.annualizedPremium)}</td>
                      <td className="num !text-ink-2">{duration(agent.talkTimeSeconds)}</td>
                      <td className="num !text-ink-2">
                        {agent.availableSeconds === null ? (
                          <span title="No status transitions were recorded for this agent today. That is not the same as no time on the queue, so it is shown as absent rather than as zero.">
                            —
                          </span>
                        ) : (
                          available(agent.availableSeconds)
                        )}
                      </td>
                      <td className="num !text-ink-2">
                        {agent.occupancyPct === null ? (
                          <span title="Working hours have not been recorded for this agent today, so there is no denominator. An absent number, not 0%.">
                            —
                          </span>
                        ) : (
                          `${agent.occupancyPct.toFixed(0)}%`
                        )}
                      </td>
                      <td>
                        <StatusChip
                          value={agent.currentStatus}
                          label={agent.currentStatus.replace(/_/g, ' ')}
                          tone={agentStatusTone(agent.currentStatus)}
                          size="sm"
                        />
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
              {lineBefore === -1 && sortKey === 'closingPct' && agencyClosingPct !== null && sortAsc
                ? agencyLine
                : null}
            </tbody>
          </table>
        </PanelBody>
      )}
    </Panel>
  );
}

/**
 * ADMIN and OWNER only.
 *
 * Today's credits, the rate and what sets it. Money, and
 * therefore the principal's: `/api/v1/delivery/*` refuses an AGENT everywhere
 * except `/me` (see `requireAgencyPrincipal`), and this guard is so an agent who
 * reaches the URL is sent somewhere useful instead of watching a page fill with
 * 403s. An agent's own numbers are at /delivery/me, which has no money on it.
 *
 * A platform operator inside an agency carries both roles and is unaffected --
 * except while previewing as AGENT, where being turned away is the point.
 */
export default function GuardedDeliveryPage(): JSX.Element {
  return (
    <RoleGuard allowedRoles={['ADMIN', 'OWNER']}>
      <DeliveryPage />
    </RoleGuard>
  );
}
