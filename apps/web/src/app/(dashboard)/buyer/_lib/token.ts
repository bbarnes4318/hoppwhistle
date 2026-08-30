/**
 * The bearer token as an explicit argument.
 *
 * Reads on these pages authenticate from the session cookie, which is fine —
 * a GET changes nothing. Writes deliberately do not: each server action takes
 * the token as an argument the caller has to supply, so a request that merely
 * arrives with the user's cookie attached cannot perform one.
 *
 * That is the CSRF property, and it holds on its own. Next also refuses a
 * server action whose `origin` does not match its host, but that check reads
 * `x-forwarded-host` when the proxy sets one — a header in a config file that
 * someone will edit years from now without knowing it is load-bearing. An
 * argument cannot be switched off by an nginx edit.
 */

/** Longest plausible JWT. A token past this is not one, and is not worth forwarding. */
const MAX_TOKEN_LENGTH = 8192;

/**
 * Returns the token when it could be one, null otherwise. This is a shape
 * check and nothing more — the API verifies the signature and decides what the
 * token is allowed to do, exactly as it would for a direct call. Forwarding a
 * token the caller already holds grants no access they did not already have.
 */
export function normalizeToken(token: unknown): string | null {
  if (typeof token !== 'string') return null;
  const trimmed = token.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_TOKEN_LENGTH) return null;
  // A header-injecting value can never be a valid token, and must never reach
  // an Authorization header.
  if (/[\r\n]/.test(trimmed)) return null;
  return trimmed;
}

export const MISSING_TOKEN_MESSAGE = 'Your session has expired. Sign in again.';
