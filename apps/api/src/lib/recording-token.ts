/**
 * The one credential that may ride in a URL: a 15-minute pass to stream one
 * recording.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * An <audio> element cannot send an Authorization header, so a playback URL has
 * to carry its own credential. It used to carry a 7-day LOGIN token, and the
 * /api/v1 auth hook accepted `?token=` as a full login on every route -- so every
 * recording link on the Calls page and in the CSV export was a week-long session
 * for anyone it was pasted to.
 *
 * The replacement is narrow on every axis:
 *
 *   - PURPOSE: `purpose: 'recording'`, and bound to a single `recordingId`.
 *   - ROUTE:   accepted only by `middleware/api-v1-auth.ts`, only for
 *              `GET /api/v1/recordings/:id/stream`, and only for that id.
 *   - TIME:    15 minutes, and a token whose own lifetime is longer is refused
 *              even if it has not expired.
 *   - KEY:     signed with a key DERIVED from the server's JWT secret, not the
 *              secret itself. Every login verifier in the codebase -- the Bearer
 *              header, the session cookie, the websocket, the automation routes
 *              -- verifies with the base secret, so this token fails their
 *              signature check outright. It cannot be replayed as a session
 *              anywhere, without each of them having to remember to look for a
 *              `purpose` claim.
 *
 * The principal it carries is resolved from the database exactly like a login
 * (roles, publisher, acting tenant), and the stream route still runs its own
 * access check, so the token grants nothing its holder could not already do.
 */

import { createHash } from 'crypto';

import type { FastifyInstance } from 'fastify';

export const RECORDING_TOKEN_PURPOSE = 'recording';
export const RECORDING_TOKEN_TTL_SECONDS = 15 * 60;

/** The only path a recording token is good for. */
const STREAM_PATH = /^\/api\/v1\/recordings\/([^/?#]+)\/stream(?:[?#]|$)/;

export interface RecordingTokenClaims {
  tenantId: string;
  userId?: string;
  email?: string;
  recordingId: string;
}

interface RecordingTokenPayload extends RecordingTokenClaims {
  purpose: string;
  iat?: number;
  exp?: number;
}

interface JwtLike {
  sign: (payload: object, options?: Record<string, unknown>) => string;
  verify: <T>(token: string, options?: Record<string, unknown>) => T;
}

const derivedKeys = new WeakMap<object, string>();

/**
 * A key only this module signs with.
 *
 * @fastify/jwt does not expose its secret, but its signer is deterministic: a
 * fixed payload with no timestamp signs to the same string every time, and that
 * string is a function of the secret. Hashing it gives a key that rotates with
 * JWT_SECRET and is useless to anybody who does not hold it.
 */
function purposeKey(server: FastifyInstance): string {
  const jwt = server.jwt as unknown as JwtLike;
  let key = derivedKeys.get(jwt);
  if (!key) {
    const seed = jwt.sign({ derive: 'hopwhistle-recording-playback-v1' }, { noTimestamp: true });
    key = createHash('sha256').update(seed).digest('hex');
    derivedKeys.set(jwt, key);
  }
  return key;
}

/**
 * `issuedAt` (epoch milliseconds) defaults to now. It exists so a test can mint
 * a pass that has already expired without faking the clock under a live
 * database client.
 */
export function signRecordingToken(
  server: FastifyInstance,
  claims: RecordingTokenClaims,
  issuedAt?: number
): string {
  const jwt = server.jwt as unknown as JwtLike;
  return jwt.sign(
    { ...claims, purpose: RECORDING_TOKEN_PURPOSE },
    {
      key: purposeKey(server),
      expiresIn: RECORDING_TOKEN_TTL_SECONDS,
      ...(issuedAt !== undefined ? { clockTimestamp: issuedAt } : {}),
    }
  );
}

/** The recording id in a stream URL, or null for any other path. */
export function recordingIdFromStreamPath(url: string): string | null {
  const match = STREAM_PATH.exec(url);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * The principal a recording token carries, or null if it is not one that may
 * stream `recordingId`. Never throws: a bad token is simply not a credential.
 */
export function verifyRecordingToken(
  server: FastifyInstance,
  token: string,
  recordingId: string
): RecordingTokenClaims | null {
  let payload: RecordingTokenPayload;
  try {
    const jwt = server.jwt as unknown as JwtLike;
    payload = jwt.verify<RecordingTokenPayload>(token, { key: purposeKey(server) });
  } catch {
    return null;
  }

  if (payload.purpose !== RECORDING_TOKEN_PURPOSE) return null;
  if (payload.recordingId !== recordingId) return null;
  if (!payload.tenantId) return null;
  // `verify` has already refused an expired token. This refuses one that was
  // minted to live longer than the policy allows, however it came to exist.
  if (
    typeof payload.iat !== 'number' ||
    typeof payload.exp !== 'number' ||
    payload.exp - payload.iat > RECORDING_TOKEN_TTL_SECONDS
  ) {
    return null;
  }

  return {
    tenantId: payload.tenantId,
    userId: payload.userId,
    email: payload.email,
    recordingId: payload.recordingId,
  };
}
