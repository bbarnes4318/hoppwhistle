/**
 * Dialer V2 — service-to-service authentication for internal routes.
 *
 * "Port 9092 is internal" is a deployment assumption, not an access control. It
 * fails open the moment a compose file publishes the port, a network policy is
 * relaxed, or something else lands on the same bridge network. Internal routes
 * therefore require a shared secret.
 *
 * Production has no insecure default: with no token configured, every internal
 * route refuses. That is deliberately noisy — a misconfigured deployment should
 * fail closed and obviously, not silently serve tenant data to anyone who can
 * reach the port.
 */

import { timingSafeEqual } from 'node:crypto';

export const INTERNAL_TOKEN_HEADER = 'x-dialer-v2-internal-token';

export enum InternalAuthFailure {
  NOT_CONFIGURED = 'NOT_CONFIGURED',
  MISSING_TOKEN = 'MISSING_TOKEN',
  INVALID_TOKEN = 'INVALID_TOKEN',
}

export interface InternalAuthResult {
  ok: boolean;
  failure?: InternalAuthFailure;
}

/**
 * Constant-time comparison. A plain `===` on a secret leaks its length and,
 * over enough requests, its prefix — the classic timing oracle. Lengths are
 * compared first because `timingSafeEqual` throws on a length mismatch; that
 * leaks length only, which the caller cannot exploit without already knowing
 * the token exists.
 */
export function tokensMatch(expected: string, presented: string): boolean {
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(presented, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Verify the internal token on a request.
 *
 * `configuredToken` comes from `DIALER_V2_INTERNAL_TOKEN`. A short token is
 * treated as absent: a two-character shared secret is not a secret, and
 * accepting one would make the control appear present while providing nothing.
 */
export const MIN_INTERNAL_TOKEN_LENGTH = 16;

export function verifyInternalToken(
  configuredToken: string | undefined,
  presentedToken: string | undefined
): InternalAuthResult {
  if (!configuredToken || configuredToken.length < MIN_INTERNAL_TOKEN_LENGTH) {
    return { ok: false, failure: InternalAuthFailure.NOT_CONFIGURED };
  }
  if (typeof presentedToken !== 'string' || presentedToken.length === 0) {
    return { ok: false, failure: InternalAuthFailure.MISSING_TOKEN };
  }
  if (!tokensMatch(configuredToken, presentedToken)) {
    return { ok: false, failure: InternalAuthFailure.INVALID_TOKEN };
  }
  return { ok: true };
}

/**
 * The message returned to an unauthenticated caller. Deliberately identical for
 * every failure mode: distinguishing "not configured" from "wrong token" tells
 * a prober whether the control is active.
 */
export const INTERNAL_AUTH_ERROR_BODY = Object.freeze({
  error: 'unauthorized',
  message: 'Internal service authentication required',
});
