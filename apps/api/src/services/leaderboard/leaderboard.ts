/**
 * The agency leaderboard: one agency's own agents, ranked, over any period.
 *
 * ── Per agency, and only ever one ────────────────────────────────────────────
 *
 * Every query below carries a `tenantId` and there is no cross-agency read in
 * this file. Two agencies running side by side produce two independent boards,
 * and an agent on one never appears on the other's. The cross-agency view is
 * `getPlatformOverview` in `services/billing/delivery-view.ts`, it is gated on
 * the platform-admin capability, and nothing here reaches it.
 *
 * ── Everyone in the agency can read it, and that is the point ────────────────
 *
 * This is the one agency screen an AGENT sees other agents' numbers on, which
 * is a deliberate departure from `/delivery/agents` (principal only) and it is
 * worth saying why the departure is safe.
 *
 * `/delivery/agents` is principal-only because of the screen it sits on: the
 * one that explains what the agency is CHARGED. Rates, balances, the Daily
 * Block, the overrun and tonight's projected debit are commercial terms between
 * NetEnroll and the agency's owner, and an agent holding a token in the tenant
 * had no business reading them.
 *
 * None of that is here. This module loads no rate, no balance, no credit, no
 * settlement and no charge -- that is a property of the queries below, not of
 * how the client renders them. What it carries is PRODUCTION: calls taken,
 * dials made, applications written, premium written, time on the phone. That
 * is what a sales floor has posted on the wall, and a leaderboard nobody can
 * see their colleagues on is not a leaderboard.
 *
 * ── Two fractions, kept apart on purpose ─────────────────────────────────────
 *
 *   closingPct      applications / delivered calls, the PRICED figure, computed
 *                   from `deliveredCallWhere` and `submittedApplicationWhere`
 *                   verbatim so it cannot drift from the number the agency's
 *                   rate is set on.
 *
 *   conversionPct   applications / UNIQUE inbound callers, the figure the floor
 *                   asked for. Higher than the closing percentage by
 *                   construction, because the denominator is smaller.
 *
 * Both are on every row. Showing only the second would put a number next to the
 * words "conversion" that is not the number the agency is billed on, on a
 * screen forty people read daily -- and the first time somebody compared it
 * with their invoice the board would lose its credibility and take the
 * invoice's with it.
 *
 * ── What "unique" means, and why the agency total is not the sum ─────────────
 *
 * A unique caller is one ANI, normalised to its last ten digits so
 * `+15125550101`, `15125550101` and `5125550101` are one person. A call with no
 * caller id at all counts as its own opportunity: we cannot prove it was a
 * repeat, and the alternative -- collapsing every anonymous call into one --
 * would shrink the denominator and inflate conversion rates. Where the
 * arithmetic can go either way it goes the way that does not flatter anybody.
 *
 * The consequence is that the agency's unique-caller count is NOT the sum of
 * its agents'. One person who rings twice and reaches two different agents is
 * two agent-opportunities and one agency-opportunity. So the agency figure is
 * measured with its own query rather than summed from the rows, and the
 * agency's conversion rate is therefore never reproducible by adding up the
 * board. That is a real property of the measurement, not a rounding error.
 */

import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

import { getPrismaClient } from '../../lib/prisma.js';
import {
  type CalendarDayKey,
  calendarDayBounds,
  calendarDayOf,
  currentCalendarDay,
  previousCalendarDay,
  shiftCalendarDay,
} from '../rating/calendar-day.js';
import { submittedApplicationWhere, type InstantRange } from '../rating/measurement.js';
import { toNumber } from '../rating/rate-curve.js';

import { previousPeriodOf, type ResolvedPeriod } from './period.js';
import {
  awardBadges,
  BADGES,
  conversionPctOf,
  movementOf,
  POINTS,
  rankRows,
  type ScoreBreakdown,
  scoreOf,
  STREAK_BADGE_DAYS,
  streakOf,
} from './scoring.js';

/**
 * How far back streaks and records are read.
 *
 * Bounded rather than all-time for two reasons. A streak is a chain ending
 * today, so anything older than the longest chain anybody could still be on is
 * dead weight on every request. And an agency record set two years ago by
 * somebody who has left is not something the current floor can chase -- a
 * record nobody can beat is a scoreboard that has stopped being a game.
 */
const STREAK_LOOKBACK_DAYS = 90;

/* ── What a row carries ────────────────────────────────────────────────────── */

export interface LeaderboardRow {
  /** Null on the single unattributed row. See the header of `rankRows`. */
  userId: string | null;
  name: string;
  email: string | null;

  /** Rank by points. Null for the unattributed row, which is not a person. */
  rank: number | null;
  points: number;
  pointsBreakdown: ScoreBreakdown;
  /** Places climbed since the previous period. Null if unranked in either. */
  movement: number | null;
  previousRank: number | null;

  /** Delivered calls: inbound, answered by this agent, not blocked. */
  inboundCalls: number;
  /** Distinct callers behind those calls. The conversion denominator. */
  uniqueInboundCallers: number;
  /** Outbound calls this agent placed. */
  outboundCalls: number;
  /** Those that connected. */
  outboundConnected: number;
  /** Connect rate on the agent's own dialling. Null with no dials. */
  outboundConnectPct: number | null;

  applications: number;
  annualizedPremium: number;

  /** applications / unique inbound callers. Null with no opportunities. */
  conversionPct: number | null;
  /** applications / delivered calls: the priced figure. Null with no calls. */
  closingPct: number | null;

  /** Connected seconds on inbound calls. */
  talkTimeSeconds: number;
  /** Self-reported payroll hours over the period. Null when never recorded. */
  hoursWorked: number | null;
  /** Talk time over recorded hours. Null without hours to divide by. */
  occupancyPct: number | null;
  /** Applications per recorded hour. Null without hours to divide by. */
  applicationsPerHour: number | null;

  /** Consecutive days with business written, ending today. Not period-scoped. */
  streakDays: number;
  /** This agent's best single day in the lookback, and when. */
  personalBest: { applications: number; day: CalendarDayKey } | null;
  /** Badge ids held for this period. See `BADGES`. */
  badges: string[];
}

export interface LeaderboardTotals {
  inboundCalls: number;
  uniqueInboundCallers: number;
  outboundCalls: number;
  outboundConnected: number;
  applications: number;
  annualizedPremium: number;
  talkTimeSeconds: number;
  conversionPct: number | null;
  closingPct: number | null;
}

export interface LeaderboardRecord {
  userId: string;
  name: string;
  applications: number;
  day: CalendarDayKey;
}

export interface Leaderboard {
  period: {
    key: ResolvedPeriod['key'];
    label: string;
    from: CalendarDayKey;
    to: CalendarDayKey;
    days: number;
    complete: boolean;
  };
  previousPeriod: { label: string; from: CalendarDayKey; to: CalendarDayKey };
  agency: LeaderboardTotals;
  /**
   * The previous period's agency totals, and the change.
   *
   * `change` is null while this period is still open, because a partial period
   * compared with a whole one always reads as a collapse. See
   * `ResolvedPeriod.complete`.
   */
  previousAgency: LeaderboardTotals;
  agencyChange: { applications: number; inboundCalls: number; annualizedPremium: number } | null;
  rows: LeaderboardRow[];
  /** The agency's best single day by one agent, in the lookback. */
  records: {
    bestDay: LeaderboardRecord | null;
    longestStreak: { userId: string; name: string; days: number } | null;
  };
  /** Where the caller stands. `row` is null when they had no activity. */
  you: { userId: string; rank: number | null; row: LeaderboardRow | null } | null;
  /** The scoring rules, served so the screen can show its own working. */
  scoring: {
    points: typeof POINTS;
    badges: typeof BADGES;
    streakBadgeDays: number;
    lookbackDays: number;
  };
}

/* ── The reads ─────────────────────────────────────────────────────────────── */

interface InboundRow {
  userId: string | null;
  inboundCalls: number;
  uniqueInboundCallers: number;
  talkTimeSeconds: number;
}

interface OutboundRow {
  userId: string | null;
  outboundCalls: number;
  outboundConnected: number;
}

/**
 * The distinct-caller key, as SQL.
 *
 * Kept in one string because it appears in the per-agent read and the agency
 * read, and the two counting the same caller differently would make the board
 * fail to reconcile in a way nobody could see.
 *
 * `RIGHT(digits, 10)` normalises `+1512...`, `1512...` and `512...` to one
 * person. A row with no digits at all falls back to its own call id, so it
 * counts as one opportunity rather than merging with every other anonymous
 * call -- see the header.
 */
const CALLER_KEY = `CASE
        WHEN regexp_replace(COALESCE(c."callerId", ''), '\\D', '', 'g') = ''
          THEN 'call:' || c."id"
        ELSE 'ani:' || RIGHT(regexp_replace(c."callerId", '\\D', '', 'g'), 10)
      END`;

/**
 * The delivered-call predicate, as SQL, built once.
 *
 * ── It is `deliveredCallWhere` and it must stay that way ─────────────────────
 *
 * `services/rating/measurement.ts` defines a delivered call -- inbound,
 * answered in the window, not blocked -- and says that nothing in this codebase
 * may redefine either side of the closing percentage. This is that predicate
 * expressed in SQL, because `COUNT(DISTINCT ...)` over a normalised caller id
 * is not expressible through Prisma's query API and the count has to happen in
 * the database (see `inboundByAgent`).
 *
 * Two expressions of one definition is a drift risk, and it is guarded rather
 * than hoped about: `__tests__/leaderboard-measurement.test.ts` reads
 * `deliveredCallWhere` and fails if its shape changes without this changing
 * with it. The failure mode being guarded against is quiet -- the board would
 * simply start reporting a different closing percentage from the delivery
 * screen, for the same agent on the same day, and the first person to notice
 * would be an agency disputing their invoice.
 *
 * Nested as a `Prisma.Sql` fragment so the tenant id and both instants stay
 * bound parameters.
 */
export function deliveredCallSql(tenantId: string, range: InstantRange): Prisma.Sql {
  return Prisma.sql`c."tenantId" = ${tenantId}
       AND c."direction" = 'INBOUND'
       AND c."blocked" = false
       AND c."answeredAt" >= ${range.start}
       AND c."answeredAt" < ${range.endExclusive}`;
}

/**
 * Delivered calls per agent, with the distinct-caller count.
 *
 * Raw SQL for one reason: `COUNT(DISTINCT ...)` over a normalised expression is
 * not expressible in Prisma's query API, and the alternative -- grouping by
 * `(agent, callerId)` and counting rows in JS -- ships one row per caller per
 * agent to the API process. Over `THIS_YEAR` on a floor taking 450 calls a day
 * that is six figures of rows to answer a question Postgres answers with a
 * count.
 *
 * The predicate is `deliveredCallWhere` transcribed, and the test asserts the
 * two agree. It could not simply be handed to Prisma here, but it must not
 * diverge: the moment this counts a different set of calls, an agent's closing
 * percentage on the board stops matching the one on the delivery screen.
 */
async function inboundByAgent(
  prisma: PrismaClient,
  tenantId: string,
  range: InstantRange
): Promise<InboundRow[]> {
  return prisma.$queryRaw<InboundRow[]>`
    SELECT c."answeredByUserId" AS "userId",
           COUNT(*)::int AS "inboundCalls",
           COUNT(DISTINCT ${Prisma.raw(CALLER_KEY)})::int AS "uniqueInboundCallers",
           COALESCE(SUM(c."connectedDuration"), 0)::int AS "talkTimeSeconds"
      FROM "calls" c
     WHERE ${deliveredCallSql(tenantId, range)}
     GROUP BY c."answeredByUserId"
  `;
}

/** The same measurement for the agency as a whole. Never the sum of the rows. */
async function inboundForAgency(
  prisma: PrismaClient,
  tenantId: string,
  range: InstantRange
): Promise<Omit<InboundRow, 'userId'>> {
  const rows = await prisma.$queryRaw<Array<Omit<InboundRow, 'userId'>>>`
    SELECT COUNT(*)::int AS "inboundCalls",
           COUNT(DISTINCT ${Prisma.raw(CALLER_KEY)})::int AS "uniqueInboundCallers",
           COALESCE(SUM(c."connectedDuration"), 0)::int AS "talkTimeSeconds"
      FROM "calls" c
     WHERE ${deliveredCallSql(tenantId, range)}
  `;

  return rows[0] ?? { inboundCalls: 0, uniqueInboundCallers: 0, talkTimeSeconds: 0 };
}

/**
 * Outbound dialling per agent.
 *
 * ── Attributed and timed differently from inbound, deliberately ──────────────
 *
 * An inbound call belongs to the agent who ANSWERED it (`answeredByUserId`) at
 * the moment they picked up (`answeredAt`). An outbound call has no such
 * moment: most of them are never answered by anybody, and the agent is the one
 * who PLACED it (`createdById`, written by the softphone originate handler) at
 * the moment they dialled (`createdAt`).
 *
 * Timing outbound by `answeredAt` would silently drop every dial that rang out
 * -- which is most of them -- and a dialling column that counts only connects
 * is not a dialling column. `outboundConnected` is that figure, kept separate.
 *
 * ── It is never in the closing percentage ────────────────────────────────────
 *
 * `measurement.ts` excludes outbound from the priced denominator in so many
 * words: an agency's own dialling is its business and rating it would raise its
 * price. Nothing here changes that. Outbound is on the board because the floor
 * works it and the effort should be visible, and it scores a single point per
 * connect for the same reason.
 */
async function outboundByAgent(
  prisma: PrismaClient,
  tenantId: string,
  range: InstantRange
): Promise<OutboundRow[]> {
  return prisma.$queryRaw<OutboundRow[]>`
    SELECT c."createdById" AS "userId",
           COUNT(*)::int AS "outboundCalls",
           (COUNT(*) FILTER (WHERE c."answeredAt" IS NOT NULL))::int AS "outboundConnected"
      FROM "calls" c
     WHERE c."tenantId" = ${tenantId}
       AND c."direction" = 'OUTBOUND'
       AND c."blocked" = false
       AND c."createdAt" >= ${range.start}
       AND c."createdAt" < ${range.endExclusive}
     GROUP BY c."createdById"
  `;
}

/** What one period yields before hours, streaks and badges are layered on. */
interface PeriodMetrics {
  byUser: Map<
    string | null,
    {
      inboundCalls: number;
      uniqueInboundCallers: number;
      talkTimeSeconds: number;
      outboundCalls: number;
      outboundConnected: number;
      applications: number;
      annualizedPremium: number;
    }
  >;
  agency: LeaderboardTotals;
}

function emptyMetrics() {
  return {
    inboundCalls: 0,
    uniqueInboundCallers: 0,
    talkTimeSeconds: 0,
    outboundCalls: 0,
    outboundConnected: 0,
    applications: 0,
    annualizedPremium: 0,
  };
}

/**
 * Every per-agent figure for one instant range, plus the agency's own.
 *
 * Run twice per request -- once for the period on screen, once for the one
 * before it, which is what makes rank movement possible. The previous run's
 * result is used for nothing but ranks.
 */
async function collectMetrics(
  prisma: PrismaClient,
  tenantId: string,
  range: InstantRange
): Promise<PeriodMetrics> {
  const [inbound, outbound, applications, agencyInbound, agencyApplications] = await Promise.all([
    inboundByAgent(prisma, tenantId, range),
    outboundByAgent(prisma, tenantId, range),
    prisma.insuranceCarrierApplication.groupBy({
      by: ['createdById'],
      // The Phase 2 predicate verbatim, so a voided application leaves the
      // board on exactly the terms it leaves the agency's numerator.
      where: submittedApplicationWhere(tenantId, range),
      _count: { _all: true },
      _sum: { annualizedPremium: true },
    }),
    inboundForAgency(prisma, tenantId, range),
    prisma.insuranceCarrierApplication.count({
      where: submittedApplicationWhere(tenantId, range),
    }),
  ]);

  const byUser = new Map<string | null, ReturnType<typeof emptyMetrics>>();
  const at = (userId: string | null) => {
    const existing = byUser.get(userId);
    if (existing) return existing;
    const created = emptyMetrics();
    byUser.set(userId, created);
    return created;
  };

  for (const row of inbound) {
    const entry = at(row.userId);
    entry.inboundCalls = row.inboundCalls;
    entry.uniqueInboundCallers = row.uniqueInboundCallers;
    entry.talkTimeSeconds = row.talkTimeSeconds;
  }

  for (const row of outbound) {
    /*
     * An outbound call with no `createdById` is a system-originated dial -- an
     * AI campaign, an importer -- not an agent's work. It joins the
     * unattributed row rather than being dropped, so the agency's outbound
     * total still reconciles with what the rows show.
     */
    const entry = at(row.userId);
    entry.outboundCalls = row.outboundCalls;
    entry.outboundConnected = row.outboundConnected;
  }

  for (const row of applications) {
    const entry = at(row.createdById);
    entry.applications = row._count._all;
    entry.annualizedPremium =
      row._sum.annualizedPremium === null ? 0 : toNumber(row._sum.annualizedPremium);
  }

  let outboundCalls = 0;
  let outboundConnected = 0;
  let annualizedPremium = 0;
  for (const entry of byUser.values()) {
    outboundCalls += entry.outboundCalls;
    outboundConnected += entry.outboundConnected;
    annualizedPremium += entry.annualizedPremium;
  }

  return {
    byUser,
    agency: {
      inboundCalls: agencyInbound.inboundCalls,
      uniqueInboundCallers: agencyInbound.uniqueInboundCallers,
      talkTimeSeconds: agencyInbound.talkTimeSeconds,
      outboundCalls,
      outboundConnected,
      applications: agencyApplications,
      annualizedPremium,
      conversionPct: conversionPctOf(agencyApplications, agencyInbound.uniqueInboundCallers),
      closingPct:
        agencyInbound.inboundCalls > 0
          ? (agencyApplications / agencyInbound.inboundCalls) * 100
          : null,
    },
  };
}

/* ── Streaks and records ───────────────────────────────────────────────────── */

interface StreakData {
  streakByUser: Map<string, number>;
  bestDayByUser: Map<string, { applications: number; day: CalendarDayKey }>;
  bestDay: { userId: string; applications: number; day: CalendarDayKey } | null;
}

/**
 * Daily application counts over the lookback, bucketed into calendar days.
 *
 * ── Why the bucketing is in TypeScript and not in SQL ────────────────────────
 *
 * `date_trunc('day', "submittedAt" AT TIME ZONE 'America/New_York')` would do
 * this in one statement and it is deliberately not used. `calendar-day.ts`
 * states that nothing else in this codebase may introduce a second timezone
 * assumption, and a timezone name written into a SQL string is exactly that --
 * one that no test of the day boundary would ever catch, and that would drift
 * the first time the platform's clock was reconsidered.
 *
 * So the rows come back as instants and `calendarDayOf` -- the one function
 * that knows what day an instant falls on -- buckets them. The cost is the rows
 * themselves: 90 days of one agency's applications, which is hundreds, not
 * millions. `submittedAt` is indexed per tenant.
 */
async function loadStreaks(
  prisma: PrismaClient,
  tenantId: string,
  today: CalendarDayKey
): Promise<StreakData> {
  const from = shiftCalendarDay(today, -(STREAK_LOOKBACK_DAYS - 1));
  const range = {
    start: calendarDayBounds(from).start,
    endExclusive: calendarDayBounds(today).endExclusive,
  };

  const rows = await prisma.insuranceCarrierApplication.findMany({
    where: submittedApplicationWhere(tenantId, range),
    select: { createdById: true, submittedAt: true },
  });

  /** user -> day -> count */
  const perUserPerDay = new Map<string, Map<CalendarDayKey, number>>();

  for (const row of rows) {
    if (!row.createdById || !row.submittedAt) continue;
    const day = calendarDayOf(row.submittedAt);
    const days = perUserPerDay.get(row.createdById) ?? new Map<CalendarDayKey, number>();
    days.set(day, (days.get(day) ?? 0) + 1);
    perUserPerDay.set(row.createdById, days);
  }

  const streakByUser = new Map<string, number>();
  const bestDayByUser = new Map<string, { applications: number; day: CalendarDayKey }>();
  let bestDay: StreakData['bestDay'] = null;

  for (const [userId, days] of perUserPerDay) {
    streakByUser.set(userId, streakOf(days.keys(), today, previousCalendarDay));

    let best: { applications: number; day: CalendarDayKey } | null = null;
    for (const [day, applications] of days) {
      // Ties go to the EARLIER day: a record is held by whoever set it first.
      if (
        !best ||
        applications > best.applications ||
        (applications === best.applications && day < best.day)
      ) {
        best = { applications, day };
      }
    }
    if (best) {
      bestDayByUser.set(userId, best);
      if (
        !bestDay ||
        best.applications > bestDay.applications ||
        (best.applications === bestDay.applications && best.day < bestDay.day)
      ) {
        bestDay = { userId, ...best };
      }
    }
  }

  return { streakByUser, bestDayByUser, bestDay };
}

/* ── Assembly ──────────────────────────────────────────────────────────────── */

export interface LeaderboardOptions {
  prisma?: PrismaClient;
  now?: Date;
  /** The signed-in agent, so the board can say where they stand. */
  viewerId?: string | null;
}

export async function getLeaderboard(
  tenantId: string,
  period: ResolvedPeriod,
  options: LeaderboardOptions = {}
): Promise<Leaderboard> {
  const prisma = options.prisma ?? getPrismaClient();
  const now = options.now ?? new Date();
  const today = currentCalendarDay(now);
  const previous = previousPeriodOf(period, { now });

  const [current, priorMetrics, users, streaks] = await Promise.all([
    collectMetrics(prisma, tenantId, period),
    collectMetrics(prisma, tenantId, previous),
    prisma.user.findMany({
      where: { tenantId },
      select: { id: true, email: true, firstName: true, lastName: true },
    }),
    loadStreaks(prisma, tenantId, today),
  ]);

  const byId = new Map(users.map(user => [user.id, user]));
  const tenantUserIds = new Set(users.map(user => user.id));

  /*
   * Hours SUMMED across the period, and narrowed to this agency's users in the
   * QUERY rather than after it. `time_entries` has no tenant column -- it hangs
   * off the user -- so a group-by filtered on dates alone would read every
   * agency's payroll and discard the rest in the API process. That is a
   * cross-tenant read whether or not the extra rows are used, and this module
   * does not make one.
   *
   * It is also why this is a second round trip rather than a fifth entry in the
   * Promise.all above: the user ids are the filter, so they have to be known
   * first.
   */
  const timeEntries = await prisma.timeEntry.groupBy({
    by: ['userId'],
    where: {
      userId: { in: [...tenantUserIds] },
      date: { gte: period.start, lt: period.endExclusive },
    },
    _sum: { hoursWorked: true },
  });

  const hoursByUser = new Map<string, number | null>(
    timeEntries.map(entry => [
      entry.userId,
      entry._sum.hoursWorked === null ? null : toNumber(entry._sum.hoursWorked),
    ])
  );

  function nameOf(userId: string | null): string {
    if (!userId) return 'Unattributed';
    const user = byId.get(userId);
    return [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || userId;
  }

  /* The previous period's ranks, which is all the second read is for. */
  const previousRanks = new Map<string, number>();
  {
    const scored = [...priorMetrics.byUser.entries()].map(([userId, metrics]) => {
      const conversionPct = conversionPctOf(metrics.applications, metrics.uniqueInboundCallers);
      return {
        userId,
        name: nameOf(userId),
        points: scoreOf({ ...metrics, conversionPct }).total,
        applications: metrics.applications,
        uniqueInboundCallers: metrics.uniqueInboundCallers,
      };
    });
    for (const row of rankRows(scored)) {
      if (row.userId && row.rank !== null) previousRanks.set(row.userId, row.rank);
    }
  }

  /* This period's rows. */
  const scored = [...current.byUser.entries()].map(([userId, metrics]) => {
    const conversionPct = conversionPctOf(metrics.applications, metrics.uniqueInboundCallers);
    const pointsBreakdown = scoreOf({ ...metrics, conversionPct });
    const hoursWorked = userId ? (hoursByUser.get(userId) ?? null) : null;

    return {
      userId,
      name: nameOf(userId),
      email: userId ? (byId.get(userId)?.email ?? null) : null,
      ...metrics,
      conversionPct,
      closingPct:
        metrics.inboundCalls > 0 ? (metrics.applications / metrics.inboundCalls) * 100 : null,
      outboundConnectPct:
        metrics.outboundCalls > 0
          ? (metrics.outboundConnected / metrics.outboundCalls) * 100
          : null,
      hoursWorked,
      occupancyPct:
        hoursWorked && hoursWorked > 0
          ? (metrics.talkTimeSeconds / (hoursWorked * 3600)) * 100
          : null,
      applicationsPerHour:
        hoursWorked && hoursWorked > 0 ? metrics.applications / hoursWorked : null,
      streakDays: userId ? (streaks.streakByUser.get(userId) ?? 0) : 0,
      personalBest: userId ? (streaks.bestDayByUser.get(userId) ?? null) : null,
      points: pointsBreakdown.total,
      pointsBreakdown,
    };
  });

  const ranked = rankRows(scored).map(row => ({
    ...row,
    previousRank: row.userId ? (previousRanks.get(row.userId) ?? null) : null,
    movement: movementOf(row.rank, row.userId ? (previousRanks.get(row.userId) ?? null) : null),
  }));

  const badges = awardBadges(ranked);

  const rows: LeaderboardRow[] = ranked.map(row => ({
    ...row,
    badges: row.userId ? (badges.get(row.userId) ?? []) : [],
  }));

  /* The longest active streak on the floor, for the records strip. */
  let longestStreak: Leaderboard['records']['longestStreak'] = null;
  for (const [userId, days] of streaks.streakByUser) {
    if (days < STREAK_BADGE_DAYS) continue;
    if (!tenantUserIds.has(userId)) continue;
    if (!longestStreak || days > longestStreak.days) {
      longestStreak = { userId, name: nameOf(userId), days };
    }
  }

  const viewerId = options.viewerId ?? null;
  const viewerRow = viewerId ? (rows.find(row => row.userId === viewerId) ?? null) : null;

  return {
    period: {
      key: period.key,
      label: period.label,
      from: period.from,
      to: period.to,
      days: period.days,
      complete: period.complete,
    },
    previousPeriod: { label: previous.label, from: previous.from, to: previous.to },
    agency: current.agency,
    previousAgency: priorMetrics.agency,
    /*
     * Only for a period that has closed. A Tuesday-morning `THIS_WEEK` against
     * the whole of last week is guaranteed to read as a collapse, and a board
     * that tells everybody they are down 80% every Monday is a board nobody
     * reads twice.
     */
    agencyChange: period.complete
      ? {
          applications: current.agency.applications - priorMetrics.agency.applications,
          inboundCalls: current.agency.inboundCalls - priorMetrics.agency.inboundCalls,
          annualizedPremium:
            current.agency.annualizedPremium - priorMetrics.agency.annualizedPremium,
        }
      : null,
    rows,
    records: {
      bestDay: streaks.bestDay
        ? {
            userId: streaks.bestDay.userId,
            name: nameOf(streaks.bestDay.userId),
            applications: streaks.bestDay.applications,
            day: streaks.bestDay.day,
          }
        : null,
      longestStreak,
    },
    you: viewerId ? { userId: viewerId, rank: viewerRow?.rank ?? null, row: viewerRow } : null,
    scoring: {
      points: POINTS,
      badges: BADGES,
      streakBadgeDays: STREAK_BADGE_DAYS,
      lookbackDays: STREAK_LOOKBACK_DAYS,
    },
  };
}
