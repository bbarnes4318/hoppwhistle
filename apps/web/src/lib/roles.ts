/**
 * One place that decides where a set of roles belongs.
 *
 * Roles arrive from the API as an array and a user can hold several, so the
 * order below is the contract rather than whatever happens to come first in the
 * response. Everything that routes on roles imports this, so the login
 * redirect, the dashboard shell's guard and the server-side scope checks cannot
 * drift apart -- when two of them disagreed, a user holding BUYER and PUBLISHER
 * was bounced between /buyer/dashboard and /publisher/dashboard forever.
 *
 * ── There used to be two of these ────────────────────────────────────────────
 *
 * `getRedirectPath` here sent an AGENT to /dashboard; `defaultDashboardPath` in
 * `hooks/use-auth.tsx` sent them to /call-center. The login page used the
 * first and the dashboard page used the second, so signing in as an agent was a
 * redirect to /dashboard followed immediately by a redirect off it. Both names
 * still exist because both had call sites; they are now one function.
 *
 * The precedence:
 *   1. OWNER / ADMIN - staff get the full dashboard. An admin who also carries
 *      BUYER for testing should not be trapped in the buyer portal.
 *   2. PUBLISHER     - ahead of BUYER, matching the ladder `useAuth()` and
 *                      `requireBuyerScope()` already used.
 *   3. BUYER
 *   4. AGENT         - the call centre, which is where an agent works.
 *   5. everyone else (analyst, readonly, no roles yet) - /dashboard.
 */

export const ROLE_HOME_PRECEDENCE = ['OWNER', 'ADMIN', 'PUBLISHER', 'BUYER', 'AGENT'] as const;

export function normalizeRoles(roles: string[] | null | undefined): string[] {
  return (roles ?? []).map(role => role.toUpperCase());
}

/**
 * The page a user with these roles should land on.
 *
 * AGENT lands on /call-center rather than /dashboard because /dashboard is
 * still the tenant-wide view: every call the agency took, every application it
 * wrote. That is the one destination an agent must not be sent to by default,
 * and it stays that way until the dashboard endpoint is narrowed to the
 * caller's own production.
 */
export function homePathForRoles(roles: string[] | null | undefined): string {
  const normalized = normalizeRoles(roles);

  if (normalized.includes('OWNER') || normalized.includes('ADMIN')) return '/dashboard';
  if (normalized.includes('PUBLISHER')) return '/publisher/dashboard';
  if (normalized.includes('BUYER')) return '/buyer/dashboard';
  if (normalized.includes('AGENT')) return '/call-center';

  return '/dashboard';
}

/** The name the login page and the dashboard layout already import. */
export const getRedirectPath = homePathForRoles;
