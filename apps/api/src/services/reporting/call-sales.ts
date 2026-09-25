/**
 * What a white-label agency's calls sold for.
 *
 * ── One agency, its inbound calls, one period ─────────────────────────────────
 *
 * `GET /api/v1/call-sales/summary` answers for the ACTING tenant and names no
 * other: every query here is scoped to the `tenantId` it is handed, including
 * the buyer and publisher name lookups, so a buyer id on a call that somehow
 * pointed at another agency's buyer would render as its snapshot name and
 * never read that agency's row.
 *
 * The rows are the tenant's INBOUND calls created inside the period. The period
 * is a name resolved by `services/leaderboard/period.ts`, so a day here starts
 * and ends where it does on the Leaderboard.
 *
 * ── The money is not computed here ───────────────────────────────────────────
 *
 * Payout, call cost, the ledger fees, adjustments, disputes and profit come
 * from `services/reporting/call-money.ts`, the arithmetic
 * `/api/v1/reports/campaign-profitability` runs on, so the two reconcile.
 * Revenue is the sum of `buyerBillableAmount` over billable calls; the billing
 * service writes zero revenue on every non-billable call, so that is the same
 * figure the report sums.
 */

import type { Prisma, PrismaClient } from '@prisma/client';

import type { ResolvedPeriod } from '../leaderboard/period.js';
import { calendarDayOf } from '../rating/calendar-day.js';

import {
  callAmounts,
  loadCallMoneyLedger,
  summariseCallMoney,
  type MoneyBucket,
  type MoneyLedgerEntry,
} from './call-money.js';

export type CallSalesDeps = Pick<PrismaClient, 'call' | 'accrualLedger' | 'buyer' | 'publisher'>;

export interface CallSalesTotals {
  inboundCalls: number;
  answeredByAgents: number;
  sentToBuyers: number;
  billableToBuyers: number;
  /** A percentage: 62.5 means 62.5%. Null when nothing was sent to a buyer. */
  sellThroughPct: number | null;
  revenue: number;
  publisherPayouts: number;
  callCost: number;
  otherCosts: number;
  adjustments: number;
  disputes: number;
  profit: number;
  /** A percentage. Null when there was no revenue. */
  marginPct: number | null;
  revenuePerBillableCall: number | null;
  disputedCalls: number;
  duplicates: number;
  blocked: number;
}

export interface CallSalesDisposition {
  yourAgents: number;
  buyers: number;
  unanswered: number;
  blocked: number;
}

export interface CallSalesBuyerRow {
  buyerId: string;
  buyerName: string;
  calls: number;
  billable: number;
  billablePct: number | null;
  revenue: number;
  avgConnectedSeconds: number | null;
  disputed: number;
  capConsumedToday: number;
}

export interface CallSalesPublisherRow {
  publisherId: string;
  publisherName: string;
  calls: number;
  answeredByAgents: number;
  sentToBuyers: number;
  billable: number;
  payout: number;
  revenue: number;
  profit: number;
}

export interface CallSalesDayRow {
  day: string;
  inbound: number;
  sentToBuyers: number;
  billable: number;
  revenue: number;
  payout: number;
  profit: number;
}

export interface CallSalesSummary {
  period: {
    key: string;
    label: string;
    from: string;
    to: string;
    days: number;
    complete: boolean;
  };
  totals: CallSalesTotals;
  disposition: CallSalesDisposition;
  byBuyer: CallSalesBuyerRow[];
  byPublisher: CallSalesPublisherRow[];
  byDay: CallSalesDayRow[];
}

/** The columns of a call this reads. */
const CALL_SELECT = {
  id: true,
  createdAt: true,
  answeredByUserId: true,
  buyerId: true,
  buyerName: true,
  publisherId: true,
  publisherName: true,
  billable: true,
  buyerBillableAmount: true,
  publisherPayoutAmount: true,
  cost: true,
  connectedDuration: true,
  disputeStatus: true,
  isDuplicate: true,
  blocked: true,
} satisfies Prisma.CallSelect;

type SalesCall = Prisma.CallGetPayload<{ select: typeof CALL_SELECT }>;

/** Money as a number, to the ten-thousandth the columns are stored at. */
function money(value: Prisma.Decimal): number {
  return Number(value.toFixed(4));
}

/** A percentage to two decimals, or null over nothing. */
function percent(part: number, whole: number): number | null {
  if (whole === 0) return null;
  return Math.round((part / whole) * 10000) / 100;
}

/** Revenue as this screen counts it: billable calls only. */
function billableRevenue(calls: readonly SalesCall[]): Prisma.Decimal {
  return calls.reduce(
    (sum, call) => (call.billable ? sum.plus(callAmounts(call).revenue) : sum),
    callAmounts({ ...EMPTY_CALL }).revenue
  );
}

const EMPTY_CALL = {
  id: '',
  billable: false,
  buyerBillableAmount: null,
  publisherPayoutAmount: null,
  cost: null,
  connectedDuration: null,
  disputeStatus: null,
};

function groupBy<K>(calls: readonly SalesCall[], keyOf: (call: SalesCall) => K | null) {
  const groups = new Map<K, SalesCall[]>();
  for (const call of calls) {
    const key = keyOf(call);
    if (key === null) continue;
    const list = groups.get(key);
    if (list) list.push(call);
    else groups.set(key, [call]);
  }
  return groups;
}

/**
 * The whole summary for one tenant and one period.
 *
 * `ledger` is optional so a test can drive this with a fixture; the route never
 * passes it, and it is then read with the same query the report makes.
 */
export async function getCallSalesSummary(
  tenantId: string,
  period: ResolvedPeriod,
  deps: { prisma: CallSalesDeps; ledger?: MoneyLedgerEntry[] }
): Promise<CallSalesSummary> {
  const { prisma } = deps;

  const calls: SalesCall[] = await prisma.call.findMany({
    where: {
      tenantId,
      direction: 'INBOUND',
      createdAt: { gte: period.start, lt: period.endExclusive },
    },
    select: CALL_SELECT,
    orderBy: { createdAt: 'asc' },
  });

  const ledger =
    deps.ledger ??
    (await loadCallMoneyLedger(
      prisma,
      tenantId,
      calls.map(call => call.id)
    ));

  const all = summariseCallMoney(calls, ledger, () => 'all');
  const byPublisherMoney = summariseCallMoney(calls, ledger, call => call.publisherId ?? '');
  const byDayMoney = summariseCallMoney(calls, ledger, call => calendarDayOf(call.createdAt));

  /* ── Totals ─────────────────────────────────────────────────────────────── */

  const inboundCalls = calls.length;
  const answeredByAgents = calls.filter(call => call.answeredByUserId !== null).length;
  const toBuyers = calls.filter(call => call.buyerId !== null);
  const sentToBuyers = toBuyers.length;
  const billableToBuyers = toBuyers.filter(call => call.billable).length;
  const blocked = calls.filter(call => call.blocked).length;

  const revenue = billableRevenue(calls);
  const totalsMoney: MoneyBucket = all.totals;

  const totals: CallSalesTotals = {
    inboundCalls,
    answeredByAgents,
    sentToBuyers,
    billableToBuyers,
    sellThroughPct: percent(billableToBuyers, sentToBuyers),
    revenue: money(revenue),
    publisherPayouts: money(totalsMoney.payout),
    callCost: money(totalsMoney.callCost),
    otherCosts: money(totalsMoney.otherCosts),
    adjustments: money(totalsMoney.adjustments),
    disputes: money(totalsMoney.disputes),
    profit: money(totalsMoney.profit),
    marginPct: revenue.gt(0) ? percent(totalsMoney.profit.toNumber(), revenue.toNumber()) : null,
    revenuePerBillableCall:
      billableToBuyers > 0 ? money(revenue.dividedBy(billableToBuyers)) : null,
    disputedCalls: calls.filter(call => call.disputeStatus !== null).length,
    duplicates: calls.filter(call => call.isDuplicate).length,
    blocked,
  };

  /*
   * Where the calls went. The four are read off different columns, so a call
   * both answered by an agent and then sent on to a buyer is counted in both;
   * `unanswered` is floored at zero rather than going negative when that
   * happens.
   */
  const disposition: CallSalesDisposition = {
    yourAgents: answeredByAgents,
    buyers: sentToBuyers,
    unanswered: Math.max(0, inboundCalls - answeredByAgents - sentToBuyers - blocked),
    blocked,
  };

  /* ── By buyer ───────────────────────────────────────────────────────────── */

  const buyerCalls = groupBy(calls, call => call.buyerId);
  const buyerIds = [...buyerCalls.keys()];
  const buyers =
    buyerIds.length === 0
      ? []
      : await prisma.buyer.findMany({
          where: { tenantId, id: { in: buyerIds } },
          select: { id: true, name: true, stats: { select: { capConsumedToday: true } } },
        });
  const buyerById = new Map(buyers.map(buyer => [buyer.id, buyer]));

  const byBuyer: CallSalesBuyerRow[] = buyerIds
    .map(buyerId => {
      const list = buyerCalls.get(buyerId)!;
      const buyer = buyerById.get(buyerId);
      const billable = list.filter(call => call.billable).length;
      const connected = list.filter(call => call.connectedDuration !== null);
      const connectedSeconds = connected.reduce(
        (sum, call) => sum + (call.connectedDuration ?? 0),
        0
      );
      return {
        buyerId,
        buyerName: buyer?.name ?? list[0].buyerName ?? 'Unknown buyer',
        calls: list.length,
        billable,
        billablePct: percent(billable, list.length),
        revenue: money(billableRevenue(list)),
        avgConnectedSeconds:
          connected.length > 0 ? Math.round(connectedSeconds / connected.length) : null,
        disputed: list.filter(call => call.disputeStatus !== null).length,
        capConsumedToday: buyer?.stats?.capConsumedToday ?? 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue || a.buyerName.localeCompare(b.buyerName));

  /* ── By publisher ───────────────────────────────────────────────────────── */

  const publisherCalls = groupBy(calls, call => call.publisherId);
  const publisherIds = [...publisherCalls.keys()];
  const publishers =
    publisherIds.length === 0
      ? []
      : await prisma.publisher.findMany({
          where: { tenantId, id: { in: publisherIds } },
          select: { id: true, name: true },
        });
  const publisherName = new Map(publishers.map(publisher => [publisher.id, publisher.name]));

  const byPublisher: CallSalesPublisherRow[] = publisherIds
    .map(publisherId => {
      const list = publisherCalls.get(publisherId)!;
      const bucket = byPublisherMoney.groups.get(publisherId)!;
      return {
        publisherId,
        publisherName:
          publisherName.get(publisherId) ?? list[0].publisherName ?? 'Unknown publisher',
        calls: list.length,
        answeredByAgents: list.filter(call => call.answeredByUserId !== null).length,
        sentToBuyers: list.filter(call => call.buyerId !== null).length,
        billable: list.filter(call => call.buyerId !== null && call.billable).length,
        payout: money(bucket.payout),
        revenue: money(billableRevenue(list)),
        profit: money(bucket.profit),
      };
    })
    .sort((a, b) => b.profit - a.profit || a.publisherName.localeCompare(b.publisherName));

  /* ── By day ─────────────────────────────────────────────────────────────── */

  const dayCalls = groupBy(calls, call => calendarDayOf(call.createdAt));
  const byDay: CallSalesDayRow[] = [...dayCalls.keys()].sort().map(day => {
    const list = dayCalls.get(day)!;
    const bucket = byDayMoney.groups.get(day)!;
    return {
      day,
      inbound: list.length,
      sentToBuyers: list.filter(call => call.buyerId !== null).length,
      billable: list.filter(call => call.buyerId !== null && call.billable).length,
      revenue: money(billableRevenue(list)),
      payout: money(bucket.payout),
      profit: money(bucket.profit),
    };
  });

  return {
    period: {
      key: period.key,
      label: period.label,
      from: period.from,
      to: period.to,
      days: period.days,
      complete: period.complete,
    },
    totals,
    disposition,
    byBuyer,
    byPublisher,
    byDay,
  };
}
