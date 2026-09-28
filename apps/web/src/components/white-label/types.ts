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
    /** Every billable call, whoever answered it. */
    billable: number;
    billableToBuyers: number;
    billableAgentAnswered: number;
    sellThroughPct: number | null;
    revenue: number;
    publisherPayouts: number;
    callCost: number;
    /** True when any call's cost in the period is the $/min estimate, not a carrier figure. */
    callCostEstimated: boolean;
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
    /** Every billable call, agent- or buyer-answered: what the payout pays for. */
    billable: number;
    billableAgentAnswered: number;
    billableToBuyers: number;
    payout: number;
    revenue: number;
    profit: number;
  }>;
  byDay: Array<{
    day: string;
    inbound: number;
    sentToBuyers: number;
    /** Every billable call that day, whoever answered it. */
    billable: number;
    billableToBuyers: number;
    billableAgentAnswered: number;
    revenue: number;
    payout: number;
    profit: number;
  }>;
}

export interface PublisherPaymentView {
  id: string;
  publisherId: string;
  publisherName: string;
  /**
   * PAYMENT is what the agency paid. CLAWBACK is a return accepted after the
   * publisher was paid for the call: a negative amount, deducted from the
   * publisher's next payment (`appliedToPaymentId`, null while it waits).
   */
  kind: 'PAYMENT' | 'CLAWBACK';
  callId: string | null;
  appliedToPaymentId: string | null;
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
    /** Returns accepted after this publisher was paid, not yet deducted. */
    returnsPending: number;
    /** payable − returnsPending; negative when the publisher owes the agency. */
    netPayable: number;
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

/**
 * `GET/PUT /api/v1/network/agencies/:tenantId/settings`: what a white-label
 * parent sets for one child -- its phone-number limit (null for none) and its
 * upgrades -- and how many numbers it holds. Not on the agencies list, which
 * is aggregates only.
 */
export interface NetworkAgencySettings {
  tenantId: string;
  numbersLimit: number | null;
  /** On the GET; the PUT's answer may leave it out. */
  numbersUsed?: number;
  upgrades: string[];
}

export interface NetworkAgencies {
  period: ResolvedPeriodView;
  agencies: NetworkAgencyRow[];
}

/** The periods Today can be read over; New York calendar days. */
export type TodayPeriodKey = 'TODAY' | 'YESTERDAY' | 'LAST_7_DAYS';

/** One period's totals on Today, and its comparison's. */
export interface TodayTotals {
  inbound: number;
  answeredByAgents: number;
  sentToBuyers: number;
  unanswered: number;
  blocked: number;
  /** Every billable call, whoever answered it. */
  billable: number;
  revenue: number;
  profit: number;
  applications: number;
  closingPct: number | null;
  /** Mean connected seconds over answered calls; null with none. */
  avgCallSeconds: number | null;
}

/** `GET /api/v1/white-label/today?period=`: the white-label owner's Today screen. */
export interface WhiteLabelToday {
  generatedAt: string;
  period: { key: TodayPeriodKey; label: string; from: string; to: string };
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
  /** The selected period's totals (named for the default period). */
  today: TodayTotals;
  /** What the period is measured against, and its name: "same time yesterday". */
  comparison: TodayTotals & { label: string; from: string; to: string };
  /**
   * Where the period's calls went: 24 hourly rows for a one-day period, 7
   * daily rows for the last seven days. `comparison` is the comparison
   * period's calls in the same slot.
   */
  byHour: Array<{
    hour: number | null;
    day: string | null;
    agents: number;
    buyers: number;
    unanswered: number;
    blocked: number;
    comparison: number;
  }>;
  /** The last seven days ending today, whatever the period. */
  trend: Array<{
    day: string;
    inbound: number;
    revenue: number;
    profit: number;
    applications: number;
  }>;
  /** Every active agent's presence, ready first. */
  agents: Array<{ id: string; name: string; presence: 'READY' | 'ON_CALL' | 'AWAY' | 'OFFLINE' }>;
  agentBlockers: Array<{ code: string; reason: string; count: number }>;
  returnsWaiting: { count: number; oldestAt: string | null };
  owedToPublishers: { amount: number; publishers: number; calls: number };
  /** One row per buyer on the agency live board, with today's cap, busiest first. */
  buyers: Array<{
    id: string;
    name: string;
    kind: string;
    callsInFlight: number;
    deliveredToday: number;
    /** Kept for older screens; buyers write no applications here, so always 0. */
    applicationsToday: number;
    closingPct: number | null;
    /** The period's calls, billable calls and what they sold for. */
    calls: number;
    billable: number;
    revenue: number;
    atCap: boolean;
    capUsed: number;
    capMax: number | null;
  }>;
  /** The period's publishers, most profitable first. */
  publishers: Array<{
    publisherId: string;
    publisherName: string;
    calls: number;
    billable: number;
    billablePct: number | null;
    payout: number;
    profit: number;
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

/** One upgrade an agency has asked for and not yet been given. */
export interface UpgradeRequestView {
  id: string;
  upgradeKey: string;
  upgradeName: string;
  status: 'OPEN' | 'DONE' | 'DECLINED';
  userId: string | null;
  createdAt: string;
}

/** A child agency's own record, as it was filled in when it was onboarded. */
export interface NetworkAgencyProfile {
  legalName: string;
  state: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  licensedAgentCount: number;
  deliveryDays: string[];
  deliveryStartTime: string;
  deliveryEndTime: string;
  deliveryTimeZone: string;
  createdAt: string | null;
  updatedAt: string | null;
}

/**
 * `GET /api/v1/network/agencies/:tenantId`: one child's page. `stats` are the
 * same counts as its row in the list, over `period`; `settings` is the same
 * payload as `.../settings`.
 */
export interface NetworkAgencyDetail {
  tenantId: string;
  name: string;
  status: string;
  createdAt: string;
  profile: NetworkAgencyProfile | null;
  owner: NetworkAgencyRow['owner'];
  settings: NetworkAgencySettings;
  period: ResolvedPeriodView;
  stats: Pick<
    NetworkAgencyRow,
    'agents' | 'inboundCalls' | 'answeredByAgents' | 'applications' | 'closingPct'
  >;
  openUpgradeRequests: UpgradeRequestView[];
}
