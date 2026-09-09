/**
 * GET /api/v1/live/strip — the source for the strip above every page.
 *
 * ── Why this is not `/api/v1/live/metrics` ───────────────────────────────────
 *
 * `/api/v1/live/metrics` answers publisher and buyer questions -- calls in
 * flight, billable calls, earnings, spend against a call cap -- and both of
 * those roles still exist in this application. It is left exactly as it was,
 * serving exactly them.
 *
 * This is a separate endpoint rather than three more shapes bolted onto that
 * one, for a reason that is not tidiness:
 *
 *   THE PLATFORM READING HAS NO ACTING TENANT. `/live/metrics` resolves a
 *   tenant first and refuses without one, which is right for every role it
 *   serves. NetEnroll staff who have entered no agency are precisely the
 *   caller it must refuse, and they are precisely the caller this endpoint
 *   exists to answer. Adding the platform shape there would mean putting a
 *   "unless the caller is staff" branch inside a tenant gate, which is the one
 *   place in this codebase that must stay a single unconditional rule.
 *
 * Two further consequences, both good: the two endpoints cache on different
 * clocks (the marketplace figures move by the second, these move by the call
 * and by the application), and the strip's own poll never asks an
 * agency-scoped question when there is no agency to ask it of.
 *
 * ── Scope is decided here, from the session, and nowhere else ────────────────
 *
 * No path segment, no query parameter, no header. `request.user` is populated
 * only by an authentication path that verified a credential, and the acting
 * tenant on it is the row a platform operator wrote when they entered an
 * agency -- see lib/tenant-context.ts. The client does not tell this route
 * which reading it wants; it is told, and it renders what it is given.
 *
 * ── Cost ─────────────────────────────────────────────────────────────────────
 *
 * This renders on every page for every user. At the launch volumes that is 45
 * agents and a handful of principals on one agency and 15 on the other, each
 * polling every thirty seconds while their tab is in front of them.
 *
 *   agency    cached per tenant. Every principal on a floor shares one entry.
 *   agent     cached per user, because it IS per user. Four indexed counts.
 *   platform  cached once for the whole platform, for thirty seconds. It is
 *             the expensive one and it is read by the fewest people.
 *
 * Redis being down never fails the request: a miss is a little more database
 * work, and this is on every page.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { getPrismaClient } from '../lib/prisma.js';
import { getActingTenantId, getActingUserId, replyTenantRefusal } from '../lib/tenant-context.js';
import { getAgencyStrip, getAgentStrip, getPlatformStrip } from '../services/billing/live-strip.js';
import type { LiveStripView } from '../services/billing/live-strip.js';
import { getRedisClient } from '../services/redis.js';

/**
 * The roles that see money.
 *
 * The same line the portal draws: `canViewBilling` in the web app is full
 * access and nothing else. An agent is served the agent reading, which loads no
 * rate, balance, overrun or charge at all.
 */
const AGENCY_PRINCIPAL_ROLES = ['ADMIN', 'OWNER'];

/** Long enough to collapse a floor of tabs; short enough to still be today. */
const AGENCY_TTL_SECONDS = 10;
const AGENT_TTL_SECONDS = 10;
/** The expensive reading, and the one with the fewest readers. */
const PLATFORM_TTL_SECONDS = 30;

interface StripPrincipal {
  userId?: string;
  roles?: string[];
  isPlatformAdmin?: boolean;
}

const NO_ROLE_FOR_STRIP =
  'This account is a member of an agency but is neither an administrator nor ' +
  'an agent, so there is no reading of the day to show it.';

/**
 * Computations already running in this process, by cache key.
 *
 * A Redis TTL collapses requests that arrive AFTER one has finished. It does
 * nothing for the ones that arrive WHILE it is running, and that is the case
 * this endpoint actually has: a floor opens its tabs at the start of a shift,
 * the cache expires, and every one of them misses within the same few hundred
 * milliseconds. Each miss then runs the whole computation -- for the platform
 * reading, a cross-agency overview that fires a dozen queries per agency.
 *
 * That is not merely wasteful. Prisma's connection pool is small (roughly
 * `cpus * 2 + 1`), so a handful of concurrent overviews can hold every
 * connection and leave `/api/v1/platform/context` waiting behind them -- which
 * the client reads as "not staff" and turns into a page of refusals. That
 * failure has happened here before, from duplicate auth requests; see
 * `hooks/use-platform-context.tsx`.
 *
 * So concurrent misses on the same key share one computation. The entry is
 * removed as soon as it settles, successfully or not: a rejected promise left
 * in the map would serve the same failure to every later caller.
 */
const inFlight = new Map<string, Promise<unknown>>();

/**
 * Read a cached body, compute at most once per key at a time, and write it back.
 *
 * Every Redis call is wrapped: an outage costs a query, never a page.
 */
async function cached<T>(key: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
  try {
    const hit = await getRedisClient().get(key);
    if (hit) return JSON.parse(hit) as T;
  } catch {
    // fall through and compute
  }

  const running = inFlight.get(key);
  if (running) return running as Promise<T>;

  const work = (async (): Promise<T> => {
    const body = await compute();

    try {
      await getRedisClient().set(key, JSON.stringify(body), 'EX', ttlSeconds);
    } catch {
      // ignore -- the next request recomputes
    }

    return body;
  })().finally(() => inFlight.delete(key));

  inFlight.set(key, work);
  return work;
}

// eslint-disable-next-line @typescript-eslint/require-await -- plugin signature
export async function registerLiveStripRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get(
    '/api/v1/live/strip',
    async (request: FastifyRequest, reply: FastifyReply): Promise<LiveStripView | undefined> => {
      const principal = (request as FastifyRequest & { user?: StripPrincipal }).user;
      const userId = getActingUserId(request);
      const tenantId = getActingTenantId(request);

      // Nobody is authenticated. The only refusal this route sends.
      if (!principal || !userId) {
        void replyTenantRefusal(request, reply);
        return undefined;
      }

      const prisma = getPrismaClient();

      /*
       * NetEnroll staff who have entered no agency. This is the branch the
       * separate endpoint exists for: the cross-agency reading is the correct
       * answer here, not a refusal to be retried every thirty seconds.
       */
      if (!tenantId) {
        if (principal.isPlatformAdmin !== true) {
          void replyTenantRefusal(request, reply);
          return undefined;
        }

        return cached('live:strip:v1:platform', PLATFORM_TTL_SECONDS, () =>
          getPlatformStrip({ prisma })
        );
      }

      const roles = Array.isArray(principal.roles) ? principal.roles : [];

      if (roles.some(role => AGENCY_PRINCIPAL_ROLES.includes(role))) {
        return cached(`live:strip:v1:agency:${tenantId}`, AGENCY_TTL_SECONDS, () =>
          getAgencyStrip(tenantId, { prisma })
        );
      }

      if (roles.includes('AGENT')) {
        return cached(`live:strip:v1:agent:${tenantId}:${userId}`, AGENT_TTL_SECONDS, () =>
          getAgentStrip(tenantId, userId, { prisma })
        );
      }

      return { scope: 'none', generatedAt: new Date().toISOString(), reason: NO_ROLE_FOR_STRIP };
    }
  );
}
