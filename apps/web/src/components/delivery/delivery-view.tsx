'use client';

import { Gauge, Loader2, PauseCircle, Plus, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useState } from 'react';

import { RoleGuard } from '@/components/auth/role-guard';
import {
  AgentsTodayTable,
  useAgentSort,
  type AgentBreakdown,
  type AgentRow,
} from '@/components/delivery/agents-today-table';
import {
  AutoRefillToggle,
  BuyCreditsDialog,
  fetchCredits,
  type CreditsState,
} from '@/components/delivery/buy-credits';
import { count, dollars, pct } from '@/components/delivery/ledger';
import { Notice, StatTile, Toolbar, ToolbarActions, ToolbarMeta } from '@/components/domain';
import { StatusChip } from '@/components/domain/status-chip';
import { PlatformDeliveryView } from '@/components/platform/platform-delivery-view';
import { Button } from '@/components/ui/button';
import { useBrand } from '@/hooks/use-brand';
import { useLivePoll } from '@/hooks/use-live-poll';
import { usePlatformContext } from '@/hooks/use-platform-context';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';

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
 * Every figure comes from the server. Nothing on this page sends a rate or an
 * amount anywhere; buying credits sends a quantity and the server prices it.
 */

interface DeliveryToday {
  calendarDay: string;
  timeZone: string;
  enrolled: boolean;
  chargesEnabled: boolean;
  /** Whether the nightly settlement refills to the Daily Block. */
  autoRefill?: boolean;
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
  const { brand } = useBrand();
  // Who the agency deals with about billing: NetEnroll, or its account manager.
  const contact = brand ? 'your account manager' : 'NetEnroll';
  const [today, setToday] = useState<DeliveryToday | null>(null);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [agencyClosingPct, setAgencyClosingPct] = useState<number | null>(null);
  /** The day's total annualized premium across the agency, served with the rows. */
  const [agencyPremium, setAgencyPremium] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [credits, setCredits] = useState<CreditsState | null>(null);
  const [buyOpen, setBuyOpen] = useState(false);

  const load = useCallback(async () => {
    // Both routes answer `{ data: ... }`, so both are unwrapped by name. Read
    // as bare bodies these were silently undefined: the panel rendered an
    // agency as unenrolled whatever it was, and the agent table was empty.
    const [todayResponse, agentsResponse, creditsState] = await Promise.all([
      apiClient.get<Envelope<DeliveryToday>>('/api/v1/delivery/today'),
      apiClient.get<Envelope<AgentBreakdown>>('/api/v1/delivery/agents'),
      // What a credit costs and whether one can be bought here. A failure is
      // not the page's failure: the button simply stays disabled.
      fetchCredits().catch(() => null),
    ]);

    const breakdown = payload(agentsResponse);

    setError(todayResponse.error ? todayResponse.error.message : null);
    setToday(payload(todayResponse) ?? null);
    setCredits(creditsState);
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

  const { sortedAgents, sortKey, sortAsc, toggleSort, sortIcon } = useAgentSort(agents);

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
            Calls are delivered without prepaid app credits or a nightly settlement. There is
            nothing to charge and nothing to run out of.{' '}
            {brand
              ? 'Your account manager enables it, once the terms and a payment method are in place.'
              : 'NetEnroll enables it per agency, once the terms and a payment method are in place.'}
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
          <Button
            size="sm"
            className="h-8 text-xs"
            onClick={() => setBuyOpen(true)}
            disabled={!credits}
            title={
              credits && !credits.canSelfServe
                ? (credits.selfServeBlockedReason ?? undefined)
                : undefined
            }
          >
            <Plus className="mr-1.5 h-3 w-3" />
            Buy credits
          </Button>
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
          action={
            today.holdReason === 'NO_CREDITS' ? (
              <Button
                size="sm"
                className="h-8 text-xs"
                onClick={() => setBuyOpen(true)}
                disabled={!credits}
              >
                Buy credits
              </Button>
            ) : undefined
          }
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

      <BuyCreditsDialog
        open={buyOpen}
        onOpenChange={setBuyOpen}
        credits={credits}
        onPurchased={refresh}
      />

      {!today.chargesEnabled && (
        <Notice tone="info" icon={Gauge} title="Settlements are running without charging">
          Figures and settlements are real; no payment is taken until{' '}
          {brand ? 'your account manager turns' : 'NetEnroll turns'} charging on.
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
            ? `Delivery requires a saved card. Contact ${contact} to set one up.`
            : `Delivery requires a verified bank mandate. Contact ${contact} to set one up.`}
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
            <span
              className={today.applicationsRemainingOnBlock === 0 ? 'text-dropped-ink' : undefined}
            >
              {count(today.applicationsRemainingOnBlock)}
            </span>
          }
          sub={
            <>
              {`paid for and unused · daily block ${count(
                today.dailyBlockApplications
              )} · calls pause at 0`}
              <AutoRefillToggle
                className="mt-1"
                credits={credits}
                onChanged={autoRefill => {
                  setCredits(current => (current ? { ...current, autoRefill } : current));
                  refresh();
                }}
              />
            </>
          }
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
      <AgentsTodayTable
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
export function DeliveryView(): JSX.Element {
  return (
    <RoleGuard allowedRoles={['ADMIN', 'OWNER']}>
      <DeliveryPage />
    </RoleGuard>
  );
}
