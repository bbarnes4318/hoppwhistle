/**
 * What a monthly statement says, for each of the four parties it is written to.
 *
 * ── Every figure from the one call set ───────────────────────────────────────
 *
 * The calls are `salesCallWhere`'s -- the tenant's INBOUND calls created inside
 * the month's New York calendar days -- narrowed to the buyer or publisher the
 * statement is for. The agency's money comes from `getCallSalesSummary` and a
 * publisher's paid / payable / held from `getPayoutsSummary`, so a statement
 * cannot disagree with Sales, Reports, Today or Payouts over the same month.
 *
 * ── A closed month never changes ─────────────────────────────────────────────
 *
 * `statements:close` stores the figures and the rendered page the day after a
 * month ends, and nothing rewrites them. What changes afterwards shows up on
 * the month it happens in:
 *
 *   A return accepted in September for an August call is on September's
 *   statement, as "Return accepted for a call in August 2026". August's
 *   statement still bills the call, because on the day August closed it was
 *   billed.
 *
 * So a buyer's amount billed counts an accepted return's ORIGINAL amount
 * (`metadata.originalBuyerBillableAmount`, kept by the returns decision) --
 * the acceptance zeroes `buyerBillableAmount` and clears `billable` -- and the
 * return is taken off in the month it was accepted. A statement rebuilt with
 * `--rebuild` after a late acceptance therefore reads as it did the first time.
 *
 * ── Money ────────────────────────────────────────────────────────────────────
 *
 * Decimal throughout; the totals leave here as dollars to the cent.
 */

import { Prisma, type PrismaClient } from '@prisma/client';

import { ACCEPTED_DISPUTE, DENIED_DISPUTE, OPEN_DISPUTE } from '../../lib/dispute-status.js';
import { getPayoutsSummary } from '../../routes/payouts.js';
import { getAgentRange } from '../billing/delivery-view.js';
import { calendarDayOf } from '../rating/calendar-day.js';
import { measureClosing } from '../rating/measurement.js';
import { ALL_TIME, salesCallWhere } from '../reporting/call-money.js';
import { getCallSalesSummary } from '../reporting/call-sales.js';

import {
  monthLabel,
  monthOf,
  monthPeriod,
  utcMonthBounds,
  type StatementMonth,
} from './statement-month.js';

export const PARTY_TYPES = ['BUYER', 'PUBLISHER', 'AGENCY', 'CHILD_AGENCY'] as const;
export type PartyType = (typeof PARTY_TYPES)[number];

export function isPartyType(value: unknown): value is PartyType {
  return typeof value === 'string' && (PARTY_TYPES as readonly string[]).includes(value);
}

/** Which statement: whose, for which month, issued by which tenant. */
export interface StatementParty {
  /** The tenant the statement belongs to: the agency, or the parent of a child agency. */
  tenantId: string;
  partyType: PartyType;
  /** The buyer's id, the publisher's id, or the agency's tenant id. */
  partyId: string;
}

/** Refused rather than rendered: the wallet does not add up. */
export class StatementReconciliationError extends Error {
  constructor(
    message: string,
    readonly figures: Record<string, number>
  ) {
    super(message);
    this.name = 'StatementReconciliationError';
  }
}

/** The party does not exist in this tenant. */
export class StatementPartyNotFoundError extends Error {
  constructor(party: StatementParty) {
    super(`${party.partyType} ${party.partyId} not found in tenant ${party.tenantId}`);
    this.name = 'StatementPartyNotFoundError';
  }
}

export type StatementPrisma = PrismaClient;

const zero = () => new Prisma.Decimal(0);
const dec = (value: Prisma.Decimal | string | number | null | undefined) =>
  value === null || value === undefined || value === '' ? zero() : new Prisma.Decimal(value);
/** Dollars to the cent. */
export const cents = (value: Prisma.Decimal) => Number(value.toFixed(2));

function metadataOf(metadata: Prisma.JsonValue | null): Record<string, unknown> {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
}

/** When a return was decided, from the decision's own record on the call. */
function decidedAtOf(metadata: Prisma.JsonValue | null): Date | null {
  const raw = metadataOf(metadata).decidedAt;
  if (typeof raw !== 'string') return null;
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? null : at;
}

function originalBuyerAmountOf(call: {
  metadata: Prisma.JsonValue | null;
  buyerBillableAmount: Prisma.Decimal | null;
}): Prisma.Decimal {
  const original = metadataOf(call.metadata).originalBuyerBillableAmount;
  if (typeof original === 'string' || typeof original === 'number') return dec(original);
  return dec(call.buyerBillableAmount);
}

/** The last four digits of a number, and nothing else of it. */
export function lastFour(phone: string | null | undefined): string {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? `…${digits.slice(-4)}` : '';
}

/** A call's time as the statement prints it, in New York. */
export function statementTime(at: Date): string {
  return at.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/* ── Shared shapes ─────────────────────────────────────────────────────────── */

export interface StatementBase {
  partyType: PartyType;
  partyId: string;
  tenantId: string;
  partyName: string;
  month: StatementMonth;
  monthLabel: string;
  /** The New York calendar days covered: the whole month, or to today while it runs. */
  from: string;
  to: string;
  /** True for the live "Month to date" statement. */
  live: boolean;
}

/** A return accepted this month for a call from an earlier month. */
export interface LateReturnLine {
  callId: string;
  callDate: string;
  callMonth: StatementMonth;
  label: string;
  amount: number;
}

export interface BuyerStatement extends StatementBase {
  partyType: 'BUYER';
  billingType: 'UPFRONT' | 'TERMS';
  totals: {
    callsDelivered: number;
    billableCalls: number;
    amountBilled: number;
    averagePrice: number | null;
    returnsAccepted: number;
    returnsAcceptedAmount: number;
    returnsDenied: number;
    openReturns: number;
    /** TERMS only: billed − accepted returns. */
    amountDue: number | null;
  };
  /** UPFRONT only. Opening + top-ups + refunds − call charges = closing. */
  wallet: {
    opening: number;
    topUps: number;
    refunds: number;
    callCharges: number;
    closing: number;
  } | null;
  lateReturns: LateReturnLine[];
  lines: Array<{
    at: string;
    caller: string;
    campaign: string;
    connectedSeconds: number | null;
    billable: boolean;
    amount: number;
    returnStatus: string;
  }>;
}

export interface PublisherStatement extends StatementBase {
  partyType: 'PUBLISHER';
  totals: {
    callsSent: number;
    billableCalls: number;
    payoutEarned: number;
    paid: number;
    payable: number;
    held: number;
    returnsDeducted: number;
    paymentsReceived: number;
    /** What the agency owed this publisher when the statement was made. */
    netOwedAtMonthEnd: number;
  };
  returnsDeducted: Array<{ date: string; callDate: string; callId: string | null; amount: number }>;
  payments: Array<{ date: string; method: string; reference: string | null; amount: number }>;
  lines: Array<{
    at: string;
    campaign: string;
    connectedSeconds: number | null;
    billable: boolean;
    payout: number;
    status: string;
  }>;
}

export interface NumberChargeGroup {
  /** The child agency the numbers are held by, or null for the agency's own. */
  childTenantId: string | null;
  name: string;
  setup: number;
  monthly: number;
  total: number;
  count: number;
}

export interface AgencyStatement extends StatementBase {
  partyType: 'AGENCY';
  totals: {
    inboundCalls: number;
    answeredByAgents: number;
    sentToBuyers: number;
    unanswered: number;
    blocked: number;
    billable: number;
    billableToBuyers: number;
    billableAgentAnswered: number;
    revenue: number;
    publisherPayouts: number;
    callCost: number;
    callCostEstimated: boolean;
    fees: number;
    adjustments: number;
    profit: number;
    applications: number;
    closingPct: number | null;
    returnsAccepted: number;
    returnsRevenueReturned: number;
    returnsPayoutClawedBack: number;
    publisherPaymentsCount: number;
    publisherPaymentsTotal: number;
    clawbacksApplied: number;
    numberCharges: number;
  };
  revenueByBuyer: Array<{ name: string; calls: number; billable: number; revenue: number }>;
  payoutsByPublisher: Array<{ name: string; calls: number; billable: number; payout: number }>;
  numberCharges: NumberChargeGroup[];
  lateReturns: LateReturnLine[];
}

export interface ChildAgencyStatement extends StatementBase {
  partyType: 'CHILD_AGENCY';
  totals: {
    inboundCalls: number;
    answeredByAgents: number;
    applications: number;
    closingPct: number | null;
    numberCharges: number;
  };
  agents: Array<{
    name: string;
    email: string | null;
    callsTaken: number;
    applications: number;
    closingPct: number | null;
    annualizedPremium: number;
  }>;
  numberCharges: NumberChargeGroup[];
}

export type StatementData =
  | BuyerStatement
  | PublisherStatement
  | AgencyStatement
  | ChildAgencyStatement;

interface BuildOptions {
  now?: Date;
}

/** The statement's figures for one party and one month. */
export async function buildStatement(
  prisma: StatementPrisma,
  party: StatementParty,
  month: StatementMonth,
  options: BuildOptions = {}
): Promise<StatementData> {
  switch (party.partyType) {
    case 'BUYER':
      return buildBuyerStatement(prisma, party, month, options);
    case 'PUBLISHER':
      return buildPublisherStatement(prisma, party, month, options);
    case 'AGENCY':
      return buildAgencyStatement(prisma, party, month, options);
    case 'CHILD_AGENCY':
      return buildChildAgencyStatement(prisma, party, month, options);
  }
}

function baseOf(
  party: StatementParty,
  partyName: string,
  month: StatementMonth,
  now: Date
): StatementBase & { range: { start: Date; endExclusive: Date } } {
  const period = monthPeriod(month, now);
  return {
    partyType: party.partyType,
    partyId: party.partyId,
    tenantId: party.tenantId,
    partyName,
    month,
    monthLabel: monthLabel(month),
    from: period.from,
    to: period.to,
    live: !period.complete,
    range: { start: period.start, endExclusive: period.endExclusive },
  };
}

function returnLabel(status: string | null): string {
  if (status === OPEN_DISPUTE) return 'Return requested';
  if (status === ACCEPTED_DISPUTE) return 'Return accepted';
  if (status === DENIED_DISPUTE) return 'Return denied';
  return '';
}

/* ── Buyer ─────────────────────────────────────────────────────────────────── */

async function buildBuyerStatement(
  prisma: StatementPrisma,
  party: StatementParty,
  month: StatementMonth,
  { now = new Date() }: BuildOptions
): Promise<BuyerStatement> {
  const buyer = await prisma.buyer.findFirst({
    where: { id: party.partyId, tenantId: party.tenantId },
    select: { id: true, name: true, billingType: true, walletBalance: true },
  });
  if (!buyer) throw new StatementPartyNotFoundError(party);

  const { range, ...base } = baseOf(party, buyer.name, month, now);

  const [calls, decided, openReturns] = await Promise.all([
    prisma.call.findMany({
      where: { ...salesCallWhere(party.tenantId, range), buyerId: buyer.id },
      select: {
        id: true,
        createdAt: true,
        callerId: true,
        campaignName: true,
        connectedDuration: true,
        billable: true,
        buyerBillableAmount: true,
        disputeStatus: true,
        metadata: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    /*
     * Returns decided this month, for calls of any month. A decision writes
     * the call, so `updatedAt` is at least `decidedAt`: the query narrows on
     * it and the exact instant is read from the decision's own record.
     */
    prisma.call.findMany({
      where: {
        tenantId: party.tenantId,
        buyerId: buyer.id,
        disputeStatus: { in: [ACCEPTED_DISPUTE, DENIED_DISPUTE] },
        updatedAt: { gte: range.start },
      },
      select: {
        id: true,
        createdAt: true,
        disputeStatus: true,
        buyerBillableAmount: true,
        metadata: true,
      },
    }),
    prisma.call.count({
      where: {
        tenantId: party.tenantId,
        buyerId: buyer.id,
        disputeStatus: OPEN_DISPUTE,
        createdAt: { lt: range.endExclusive },
      },
    }),
  ]);

  let billableCalls = 0;
  let amountBilled = zero();
  const lines: BuyerStatement['lines'] = calls.map(call => {
    /*
     * What the call was billed on the day it was billed. An accepted return
     * has since zeroed the amount and cleared `billable`; the statement bills
     * the original and takes the return off in the month it was accepted.
     */
    const accepted = call.disputeStatus === ACCEPTED_DISPUTE;
    const amount = accepted
      ? originalBuyerAmountOf(call)
      : call.billable
        ? dec(call.buyerBillableAmount)
        : zero();
    const billable = call.billable || (accepted && amount.gt(0));
    if (billable) {
      billableCalls++;
      amountBilled = amountBilled.plus(amount);
    }
    return {
      at: statementTime(call.createdAt),
      caller: lastFour(call.callerId),
      campaign: call.campaignName ?? '',
      connectedSeconds: call.connectedDuration,
      billable,
      amount: cents(amount),
      returnStatus: returnLabel(call.disputeStatus),
    };
  });

  const inMonth = (at: Date | null) => at !== null && at >= range.start && at < range.endExclusive;
  const acceptedThisMonth = decided.filter(
    call => call.disputeStatus === ACCEPTED_DISPUTE && inMonth(decidedAtOf(call.metadata))
  );
  const deniedThisMonth = decided.filter(
    call => call.disputeStatus === DENIED_DISPUTE && inMonth(decidedAtOf(call.metadata))
  );
  const returnsAcceptedAmount = acceptedThisMonth.reduce(
    (sum, call) => sum.plus(originalBuyerAmountOf(call)),
    zero()
  );

  const lateReturns: LateReturnLine[] = acceptedThisMonth
    .filter(call => call.createdAt < range.start)
    .map(call => {
      const callMonth = monthOf(call.createdAt);
      return {
        callId: call.id,
        callDate: calendarDayOf(call.createdAt),
        callMonth,
        label: `Return accepted for a call in ${monthLabel(callMonth)}`,
        amount: cents(originalBuyerAmountOf(call)),
      };
    });

  const upfront = buyer.billingType === 'UPFRONT';
  const wallet = upfront
    ? await buyerWallet(prisma, buyer.id, range, base.live ? buyer.walletBalance : null)
    : null;

  return {
    ...base,
    partyType: 'BUYER',
    billingType: upfront ? 'UPFRONT' : 'TERMS',
    totals: {
      callsDelivered: calls.length,
      billableCalls,
      amountBilled: cents(amountBilled),
      averagePrice: billableCalls > 0 ? cents(amountBilled.dividedBy(billableCalls)) : null,
      returnsAccepted: acceptedThisMonth.length,
      returnsAcceptedAmount: cents(returnsAcceptedAmount),
      returnsDenied: deniedThisMonth.length,
      openReturns,
      amountDue: upfront ? null : cents(amountBilled.minus(returnsAcceptedAmount)),
    },
    wallet,
    lateReturns,
    lines,
  };
}

/** A refund is the CREDIT the returns decision writes; any other CREDIT is a top-up. */
export function isRefundCredit(description: string): boolean {
  return description.startsWith('Return accepted');
}

/**
 * An UPFRONT buyer's wallet over the month, from its transactions.
 *
 * Opening is every transaction before the month; closing is every transaction
 * before its end -- or, for the month still running, the wallet's balance
 * right now. Opening + top-ups + refunds − call charges must equal closing, or
 * the statement is refused: a wallet that does not add up is a bug to fix, not
 * a figure to print.
 */
async function buyerWallet(
  prisma: StatementPrisma,
  buyerId: string,
  range: { start: Date; endExclusive: Date },
  liveBalance: Prisma.Decimal | null
): Promise<NonNullable<BuyerStatement['wallet']>> {
  const [before, during, through] = await Promise.all([
    prisma.buyerTransaction.aggregate({
      where: { buyerId, createdAt: { lt: range.start } },
      _sum: { amount: true },
    }),
    prisma.buyerTransaction.findMany({
      where: { buyerId, createdAt: { gte: range.start, lt: range.endExclusive } },
      select: { amount: true, type: true, description: true },
    }),
    prisma.buyerTransaction.aggregate({
      where: { buyerId, createdAt: { lt: range.endExclusive } },
      _sum: { amount: true },
    }),
  ]);

  const opening = dec(before._sum.amount);
  let topUps = zero();
  let refunds = zero();
  let callCharges = zero();
  for (const row of during) {
    const amount = dec(row.amount);
    if (row.type === 'CREDIT') {
      if (isRefundCredit(row.description)) refunds = refunds.plus(amount);
      else topUps = topUps.plus(amount);
    } else {
      callCharges = callCharges.plus(amount.abs());
    }
  }

  const closing = liveBalance !== null ? dec(liveBalance) : dec(through._sum.amount);
  const computed = opening.plus(topUps).plus(refunds).minus(callCharges);
  const figures = {
    opening: cents(opening),
    topUps: cents(topUps),
    refunds: cents(refunds),
    callCharges: cents(callCharges),
    closing: cents(closing),
  };

  if (!computed.toDecimalPlaces(2).equals(closing.toDecimalPlaces(2))) {
    throw new StatementReconciliationError(
      `Wallet does not reconcile for buyer ${buyerId}: opening $${figures.opening.toFixed(2)} + ` +
        `top-ups $${figures.topUps.toFixed(2)} + refunds $${figures.refunds.toFixed(2)} − ` +
        `call charges $${figures.callCharges.toFixed(2)} = $${cents(computed).toFixed(2)}, ` +
        `but the closing balance is $${figures.closing.toFixed(2)}`,
      figures
    );
  }

  return figures;
}

/* ── Publisher ─────────────────────────────────────────────────────────────── */

async function buildPublisherStatement(
  prisma: StatementPrisma,
  party: StatementParty,
  month: StatementMonth,
  { now = new Date() }: BuildOptions
): Promise<PublisherStatement> {
  const publisher = await prisma.publisher.findFirst({
    where: { id: party.partyId, tenantId: party.tenantId },
    select: { id: true, name: true },
  });
  if (!publisher) throw new StatementPartyNotFoundError(party);

  const { range, ...base } = baseOf(party, publisher.name, month, now);

  const [calls, monthSummary, owedSummary, clawbacks, payments] = await Promise.all([
    prisma.call.findMany({
      where: { ...salesCallWhere(party.tenantId, range), publisherId: publisher.id },
      select: {
        createdAt: true,
        campaignName: true,
        connectedDuration: true,
        billable: true,
        publisherPayoutAmount: true,
        publisherPayoutStatus: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    getPayoutsSummary(prisma, party.tenantId, range),
    getPayoutsSummary(prisma, party.tenantId, ALL_TIME),
    prisma.publisherPayment.findMany({
      where: {
        tenantId: party.tenantId,
        publisherId: publisher.id,
        kind: 'CLAWBACK',
        createdAt: { gte: range.start, lt: range.endExclusive },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.publisherPayment.findMany({
      where: {
        tenantId: party.tenantId,
        publisherId: publisher.id,
        kind: 'PAYMENT',
        paidAt: { gte: range.start, lt: range.endExclusive },
      },
      orderBy: { paidAt: 'asc' },
    }),
  ]);

  const row = monthSummary.publishers.find(p => p.publisherId === publisher.id);
  const owed = owedSummary.publishers.find(p => p.publisherId === publisher.id);

  const payoutEarned = calls.reduce(
    (sum, call) => sum.plus(dec(call.publisherPayoutAmount)),
    zero()
  );
  const returnsDeducted = clawbacks.reduce((sum, c) => sum.plus(dec(c.amount).abs()), zero());
  const paymentsReceived = payments.reduce((sum, p) => sum.plus(dec(p.amount)), zero());

  return {
    ...base,
    partyType: 'PUBLISHER',
    totals: {
      callsSent: calls.length,
      billableCalls: calls.filter(call => call.billable).length,
      payoutEarned: cents(payoutEarned),
      paid: row?.paid ?? 0,
      payable: row?.payable ?? 0,
      held: row?.held ?? 0,
      returnsDeducted: cents(returnsDeducted),
      paymentsReceived: cents(paymentsReceived),
      netOwedAtMonthEnd: owed?.netPayable ?? 0,
    },
    returnsDeducted: clawbacks.map(c => ({
      date: calendarDayOf(c.createdAt),
      // The returns decision dates a clawback's period by the returned call.
      callDate: calendarDayOf(c.periodFrom),
      callId: c.callId,
      amount: cents(dec(c.amount).abs()),
    })),
    payments: payments.map(p => ({
      date: calendarDayOf(p.paidAt),
      method: p.method,
      reference: p.reference,
      amount: cents(dec(p.amount)),
    })),
    lines: calls.map(call => ({
      at: statementTime(call.createdAt),
      campaign: call.campaignName ?? '',
      connectedSeconds: call.connectedDuration,
      billable: call.billable,
      payout: cents(dec(call.publisherPayoutAmount)),
      status: payoutStatusLabel(call.publisherPayoutStatus),
    })),
  };
}

function payoutStatusLabel(status: string | null): string {
  switch (status) {
    case 'PAID':
      return 'Paid';
    case 'PAYABLE':
      return 'Payable';
    case 'HELD':
      return 'Held';
    case 'CLAWED_BACK':
      return 'Returned';
    case 'NOT_PAYABLE':
      return 'Not payable';
    default:
      return '';
  }
}

/* ── Number charges ────────────────────────────────────────────────────────── */

/**
 * The number charges billed to `tenantId` for the month, grouped by the child
 * agency that holds the numbers (`metadata.childTenantId`), or only the one
 * child's when `onlyChild` is given.
 */
async function numberChargesFor(
  prisma: StatementPrisma,
  tenantId: string,
  month: StatementMonth,
  onlyChild?: string
): Promise<NumberChargeGroup[]> {
  const bounds = utcMonthBounds(month);
  const rows = await prisma.numberCharge.findMany({
    where: {
      tenantId,
      periodStart: { gte: bounds.start, lt: bounds.endExclusive },
      ...(onlyChild ? { metadata: { path: ['childTenantId'], equals: onlyChild } } : {}),
    },
    select: { kind: true, amount: true, metadata: true },
  });

  const groups = new Map<
    string | null,
    { setup: Prisma.Decimal; monthly: Prisma.Decimal; count: number }
  >();
  for (const row of rows) {
    const child = metadataOf(row.metadata).childTenantId;
    const key = typeof child === 'string' ? child : null;
    const group = groups.get(key) ?? { setup: zero(), monthly: zero(), count: 0 };
    if (row.kind === 'SETUP') group.setup = group.setup.plus(row.amount);
    else group.monthly = group.monthly.plus(row.amount);
    group.count++;
    groups.set(key, group);
  }

  const childIds = [...groups.keys()].filter((id): id is string => id !== null);
  const children =
    childIds.length === 0
      ? []
      : await prisma.tenant.findMany({
          where: { id: { in: childIds } },
          select: { id: true, name: true },
        });
  const nameOf = new Map(children.map(c => [c.id, c.name]));

  return [...groups.entries()]
    .map(([childTenantId, g]) => ({
      childTenantId,
      name: childTenantId === null ? 'Your numbers' : (nameOf.get(childTenantId) ?? 'Agency'),
      setup: cents(g.setup),
      monthly: cents(g.monthly),
      total: cents(g.setup.plus(g.monthly)),
      count: g.count,
    }))
    .sort((a, b) =>
      a.childTenantId === null ? -1 : b.childTenantId === null ? 1 : a.name.localeCompare(b.name)
    );
}

/* ── Agency ────────────────────────────────────────────────────────────────── */

async function buildAgencyStatement(
  prisma: StatementPrisma,
  party: StatementParty,
  month: StatementMonth,
  { now = new Date() }: BuildOptions
): Promise<AgencyStatement> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: party.partyId },
    select: { id: true, name: true, brandName: true },
  });
  if (!tenant || tenant.id !== party.tenantId) throw new StatementPartyNotFoundError(party);

  const period = monthPeriod(month, now);
  const { range, ...base } = baseOf(party, tenant.brandName ?? tenant.name, month, now);

  const [sales, closing, decided, payments, applied, numberCharges] = await Promise.all([
    getCallSalesSummary(tenant.id, period, { prisma }),
    measureClosing(
      { calls: prisma.call, applications: prisma.insuranceCarrierApplication },
      tenant.id,
      range
    ),
    prisma.call.findMany({
      where: {
        tenantId: tenant.id,
        disputeStatus: ACCEPTED_DISPUTE,
        updatedAt: { gte: range.start },
      },
      select: { id: true, createdAt: true, buyerBillableAmount: true, metadata: true },
    }),
    prisma.publisherPayment.aggregate({
      where: {
        tenantId: tenant.id,
        kind: 'PAYMENT',
        paidAt: { gte: range.start, lt: range.endExclusive },
      },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.publisherPayment.aggregate({
      where: {
        tenantId: tenant.id,
        kind: 'CLAWBACK',
        appliedTo: { paidAt: { gte: range.start, lt: range.endExclusive } },
      },
      _sum: { amount: true },
    }),
    numberChargesFor(prisma, tenant.id, month),
  ]);

  const inMonth = (at: Date | null) => at !== null && at >= range.start && at < range.endExclusive;
  const accepted = decided.filter(call => inMonth(decidedAtOf(call.metadata)));
  const revenueReturned = accepted.reduce(
    (sum, call) => sum.plus(originalBuyerAmountOf(call)),
    zero()
  );
  const payoutClawedBack = accepted.reduce((sum, call) => {
    const original = metadataOf(call.metadata).originalPublisherPayout;
    return typeof original === 'string' || typeof original === 'number'
      ? sum.plus(dec(original))
      : sum;
  }, zero());
  const lateReturns: LateReturnLine[] = accepted
    .filter(call => call.createdAt < range.start)
    .map(call => {
      const callMonth = monthOf(call.createdAt);
      return {
        callId: call.id,
        callDate: calendarDayOf(call.createdAt),
        callMonth,
        label: `Return accepted for a call in ${monthLabel(callMonth)}`,
        amount: cents(originalBuyerAmountOf(call)),
      };
    });

  const t = sales.totals;
  return {
    ...base,
    partyType: 'AGENCY',
    totals: {
      inboundCalls: t.inboundCalls,
      answeredByAgents: t.answeredByAgents,
      sentToBuyers: t.sentToBuyers,
      unanswered: sales.disposition.unanswered,
      blocked: t.blocked,
      billable: t.billable,
      billableToBuyers: t.billableToBuyers,
      billableAgentAnswered: t.billableAgentAnswered,
      revenue: t.revenue,
      publisherPayouts: t.publisherPayouts,
      callCost: t.callCost,
      callCostEstimated: t.callCostEstimated,
      fees: t.otherCosts,
      adjustments: t.adjustments,
      profit: t.profit,
      applications: closing.submittedApplications,
      closingPct: closing.closingPct === null ? null : Math.round(closing.closingPct * 100) / 100,
      returnsAccepted: accepted.length,
      returnsRevenueReturned: cents(revenueReturned),
      returnsPayoutClawedBack: cents(payoutClawedBack),
      publisherPaymentsCount: payments._count._all,
      publisherPaymentsTotal: cents(dec(payments._sum.amount)),
      clawbacksApplied: cents(dec(applied._sum.amount).abs()),
      numberCharges: cents(numberCharges.reduce((sum, g) => sum.plus(g.total), zero())),
    },
    revenueByBuyer: sales.byBuyer.map(row => ({
      name: row.buyerName,
      calls: row.calls,
      billable: row.billable,
      revenue: row.revenue,
    })),
    payoutsByPublisher: sales.byPublisher.map(row => ({
      name: row.publisherName,
      calls: row.calls,
      billable: row.billable,
      payout: row.payout,
    })),
    numberCharges,
    lateReturns,
  };
}

/* ── Child agency ──────────────────────────────────────────────────────────── */

async function buildChildAgencyStatement(
  prisma: StatementPrisma,
  party: StatementParty,
  month: StatementMonth,
  { now = new Date() }: BuildOptions
): Promise<ChildAgencyStatement> {
  const child = await prisma.tenant.findUnique({
    where: { id: party.partyId },
    select: { id: true, name: true, parentTenantId: true },
  });
  if (!child || child.parentTenantId !== party.tenantId) {
    throw new StatementPartyNotFoundError(party);
  }

  const { range, ...base } = baseOf(party, child.name, month, now);

  const [inboundCalls, answeredByAgents, closing, agents, numberCharges] = await Promise.all([
    prisma.call.count({ where: salesCallWhere(child.id, range) }),
    prisma.call.count({
      where: { ...salesCallWhere(child.id, range), answeredByUserId: { not: null } },
    }),
    measureClosing(
      { calls: prisma.call, applications: prisma.insuranceCarrierApplication },
      child.id,
      range
    ),
    getAgentRange(child.id, base.from, base.to, { prisma }),
    // The parent is billed for its children's numbers; this child's rows only.
    numberChargesFor(prisma, party.tenantId, month, child.id),
  ]);

  return {
    ...base,
    partyType: 'CHILD_AGENCY',
    totals: {
      inboundCalls,
      answeredByAgents,
      applications: closing.submittedApplications,
      closingPct: closing.closingPct === null ? null : Math.round(closing.closingPct * 100) / 100,
      numberCharges: cents(numberCharges.reduce((sum, g) => sum.plus(g.total), zero())),
    },
    agents: agents.agents.map(agent => ({
      name: agent.name,
      email: agent.email ?? null,
      callsTaken: agent.callsTaken,
      applications: agent.applications,
      closingPct: agent.closingPct,
      annualizedPremium: agent.annualizedPremium,
    })),
    numberCharges,
  };
}
