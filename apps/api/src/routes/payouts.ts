/**
 * Payouts: what a white-label agency owes its publishers, and what it has paid.
 *
 *   GET  /api/v1/payouts/summary?period=<PERIOD_KEY>&from=&to=
 *   POST /api/v1/payouts        { publisherId, periodFrom, periodTo, method, reference? }
 *
 * ── Who, and whose ───────────────────────────────────────────────────────────
 *
 * The OWNER or ADMIN of a white-label agency, or a platform admin acting inside
 * an agency (`requireWhiteLabelOperator`). Every read and write is scoped to
 * the acting tenant from `resolveTenant`; a publisher id that is not the
 * acting tenant's answers 404, the same as one that does not exist.
 *
 * ── Recording a payment moves no money ───────────────────────────────────────
 *
 * The agency pays its publisher however it pays them -- ACH, a check, a wire --
 * and records it here. The platform writes the `PublisherPayment`, marks the
 * calls it covers PAID, and audits it. Nothing here charges, transfers or
 * talks to a bank.
 *
 * ── What a payment covers ────────────────────────────────────────────────────
 *
 * Exactly the publisher's calls that are PAYABLE, carry no OPEN dispute, and were
 * created inside [periodFrom, periodTo], in this tenant. They are selected,
 * summed and marked PAID in one transaction, and the update is conditional on
 * each call still being PAYABLE and undisputed: two operators recording the
 * same range at once cannot both pay it. The second finds nothing left and is
 * refused 409, as is any range with nothing payable in it.
 *
 * ── Returns after the publisher was paid ─────────────────────────────────────
 *
 * Accepting a return on a call its publisher was already paid for writes a
 * CLAWBACK row (a negative amount, see routes/returns.ts). The publisher's next
 * payment is recorded net of every clawback still waiting: they are locked
 * FOR UPDATE inside the payment's transaction, summed, and linked to the new
 * PAYMENT through `appliedToPaymentId`, so two payments recorded at once cannot
 * both deduct the same return. When the returns are more than what is payable
 * the payment is refused 409 CLAWBACK_EXCEEDS_PAYABLE and nothing is written:
 * the calls stay PAYABLE and the returns carry to the next payment.
 */

import { Prisma, type PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { OPEN_DISPUTE, isOpenDispute } from '../lib/dispute-status.js';
import { getPrismaClient } from '../lib/prisma.js';
import { getActingUserId, resolveTenant } from '../lib/tenant-context.js';
import { requireWhiteLabelOperator } from '../lib/white-label.js';
import { authenticate } from '../middleware/auth.js';
import type { ResolvedPeriod } from '../services/leaderboard/period.js';

import { periodFromQuery, type PeriodQuery } from './call-sales.js';

/** Long enough for any payment method a person types; short enough for a table cell. */
const METHOD_MAX_LENGTH = 40;
const REFERENCE_MAX_LENGTH = 120;

/** Raised inside the payment transaction to roll it back with a 409. */
class NothingPayableError extends Error {}

/** Raised inside the payment transaction when returns owed are at least the payable. */
class ClawbackExceedsPayableError extends Error {
  constructor(
    readonly payable: Prisma.Decimal,
    readonly clawbacks: Prisma.Decimal,
    readonly net: Prisma.Decimal
  ) {
    super('CLAWBACK_EXCEEDS_PAYABLE');
  }
}

function money(value: Prisma.Decimal): number {
  return Number(value.toFixed(2));
}

interface PaymentRow {
  id: string;
  publisherId: string;
  /** PAYMENT, or CLAWBACK: a return deducted from the publisher's next payment. */
  kind: string;
  /** CLAWBACK only: the returned call. */
  callId: string | null;
  /** CLAWBACK only: the PAYMENT it came out of; null while it waits. */
  appliedToPaymentId: string | null;
  amount: Prisma.Decimal;
  periodFrom: Date;
  periodTo: Date;
  method: string;
  reference: string | null;
  paidAt: Date;
}

function paymentView(payment: PaymentRow, names: Map<string, string>) {
  return {
    id: payment.id,
    publisherId: payment.publisherId,
    publisherName: names.get(payment.publisherId) ?? 'Unknown publisher',
    kind: payment.kind,
    callId: payment.callId,
    appliedToPaymentId: payment.appliedToPaymentId,
    amount: money(payment.amount),
    periodFrom: payment.periodFrom.toISOString(),
    periodTo: payment.periodTo.toISOString(),
    method: payment.method,
    reference: payment.reference,
    paidAt: payment.paidAt.toISOString(),
  };
}

/** A body field as a trimmed string, or '' when it is anything else. */
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** An instant from a body field, or null when it is not one. */
function instant(value: unknown): Date | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** One publisher's line on the Payouts screen. */
export interface PayoutsPublisherRow {
  publisherId: string;
  publisherName: string;
  payable: number;
  payableCalls: number;
  held: number;
  paid: number;
  /** Returns accepted after this publisher was paid, not yet deducted: positive. */
  returnsPending: number;
  /** payable − returnsPending. Negative when the publisher owes the agency. */
  netPayable: number;
  lastPayment: ReturnType<typeof paymentView> | null;
}

export interface PayoutsSummary {
  publishers: PayoutsPublisherRow[];
  payments: Array<ReturnType<typeof paymentView>>;
  /** Across every publisher: what is owed now, and on how many calls. */
  totals: { payable: number; payableCalls: number; returnsPending: number; netPayable: number };
}

/**
 * What the acting tenant owes, holds and has paid each of its publishers over
 * one period.
 *
 * Its own function, not inline in the route, because the white-label Today
 * screen shows the same "owed to publishers" figure and two copies of this
 * arithmetic is how the two screens would come to disagree.
 *
 * A call is HELD while its payout status is HELD or it carries an OPEN dispute
 * (`isOpenDispute`). A decided return is not open: a denied one is payable
 * again, and an accepted one has had its payout zeroed -- or, when it was
 * already PAID, reads CLAWED_BACK and counts as neither paid nor held; the
 * deduction it owes is `returnsPending` until the next payment takes it.
 *
 * `paid` is what was paid for this period's calls; CLAWBACK rows never count
 * toward it. `returnsPending` is every clawback not yet deducted, whatever the
 * period, because it comes out of the next payment whenever that is.
 */
export async function getPayoutsSummary(
  prisma: Pick<PrismaClient, 'publisher' | 'call' | 'publisherPayment'>,
  tenantId: string,
  period: Pick<ResolvedPeriod, 'start' | 'endExclusive'>
): Promise<PayoutsSummary> {
  const [publishers, calls, payments, pending] = await Promise.all([
    prisma.publisher.findMany({
      where: { tenantId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.call.findMany({
      where: {
        tenantId,
        publisherId: { not: null },
        createdAt: { gte: period.start, lt: period.endExclusive },
      },
      select: {
        publisherId: true,
        publisherPayoutAmount: true,
        publisherPayoutStatus: true,
        disputeStatus: true,
      },
    }),
    prisma.publisherPayment.findMany({
      where: { tenantId },
      orderBy: { paidAt: 'desc' },
      take: 100,
    }),
    prisma.publisherPayment.groupBy({
      by: ['publisherId'],
      where: { tenantId, kind: 'CLAWBACK', appliedToPaymentId: null },
      _sum: { amount: true },
    }),
  ]);
  const pendingByPublisher = new Map(
    pending.map(row => [row.publisherId, (row._sum.amount ?? new Prisma.Decimal(0)).abs()])
  );

  const names = new Map(publishers.map(publisher => [publisher.id, publisher.name]));

  const zero = () => new Prisma.Decimal(0);
  const figures = new Map(
    publishers.map(publisher => [
      publisher.id,
      { payable: zero(), payableCalls: 0, held: zero(), paid: zero() },
    ])
  );

  for (const call of calls) {
    const row = call.publisherId ? figures.get(call.publisherId) : undefined;
    if (!row) continue;
    const amount = call.publisherPayoutAmount
      ? new Prisma.Decimal(call.publisherPayoutAmount)
      : zero();

    if (call.publisherPayoutStatus === 'PAID') {
      row.paid = row.paid.plus(amount);
    } else if (call.publisherPayoutStatus === 'HELD' || isOpenDispute(call.disputeStatus)) {
      row.held = row.held.plus(amount);
    } else if (call.publisherPayoutStatus === 'PAYABLE') {
      row.payable = row.payable.plus(amount);
      row.payableCalls++;
    }
  }

  const lastPayment = new Map<string, PaymentRow>();
  for (const payment of payments) {
    if (payment.kind !== 'PAYMENT') continue;
    if (!lastPayment.has(payment.publisherId)) lastPayment.set(payment.publisherId, payment);
  }

  let totalPayable = zero();
  let totalPayableCalls = 0;
  let totalPending = zero();
  for (const [publisherId, row] of figures) {
    totalPayable = totalPayable.plus(row.payable);
    totalPayableCalls += row.payableCalls;
    totalPending = totalPending.plus(pendingByPublisher.get(publisherId) ?? 0);
  }

  return {
    publishers: publishers.map(publisher => {
      const row = figures.get(publisher.id)!;
      const last = lastPayment.get(publisher.id);
      const returnsPending = pendingByPublisher.get(publisher.id) ?? zero();
      return {
        publisherId: publisher.id,
        publisherName: publisher.name,
        payable: money(row.payable),
        payableCalls: row.payableCalls,
        held: money(row.held),
        paid: money(row.paid),
        returnsPending: money(returnsPending),
        netPayable: money(row.payable.minus(returnsPending)),
        lastPayment: last ? paymentView(last, names) : null,
      };
    }),
    payments: payments.map(payment => paymentView(payment, names)),
    totals: {
      payable: money(totalPayable),
      payableCalls: totalPayableCalls,
      returnsPending: money(totalPending),
      netPayable: money(totalPayable.minus(totalPending)),
    },
  };
}

// eslint-disable-next-line @typescript-eslint/require-await -- plugin signature
export async function registerPayoutRoutes(fastify: FastifyInstance): Promise<void> {
  const prisma = getPrismaClient();

  fastify.get<{ Querystring: PeriodQuery }>(
    '/api/v1/payouts/summary',
    { preHandler: [authenticate, requireWhiteLabelOperator] },
    async (request, reply) => {
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;

      const period = periodFromQuery(request.query, reply);
      if (!period) return;

      const summary = await getPayoutsSummary(prisma, tenantId, period);

      return reply.send({
        data: {
          period: {
            key: period.key,
            label: period.label,
            from: period.from,
            to: period.to,
            days: period.days,
            complete: period.complete,
            /** The instants a payment for exactly this period should name. */
            startsAt: period.start.toISOString(),
            endsAt: new Date(period.endExclusive.getTime() - 1).toISOString(),
          },
          publishers: summary.publishers,
          payments: summary.payments,
        },
      });
    }
  );

  fastify.post<{
    Body: {
      publisherId?: unknown;
      periodFrom?: unknown;
      periodTo?: unknown;
      method?: unknown;
      reference?: unknown;
    };
  }>(
    '/api/v1/payouts',
    { preHandler: [authenticate, requireWhiteLabelOperator] },
    async (request, reply) => {
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;

      const userId = getActingUserId(request);
      if (!userId) {
        return reply.code(403).send({
          error: { code: 'FORBIDDEN', message: 'A payment is recorded by a person, not a key.' },
        });
      }

      const body = request.body ?? {};
      const publisherId = text(body.publisherId);
      const periodFrom = instant(body.periodFrom);
      const periodTo = instant(body.periodTo);
      const method = text(body.method);
      const reference = text(body.reference) || null;

      const problems: string[] = [];
      if (!publisherId) problems.push('publisherId is required');
      if (!periodFrom) problems.push('periodFrom must be a date and time');
      if (!periodTo) problems.push('periodTo must be a date and time');
      if (periodFrom && periodTo && periodTo < periodFrom) {
        problems.push('periodTo must not be before periodFrom');
      }
      if (!method) problems.push('method is required');
      if (method.length > METHOD_MAX_LENGTH) {
        problems.push(`method must be at most ${METHOD_MAX_LENGTH} characters`);
      }
      if (reference && reference.length > REFERENCE_MAX_LENGTH) {
        problems.push(`reference must be at most ${REFERENCE_MAX_LENGTH} characters`);
      }
      if (problems.length > 0) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: problems.join('; '), problems },
        });
      }

      // In THIS tenant, or it does not exist as far as the caller is concerned.
      const publisher = await prisma.publisher.findFirst({
        where: { id: publisherId, tenantId },
        select: { id: true, name: true },
      });
      if (!publisher) {
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Publisher not found' } });
      }

      const payableWhere: Prisma.CallWhereInput = {
        tenantId,
        publisherId: publisher.id,
        publisherPayoutStatus: 'PAYABLE',
        /*
         * No OPEN dispute. Written as an OR because Prisma's
         * `{ not: 'DISPUTED' }` compiles to `<> 'DISPUTED'`, which is never
         * true of NULL -- it would drop every call that was never disputed.
         * A denied return ('DENIED') is payable again.
         */
        OR: [{ disputeStatus: null }, { disputeStatus: { not: OPEN_DISPUTE } }],
        createdAt: { gte: periodFrom!, lte: periodTo! },
      };

      let payment;
      try {
        payment = await prisma.$transaction(async tx => {
          const calls = await tx.call.findMany({
            where: payableWhere,
            select: { id: true, publisherPayoutAmount: true },
          });

          const total = calls.reduce(
            (sum, call) =>
              call.publisherPayoutAmount ? sum.plus(call.publisherPayoutAmount) : sum,
            new Prisma.Decimal(0)
          );
          if (calls.length === 0 || total.lte(0)) throw new NothingPayableError();

          /*
           * The returns this publisher still owes, locked so a payment being
           * recorded at the same moment waits here, then finds them applied
           * (Postgres re-checks the WHERE on the row it waited for) and skips
           * them. Never another tenant's: the tenant is in the WHERE.
           */
          const clawbacks = await tx.$queryRaw<
            Array<{ id: string; callId: string | null; amount: Prisma.Decimal }>
          >`
            SELECT "id", "callId", "amount"
            FROM "publisher_payments"
            WHERE "tenantId" = ${tenantId}
              AND "publisherId" = ${publisher.id}
              AND "kind" = 'CLAWBACK'
              AND "appliedToPaymentId" IS NULL
            ORDER BY "createdAt", "id"
            FOR UPDATE
          `;
          const gross = total.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
          const clawbackTotal = clawbacks.reduce(
            (sum, row) => sum.plus(row.amount),
            new Prisma.Decimal(0)
          );
          const net = gross.plus(clawbackTotal);
          if (net.lte(0)) throw new ClawbackExceedsPayableError(gross, clawbackTotal, net);

          const now = new Date();
          /*
           * Conditional on each call still being payable and undisputed. A
           * concurrent payment for the same range blocks here until the first
           * commits, then matches nothing -- and the count says so.
           */
          const updated = await tx.call.updateMany({
            where: { ...payableWhere, id: { in: calls.map(call => call.id) } },
            data: { publisherPayoutStatus: 'PAID', publisherPaidAt: now, paidOut: true },
          });
          if (updated.count !== calls.length) throw new NothingPayableError();

          const created = await tx.publisherPayment.create({
            data: {
              tenantId,
              publisherId: publisher.id,
              kind: 'PAYMENT',
              amount: net,
              periodFrom: periodFrom!,
              periodTo: periodTo!,
              method,
              reference,
              paidAt: now,
              createdById: userId,
            },
          });

          if (clawbacks.length > 0) {
            await tx.publisherPayment.updateMany({
              where: { id: { in: clawbacks.map(row => row.id) }, tenantId },
              data: { appliedToPaymentId: created.id },
            });
          }

          await tx.auditLog.create({
            data: {
              tenantId,
              userId,
              action: 'payouts.publisher_payment.recorded',
              entityType: 'publisher_payment',
              entityId: created.id,
              resource: request.url,
              method: request.method,
              requestId: request.id,
              changes: {
                publisherId: publisher.id,
                publisherName: publisher.name,
                amount: created.amount.toFixed(2),
                gross: gross.toFixed(2),
                clawbacks: clawbackTotal.toFixed(2),
                net: net.toFixed(2),
                clawbackIds: clawbacks.map(row => row.id),
                calls: calls.length,
                periodFrom: periodFrom!.toISOString(),
                periodTo: periodTo!.toISOString(),
                method,
                reference,
              },
            },
          });

          return { created, calls: calls.length, gross, clawbacks, net };
        });
      } catch (error) {
        if (error instanceof NothingPayableError) {
          return reply.code(409).send({
            error: {
              code: 'NOTHING_PAYABLE',
              message: 'Nothing is payable to this publisher for that period.',
            },
          });
        }
        if (error instanceof ClawbackExceedsPayableError) {
          return reply.code(409).send({
            error: {
              code: 'CLAWBACK_EXCEEDS_PAYABLE',
              message: `Nothing to pay: $${error.clawbacks.abs().toFixed(2)} in returns is more than the $${error.payable.toFixed(2)} payable. It carries to the next payment.`,
              payable: money(error.payable),
              clawbacks: money(error.clawbacks),
              net: money(error.net),
            },
          });
        }
        throw error;
      }

      return reply.code(201).send({
        data: {
          ...paymentView(payment.created, new Map([[publisher.id, publisher.name]])),
          calls: payment.calls,
          gross: money(payment.gross),
          clawbacks: payment.clawbacks.map(row => ({
            id: row.id,
            callId: row.callId,
            amount: money(row.amount),
          })),
          net: money(payment.net),
        },
      });
    }
  );
}
