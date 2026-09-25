/**
 * Sales: what a white-label agency's calls sold for.
 *
 *   GET /api/v1/call-sales/summary?period=<PERIOD_KEY>&from=&to=
 *   GET /api/v1/call-sales/summary.csv?period=...
 *
 * ── Who ──────────────────────────────────────────────────────────────────────
 *
 * The OWNER or ADMIN of a white-label agency, and a platform admin acting
 * inside an agency (`requireWhiteLabelOperator`). A normal agency's owner is
 * refused 403: its calls are bought from NetEnroll, not sold, and this screen
 * carries the buyer prices and publisher payouts of a call network it does not
 * run.
 *
 * ── Whose ────────────────────────────────────────────────────────────────────
 *
 * The acting tenant's, resolved by `resolveTenant` and nothing else. No
 * parameter names a tenant, a buyer or a publisher.
 *
 * ── The period ───────────────────────────────────────────────────────────────
 *
 * A name, resolved by `services/leaderboard/period.ts`, so a day here starts
 * and ends where it does on the Leaderboard. The default is TODAY.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { csvCell } from '../lib/csv.js';
import { getPrismaClient } from '../lib/prisma.js';
import { resolveTenant } from '../lib/tenant-context.js';
import { requireWhiteLabelOperator } from '../lib/white-label.js';
import { authenticate } from '../middleware/auth.js';
import {
  isPeriodKey,
  PeriodError,
  PERIOD_KEYS,
  resolvePeriod,
  type ResolvedPeriod,
} from '../services/leaderboard/period.js';
import { getCallSalesSummary } from '../services/reporting/call-sales.js';

export interface PeriodQuery {
  period?: string;
  from?: string;
  to?: string;
}

/**
 * The period a request asked for, or null after answering 400.
 *
 * Shared by the white-label routes that take a period, so each refuses a bad
 * one with the same words the Leaderboard uses.
 */
export function periodFromQuery(query: PeriodQuery, reply: FastifyReply): ResolvedPeriod | null {
  const requested = query.period ?? 'TODAY';
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
    return resolvePeriod(requested, { from: query.from, to: query.to });
  } catch (error) {
    if (error instanceof PeriodError) {
      void reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: error.message } });
      return null;
    }
    throw error;
  }
}

// eslint-disable-next-line @typescript-eslint/require-await -- plugin signature
export async function registerCallSalesRoutes(fastify: FastifyInstance): Promise<void> {
  const prisma = getPrismaClient();

  async function summaryFor(
    request: FastifyRequest<{ Querystring: PeriodQuery }>,
    reply: FastifyReply
  ) {
    const tenantId = resolveTenant(request, reply);
    if (!tenantId) return null;

    const period = periodFromQuery(request.query, reply);
    if (!period) return null;

    return getCallSalesSummary(tenantId, period, { prisma });
  }

  fastify.get<{ Querystring: PeriodQuery }>(
    '/api/v1/call-sales/summary',
    { preHandler: [authenticate, requireWhiteLabelOperator] },
    async (request, reply) => {
      const data = await summaryFor(request, reply);
      if (!data) return;
      return reply.send({ data });
    }
  );

  fastify.get<{ Querystring: PeriodQuery }>(
    '/api/v1/call-sales/summary.csv',
    { preHandler: [authenticate, requireWhiteLabelOperator] },
    async (request, reply) => {
      const data = await summaryFor(request, reply);
      if (!data) return;

      const lines: string[] = [
        `${csvCell('Buyers')},${csvCell(`${data.period.from} to ${data.period.to}`)}`,
        [
          'Buyer',
          'Calls',
          'Billable',
          'Billable %',
          'Revenue',
          'Avg connected (seconds)',
          'Disputed',
          'Cap consumed today',
        ].join(','),
        ...data.byBuyer.map(row =>
          [
            csvCell(row.buyerName),
            row.calls,
            row.billable,
            row.billablePct ?? '',
            row.revenue.toFixed(2),
            row.avgConnectedSeconds ?? '',
            row.disputed,
            row.capConsumedToday,
          ].join(',')
        ),
        '',
        csvCell('Publishers'),
        [
          'Publisher',
          'Calls',
          'Answered by agents',
          'Sent to buyers',
          'Billable',
          'Payout',
          'Revenue',
          'Profit',
        ].join(','),
        ...data.byPublisher.map(row =>
          [
            csvCell(row.publisherName),
            row.calls,
            row.answeredByAgents,
            row.sentToBuyers,
            row.billable,
            row.payout.toFixed(2),
            row.revenue.toFixed(2),
            row.profit.toFixed(2),
          ].join(',')
        ),
      ];

      return reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header(
          'Content-Disposition',
          `attachment; filename="call-sales-${data.period.from}-to-${data.period.to}.csv"`
        )
        .send(lines.join('\n'));
    }
  );
}
