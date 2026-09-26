/**
 * Today: a white-label agency's whole operation on one screen.
 *
 *   GET /api/v1/white-label/today
 *
 * ── Built from what already answers each question ────────────────────────────
 *
 * Nothing here computes a figure another screen already computes. Each number
 * comes from the function behind the screen it summarises, so Today can never
 * disagree with the page it links to:
 *
 *   calls up, applications, closing   getAgencyLiveBoard      (the Live Board)
 *   inbound, answered, sent, revenue  getCallSalesSummary     (Sales, TODAY)
 *   agents ready / on a call          readStatuses            (the Agents roster)
 *   agents who can't take calls       agentBlocker            (the Agents roster)
 *   owed to publishers                getPayoutsSummary       (Payouts, THIS_MONTH --
 *                                                              the period that
 *                                                              screen opens on)
 *
 * Buyer caps are the one rule stated here, and it is the rule
 * `routes/live-metrics.ts` already uses for a buyer's own strip: a buyer's
 * daily cap is the sum of `maxCap` over its ACTIVE endpoints whose
 * `capPeriod` is DAY, and 0 means no cap. At cap when that sum is above zero
 * and `BuyerStats.capConsumedToday` has reached it.
 *
 * ── Who, and whose ───────────────────────────────────────────────────────────
 *
 * A white-label OWNER or ADMIN, or a platform admin acting inside an agency
 * (`requireWhiteLabelOperator`). Everything is the acting tenant's, from
 * `resolveTenant`.
 *
 * ── Cached for fifteen seconds ───────────────────────────────────────────────
 *
 * Per tenant, in Redis, because the screen polls and every figure above is a
 * handful of queries. Fifteen seconds is well inside how stale a "right now"
 * tile may be. The cache is an optimisation and never a dependency: a Redis
 * read or write that fails is logged and the answer comes from the database.
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { OPEN_DISPUTE } from '../lib/dispute-status.js';
import { logger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';
import { resolveTenant } from '../lib/tenant-context.js';
import { requireWhiteLabelOperator } from '../lib/white-label.js';
import { authenticate } from '../middleware/auth.js';
import { resolvePeriod } from '../services/leaderboard/period.js';
import { getAgencyLiveBoard, type AgencyLiveBoardRow } from '../services/live/agency-board.js';
import { getRedisClient } from '../services/redis.js';
import { getCallSalesSummary } from '../services/reporting/call-sales.js';

import { AGENT_BLOCKER_SELECT, agentBlocker, readStatuses } from './agent-roster.js';
import { getPayoutsSummary } from './payouts.js';

export const TODAY_CACHE_TTL_SECONDS = 15;

export function todayCacheKey(tenantId: string): string {
  return `wl:today:${tenantId}`;
}

export type AgentPresence = 'READY' | 'ON_CALL' | 'AWAY' | 'OFFLINE';

/**
 * The softphone's status string, as the Today screen groups it. Lower-cased
 * first: the softphone has written both cases over its life.
 */
export function agentPresence(status: string | null | undefined): AgentPresence {
  switch ((status ?? '').toLowerCase()) {
    case 'available':
    case 'ready':
      return 'READY';
    case 'busy':
    case 'on_call':
      return 'ON_CALL';
    case 'away':
      return 'AWAY';
    default:
      return 'OFFLINE';
  }
}

/** A buyer's daily cap, or null when it has none. */
export function buyerCap(
  capConsumedToday: number,
  dailyCapSum: number
): { atCap: boolean; capUsed: number; capMax: number | null } {
  const capMax = dailyCapSum > 0 ? dailyCapSum : null;
  return {
    atCap: capMax !== null && capConsumedToday >= capMax,
    capUsed: capConsumedToday,
    capMax,
  };
}

export type TodayBuyerRow = AgencyLiveBoardRow & {
  atCap: boolean;
  capUsed: number;
  capMax: number | null;
};

export interface TodayAttentionItem {
  kind: 'returns' | 'buyers_at_cap' | 'agents_blocked' | 'payouts_owed';
  count: number;
  href: string;
  label: string;
  /** Dollars. On `payouts_owed` only. */
  amount?: number;
}

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
  buyers: TodayBuyerRow[];
  attention: TodayAttentionItem[];
}

export type WhiteLabelTodayDeps = {
  prisma: Pick<
    PrismaClient,
    | 'tenant'
    | 'buyer'
    | 'buyerEndpoint'
    | 'call'
    | 'insuranceCarrierApplication'
    | 'accrualLedger'
    | 'publisher'
    | 'publisherPayment'
    | 'user'
    | 'campaignAgent'
  >;
  now?: Date;
  /** The roster's reader; a test passes its own. */
  readStatuses?: (userIds: string[]) => Promise<Map<string, string>>;
};

/** The whole Today answer for one tenant, uncached. */
export async function getWhiteLabelToday(
  tenantId: string,
  deps: WhiteLabelTodayDeps
): Promise<WhiteLabelToday> {
  const { prisma } = deps;
  const now = deps.now ?? new Date();
  const statusesOf = deps.readStatuses ?? readStatuses;

  const [board, sales, payouts, buyers, dailyCaps, agents, returnsOpen] = await Promise.all([
    getAgencyLiveBoard(tenantId, { prisma, now }),
    getCallSalesSummary(tenantId, resolvePeriod('TODAY', { now }), { prisma }),
    getPayoutsSummary(prisma, tenantId, resolvePeriod('THIS_MONTH', { now })),
    prisma.buyer.findMany({
      where: { tenantId },
      select: { id: true, status: true, stats: { select: { capConsumedToday: true } } },
    }),
    prisma.buyerEndpoint.groupBy({
      by: ['buyerId'],
      where: { buyer: { tenantId }, status: 'ACTIVE', capPeriod: 'DAY' },
      _sum: { maxCap: true },
    }),
    prisma.user.findMany({
      where: { tenantId, status: 'ACTIVE', roles: { some: { role: { name: 'AGENT' } } } },
      select: { id: true, ...AGENT_BLOCKER_SELECT },
    }),
    prisma.call.count({ where: { tenantId, disputeStatus: OPEN_DISPUTE } }),
  ]);

  /* ── Buyers ─────────────────────────────────────────────────────────────── */

  const capSum = new Map(dailyCaps.map(row => [row.buyerId, row._sum.maxCap ?? 0]));
  const capOf = new Map(
    buyers.map(buyer => [
      buyer.id,
      buyerCap(buyer.stats?.capConsumedToday ?? 0, capSum.get(buyer.id) ?? 0),
    ])
  );
  const activeBuyers = buyers.filter(buyer => buyer.status === 'ACTIVE');
  const buyersAtCap = activeBuyers.filter(buyer => capOf.get(buyer.id)?.atCap === true).length;

  const buyerRows: TodayBuyerRow[] = board.rows
    .filter(row => row.kind === 'buyer')
    .map(row => ({ ...row, ...(capOf.get(row.id) ?? buyerCap(0, 0)) }));

  /* ── Agents ─────────────────────────────────────────────────────────────── */

  const agentIds = agents.map(agent => agent.id);
  const [statuses, assignments] = await Promise.all([
    statusesOf(agentIds),
    agentIds.length === 0
      ? Promise.resolve([] as Array<{ userId: string; _count: { _all: number } }>)
      : prisma.campaignAgent.groupBy({
          by: ['userId'],
          where: { tenantId, userId: { in: agentIds }, status: 'ACTIVE' },
          _count: { _all: true },
        }),
  ]);
  const campaignCount = new Map(assignments.map(row => [row.userId, row._count._all]));

  let agentsReady = 0;
  let agentsOnCall = 0;
  let agentsBlocked = 0;
  for (const agent of agents) {
    const presence = agentPresence(statuses.get(agent.id));
    if (presence === 'READY') agentsReady++;
    if (presence === 'ON_CALL') agentsOnCall++;
    if (agentBlocker(agent, campaignCount.get(agent.id) ?? 0) !== null) agentsBlocked++;
  }

  /* ── Needs attention, in the order the screen lists it ──────────────────── */

  const attention: TodayAttentionItem[] = [];
  if (returnsOpen > 0) {
    attention.push({
      kind: 'returns',
      count: returnsOpen,
      href: '/buyers?tab=returns',
      label: 'Returns waiting for a decision',
    });
  }
  if (buyersAtCap > 0) {
    attention.push({
      kind: 'buyers_at_cap',
      count: buyersAtCap,
      href: '/buyers',
      label: "Buyers at today's cap",
    });
  }
  if (agentsBlocked > 0) {
    attention.push({
      kind: 'agents_blocked',
      count: agentsBlocked,
      href: '/agents?tab=roster',
      label: "Agents who can't take calls",
    });
  }
  if (payouts.totals.payable > 0) {
    attention.push({
      kind: 'payouts_owed',
      count: payouts.totals.payableCalls,
      href: '/publishers?tab=payouts',
      label: 'Owed to publishers',
      amount: payouts.totals.payable,
    });
  }

  return {
    now: {
      callsUp: board.totals.callsInFlight,
      agentsReady,
      agentsOnCall,
      agentsActive: agents.length,
      buyersTaking: activeBuyers.length - buyersAtCap,
      buyersAtCap,
      buyersActive: activeBuyers.length,
      returnsOpen,
    },
    today: {
      inbound: sales.totals.inboundCalls,
      answeredByAgents: sales.totals.answeredByAgents,
      sentToBuyers: sales.totals.sentToBuyers,
      unanswered: sales.disposition.unanswered,
      blocked: sales.totals.blocked,
      revenue: sales.totals.revenue,
      profit: sales.totals.profit,
      applications: board.totals.applicationsToday,
      closingPct: board.totals.closingPct,
    },
    buyers: buyerRows,
    attention,
  };
}

// eslint-disable-next-line @typescript-eslint/require-await -- plugin signature
export async function registerWhiteLabelTodayRoutes(fastify: FastifyInstance): Promise<void> {
  const prisma = getPrismaClient();

  fastify.get(
    '/api/v1/white-label/today',
    { preHandler: [authenticate, requireWhiteLabelOperator] },
    async (request, reply) => {
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;

      const key = todayCacheKey(tenantId);

      try {
        const cached = await getRedisClient().get(key);
        if (cached) return reply.send({ data: JSON.parse(cached) as WhiteLabelToday });
      } catch (error) {
        logger.warn({ msg: 'white-label today: cache read failed; reading the database', error });
      }

      const data = await getWhiteLabelToday(tenantId, { prisma });

      try {
        await getRedisClient().set(key, JSON.stringify(data), 'EX', TODAY_CACHE_TTL_SECONDS);
      } catch (error) {
        logger.warn({ msg: 'white-label today: cache write failed', error });
      }

      return reply.send({ data });
    }
  );
}
