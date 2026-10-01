/**
 * Today, as one agent sees it.
 *
 *   GET /api/v1/agent/today?period=TODAY|YESTERDAY|LAST_7_DAYS
 *
 * The white-label owner's Today is the agency's whole operation: inbound
 * calls, revenue, profit, buyers, publishers. This is the same screen for the
 * person on the phones -- their calls, their applications, their closing, their
 * follow-ups -- built so that nothing the owner's version carries about money
 * or counterparties can reach it.
 *
 * ── Whose ────────────────────────────────────────────────────────────────────
 *
 * Two arguments, and both come from the authenticated principal: the acting
 * tenant (`resolveTenant`) and the user id (`getActingUserId`). The route takes
 * no agent id, from the query string or anywhere else, so there is no request
 * that reads somebody else's day. Every query below carries both, the tenant
 * filter first. A platform operator previewing an agency as AGENT is narrowed
 * to their own user id, which owns nothing in it -- the honest rendering of
 * "what an agent sees", as `lib/agent-scope.ts` explains.
 *
 * ── What it will not carry ───────────────────────────────────────────────────
 *
 * No revenue, profit, payout, cost, rate, balance or billing term, and no
 * buyer, publisher or routing detail. Not hidden by the screen: never loaded.
 * The one agency figure is the agency's closing percentage over the same
 * window, the benchmark the agent is measured against; it is an aggregate and
 * names nobody. The standing block is the agent's own leaderboard position and
 * the points gap to the place above -- not who holds it.
 *
 * ── Built from what already answers each question ────────────────────────────
 *
 *   calls answered, talk time   deliveredCallWhere + answeredByUserId  (as /delivery/me)
 *   applications                submittedApplicationWhere + createdById
 *   time available              availableSecondsByUser                  (as /delivery/me)
 *   agency closing              deliveredCallWhere / submittedApplicationWhere, agency-wide
 *   follow-ups due              getFollowUpsDue                         (the CRM's tile)
 *   recent calls                answeredByUserId                        (the Calls rule)
 *   standing                    getLeaderboard, viewer = the caller     (the Leaderboard)
 *   periods                     todayRanges                             (the owner's Today)
 */

import type { PrismaClient } from '@prisma/client';

import { getPrismaClient } from '../../lib/prisma.js';
import { todayRanges, type TodayPeriod } from '../../routes/white-label-today.js';
import {
  agentTrend,
  availableSecondsByUser,
  type AgentDayFigures,
} from '../billing/delivery-view.js';
import { getFollowUpsDue, type FollowUpDueRow } from '../crm-pipeline.js';
import { getLeaderboard } from '../leaderboard/leaderboard.js';
import { resolvePeriod, type ResolvedPeriod } from '../leaderboard/period.js';
import { closing } from '../live/platform-board.js';
import {
  calendarDayOf,
  calendarHourOf,
  currentCalendarDay,
  shiftCalendarDay,
  type CalendarDayKey,
} from '../rating/calendar-day.js';
import { deliveredCallWhere, submittedApplicationWhere } from '../rating/measurement.js';

/** One window of the agent's own work. No money. */
export interface AgentTotals {
  callsAnswered: number;
  applications: number;
  /** Applications over calls answered, 0-100. Null with no calls: not 0%. */
  closingPct: number | null;
  talkTimeSeconds: number;
  /** Mean connected seconds per answered call. Null with no calls. */
  averageCallSeconds: number | null;
}

export interface AgentTodaySummary extends AgentTotals {
  /** Seconds recorded available on the queue. Null when nothing was recorded. */
  availableSeconds: number | null;
  /** Follow-ups due today or overdue, right now, whatever the period. */
  followUpsDue: number;
}

/** One slot of "Your production": an hour (one-day periods) or a day (seven). */
export interface AgentBucket {
  hour: number | null;
  day: CalendarDayKey | null;
  callsAnswered: number;
  applications: number;
}

export interface AgentAttentionItem extends FollowUpDueRow {
  kind: 'follow_up_overdue' | 'follow_up_due';
}

export interface AgentRecentCall {
  id: string;
  /** When it was answered, or created for a call with no answer time. */
  at: string;
  caller: string | null;
  direction: string;
  connectedSeconds: number | null;
  disposition: string | null;
  /** A submitted, non-voided application was written on this call. */
  application: boolean;
}

export interface AgentStanding {
  /** Null when the agent has no ranked activity in the period. */
  rank: number | null;
  /** How many people are ranked on the board. */
  ranked: number;
  points: number;
  /** Inbound calls answered in the period, as the board counts them. */
  calls: number;
  applications: number;
  closingPct: number | null;
  /** The place directly above and how many points short of it. Null at #1. */
  next: { rank: number; pointsBehind: number } | null;
}

export interface AgentToday {
  generatedAt: string;
  period: {
    key: TodayPeriod;
    label: string;
    from: CalendarDayKey;
    to: CalendarDayKey;
    /** False while the period is still running. */
    complete: boolean;
  };
  summary: AgentTodaySummary;
  /**
   * The same totals over what the period is measured against: TODAY against
   * yesterday up to the same clock time, YESTERDAY against the day before,
   * LAST_7_DAYS against the seven days before. Like for like, so a morning is
   * never compared with a whole day.
   */
  comparison: AgentTotals & { label: string };
  /** The agency's closing percentage over the same window. An aggregate. */
  agencyBenchmark: { closingPct: number | null };
  /** The agent's last seven days, oldest first, ending today: the sparklines. */
  trend: AgentDayFigures[];
  byHour: AgentBucket[];
  attention: AgentAttentionItem[];
  recentCalls: AgentRecentCall[];
  standing: AgentStanding | null;
}

export interface AgentTodayDeps {
  prisma?: PrismaClient;
  now?: Date;
  period?: TodayPeriod;
  /** States a state-restricted agent may work; undefined when unrestricted. */
  licensedStates?: string[];
}

type Range = { start: Date; endExclusive: Date };

async function totalsOver(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
  range: Range
): Promise<AgentTotals> {
  const [calls, applications] = await Promise.all([
    prisma.call.aggregate({
      where: { ...deliveredCallWhere(tenantId, range), answeredByUserId: userId },
      _count: { _all: true },
      _sum: { connectedDuration: true },
    }),
    prisma.insuranceCarrierApplication.count({
      where: { ...submittedApplicationWhere(tenantId, range), createdById: userId },
    }),
  ]);
  const callsAnswered = calls._count._all;
  const talkTimeSeconds = calls._sum.connectedDuration ?? 0;
  return {
    callsAnswered,
    applications,
    closingPct: closing(applications, callsAnswered),
    talkTimeSeconds,
    averageCallSeconds: callsAnswered > 0 ? Math.round(talkTimeSeconds / callsAnswered) : null,
  };
}

function daysOf(from: CalendarDayKey, to: CalendarDayKey): CalendarDayKey[] {
  const days: CalendarDayKey[] = [];
  for (let day = from; day <= to; day = shiftCalendarDay(day, 1)) days.push(day);
  return days;
}

/** The leaderboard period that measures the same window as this one. */
function boardPeriod(period: TodayPeriod, now: Date): ResolvedPeriod {
  if (period === 'LAST_7_DAYS') {
    const today = currentCalendarDay(now);
    return resolvePeriod('CUSTOM', { now, from: shiftCalendarDay(today, -6), to: today });
  }
  return resolvePeriod(period, { now });
}

async function standingOf(
  prisma: PrismaClient,
  tenantId: string,
  userId: string,
  period: TodayPeriod,
  now: Date
): Promise<AgentStanding | null> {
  const board = await getLeaderboard(tenantId, boardPeriod(period, now), {
    prisma,
    now,
    viewerId: userId,
  });
  const you = board.you;
  if (!you) return null;
  const ranked = board.rows.filter(row => row.rank !== null);
  const rank = you.rank;
  const row = you.row;

  let next: AgentStanding['next'] = null;
  if (rank !== null && rank > 1 && row) {
    // The nearest place above: the lowest-ranked row still ahead on points.
    const above = ranked.filter(r => r.rank !== null && r.rank < rank && r.points > row.points);
    const nearest = above[above.length - 1];
    if (nearest && nearest.rank !== null) {
      next = {
        rank: nearest.rank,
        pointsBehind: Math.round((nearest.points - row.points) * 10) / 10,
      };
    }
  }

  return {
    rank,
    ranked: ranked.length,
    points: row?.points ?? 0,
    calls: row?.inboundCalls ?? 0,
    applications: row?.applications ?? 0,
    closingPct: row?.closingPct ?? null,
    next,
  };
}

/** The whole agent Today answer for one agent in one agency. */
export async function getAgentToday(
  tenantId: string,
  userId: string,
  deps: AgentTodayDeps = {}
): Promise<AgentToday> {
  const prisma = deps.prisma ?? getPrismaClient();
  const now = deps.now ?? new Date();
  const period = deps.period ?? 'TODAY';
  const { current, comparison } = todayRanges(period, now);
  const today = currentCalendarDay(now);
  const byDay = period === 'LAST_7_DAYS';

  const [
    summary,
    compared,
    agencyDelivered,
    agencyApplications,
    available,
    trend,
    periodCalls,
    periodApplications,
    followUps,
    recent,
    standing,
  ] = await Promise.all([
    totalsOver(prisma, tenantId, userId, current),
    totalsOver(prisma, tenantId, userId, comparison),
    prisma.call.count({ where: deliveredCallWhere(tenantId, current) }),
    prisma.insuranceCarrierApplication.count({
      where: submittedApplicationWhere(tenantId, current),
    }),
    availableSecondsByUser(prisma, [userId], current, now),
    agentTrend(prisma, tenantId, userId, today),
    prisma.call.findMany({
      where: { ...deliveredCallWhere(tenantId, current), answeredByUserId: userId },
      select: { answeredAt: true },
    }),
    prisma.insuranceCarrierApplication.findMany({
      where: { ...submittedApplicationWhere(tenantId, current), createdById: userId },
      select: { submittedAt: true },
    }),
    getFollowUpsDue(
      { tenantId, agentId: userId, licensedStates: deps.licensedStates },
      { now, take: 5 }
    ),
    prisma.call.findMany({
      where: {
        tenantId,
        answeredByUserId: userId,
        createdAt: { gte: current.start, lt: current.endExclusive },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 5,
      select: {
        id: true,
        createdAt: true,
        answeredAt: true,
        callerId: true,
        toNumber: true,
        direction: true,
        connectedDuration: true,
        disposition: true,
      },
    }),
    standingOf(prisma, tenantId, userId, period, now),
  ]);

  /* ── Your production, by hour or by day ─────────────────────────────────── */

  const slots: AgentBucket[] = byDay
    ? daysOf(current.from, current.to).map(day => ({
        hour: null,
        day,
        callsAnswered: 0,
        applications: 0,
      }))
    : Array.from({ length: 24 }, (_, hour) => ({
        hour,
        day: null,
        callsAnswered: 0,
        applications: 0,
      }));
  const dayIndex = new Map(slots.map((slot, i) => [slot.day, i]));
  const slotFor = (at: Date): AgentBucket | undefined =>
    byDay ? slots[dayIndex.get(calendarDayOf(at)) ?? -1] : slots[calendarHourOf(at)];
  for (const call of periodCalls) {
    if (call.answeredAt) {
      const slot = slotFor(call.answeredAt);
      if (slot) slot.callsAnswered++;
    }
  }
  for (const application of periodApplications) {
    if (application.submittedAt) {
      const slot = slotFor(application.submittedAt);
      if (slot) slot.applications++;
    }
  }

  /* ── Recent calls: which of them carry an application ───────────────────── */

  const withApplication = new Set(
    recent.length === 0
      ? []
      : (
          await prisma.insuranceCarrierApplication.findMany({
            where: {
              tenantId,
              callId: { in: recent.map(call => call.id) },
              submittedAt: { not: null },
              voidedAt: null,
            },
            select: { callId: true },
          })
        ).map(row => row.callId)
  );

  return {
    generatedAt: now.toISOString(),
    period: {
      key: period,
      label: current.label,
      from: current.from,
      to: current.to,
      complete: current.complete,
    },
    summary: {
      ...summary,
      availableSeconds: available.get(userId) ?? null,
      followUpsDue: followUps.count,
    },
    comparison: { ...compared, label: comparison.label },
    agencyBenchmark: { closingPct: closing(agencyApplications, agencyDelivered) },
    trend,
    byHour: slots,
    attention: followUps.rows.map(row => ({
      ...row,
      kind: row.overdue ? 'follow_up_overdue' : 'follow_up_due',
    })),
    recentCalls: recent.map(call => ({
      id: call.id,
      at: (call.answeredAt ?? call.createdAt).toISOString(),
      // The customer's side: who rang in, or who was dialled.
      caller: call.direction === 'OUTBOUND' ? call.toNumber : call.callerId,
      direction: call.direction,
      connectedSeconds: call.connectedDuration,
      disposition: call.disposition,
      application: withApplication.has(call.id),
    })),
    standing,
  };
}
