/**
 * Closing percentage: the one definition.
 *
 *     closing percentage = submitted applications / delivered calls
 *
 * Phase 3 bills money from this number, so it is defined once, here, and
 * nothing else in the codebase may redefine either side of the fraction.
 *
 * ── Delivered call ───────────────────────────────────────────────────────────
 *
 * A call routed to that agency and ANSWERED by one of its agents. In the schema
 * that is a `Call` row whose `tenantId` is the agency and whose `answeredAt` is
 * set. Calls that ring out, abandon, or arrive when the agency is not staffed
 * all leave `answeredAt` null and are excluded from the denominator by that
 * fact alone -- there is no separate list of excluded dispositions to drift out
 * of date.
 *
 * Two further conditions, both narrowing:
 *
 *   - `direction: INBOUND`. A delivered call is one NetEnroll delivered. The
 *     agency's own outbound dialling is its business and is not something it
 *     is rated on; counting it would inflate the denominator, depress the
 *     measured closing percentage and RAISE the agency's price. An error that
 *     costs the customer money is not an acceptable default.
 *   - `blocked: false`. A call the compliance layer refused was never offered
 *     to an agent. It cannot have `answeredAt` set today, but the flag is
 *     asserted anyway so a future path that records a blocked-but-connected
 *     call cannot quietly enter the denominator.
 *
 * There is NO minimum duration. A call answered and immediately dropped is a
 * delivered call: the agency was given the opportunity, and a duration
 * threshold is a lever on the price that nobody agreed to.
 *
 * Delivery is attributed by `answeredAt` -- the moment the agent picked up --
 * not by `createdAt`. A call that starts ringing at 23:59:58 and is answered at
 * 00:00:02 was delivered on the second day.
 *
 * ── Submitted application ────────────────────────────────────────────────────
 *
 * An `InsuranceCarrierApplication` for that agency that reached submitted
 * state. `submittedAt` is written once, on the first transition into SUBMITTED,
 * so an application that reaches submitted twice -- a retried automation run, a
 * replayed webhook -- counts once and keeps the timestamp of the first
 * submission.
 *
 * What the carrier decides afterwards is NOT part of this. Issued, declined,
 * rescinded, lapsed: none of those words appears in this file, in the query, or
 * anywhere downstream of it. The agency is paid for submitting the application,
 * and a carrier's later decision never produces a credit or a reversal.
 *
 * Attribution is by submission timestamp, not by the date of the call that
 * produced it. An application from a 4pm call submitted at 9am the next day
 * belongs to the next day.
 *
 * How the application REACHED submitted state is not part of this either. The
 * carrier RPA writes some of them and an agent logs the rest by hand, on any
 * carrier, and the query below does not branch on `source`: an agency is
 * measured on the business it submitted, not on which of our paths recorded
 * it. Counting only the automated carrier understated the numerator and
 * overcharged every agency writing with the other ten.
 *
 * ── A voided application is not one ──────────────────────────────────────────
 *
 * `voidedAt` removes an application from the numerator. It is the correction
 * for a row that should never have counted -- a test entry, a duplicate the
 * client-request key did not catch, an application logged against the wrong
 * agency -- and it is PLATFORM STAFF ONLY: an agency cannot void its own
 * applications, because the numerator is what its price is measured from and
 * editing it is setting its own rate.
 *
 * Voiding NEVER reverses a credit that was already consumed. The ledger refuses
 * UPDATE and DELETE by trigger and has no reversal entry type by design, so a
 * credit spent on an application stays spent. Voiding narrows what the agency
 * is measured on going forward; it does not undo what it has already been
 * charged, and nothing here should be read as a refund path.
 *
 * ── Per agency, always ───────────────────────────────────────────────────────
 *
 * Every function here takes a `tenantId` and every query carries it. Two
 * agencies running side by side produce two independent closing percentages,
 * and each agent's calls and applications roll up into their own agency's
 * totals and nowhere else.
 *
 * ── The window lives elsewhere ───────────────────────────────────────────────
 *
 * This module measures a tenant over an instant range and knows nothing about
 * which range. The rating window is the trailing three DELIVERY DAYS and is
 * built in `delivery-day.ts`; the day boundary itself is `calendar-day.ts`.
 * `deliveredCallWhere` is exported because `delivery-day.ts` needs the exact
 * same predicate to decide whether a day was a Delivery Day at all -- one
 * definition, used twice, rather than two that can drift.
 */

import type { Prisma, PrismaClient } from '@prisma/client';

import { calendarDayBounds } from './calendar-day.js';
import type { CalendarDayKey } from './calendar-day.js';

/**
 * The slices of the generated client this needs. Derived from `PrismaClient`
 * rather than hand-declared, so a renamed column is a compile error here, and
 * narrow enough that tests can drive it with a fake and assert on the exact
 * `where` clauses.
 */
export interface MeasurementDeps {
  calls: Pick<PrismaClient['call'], 'count'>;
  applications: Pick<PrismaClient['insuranceCarrierApplication'], 'count'>;
}

/** An instant range, half-open: `[start, endExclusive)`. */
export interface InstantRange {
  start: Date;
  endExclusive: Date;
}

/**
 * The delivered-call filter, exported so a reader can see the whole definition
 * in one expression and so nothing has to restate it.
 */
export function deliveredCallWhere(tenantId: string, range: InstantRange): Prisma.CallWhereInput {
  return {
    tenantId,
    direction: 'INBOUND',
    blocked: false,
    answeredAt: { gte: range.start, lt: range.endExclusive },
  };
}

/** The submitted-application filter. */
export function submittedApplicationWhere(
  tenantId: string,
  range: InstantRange
): Prisma.InsuranceCarrierApplicationWhereInput {
  return {
    tenantId,
    submittedAt: { gte: range.start, lt: range.endExclusive },
    // A voided application was never a submitted application. See the header.
    voidedAt: null,
  };
}

export async function countDeliveredCalls(
  deps: MeasurementDeps,
  tenantId: string,
  range: InstantRange
): Promise<number> {
  return deps.calls.count({ where: deliveredCallWhere(tenantId, range) });
}

export async function countSubmittedApplications(
  deps: MeasurementDeps,
  tenantId: string,
  range: InstantRange
): Promise<number> {
  return deps.applications.count({ where: submittedApplicationWhere(tenantId, range) });
}

/** The two counts and the percentage they produce. */
export interface ClosingMeasurement {
  deliveredCalls: number;
  submittedApplications: number;
  /**
   * A percentage: 8.5 means 8.5%. Null when there were no delivered calls.
   *
   * Never 0 for an empty window. Zero is a real measurement -- an agency that
   * took 450 calls and submitted nothing -- and it prices to review. "No calls
   * at all" is not that, and conflating them would flag an agency for the
   * offence of being closed.
   */
  closingPct: number | null;
}

/**
 * The closing percentage over an arbitrary instant range.
 *
 * Both counts run against the same range, in parallel, so the numerator and the
 * denominator can never disagree about which window they measured.
 */
export async function measureClosing(
  deps: MeasurementDeps,
  tenantId: string,
  range: InstantRange
): Promise<ClosingMeasurement> {
  const [deliveredCalls, submittedApplications] = await Promise.all([
    countDeliveredCalls(deps, tenantId, range),
    countSubmittedApplications(deps, tenantId, range),
  ]);

  return {
    deliveredCalls,
    submittedApplications,
    closingPct: deliveredCalls > 0 ? (submittedApplications / deliveredCalls) * 100 : null,
  };
}

/** The closing percentage for one calendar day. */
export async function measureCalendarDay(
  deps: MeasurementDeps,
  tenantId: string,
  day: CalendarDayKey
): Promise<ClosingMeasurement> {
  return measureClosing(deps, tenantId, calendarDayBounds(day));
}
