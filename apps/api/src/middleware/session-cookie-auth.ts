/**
 * Authenticate ONE read-only GET from the browser's session cookie.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * `GET /api/v1/lead-inject/stream` is opened by the browser's `EventSource`,
 * and `EventSource` cannot set request headers. There is no way to attach
 * `Authorization: Bearer …` to it. So the stream reached the API with no
 * credential, `resolveTenant` correctly refused it, and the endpoint answered
 * 401 to every browser that ever opened it — then the hook reconnected, and was
 * refused again. It has never worked.
 *
 * The web app already mirrors its JWT into an `hw_session` cookie so server
 * components can render with the user's own scope (see
 * apps/web/src/lib/session-token.ts). That cookie rides along on a same-origin
 * request automatically, headers or not, which is exactly the gap EventSource
 * leaves.
 *
 * ── Why not ?token= ──────────────────────────────────────────────────────────
 *
 * `registerApiV1Auth` already accepts a `?token=` query parameter, so appending
 * the JWT to the URL would have been a one-line client change. It was rejected:
 * that token is a full seven-day session, and a query string is written to the
 * API's access logs, to the proxy's, and to the browser's history — repeatedly,
 * because an SSE connection reconnects. Putting a long-lived credential into
 * log files to save a few lines is a bad trade on any endpoint, and this one
 * streams consumers' names, dates of birth and requested coverage.
 *
 * ── Why this is safe, and why it stays read-only ─────────────────────────────
 *
 * The cookie's contract (documented at apps/web/src/lib/session-token.ts) is
 * that it AUTHENTICATES READS ONLY. Nothing that writes may accept it. This
 * authenticator therefore refuses to run on anything but a GET, in code rather
 * than by convention: attach it to a POST and the request is rejected outright,
 * so the invariant cannot be eroded by a future caller who did not read this
 * comment.
 *
 * Cookie authentication normally raises CSRF. It does not here:
 *
 *   - The cookie is `SameSite=Lax`, so a cross-site subresource request — which
 *     is what an `EventSource` from another origin is — does not carry it. A
 *     top-level navigation does carry it, but a navigation to this URL yields
 *     an `text/event-stream` body the attacking page cannot read.
 *   - The route sends no `Access-Control-Allow-Origin`, wildcard or otherwise.
 *     It deliberately dropped its wildcard because this stream carries one
 *     agency's leads; a cross-origin read is refused by the browser regardless.
 *   - The request changes nothing. It subscribes to an event emitter and writes
 *     bytes back down the socket.
 *
 * ── Scope ────────────────────────────────────────────────────────────────────
 *
 * This is a `preHandler` on a single route, not a hook. It is deliberately NOT
 * part of `registerApiV1Auth`: adding cookie auth there would extend it to the
 * whole v1 surface including every write, which is the invariant above. The
 * list of routes using it is the list of routes that name it, and today that is
 * one. Adding a second requires the same argument: a read-only GET the browser
 * cannot send a header on.
 */

import { FastifyReply, FastifyRequest } from 'fastify';

import { applyPlatformContext } from './api-v1-auth.js';

/** Must match SESSION_COOKIE in apps/web/src/lib/session-token.ts. */
export const SESSION_COOKIE = 'hw_session';

/**
 * Populate `request.user` from the session cookie, if it is not already set.
 *
 * A stronger credential wins: when the global hook has already authenticated
 * the request from a Bearer token or an API key, this does nothing. It only
 * fills the gap EventSource leaves.
 *
 * Failure is silent by design. This does not send a refusal — it leaves
 * `request.user` unset and lets the route's own `resolveTenant` produce the
 * one refusal shape every other route produces, so an unauthenticated stream
 * fails exactly like an unauthenticated anything else.
 */
export async function authenticateFromSessionCookie(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  /*
   * The read-only invariant, enforced rather than asserted. A cookie that is
   * not HttpOnly and rides along automatically must never be what authorises a
   * change, so this refuses to be the thing that authenticated a write.
   */
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    request.log.error(
      { method: request.method, url: request.url },
      'authenticateFromSessionCookie is read-only and was attached to a mutating route'
    );
    await reply.code(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal error',
      },
    });
    return;
  }

  const principal = request.user as { tenantId?: string; userId?: string } | undefined;
  if (principal?.tenantId || principal?.userId) return;

  const token = request.cookies?.[SESSION_COOKIE];
  if (!token) return;

  try {
    request.user = request.server.jwt.verify(token);
  } catch {
    // An expired or forged cookie authenticates nothing. Leave `request.user`
    // unset; the route refuses on its own terms.
    return;
  }

  /*
   * The same overlay the Bearer path applies: for NetEnroll staff, the agency
   * they have ENTERED replaces the tenant their token was minted with.
   *
   * This fails closed, and deliberately not the way the Bearer path does. The
   * overlay is a database read, and `request.user` has to be populated before
   * it runs because that is what it reads — so a throw leaves a principal that
   * has been authenticated but NOT had its acting agency applied. For a
   * platform operator that principal names the tenant their token was minted
   * with, which is exactly the stale tenant this overlay exists to prevent
   * being served.
   *
   * So an overlay that cannot complete un-authenticates the request rather than
   * serving it half-applied. This costs nothing real: the overlay only fails
   * when the database is unreachable, and a stream whose leads live behind that
   * same database has nothing to deliver in that state anyway.
   */
  try {
    await applyPlatformContext(request);
  } catch (err) {
    // `request.user` is typed as always-present, so the cast is how a request
    // is put back to unauthenticated. `getActingTenantId` reads it as absent.
    (request as { user?: unknown }).user = undefined;
    request.log.error(
      { err },
      'session cookie: could not resolve the acting agency, refusing rather than serving the token tenant'
    );
  }
}
