import type { Prisma, PrismaClient } from '@prisma/client';

import {
  PLATFORM_TIME_ZONE,
  calendarDayBounds,
  currentCalendarDay,
  type CalendarDayKey,
} from '../rating/calendar-day.js';
import { deliveredCallWhere, submittedApplicationWhere } from '../rating/measurement.js';

/**
 * The Live Board: every agency, right now.
 *
 * ── What it is, and what it is not ───────────────────────────────────────────
 *
 * `/api/v1/platform/delivery/overview` already answers "how did every agency do
 * TODAY" -- rate, block, overrun, margin, settlement state. It is a money
 * screen and it is settled-day shaped.
 *
 * This answers the question somebody asks while standing up: WHO IS ON THE
 * PHONE RIGHT NOW. Calls up this second, per agency, beside the two numbers
 * that say whether the day is going anywhere -- delivered calls and submitted
 * applications so far.
 *
 * ── The two "today" numbers are the billing ones ─────────────────────────────
 *
 * `deliveredCallWhere` and `submittedApplicationWhere` come from
 * `services/rating/measurement.ts`, the module the nightly settlement bills
 * from. This board must not invent a second idea of a delivered call: an
 * operator watching it and an agency reading its invoice would then be looking
 * at two different numbers with the same name, and the invoice is the one that
 * would be believed.
 *
 * ── In flight is not a settled number, and is bounded ────────────────────────
 *
 * The in-flight predicate is the one `/api/v1/live/metrics` uses for the strip
 * above every page, lifted rather than re-derived: still up, no end time
 * recorded, and bounded by `IN_FLIGHT_WINDOW_MS` so one crashed leg cannot park
 * a permanent phantom call on an agency's row for the rest of the day.
 *
 * ── Cost ─────────────────────────────────────────────────────────────────────
 *
 * Four queries for the whole platform, not four per agency: one tenant list and
 * three GROUP BY tenantId roll-ups, every one of them index-covered. A board
 * polling across two hundred agencies costs what one across two costs.
 */

/** Matches the strip's window. A call with no end time from hours ago is a stuck row. */
export const IN_FLIGHT_WINDOW_MS = 4 * 60 * 60 * 1000;

/** Still up: dialling, ringing or connected, with no end time recorded. */
export const IN_FLIGHT_STATUSES = ['INITIATED', 'RINGING', 'ANSWERED'] as const;

export interface LiveBoardAgency {
  tenantId: string;
  name: string;
  slug: string;
  isNonProduction: boolean;
  callsInFlight: number;
  deliveredToday: number;
  applicationsToday: number;
  /** A percentage: 8.5 means 8.5%. Null when nothing was delivered yet today. */
  closingPct: number | null;
}

export interface LiveBoard {
  generatedAt: string;
  day: CalendarDayKey;
  timeZone: string;
  totals: {
    agencies: number;
    working: number;
    callsInFlight: number;
    deliveredToday: number;
    applicationsToday: number;
    closingPct: number | null;
  };
  agencies: LiveBoardAgency[];
  includingNonProduction: boolean;
}

export interface LiveBoardDeps {
  prisma: Pick<PrismaClient, 'tenant' | 'call' | 'insuranceCarrierApplication'>;
  now?: Date;
  includeNonProduction?: boolean;
}

/** `groupBy` rows to a tenantId -> count map. */
function tally(
  rows: Array<{ tenantId: string | null; _count: { _all: number } }>
): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    if (row.tenantId) out.set(row.tenantId, row._count._all);
  }
  return out;
}

/**
 * Null, not zero, when nothing has been delivered.
 *
 * Zero is a real and serious reading -- calls taken, nothing written -- and an
 * operator has to be able to tell it from an agency that has not been sent a
 * call yet. The same distinction `measureClosing` draws, for the same reason.
 */
export function closing(applications: number, delivered: number): number | null {
  if (delivered <= 0) return null;
  return Math.round((applications / delivered) * 10000) / 100;
}

export async function getLiveBoard(deps: LiveBoardDeps): Promise<LiveBoard> {
  const { prisma } = deps;
  const now = deps.now ?? new Date();
  const includeNonProduction = deps.includeNonProduction === true;

  const day = currentCalendarDay(now);
  const bounds = calendarDayBounds(day);
  const inFlightSince = new Date(now.getTime() - IN_FLIGHT_WINDOW_MS);

  /*
   * Non-production tenants are read only when asked for, and are excluded from
   * the totals either way -- hiding the row and excluding the number are two
   * decisions and only one of them is a toggle. The same rule the delivery
   * overview applies, deliberately, so the two cross-agency screens never
   * disagree about which agencies exist.
   */
  const tenants = await prisma.tenant.findMany({
    where: {
      status: 'ACTIVE',
      ...(includeNonProduction ? {} : { isNonProduction: false }),
    },
    select: { id: true, name: true, slug: true, isNonProduction: true },
    orderBy: { name: 'asc' },
  });

  const tenantIds = tenants.map(t => t.id);

  if (tenantIds.length === 0) {
    return {
      generatedAt: now.toISOString(),
      day,
      timeZone: PLATFORM_TIME_ZONE,
      totals: {
        agencies: 0,
        working: 0,
        callsInFlight: 0,
        deliveredToday: 0,
        applicationsToday: 0,
        closingPct: null,
      },
      agencies: [],
      includingNonProduction: includeNonProduction,
    };
  }

  const inFlightWhere: Prisma.CallWhereInput = {
    tenantId: { in: tenantIds },
    status: { in: [...IN_FLIGHT_STATUSES] },
    endedAt: null,
    createdAt: { gte: inFlightSince },
  };

  /*
   * The delivered and submitted predicates are taken from the measurement
   * module and then widened from one tenant to the set. Spreading its object
   * and overriding `tenantId` keeps ONE definition of what counts -- restating
   * the clauses here with an `in` of their own is exactly how the dashboard and
   * the invoice would drift apart.
   */
  const deliveredWhere: Prisma.CallWhereInput = {
    ...deliveredCallWhere(tenantIds[0], bounds),
    tenantId: { in: tenantIds },
  };
  const submittedWhere: Prisma.InsuranceCarrierApplicationWhereInput = {
    ...submittedApplicationWhere(tenantIds[0], bounds),
    tenantId: { in: tenantIds },
  };

  const [inFlightRows, deliveredRows, submittedRows] = await Promise.all([
    prisma.call.groupBy({ by: ['tenantId'], where: inFlightWhere, _count: { _all: true } }),
    prisma.call.groupBy({ by: ['tenantId'], where: deliveredWhere, _count: { _all: true } }),
    prisma.insuranceCarrierApplication.groupBy({
      by: ['tenantId'],
      where: submittedWhere,
      _count: { _all: true },
    }),
  ]);

  const inFlight = tally(inFlightRows);
  const delivered = tally(deliveredRows);
  const submitted = tally(submittedRows);

  const agencies: LiveBoardAgency[] = tenants.map(tenant => {
    const callsInFlight = inFlight.get(tenant.id) ?? 0;
    const deliveredToday = delivered.get(tenant.id) ?? 0;
    const applicationsToday = submitted.get(tenant.id) ?? 0;
    return {
      tenantId: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      isNonProduction: tenant.isNonProduction,
      callsInFlight,
      deliveredToday,
      applicationsToday,
      closingPct: closing(applicationsToday, deliveredToday),
    };
  });

  // The totals count production agencies only, even when the others are shown.
  const counted = agencies.filter(a => !a.isNonProduction);
  const totalDelivered = counted.reduce((sum, a) => sum + a.deliveredToday, 0);
  const totalApplications = counted.reduce((sum, a) => sum + a.applicationsToday, 0);

  return {
    generatedAt: now.toISOString(),
    day,
    timeZone: PLATFORM_TIME_ZONE,
    totals: {
      agencies: counted.length,
      /*
       * "Working" is what an operator scans for first: agencies with a call up
       * or something already written today. An agency at zero on both is the
       * one worth walking over to, and counting them here means nobody has to
       * read every row to find it.
       */
      working: counted.filter(a => a.callsInFlight > 0 || a.deliveredToday > 0).length,
      callsInFlight: counted.reduce((sum, a) => sum + a.callsInFlight, 0),
      deliveredToday: totalDelivered,
      applicationsToday: totalApplications,
      closingPct: closing(totalApplications, totalDelivered),
    },
    agencies,
    includingNonProduction: includeNonProduction,
  };
}
