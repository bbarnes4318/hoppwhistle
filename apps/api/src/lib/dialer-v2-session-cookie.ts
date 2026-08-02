/**
 * Dialer V2 — agent session cookie and CSRF.
 *
 * ── Why the token must not reach page JavaScript ─────────────────────────────
 *
 * The session endpoint used to return the bearer token as JSON, and the browser
 * kept it and sent it back in the heartbeat body. That makes the token readable
 * by any script running on the page. An XSS — a compromised dependency, an
 * injected analytics tag, a bug in a rendered field — can then read it and
 * replay it from anywhere, as that agent, for the token's full lifetime. The
 * heartbeat is not a dangerous endpoint on its own, but the credential it
 * carries is the agent's identity for everything else.
 *
 * Putting it in an HttpOnly cookie removes that whole class: script can cause
 * the browser to SEND the cookie, but cannot READ it. An XSS can then make the
 * agent look available while their tab is open, and cannot exfiltrate anything
 * that outlives the page.
 *
 * ── Why that requires CSRF protection ────────────────────────────────────────
 *
 * A cookie is sent by the browser automatically, which is the point and also
 * the risk: any origin that can make the browser issue a request now
 * authenticates as the agent. `SameSite=Strict` is the primary defence, and a
 * double-submit token is the backstep for the cases SameSite does not cover —
 * older browsers, and same-site subdomains that are not the app.
 *
 * The CSRF token is deliberately NOT HttpOnly: page JavaScript has to read it
 * to echo it in a header, and that is safe precisely because it is not a
 * credential. It proves only that the request came from something that could
 * read a cookie on this origin, which is what a cross-origin attacker cannot do.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';

export const SESSION_COOKIE = 'hw_dialer_session';
export const SESSION_HASH_COOKIE = 'hw_dialer_session_ref';
export const CSRF_COOKIE = 'hw_dialer_csrf';
export const CSRF_HEADER = 'x-dialer-csrf';

/**
 * Cookies are scoped to the agent endpoints only.
 *
 * A path of `/` would attach the session token to every request the app makes —
 * static assets, unrelated APIs, third-party pixels served from this origin —
 * multiplying the number of places it can leak for no benefit.
 */
export const COOKIE_PATH = '/api/v1/dialer-v2/agents';

export interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'strict' | 'lax' | 'none';
  path: string;
  maxAge: number;
}

/**
 * `Secure` is on unless this is plain local development.
 *
 * Keyed off NODE_ENV rather than the request scheme: a proxy that terminates
 * TLS makes the request look like http, and dropping Secure on that basis would
 * silently allow the cookie over cleartext in exactly the deployment where it
 * matters most.
 */
export function sessionCookieOptions(expiresAtMs: number, now: number, env = process.env) {
  const insecureLocal = env.NODE_ENV === 'development' || env.NODE_ENV === 'test';
  return {
    httpOnly: true,
    secure: !insecureLocal,
    // Strict, not Lax. This cookie is never needed on a top-level navigation
    // from another site — nothing links into the agent API — so there is no
    // usability cost, and Strict is the only value that resists the
    // navigation-triggered case entirely.
    sameSite: 'strict' as const,
    path: COOKIE_PATH,
    // Expiry matches the session's own, so a browser is not holding a cookie
    // the server would refuse anyway.
    maxAge: Math.max(0, Math.floor((expiresAtMs - now) / 1000)),
  } satisfies CookieOptions;
}

/** Same lifetime and scope, but readable by script so it can be echoed back. */
export function csrfCookieOptions(expiresAtMs: number, now: number, env = process.env) {
  return { ...sessionCookieOptions(expiresAtMs, now, env), httpOnly: false };
}

export function mintCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

export enum SessionCookieRejection {
  NO_SESSION_COOKIE = 'NO_SESSION_COOKIE',
  NO_CSRF_COOKIE = 'NO_CSRF_COOKIE',
  CSRF_HEADER_MISSING = 'CSRF_HEADER_MISSING',
  CSRF_MISMATCH = 'CSRF_MISMATCH',
}

export interface ReadSessionResult {
  ok: boolean;
  rejection?: SessionCookieRejection;
  /** Present only on success. Never logged, never returned to the browser. */
  token?: string;
  sessionTokenHash?: string;
}

/** Constant-time compare — a CSRF token is a secret for as long as it is valid. */
function tokensMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

type CookieCarrier = FastifyRequest & { cookies?: Record<string, string | undefined> };

/**
 * Read the session token from the cookie and enforce the double-submit check.
 *
 * The token is returned to the caller for one purpose — forwarding it over the
 * internal, token-authenticated channel to the dialer — and to nowhere else.
 */
export function readSessionFromCookies(request: FastifyRequest): ReadSessionResult {
  const cookies = (request as CookieCarrier).cookies ?? {};

  const token = cookies[SESSION_COOKIE];
  if (!token) return { ok: false, rejection: SessionCookieRejection.NO_SESSION_COOKIE };

  const csrfCookie = cookies[CSRF_COOKIE];
  if (!csrfCookie) return { ok: false, rejection: SessionCookieRejection.NO_CSRF_COOKIE };

  const header = request.headers[CSRF_HEADER];
  const presented = typeof header === 'string' ? header : '';
  if (presented.length === 0) {
    return { ok: false, rejection: SessionCookieRejection.CSRF_HEADER_MISSING };
  }
  if (!tokensMatch(presented, csrfCookie)) {
    return { ok: false, rejection: SessionCookieRejection.CSRF_MISMATCH };
  }

  return { ok: true, token, sessionTokenHash: cookies[SESSION_HASH_COOKIE] };
}

/** Clear every session cookie. Used on logout and on a refused session. */
export function clearSessionCookies(reply: FastifyReply): void {
  for (const name of [SESSION_COOKIE, SESSION_HASH_COOKIE, CSRF_COOKIE]) {
    // Path must match the one the cookie was set with, or the browser keeps it.
    void reply.clearCookie(name, { path: COOKIE_PATH });
  }
}
