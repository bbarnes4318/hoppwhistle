'use client';

import * as React from 'react';

import type { LiveConnectionState, LiveMetric } from '@/components/domain';
import { useAuth } from '@/hooks/use-auth';
import { apiClient } from '@/lib/api';

/**
 * Data layer for the LiveStrip, backed by GET /api/v1/live/metrics.
 *
 * That endpoint scopes itself from the JWT — a publisher can only ever get
 * their own calls — and returns null for any figure it cannot source
 * correctly, with the reason in an `unavailable` map. This hook renders those
 * nulls as muted em dashes with the server's reason as the tooltip. Nothing is
 * estimated, derived from an unrelated number, or carried over from an earlier
 * poll: a fabricated live number on a screen where someone watches their own
 * earnings is worse than an absent one.
 *
 * ── Still polling, not socketed ───────────────────────────────────────────
 *
 * The brief wants this on the websocket at apps/api/src/routes/websocket.ts.
 * That endpoint still cannot authenticate a specific user: it takes an
 * `apiKey` query param (never a JWT), treats an empty VALID_API_KEYS as
 * "accept anything", and maps every connection to DEFAULT_TENANT_ID rather
 * than the caller's own tenant. Since the strip renders on every page for
 * every role, connecting to it would stream one tenant's call and billing
 * events into every browser. So the socket stays gated behind SOCKET_ENABLED
 * and this polls every five seconds — the fallback the brief already
 * specifies. The API caches for 3s, so a fleet of pollers collapses onto
 * roughly one query pair per tenant per 3s.
 */

/** Flip once /ws/events can authenticate a user with their JWT and scope to them. */
const SOCKET_ENABLED = false;

const POLL_MS = 5000;

type Role = 'admin' | 'publisher' | 'buyer' | 'other';

/** Mirrors the response of GET /api/v1/live/metrics. */
interface LiveMetricsPayload {
  role: 'admin' | 'publisher' | 'buyer';
  generatedAt: string;
  callsInFlight: number | null;
  answerRateHour?: number | null;
  abandonRateHour?: number | null;
  revenueRunRateHour?: string | null;
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

/** The API returns rates as fractions in [0,1]; the strip shows percentages. */
const percent = (v: number | null | undefined): string | null =>
  v === null || v === undefined ? null : `${Math.round(v * 100)}%`;

const count = (v: number | null | undefined): string | null =>
  v === null || v === undefined ? null : v.toLocaleString('en-US');

function buildSlots(role: Role, d: LiveMetricsPayload | null): LiveMetricSlot[] {
  const why = (field: string) => d?.unavailable?.[field];

  switch (role) {
    case 'publisher':
      return [
        {
          id: 'live',
          label: 'Calls live',
          value: count(d?.callsInFlight),
          tone: 'live',
          unavailableReason: why('callsInFlight'),
        },
        {
          id: 'billable',
          label: 'Billable today',
          value: count(d?.billableToday),
          sub: d?.billableRate != null ? `${percent(d.billableRate)} of calls` : undefined,
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

    case 'buyer':
      return [
        {
          id: 'live',
          label: 'Calls live',
          value: count(d?.callsInFlight),
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
          value: count(d?.callsTowardCapToday),
          sub: d?.callCapToday != null ? `of ${count(d.callCapToday)} cap` : 'no cap set',
          unavailableReason: why('callCapToday'),
        },
        {
          id: 'billable-rate',
          label: 'Billable rate',
          value: percent(d?.billableRate),
          unavailableReason: why('billableRate'),
        },
      ];

    case 'admin':
      return [
        {
          id: 'in-flight',
          label: 'In flight',
          value: count(d?.callsInFlight),
          tone: 'live',
          unavailableReason: why('callsInFlight'),
        },
        {
          id: 'answer-rate',
          label: 'Answer rate',
          value: percent(d?.answerRateHour),
          sub: 'last 60 min',
          unavailableReason: why('answerRateHour'),
        },
        {
          id: 'abandon-rate',
          label: 'Abandon rate',
          value: percent(d?.abandonRateHour),
          sub: 'last 60 min',
          tone: 'dropped',
          unavailableReason: why('abandonRateHour'),
        },
        {
          id: 'run-rate',
          label: 'Revenue run rate',
          value: money(d?.revenueRunRateHour),
          sub: 'per hour',
          tone: 'money',
          unavailableReason: why('revenueRunRateHour'),
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
  const [data, setData] = React.useState<LiveMetricsPayload | null>(null);
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
      const res = await apiClient.get<LiveMetricsPayload>('/api/v1/live/metrics').catch(() => null);
      if (cancelled) return;

      const body = res as { data?: LiveMetricsPayload; error?: unknown } | null;
      if (!body || body.error || !body.data) {
        setReachable(false);
        // Never keep showing the last poll's numbers as if they were live.
        setData(null);
        return;
      }

      setReachable(true);
      setData(body.data);
      setLastUpdated(new Date());
    };

    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [auth.loading, auth.user, role]);

  const slots = React.useMemo(() => buildSlots(role, data), [role, data]);
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
