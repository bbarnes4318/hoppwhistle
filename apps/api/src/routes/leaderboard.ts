/**
 * The agency leaderboard.
 *
 * ── One route, one agency, everybody in it ───────────────────────────────────
 *
 * `GET /api/v1/leaderboard` answers for the ACTING TENANT and takes no
 * parameter naming an agency. There is no platform-scoped sibling here on
 * purpose: a cross-agency board would rank one customer's floor against
 * another's, from figures each of them is separately priced on, and nobody
 * asked for that. The cross-agency view already exists, it is
 * `/api/v1/platform/delivery/overview`, and it is gated on the platform-admin
 * capability.
 *
 * ── Why this is `authenticate` and not `requireAgencyPrincipal` ──────────────
 *
 * Every other `/api/v1/delivery/*` route except `/me` carries
 * `requireAgencyPrincipal`, because those routes load rates, balances, the
 * Daily Block, the overrun and the projected nightly debit -- commercial terms
 * between NetEnroll and the agency's owner that an AGENT holding a token in the
 * tenant had no business reading.
 *
 * This route loads none of those. The service behind it issues no query against
 * the credit ledger, the rate curve, the settlement tables or the billing
 * profile, and there is no field in the response an agency is charged from.
 * What it carries is the floor's own production, which is what a sales floor
 * has on the wall -- and a leaderboard an agent cannot see their colleagues on
 * is not a leaderboard.
 *
 * The line is: production is shared inside the agency, money is not.
 *
 * ── The period is a name, not a pair of dates ────────────────────────────────
 *
 * `?period=THIS_WEEK` rather than `?from=&to=`, because "this week" depends on
 * which clock you ask and the browser's is the wrong one. See the header of
 * `services/leaderboard/period.ts`. `period=CUSTOM&from=&to=` is the calendar
 * picker, and those are day labels, which no timezone can shift.
 */

import type { FastifyInstance } from 'fastify';

import { getPrismaClient } from '../lib/prisma.js';
import { getActingUserId, resolveTenant } from '../lib/tenant-context.js';
import { authenticate } from '../middleware/auth.js';
import { getLeaderboard } from '../services/leaderboard/leaderboard.js';
import {
  isPeriodKey,
  PeriodError,
  PERIOD_KEYS,
  resolvePeriod,
} from '../services/leaderboard/period.js';

/** A CSV cell that cannot be read as a formula by a spreadsheet. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  // A leading =, +, - or @ makes Excel and Sheets evaluate the cell. An agent's
  // name is user-supplied and goes in column one of a file somebody opens.
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

interface LeaderboardQuery {
  period?: string;
  from?: string;
  to?: string;
  format?: string;
}

// eslint-disable-next-line @typescript-eslint/require-await -- plugin signature
export async function registerLeaderboardRoutes(fastify: FastifyInstance): Promise<void> {
  const prisma = getPrismaClient();

  fastify.get<{ Querystring: LeaderboardQuery }>(
    '/api/v1/leaderboard',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;

      const requested = request.query.period ?? 'TODAY';
      if (!isPeriodKey(requested)) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: `period must be one of: ${PERIOD_KEYS.join(', ')}`,
          },
        });
      }

      let period;
      try {
        period = resolvePeriod(requested, {
          from: request.query.from,
          to: request.query.to,
        });
      } catch (error) {
        if (error instanceof PeriodError) {
          return reply
            .code(400)
            .send({ error: { code: 'VALIDATION_ERROR', message: error.message } });
        }
        throw error;
      }

      const data = await getLeaderboard(tenantId, period, {
        prisma,
        /*
         * So the board can say where the reader stands. Taken from the token,
         * never from the query: a caller naming somebody else would be reading
         * "you" as another agent, which is a different feature and not this one.
         */
        viewerId: getActingUserId(request),
      });

      if (request.query.format === 'csv') {
        const header = [
          'Rank',
          'Agent',
          'Email',
          'Points',
          'Inbound calls',
          'Unique callers',
          'Outbound calls',
          'Outbound connected',
          'Applications',
          'Conversion %',
          'Closing %',
          'Annualized premium',
          'Talk time (seconds)',
          'Hours worked',
          'Occupancy %',
          'Streak (days)',
        ].join(',');

        const rows = data.rows.map(row =>
          [
            row.rank ?? '',
            csvCell(row.name),
            csvCell(row.email ?? ''),
            row.points,
            row.inboundCalls,
            row.uniqueInboundCallers,
            row.outboundCalls,
            row.outboundConnected,
            row.applications,
            /*
             * Empty, not 0. A rate with no opportunities behind it is an absent
             * measurement, and a spreadsheet that averages a fabricated 0%
             * reports a number nobody measured.
             */
            row.conversionPct === null ? '' : row.conversionPct.toFixed(2),
            row.closingPct === null ? '' : row.closingPct.toFixed(2),
            row.annualizedPremium.toFixed(2),
            row.talkTimeSeconds,
            row.hoursWorked === null ? '' : row.hoursWorked.toFixed(2),
            row.occupancyPct === null ? '' : row.occupancyPct.toFixed(2),
            row.streakDays,
          ].join(',')
        );

        void reply.header(
          'content-disposition',
          `attachment; filename="leaderboard-${data.period.from}-to-${data.period.to}.csv"`
        );
        return reply.type('text/csv; charset=utf-8').send([header, ...rows].join('\n'));
      }

      return reply.send({ data });
    }
  );
}
