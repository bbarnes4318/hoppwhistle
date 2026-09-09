'use client';

import { usePathname } from 'next/navigation';
import * as React from 'react';

import { count, dollars, pct, points } from '@/components/delivery/ledger';
import type { LiveConnectionState, LiveMetric } from '@/components/domain';
import { useAuth } from '@/hooks/use-auth';
import { createLivePoller } from '@/hooks/use-live-poll';
import type { PollOutcome } from '@/hooks/use-live-poll';
import { usePlatformContext } from '@/hooks/use-platform-context';
import { apiClient, isNoActingTenant } from '@/lib/api';

/**
 * Data layer for the LiveStrip.
 *
 * ── Two endpoints, and which reading comes from which ────────────────────────
 *
 * `GET /api/v1/live/strip` answers for an agency principal, an agent, and
 * NetEnroll staff in the cross-agency view. It is a separate endpoint from the
 * one below because the platform reading is the one caller that legitimately
 * has no acting tenant, and a tenant gate with an exception in it is not a
 * tenant gate. See apps/api/src/routes/live-strip.ts.
 *
 * `GET /api/v1/live/metrics` is unchanged and still answers the publisher and
 * buyer roles, which still exist in this application: calls in flight, billable
 * calls, earnings, spend against a call cap. Those figures are theirs and are
 * not touched here.
 *
 * ── Nothing is computed here ─────────────────────────────────────────────────
 *
 * Every rate, projection, total and difference on the strip arrives from the
 * server already worked out. This file selects which figures a reading shows,
 * labels them, and formats them with the SAME helpers `/delivery` formats with
 * — so where the strip and the page below show the same figure for the same
 * tenant, they show the same string.
 *
 * A figure the server could not source correctly comes back null with a reason
 * in the `unavailable` map, and renders as a muted em dash carrying that
 * reason as its tooltip. Nothing is estimated, derived from an unrelated
 * number, or carried forward from an earlier poll: a fabricated live number on
 * a screen where somebody watches their own money is worse than an absent one.
 *
 * ── A tenant not enrolled in billing sees no billing figures ─────────────────
 *
 * Not zeroes, and not em dashes either — an em dash under a label reading
 * "tonight" is still a screen telling somebody they owe an unknown amount. The
 * server omits the whole `billing` object for an unenrolled agency, so the only
 * figures that exist to render are the operational counts.
 *
 * ── Still polling, not socketed ──────────────────────────────────────────────
 *
 * The brief wants this on the websocket at apps/api/src/routes/websocket.ts.
 * That endpoint still cannot authenticate a specific user: it takes an
 * `apiKey` query param (never a JWT), treats an empty VALID_API_KEYS as
 * "accept anything", and maps every connection to DEFAULT_TENANT_ID rather
 * than the caller's own tenant. Since the strip renders on every page for
 * every role, connecting to it would stream one tenant's call and billing
 * events into every browser. So the socket stays gated behind SOCKET_ENABLED
 * and this polls — the fallback the brief already specifies.
 *
 * THIRTY seconds, not five. These figures move by the delivered call and by
 * the submitted application, not by the second: a five-second poll asked the
 * database six times for every change it could possibly show. At 45 agents,
 * 15 more on the second agency and a wall display or two, that is the
 * difference between a query storm and a trickle. The API caches on top of it
 * — ten seconds per agency and per agent, thirty for the platform reading —
 * so a floor of tabs collapses onto roughly one computation per window.
 */

/** Flip once /ws/events can authenticate a user with their JWT and scope to them. */
const SOCKET_ENABLED = false;

const POLL_MS = 30_000;

/**
 * ── The rule for not repeating the page below ────────────────────────────────
 *
 * A figure the page underneath renders as its HERO — the single largest element
 * on the screen — is not repeated in the strip on that page. Anything smaller
 * than a hero still appears in both: the strip is read at a glance from across
 * a desk and the page is read up close, and a figure in a supporting row is not
 * competing with anything.
 *
 * That is the whole rule, and these are all the places it applies, because
 * these are the only pages in the product with a hero figure the strip also
 * carries:
 *
 *   agency on /delivery      the heroes are the projected charge at tonight's
 *                            settlement and the current rate. Both drop, and
 *                            the strip keeps applications, calls, the block,
 *                            overrun and tomorrow's tracking rate.
 *   agent on /delivery/me    the hero is the agent's own closing percentage.
 *                            It drops, and the strip keeps their calls and
 *                            their applications.
 *
 * Keyed by READING and path, not by path alone. /delivery is two pages: an
 * agency's own panel and the cross-agency view, whose hero is "Settled today"
 * -- a settled figure the strip never carries. The platform reading has a
 * figure of its own called `tonight`, and it is a projection across every
 * agency rather than the hero underneath it, so a rule keyed on the id alone
 * would silently delete the one platform figure staff came to the page for.
 * A test caught exactly that.
 */
export const HERO_BELOW: Record<string, readonly string[]> = {
  'agency:/delivery': ['tonight', 'rate'],
  'agent:/delivery/me': ['closing'],
};

/** Which reading of the strip the signed-in person gets. */
type Reading = 'strip' | 'publisher' | 'buyer' | 'none';

// ── The two payloads ────────────────────────────────────────────────────────

/** Mirrors GET /api/v1/live/strip. */
export interface StripPayload {
  scope: 'agency' | 'agent' | 'platform' | 'none';
  generatedAt: string;
  calendarDay?: string;
  timeZone?: string;

  // agency
  enrolled?: boolean;
  callsDelivered?: number;
  callsInProgress?: number;
  applicationsSubmitted?: number;
  /** Absent entirely for an agency that is not enrolled in billing. */
  billing?: {
    dailyBlockApplications: number;
    applicationsRemainingOnBlock: number;
    overrunToday: number;
    overrunAmountTonight: number | null;
    projectedTotalCharge: number | null;
    currentRate: number | null;
    trackingRate: number | null;
    trackingBelowMinimum: boolean;
  };

  // agent
  callsTaken?: number;
  applications?: number;
  closingPct?: number | null;
  agencyClosingPct?: number | null;
  closingPctVsAgencyPoints?: number | null;

  // platform
  agencies?: number;
  agenciesDelivering?: number;
  deliveredCalls?: number;
  projectedSettlementTonight?: number | null;
  agenciesNeedingAttention?: number;

  unavailable?: Record<string, string>;
}

/** Mirrors the response of GET /api/v1/live/metrics. Publisher and buyer only. */
interface LiveMetricsPayload {
  role: 'admin' | 'publisher' | 'buyer';
  generatedAt: string;
  callsInFlight: number | null;
  billableToday?: number | null;
  earningsToday?: string | null;
  spendToday?: string | null;
  callsTowardCapToday?: number | null;
  callCapToday?: number | null;
  billableRate?: number | null;
  unavailable: Record<string, string>;
}

export interface LiveMetricSlot extends Omit<LiveMetric, 'value'> {
  value: string | null;
  /** Why there is no value — the server's own explanation. */
  unavailableReason?: string;
}

const money = (v: string | null | undefined): string | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
};

/** The metrics API returns rates as fractions in [0,1]; the strip shows percent. */
const fraction = (v: number | null | undefined): string | null =>
  v === null || v === undefined ? null : `${Math.round(v * 100)}%`;

/** A plain count, or null. Never a fabricated zero. */
const counted = (v: number | null | undefined): string | null =>
  v === null || v === undefined ? null : count(v);

/** Dollars to the cent, or null. The same helper `/delivery` formats with. */
const amount = (v: number | null | undefined): string | null =>
  v === null || v === undefined ? null : dollars(v);

/** A percentage to two places, or null — the same helper `/delivery` uses. */
const percent = (v: number | null | undefined): string | null =>
  v === null || v === undefined ? null : pct(v);

// ── The readings ────────────────────────────────────────────────────────────

/**
 * The agency principal's row: on pace, what it costs, where the rate is going.
 *
 * The two rates are deliberately adjacent and deliberately labelled apart.
 * They are driven by two different closing percentages — the rate in force was
 * set by the trailing Delivery Day window, and tomorrow's is tracking toward
 * whatever the window ending today produces — and an agency that reads one as
 * the other believes it is being charged something it is not. Neither label
 * says "closing"; today's percentage is not on this strip at all, because the
 * figure that would sit beside two rates and price nothing is the one most
 * likely to be read as the one that prices everything.
 */
export function agencySlots(d: StripPayload): LiveMetricSlot[] {
  const why = (field: string): string | undefined => d.unavailable?.[field];
  const billing = d.billing;

  const operational: LiveMetricSlot[] = [
    {
      id: 'applications',
      label: 'Applications',
      value: counted(d.applicationsSubmitted),
      sub: billing ? `of ${count(billing.dailyBlockApplications)} block` : 'submitted today',
    },
    {
      id: 'calls',
      label: 'Calls delivered',
      value: counted(d.callsDelivered),
      sub: `${count(d.callsInProgress ?? 0)} in progress`,
      tone: (d.callsInProgress ?? 0) > 0 ? 'live' : 'ink',
    },
  ];

  // Not enrolled in billing: the operational counts, and nothing that implies
  // money. There is no `billing` object to render even if this wanted to.
  if (!billing) return operational;

  return [
    ...operational,
    {
      id: 'block',
      label: 'Block left',
      value: counted(billing.applicationsRemainingOnBlock),
      sub: 'paid, unused',
    },
    {
      id: 'overrun',
      label: 'Overrun',
      value: counted(billing.overrunToday),
      sub:
        billing.overrunAmountTonight === null
          ? 'tonight — no rate'
          : `${dollars(billing.overrunAmountTonight)} tonight`,
      tone: billing.overrunToday > 0 ? 'ringing' : 'ink',
    },
    {
      id: 'tonight',
      label: 'Tonight',
      value: amount(billing.projectedTotalCharge),
      sub: 'projected debit',
      tone: 'money',
      unavailableReason: why('projectedTotalCharge'),
    },
    {
      id: 'rate',
      label: 'Rate now',
      value: amount(billing.currentRate),
      sub: 'per application',
      unavailableReason: why('currentRate'),
    },
    {
      id: 'tracking',
      // Named for what it does, not for when it was measured: this is the rate
      // tomorrow is tracking toward, and it is the one thing on the strip that
      // has not happened yet.
      label: 'Rate tomorrow',
      value: billing.trackingBelowMinimum ? 'review' : amount(billing.trackingRate),
      sub: billing.trackingBelowMinimum ? 'window below minimum' : 'if today closed now',
      tone: billing.trackingBelowMinimum ? 'ringing' : 'ink',
      unavailableReason: billing.trackingBelowMinimum ? undefined : why('trackingRate'),
    },
  ];
}

/**
 * An agent's own day. No money, no rate, and no other agent.
 *
 * That is a property of the endpoint rather than of this function: the server's
 * agent reading loads no rate, balance, overrun or charge, so there is nothing
 * here to render by accident.
 */
export function agentSlots(d: StripPayload): LiveMetricSlot[] {
  const why = (field: string): string | undefined => d.unavailable?.[field];
  const delta = d.closingPctVsAgencyPoints;

  return [
    {
      id: 'calls',
      label: 'Your calls',
      value: counted(d.callsTaken),
      sub: 'answered today',
    },
    {
      id: 'applications',
      label: 'Your applications',
      value: counted(d.applications),
      sub: 'submitted today',
    },
    {
      id: 'closing',
      label: 'Your closing',
      value: percent(d.closingPct),
      sub:
        d.agencyClosingPct === null || d.agencyClosingPct === undefined
          ? 'agency —'
          : delta === null || delta === undefined
            ? `agency ${pct(d.agencyClosingPct)}`
            : `agency ${pct(d.agencyClosingPct)} · ${points(delta)} pts`,
      // Below the agency is the thing to act on; above it is not a warning.
      tone: delta !== null && delta !== undefined && delta < 0 ? 'dropped' : 'ink',
      unavailableReason: why('closingPct'),
    },
  ];
}

/** The platform: who is delivering, what the day is, and who needs somebody. */
export function platformSlots(d: StripPayload): LiveMetricSlot[] {
  const why = (field: string): string | undefined => d.unavailable?.[field];
  const attention = d.agenciesNeedingAttention ?? 0;

  return [
    {
      id: 'delivering',
      label: 'Delivering',
      value: counted(d.agenciesDelivering),
      sub: `of ${count(d.agencies ?? 0)} agencies`,
      tone: (d.agenciesDelivering ?? 0) > 0 ? 'live' : 'ink',
    },
    {
      id: 'calls',
      label: 'Calls delivered',
      value: counted(d.deliveredCalls),
      sub: 'today, all agencies',
    },
    {
      id: 'applications',
      label: 'Applications',
      value: counted(d.applications),
      sub: 'today, all agencies',
    },
    {
      id: 'tonight',
      label: 'Tonight',
      value: amount(d.projectedSettlementTonight),
      sub: 'projected settlement',
      tone: 'money',
      unavailableReason: why('projectedSettlementTonight'),
    },
    {
      id: 'attention',
      label: 'Needs attention',
      value: counted(attention),
      sub: attention === 1 ? 'agency' : 'agencies',
      tone: attention > 0 ? 'dropped' : 'ink',
    },
  ];
}

/** The publisher and buyer readings, unchanged, from `/api/v1/live/metrics`. */
function marketplaceSlots(
  reading: 'publisher' | 'buyer',
  d: LiveMetricsPayload | null
): LiveMetricSlot[] {
  const why = (field: string): string | undefined => d?.unavailable?.[field];

  if (reading === 'publisher') {
    return [
      {
        id: 'live',
        label: 'Calls live',
        value: counted(d?.callsInFlight),
        tone: 'live',
        unavailableReason: why('callsInFlight'),
      },
      {
        id: 'billable',
        label: 'Billable today',
        value: counted(d?.billableToday),
        sub: d?.billableRate != null ? `${fraction(d.billableRate)} of calls` : undefined,
        unavailableReason: why('billableToday'),
      },
      {
        id: 'earnings',
        label: 'Earnings today',
        value: money(d?.earningsToday),
        tone: 'money',
        unavailableReason: why('earningsToday'),
      },
    ];
  }

  return [
    {
      id: 'live',
      label: 'Calls live',
      value: counted(d?.callsInFlight),
      tone: 'live',
      unavailableReason: why('callsInFlight'),
    },
    {
      id: 'spend',
      label: 'Spend today',
      value: money(d?.spendToday),
      tone: 'money',
      unavailableReason: why('spendToday'),
    },
    {
      // Calls against cap, not spend against cap: the cap in the schema is
      // BuyerEndpoint.maxCap, a call count, so pairing it with money would
      // put two different units either side of the word "of".
      id: 'cap',
      label: 'Calls vs cap',
      value: counted(d?.callsTowardCapToday),
      sub: d?.callCapToday != null ? `of ${count(d.callCapToday)} cap` : 'no cap set',
      unavailableReason: why('callCapToday'),
    },
    {
      id: 'billable-rate',
      label: 'Billable rate',
      value: fraction(d?.billableRate),
      unavailableReason: why('billableRate'),
    },
  ];
}

export interface UseLiveMetricsResult {
  metrics: LiveMetric[];
  slots: LiveMetricSlot[];
  connection: LiveConnectionState;
  lastUpdated: Date | null;
  /** True when not one metric has a real value — the strip should not render. */
  empty: boolean;
  note?: string;
  /** "2026-09-09 · America/New_York", or undefined when the day is unknown. */
  asOf?: string;
  /**
   * Which reading these figures are: the server's own `scope` for the strip
   * endpoint, or the role for the two marketplace readings. Used for the
   * hero-suppression rule and stamped on the rendered row.
   */
  scope: string;
}

export function useLiveMetrics(): UseLiveMetricsResult {
  const auth = useAuth();
  const platform = usePlatformContext();
  const pathname = usePathname();

  const [strip, setStrip] = React.useState<StripPayload | null>(null);
  const [marketplace, setMarketplace] = React.useState<LiveMetricsPayload | null>(null);
  const [lastUpdated, setLastUpdated] = React.useState<Date | null>(null);
  const [reachable, setReachable] = React.useState<boolean | null>(null);

  /*
   * Which endpoint, and it is decided BEFORE anything is asked.
   *
   * NetEnroll staff in the cross-agency view come first, whatever other roles
   * they happen to hold. An operator who also holds PUBLISHER is still staff
   * with no agency entered, and asking the agency-scoped metrics endpoint on
   * their behalf is the 409-per-page-load loop this hook has already been
   * fixed for once. It is not reintroduced by adding a role to the front of a
   * precedence list.
   */
  const reading: Reading = platform.needsAgency
    ? 'strip'
    : auth.isPublisherOnly
      ? 'publisher'
      : auth.isBuyerOnly
        ? 'buyer'
        : auth.user
          ? 'strip'
          : 'none';

  /*
   * Everything this needs before it may ask. `platform.loading` counts: asking
   * before the answer is in is how a request gets fired for an operator who
   * turns out to have no agency at all.
   */
  const mayPoll = !auth.loading && !!auth.user && reading !== 'none' && !platform.loading;

  /*
   * The marketplace readings are agency-scoped and must not be asked without a
   * tenant. The strip endpoint scopes itself from the session and answers the
   * cross-agency reading for staff, so it is the one request that is correct in
   * both states.
   */
  const path = reading === 'strip' ? '/api/v1/live/strip' : '/api/v1/live/metrics';

  React.useEffect(() => {
    if (!mayPoll) return;

    let cancelled = false;

    const tick = async (): Promise<PollOutcome> => {
      /*
       * Both `/api/v1/live/*` routes answer with a BARE body rather than an
       * `{ data: ... }` envelope, so `response.data` here is the payload
       * itself. That is the older of the two conventions in this API and it is
       * the one its siblings use; unwrapping it as though it were enveloped
       * yields undefined and a strip that renders nothing forever. See
       * `ApiResponse` in @/lib/api for the trap and why it is worth naming.
       */
      const res = await apiClient.get<StripPayload | LiveMetricsPayload>(path).catch(() => null);
      if (cancelled) return 'ok';

      const body = res as {
        data?: StripPayload | LiveMetricsPayload;
        error?: { code: string };
      } | null;

      if (body && isNoActingTenant(body)) {
        // The correct answer, and the same one next time. Stop asking.
        setReachable(false);
        setStrip(null);
        setMarketplace(null);
        return 'refused';
      }

      if (!body || body.error || !body.data) {
        setReachable(false);
        // Never keep showing the last poll's numbers as if they were live.
        setStrip(null);
        setMarketplace(null);
        return 'failed';
      }

      if (path === '/api/v1/live/strip') {
        setStrip(body.data as StripPayload);
      } else {
        setMarketplace(body.data as LiveMetricsPayload);
      }

      setReachable(true);
      setLastUpdated(new Date());
      return 'ok';
    };

    const poller = createLivePoller({ load: tick, intervalMs: POLL_MS });
    poller.start();

    return () => {
      cancelled = true;
      poller.stop();
    };
  }, [mayPoll, path]);

  /*
   * Which reading is on screen.
   *
   * The strip endpoint's own `scope` for the three agency-portal readings, so
   * the server decides who sees what and the client never second-guesses it;
   * the role for the two marketplace readings, which have no such field.
   */
  const scope = reading === 'publisher' || reading === 'buyer' ? reading : (strip?.scope ?? 'none');

  const slots = React.useMemo(() => {
    const built: LiveMetricSlot[] =
      reading === 'publisher' || reading === 'buyer'
        ? marketplaceSlots(reading, marketplace)
        : strip === null
          ? []
          : strip.scope === 'agency'
            ? agencySlots(strip)
            : strip.scope === 'agent'
              ? agentSlots(strip)
              : strip.scope === 'platform'
                ? platformSlots(strip)
                : // `none`: a tenant member who is neither an administrator nor
                  // an agent. There is no reading of the day for them, and an
                  // empty strip is the honest answer.
                  [];

    /*
     * The reading is the server's own `scope` for the strip endpoint, so the
     * page below and the figures above are described by the same word. For the
     * two marketplace readings it is the role, and neither publisher nor buyer
     * has an entry: nothing in their portals renders one of these figures as a
     * hero.
     */
    const suppressed = HERO_BELOW[`${scope}:${pathname ?? ''}`] ?? [];
    return suppressed.length === 0 ? built : built.filter(slot => !suppressed.includes(slot.id));
  }, [reading, marketplace, strip, scope, pathname]);

  const withValues = slots.filter(s => s.value !== null);

  const connection: LiveConnectionState = SOCKET_ENABLED
    ? 'live'
    : reachable === false
      ? 'offline'
      : 'degraded';

  return {
    slots,
    scope,
    metrics: slots.map(s => ({ ...s, value: s.value ?? '—' })),
    connection,
    lastUpdated,
    empty: withValues.length === 0,
    asOf:
      strip?.calendarDay === undefined
        ? undefined
        : strip.timeZone
          ? `${strip.calendarDay} · ${strip.timeZone}`
          : strip.calendarDay,
    note: SOCKET_ENABLED
      ? undefined
      : reachable === false
        ? 'Metrics unavailable — showing no numbers rather than stale ones'
        : 'Polling every 30s',
  };
}
