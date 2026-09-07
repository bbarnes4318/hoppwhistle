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

import type { PrismaClient } from '@prisma/client';
import { CreditLedgerEntryType, SettlementPaymentStatus } from '@prisma/client';

import { logger } from '../../lib/logger.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { calendarDayBounds, currentCalendarDay } from '../rating/calendar-day.js';
import type { CalendarDayKey } from '../rating/calendar-day.js';
import { deliveredCallWhere, measureCalendarDay } from '../rating/measurement.js';
import { toNumber } from '../rating/rate-curve.js';
import { getRatingSummary } from '../rating/rating-summary.js';
import { getRedisClient } from '../redis.js';

import { creditBalance, ledgerCountsForDay } from './credit-ledger.js';
import { evaluateDeliveryGate } from './delivery-gate.js';
import type { DeliveryGateDecision } from './delivery-gate.js';

export interface DeliveryTodayView {
  tenantId: string;
  calendarDay: CalendarDayKey;
  timeZone: string;

  /** Calls NetEnroll routed to this agency today, answered or not. */
  callsRouted: number;
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

  /** Dollars per submitted application, today. Null under review -- not zero. */
  currentRate: number | null;
  /** What tomorrow is tracking toward. Provisional. */
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

  const [rating, gate, balance, counts, todayMeasurement, routed, hold, profile] =
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
    callsRouted: routed,
    callsAnswered: todayMeasurement.deliveredCalls,
    applicationsSubmitted: todayMeasurement.submittedApplications,
    todayClosingPct: todayMeasurement.closingPct,
    windowClosingPct: rating.ratingWindow.closingPct,
    windowDayKeys: rating.ratingWindow.dayKeys,
    windowDaysFound: rating.ratingWindow.daysFound,
    windowDeliveryDays: rating.ratingWindow.deliveryDays,
    currentRate: rating.currentRate,
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
  /** Null when the agent took no calls -- never 0%. */
  closingPct: number | null;
  /** Seconds connected, summed over the day's answered calls. */
  talkTimeSeconds: number;
  /** Self-reported hours for the day, from the payroll time entry. */
  hoursWorked: number | null;
  /** Talk time as a share of recorded hours. Null when hours are not recorded. */
  occupancyPct: number | null;
  /** Live softphone presence. 'unknown' when Redis could not be read. */
  currentStatus: string;
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
): Promise<{ calendarDay: CalendarDayKey; agents: AgentRow[] }> {
  const prisma = options.prisma ?? getPrismaClient();
  const now = options.now ?? new Date();
  const day = options.day ?? currentCalendarDay(now);
  const bounds = calendarDayBounds(day);

  const [callRows, applicationRows, users] = await Promise.all([
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
      where: { tenantId, submittedAt: { gte: bounds.start, lt: bounds.endExclusive } },
      _count: { _all: true },
    }),
    prisma.user.findMany({
      where: { tenantId },
      select: { id: true, email: true, firstName: true, lastName: true },
    }),
  ]);

  const userIds = users.map(u => u.id);

  const timeEntries = await prisma.timeEntry.findMany({
    where: { userId: { in: userIds }, date: bounds.start },
    select: { userId: true, hoursWorked: true },
  });
  const hoursByUser = new Map(timeEntries.map(t => [t.userId, toNumber(t.hoursWorked)]));

  const statuses = await readAgentStatuses(userIds);

  const applicationsByUser = new Map(
    applicationRows.map(row => [row.createdById, row._count._all])
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
      closingPct: calls > 0 ? (applications / calls) * 100 : null,
      talkTimeSeconds,
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
      closingPct: null,
      talkTimeSeconds: 0,
      hoursWorked,
      occupancyPct: hoursWorked && hoursWorked > 0 ? 0 : null,
      currentStatus: statuses.get(userId) ?? 'offline',
    });
  }

  // Sorted by closing percentage descending, with the agents who took no calls
  // last: they have no percentage, and putting a null at the top of a "who
  // needs coaching" list is a bug that looks like a finding.
  rows.sort((a, b) => (b.closingPct ?? -1) - (a.closingPct ?? -1));

  return { calendarDay: day, agents: rows };
}

/** Live softphone presence, from the same Redis keys the softphone writes. */
async function readAgentStatuses(userIds: string[]): Promise<Map<string, string>> {
  const statuses = new Map<string, string>();
  if (userIds.length === 0) return statuses;

  try {
    const redis = getRedisClient();
    const values = await redis.mget(userIds.map(id => `agent:status:${id}`));
    userIds.forEach((id, index) => {
      const raw = values[index];
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as { status?: string };
        if (parsed.status) statuses.set(id, parsed.status);
      } catch {
        // A malformed value is not a status. Leaving the agent absent from the
        // map renders as 'offline', which is the honest reading of "we cannot
        // tell", and is what an unreachable Redis produces too.
      }
    });
  } catch (error) {
    logger.warn({ msg: 'Could not read agent presence; showing offline', error });
  }

  return statuses;
}

export interface AgentSelfView {
  calendarDay: CalendarDayKey;
  callsTaken: number;
  applications: number;
  closingPct: number | null;
  talkTimeSeconds: number;
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

  const [mine, applications, agency] = await Promise.all([
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
  ]);

  const callsTaken = mine._count._all;

  return {
    calendarDay: day,
    callsTaken,
    applications,
    closingPct: callsTaken > 0 ? (applications / callsTaken) * 100 : null,
    talkTimeSeconds: mine._sum.connectedDuration ?? 0,
    agencyClosingPct: agency.closingPct,
    agencyCallsTaken: agency.deliveredCalls,
    agencyApplications: agency.submittedApplications,
  };
}

export interface PlatformAgencyRow {
  tenantId: string;
  name: string;
  slug: string;
  deliveredCalls: number;
  applications: number;
  closingPct: number | null;
  rate: number | null;
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
  };

  /** Where the day's settlement run got to for this agency. */
  settlement: {
    status: 'SETTLED' | 'FAILED' | 'NOT_YET_RUN';
    paymentStatus: SettlementPaymentStatus | null;
    totalCharged: number | null;
    overrunQuantity: number | null;
    nextBlockQuantity: number | null;
  };
}

/**
 * The cross-agency view: one row per agency, for the Delivery Day named.
 *
 * Platform-only. Every figure is computed per tenant and never pooled, so this
 * is a list of agencies rather than a cross-tenant aggregate that could show one
 * agency a number derived from another's traffic.
 */
export async function getPlatformOverview(
  options: { prisma?: PrismaClient; now?: Date; day?: CalendarDayKey } = {}
): Promise<{ calendarDay: CalendarDayKey; agencies: PlatformAgencyRow[] }> {
  const prisma = options.prisma ?? getPrismaClient();
  const now = options.now ?? new Date();
  const day = options.day ?? currentCalendarDay(now);
  const bounds = calendarDayBounds(day);

  const tenants = await prisma.tenant.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, name: true, slug: true },
    orderBy: { name: 'asc' },
  });

  const agencies: PlatformAgencyRow[] = [];

  for (const tenant of tenants) {
    const [measurement, state, flag, settlement, profile, ledger, cost] = await Promise.all([
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
    ]);

    const revenue = settlement === null ? null : toNumber(settlement.totalCharged);
    const callCost = cost._sum.cost === null ? null : toNumber(cost._sum.cost);
    const calls = measurement.deliveredCalls;

    const terms = profile;
    const ceilingApplications =
      terms === null
        ? 0
        : Math.floor(
            (terms.dailyBlockApplications *
              toNumber(terms.ceilingPctOverride ?? terms.ceilingPctBelowThreshold)) /
              100
          );

    const unpaid = await prisma.dailySettlement.count({
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
    });

    agencies.push({
      tenantId: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      deliveredCalls: calls,
      applications: measurement.submittedApplications,
      closingPct: measurement.closingPct,
      rate: state?.currentRate == null ? null : toNumber(state.currentRate),
      revenue,
      callCost,
      margin: revenue === null || callCost === null ? null : Number((revenue - callCost).toFixed(2)),
      revenuePerCall:
        revenue === null || calls === 0 ? null : Number((revenue / calls).toFixed(4)),
      costPerCall: callCost === null || calls === 0 ? null : Number((callCost / calls).toFixed(4)),
      flags: {
        belowMinimumAndPaused: flag !== null || state?.status === 'UNDER_REVIEW',
        atCeiling: ledger.overrun >= ceilingApplications && ceilingApplications > 0,
        settlementFailedOrUnpaid: unpaid > 0,
        noValidMandate: profile?.achMandateStatus !== 'ACTIVE' || !profile.achPaymentMethodId,
        suspended: profile?.suspendedAt != null,
      },
      settlement: {
        status:
          settlement === null
            ? 'NOT_YET_RUN'
            : settlement.paymentStatus === SettlementPaymentStatus.SUCCEEDED ||
                settlement.paymentStatus === SettlementPaymentStatus.NOT_CHARGED
              ? 'SETTLED'
              : 'FAILED',
        paymentStatus: settlement?.paymentStatus ?? null,
        totalCharged: settlement === null ? null : toNumber(settlement.totalCharged),
        overrunQuantity: settlement?.overrunQuantity ?? null,
        nextBlockQuantity: settlement?.nextBlockQuantity ?? null,
      },
    });
  }

  return { calendarDay: day, agencies };
}

export { CreditLedgerEntryType };
