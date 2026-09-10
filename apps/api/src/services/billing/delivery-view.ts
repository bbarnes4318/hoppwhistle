/**
 * What the portal shows: the agency principal's live panel, the per-agent
 * table, and the cross-agency view.
 *
 * ── Two closing percentages, and they are not the same number ────────────────
 *
 * This is the thing most likely to start an argument, so it is the thing this
 * module is most careful about. `todayClosingPct` moves all day and prices
 * nothing. `windowClosingPct` is the trailing Delivery Day window that actually
 * set the rate now in force. They are separate fields with separate names, they
 * are rendered apart in the portal, and neither is ever computed from the
 * other. An agency that reads the first as the second thinks its price changed
 * at 10am.
 *
 * The same care applies to the two rates: `currentRate` is what is being paid
 * today; `trackingRate` is what tomorrow would be if today closed now, and it
 * is explicitly provisional.
 *
 * ── Every figure is server-derived ───────────────────────────────────────────
 *
 * Nothing here reads an amount, a rate or a quantity from a request. The
 * projected charge is computed from the ledger and the rating engine, and the
 * only inputs from the caller are which agency (from the authenticated
 * principal) and which calendar day.
 *
 * ── Nulls, not fabricated zeroes ─────────────────────────────────────────────
 *
 * A closing percentage with no delivered calls behind it is null, never 0%. A
 * rate under review is null, never $0. An agent whose working hours were not
 * recorded has a null occupancy, never 0%. This is a screen somebody decides
 * who to coach and what they will be charged from, and a zero that means "we do
 * not know" is worse than an absent number.
 */

import type { Prisma, PrismaClient } from '@prisma/client';
import { CreditLedgerEntryType, SettlementPaymentStatus } from '@prisma/client';

import { logger } from '../../lib/logger.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { calendarDayBounds, currentCalendarDay } from '../rating/calendar-day.js';
import type { CalendarDayKey } from '../rating/calendar-day.js';
import {
  deliveredCallWhere,
  measureCalendarDay,
  submittedApplicationWhere,
} from '../rating/measurement.js';
import { effectiveRate, rateFor, toNumber, toRateCurve } from '../rating/rate-curve.js';
import type { CurveAnchor, RateCurve } from '../rating/rate-curve.js';
import { getRatingSummary } from '../rating/rating-summary.js';
import { getRedisClient } from '../redis.js';

import { creditBalance, ledgerCountsForDay } from './credit-ledger.js';
import { evaluateDeliveryGate } from './delivery-gate.js';
import type { DeliveryGateDecision } from './delivery-gate.js';
import {
  ceilingFor,
  consecutiveCleanSettlements,
  isEnrolledForBilling,
  overrunCeilingApplications,
} from './terms.js';

export interface DeliveryTodayView {
  tenantId: string;
  calendarDay: CalendarDayKey;
  timeZone: string;

  /**
   * Whether this agency is in the billing system at all.
   *
   * False means every figure below is a zero rather than a measurement, and the
   * portal says "not enrolled" instead of showing an agency with no credit.
   */
  enrolled: boolean;
  /** Whether an enrolled agency's settlements actually charge. */
  chargesEnabled: boolean;

  /** Calls NetEnroll routed to this agency today, answered or not. */
  callsRouted: number;
  /**
   * Calls connected to an agent right now.
   *
   * Answered and not yet ended. This is the only figure on the panel that is
   * about this instant rather than about the day, which is why it is named for
   * it: a principal watching the queue wants to know whether the floor is busy,
   * and the day's totals cannot tell them.
   */
  callsInProgress: number;
  /**
   * Calls an agent picked up. This is the delivered-call count -- the
   * denominator of the closing percentage -- and it is deliberately reported
   * next to `callsRouted` so the two are never confused for one another.
   */
  callsAnswered: number;
  applicationsSubmitted: number;

  /** Today so far. Moves all day; prices nothing. */
  todayClosingPct: number | null;
  /** The trailing Delivery Day window that ACTUALLY set the rate in force. */
  windowClosingPct: number | null;
  windowDayKeys: CalendarDayKey[];
  windowDaysFound: number;
  windowDeliveryDays: number;

  /**
   * Dollars per submitted application, today. Null under review -- not zero.
   *
   * EFFECTIVE: the curve's answer plus this agency's rate offset. The two
   * halves are below, so the panel can show what makes up the price. There is
   * no fee line and no percentage on top of a total anywhere on this panel.
   */
  currentRate: number | null;
  /** The curve's own answer for the rate in force, when the curve set it. */
  curveRate: number | null;
  /** The agency's rate offset in dollars. Zero unless one was agreed. */
  rateOffset: number;
  /** What tomorrow is tracking toward. Provisional, and effective. */
  trackingRate: number | null;
  trackingBelowMinimum: boolean;

  /** Unused paid applications: what is left on the block. */
  applicationsRemainingOnBlock: number;
  dailyBlockApplications: number;
  applicationsConsumedToday: number;

  overrunToday: number;
  /** What today's overrun will cost tonight, at the rate tonight will use. */
  overrunAmountTonight: number | null;
  overrunCeiling: number;
  /** Ceiling minus overrun used. Zero means delivery has stopped for today. */
  distanceToCeiling: number;

  /** Overrun tonight plus the next block, at the tracking rate. Provisional. */
  projectedTotalCharge: number | null;
  projectedNextBlockQuantity: number;

  delivering: boolean;
  holdReason: DeliveryGateDecision['reason'];
  holdDetail: string | null;
  /** When delivery first stopped today, if it has. */
  holdSince: Date | null;

  mandate: {
    status: string;
    bankName: string | null;
    last4: string | null;
  };
}

/**
 * The shape returned for an agency that is not in the billing system.
 *
 * Every billing figure is zero because none was measured, and `enrolled: false`
 * is what the portal renders instead of the zeroes. Written out so the shape
 * cannot drift from the real view.
 */
const NOT_ENROLLED_VIEW: Omit<
  DeliveryTodayView,
  | 'tenantId'
  | 'calendarDay'
  | 'callsRouted'
  | 'callsInProgress'
  | 'callsAnswered'
  | 'applicationsSubmitted'
  | 'todayClosingPct'
> = {
  timeZone: 'America/New_York',
  enrolled: false,
  chargesEnabled: false,
  windowClosingPct: null,
  windowDayKeys: [],
  windowDaysFound: 0,
  windowDeliveryDays: 0,
  currentRate: null,
  curveRate: null,
  rateOffset: 0,
  trackingRate: null,
  trackingBelowMinimum: false,
  applicationsRemainingOnBlock: 0,
  dailyBlockApplications: 0,
  applicationsConsumedToday: 0,
  overrunToday: 0,
  overrunAmountTonight: null,
  overrunCeiling: 0,
  distanceToCeiling: 0,
  projectedTotalCharge: null,
  projectedNextBlockQuantity: 0,
  delivering: true,
  holdReason: null,
  holdDetail: null,
  holdSince: null,
  mandate: { status: 'NONE', bankName: null, last4: null },
};

/**
 * What "connected to an agent at this instant" means, without the agency.
 *
 * Answered, not ended, and not blocked. Deliberately NOT scoped to today's
 * calendar day: a call that connected at 23:58 and is still up at 00:02 is
 * still in progress, and dropping it because the Delivery Day rolled over would
 * show an empty floor to a principal watching a live one.
 *
 * Exported without the tenant so the cross-agency reading -- "how many agencies
 * are delivering right now" -- can ask it of several tenants in one query
 * rather than restating the predicate. One definition; two scopes.
 */
export const CALL_IN_PROGRESS: Prisma.CallWhereInput = {
  direction: 'INBOUND',
  blocked: false,
  answeredAt: { not: null },
  endedAt: null,
};

/** The same predicate, for one agency. */
function callsInProgressWhere(tenantId: string): Prisma.CallWhereInput {
  return { tenantId, ...CALL_IN_PROGRESS };
}

/**
 * The agency principal's live panel.
 */
export async function getDeliveryToday(
  tenantId: string,
  options: { prisma?: PrismaClient; now?: Date } = {}
): Promise<DeliveryTodayView> {
  const prisma = options.prisma ?? getPrismaClient();
  const now = options.now ?? new Date();
  const today = currentCalendarDay(now);
  const bounds = calendarDayBounds(today);

  /*
   * Not enrolled: none of the rest applies, and computing it anyway would mean
   * loading a rate curve to price an agency that is not being priced. Answered
   * from the two counts that are true regardless -- calls and applications --
   * with every billing figure zero and `enrolled: false` saying why.
   */
  if (!(await isEnrolledForBilling(prisma, tenantId))) {
    const [todayOnly, routedOnly, inProgressOnly] = await Promise.all([
      measureCalendarDay(
        { calls: prisma.call, applications: prisma.insuranceCarrierApplication },
        tenantId,
        today
      ),
      prisma.call.count({
        where: {
          tenantId,
          direction: 'INBOUND',
          blocked: false,
          createdAt: { gte: bounds.start, lt: bounds.endExclusive },
        },
      }),
      prisma.call.count({ where: callsInProgressWhere(tenantId) }),
    ]);

    return {
      ...NOT_ENROLLED_VIEW,
      tenantId,
      calendarDay: today,
      callsRouted: routedOnly,
      // Operational, not billing: an unenrolled agency still runs a floor, and
      // these are the figures that tell them how it is doing.
      callsInProgress: inProgressOnly,
      callsAnswered: todayOnly.deliveredCalls,
      applicationsSubmitted: todayOnly.submittedApplications,
      todayClosingPct: todayOnly.closingPct,
    };
  }

  const [rating, gate, balance, counts, todayMeasurement, routed, inProgress, hold, profile] =
    await Promise.all([
      getRatingSummary(tenantId, { prisma, now }),
      // `record: false` -- reading a screen is not a delivery decision, and a
      // page refresh must not be able to raise a delivery hold event or send a
      // notification.
      evaluateDeliveryGate(tenantId, { prisma, now, record: false }),
      creditBalance(prisma, tenantId),
      ledgerCountsForDay(prisma, tenantId, today),
      measureCalendarDay(
        { calls: prisma.call, applications: prisma.insuranceCarrierApplication },
        tenantId,
        today
      ),
      prisma.call.count({
        where: {
          tenantId,
          direction: 'INBOUND',
          blocked: false,
          createdAt: { gte: bounds.start, lt: bounds.endExclusive },
        },
      }),
      prisma.call.count({ where: callsInProgressWhere(tenantId) }),
      prisma.deliveryHoldEvent.findFirst({
        where: { tenantId, deliveryDay: today },
        orderBy: { occurredAt: 'asc' },
        select: { occurredAt: true },
      }),
      prisma.agencyBillingProfile.findUnique({ where: { tenantId } }),
    ]);

  /*
   * Tonight's rate: the one the settlement will derive, which is the same rate
   * that applies to tomorrow. Falls back to the rate in force when the window
   * is below the minimum, because that is what the settlement itself falls back
   * to -- the projection and the charge must not be computed two ways.
   */
  const tonightRate = rating.trackingRate ?? rating.currentRate;

  const overrunAmountTonight =
    tonightRate === null ? null : Number((counts.overrun * tonightRate).toFixed(2));

  const projectedNextBlockQuantity =
    rating.trackingRate === null
      ? 0
      : Math.max(0, gate.dailyBlockApplications - Math.max(0, balance));

  const projectedTotalCharge =
    tonightRate === null
      ? null
      : Number(
          (
            counts.overrun * tonightRate +
            projectedNextBlockQuantity * (rating.trackingRate ?? 0)
          ).toFixed(2)
        );

  return {
    tenantId,
    calendarDay: today,
    timeZone: 'America/New_York',
    enrolled: gate.enrolled,
    chargesEnabled: profile?.chargesEnabled === true,
    callsRouted: routed,
    callsInProgress: inProgress,
    callsAnswered: todayMeasurement.deliveredCalls,
    applicationsSubmitted: todayMeasurement.submittedApplications,
    todayClosingPct: todayMeasurement.closingPct,
    windowClosingPct: rating.ratingWindow.closingPct,
    windowDayKeys: rating.ratingWindow.dayKeys,
    windowDaysFound: rating.ratingWindow.daysFound,
    windowDeliveryDays: rating.ratingWindow.deliveryDays,
    currentRate: rating.currentRate,
    curveRate: rating.curveRate,
    rateOffset: rating.rateOffset,
    trackingRate: rating.trackingRate,
    trackingBelowMinimum: rating.trackingBelowMinimum,
    applicationsRemainingOnBlock: Math.max(0, balance),
    dailyBlockApplications: gate.dailyBlockApplications,
    applicationsConsumedToday: counts.consumed,
    overrunToday: counts.overrun,
    overrunAmountTonight,
    overrunCeiling: gate.overrunCeiling,
    distanceToCeiling: gate.overrunRemaining,
    projectedTotalCharge,
    projectedNextBlockQuantity,
    delivering: gate.allowed,
    holdReason: gate.reason,
    holdDetail: gate.detail,
    holdSince: hold?.occurredAt ?? null,
    mandate: {
      status: profile?.achMandateStatus ?? 'NONE',
      bankName: profile?.achBankName ?? null,
      last4: profile?.achLast4 ?? null,
    },
  };
}

export interface AgentRow {
  userId: string | null;
  name: string;
  email: string | null;
  callsTaken: number;
  applications: number;
  /**
   * Total annualised premium on those applications, in dollars.
   *
   * The counts drive the price; this is what says whether the production is
   * worth what it costs. Zero for an agent who submitted nothing, and zero for
   * one whose applications all came from the RPA path (which writes no
   * `annualizedPremium`) -- a sum over no premiums, not an absent measurement.
   */
  annualizedPremium: number;
  /** Null when the agent took no calls -- never 0%. */
  closingPct: number | null;
  /** Seconds connected, summed over the day's answered calls. */
  talkTimeSeconds: number;
  /**
   * Seconds spent in the 'available' state today: on the queue, waiting.
   *
   * Null when nothing was recorded for this agent on this day, which is not the
   * same fact as zero. Presence was Redis-only until Phase 4, so every day
   * before that has no transitions to read and reports null.
   */
  availableSeconds: number | null;
  /** When the current status began. Null when it was never recorded. */
  statusSince: Date | null;
  /** Self-reported hours for the day, from the payroll time entry. */
  hoursWorked: number | null;
  /** Talk time as a share of recorded hours. Null when hours are not recorded. */
  occupancyPct: number | null;
  /** Live softphone presence. 'unknown' when Redis could not be read. */
  currentStatus: string;
}

/**
 * How long each agent was in the 'available' state on one day.
 *
 * ── Why this is a span calculation and not a sum ─────────────────────────────
 *
 * `agent_state_events` records TRANSITIONS, not durations. An agent is in a
 * state from the row that set it until the next row, so the time in a state is
 * the sum of those spans clipped to the day being asked about.
 *
 * Two consequences the arithmetic has to respect:
 *
 *   1. The state in force at the START of the day was set by the last row
 *      BEFORE the day, which may be days earlier -- an agent who went available
 *      on Friday and never signed out is available at midnight on Saturday. So
 *      the read looks back past the day's own rows for that one carried row.
 *   2. The final span runs to "now" on today, and to the end of the day on any
 *      past day. Running today's open span to midnight would report an agent
 *      as available for hours they have not worked yet.
 *
 * Returns null for an agent with no rows bearing on the day at all. That is a
 * day nobody measured, and reporting it as zero seconds available would put a
 * coaching decision on a number that was never recorded.
 */
async function availableSecondsByUser(
  prisma: PrismaClient,
  userIds: string[],
  bounds: { start: Date; endExclusive: Date },
  now: Date
): Promise<Map<string, number>> {
  const available = new Map<string, number>();
  if (userIds.length === 0) return available;

  const events = await prisma.agentStateEvent.findMany({
    where: { userId: { in: userIds }, occurredAt: { lt: bounds.endExclusive } },
    orderBy: [{ userId: 'asc' }, { occurredAt: 'asc' }],
    select: { userId: true, status: true, occurredAt: true },
  });

  // The day's span never extends past this instant: an open state on today runs
  // to now, not to midnight.
  const dayEnd = new Date(Math.min(bounds.endExclusive.getTime(), now.getTime()));
  if (dayEnd <= bounds.start) return available;

  const byUser = new Map<string, typeof events>();
  for (const event of events) {
    const list = byUser.get(event.userId);
    if (list) list.push(event);
    else byUser.set(event.userId, [event]);
  }

  for (const [userId, rows] of byUser) {
    let seconds = 0;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].status !== 'available') continue;

      const from = Math.max(rows[i].occurredAt.getTime(), bounds.start.getTime());
      const until = i + 1 < rows.length ? rows[i + 1].occurredAt.getTime() : dayEnd.getTime();
      const to = Math.min(until, dayEnd.getTime());
      if (to > from) seconds += (to - from) / 1000;
    }
    available.set(userId, Math.round(seconds));
  }

  return available;
}

export interface AgentBreakdown {
  calendarDay: CalendarDayKey;
  /**
   * The agency's own closing percentage for the same day -- the reference line
   * the rows are read against.
   *
   * Served with the rows rather than left to the client to sum, for two
   * reasons. It is the agency's Phase 2 measurement, which includes calls no
   * agent is attributed on, so summing the rows would produce a different
   * number. And a browser computing it is a browser computing the figure the
   * agency's price is set from.
   */
  agencyClosingPct: number | null;
  agencyCallsTaken: number;
  agencyApplications: number;
  /** The day's total annualised premium across every agent. */
  agencyAnnualizedPremium: number;
  agents: AgentRow[];
}

/**
 * The per-agent table the principal coaches from.
 *
 * ── Attribution, and the rows that have none ─────────────────────────────────
 *
 * Calls are attributed by `answeredByUserId`, written when the agent answers.
 * Rows written before that column existed were backfilled from the metadata key
 * the answer handler has always set, but a delivered call can still have no
 * agent on it -- a call bridged straight to an external destination, or one
 * whose answer came in through a path that does not know the agent.
 *
 * Those rows are NOT dropped. They appear as a single "unattributed" row, so
 * the table's total reconciles with the agency total on the panel above it. A
 * per-agent table that quietly loses ten percent of the day is a table
 * somebody makes a coaching decision from.
 *
 * Applications are attributed by `createdById`, which is the agent who entered
 * the application.
 */
export async function getAgentBreakdown(
  tenantId: string,
  options: { prisma?: PrismaClient; now?: Date; day?: CalendarDayKey } = {}
): Promise<AgentBreakdown> {
  const prisma = options.prisma ?? getPrismaClient();
  const now = options.now ?? new Date();
  const day = options.day ?? currentCalendarDay(now);
  const bounds = calendarDayBounds(day);

  const [callRows, applicationRows, users, agencyToday] = await Promise.all([
    prisma.call.groupBy({
      by: ['answeredByUserId'],
      // The Phase 2 delivered-call predicate, used verbatim. The per-agent
      // table and the agency's own denominator must be the same definition, or
      // an agent's closing percentage will not add up to the agency's.
      where: deliveredCallWhere(tenantId, bounds),
      _count: { _all: true },
      _sum: { connectedDuration: true },
    }),
    prisma.insuranceCarrierApplication.groupBy({
      by: ['createdById'],
      // The Phase 2 submitted-application predicate, used verbatim, so a voided
      // application leaves the per-agent table on the same terms it leaves the
      // agency's numerator.
      where: submittedApplicationWhere(tenantId, bounds),
      _count: { _all: true },
      _sum: { annualizedPremium: true },
    }),
    prisma.user.findMany({
      where: { tenantId },
      select: { id: true, email: true, firstName: true, lastName: true },
    }),
    /*
     * The agency's own figure for the same day, from the same Phase 2
     * measurement the agents are measured with. It is the reference line the
     * per-agent table is read against -- who is above it and who is dragging it
     * down -- and it is computed here rather than by summing the rows so the
     * two cannot disagree over an unattributed call.
     */
    measureCalendarDay(
      { calls: prisma.call, applications: prisma.insuranceCarrierApplication },
      tenantId,
      day
    ),
  ]);

  const userIds = users.map(u => u.id);

  const timeEntries = await prisma.timeEntry.findMany({
    where: { userId: { in: userIds }, date: bounds.start },
    select: { userId: true, hoursWorked: true },
  });
  const hoursByUser = new Map(timeEntries.map(t => [t.userId, toNumber(t.hoursWorked)]));

  const [presence, availableByUser] = await Promise.all([
    readAgentStatuses(userIds),
    availableSecondsByUser(prisma, userIds, bounds, now),
  ]);
  const statuses = presence.statuses;
  const statusSince = presence.since;

  const applicationsByUser = new Map(
    applicationRows.map(row => [row.createdById, row._count._all])
  );
  const premiumByUser = new Map(
    applicationRows.map(row => [
      row.createdById,
      row._sum.annualizedPremium === null ? 0 : toNumber(row._sum.annualizedPremium),
    ])
  );

  const byUser = new Map(users.map(u => [u.id, u]));

  const rows: AgentRow[] = callRows.map(row => {
    const user = row.answeredByUserId ? byUser.get(row.answeredByUserId) : undefined;
    const calls = row._count._all;
    const applications = row.answeredByUserId
      ? applicationsByUser.get(row.answeredByUserId) ?? 0
      : 0;
    const talkTimeSeconds = row._sum.connectedDuration ?? 0;
    const hoursWorked = row.answeredByUserId ? hoursByUser.get(row.answeredByUserId) ?? null : null;

    return {
      userId: row.answeredByUserId,
      name: row.answeredByUserId
        ? [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
          user?.email ||
          row.answeredByUserId
        : 'Unattributed',
      email: user?.email ?? null,
      callsTaken: calls,
      applications,
      annualizedPremium: row.answeredByUserId
        ? (premiumByUser.get(row.answeredByUserId) ?? 0)
        : 0,
      closingPct: calls > 0 ? (applications / calls) * 100 : null,
      talkTimeSeconds,
      availableSeconds: row.answeredByUserId
        ? availableByUser.get(row.answeredByUserId) ?? null
        : null,
      statusSince: row.answeredByUserId ? statusSince.get(row.answeredByUserId) ?? null : null,
      hoursWorked,
      occupancyPct:
        hoursWorked && hoursWorked > 0 ? (talkTimeSeconds / (hoursWorked * 3600)) * 100 : null,
      currentStatus: row.answeredByUserId
        ? statuses.get(row.answeredByUserId) ?? 'offline'
        : 'n/a',
    };
  });

  /*
   * Agents who submitted an application today but answered no call are still
   * rows: their applications belong to the agency's numerator, and an agent
   * missing from this table entirely reads as an agent who did nothing.
   */
  for (const [userId, applications] of applicationsByUser) {
    if (!userId) continue;
    if (rows.some(r => r.userId === userId)) continue;
    const user = byUser.get(userId);
    const hoursWorked = hoursByUser.get(userId) ?? null;
    rows.push({
      userId,
      name: [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.email || userId,
      email: user?.email ?? null,
      callsTaken: 0,
      applications,
      annualizedPremium: premiumByUser.get(userId) ?? 0,
      closingPct: null,
      talkTimeSeconds: 0,
      availableSeconds: availableByUser.get(userId) ?? null,
      statusSince: statusSince.get(userId) ?? null,
      hoursWorked,
      occupancyPct: hoursWorked && hoursWorked > 0 ? 0 : null,
      currentStatus: statuses.get(userId) ?? 'offline',
    });
  }

  /*
   * Sorted by closing percentage ASCENDING: the agents dragging the agency's
   * rate are at the top, because they are what this table is for.
   *
   * It used to sort descending, which put the best closers first -- a
   * leaderboard rather than a work list, on the one screen whose whole purpose
   * is deciding who to coach or pull off the queue.
   *
   * Two kinds of row are held at the bottom whichever way it is sorted:
   *
   *   The UNATTRIBUTED row. It is delivered calls with no agent recorded on
   *   them, and it usually closes at 0% -- so ascending it would lead the
   *   table. It is not a person, nobody can be coached about it, and it is here
   *   only so the rows reconcile with the agency total. Leading a "who needs
   *   attention" list with it puts noise in the one position that matters.
   *
   *   AGENTS WHO TOOK NO CALLS. They have no percentage at all, and a null at
   *   the top of that list reads as a finding.
   */
  rows.sort((a, b) => {
    const rank = (row: AgentRow): number =>
      row.userId === null ? 2 : row.closingPct === null ? 1 : 0;
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    return (a.closingPct ?? 0) - (b.closingPct ?? 0);
  });

  return {
    calendarDay: day,
    agencyClosingPct: agencyToday.closingPct,
    agencyCallsTaken: agencyToday.deliveredCalls,
    agencyApplications: agencyToday.submittedApplications,
    /*
     * Summed from the rows rather than queried again: unlike the closing
     * percentage -- whose agency figure includes calls no agent is attributed
     * on -- every application carries a `createdById` or falls into the
     * unattributed row, so the rows and the total cover exactly the same set.
     */
    agencyAnnualizedPremium: Number(
      rows.reduce((total, agent) => total + agent.annualizedPremium, 0).toFixed(2)
    ),
    agents: rows,
  };
}

/**
 * Live softphone presence, from the same Redis keys the softphone writes.
 *
 * Returns the status and when it was set. The second is what turns "available"
 * into something a principal can act on: available for two minutes and
 * available for two hours are the same badge and different situations.
 */
async function readAgentStatuses(
  userIds: string[]
): Promise<{ statuses: Map<string, string>; since: Map<string, Date> }> {
  const statuses = new Map<string, string>();
  const since = new Map<string, Date>();
  if (userIds.length === 0) return { statuses, since };

  try {
    const redis = getRedisClient();
    const values = await redis.mget(userIds.map(id => `agent:status:${id}`));
    userIds.forEach((id, index) => {
      const raw = values[index];
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as { status?: string; lastUpdated?: string };
        if (parsed.status) statuses.set(id, parsed.status);
        if (parsed.lastUpdated) {
          const at = new Date(parsed.lastUpdated);
          if (!Number.isNaN(at.getTime())) since.set(id, at);
        }
      } catch {
        // A malformed value is not a status. Leaving the agent absent from the
        // map renders as 'offline', which is the honest reading of "we cannot
        // tell", and is what an unreachable Redis produces too.
      }
    });
  } catch (error) {
    logger.warn({ msg: 'Could not read agent presence; showing offline', error });
  }

  return { statuses, since };
}

export interface AgentSelfView {
  calendarDay: CalendarDayKey;
  callsTaken: number;
  applications: number;
  closingPct: number | null;
  talkTimeSeconds: number;
  /** Seconds on the queue today. Null when nothing was recorded. */
  availableSeconds: number | null;
  /** The agency's own closing percentage today, to measure against. */
  agencyClosingPct: number | null;
  agencyCallsTaken: number;
  agencyApplications: number;
}

/**
 * An agent's own numbers, against the agency average.
 *
 * No pricing and no money, deliberately: there is no rate, no balance, no
 * overrun and no charge on this view, and the route that serves it does not
 * load them. An agent's own performance is theirs to see; what the agency pays
 * for it is not.
 */
export async function getAgentSelfView(
  tenantId: string,
  userId: string,
  options: { prisma?: PrismaClient; now?: Date; day?: CalendarDayKey } = {}
): Promise<AgentSelfView> {
  const prisma = options.prisma ?? getPrismaClient();
  const now = options.now ?? new Date();
  const day = options.day ?? currentCalendarDay(now);
  const bounds = calendarDayBounds(day);

  const [mine, applications, agency, available] = await Promise.all([
    prisma.call.aggregate({
      where: { ...deliveredCallWhere(tenantId, bounds), answeredByUserId: userId },
      _count: { _all: true },
      _sum: { connectedDuration: true },
    }),
    prisma.insuranceCarrierApplication.count({
      where: {
        tenantId,
        createdById: userId,
        submittedAt: { gte: bounds.start, lt: bounds.endExclusive },
      },
    }),
    measureCalendarDay(
      { calls: prisma.call, applications: prisma.insuranceCarrierApplication },
      tenantId,
      day
    ),
    availableSecondsByUser(prisma, [userId], bounds, now),
  ]);

  const callsTaken = mine._count._all;

  return {
    calendarDay: day,
    callsTaken,
    applications,
    closingPct: callsTaken > 0 ? (applications / callsTaken) * 100 : null,
    talkTimeSeconds: mine._sum.connectedDuration ?? 0,
    availableSeconds: available.get(userId) ?? null,
    agencyClosingPct: agency.closingPct,
    agencyCallsTaken: agency.deliveredCalls,
    agencyApplications: agency.submittedApplications,
  };
}

export interface PlatformAgencyRow {
  tenantId: string;
  name: string;
  slug: string;
  /**
   * Whether this tenant is a real agency.
   *
   * A demo, a fixture or somebody's workspace. Excluded from the platform
   * totals and hidden behind a toggle -- but still a row, because the mechanism
   * is a display decision and nothing is deleted or hidden from somebody
   * looking for it.
   */
  isNonProduction: boolean;
  /** Whether this agency is subject to the billing system at all. */
  enrolled: boolean;
  /** Whether an enrolled agency's settlements actually charge. */
  chargesEnabled: boolean;
  deliveredCalls: number;
  applications: number;
  closingPct: number | null;
  /** The effective rate in force: the curve rate plus this agency's offset. */
  rate: number | null;
  /** The offset, so the platform view can show what makes up the rate. */
  rateOffset: number;
  /** What the curve alone would return for the rate in force. */
  curveRate: number | null;
  /** ACH or CARD. */
  paymentMethod: string;

  /** Unused paid applications: what is left on the block right now. */
  applicationsRemainingOnBlock: number;
  dailyBlockApplications: number;
  /** Applications submitted today beyond the block. */
  overrunToday: number;
  overrunCeiling: number;
  /** Ceiling minus overrun used. Zero means delivery has stopped for today. */
  distanceToCeiling: number;
  /** What NetEnroll invoiced this agency for the day: the settlement total. */
  revenue: number | null;
  /** What the day's calls cost NetEnroll to buy, from the call rows. */
  callCost: number | null;
  margin: number | null;
  revenuePerCall: number | null;
  costPerCall: number | null;

  /** Everything that needs somebody to act. */
  flags: {
    belowMinimumAndPaused: boolean;
    atCeiling: boolean;
    settlementFailedOrUnpaid: boolean;
    noValidMandate: boolean;
    suspended: boolean;
    /**
     * Enrolled, and no settlement has ever been written for it.
     *
     * An agency enrolled days ago with nothing in `daily_settlements` is a
     * nightly run that is not reaching it -- a cron that stopped, a tenant that
     * went inactive, a job that threw on this one agency and moved on. It is
     * invisible in every other column on this screen, because every one of them
     * reads a settlement that does not exist and renders an em dash that looks
     * like a quiet day.
     */
    enrolledNeverSettled: boolean;
    /**
     * A card payment was charged back and no platform admin has stood it down.
     *
     * Its own state rather than part of `suspended`, even though the dispute
     * handler does suspend the agency: an operator needs to know which of the
     * two they are looking at, because a chargeback is money already taken back
     * and a suspension is a decision somebody made.
     */
    disputed: boolean;
  };

  /** Open disputes, so the row can say what is being contained. */
  dispute: {
    count: number;
    /** Dollars at risk across every dispute nobody has stood down from. */
    amount: number;
    latestStatus: string | null;
    openedAt: Date | null;
  } | null;

  /** Where the day's settlement run got to for this agency. */
  settlement: {
    /**
     * `NOT_ENROLLED` is not a failure to run: there was nothing to settle.
     * `HALTED` is not a failure either -- the run worked and deliberately
     * placed no debit, because the total breached the maximum daily debit or
     * the mandate was gone. It needs a different response from a decline, so it
     * is a different word.
     */
    status: 'SETTLED' | 'DRY_RUN' | 'HALTED' | 'FAILED' | 'NOT_YET_RUN' | 'NOT_ENROLLED';
    paymentStatus: SettlementPaymentStatus | null;
    totalCharged: number | null;
    overrunQuantity: number | null;
    nextBlockQuantity: number | null;
  };
}

/**
 * The platform totals across the top of the cross-agency view.
 *
 * Summed from the rows, over the PRODUCTION agencies only. A tenant marked
 * non-production is excluded from every figure here and its row is hidden
 * behind a toggle -- production has five tenants and none of them is a real
 * agency, and a total that includes a demo fixture is a total nobody can act
 * on.
 *
 * `agenciesExcluded` says how many were left out, so a total is never quietly
 * smaller than the table under it.
 */
export interface PlatformTotals {
  agencies: number;
  agenciesExcluded: number;
  enrolled: number;
  deliveredCalls: number;
  applications: number;
  /** Applications over delivered calls, across the production agencies. */
  closingPct: number | null;
  revenue: number | null;
  callCost: number | null;
  margin: number | null;
  applicationsRemainingOnBlock: number;
  overrunToday: number;
  /** Agencies carrying at least one flag that needs somebody to act. */
  flagged: number;
  disputed: number;
}

/**
 * The cross-agency view: one row per agency, for the Delivery Day named.
 *
 * ── This is where a platform admin starts, not where they end up ─────────────
 *
 * NetEnroll staff run the whole platform, and drilling into a single agency is
 * the exception. So this is the landing view for an operator with no acting
 * tenant, it carries the same operational figures the agency's own `/delivery`
 * does -- block remaining, overrun, distance to the ceiling, the current rate
 * -- and it totals them across the top. Selecting an agency narrows to that
 * agency; leaving returns here. The switcher is a filter, not a gate.
 *
 * Platform-only. Every per-agency figure is computed per tenant and never
 * pooled, so a row is a measurement of one agency; the TOTALS are explicitly
 * platform-wide and labelled as such, which is a different thing from a
 * cross-tenant aggregate leaking into an agency's own view. Nothing here is
 * reachable by an agency: the route is gated on the platform capability and
 * `settlement.test.ts` asserts an agency OWNER is refused it.
 */
export async function getPlatformOverview(
  options: {
    prisma?: PrismaClient;
    now?: Date;
    day?: CalendarDayKey;
    /**
     * Show tenants marked non-production as well.
     *
     * They are still excluded from the totals either way: the toggle decides
     * whether the rows are listed, not whether a demo fixture counts as
     * platform revenue.
     */
    includeNonProduction?: boolean;
    /**
     * Narrow to one agency.
     *
     * This is the acting tenant a platform admin selected, resolved from their
     * session by the route -- never a tenant named in a query string. It is
     * here so the same view serves "every agency" and "this agency" rather than
     * two views that can disagree.
     */
    tenantId?: string;
  } = {}
): Promise<{
  calendarDay: CalendarDayKey;
  agencies: PlatformAgencyRow[];
  totals: PlatformTotals;
  /** True when non-production tenants are in `agencies`. */
  includingNonProduction: boolean;
}> {
  const prisma = options.prisma ?? getPrismaClient();
  const now = options.now ?? new Date();
  const day = options.day ?? currentCalendarDay(now);
  const bounds = calendarDayBounds(day);
  const includeNonProduction = options.includeNonProduction === true;

  const tenants = await prisma.tenant.findMany({
    where: {
      status: 'ACTIVE',
      ...(options.tenantId ? { id: options.tenantId } : {}),
      /*
       * Non-production tenants are read only when asked for. They are excluded
       * from the totals in either case, below -- hiding the row and excluding
       * the number are two separate decisions and only one of them is a
       * toggle.
       */
      ...(includeNonProduction ? {} : { isNonProduction: false }),
    },
    select: { id: true, name: true, slug: true, isNonProduction: true },
    orderBy: { name: 'asc' },
  });

  /*
   * One agency at a time was a sequential walk: eight round trips per tenant,
   * awaited before the next tenant started. At five tenants that is forty
   * serial queries behind one page load, and it grows linearly with the
   * platform. The per-tenant work is independent -- no agency's figures are
   * derived from another's -- so the tenants now run together, and the queries
   * within each still run together.
   */
  const agencies: PlatformAgencyRow[] = await Promise.all(
    tenants.map(async (tenant): Promise<PlatformAgencyRow> => {
    const [
      measurement,
      state,
      flag,
      settlement,
      profile,
      ledger,
      cost,
      unpaid,
      settlementsEver,
      balance,
      disputes,
      trackingChange,
      cleanSettlements,
    ] = await Promise.all([
      measureCalendarDay(
        { calls: prisma.call, applications: prisma.insuranceCarrierApplication },
        tenant.id,
        day
      ),
      prisma.agencyRatingState.findUnique({ where: { tenantId: tenant.id } }),
      prisma.ratingReviewFlag.findFirst({
        where: { tenantId: tenant.id, clearedAt: null },
        select: { id: true },
      }),
      prisma.dailySettlement.findUnique({
        where: { tenantId_deliveryDay: { tenantId: tenant.id, deliveryDay: day } },
      }),
      prisma.agencyBillingProfile.findUnique({ where: { tenantId: tenant.id } }),
      ledgerCountsForDay(prisma, tenant.id, day),
      // What the day's delivered calls cost NetEnroll to buy. `cost` is the
      // carrier/media cost already recorded per call by the billing pipeline;
      // it is summed, never estimated, and is null when no call carried one.
      prisma.call.aggregate({
        where: deliveredCallWhere(tenant.id, bounds),
        _sum: { cost: true },
      }),
      prisma.dailySettlement.count({
        where: {
          tenantId: tenant.id,
          paymentStatus: {
            in: [
              SettlementPaymentStatus.FAILED,
              SettlementPaymentStatus.HALTED_MAX_DEBIT,
              SettlementPaymentStatus.HALTED_NO_MANDATE,
            ],
          },
        },
      }),
      // Any settlement ever, not just this day's: an agency enrolled a week ago
      // with none at all is a nightly run that is not reaching it.
      prisma.dailySettlement.count({ where: { tenantId: tenant.id } }),
      // What is left on the block right now, from the ledger. The same figure
      // the agency's own /delivery panel shows it, from the same function.
      creditBalance(prisma, tenant.id),
      /*
       * Disputes nobody has stood down from -- not "disputes that are open".
       * A dispute Stripe closed is still one an operator has not looked at, and
       * `deliveryResumedAt` is the only thing that says somebody has.
       */
      prisma.settlementDispute.findMany({
        where: { tenantId: tenant.id, deliveryResumedAt: null },
        orderBy: { openedAt: 'desc' },
        select: { amount: true, status: true, openedAt: true },
      }),
      /*
       * The rate change that set the rate in force, for its two halves.
       *
       * The agency's `currentRate` is the effective rate and is what it pays;
       * this is read so the platform view can also show the curve rate and the
       * offset that make it up, without recomputing either.
       */
      prisma.agencyRatingState
        .findUnique({ where: { tenantId: tenant.id }, select: { currentRateCalendarDay: true } })
        .then(async row =>
          row?.currentRateCalendarDay
            ? prisma.rateChange.findUnique({
                where: {
                  tenantId_effectiveCalendarDay: {
                    tenantId: tenant.id,
                    effectiveCalendarDay: row.currentRateCalendarDay,
                  },
                },
                select: { curveRate: true, rateOffset: true },
              })
            : null
        ),
      /*
       * How much credit this agency has earned. Read rather than assumed,
       * because the ACH ceiling schedule doubles at the threshold and a screen
       * that showed the lower figure would report a distance to the ceiling
       * half of what the gate will actually allow.
       */
      consecutiveCleanSettlements(prisma, tenant.id),
    ]);

    const revenue = settlement === null ? null : toNumber(settlement.totalCharged);
    const callCost = cost._sum.cost === null ? null : toNumber(cost._sum.cost);
    const calls = measurement.deliveredCalls;

    const terms = profile;
    /*
     * The ceiling in force, from the same rule the gate uses: a platform
     * override first, then the flat card percentage, then the ACH schedule.
     * `ceilingFor` is that rule, and it lives with the terms so this screen and
     * the gate cannot arrive at different numbers.
     */
    const { ceilingPct } = ceilingFor(terms, cleanSettlements);
    const ceilingApplications =
      terms === null ? 0 : overrunCeilingApplications(terms.dailyBlockApplications, ceilingPct);

    /*
     * A dispute nobody has stood down from withdraws Overrun entirely, so the
     * distance to the ceiling for such an agency is zero rather than whatever
     * the schedule would allow. The gate decides the same way; this screen says
     * what the gate will say.
     */
    const disputed = disputes.length > 0;
    const effectiveCeiling = disputed || unpaid > 0 ? 0 : ceilingApplications;

    const rate = state?.currentRate == null ? null : toNumber(state.currentRate);
    const rateOffset = trackingChange?.rateOffset == null ? 0 : toNumber(trackingChange.rateOffset);

    return {
      tenantId: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      isNonProduction: tenant.isNonProduction,
      enrolled: profile?.billingEnrolledAt != null,
      chargesEnabled: profile?.chargesEnabled === true,
      deliveredCalls: calls,
      applications: measurement.submittedApplications,
      closingPct: measurement.closingPct,
      /*
       * The EFFECTIVE rate: what the agency is actually priced at, which is the
       * curve rate plus its offset. The two halves are beside it so the screen
       * can show what makes it up, and so an operator can see at a glance which
       * agencies carry an offset at all.
       */
      rate,
      rateOffset,
      curveRate:
        trackingChange?.curveRate == null
          ? // No rate change has priced this agency yet -- it is on an agreed
            // opening rate, or has never been rated. The opening rate is a
            // negotiated number rather than a curve answer, so there is no
            // curve half to report and this is null rather than the rate.
            null
          : toNumber(trackingChange.curveRate),
      paymentMethod: profile?.paymentMethod ?? 'ACH',
      applicationsRemainingOnBlock: Math.max(0, balance),
      dailyBlockApplications: terms?.dailyBlockApplications ?? 0,
      overrunToday: ledger.overrun,
      overrunCeiling: effectiveCeiling,
      distanceToCeiling: Math.max(0, effectiveCeiling - ledger.overrun),
      revenue,
      callCost,
      margin: revenue === null || callCost === null ? null : Number((revenue - callCost).toFixed(2)),
      revenuePerCall:
        revenue === null || calls === 0 ? null : Number((revenue / calls).toFixed(4)),
      costPerCall: callCost === null || calls === 0 ? null : Number((callCost / calls).toFixed(4)),
      /*
       * Flags are conditions that need somebody to act, so they are only raised
       * for an agency that is actually in the billing system. An unenrolled
       * agency has no mandate and no rate by definition; flagging it would put
       * five red badges on every tenant that has not been onboarded yet and
       * bury the one that genuinely needs attention.
       */
      flags:
        profile?.billingEnrolledAt == null
          ? {
              belowMinimumAndPaused: false,
              atCeiling: false,
              settlementFailedOrUnpaid: false,
              noValidMandate: false,
              suspended: false,
              enrolledNeverSettled: false,
              // A dispute is a payment event, and an unenrolled agency has no
              // payments to dispute. Nothing this platform charged can be
              // charged back for one.
              disputed: false,
            }
          : {
              belowMinimumAndPaused: flag !== null || state?.status === 'UNDER_REVIEW',
              atCeiling: ledger.overrun >= effectiveCeiling && effectiveCeiling > 0,
              settlementFailedOrUnpaid: unpaid > 0,
              noValidMandate:
                profile.achMandateStatus !== 'ACTIVE' || !profile.achPaymentMethodId,
              suspended: profile.suspendedAt != null,
              enrolledNeverSettled: settlementsEver === 0,
              disputed,
            },
      dispute:
        disputes.length === 0
          ? null
          : {
              count: disputes.length,
              amount: Number(
                disputes.reduce((sum, row) => sum + toNumber(row.amount), 0).toFixed(2)
              ),
              latestStatus: disputes[0]?.status ?? null,
              openedAt: disputes[0]?.openedAt ?? null,
            },
      settlement: {
        status:
          profile?.billingEnrolledAt == null
            ? 'NOT_ENROLLED'
            : settlement === null
            ? 'NOT_YET_RUN'
            : settlement.paymentStatus === SettlementPaymentStatus.SUCCEEDED ||
                settlement.paymentStatus === SettlementPaymentStatus.NOT_CHARGED
              ? 'SETTLED'
              : // A dry run is neither settled nor failed: it computed
                // correctly and deliberately took no money. Calling it FAILED
                // would put a red flag on the one state an operator has
                // chosen, on every agency being watched before go-live.
                settlement.paymentStatus === SettlementPaymentStatus.DRY_RUN
                ? 'DRY_RUN'
                : // A halt is not a decline either. The run worked and
                  // deliberately placed no debit -- the total breached the
                  // maximum daily debit, or the mandate was gone -- and the
                  // response to it is to explain the day, not to retry a card.
                  settlement.paymentStatus === SettlementPaymentStatus.HALTED_MAX_DEBIT ||
                    settlement.paymentStatus === SettlementPaymentStatus.HALTED_NO_MANDATE
                  ? 'HALTED'
                  : 'FAILED',
        paymentStatus: settlement?.paymentStatus ?? null,
        totalCharged: settlement === null ? null : toNumber(settlement.totalCharged),
        overrunQuantity: settlement?.overrunQuantity ?? null,
        nextBlockQuantity: settlement?.nextBlockQuantity ?? null,
      },
    };
    })
  );

  /*
   * The totals, over the PRODUCTION agencies only.
   *
   * Non-production tenants are excluded here whether or not their rows are
   * shown, because hiding a row and excluding a number are two decisions and
   * only the first one is a toggle. `agenciesExcluded` says how many were left
   * out, so a total is never quietly smaller than the table beneath it.
   *
   * Summed from the rows this function already computed, not queried again: a
   * second query would be a second definition of the same number.
   */
  const counted = agencies.filter(row => !row.isNonProduction);

  const sum = (pick: (row: PlatformAgencyRow) => number | null): number | null => {
    const values = counted.map(pick).filter((v): v is number => v !== null);
    if (values.length === 0) return null;
    return Number(values.reduce((a, b) => a + b, 0).toFixed(2));
  };

  const totalCalls = counted.reduce((a, row) => a + row.deliveredCalls, 0);
  const totalApplications = counted.reduce((a, row) => a + row.applications, 0);
  const revenue = sum(row => row.revenue);
  const callCost = sum(row => row.callCost);

  const totals: PlatformTotals = {
    agencies: counted.length,
    agenciesExcluded: agencies.length - counted.length,
    enrolled: counted.filter(row => row.enrolled).length,
    deliveredCalls: totalCalls,
    applications: totalApplications,
    /*
     * Applications over delivered calls across the production agencies. Null
     * rather than 0% when nothing was delivered: no calls is not a bad closing
     * day, and a fabricated zero on the screen platform staff read every
     * morning is worse than an absent number.
     */
    closingPct: totalCalls === 0 ? null : Number(((totalApplications / totalCalls) * 100).toFixed(4)),
    revenue,
    callCost,
    margin: revenue === null || callCost === null ? null : Number((revenue - callCost).toFixed(2)),
    applicationsRemainingOnBlock: counted.reduce(
      (a, row) => a + row.applicationsRemainingOnBlock,
      0
    ),
    overrunToday: counted.reduce((a, row) => a + row.overrunToday, 0),
    flagged: counted.filter(row => Object.values(row.flags).some(Boolean)).length,
    disputed: counted.filter(row => row.flags.disputed).length,
  };

  return {
    calendarDay: day,
    agencies,
    totals,
    includingNonProduction: includeNonProduction,
  };
}

export { CreditLedgerEntryType };

// ════════════════════════════════════════════════════════════════════════════
// How one settlement's rate was derived
// ════════════════════════════════════════════════════════════════════════════

export interface SettlementDerivation {
  settlementId: string;
  deliveryDay: CalendarDayKey;

  /** Exactly what the settlement row stores. Nothing here is recomputed. */
  stored: {
    windowClosingPct: number | null;
    windowDayKeys: CalendarDayKey[];
    windowDeliveryDays: number;
    windowDaysFound: number;
    /** The effective rate charged: the curve rate plus the agency's offset. */
    rate: number | null;
    /** The curve's own answer, as recorded on the night. */
    curveRate: number | null;
    /** The offset in force on the night. Immutable, like every figure here. */
    rateOffset: number;
    curveVersion: number | null;
  };

  /**
   * One row per Delivery Day the window covered, re-measured now.
   *
   * These are the counts that produced the percentage. `null` counts mean the
   * day could not be re-measured -- the calls were purged, say -- which is
   * information rather than a zero.
   */
  window: Array<{
    deliveryDay: CalendarDayKey;
    deliveredCalls: number;
    submittedApplications: number;
    closingPct: number | null;
  }>;

  /**
   * The recomputation: the window's totals, the percentage they give, and the
   * rate the stored curve version returns for it.
   */
  recomputed: {
    deliveredCalls: number;
    submittedApplications: number;
    closingPct: number | null;
    /**
     * The effective rate the recomputation lands on: the curve's answer for the
     * re-measured percentage, plus the offset THE SETTLEMENT RECORDS.
     *
     * The settlement's own offset, never the agency's current one. An agency
     * whose terms were renegotiated last week must not have a six-week-old
     * charge repriced under the new ones on the screen whose purpose is to
     * explain that charge.
     */
    rate: number | null;
    /** The curve half of it, so the arithmetic reads rather than asserts. */
    curveRate: number | null;
    rateOffset: number;
    belowMinimum: boolean;
    /** The two anchors the percentage sits between, and the curve's bounds. */
    anchors: { left: CurveAnchor; right: CurveAnchor } | null;
    minimumClosingPct: number | null;
    flatFromClosingPct: number | null;
  };

  /**
   * Whether the recomputation lands on the rate the settlement was written
   * with.
   *
   * `false` is not necessarily a defect: a call deleted or an application
   * submitted late changes what today's re-measurement finds, and the stored
   * figures are what was actually charged. It is surfaced rather than hidden
   * because a disagreement is exactly what somebody disputing a charge needs to
   * see, and hiding it would make this screen a restatement of the stored rate
   * rather than a check on it.
   */
  matchesStoredRate: boolean;
  /** Null when the curve version the settlement names no longer exists. */
  curveFound: boolean;
}

/**
 * Reconstruct how one settlement's rate was arrived at.
 *
 * ── What this screen has to survive ──────────────────────────────────────────
 *
 * An agency disputing a charge. The answer has to be readable without anybody
 * opening a database, and it has to be checkable rather than merely asserted --
 * a page that re-prints the stored rate proves nothing.
 *
 * So it does two things side by side. It reports what the settlement STORES,
 * which is what was charged and is immutable. And it RE-MEASURES the Delivery
 * Days the window named, sums them, prices the result against the curve version
 * the settlement names, and says whether that lands on the stored rate.
 *
 * The curve is loaded by the settlement's own `curveVersionId`, never by
 * whichever curve is active now. Pricing a six-week-old settlement against
 * today's curve would produce a confident, wrong number on the one screen whose
 * purpose is to be trusted.
 */
export async function getSettlementDerivation(
  tenantId: string,
  settlementId: string,
  options: { prisma?: PrismaClient } = {}
): Promise<SettlementDerivation | null> {
  const prisma = options.prisma ?? getPrismaClient();

  // Scoped by tenant in the query, not checked after: an agency must not be
  // able to read another agency's settlement by guessing an id.
  const settlement = await prisma.dailySettlement.findFirst({
    where: { id: settlementId, tenantId },
  });
  if (!settlement) return null;

  const dayKeys = settlement.windowDayKeys;

  const perDay = await Promise.all(
    dayKeys.map(async day => {
      const measurement = await measureCalendarDay(
        { calls: prisma.call, applications: prisma.insuranceCarrierApplication },
        tenantId,
        day
      );
      return {
        deliveryDay: day,
        deliveredCalls: measurement.deliveredCalls,
        submittedApplications: measurement.submittedApplications,
        closingPct: measurement.closingPct,
      };
    })
  );

  const deliveredCalls = perDay.reduce((total, row) => total + row.deliveredCalls, 0);
  const submittedApplications = perDay.reduce(
    (total, row) => total + row.submittedApplications,
    0
  );
  const closingPct =
    deliveredCalls > 0 ? (submittedApplications / deliveredCalls) * 100 : null;

  const storedRate = settlement.rate === null ? null : toNumber(settlement.rate);

  const curveRow = settlement.curveVersionId
    ? await prisma.rateCurveVersion.findUnique({
        where: { id: settlement.curveVersionId },
        include: { anchors: true },
      })
    : null;

  /*
   * The offset the settlement was written with. Read off the settlement, not
   * off the agency's profile: the profile can have changed since, and this
   * screen exists to explain a charge rather than to reprice it.
   */
  const storedOffset = toNumber(settlement.rateOffset);

  let rate: number | null = null;
  let recomputedCurveRate: number | null = null;
  let belowMinimum = false;
  let anchors: { left: CurveAnchor; right: CurveAnchor } | null = null;
  let minimumClosingPct: number | null = null;
  let flatFromClosingPct: number | null = null;

  if (curveRow && closingPct !== null) {
    const curve = toRateCurve(curveRow);
    minimumClosingPct = curve.minimumClosingPct;
    flatFromClosingPct = curve.flatFromClosingPct;

    const verdict = rateFor(curve, closingPct);
    if (verdict.kind === 'RATE') {
      recomputedCurveRate = verdict.rate;
      rate = effectiveRate(verdict.rate, storedOffset);
      anchors = bracketingAnchors(curve, closingPct);
    } else {
      belowMinimum = true;
    }
  }

  return {
    settlementId: settlement.id,
    deliveryDay: settlement.deliveryDay,
    stored: {
      windowClosingPct:
        settlement.windowClosingPct === null ? null : toNumber(settlement.windowClosingPct),
      windowDayKeys: dayKeys,
      windowDeliveryDays: settlement.windowDeliveryDays,
      windowDaysFound: settlement.windowDaysFound,
      rate: storedRate,
      curveRate: settlement.curveRate === null ? null : toNumber(settlement.curveRate),
      rateOffset: storedOffset,
      curveVersion: settlement.curveVersion,
    },
    window: perDay,
    recomputed: {
      deliveredCalls,
      submittedApplications,
      closingPct,
      rate,
      curveRate: recomputedCurveRate,
      rateOffset: storedOffset,
      belowMinimum,
      anchors,
      minimumClosingPct,
      flatFromClosingPct,
    },
    matchesStoredRate: rate !== null && storedRate !== null && rate === storedRate,
    curveFound: curveRow !== null,
  };
}

/**
 * The two anchors a closing percentage was interpolated between.
 *
 * Shown so the arithmetic is legible rather than asserted: "15.2% sits above
 * the flat point, so it prices at the top anchor" is a sentence somebody can
 * check. Both anchors are the same one where the percentage is flat at an end
 * of the curve, which is the honest picture of what happened.
 */
function bracketingAnchors(
  curve: RateCurve,
  closingPct: number
): { left: CurveAnchor; right: CurveAnchor } | null {
  if (curve.anchors.length === 0) return null;

  const lowest = curve.anchors[0];
  const highest = curve.anchors[curve.anchors.length - 1];

  if (closingPct >= curve.flatFromClosingPct || closingPct >= highest.closingPct) {
    return { left: highest, right: highest };
  }
  if (closingPct <= lowest.closingPct) return { left: lowest, right: lowest };

  for (let i = 0; i < curve.anchors.length - 1; i++) {
    const left = curve.anchors[i];
    const right = curve.anchors[i + 1];
    if (closingPct >= left.closingPct && closingPct <= right.closingPct) {
      return { left, right };
    }
  }
  return null;
}
