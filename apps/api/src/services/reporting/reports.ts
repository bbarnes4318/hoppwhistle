/**
 * The three money reports -- publisher revenue, buyer costs, campaign
 * profitability -- and their CSVs.
 *
 * ── One computation per report, two shapes ───────────────────────────────────
 *
 * Each report used to be written twice in `routes/index.ts`, once for the JSON
 * and once for its CSV, with its own where clause each time. The two copies of
 * publisher revenue grouped by different keys (ids in the JSON, names in the
 * CSV), so a renamed campaign split in one and not the other. Each report is
 * computed once here and the CSV is rendered from the same rows.
 *
 * ── The calls ────────────────────────────────────────────────────────────────
 *
 * `salesCallWhere`: the tenant's INBOUND calls created inside an
 * America/New_York calendar-day period. The routes take `period`/`from`/`to`
 * exactly as `/api/v1/call-sales/summary` does, so a month on Reports is the
 * month on Sales, Today and the statements.
 *
 * Buyer costs reads only calls a buyer answered (`buyerId` set). A call no
 * buyer took costs no buyer anything, and it used to land in an "Unknown
 * Buyer" row that summed to zero and read as a buyer nobody could find.
 */

import { Prisma, type PrismaClient } from '@prisma/client';
import type { FastifyReply } from 'fastify';

import { isOpenDispute } from '../../lib/dispute-status.js';
import {
  isPeriodKey,
  PeriodError,
  PERIOD_KEYS,
  resolvePeriod,
  type ResolvedPeriod,
} from '../leaderboard/period.js';
import { calendarDayOf } from '../rating/calendar-day.js';

import {
  loadCallMoneyLedger,
  marginOf,
  salesCallWhere,
  summariseCallMoney,
  type CallRange,
  type MoneyBucket,
} from './call-money.js';

export interface ReportPeriodQuery {
  period?: string;
  from?: string;
  to?: string;
  /** @deprecated Read as `period=CUSTOM&from=`. Kept for callers not yet moved. */
  startDate?: string;
  /** @deprecated Read as `period=CUSTOM&to=`. */
  endDate?: string;
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A legacy `startDate`/`endDate` as the calendar day it names: a bare
 * `YYYY-MM-DD` is that day; an instant is the New York day it falls on, so a
 * browser's end-of-day sent in UTC does not pull in the next day.
 */
function legacyDay(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (DAY_KEY.test(value)) return value;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? value : calendarDayOf(instant);
}

/**
 * The period a report was asked for, or null after answering 400.
 *
 * `period`/`from`/`to` as call-sales reads them, defaulting to TODAY. A caller
 * that still sends `startDate`/`endDate` and no `period` is read as a CUSTOM
 * range over the calendar days those name (`legacyDay`).
 */
export function reportPeriodFromQuery(
  query: ReportPeriodQuery,
  reply: FastifyReply
): ResolvedPeriod | null {
  let requested = query.period;
  let from = query.from;
  let to = query.to;

  if (requested === undefined && (query.startDate || query.endDate)) {
    requested = 'CUSTOM';
    from = legacyDay(query.startDate) ?? legacyDay(query.endDate);
    to = legacyDay(query.endDate) ?? from;
  }
  requested ??= 'TODAY';

  if (!isPeriodKey(requested)) {
    void reply.code(400).send({
      error: {
        code: 'VALIDATION_ERROR',
        message: `period must be one of: ${PERIOD_KEYS.join(', ')}`,
      },
    });
    return null;
  }

  try {
    return resolvePeriod(requested, { from, to });
  } catch (error) {
    if (error instanceof PeriodError) {
      void reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: error.message } });
      return null;
    }
    throw error;
  }
}

/** The period as a report answers it, so the screen shows what was measured. */
export function periodView(period: ResolvedPeriod) {
  return {
    key: period.key,
    label: period.label,
    from: period.from,
    to: period.to,
    days: period.days,
    complete: period.complete,
  };
}

/** A campaign filter: absent, or one of the "all" sentinels the web sends, reads as none. */
export function campaignFilter(campaignId: string | undefined): string | undefined {
  if (!campaignId || campaignId === 'all-campaigns' || campaignId === 'all') return undefined;
  return campaignId;
}

type ReportPrisma = Pick<PrismaClient, 'call' | 'accrualLedger'>;

/** CSV text from a header and rows; a cell with a comma, quote or newline is quoted. */
export function toCsv(headers: string[], rows: Array<Array<string | number>>): string {
  const formatCell = (value: string | number | null | undefined) => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    if (text.includes(',') || text.includes('"') || text.includes('\n')) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };
  return [headers.map(formatCell).join(','), ...rows.map(r => r.map(formatCell).join(','))].join(
    '\n'
  );
}

const zero = () => new Prisma.Decimal(0);
const decimal = (value: Prisma.Decimal | null) => (value ? new Prisma.Decimal(value) : zero());

/* ── Publisher revenue ─────────────────────────────────────────────────────── */

export interface PublisherRevenueRow {
  publisherId: string;
  publisherName: string;
  campaignId: string;
  campaignName: string;
  trackingNumber: string;
  totalCalls: number;
  billableCalls: number;
  nonBillableCalls: number;
  payoutRate: string;
  publisherRevenue: string;
  earnings: string;
  paid: string;
  pending: string;
  held: string;
}

export interface PublisherRevenueReport {
  totals: {
    totalCalls: number;
    billableCalls: number;
    nonBillableCalls: number;
    earnings: string;
    publisherRevenue: string;
    paid: string;
    pending: string;
    held: string;
  };
  rows: PublisherRevenueRow[];
}

export async function buildPublisherRevenueReport(
  prisma: ReportPrisma,
  tenantId: string,
  range: CallRange,
  filters: { campaignId?: string; publisherId?: string | null }
): Promise<PublisherRevenueReport> {
  const calls = await prisma.call.findMany({
    where: {
      ...salesCallWhere(tenantId, range),
      ...(filters.campaignId ? { campaignId: filters.campaignId } : {}),
      ...(filters.publisherId ? { publisherId: filters.publisherId } : {}),
    },
    select: {
      id: true,
      publisherId: true,
      publisherName: true,
      campaignId: true,
      campaignName: true,
      did: true,
      billable: true,
      publisherPayoutAmount: true,
      publisherPayoutStatus: true,
      disputeStatus: true,
    },
  });

  interface Group {
    row: Omit<
      PublisherRevenueRow,
      'payoutRate' | 'publisherRevenue' | 'earnings' | 'paid' | 'pending' | 'held'
    >;
    earnings: Prisma.Decimal;
    paid: Prisma.Decimal;
    pending: Prisma.Decimal;
    held: Prisma.Decimal;
  }
  const groups = new Map<string, Group>();
  const totals = { earnings: zero(), paid: zero(), pending: zero(), held: zero() };
  let totalCalls = 0;
  let billableCalls = 0;

  for (const call of calls) {
    const publisherId = call.publisherId || 'unknown';
    const campaignId = call.campaignId || 'unknown';
    const did = call.did || 'unknown';
    const key = `${publisherId}_${campaignId}_${did}`;

    let group = groups.get(key);
    if (!group) {
      group = {
        row: {
          publisherId,
          publisherName: call.publisherName || 'Unknown Publisher',
          campaignId,
          campaignName: call.campaignName || 'Unknown Campaign',
          trackingNumber: did,
          totalCalls: 0,
          billableCalls: 0,
          nonBillableCalls: 0,
        },
        earnings: zero(),
        paid: zero(),
        pending: zero(),
        held: zero(),
      };
      groups.set(key, group);
    }

    const payout = decimal(call.publisherPayoutAmount);
    // A return accepted after the publisher was paid: its payout is zeroed and
    // the deduction lives in publisher_payments, so it is neither paid nor held.
    const clawedBack = call.publisherPayoutStatus === 'CLAWED_BACK';
    const bucket: 'paid' | 'held' | 'pending' | null =
      call.publisherPayoutStatus === 'PAID'
        ? 'paid'
        : clawedBack
          ? null
          : call.publisherPayoutStatus === 'HELD' || isOpenDispute(call.disputeStatus)
            ? 'held'
            : 'pending';

    totalCalls++;
    group.row.totalCalls++;
    if (call.billable) {
      billableCalls++;
      group.row.billableCalls++;
    } else {
      group.row.nonBillableCalls++;
    }
    group.earnings = group.earnings.plus(payout);
    totals.earnings = totals.earnings.plus(payout);
    if (bucket) {
      group[bucket] = group[bucket].plus(payout);
      totals[bucket] = totals[bucket].plus(payout);
    }
  }

  return {
    totals: {
      totalCalls,
      billableCalls,
      nonBillableCalls: totalCalls - billableCalls,
      earnings: totals.earnings.toFixed(4),
      publisherRevenue: totals.earnings.toFixed(4),
      paid: totals.paid.toFixed(4),
      pending: totals.pending.toFixed(4),
      held: totals.held.toFixed(4),
    },
    rows: [...groups.values()].map(g => ({
      ...g.row,
      payoutRate:
        g.row.billableCalls > 0 ? g.earnings.dividedBy(g.row.billableCalls).toFixed(4) : '0.0000',
      publisherRevenue: g.earnings.toFixed(4),
      earnings: g.earnings.toFixed(4),
      paid: g.paid.toFixed(4),
      pending: g.pending.toFixed(4),
      held: g.held.toFixed(4),
    })),
  };
}

export function publisherRevenueCsv(report: PublisherRevenueReport): string {
  const t = report.totals;
  const rows: Array<Array<string | number>> = report.rows.map(r => [
    r.publisherName,
    r.campaignName,
    r.trackingNumber,
    r.totalCalls,
    r.billableCalls,
    r.nonBillableCalls,
    r.payoutRate,
    r.earnings,
    r.paid,
    r.pending,
    r.held,
  ]);
  rows.push([
    'Report Totals',
    '',
    '',
    t.totalCalls,
    t.billableCalls,
    t.nonBillableCalls,
    t.billableCalls > 0
      ? new Prisma.Decimal(t.earnings).dividedBy(t.billableCalls).toFixed(4)
      : '0.0000',
    t.earnings,
    t.paid,
    t.pending,
    t.held,
  ]);
  return toCsv(
    [
      'Publisher',
      'Campaign',
      'Tracking Number',
      'Total Calls',
      'Billable Calls',
      'Non-Billable Calls',
      'Payout / Billable Call ($)',
      'Earnings ($)',
      'Paid ($)',
      'Pending ($)',
      'Held/Disputed ($)',
    ],
    rows
  );
}

/* ── Buyer costs ───────────────────────────────────────────────────────────── */

export interface BuyerCostsRow {
  buyerId: string;
  buyerName: string;
  campaignId: string;
  campaignName: string;
  destinationNumber: string;
  totalCalls: number;
  billableCalls: number;
  nonBillableCalls: number;
  billableRate: number;
  averageDuration: number;
  pricePerBillableCall: string;
  buyerCost: string;
  walletDebits: string;
  invoiced: string;
  pendingInvoice: string;
  disputes: string;
}

export interface BuyerCostsReport {
  totals: {
    totalCalls: number;
    billableCalls: number;
    nonBillableCalls: number;
    averageDuration: number;
    billableRate: number;
    buyerCost: string;
    walletDebits: string;
    invoiced: string;
    pendingInvoice: string;
    disputes: string;
  };
  rows: BuyerCostsRow[];
}

interface CostFigures {
  totalCalls: number;
  billableCalls: number;
  totalDuration: number;
  buyerCost: Prisma.Decimal;
  walletDebits: Prisma.Decimal;
  invoiced: Prisma.Decimal;
  pendingInvoice: Prisma.Decimal;
  disputes: Prisma.Decimal;
}

function emptyCostFigures(): CostFigures {
  return {
    totalCalls: 0,
    billableCalls: 0,
    totalDuration: 0,
    buyerCost: zero(),
    walletDebits: zero(),
    invoiced: zero(),
    pendingInvoice: zero(),
    disputes: zero(),
  };
}

export async function buildBuyerCostsReport(
  prisma: ReportPrisma,
  tenantId: string,
  range: CallRange,
  filters: { campaignId?: string; buyerId?: string | null }
): Promise<BuyerCostsReport> {
  const calls = await prisma.call.findMany({
    where: {
      ...salesCallWhere(tenantId, range),
      ...(filters.campaignId ? { campaignId: filters.campaignId } : {}),
      // Only calls a buyer took: there is no "Unknown Buyer" to charge.
      buyerId: filters.buyerId ? filters.buyerId : { not: null },
    },
    select: {
      id: true,
      buyerId: true,
      buyerName: true,
      campaignId: true,
      campaignName: true,
      targetNumber: true,
      billable: true,
      buyerBillableAmount: true,
      buyerChargeStatus: true,
      disputeStatus: true,
      connectedDuration: true,
      duration: true,
      buyer: { select: { billingType: true } },
    },
  });

  const groups = new Map<
    string,
    {
      row: Pick<
        BuyerCostsRow,
        'buyerId' | 'buyerName' | 'campaignId' | 'campaignName' | 'destinationNumber'
      >;
      figures: CostFigures;
    }
  >();
  const totals = emptyCostFigures();

  for (const call of calls) {
    // Belt and braces for a client that ignores the where clause: never a buyerless row.
    if (!call.buyerId) continue;
    const campaignId = call.campaignId || 'unknown';
    const destination = call.targetNumber || 'unknown';
    const key = `${call.buyerId}_${campaignId}_${destination}`;

    let group = groups.get(key);
    if (!group) {
      group = {
        row: {
          buyerId: call.buyerId,
          buyerName: call.buyerName || 'Unnamed buyer',
          campaignId,
          campaignName: call.campaignName || 'Unknown Campaign',
          destinationNumber: destination,
        },
        figures: emptyCostFigures(),
      };
      groups.set(key, group);
    }

    const cost = decimal(call.buyerBillableAmount);
    const duration = call.connectedDuration ?? call.duration ?? 0;
    const upfront = call.buyer?.billingType === 'UPFRONT';

    for (const f of [group.figures, totals]) {
      f.totalCalls++;
      if (call.billable) f.billableCalls++;
      f.totalDuration += duration;
      f.buyerCost = f.buyerCost.plus(cost);
      if (upfront) {
        if (call.buyerChargeStatus === 'CHARGED') f.walletDebits = f.walletDebits.plus(cost);
      } else if (call.buyerChargeStatus === 'INVOICED') {
        f.invoiced = f.invoiced.plus(cost);
      } else if (call.buyerChargeStatus === 'CHARGED') {
        f.pendingInvoice = f.pendingInvoice.plus(cost);
      }
      if (isOpenDispute(call.disputeStatus)) f.disputes = f.disputes.plus(cost);
    }
  }

  const shaped = (f: CostFigures) => ({
    totalCalls: f.totalCalls,
    billableCalls: f.billableCalls,
    nonBillableCalls: f.totalCalls - f.billableCalls,
    billableRate: f.totalCalls > 0 ? f.billableCalls / f.totalCalls : 0,
    averageDuration: f.totalCalls > 0 ? Math.round(f.totalDuration / f.totalCalls) : 0,
    buyerCost: f.buyerCost.toFixed(4),
    walletDebits: f.walletDebits.toFixed(4),
    invoiced: f.invoiced.toFixed(4),
    pendingInvoice: f.pendingInvoice.toFixed(4),
    disputes: f.disputes.toFixed(4),
  });

  return {
    totals: shaped(totals),
    rows: [...groups.values()].map(({ row, figures }) => ({
      ...row,
      ...shaped(figures),
      pricePerBillableCall:
        figures.billableCalls > 0
          ? figures.buyerCost.dividedBy(figures.billableCalls).toFixed(4)
          : '0.0000',
    })),
  };
}

export function buyerCostsCsv(report: BuyerCostsReport): string {
  const percent = (rate: number) => (rate * 100).toFixed(2) + '%';
  const t = report.totals;
  const rows: Array<Array<string | number>> = report.rows.map(r => [
    r.buyerName,
    r.campaignName,
    r.destinationNumber,
    r.totalCalls,
    r.billableCalls,
    r.nonBillableCalls,
    percent(r.billableRate),
    r.averageDuration,
    r.pricePerBillableCall,
    r.buyerCost,
    r.walletDebits,
    r.invoiced,
    r.pendingInvoice,
    r.disputes,
  ]);
  rows.push([
    'Report Totals',
    '',
    '',
    t.totalCalls,
    t.billableCalls,
    t.nonBillableCalls,
    percent(t.billableRate),
    t.averageDuration,
    t.billableCalls > 0
      ? new Prisma.Decimal(t.buyerCost).dividedBy(t.billableCalls).toFixed(4)
      : '0.0000',
    t.buyerCost,
    t.walletDebits,
    t.invoiced,
    t.pendingInvoice,
    t.disputes,
  ]);
  return toCsv(
    [
      'Buyer',
      'Campaign',
      'Destination Number',
      'Total Calls',
      'Billable Calls',
      'Non-Billable Calls',
      'Billable Rate (%)',
      'Avg Duration (s)',
      'Cost / Billable Call ($)',
      'Total Cost ($)',
      'Wallet Debits ($)',
      'Invoiced ($)',
      'Pending Invoice ($)',
      'Disputes ($)',
    ],
    rows
  );
}

/* ── Campaign profitability ────────────────────────────────────────────────── */

/**
 * Each campaign's name, as the first of its calls in the set recorded it -- the
 * name the profitability report has always shown for the group.
 */
function campaignNamesOf(
  calls: ReadonlyArray<{ campaignId: string | null; campaignName: string | null }>
): Map<string, string> {
  const names = new Map<string, string>();
  for (const call of calls) {
    const id = call.campaignId || 'unknown';
    if (!names.has(id)) names.set(id, call.campaignName || 'Unknown Campaign');
  }
  return names;
}

function profitabilityFigures(g: MoneyBucket) {
  return {
    totalCalls: g.totalCalls,
    connectedCalls: g.connectedCalls,
    billableCalls: g.billableCalls,
    buyerRevenue: g.revenue.toFixed(4),
    publisherPayout: g.payout.toFixed(4),
    callCost: g.callCost.toFixed(4),
    otherCosts: g.otherCosts.toFixed(4),
    profit: g.profit.toFixed(4),
    margin: marginOf(g),
    disputes: g.disputes.toFixed(4),
    disputesCount: g.disputesCount,
    adjustments: g.adjustments.toFixed(4),
    netPayableReceivable: g.netPayableReceivable.toFixed(4),
  };
}

export type CampaignProfitabilityReport = {
  totals: ReturnType<typeof profitabilityFigures>;
  rows: Array<
    { campaignId: string; campaignName: string } & ReturnType<typeof profitabilityFigures>
  >;
  /** Kept beside the shaped figures so the CSV renders from the same buckets. */
  buckets: { totals: MoneyBucket; groups: Array<[string, MoneyBucket]> };
  names: Map<string, string>;
};

export async function buildCampaignProfitabilityReport(
  prisma: ReportPrisma,
  tenantId: string,
  range: CallRange,
  filters: { campaignId?: string }
): Promise<CampaignProfitabilityReport> {
  const calls = await prisma.call.findMany({
    where: {
      ...salesCallWhere(tenantId, range),
      ...(filters.campaignId ? { campaignId: filters.campaignId } : {}),
    },
    select: {
      id: true,
      campaignId: true,
      campaignName: true,
      billable: true,
      buyerBillableAmount: true,
      publisherPayoutAmount: true,
      cost: true,
      connectedDuration: true,
      disputeStatus: true,
    },
  });

  /*
   * The per-call arithmetic lives in `call-money.ts`, which
   * `/api/v1/call-sales/summary` runs on too, so the two cannot disagree.
   * `__tests__/call-money.test.ts` pins this response byte for byte.
   */
  const ledger = await loadCallMoneyLedger(
    prisma,
    tenantId,
    calls.map(c => c.id)
  );
  const money = summariseCallMoney(calls, ledger, call => call.campaignId || 'unknown');
  const names = campaignNamesOf(calls);

  return {
    totals: profitabilityFigures(money.totals),
    rows: [...money.groups].map(([campaignId, g]) => ({
      campaignId,
      campaignName: names.get(campaignId)!,
      ...profitabilityFigures(g),
    })),
    buckets: { totals: money.totals, groups: [...money.groups] },
    names,
  };
}

export function campaignProfitabilityCsv(report: CampaignProfitabilityReport): string {
  const marginText = (bucket: MoneyBucket) =>
    bucket.revenue.gt(0) ? (marginOf(bucket) * 100).toFixed(2) + '%' : '0.00%';
  const line = (name: string, g: MoneyBucket): Array<string | number> => [
    name,
    g.totalCalls,
    g.connectedCalls,
    g.billableCalls,
    g.revenue.toFixed(4),
    g.payout.toFixed(4),
    g.callCost.toFixed(4),
    g.otherCosts.toFixed(4),
    g.profit.toFixed(4),
    marginText(g),
    g.disputes.toFixed(4),
    g.adjustments.toFixed(4),
    g.netPayableReceivable.toFixed(4),
  ];

  const rows = report.buckets.groups.map(([campaignId, g]) =>
    line(report.names.get(campaignId)!, g)
  );
  rows.push(line('Report Totals', report.buckets.totals));

  return toCsv(
    [
      'Campaign',
      'Total Calls',
      'Connected Calls',
      'Billable Calls',
      'Buyer Revenue ($)',
      'Publisher Payout ($)',
      'Carrier Cost ($)',
      'Other Costs ($)',
      'Gross Profit ($)',
      'Margin (%)',
      'Disputes ($)',
      'Adjustments ($)',
      'Net Payable/Receivable ($)',
    ],
    rows
  );
}
