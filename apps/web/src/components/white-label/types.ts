/**
 * The shapes the white-label tier's own routes answer with.
 *
 * Mirrors `apps/api/src/services/reporting/call-sales.ts`, `routes/payouts.ts`
 * and `routes/network.ts`. Every figure arrives computed: percentages are
 * 0-100 and NULL rather than zero when there was nothing to divide by, and
 * money is dollars. Nothing here recomputes one, because a browser deriving a
 * margin is a second answer to a question the server already answered.
 */

import type { PeriodKey } from '@/components/leaderboard/types';

export interface ResolvedPeriodView {
  key: PeriodKey;
  label: string;
  from: string;
  to: string;
  days: number;
  complete: boolean;
}

export interface CallSalesSummary {
  period: ResolvedPeriodView;
  totals: {
    inboundCalls: number;
    answeredByAgents: number;
    sentToBuyers: number;
    billableToBuyers: number;
    sellThroughPct: number | null;
    revenue: number;
    publisherPayouts: number;
    callCost: number;
    otherCosts: number;
    adjustments: number;
    disputes: number;
    profit: number;
    marginPct: number | null;
    revenuePerBillableCall: number | null;
    disputedCalls: number;
    duplicates: number;
    blocked: number;
  };
  disposition: { yourAgents: number; buyers: number; unanswered: number; blocked: number };
  byBuyer: Array<{
    buyerId: string;
    buyerName: string;
    calls: number;
    billable: number;
    billablePct: number | null;
    revenue: number;
    avgConnectedSeconds: number | null;
    disputed: number;
    capConsumedToday: number;
  }>;
  byPublisher: Array<{
    publisherId: string;
    publisherName: string;
    calls: number;
    answeredByAgents: number;
    sentToBuyers: number;
    billable: number;
    payout: number;
    revenue: number;
    profit: number;
  }>;
  byDay: Array<{
    day: string;
    inbound: number;
    sentToBuyers: number;
    billable: number;
    revenue: number;
    payout: number;
    profit: number;
  }>;
}

export interface PublisherPaymentView {
  id: string;
  publisherId: string;
  publisherName: string;
  amount: number;
  periodFrom: string;
  periodTo: string;
  method: string;
  reference: string | null;
  paidAt: string;
}

export interface PayoutsSummary {
  /** Plus the two instants a payment for exactly this period should name. */
  period: ResolvedPeriodView & { startsAt: string; endsAt: string };
  publishers: Array<{
    publisherId: string;
    publisherName: string;
    payable: number;
    payableCalls: number;
    held: number;
    paid: number;
    lastPayment: PublisherPaymentView | null;
  }>;
  payments: PublisherPaymentView[];
}

export interface NetworkAgencyRow {
  tenantId: string;
  name: string;
  status: string;
  createdAt: string;
  agents: number;
  inboundCalls: number;
  answeredByAgents: number;
  applications: number;
  closingPct: number | null;
  owner: {
    status: 'NOT_INVITED' | 'PENDING' | 'ACCEPTED' | 'EXPIRED';
    email: string | null;
    invitedAt: string | null;
  };
}

export interface NetworkAgencies {
  period: ResolvedPeriodView;
  agencies: NetworkAgencyRow[];
}

/** `GET /api/v1/white-label/today`: the white-label owner's Today screen. */
export interface WhiteLabelToday {
  now: {
    callsUp: number;
    agentsReady: number;
    agentsOnCall: number;
    agentsActive: number;
    buyersTaking: number;
    buyersAtCap: number;
    buyersActive: number;
    returnsOpen: number;
  };
  today: {
    inbound: number;
    answeredByAgents: number;
    sentToBuyers: number;
    unanswered: number;
    blocked: number;
    revenue: number;
    profit: number;
    applications: number;
    closingPct: number | null;
  };
  /** One row per buyer on the agency live board, with today's cap. */
  buyers: Array<{
    id: string;
    name: string;
    kind: string;
    callsInFlight: number;
    deliveredToday: number;
    applicationsToday: number;
    closingPct: number | null;
    atCap: boolean;
    capUsed: number;
    capMax: number | null;
  }>;
  /** What needs a decision, in the order to take it. Only non-zero counts. */
  attention: Array<{
    kind: 'returns' | 'buyers_at_cap' | 'agents_blocked' | 'payouts_owed';
    count: number;
    href: string;
    label: string;
    /** Dollars; on `payouts_owed` only. */
    amount?: number;
  }>;
}
