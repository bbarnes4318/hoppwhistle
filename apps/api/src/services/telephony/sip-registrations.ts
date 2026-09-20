/**
 * Which agents' softphones are actually registered with FreeSWITCH.
 *
 * ── The defect this exists for ───────────────────────────────────────────────
 *
 * Routing gates an agent on their live call count and NOTHING else. The comment
 * in `services/routing.ts` says why, and it was right at the time:
 *
 *     We deliberately do NOT exclude an agent merely for being offline or DND
 *     -- the availability flag is often stale and over-blocks transfers.
 *
 * That flag is a Redis key the browser writes. It goes stale when a tab is
 * closed, a laptop sleeps, or the network drops, so treating it as truth
 * silenced agents who were sitting there ready. Ignoring it was the lesser
 * evil.
 *
 * But the other side of that trade is real and is recorded in this codebase
 * too, in `routes/agent-phone.ts`: an agent on a network that blocks port 7443
 * fetched credentials fine, never opened the WebSocket, never sent a REGISTER,
 * "and every call to them died with USER_NOT_REGISTERED while the dashboard
 * still showed them available."
 *
 * Both failures come from asking the wrong thing. Neither a browser-written
 * flag nor a credential fetch is evidence that a phone can receive a call.
 * FreeSWITCH's registration table IS that evidence: it is the same fact the
 * dialplan consults with `sofia_contact` before it bridges, and it cannot go
 * stale in the direction that matters, because an expired registration is
 * removed.
 *
 * ── One lookup per window, not one per agent ─────────────────────────────────
 *
 * The naive shape is `sofia_contact` per candidate, which is an ESL round trip
 * per agent per call -- latency on the one path where it is least affordable,
 * multiplied by roster size. This asks once for the whole registration table
 * and caches it in Redis for a few seconds, so a burst of calls shares a single
 * lookup and a busy queue costs one ESL call every TTL rather than hundreds.
 *
 * ── "Cannot tell" is not "not registered" ────────────────────────────────────
 *
 * Every failure path returns null, and null means DO NOT FILTER. ESL being
 * unreachable, a parse that finds nothing, a Redis miss on a cold start: none
 * of those are evidence that an agent's phone is down, and excluding every
 * agent on the strength of them would be an outage dressed up as a safety
 * feature. The set is only ever used to exclude an extension that FreeSWITCH
 * positively says it does not have.
 */

import { logger } from '../../lib/logger.js';
import { freeswitchService } from '../freeswitch-service.js';
import { getRedisClient } from '../redis.js';

/** The sofia profile agents register to. `internal` is the one in the image. */
const PROFILE = process.env.FREESWITCH_INTERNAL_PROFILE || 'internal';

/** Where the parsed set is cached, and for how long. */
const CACHE_KEY = 'sip:registrations';

/**
 * Seconds. Short enough that an agent who has just registered starts receiving
 * calls without a visible wait, long enough that a queue running at a call a
 * second costs one ESL lookup rather than sixty.
 *
 * The cost of it being stale is bounded and asymmetric, which is what makes a
 * cache acceptable here at all: a registration that has expired within the
 * window means one call rings a dead extension, exactly as it does today. A
 * registration that arrived within the window means one agent waits a few
 * seconds for their first call.
 */
const CACHE_TTL_SECONDS = Math.max(
  1,
  parseInt(process.env.SIP_REGISTRATION_CACHE_TTL_SECONDS || '5', 10) || 5
);

/**
 * The usernames in a `sofia status profile <p> reg` dump.
 *
 * The block per registration carries both `User: 1000@domain` and
 * `Auth-User: 1000`. Both are read because the two disagree in deployments
 * that register with a full URI, and a username this misses is an agent
 * wrongly excluded -- the one outcome this module must not produce.
 */
export function parseRegisteredExtensions(body: string): Set<string> {
  const found = new Set<string>();

  for (const line of body.split('\n')) {
    const user = /^\s*User:\s*(\S+)/.exec(line);
    if (user) {
      found.add(user[1].split('@')[0].trim());
      continue;
    }
    const auth = /^\s*Auth-User:\s*(\S+)/.exec(line);
    if (auth) found.add(auth[1].trim());
  }

  return found;
}

/** Read the cached set, or null when there is nothing usable cached. */
async function readCache(): Promise<Set<string> | null> {
  try {
    const raw = await getRedisClient().get(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return new Set(parsed.map(String));
  } catch {
    // A cache that cannot be read is a cache miss, not a failure.
    return null;
  }
}

async function writeCache(extensions: Set<string>): Promise<void> {
  try {
    await getRedisClient().setex(CACHE_KEY, CACHE_TTL_SECONDS, JSON.stringify([...extensions]));
  } catch {
    // Not caching is slower, not wrong.
  }
}

/**
 * Every extension FreeSWITCH currently holds a registration for.
 *
 * Returns null when it cannot be established, which callers must read as "do
 * not filter" rather than as an empty set. The two are opposite instructions
 * and conflating them takes every agent off the queue.
 */
export async function getRegisteredExtensions(): Promise<Set<string> | null> {
  const cached = await readCache();
  if (cached) return cached;

  let body: string;
  try {
    body = await freeswitchService.executeApi('sofia', `status profile ${PROFILE} reg`);
  } catch (error) {
    logger.warn({
      msg: 'SIP-registrations: could not read the registration table; not filtering on it',
      error: (error as Error).message,
    });
    return null;
  }

  const extensions = parseRegisteredExtensions(body);

  /*
   * An empty parse is treated as "cannot tell", not as "nobody is registered".
   *
   * The two are indistinguishable from the output alone -- a profile with no
   * registrations and a profile name that does not exist both produce a dump
   * with no `User:` lines -- and the cost of guessing wrong is the entire
   * agency off the queue. A genuinely empty registrar means no agent could
   * have taken the call anyway, so nothing is lost by declining to filter.
   */
  if (extensions.size === 0) {
    logger.info({
      msg: 'SIP-registrations: no registrations parsed; not filtering on it',
      profile: PROFILE,
    });
    return null;
  }

  await writeCache(extensions);
  return extensions;
}
