/**
 * Today: a white-label agency's whole operation on one screen.
 *
 *   GET /api/v1/white-label/today?period=TODAY|YESTERDAY|LAST_7_DAYS
 *
 * ── The period ───────────────────────────────────────────────────────────────
 *
 * New York calendar days, like every other day in the product. TODAY is the
 * default. Each period answers with the same shape:
 *
 *   today        the period's totals (named for the default period)
 *   comparison   the same totals for what the period is measured against:
 *                TODAY against yesterday up to the same clock time,
 *                YESTERDAY against the day before, LAST_7_DAYS (today and the
 *                six days before it) against the seven days before those
 *   byHour       where the period's calls went, one row per hour (TODAY and
 *                YESTERDAY: 24 rows) or per day (LAST_7_DAYS: 7 rows), each
 *                with the comparison's total for the same slot
 *   trend        the last seven days ending today, one row per day, whatever
 *                the period: the sparklines under the hero figures
 *
 * The "now" block, the buyers' caps, the agents who can't take calls, the
 * returns waiting and what is owed to publishers are about this instant and do
 * not change with the period.
 *
 * ── Built from what already answers each question ────────────────────────────
 *
 * Nothing here computes a figure another screen already computes. Each number
 * comes from the function behind the screen it summarises, so Today can never
 * disagree with the page it links to:
 *
 *   calls up                          getAgencyLiveBoard      (the Live Board)
 *   applications, closing             the Live Board's own    (deliveredCallWhere,
 *                                     predicates, over the     submittedApplicationWhere)
 *                                     period
 *   inbound, answered, sent, revenue  getCallSalesSummary     (Revenue, same range)
 *   agents ready / on a call          readStatuses            (the Agents roster)
 *   agents who can't take calls       agentBlocker            (the Agents roster)
 *   owed to publishers                getPayoutsSummary       (Payouts, net payable
 *                                                              over all time: what
 *                                                              is owed now)
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
 * Per tenant and period, in Redis, because the screen polls and every figure
 * above is a handful of queries. Fifteen seconds is well inside how stale a "right now"
 * tile may be. The cache is an optimisation and never a dependency: a Redis
 * read or write that fails is logged and the answer comes from the database.
 */

import { agentLiveStatus, type AgentLiveStatus } from '@hopwhistle/shared';
import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { OPEN_DISPUTE } from '../lib/dispute-status.js';
import { logger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';
import { resolveTenant } from '../lib/tenant-context.js';
import { requireWhiteLabelOperator } from '../lib/white-label.js';
import { authenticate } from '../middleware/auth.js';
import type { ResolvedPeriod } from '../services/leaderboard/period.js';
import { getAgencyLiveBoard, type AgencyLiveBoardRow } from '../services/live/agency-board.js';
import { closing } from '../services/live/platform-board.js';
import {
  calendarDayBounds,
  calendarDayOf,
  calendarHourOf,
  currentCalendarDay,
  shiftCalendarDay,
  type CalendarDayKey,
} from '../services/rating/calendar-day.js';
import { deliveredCallWhere, submittedApplicationWhere } from '../services/rating/measurement.js';
import { getRedisClient } from '../services/redis.js';
import { ALL_TIME, salesCallWhere } from '../services/reporting/call-money.js';
import { getCallSalesSummary, type CallSalesSummary } from '../services/reporting/call-sales.js';

import { AGENT_BLOCKER_SELECT, agentBlocker, readStatuses } from './agent-roster.js';
import { getPayoutsSummary } from './payouts.js';

export const TODAY_CACHE_TTL_SECONDS = 15;

/** The periods Today can be read over. */
export const TODAY_PERIODS = ['TODAY', 'YESTERDAY', 'LAST_7_DAYS'] as const;
export type TodayPeriod = (typeof TODAY_PERIODS)[number];

export function isTodayPeriod(value: unknown): value is TodayPeriod {
  return typeof value === 'string' && (TODAY_PERIODS as readonly string[]).includes(value);
}

export function todayCacheKey(tenantId: string, period: TodayPeriod = 'TODAY'): string {
  return `wl:today:${tenantId}:${period}`;
}

export type AgentPresence = AgentLiveStatus;

/**
 * The softphone's status string, as the Today screen groups it -- the shared
 * rule in `@hopwhistle/shared`, so Today and the web roster chips agree
 * ('on-call' and 'on_call' are both on a call, 'dnd' is away).
 */
export function agentPresence(status: string | null | undefined): AgentPresence {
  return agentLiveStatus(status);
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
  /**
   * The period's calls, billable calls and what they sold for, from the same
   * call-sales summary as the tiles (`byBuyer`); 0 for a buyer with none.
   * Buyers write no applications here, so these are the columns that say
   * something -- applicationsToday and closingPct stay for older clients.
   */
  calls: number;
  billable: number;
  revenue: number;
};

export interface TodayPublisherRow {
  publisherId: string;
  publisherName: string;
  calls: number;
  billable: number;
  /** Billable over calls, 0-100; null with no calls. */
  billablePct: number | null;
  payout: number;
  profit: number;
}

export interface TodayAttentionItem {
  kind: 'returns' | 'buyers_at_cap' | 'agents_blocked' | 'payouts_owed';
  count: number;
  href: string;
  label: string;
  /** Dollars. On `payouts_owed` only. */
  amount?: number;
}

/** The totals every period is measured by, and its comparison with it. */
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
  /** Mean connected seconds over the calls somebody answered; null with none. */
  avgCallSeconds: number | null;
}

/**
 * One slot of "Calls by hour": an hour (0-23, New York) for a one-day period,
 * a calendar day for LAST_7_DAYS. `comparison` is the comparison period's
 * inbound calls in the same slot -- the same hour the day before, or the same
 * position in the seven days before.
 */
export interface TodayBucket {
  hour: number | null;
  day: CalendarDayKey | null;
  agents: number;
  buyers: number;
  unanswered: number;
  blocked: number;
  comparison: number;
}

export interface TodayTrendRow {
  day: CalendarDayKey;
  inbound: number;
  revenue: number;
  profit: number;
  applications: number;
}

export interface WhiteLabelToday {
  generatedAt: string;
  period: {
    key: TodayPeriod;
    label: string;
    from: CalendarDayKey;
    to: CalendarDayKey;
  };
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
  /** The selected period's totals. Named for the default period. */
  today: TodayTotals;
  comparison: TodayTotals & {
    /** What it is: "same time yesterday", "the day before", "the previous 7 days". */
    label: string;
    from: CalendarDayKey;
    to: CalendarDayKey;
  };
  byHour: TodayBucket[];
  trend: TodayTrendRow[];
  /** Every active agent's live presence, ready first. The "Live now" dots. */
  agents: Array<{ id: string; name: string; presence: AgentPresence }>;
  /** Why the agents who can't take calls can't, most common first. */
  agentBlockers: Array<{ code: string; reason: string; count: number }>;
  returnsWaiting: { count: number; oldestAt: string | null };
  owedToPublishers: { amount: number; publishers: number; calls: number };
  buyers: TodayBuyerRow[];
  publishers: TodayPublisherRow[];
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
  period?: TodayPeriod;
  /** The roster's reader; a test passes its own. */
  readStatuses?: (userIds: string[]) => Promise<Map<string, string>>;
};

/* ── Ranges ─────────────────────────────────────────────────────────────────── */

/** A span of calendar days as the call-sales summary reads one. */
function daysSpan(
  from: CalendarDayKey,
  to: CalendarDayKey,
  label: string,
  endExclusive?: Date
): ResolvedPeriod {
  const start = calendarDayBounds(from).start;
  const end = endExclusive ?? calendarDayBounds(to).endExclusive;
  return {
    key: 'CUSTOM',
    label,
    from,
    to,
    days: Math.round((calendarDayBounds(to).endExclusive.getTime() - start.getTime()) / 86_400_000),
    complete: end.getTime() >= calendarDayBounds(to).endExclusive.getTime(),
    start,
    endExclusive: end,
  };
}

/**
 * The period, what it is compared with, and the range the comparison line on
 * the chart is drawn from.
 *
 * TODAY's comparison stops at the same clock time yesterday, so a morning is
 * never compared with a whole day; the dashed line is the whole of yesterday,
 * so the owner can see what the rest of the day looked like.
 */
export function todayRanges(
  period: TodayPeriod,
  now: Date
): { current: ResolvedPeriod; comparison: ResolvedPeriod; line: ResolvedPeriod } {
  const today = currentCalendarDay(now);
  const yesterday = shiftCalendarDay(today, -1);
  switch (period) {
    case 'TODAY': {
      const elapsed = now.getTime() - calendarDayBounds(today).start.getTime();
      const yesterdayBounds = calendarDayBounds(yesterday);
      const cutoff = new Date(
        Math.min(yesterdayBounds.start.getTime() + elapsed, yesterdayBounds.endExclusive.getTime())
      );
      return {
        current: daysSpan(today, today, 'Today'),
        comparison: daysSpan(yesterday, yesterday, 'same time yesterday', cutoff),
        line: daysSpan(yesterday, yesterday, 'Yesterday'),
      };
    }
    case 'YESTERDAY': {
      const before = shiftCalendarDay(today, -2);
      const dayBefore = daysSpan(before, before, 'the day before');
      return {
        current: daysSpan(yesterday, yesterday, 'Yesterday'),
        comparison: dayBefore,
        line: dayBefore,
      };
    }
    case 'LAST_7_DAYS': {
      const previous = daysSpan(
        shiftCalendarDay(today, -13),
        shiftCalendarDay(today, -7),
        'the previous 7 days'
      );
      return {
        current: daysSpan(shiftCalendarDay(today, -6), today, 'Last 7 days'),
        comparison: previous,
        line: previous,
      };
    }
  }
}

/** The calendar days of a span, in order. */
function daysOf(span: ResolvedPeriod): CalendarDayKey[] {
  const days: CalendarDayKey[] = [];
  for (let day = span.from; day <= span.to; day = shiftCalendarDay(day, 1)) days.push(day);
  return days;
}

type BucketCall = {
  createdAt: Date;
  answeredByUserId: string | null;
  buyerId: string | null;
  blocked: boolean;
};

/**
 * Which of the four a call went to, one each, for a stacked bar. Blocked first
 * (nobody was offered it), then your agents, then a buyer.
 */
export function outcomeOf(call: BucketCall): 'agents' | 'buyers' | 'unanswered' | 'blocked' {
  if (call.blocked) return 'blocked';
  if (call.answeredByUserId !== null) return 'agents';
  if (call.buyerId !== null) return 'buyers';
  return 'unanswered';
}

/** "Calls by hour": 24 hours for a one-day period, one row per day for seven. */
export function bucketCalls(
  period: TodayPeriod,
  current: ResolvedPeriod,
  line: ResolvedPeriod,
  calls: readonly BucketCall[],
  lineCalls: readonly BucketCall[]
): TodayBucket[] {
  const byDay = period === 'LAST_7_DAYS';
  const slots: TodayBucket[] = byDay
    ? daysOf(current).map(day => ({ hour: null, day, ...EMPTY_SLOT }))
    : Array.from({ length: 24 }, (_, hour) => ({ hour, day: null, ...EMPTY_SLOT }));

  const currentDays = daysOf(current);
  const lineDays = daysOf(line);
  const slotOf = (call: BucketCall, days: CalendarDayKey[]): number =>
    byDay ? days.indexOf(calendarDayOf(call.createdAt)) : calendarHourOf(call.createdAt);

  for (const call of calls) {
    const slot = slots[slotOf(call, currentDays)];
    if (slot) slot[outcomeOf(call)]++;
  }
  for (const call of lineCalls) {
    const slot = slots[slotOf(call, lineDays)];
    if (slot) slot.comparison++;
  }
  return slots;
}

const EMPTY_SLOT = { agents: 0, buyers: 0, unanswered: 0, blocked: 0, comparison: 0 };

/* ── The answer ────────────────────────────────────────────────────────────── */

/** The whole Today answer for one tenant and period, uncached. */
export async function getWhiteLabelToday(
  tenantId: string,
  deps: WhiteLabelTodayDeps
): Promise<WhiteLabelToday> {
  const { prisma } = deps;
  const now = deps.now ?? new Date();
  const period = deps.period ?? 'TODAY';
  const statusesOf = deps.readStatuses ?? readStatuses;

  const { current, comparison, line } = todayRanges(period, now);
  const today = currentCalendarDay(now);
  const trendSpan = daysSpan(shiftCalendarDay(today, -6), today, 'Last 7 days');

  const bucketSelect = { createdAt: true, answeredByUserId: true, buyerId: true, blocked: true };

  /** The totals over one range: the sales summary plus the Live Board's two counts. */
  async function totalsOver(range: ResolvedPeriod, sales?: CallSalesSummary): Promise<TodayTotals> {
    const [summary, delivered, applications, talk] = await Promise.all([
      sales ?? getCallSalesSummary(tenantId, range, { prisma }),
      prisma.call.count({ where: deliveredCallWhere(tenantId, range) }),
      prisma.insuranceCarrierApplication.count({
        where: submittedApplicationWhere(tenantId, range),
      }),
      prisma.call.aggregate({
        where: { ...salesCallWhere(tenantId, range), connectedDuration: { gt: 0 } },
        _avg: { connectedDuration: true },
      }),
    ]);
    const avg = talk._avg.connectedDuration;
    return {
      inbound: summary.totals.inboundCalls,
      answeredByAgents: summary.totals.answeredByAgents,
      sentToBuyers: summary.totals.sentToBuyers,
      unanswered: summary.disposition.unanswered,
      blocked: summary.totals.blocked,
      billable: summary.totals.billable,
      revenue: summary.totals.revenue,
      profit: summary.totals.profit,
      applications,
      closingPct: closing(applications, delivered),
      avgCallSeconds: avg === null ? null : Math.round(avg),
    };
  }

  const [
    board,
    sales,
    trendSales,
    payouts,
    buyers,
    dailyCaps,
    agents,
    returnsOpen,
    oldestReturn,
    periodCalls,
    lineCalls,
    trendApplications,
  ] = await Promise.all([
    getAgencyLiveBoard(tenantId, { prisma, now }),
    getCallSalesSummary(tenantId, current, { prisma }),
    period === 'LAST_7_DAYS' ? null : getCallSalesSummary(tenantId, trendSpan, { prisma }),
    getPayoutsSummary(prisma, tenantId, ALL_TIME),
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
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        ...AGENT_BLOCKER_SELECT,
      },
      orderBy: [{ firstName: 'asc' }, { email: 'asc' }],
    }),
    prisma.call.count({ where: { tenantId, disputeStatus: OPEN_DISPUTE } }),
    prisma.call.findFirst({
      where: { tenantId, disputeStatus: OPEN_DISPUTE },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
    prisma.call.findMany({ where: salesCallWhere(tenantId, current), select: bucketSelect }),
    prisma.call.findMany({ where: salesCallWhere(tenantId, line), select: bucketSelect }),
    prisma.insuranceCarrierApplication.findMany({
      where: submittedApplicationWhere(tenantId, trendSpan),
      select: { submittedAt: true },
    }),
  ]);

  const [periodTotals, comparisonTotals] = await Promise.all([
    totalsOver(current, sales),
    totalsOver(comparison),
  ]);

  /* ── Trend: the last seven days, whatever the period ────────────────────── */

  const trendDays = (trendSales ?? sales).byDay;
  const dayRow = new Map(trendDays.map(row => [row.day, row]));
  const applicationsOn = new Map<string, number>();
  for (const application of trendApplications) {
    if (!application.submittedAt) continue;
    const day = calendarDayOf(application.submittedAt);
    applicationsOn.set(day, (applicationsOn.get(day) ?? 0) + 1);
  }
  const trend: TodayTrendRow[] = daysOf(trendSpan).map(day => ({
    day,
    inbound: dayRow.get(day)?.inbound ?? 0,
    revenue: dayRow.get(day)?.revenue ?? 0,
    profit: dayRow.get(day)?.profit ?? 0,
    applications: applicationsOn.get(day) ?? 0,
  }));

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

  const salesOf = new Map(sales.byBuyer.map(row => [row.buyerId, row]));
  const buyerRows: TodayBuyerRow[] = board.rows
    .filter(row => row.kind === 'buyer')
    .map(row => ({
      ...row,
      ...(capOf.get(row.id) ?? buyerCap(0, 0)),
      calls: salesOf.get(row.id)?.calls ?? 0,
      billable: salesOf.get(row.id)?.billable ?? 0,
      revenue: salesOf.get(row.id)?.revenue ?? 0,
    }))
    .sort((a, b) => b.revenue - a.revenue || b.calls - a.calls || a.name.localeCompare(b.name));

  const publisherRows: TodayPublisherRow[] = sales.byPublisher.map(row => ({
    publisherId: row.publisherId,
    publisherName: row.publisherName,
    calls: row.calls,
    billable: row.billable,
    billablePct: row.calls > 0 ? Math.round((row.billable / row.calls) * 10000) / 100 : null,
    payout: row.payout,
    profit: row.profit,
  }));

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
  const blockers = new Map<string, { code: string; reason: string; count: number }>();
  const presence: WhiteLabelToday['agents'] = [];
  for (const agent of agents) {
    const live = agentPresence(statuses.get(agent.id));
    if (live === 'READY') agentsReady++;
    if (live === 'ON_CALL') agentsOnCall++;
    presence.push({
      id: agent.id,
      name: [agent.firstName, agent.lastName].filter(Boolean).join(' ') || agent.email,
      presence: live,
    });
    const blocked = agentBlocker(agent, campaignCount.get(agent.id) ?? 0);
    if (blocked !== null) {
      agentsBlocked++;
      const entry = blockers.get(blocked.code) ?? { ...blocked, count: 0 };
      entry.count++;
      blockers.set(blocked.code, entry);
    }
  }
  const PRESENCE_ORDER: AgentPresence[] = ['READY', 'ON_CALL', 'AWAY', 'OFFLINE'];
  presence.sort((a, b) => PRESENCE_ORDER.indexOf(a.presence) - PRESENCE_ORDER.indexOf(b.presence));

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
  /*
   * What is owed now, whenever the calls came in, net of the returns waiting
   * to come out of the next payment: the Payouts screen's `netPayable`, summed
   * over every publisher. This month's gross read as "owed" while last month's
   * unpaid calls fell off it on the 1st.
   */
  if (payouts.totals.netPayable > 0) {
    attention.push({
      kind: 'payouts_owed',
      count: payouts.totals.payableCalls,
      href: '/publishers?tab=payouts',
      label: 'Owed to publishers',
      amount: payouts.totals.netPayable,
    });
  }

  return {
    generatedAt: now.toISOString(),
    period: { key: period, label: current.label, from: current.from, to: current.to },
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
    today: periodTotals,
    comparison: {
      ...comparisonTotals,
      label: comparison.label,
      from: comparison.from,
      to: comparison.to,
    },
    byHour: bucketCalls(period, current, line, periodCalls, lineCalls),
    trend,
    agents: presence,
    agentBlockers: [...blockers.values()].sort(
      (a, b) => b.count - a.count || a.reason.localeCompare(b.reason)
    ),
    returnsWaiting: {
      count: returnsOpen,
      oldestAt: oldestReturn?.createdAt.toISOString() ?? null,
    },
    owedToPublishers: {
      amount: Math.max(0, payouts.totals.netPayable),
      publishers: payouts.publishers.filter(row => row.netPayable > 0).length,
      calls: payouts.totals.payableCalls,
    },
    buyers: buyerRows,
    publishers: publisherRows,
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

      const requested = (request.query as { period?: unknown } | undefined)?.period ?? 'TODAY';
      if (!isTodayPeriod(requested)) {
        return reply.code(400).send({
          error: {
            code: 'INVALID_PERIOD',
            message: `period must be one of ${TODAY_PERIODS.join(', ')}`,
          },
        });
      }
      const period = requested;
      const key = todayCacheKey(tenantId, period);

      try {
        const cached = await getRedisClient().get(key);
        if (cached) return reply.send({ data: JSON.parse(cached) as WhiteLabelToday });
      } catch (error) {
        logger.warn({ msg: 'white-label today: cache read failed; reading the database', error });
      }

      const data = await getWhiteLabelToday(tenantId, { prisma, period });

      try {
        await getRedisClient().set(key, JSON.stringify(data), 'EX', TODAY_CACHE_TTL_SECONDS);
      } catch (error) {
        logger.warn({ msg: 'white-label today: cache write failed', error });
      }

      return reply.send({ data });
    }
  );
}
