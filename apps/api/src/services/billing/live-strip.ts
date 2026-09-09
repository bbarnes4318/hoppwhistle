/**
 * The live strip: the handful of figures that ride above every page.
 *
 * ── What it replaced, and why ────────────────────────────────────────────────
 *
 * The strip used to carry four pay-per-call marketplace figures -- calls in
 * flight, answer rate, abandon rate, revenue run rate per hour -- from this
 * application's previous life as a publisher/buyer platform. For an agency
 * three of them had no source at all and rendered as em dashes, and the fourth
 * read $0.00 because agency revenue is not an hourly run rate. It occupied the
 * top of every screen and answered no question anybody had.
 *
 * These are the questions it answers now, in the order a principal asks them:
 * am I on pace today, what is today costing me, and where is my rate going.
 *
 * ── Nothing here is a second definition of anything ──────────────────────────
 *
 * Every figure is a projection of a view that already exists and that a page
 * already renders:
 *
 *   agency    `getDeliveryToday()`   -- the same call `/delivery` makes
 *   agent     `getAgentSelfView()`   -- the same call `/delivery/me` makes
 *   platform  `getPlatformOverview()` -- the same call the cross-agency
 *                                       `/delivery` makes, plus a projection
 *                                       per enrolled agency from the agency
 *                                       function above
 *
 * That is deliberate and is the whole point: two screens disagreeing about
 * what tonight costs is worse than one screen being wrong. Nothing in this file
 * measures a call, prices an application or sums a charge; it selects fields
 * and explains the ones that are absent.
 *
 * ── An unenrolled agency has no billing figures, not zeroed ones ─────────────
 *
 * Billing is opt-in per agency and off by default. `AgencyStrip.billing` is
 * OMITTED for an agency that is not enrolled -- not nulled, not zeroed. A null
 * would render as an em dash, and an em dash under a label reading "tonight" is
 * still a screen telling somebody they owe an unknown amount. The absence is
 * structural so that no rendering decision can reintroduce it.
 *
 * ── The agent's strip has no money on it ─────────────────────────────────────
 *
 * Same property as `/delivery/me`: it is built from a view that never loads a
 * rate, a balance, an overrun or a charge, so there is nothing here to leak.
 * An agent sees their own calls, their own applications and their own closing
 * percentage against the agency's, and no other agent.
 */

import type { PrismaClient } from '@prisma/client';

import { getPrismaClient } from '../../lib/prisma.js';
import type { CalendarDayKey } from '../rating/calendar-day.js';

import {
  CALL_IN_PROGRESS,
  getAgentSelfView,
  getDeliveryToday,
  getPlatformOverview,
} from './delivery-view.js';

/**
 * Why a figure is absent.
 *
 * Keyed by the field name the client is missing, exactly as the existing
 * `/api/v1/live/metrics` does it. The strip renders an absent figure as a muted
 * em dash carrying this sentence as its tooltip: a fabricated live number on a
 * screen where somebody watches their own money is worse than an absent one,
 * and an em dash with no explanation reads as a bug rather than as a known gap.
 */
export type UnavailableReasons = Record<string, string>;

// ────────────────────────────────────────────────────────────────────────────
// Agency

/** The billing half. Present only for an agency enrolled in billing. */
export interface AgencyStripBilling {
  /** Applications the agency prepaid for today. The number to pace against. */
  dailyBlockApplications: number;
  /** Paid for and unused: what is left on the block right now. */
  applicationsRemainingOnBlock: number;
  /** Applications submitted today beyond the block. */
  overrunToday: number;
  /** What that overrun adds to tonight's debit, at the rate tonight will use. */
  overrunAmountTonight: number | null;
  /** Overrun tonight plus the next block. Provisional until the day closes. */
  projectedTotalCharge: number | null;
  /** Dollars per submitted application, today. Null under review, never $0. */
  currentRate: number | null;
  /**
   * What the trailing window is tracking toward for tomorrow.
   *
   * A DIFFERENT number from `currentRate`, driven by a different closing
   * percentage, and the two are never conflated: each is labelled with what it
   * does. See docs/RATING.md §4.
   */
  trackingRate: number | null;
  trackingBelowMinimum: boolean;
}

export interface AgencyStrip {
  scope: 'agency';
  generatedAt: string;
  calendarDay: CalendarDayKey;
  timeZone: string;
  enrolled: boolean;

  /** Calls an agent picked up today. The denominator of the closing percentage. */
  callsDelivered: number;
  /** Connected to an agent at this instant. About now, not about the day. */
  callsInProgress: number;
  applicationsSubmitted: number;

  /** Omitted entirely when `enrolled` is false. */
  billing?: AgencyStripBilling;

  unavailable: UnavailableReasons;
}

const NO_RATE_IN_FORCE =
  'There is no rate in force for this agency today: it is under review, or no ' +
  'opening rate has been agreed. A rate below the curve minimum is an absent ' +
  'rate, not a rate of zero, and only NetEnroll can clear the review.';

const TRACKING_BELOW_MINIMUM =
  'The Delivery Day window ending today is below the curve minimum, which ' +
  'returns no rate at all. See /rating for the window and its counts.';

const TRACKING_NO_WINDOW =
  'No calls have been delivered in the trailing Delivery Day window yet, so ' +
  "there is nothing to price tomorrow's rate from.";

const NO_TONIGHT_RATE =
  "Tonight's settlement has no rate to use -- neither the rate in force nor " +
  'the window ending today produces one -- so tonight cannot be projected.';

/**
 * One agency's strip, projected from the panel `/delivery` renders.
 *
 * Same function, same day, same tenant: the two screens cannot disagree.
 */
export async function getAgencyStrip(
  tenantId: string,
  options: { prisma?: PrismaClient; now?: Date } = {}
): Promise<AgencyStrip> {
  const now = options.now ?? new Date();
  const today = await getDeliveryToday(tenantId, options);

  const base = {
    scope: 'agency' as const,
    generatedAt: now.toISOString(),
    calendarDay: today.calendarDay,
    timeZone: today.timeZone,
    enrolled: today.enrolled,
    callsDelivered: today.callsAnswered,
    callsInProgress: today.callsInProgress,
    applicationsSubmitted: today.applicationsSubmitted,
  };

  /*
   * Not enrolled: the operational counts and nothing else. No `billing` key at
   * all, so there is no zero and no em dash anywhere on the strip implying
   * money that is not being charged.
   */
  if (!today.enrolled) {
    return { ...base, unavailable: {} };
  }

  const unavailable: UnavailableReasons = {};
  if (today.currentRate === null) unavailable.currentRate = NO_RATE_IN_FORCE;
  if (today.trackingRate === null) {
    unavailable.trackingRate = today.trackingBelowMinimum
      ? TRACKING_BELOW_MINIMUM
      : TRACKING_NO_WINDOW;
  }
  if (today.overrunAmountTonight === null) unavailable.overrunAmountTonight = NO_TONIGHT_RATE;
  if (today.projectedTotalCharge === null) unavailable.projectedTotalCharge = NO_TONIGHT_RATE;

  return {
    ...base,
    billing: {
      dailyBlockApplications: today.dailyBlockApplications,
      applicationsRemainingOnBlock: today.applicationsRemainingOnBlock,
      overrunToday: today.overrunToday,
      overrunAmountTonight: today.overrunAmountTonight,
      projectedTotalCharge: today.projectedTotalCharge,
      currentRate: today.currentRate,
      trackingRate: today.trackingRate,
      trackingBelowMinimum: today.trackingBelowMinimum,
    },
    unavailable,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Agent

export interface AgentStrip {
  scope: 'agent';
  generatedAt: string;
  calendarDay: CalendarDayKey;
  /** Calls this agent picked up today. */
  callsTaken: number;
  /** Applications this agent submitted today. */
  applications: number;
  /** This agent's own closing percentage. Null with no calls, never 0%. */
  closingPct: number | null;
  /** The agency's, to sit against. No other agent appears anywhere. */
  agencyClosingPct: number | null;
  /**
   * The agent's percentage minus the agency's, in points.
   *
   * Computed here rather than in the browser for the same reason every other
   * figure is: the strip renders what the server said and derives nothing.
   */
  closingPctVsAgencyPoints: number | null;
  unavailable: UnavailableReasons;
}

const AGENT_NO_CALLS =
  'You have not answered a call yet today, so there is no percentage to show. ' +
  'A closing percentage with no calls behind it would be a fabricated 0%.';

const AGENCY_NO_CALLS =
  'The agency has not answered a call yet today, so there is nothing to ' + 'measure against.';

/** One agent's own numbers, projected from the view `/delivery/me` renders. */
export async function getAgentStrip(
  tenantId: string,
  userId: string,
  options: { prisma?: PrismaClient; now?: Date } = {}
): Promise<AgentStrip> {
  const now = options.now ?? new Date();
  const me = await getAgentSelfView(tenantId, userId, options);

  const unavailable: UnavailableReasons = {};
  if (me.closingPct === null) unavailable.closingPct = AGENT_NO_CALLS;
  if (me.agencyClosingPct === null) unavailable.agencyClosingPct = AGENCY_NO_CALLS;

  return {
    scope: 'agent',
    generatedAt: now.toISOString(),
    calendarDay: me.calendarDay,
    callsTaken: me.callsTaken,
    applications: me.applications,
    closingPct: me.closingPct,
    agencyClosingPct: me.agencyClosingPct,
    closingPctVsAgencyPoints:
      me.closingPct === null || me.agencyClosingPct === null
        ? null
        : Number((me.closingPct - me.agencyClosingPct).toFixed(1)),
    unavailable,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Platform

export interface PlatformStrip {
  scope: 'platform';
  generatedAt: string;
  calendarDay: CalendarDayKey;
  /** Production agencies. Non-production tenants are excluded, as on /delivery. */
  agencies: number;
  /** Agencies with a call connected to an agent at this instant. */
  agenciesDelivering: number;
  /** Delivered calls across every production agency today. */
  deliveredCalls: number;
  /** Submitted applications across every production agency today. */
  applications: number;
  /** Tonight's debits, summed across the enrolled agencies. Provisional. */
  projectedSettlementTonight: number | null;
  /**
   * Agencies carrying at least one condition that needs somebody to act:
   * below the curve minimum and paused, at their Overrun ceiling, a failed or
   * unpaid settlement, no valid mandate -- and the three the cross-agency page
   * also counts, a suspension, an enrolled agency that has never settled, and
   * an open chargeback. The SAME count the page below shows in its header, from
   * the same function, because two different answers to "how many need me" is
   * how one of them gets ignored.
   */
  agenciesNeedingAttention: number;
  unavailable: UnavailableReasons;
}

const NOTHING_ENROLLED =
  'No production agency is enrolled in billing, so there is no settlement to ' + 'project tonight.';

const NO_PROJECTABLE_RATE =
  'No enrolled agency has a rate for tonight, so the debit cannot be ' +
  'projected. An agency under review has no rate at all.';

/**
 * The platform reading, for NetEnroll staff who have entered no agency.
 *
 * COST. `getPlatformOverview()` is the expensive part and is the same call the
 * cross-agency `/delivery` already makes; the projection adds one grouped
 * in-flight query across every production tenant, plus one `getDeliveryToday`
 * per ENROLLED agency -- two of them at launch, not one per tenant. The route
 * caches the result for thirty seconds, which is what keeps a floor of staff
 * tabs off the database.
 */
export async function getPlatformStrip(
  options: { prisma?: PrismaClient; now?: Date } = {}
): Promise<PlatformStrip> {
  const prisma = options.prisma ?? getPrismaClient();
  const now = options.now ?? new Date();

  const overview = await getPlatformOverview({ prisma, now });

  /*
   * Production agencies only, matching the totals above them. A demo fixture
   * delivering calls is not an agency delivering calls, and a count that
   * included one is a count nobody can act on.
   */
  const production = overview.agencies.filter(row => !row.isNonProduction);
  const enrolled = production.filter(row => row.enrolled);

  const [deliveringNow, projections] = await Promise.all([
    /*
     * One grouped query rather than one per tenant. `CALL_IN_PROGRESS` is the
     * agency panel's own predicate with the tenant left off, so "delivering
     * right now" means here exactly what "in progress now" means there.
     */
    production.length === 0
      ? Promise.resolve([] as Array<{ tenantId: string }>)
      : prisma.call.groupBy({
          by: ['tenantId'],
          where: { ...CALL_IN_PROGRESS, tenantId: { in: production.map(row => row.tenantId) } },
        }),
    // The projection an agency's own /delivery shows it, per agency, summed.
    Promise.all(enrolled.map(row => getDeliveryToday(row.tenantId, { prisma, now }))),
  ]);

  const projectable = projections
    .map(view => view.projectedTotalCharge)
    .filter((amount): amount is number => amount !== null);

  const unavailable: UnavailableReasons = {};
  let projectedSettlementTonight: number | null = null;
  if (enrolled.length === 0) {
    unavailable.projectedSettlementTonight = NOTHING_ENROLLED;
  } else if (projectable.length === 0) {
    unavailable.projectedSettlementTonight = NO_PROJECTABLE_RATE;
  } else {
    projectedSettlementTonight = Number(
      projectable.reduce((total, amount) => total + amount, 0).toFixed(2)
    );
  }

  return {
    scope: 'platform',
    generatedAt: now.toISOString(),
    calendarDay: overview.calendarDay,
    agencies: overview.totals.agencies,
    agenciesDelivering: deliveringNow.length,
    deliveredCalls: overview.totals.deliveredCalls,
    applications: overview.totals.applications,
    projectedSettlementTonight,
    agenciesNeedingAttention: overview.totals.flagged,
    unavailable,
  };
}

// ────────────────────────────────────────────────────────────────────────────

/**
 * A signed-in principal the strip has nothing to say to.
 *
 * A tenant member who is neither an administrator nor an agent -- a READONLY
 * account, say. Answered with a shape rather than a refusal on purpose: the
 * strip renders on every page for every user, and a 403 on every page load is
 * noise in the log, a red line in the browser console and, for a client that
 * reads refusals as dead sessions, a bounce to /login.
 */
export interface NoStrip {
  scope: 'none';
  generatedAt: string;
  reason: string;
}

export type LiveStripView = AgencyStrip | AgentStrip | PlatformStrip | NoStrip;
