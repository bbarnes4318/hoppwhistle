import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { FastifyInstance, FastifyRequest } from 'fastify';

import { getPrismaClient } from '../lib/prisma.js';
import type { AuthenticatedUser } from '../middleware/auth.js';
import { getRedisClient } from '../services/redis.js';

import { getUserProfile } from './index.js';

type AuthRequest = FastifyRequest & { user?: AuthenticatedUser };

/**
 * GET /api/v1/live/metrics — the single source for the LiveStrip.
 *
 * Scoped from the JWT the same way /api/v1/dashboard/stats is: getUserProfile
 * derives admin / publisher / buyer from the user's roles and their linked
 * publisherId / buyerId, and every query is additionally filtered by tenantId.
 * A publisher can only ever see their own calls; there is no query parameter
 * that widens the scope.
 *
 * COST. Two aggregate queries per request, both index-covered:
 *   - in flight       @@index([tenantId, createdAt]) (+ publisherId/buyerId variants)
 *   - the window roll-up  same indexes
 * No N+1, no per-row work, and the result is cached in Redis for 3s so a fleet
 * of 5s pollers collapses onto roughly one query pair per tenant per 3s.
 *
 * NULLS. Any field that cannot be sourced correctly returns null, never 0 —
 * the strip renders null as a muted em dash, and a fabricated zero on a screen
 * where someone watches their own money is worse than an absent number. Every
 * null is explained in the `unavailable` map on the response.
 */

/**
 * The subset of the generated Call delegate this route uses. Derived from
 * PrismaClient rather than hand-declared, so the argument and result types come
 * straight from schema.prisma — a renamed column is a compile error here.
 *
 * It is a Pick rather than the whole client purely so computeLiveMetrics can be
 * driven by a fake in the unit tests without a database.
 */
export type CallDelegate = Pick<PrismaClient['call'], 'count' | 'aggregate' | 'groupBy'>;

/** Rates are fractions in [0,1], not percentages. Named so at the call site. */
type Fraction = number;

interface LiveMetricsResponse {
  role: 'admin' | 'publisher' | 'buyer';
  generatedAt: string;
  window: { inFlightSince: string; hourSince: string; todaySince: string };
  callsInFlight: number | null;
  answerRateHour?: Fraction | null;
  abandonRateHour?: Fraction | null;
  revenueRunRateHour?: string | null;
  billableToday?: number | null;
  earningsToday?: string | null;
  spendToday?: string | null;
  capToday?: string | null;
  billableRate?: Fraction | null;
  /** field -> why it is null. Present only for fields that are actually null. */
  unavailable: Record<string, string>;
  cached: boolean;
}

/**
 * A call with no endedAt but created hours ago is a stuck row, not a live call.
 * Bounding the in-flight window keeps one crashed leg from parking a wrong
 * number on every operator's screen indefinitely.
 */
const IN_FLIGHT_MAX_AGE_MS = 4 * 60 * 60 * 1000;

/**
 * The "hour" metrics use a TRAILING 60 minutes rather than the current clock
 * hour. At 12:02 a clock-hour answer rate is computed from whatever handful of
 * calls happened in two minutes and swings wildly; a trailing window is stable
 * minute to minute and is what "run rate" means anyway. The window is returned
 * on the response so the client can label it honestly.
 */
const HOUR_MS = 60 * 60 * 1000;

const CACHE_TTL_SECONDS = 3;

const ABANDON_UNAVAILABLE =
  'No hangup party is recorded. Abandon rate is defined as the caller hanging up ' +
  'before answer over total offered, and nothing in the schema says who ended a ' +
  'call: Call has status/answeredAt/endedAt/missedCall but no hangup cause, and ' +
  'neither CallLeg nor Cdr carries one either. Deriving it as 100 minus the answer ' +
  'rate would count every busy, failed and no-answer call as an abandon. To source ' +
  'it, CallLeg needs a termination party and cause (e.g. hangupParty ' +
  "'CALLER'|'CALLEE'|'SYSTEM' plus a SIP cause code) on the inbound leg — CallLeg " +
  'rather than Call, because a call has several legs and it is the inbound one whose ' +
  'termination defines an abandon.';

const CAP_UNAVAILABLE =
  'No per-buyer spend cap exists. The only cap in the schema is ' +
  'BuyerEndpoint.maxCap, which is a CALL COUNT per endpoint per CapPeriod, not a ' +
  'money limit, so it cannot bound spendToday. Either add a money cap ' +
  '(e.g. Buyer.dailySpendCap Decimal?) or change the metric to calls-against-cap, ' +
  'which is computable today from BuyerEndpoint.maxCap where capPeriod = DAY.';

/** Prisma Decimal | null -> fixed string | null, never a float. */
function decimalToString(value: Prisma.Decimal | null, places = 4): string | null {
  if (value === null || value === undefined) return null;
  // Decimal.toFixed, never Number() — a large payout loses precision as a float.
  return value.toFixed(places);
}

/** Rate with an explicit zero-denominator case: no calls means no rate, not 0%. */
function rate(numerator: number, denominator: number): Fraction | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

export type LiveRole = LiveMetricsResponse['role'];

export interface LiveScopeProfile {
  isAdminOrOwner: boolean;
  publisherId: string | null;
  buyerId: string | null;
}

/**
 * Effective role. Precedence matches the client's own derivation: admin, then
 * publisher, then buyer. A user linked to both parties is treated as a
 * publisher. Returns null when the account is neither an admin nor linked to a
 * party — there is nothing to scope such a request to, and answering it with
 * tenant-wide numbers would be the leak this endpoint exists to avoid.
 */
export function resolveRole(profile: LiveScopeProfile): LiveRole | null {
  if (profile.isAdminOrOwner) return 'admin';
  if (profile.publisherId) return 'publisher';
  if (profile.buyerId) return 'buyer';
  return null;
}

/**
 * Computes the whole response from an injected delegate. Exported so the tests
 * can drive it with a fake and assert on the exact `where` clauses — the
 * scoping here is a security boundary, and a test that cannot see the query
 * cannot prove a publisher is filtered to their own calls.
 */
export async function computeLiveMetrics(
  calls: CallDelegate,
  opts: { tenantId: string; role: LiveRole; profile: LiveScopeProfile; now?: Date }
): Promise<LiveMetricsResponse> {
  const { tenantId, role, profile } = opts;
  const now = opts.now ?? new Date();

  const inFlightSince = new Date(now.getTime() - IN_FLIGHT_MAX_AGE_MS);
  const hourSince = new Date(now.getTime() - HOUR_MS);
  const todaySince = new Date(now);
  todaySince.setHours(0, 0, 0, 0);

  const scope: Prisma.CallWhereInput =
    role === 'publisher'
      ? { publisherId: profile.publisherId }
      : role === 'buyer'
        ? { buyerId: profile.buyerId }
        : {};

  const inFlightWhere: Prisma.CallWhereInput = {
    tenantId,
    ...scope,
    // Still up: dialling, ringing or connected, with no end time recorded.
    status: { in: ['INITIATED', 'RINGING', 'ANSWERED'] },
    endedAt: null,
    createdAt: { gte: inFlightSince },
  };

  const windowSince = role === 'admin' ? hourSince : todaySince;
  const windowWhere: Prisma.CallWhereInput = {
    tenantId,
    ...scope,
    createdAt: { gte: windowSince },
  };

  const window = {
    inFlightSince: inFlightSince.toISOString(),
    hourSince: hourSince.toISOString(),
    todaySince: todaySince.toISOString(),
  };

  const unavailable: Record<string, string> = {};

  if (role === 'admin') {
    /*
     * One aggregate for the whole window. `_count.answeredAt` counts NON-NULL
     * values, which is exactly "calls that were answered" — so offered,
     * answered and revenue all come back from a single query.
     */
    const [callsInFlight, agg] = await Promise.all([
      calls.count({ where: inFlightWhere }),
      calls.aggregate({
        where: windowWhere,
        _count: { _all: true, answeredAt: true },
        _sum: { revenue: true },
      }),
    ]);

    const offered = agg._count._all;
    const answerRateHour = rate(agg._count.answeredAt, offered);
    if (answerRateHour === null) {
      unavailable.answerRateHour = 'No calls offered in the last 60 minutes.';
    }
    unavailable.abandonRateHour = ABANDON_UNAVAILABLE;

    return {
      role: 'admin',
      generatedAt: now.toISOString(),
      window,
      callsInFlight,
      answerRateHour,
      abandonRateHour: null,
      // The trailing 60 minutes of revenue IS the hourly run rate, so nothing
      // is extrapolated and a thin partial hour cannot spike it.
      revenueRunRateHour: decimalToString(agg._sum.revenue) ?? '0.0000',
      unavailable,
      cached: false,
    };
  }

  /*
   * Publisher and buyer share a shape: today's calls grouped by `billable`
   * yields the total, the billable count and the money in ONE query, because
   * every row falls into exactly one of the two groups.
   */
  const [callsInFlight, groups] = await Promise.all([
    calls.count({ where: inFlightWhere }),
    calls.groupBy({
      by: ['billable'],
      where: windowWhere,
      _count: { _all: true },
      _sum: role === 'publisher' ? { publisherPayoutAmount: true } : { buyerBillableAmount: true },
    }),
  ]);

  let total = 0;
  let billableCount = 0;
  // Accumulated as a Decimal, not a float. Only two groups reach this today,
  // but summing currency through Number() is how a cent goes missing, and this
  // number is what a publisher sees as their earnings.
  let money = new Prisma.Decimal(0);

  for (const g of groups) {
    total += g._count._all;
    if (g.billable) billableCount += g._count._all;
    /*
     * `_sum` is a union of the two possible shapes — Prisma types it by which
     * _sum was requested, and only one key is actually present. Narrowing with
     * `in` reads whichever one came back. The role check alone is not enough:
     * it tells TypeScript nothing about the object, and reading the absent key
     * would silently yield undefined.
     */
    const sum =
      'publisherPayoutAmount' in g._sum ? g._sum.publisherPayoutAmount : g._sum.buyerBillableAmount;
    if (sum !== null) money = money.add(sum);
  }

  const billableRate = rate(billableCount, total);
  if (billableRate === null) unavailable.billableRate = 'No calls yet today.';

  if (role === 'publisher') {
    return {
      role: 'publisher',
      generatedAt: now.toISOString(),
      window,
      callsInFlight,
      billableToday: billableCount,
      earningsToday: money.toFixed(4),
      billableRate,
      unavailable,
      cached: false,
    };
  }

  unavailable.capToday = CAP_UNAVAILABLE;
  return {
    role: 'buyer',
    generatedAt: now.toISOString(),
    window,
    callsInFlight,
    spendToday: money.toFixed(4),
    capToday: null,
    billableRate,
    unavailable,
    cached: false,
  };
}

export async function registerLiveMetricsRoutes(fastify: FastifyInstance) {
  await Promise.resolve();

  fastify.get('/api/v1/live/metrics', async (request, reply) => {
    const user = (request as AuthRequest).user;
    const tenantId = user?.tenantId;

    if (!tenantId) {
      return reply
        .code(401)
        .send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
    }

    const prisma = getPrismaClient();
    const profile = (await getUserProfile(request, prisma)) as LiveScopeProfile;

    const role = resolveRole(profile);
    if (role === null) {
      return reply.code(403).send({
        error: {
          code: 'FORBIDDEN',
          message: 'This account is not linked to a publisher or buyer.',
        },
      });
    }

    const scopeId = profile.publisherId ?? profile.buyerId ?? 'tenant';
    const cacheKey = `live:metrics:v1:${tenantId}:${role}:${scopeId}`;

    // Redis being down must never fail the request: a cache miss is only a
    // little more database work, and this is on every page for every user.
    try {
      const hit = await getRedisClient().get(cacheKey);
      if (hit) return { ...(JSON.parse(hit) as LiveMetricsResponse), cached: true };
    } catch {
      // fall through and compute
    }

    const body = await computeLiveMetrics(prisma.call, { tenantId, role, profile });

    try {
      await getRedisClient().set(cacheKey, JSON.stringify(body), 'EX', CACHE_TTL_SECONDS);
    } catch {
      // ignore — the next request just recomputes
    }

    return body;
  });
}
