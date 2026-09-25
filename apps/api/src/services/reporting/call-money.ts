/**
 * What a set of calls was worth: revenue, publisher payout, call cost, the
 * accrual-ledger fees and adjustments, and the profit they leave.
 *
 * ── One implementation, two screens ──────────────────────────────────────────
 *
 * `/api/v1/reports/campaign-profitability` computed this inline, twice (the
 * JSON and its CSV), and `/api/v1/call-sales/summary` needs the same figures
 * grouped by buyer, by publisher and by day. A second copy of money arithmetic
 * is how two screens come to disagree about the same call, so both routes call
 * this, and `__tests__/call-money.test.ts` pins the report byte for byte to
 * what it answered before the move.
 *
 * ── The arithmetic, per call ─────────────────────────────────────────────────
 *
 *   revenue        buyerBillableAmount
 *   payout         publisherPayoutAmount
 *   call cost      cost
 *   disputes       the revenue of a call with a disputeStatus
 *
 * and, per group, from the accrual ledger rows written against its calls:
 *
 *   other costs    RECORDING_FEE + CONNECTION_FEE
 *   adjustments    ADJUSTMENT
 *
 *   profit                  revenue - payout - call cost - other costs
 *   net payable/receivable  profit + adjustments
 *
 * DISPUTE_HOLD and DISPUTE_REVERSAL rows are read and totalled
 * (`ledgerDisputes`) but, exactly as the report always has, they do not enter
 * profit: a dispute is reported as the disputed calls' revenue instead.
 *
 * Everything is `Prisma.Decimal`. Converting to a float happens at the edge,
 * in whichever route is shaping a response.
 */

import { Prisma, type PrismaClient } from '@prisma/client';

/** The accrual-ledger row types that bear on a call's money. */
export const CALL_MONEY_LEDGER_TYPES = [
  'ADJUSTMENT',
  'RECORDING_FEE',
  'CONNECTION_FEE',
  'DISPUTE_HOLD',
  'DISPUTE_REVERSAL',
] as const;

type DecimalLike = Prisma.Decimal | number | string;

/** The columns of a `Call` this reads. */
export interface MoneyCall {
  id: string;
  billable: boolean;
  buyerBillableAmount: DecimalLike | null;
  publisherPayoutAmount: DecimalLike | null;
  cost: DecimalLike | null;
  connectedDuration: number | null;
  disputeStatus: string | null;
}

/** The columns of an `AccrualLedger` row this reads. */
export interface MoneyLedgerEntry {
  callId: string | null;
  type: string;
  amount: DecimalLike;
}

/** One group's figures. Every amount is a Decimal. */
export interface MoneyBucket {
  totalCalls: number;
  connectedCalls: number;
  billableCalls: number;
  revenue: Prisma.Decimal;
  payout: Prisma.Decimal;
  callCost: Prisma.Decimal;
  otherCosts: Prisma.Decimal;
  adjustments: Prisma.Decimal;
  /** DISPUTE_HOLD + DISPUTE_REVERSAL ledger rows. Not in profit. */
  ledgerDisputes: Prisma.Decimal;
  /** The revenue of the group's disputed calls. */
  disputes: Prisma.Decimal;
  disputesCount: number;
  profit: Prisma.Decimal;
  netPayableReceivable: Prisma.Decimal;
}

export interface CallMoney {
  /** Keyed by `keyOf(call)`, in the order each key was first seen. */
  groups: Map<string, MoneyBucket>;
  /** Every call, and the sum of every group's ledger-derived figures. */
  totals: MoneyBucket;
}

/**
 * The ledger rows for these calls, in this tenant. The one query both routes
 * make, so the tenant scope and the type list are written once.
 */
export async function loadCallMoneyLedger(
  prisma: Pick<PrismaClient, 'accrualLedger'>,
  tenantId: string,
  callIds: string[]
): Promise<MoneyLedgerEntry[]> {
  if (callIds.length === 0) return [];
  return prisma.accrualLedger.findMany({
    where: {
      callId: { in: callIds },
      tenantId,
      type: { in: [...CALL_MONEY_LEDGER_TYPES] },
    },
    select: { callId: true, type: true, amount: true },
  });
}

function zero(): Prisma.Decimal {
  return new Prisma.Decimal(0);
}

function emptyBucket(): MoneyBucket {
  return {
    totalCalls: 0,
    connectedCalls: 0,
    billableCalls: 0,
    revenue: zero(),
    payout: zero(),
    callCost: zero(),
    otherCosts: zero(),
    adjustments: zero(),
    ledgerDisputes: zero(),
    disputes: zero(),
    disputesCount: 0,
    profit: zero(),
    netPayableReceivable: zero(),
  };
}

function decimalOf(value: DecimalLike | null): Prisma.Decimal {
  return value ? new Prisma.Decimal(value) : zero();
}

/** A call's revenue, payout and call cost, as the report has always read them. */
export function callAmounts(call: MoneyCall): {
  revenue: Prisma.Decimal;
  payout: Prisma.Decimal;
  callCost: Prisma.Decimal;
} {
  return {
    revenue: decimalOf(call.buyerBillableAmount),
    payout: decimalOf(call.publisherPayoutAmount),
    callCost: decimalOf(call.cost),
  };
}

/**
 * Group the calls by `keyOf`, fold in their ledger rows, and derive profit.
 *
 * A ledger row whose call is not among `calls` is ignored, as is one with no
 * call at all.
 */
export function summariseCallMoney<C extends MoneyCall>(
  calls: readonly C[],
  ledger: readonly MoneyLedgerEntry[],
  keyOf: (call: C) => string
): CallMoney {
  const groups = new Map<string, MoneyBucket>();
  const keyByCall = new Map<string, string>();
  const totals = emptyBucket();

  for (const call of calls) {
    const key = keyOf(call);
    keyByCall.set(call.id, key);

    let group = groups.get(key);
    if (!group) {
      group = emptyBucket();
      groups.set(key, group);
    }

    const { revenue, payout, callCost } = callAmounts(call);
    const connected = !!call.connectedDuration && call.connectedDuration > 0;

    for (const bucket of [group, totals]) {
      bucket.totalCalls++;
      if (connected) bucket.connectedCalls++;
      if (call.billable) bucket.billableCalls++;
      bucket.revenue = bucket.revenue.plus(revenue);
      bucket.payout = bucket.payout.plus(payout);
      bucket.callCost = bucket.callCost.plus(callCost);
      if (call.disputeStatus) {
        bucket.disputes = bucket.disputes.plus(revenue);
        bucket.disputesCount++;
      }
    }
  }

  for (const entry of ledger) {
    if (!entry.callId) continue;
    const key = keyByCall.get(entry.callId);
    if (key === undefined) continue;
    const group = groups.get(key)!;

    const amount = new Prisma.Decimal(entry.amount);
    if (entry.type === 'RECORDING_FEE' || entry.type === 'CONNECTION_FEE') {
      group.otherCosts = group.otherCosts.plus(amount);
    } else if (entry.type === 'ADJUSTMENT') {
      group.adjustments = group.adjustments.plus(amount);
    } else if (entry.type === 'DISPUTE_HOLD' || entry.type === 'DISPUTE_REVERSAL') {
      group.ledgerDisputes = group.ledgerDisputes.plus(amount);
    }
  }

  for (const group of groups.values()) {
    group.profit = group.revenue.minus(group.payout).minus(group.callCost).minus(group.otherCosts);
    group.netPayableReceivable = group.profit.plus(group.adjustments);

    totals.otherCosts = totals.otherCosts.plus(group.otherCosts);
    totals.adjustments = totals.adjustments.plus(group.adjustments);
    totals.ledgerDisputes = totals.ledgerDisputes.plus(group.ledgerDisputes);
    totals.profit = totals.profit.plus(group.profit);
    totals.netPayableReceivable = totals.netPayableReceivable.plus(group.netPayableReceivable);
  }

  return { groups, totals };
}

/** Profit over revenue as a fraction, or 0 with no revenue -- the report's `margin`. */
export function marginOf(bucket: Pick<MoneyBucket, 'profit' | 'revenue'>): number {
  return bucket.revenue.gt(0) ? bucket.profit.dividedBy(bucket.revenue).toNumber() : 0;
}
