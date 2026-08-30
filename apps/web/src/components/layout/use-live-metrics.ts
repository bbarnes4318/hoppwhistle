'use client';

import * as React from 'react';

import type { LiveConnectionState, LiveMetric } from '@/components/domain';
import { useAuth } from '@/hooks/use-auth';
import { apiClient } from '@/lib/api';

/**
 * Data layer for the LiveStrip.
 *
 * ── Why this polls rather than using the websocket ─────────────────────────
 *
 * The brief says the strip reads from the existing socket at
 * apps/api/src/routes/websocket.ts. It cannot, yet, and connecting anyway would
 * be a data leak rather than a feature:
 *
 *   - /ws/events authenticates with an `apiKey` query param or x-api-key
 *     header. The web app has no API key; it holds a JWT. There is no JWT path.
 *   - VALID_API_KEYS is unset everywhere in this repo, and the handler treats an
 *     empty list as "accept anything", so ANY non-empty string authenticates.
 *   - Every connection is then mapped to process.env.DEFAULT_TENANT_ID (also
 *     unset, defaulting to the all-zeros UUID) rather than to the caller's own
 *     tenant, and is subscribed to call.*, billing.* and recording.* for it.
 *
 * The strip renders on every page for every role, so wiring it to that socket
 * would stream one tenant's live call and billing events into every browser,
 * including publishers' and buyers'. So the socket transport is written but
 * gated off until the endpoint can authenticate a specific user; see
 * `SOCKET_ENABLED` below. Until then this polls an authenticated REST endpoint
 * every five seconds, which is the fallback the brief already specifies.
 *
 * ── Why some metrics have no value ────────────────────────────────────────
 *
 * /api/v1/dashboard/stats is the only endpoint that is both correctly scoped to
 * the caller (it derives publisherId / buyerId / admin from the JWT) and takes a
 * date range. It returns totalCalls and connectedCalls, and nothing else the
 * strip needs — no in-flight count, no billable count, no money.
 *
 * Metrics without a source return `value: null` and render as an em dash. They
 * are never estimated, never derived from an unrelated number, and never
 * carried over from an earlier poll. A fabricated live number on a screen where
 * someone watches their own earnings is worse than an empty one.
 */

/**
 * Flip to true once /ws/events can authenticate an individual user with their
 * JWT and scope events to their tenant AND their publisher/buyer. Until then
 * the socket must not be connected — see the note above.
 */
const SOCKET_ENABLED = false;

const POLL_MS = 5000;

type Role = 'admin' | 'publisher' | 'buyer' | 'other';

interface DashboardStats {
  totalCalls?: number;
  connectedCalls?: number;
}

/** A metric that knows whether it actually has a source. */
export interface LiveMetricSlot extends Omit<LiveMetric, 'value'> {
  value: string | null;
  /**
   * Why there is no value. Shown as a tooltip. Named for the reason rather than
   * the state because LiveMetric already carries `unavailable` as a boolean.
   */
  unavailableReason?: string;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfHour(): Date {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  return d;
}

async function fetchStats(from: Date, to: Date): Promise<DashboardStats | null> {
  const res = await apiClient.get<DashboardStats>(
    `/api/v1/dashboard/stats?startDate=${from.toISOString()}&endDate=${to.toISOString()}`
  );
  // apiClient resolves with { data } on success and { error } on failure.
  const body = res as { data?: DashboardStats; error?: unknown };
  if (body?.error || !body?.data) return null;
  return body.data;
}

function pct(numerator: number, denominator: number): string {
  if (denominator <= 0) return '0%';
  return `${Math.round((numerator / denominator) * 100)}%`;
}

const NO_SOURCE =
  'Not available yet — no API endpoint exposes this. See useLiveMetrics for the contract.';

/** The brief's metric set per role, in the brief's order. */
function buildSlots(
  role: Role,
  today: DashboardStats | null,
  thisHour: DashboardStats | null
): LiveMetricSlot[] {
  switch (role) {
    case 'publisher':
      return [
        {
          id: 'live',
          label: 'Calls live',
          value: null,
          unavailableReason: NO_SOURCE,
          tone: 'live',
        },
        {
          id: 'billable',
          label: 'Billable today',
          value: null,
          sub: today ? `${today.totalCalls ?? 0} calls today` : undefined,
          unavailableReason: NO_SOURCE,
        },
        {
          id: 'earnings',
          label: 'Earnings today',
          value: null,
          unavailableReason: NO_SOURCE,
          tone: 'money',
        },
      ];

    case 'buyer':
      return [
        {
          id: 'live',
          label: 'Calls live',
          value: null,
          unavailableReason: NO_SOURCE,
          tone: 'live',
        },
        {
          id: 'spend',
          label: 'Spend today',
          value: null,
          unavailableReason: NO_SOURCE,
          tone: 'money',
        },
        {
          id: 'billable-rate',
          label: 'Billable rate',
          value: null,
          sub: today ? `${today.totalCalls ?? 0} calls today` : undefined,
          unavailableReason: NO_SOURCE,
        },
      ];

    case 'admin':
      return [
        {
          id: 'in-flight',
          label: 'In flight',
          value: null,
          unavailableReason: NO_SOURCE,
          tone: 'live',
        },
        {
          id: 'answer-rate',
          label: 'Answer rate',
          // The one metric with a real, correctly scoped source today.
          value:
            thisHour && (thisHour.totalCalls ?? 0) > 0
              ? pct(thisHour.connectedCalls ?? 0, thisHour.totalCalls ?? 0)
              : thisHour
                ? '—'
                : null,
          sub: thisHour ? `${thisHour.totalCalls ?? 0} calls this hour` : undefined,
          unavailableReason: thisHour ? undefined : NO_SOURCE,
        },
        {
          id: 'abandon-rate',
          label: 'Abandon rate',
          value: null,
          // Deliberately not 100% minus the answer rate: a call that did not
          // connect is not necessarily one the caller abandoned, and labelling
          // it so would put a number next to the word "abandon" that no one
          // could act on.
          unavailableReason:
            'Not available yet — an unconnected call is not the same as an abandoned one, so this cannot be derived from the answer rate.',
          tone: 'dropped',
        },
        {
          id: 'run-rate',
          label: 'Revenue run rate',
          value: null,
          unavailableReason: NO_SOURCE,
          tone: 'money',
        },
      ];

    default:
      return [];
  }
}

export interface UseLiveMetricsResult {
  metrics: LiveMetric[];
  slots: LiveMetricSlot[];
  connection: LiveConnectionState;
  lastUpdated: Date | null;
  /** True when not one metric has a real value — the strip should not render. */
  empty: boolean;
  note?: string;
}

export function useLiveMetrics(): UseLiveMetricsResult {
  const auth = useAuth();
  const [today, setToday] = React.useState<DashboardStats | null>(null);
  const [thisHour, setThisHour] = React.useState<DashboardStats | null>(null);
  const [lastUpdated, setLastUpdated] = React.useState<Date | null>(null);
  const [reachable, setReachable] = React.useState<boolean | null>(null);

  const role: Role = auth.hasFullAccess
    ? 'admin'
    : auth.isPublisherOnly
      ? 'publisher'
      : auth.isBuyerOnly
        ? 'buyer'
        : 'other';

  React.useEffect(() => {
    if (auth.loading || !auth.user || role === 'other') return;

    let cancelled = false;

    const tick = async () => {
      const now = new Date();
      const [dayRes, hourRes] = await Promise.all([
        fetchStats(startOfToday(), now).catch(() => null),
        role === 'admin' ? fetchStats(startOfHour(), now).catch(() => null) : Promise.resolve(null),
      ]);
      if (cancelled) return;

      const ok = dayRes !== null || hourRes !== null;
      setReachable(ok);

      if (ok) {
        setToday(dayRes);
        setThisHour(hourRes);
        setLastUpdated(new Date());
      } else {
        // Never keep showing the previous poll's numbers as if they were live.
        setToday(null);
        setThisHour(null);
      }
    };

    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [auth.loading, auth.user, role]);

  const slots = React.useMemo(() => buildSlots(role, today, thisHour), [role, today, thisHour]);

  const withValues = slots.filter(s => s.value !== null);

  const connection: LiveConnectionState = SOCKET_ENABLED
    ? 'live'
    : reachable === false
      ? 'offline'
      : 'degraded';

  return {
    slots,
    metrics: slots.map(s => ({ ...s, value: s.value ?? '—' })),
    connection,
    lastUpdated,
    empty: withValues.length === 0,
    note: SOCKET_ENABLED
      ? undefined
      : reachable === false
        ? 'Metrics unavailable — showing no numbers rather than stale ones'
        : 'Polling every 5s — live feed not enabled',
  };
}
