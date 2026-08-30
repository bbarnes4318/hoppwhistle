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
 * The precedence:
 *   1. OWNER / ADMIN - staff get the full dashboard. An admin who also carries
 *      BUYER for testing should not be trapped in the buyer portal.
 *   2. PUBLISHER     - ahead of BUYER, matching the ladder `useAuth()` and
 *                      `requireBuyerScope()` already used.
 *   3. BUYER
 *   4. everyone else (agent, analyst, readonly, no roles yet) - /dashboard.
 */

export const ROLE_HOME_PRECEDENCE = ['OWNER', 'ADMIN', 'PUBLISHER', 'BUYER'] as const;

export function normalizeRoles(roles: string[] | null | undefined): string[] {
  return (roles ?? []).map(role => role.toUpperCase());
}

/** The dashboard a user with these roles should land on. */
export function getRedirectPath(roles: string[] | null | undefined): string {
  const normalized = normalizeRoles(roles);

  if (normalized.includes('OWNER') || normalized.includes('ADMIN')) return '/dashboard';
  if (normalized.includes('PUBLISHER')) return '/publisher/dashboard';
  if (normalized.includes('BUYER')) return '/buyer/dashboard';

  return '/dashboard';
}
