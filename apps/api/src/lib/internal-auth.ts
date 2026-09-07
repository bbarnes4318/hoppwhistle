/**
 * The shared-secret guard for machine callers on the internal network.
 *
 * ── What it is for ───────────────────────────────────────────────────────────
 *
 * A handful of endpoints are called by FreeSWITCH and by cron, not by a person
 * or a browser. They cannot present a JWT or an agency API key, and they derive
 * their tenant from the resource being addressed -- the DID, the route row --
 * which is the correct shape for a webhook. What they have never had is any
 * proof that the caller is FreeSWITCH.
 *
 * `docs/TENANT_ISOLATION_AUDIT.md` §4 recorded them as "NO AUTH -- internal
 * network only", noted that this is a deployment assumption rather than an
 * enforced one, and that they are reachable through nginx today. That is the
 * hole this closes.
 *
 * ── Why it is a shared secret and not something better ───────────────────────
 *
 * The callers are FreeSWITCH's `mod_curl`, from a Lua script and from dialplan
 * `${curl(...)}` expressions. mod_curl can send a URL, a method and a body. It
 * cannot compute an HMAC, it cannot hold a client certificate, and -- see below
 * -- it cannot set a request header. A shared secret is the strongest thing
 * that fits through that pipe.
 *
 * ── The header, and the query parameter that has to exist beside it ──────────
 *
 * `X-Internal-Key` is the way in. Every caller that CAN send a header does:
 * `upload-recording.sh` and the other shell callers use real curl.
 *
 * mod_curl cannot. Its syntax is
 * `curl <url> [headers|json] [get|head|post [body]] [connect-timeout n]
 * [timeout n]`, where `headers` means "return the response headers", not "send
 * these". There is no request-header argument in any released version. So the
 * dialplan and the Lua script pass the secret as a query parameter instead,
 * and this guard accepts either.
 *
 * That is a real cost, stated plainly: FreeSWITCH logs the URLs it fetches, so
 * the query form puts the secret in FreeSWITCH's logs. Which is why
 *
 *   - it is its OWN secret (`FREESWITCH_INTERNAL_KEY`), used for nothing else,
 *     so a log leak costs one rotation and reaches nothing but these five
 *     read-mostly endpoints;
 *   - the endpoints behind it are the FreeSWITCH callbacks, not anything that
 *     moves money or reads an agency's applications;
 *   - and the follow-up, recorded in the audit, is to move those two callers
 *     onto a transport that can carry a header, at which point the query form
 *     can be withdrawn.
 *
 * It is strictly better than what it replaces, which was nothing at all.
 *
 * ── Fail closed ──────────────────────────────────────────────────────────────
 *
 * If the secret is not configured, every guarded request is refused. There is
 * no "unset means open" mode, because that is exactly the deployment assumption
 * this is replacing -- a hole that closes only if somebody remembers.
 *
 * The blast radius of a missing variable is therefore an outage, not a leak, so
 * `scripts/deploy.sh` lists `FREESWITCH_INTERNAL_KEY` among its required
 * secrets and refuses to deploy without it. A misconfiguration is a refused
 * deploy rather than a silent telephony failure.
 */

import { timingSafeEqual } from 'crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';

/** The header every caller that can send one should use. */
export const INTERNAL_KEY_HEADER = 'x-internal-key';

/**
 * The query parameter mod_curl callers use instead, because mod_curl cannot
 * send a request header. See the note above about what that costs.
 */
export const INTERNAL_KEY_QUERY = 'k';

/** Constant-time compare that does not leak length through an early return. */
function secretsMatch(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  // timingSafeEqual throws on a length mismatch, which would itself be a timing
  // signal. Compare a fixed-size digest-shaped pair instead: pad both to the
  // longer length, and fold the length difference into the result.
  const length = Math.max(a.length, b.length);
  const padded = (buf: Buffer): Buffer => Buffer.concat([buf, Buffer.alloc(length - buf.length)]);
  return timingSafeEqual(padded(a), padded(b)) && a.length === b.length;
}

/** The configured secret, or null when there is none. */
function configuredSecret(): string | null {
  const value = process.env.FREESWITCH_INTERNAL_KEY;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export type InternalAuthOutcome =
  | { ok: true; via: 'header' | 'query' }
  | { ok: false; reason: 'not_configured' | 'missing' | 'mismatch' };

/**
 * Whether this request presented the internal shared secret.
 *
 * Reads the header first, then the query parameter. Never reads a body: a body
 * is parsed after routing and some of these endpoints are called with none.
 */
export function checkInternalKey(request: FastifyRequest): InternalAuthOutcome {
  const expected = configuredSecret();
  if (!expected) return { ok: false, reason: 'not_configured' };

  const header = request.headers[INTERNAL_KEY_HEADER];
  const fromHeader = typeof header === 'string' ? header : undefined;

  const query = (request.query ?? {}) as Record<string, unknown>;
  const rawQuery = query[INTERNAL_KEY_QUERY];
  const fromQuery = typeof rawQuery === 'string' ? rawQuery : undefined;

  if (fromHeader === undefined && fromQuery === undefined) {
    return { ok: false, reason: 'missing' };
  }

  if (fromHeader !== undefined && secretsMatch(fromHeader, expected)) {
    return { ok: true, via: 'header' };
  }
  if (fromQuery !== undefined && secretsMatch(fromQuery, expected)) {
    return { ok: true, via: 'query' };
  }

  return { ok: false, reason: 'mismatch' };
}

/**
 * Fastify preHandler: refuse anything that is not the internal caller.
 *
 * 401, with a body that names the header rather than describing the secret. The
 * response deliberately does not distinguish "not configured" from "wrong key"
 * to the caller -- an unauthenticated client learning that the server has no
 * secret set is being told exactly when to try again -- but the log line does,
 * because an operator staring at a telephony outage needs to know which of the
 * two it is.
 */
export async function requireInternalKey(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  await Promise.resolve();

  const outcome = checkInternalKey(request);
  if (outcome.ok) return;

  if (outcome.reason === 'not_configured') {
    request.log.error(
      {
        event: 'internal_key_not_configured',
        url: request.url,
      },
      'FREESWITCH_INTERNAL_KEY is not set, so every FreeSWITCH callback is being ' +
        'refused. Set it on the API and in the FreeSWITCH environment, then ' +
        'restart both. scripts/deploy.sh lists it as a required secret.'
    );
  } else {
    request.log.warn(
      { event: 'internal_key_rejected', reason: outcome.reason, url: request.url },
      'Refused a FreeSWITCH callback without a valid internal key'
    );
  }

  void reply.code(401).send({
    error: {
      code: 'INTERNAL_KEY_REQUIRED',
      message: `This endpoint is called by FreeSWITCH. Present the shared secret in the ${INTERNAL_KEY_HEADER} header, or as ?${INTERNAL_KEY_QUERY}= for callers that cannot set headers.`,
    },
  });
}
