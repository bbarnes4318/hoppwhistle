/**
 * Session revocation by counter.
 *
 * Every session token carries `tv`, the value of `User.metadata.tokenVersion`
 * when it was signed. Each authenticator compares that claim with the row on
 * every request, and a token whose `tv` is behind the row is refused. Bumping
 * the counter -- which a password change or a password reset does -- therefore
 * signs the user out everywhere at once, without a session table and without
 * touching JWT_SECRET for anybody else.
 *
 * A token minted before this existed has no `tv` and reads as 0, which matches
 * every account whose counter has never been bumped. So nobody is signed out
 * by the deploy; only by changing their password.
 */

/** The user's current token version. Missing or malformed reads as 0. */
export function tokenVersionOf(metadata: unknown): number {
  const raw = (metadata as { tokenVersion?: unknown } | null | undefined)?.tokenVersion;
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : 0;
}

/** The version a token claims. Absent reads as 0; see the header. */
export function claimedTokenVersion(claims: unknown): number {
  const raw = (claims as { tv?: unknown } | null | undefined)?.tv;
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : 0;
}

/** True when a token was signed before the user's sessions were revoked. */
export function isTokenRevoked(claims: unknown, metadata: unknown): boolean {
  return claimedTokenVersion(claims) < tokenVersionOf(metadata);
}

export const SESSION_REVOKED = {
  code: 'SESSION_REVOKED',
  message: 'This session has ended because the password was changed. Please sign in again.',
} as const;
