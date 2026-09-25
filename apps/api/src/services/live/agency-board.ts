import type { Prisma, PrismaClient } from '@prisma/client';

import {
  PLATFORM_TIME_ZONE,
  calendarDayBounds,
  currentCalendarDay,
  type CalendarDayKey,
} from '../rating/calendar-day.js';
import { deliveredCallWhere, submittedApplicationWhere } from '../rating/measurement.js';

import { IN_FLIGHT_STATUSES, IN_FLIGHT_WINDOW_MS, closing } from './platform-board.js';

/**
 * The agency's own Live Board: its floor right now, broken out by buyer.
 *
 * ── Why a separate function and not a filter on `getLiveBoard` ───────────────
 *
 * `getLiveBoard` is the CROSS-AGENCY board: one row per agency, behind
 * `requirePlatformAdmin`. An agency principal asking the same question wants
 * its own totals and the rows beneath them, and the tenant is a fact of the
 * session rather than something to filter a platform-wide read down to. So the
 * tenant arrives as an argument -- the caller reads it from
 * `getActingTenantId`, never from a query string -- and every query below is
 * scoped to it from the start.
 *
 * What is shared is what must not drift: the in-flight predicate and its
 * window, and `deliveredCallWhere` / `submittedApplicationWhere` from the
 * measurement module the nightly settlement bills from. Nothing here restates
 * them.
 *
 * ── Rows by buyer ────────────────────────────────────────────────────────────
 *
 * One row per `Buyer` belonging to the tenant. Calls group on `Call.buyerId`;
 * applications have no buyer of their own, so they are attributed through the
 * call they came from (`InsuranceCarrierApplication.callId`). A call with no
 * buyer, or an application with no linked call, lands in a final
 * "Unattributed" row, so every column sums to the totals above it. A tenant
 * with no buyers at all gets one row for the agency itself.
 *
 * ── No non-production filter ─────────────────────────────────────────────────
 *
 * The platform board hides demo and fixture tenants from its totals. That rule
 * is about NetEnroll comparing agencies; an agency on a non-production tenant
 * reading its own floor still sees its own floor.
 */

export const UNATTRIBUTED_ROW_ID = 'unattributed';

export interface AgencyLiveBoardRow {
  /** The buyer's id, the tenant's id for the single agency row, or `unattributed`. */
  id: string;
  name: string;
  kind: 'buyer' | 'agency' | 'unattributed';
  callsInFlight: number;
  deliveredToday: number;
  applicationsToday: number;
  /** A percentage: 8.5 means 8.5%. Null when nothing was delivered yet today. */
  closingPct: number | null;
}

export interface AgencyLiveBoard {
  generatedAt: string;
  day: CalendarDayKey;
  timeZone: string;
  totals: {
    callsInFlight: number;
    deliveredToday: number;
    applicationsToday: number;
    closingPct: number | null;
  };
  rows: AgencyLiveBoardRow[];
}

export interface AgencyLiveBoardDeps {
  prisma: Pick<PrismaClient, 'tenant' | 'buyer' | 'call' | 'insuranceCarrierApplication'>;
  now?: Date;
}

/** `groupBy` rows to a buyerId -> count map, with null buyers under `null`. */
function tallyByBuyer(
  rows: Array<{ buyerId: string | null; _count: { _all: number } }>
): Map<string | null, number> {
  const out = new Map<string | null, number>();
  for (const row of rows) {
    out.set(row.buyerId, (out.get(row.buyerId) ?? 0) + row._count._all);
  }
  return out;
}

function row(
  id: string,
  name: string,
  kind: AgencyLiveBoardRow['kind'],
  callsInFlight: number,
  deliveredToday: number,
  applicationsToday: number
): AgencyLiveBoardRow {
  return {
    id,
    name,
    kind,
    callsInFlight,
    deliveredToday,
    applicationsToday,
    closingPct: closing(applicationsToday, deliveredToday),
  };
}

export async function getAgencyLiveBoard(
  tenantId: string,
  deps: AgencyLiveBoardDeps
): Promise<AgencyLiveBoard> {
  const { prisma } = deps;
  const now = deps.now ?? new Date();

  const day = currentCalendarDay(now);
  const bounds = calendarDayBounds(day);
  const inFlightSince = new Date(now.getTime() - IN_FLIGHT_WINDOW_MS);

  const inFlightWhere: Prisma.CallWhereInput = {
    tenantId,
    status: { in: [...IN_FLIGHT_STATUSES] },
    endedAt: null,
    createdAt: { gte: inFlightSince },
  };

  const [tenant, buyers, inFlightRows, deliveredRows, submitted] = await Promise.all([
    prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, name: true } }),
    prisma.buyer.findMany({
      where: { tenantId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
    prisma.call.groupBy({ by: ['buyerId'], where: inFlightWhere, _count: { _all: true } }),
    prisma.call.groupBy({
      by: ['buyerId'],
      where: deliveredCallWhere(tenantId, bounds),
      _count: { _all: true },
    }),
    prisma.insuranceCarrierApplication.findMany({
      where: submittedApplicationWhere(tenantId, bounds),
      select: { callId: true },
    }),
  ]);

  /*
   * Applications to buyers, through the call each one came from.
   *
   * There is no relation between the two models to join on, so this is a
   * second read of just the linked calls. Scoped to the tenant as well as to
   * the ids: an application's `callId` is a column somebody wrote, and a call
   * in another agency must never be what attributes this agency's application.
   */
  const linkedCallIds = [
    ...new Set(submitted.map(a => a.callId).filter((id): id is string => id !== null)),
  ];
  const linkedCalls =
    linkedCallIds.length === 0
      ? []
      : await prisma.call.findMany({
          where: { tenantId, id: { in: linkedCallIds } },
          select: { id: true, buyerId: true },
        });
  const buyerOfCall = new Map(linkedCalls.map(c => [c.id, c.buyerId]));

  const applications = new Map<string | null, number>();
  for (const application of submitted) {
    const buyerId = application.callId ? (buyerOfCall.get(application.callId) ?? null) : null;
    applications.set(buyerId, (applications.get(buyerId) ?? 0) + 1);
  }

  const inFlight = tallyByBuyer(inFlightRows);
  const delivered = tallyByBuyer(deliveredRows);

  const sum = (m: Map<string | null, number>): number =>
    [...m.values()].reduce((a, b) => a + b, 0);

  const totals = {
    callsInFlight: sum(inFlight),
    deliveredToday: sum(delivered),
    applicationsToday: submitted.length,
    closingPct: closing(submitted.length, sum(delivered)),
  };

  const base = {
    generatedAt: now.toISOString(),
    day,
    timeZone: PLATFORM_TIME_ZONE,
    totals,
  };

  if (buyers.length === 0) {
    return {
      ...base,
      rows: [
        row(
          tenantId,
          tenant?.name ?? 'Your agency',
          'agency',
          totals.callsInFlight,
          totals.deliveredToday,
          totals.applicationsToday
        ),
      ],
    };
  }

  const known = new Set(buyers.map(b => b.id));
  const rows = buyers.map(buyer =>
    row(
      buyer.id,
      buyer.name,
      'buyer',
      inFlight.get(buyer.id) ?? 0,
      delivered.get(buyer.id) ?? 0,
      applications.get(buyer.id) ?? 0
    )
  );

  /*
   * Everything no listed buyer accounts for: a null buyerId, an application
   * with no linked call, and -- defensively -- a buyerId that names no buyer of
   * this tenant. Computed as what is left over rather than by matching nulls,
   * so the columns sum to the totals by construction.
   */
  const leftover = (m: Map<string | null, number>): number =>
    [...m.entries()].reduce((a, [id, n]) => (id !== null && known.has(id) ? a : a + n), 0);

  const unattributed = row(
    UNATTRIBUTED_ROW_ID,
    'Unattributed',
    'unattributed',
    leftover(inFlight),
    leftover(delivered),
    leftover(applications)
  );
  if (
    unattributed.callsInFlight > 0 ||
    unattributed.deliveredToday > 0 ||
    unattributed.applicationsToday > 0
  ) {
    rows.push(unattributed);
  }

  return { ...base, rows };
}
