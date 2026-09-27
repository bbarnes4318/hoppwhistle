/**
 * What the publisher portal shows a publisher about their own money and calls.
 *
 *   GET /api/v1/publishers/:publisherId/payouts           payments and deductions
 *   GET /api/v1/publishers/:publisherId/payouts/summary   owed, held, paid
 *   GET /api/v1/publishers/:publisherId/daily             calls per day
 *
 * ── The owner's numbers, not a second set ────────────────────────────────────
 *
 * The portal used to read `payouts`, a table nothing writes, and derived its
 * "paid" and "pending" cards from whichever fifty calls the browser happened to
 * have loaded. The agency records what it pays on the Payouts screen, into
 * `publisher_payments`, and that screen's figures come from
 * `getPayoutsSummary` in `routes/payouts.ts`. The portal reads the same rows
 * and the same function, so a publisher and the agency paying them see one
 * answer. Nothing here recomputes an amount the owner's screen already has.
 *
 * ── Scope ────────────────────────────────────────────────────────────────────
 *
 * Every read takes the acting tenant AND the publisher. `requirePublisherAccess`
 * lets an OWNER or ADMIN through for any publisher id, and those roles are per
 * tenant, so the route also checks the publisher belongs to the acting tenant
 * and every query here repeats the tenant.
 */

import { Prisma, type PrismaClient } from '@prisma/client';

import type { ResolvedPeriod } from '../leaderboard/period.js';
import { calendarDayOf, shiftCalendarDay, type CalendarDayKey } from '../rating/calendar-day.js';

import { salesCallWhere } from './call-money.js';

function money(value: Prisma.Decimal | null | undefined): number {
  return value ? Number(value.toFixed(2)) : 0;
}

/** One returned call deducted from a payment, or waiting for the next one. */
export interface PublisherDeductionView {
  id: string;
  /** Null once the returned call itself has been deleted; the deduction stands. */
  callId: string | null;
  /** When the returned call came in, while it still exists. */
  callDate: string | null;
  /** As stored: negative, because it is money coming back off a payment. */
  amount: number;
  createdAt: string;
}

export interface PublisherPaymentView {
  id: string;
  /** Net of `deductions`: what actually reached the publisher. */
  amount: number;
  method: string;
  reference: string | null;
  paidAt: string;
  periodFrom: string;
  periodTo: string;
  deductions: PublisherDeductionView[];
}

export interface PublisherPayments {
  payments: PublisherPaymentView[];
  /** Accepted returns not yet taken out of a payment. They come off the next one. */
  waiting: PublisherDeductionView[];
}

/**
 * Every payment the agency recorded for this publisher, newest first, each with
 * the returns deducted from it, plus the returns still waiting for a payment.
 *
 * A CLAWBACK row points at the PAYMENT it came out of through
 * `appliedToPaymentId`; null means no payment has taken it yet. The returned
 * call's date is looked up rather than joined because the clawback outlives the
 * call: deleting a call nulls `callId` and keeps the deduction.
 */
export async function getPublisherPayments(
  prisma: Pick<PrismaClient, 'publisherPayment' | 'call'>,
  tenantId: string,
  publisherId: string
): Promise<PublisherPayments> {
  const rows = await prisma.publisherPayment.findMany({
    where: { tenantId, publisherId },
    orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
  });

  const callIds = [
    ...new Set(rows.map(row => row.callId).filter((id): id is string => id !== null)),
  ];
  const calls = callIds.length
    ? await prisma.call.findMany({
        where: { tenantId, id: { in: callIds } },
        select: { id: true, createdAt: true },
      })
    : [];
  const callDates = new Map(calls.map(call => [call.id, call.createdAt]));

  const deduction = (row: (typeof rows)[number]): PublisherDeductionView => ({
    id: row.id,
    callId: row.callId,
    callDate: row.callId ? (callDates.get(row.callId)?.toISOString() ?? null) : null,
    amount: money(row.amount),
    createdAt: row.createdAt.toISOString(),
  });

  const byPayment = new Map<string, PublisherDeductionView[]>();
  const waiting: PublisherDeductionView[] = [];
  for (const row of rows) {
    if (row.kind !== 'CLAWBACK') continue;
    if (row.appliedToPaymentId === null) {
      waiting.push(deduction(row));
      continue;
    }
    const list = byPayment.get(row.appliedToPaymentId) ?? [];
    list.push(deduction(row));
    byPayment.set(row.appliedToPaymentId, list);
  }

  return {
    payments: rows
      .filter(row => row.kind === 'PAYMENT')
      .map(row => ({
        id: row.id,
        amount: money(row.amount),
        method: row.method,
        reference: row.reference,
        paidAt: row.paidAt.toISOString(),
        periodFrom: row.periodFrom.toISOString(),
        periodTo: row.periodTo.toISOString(),
        deductions: byPayment.get(row.id) ?? [],
      })),
    waiting,
  };
}

/** One calendar day of a publisher's inbound calls. */
export interface PublisherDay {
  day: CalendarDayKey;
  calls: number;
  billable: number;
  /** What those calls earned the publisher, in dollars. */
  payout: number;
}

/**
 * The longest range the daily series answers for. A year and a day, so This
 * year and Last year fit in a leap year; a custom range past that is refused
 * rather than answered as thousands of bars nobody can read.
 */
export const MAX_DAILY_DAYS = 366;

/**
 * The publisher's inbound calls in the period, one entry per America/New_York
 * calendar day, days with no calls included as zeros.
 *
 * This replaced a chart drawn from a sine wave scaled to the period's totals,
 * which showed a trend on days that had none. Zero days are in the answer on
 * purpose: a gap in the series is how a publisher sees that their traffic
 * stopped.
 *
 * The calls are `salesCallWhere`'s, the set the owner's Revenue and Payouts
 * screens read, narrowed to this publisher. `payout` sums
 * `publisherPayoutAmount` except on a call whose payout was clawed back, which
 * the publisher no longer keeps.
 */
export async function getPublisherDaily(
  prisma: Pick<PrismaClient, 'call'>,
  tenantId: string,
  publisherId: string,
  period: Pick<ResolvedPeriod, 'from' | 'to' | 'start' | 'endExclusive'>
): Promise<PublisherDay[]> {
  const calls = await prisma.call.findMany({
    where: { ...salesCallWhere(tenantId, period), publisherId },
    select: {
      createdAt: true,
      billable: true,
      publisherPayoutAmount: true,
      publisherPayoutStatus: true,
    },
  });

  const days = new Map<
    CalendarDayKey,
    { calls: number; billable: number; payout: Prisma.Decimal }
  >();
  for (let day = period.from; day <= period.to; day = shiftCalendarDay(day, 1)) {
    days.set(day, { calls: 0, billable: 0, payout: new Prisma.Decimal(0) });
  }

  for (const call of calls) {
    const entry = days.get(calendarDayOf(call.createdAt));
    if (!entry) continue;
    entry.calls++;
    if (call.billable) entry.billable++;
    if (call.publisherPayoutAmount && call.publisherPayoutStatus !== 'CLAWED_BACK') {
      entry.payout = entry.payout.plus(call.publisherPayoutAmount);
    }
  }

  return [...days].map(([day, entry]) => ({
    day,
    calls: entry.calls,
    billable: entry.billable,
    payout: money(entry.payout),
  }));
}
