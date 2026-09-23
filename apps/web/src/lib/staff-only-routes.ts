/**
 * The screens only NetEnroll staff reach.
 *
 * ── Why this is a module and not a filter in the nav ─────────────────────────
 *
 * `AGENCY_OWNER_NAV` used to be `PLATFORM_NAV` with two hrefs filtered out, and
 * that filter was the ONLY thing keeping an agency principal off the rest. A
 * nav filter hides a link; it does not stop a URL. Every screen dropped from
 * the sidebar stayed reachable by typing its path, by an old bookmark, and by
 * the command palette's remote search, which linked straight into
 * `/campaigns/:id` and `/buyers?id=` for anybody whose token could list them.
 *
 * So the decision lives here once, and three readers import it:
 *
 *   components/layout/nav-config.ts   builds AGENCY_OWNER_NAV from it
 *   app/(dashboard)/layout.tsx        redirects off it
 *   components/auth/staff-only-guard  the two shells that escape that layout
 *
 * A screen added to this list disappears from the sidebar, stops resolving by
 * URL and stops appearing in search, in one edit. That is the property the
 * two-href filter did not have.
 *
 * ── This is a navigation boundary, not an authorization one ──────────────────
 *
 * Stated plainly because the file name invites the other reading. Everything
 * here runs in the browser. The API still answers an agency principal's token
 * on the endpoints behind these screens exactly as it did before — an OWNER who
 * calls `GET /api/v1/campaigns` with curl still gets their agency's campaigns.
 * What this removes is the product surface: the screens, the links to them and
 * the search results that lead to them.
 *
 * Closing the server side means `requirePlatformAdmin` on those route groups,
 * which is a separate change with its own blast radius — several of these
 * endpoints are read by screens an agency KEEPS (the Calls ledger builds its
 * publisher and buyer filters from `/api/v1/publishers` and `/api/v1/buyers`;
 * Billing reads `/api/v1/buyers`), so the routes cannot simply be locked to
 * staff without breaking pages that are staying.
 */

/**
 * Matched as whole path segments, never as a bare string prefix.
 *
 * `/buyers` must not swallow the buyer portal at `/buyer/dashboard`, and
 * `/campaigns` must not swallow `/ai-campaigns`. `isStaffOnlyRoute` compares
 * `path === prefix` or `path.startsWith(prefix + '/')` for exactly that reason;
 * a naive `includes` or an unanchored `startsWith` gets both wrong.
 *
 * `/admin/payroll` is deliberately NOT here, and the `/admin/` prefix is not
 * what decides. An agency runs its own payroll and keeps that screen; what is
 * listed is whatever belongs to NetEnroll rather than to the agency, wherever
 * it happens to sit in the path.
 */
export const STAFF_ONLY_ROUTES = [
  // Market. The call marketplace is NetEnroll's side of the business: an agency
  // buys delivered calls, it does not run campaigns, publishers, buyers or DID
  // inventory.
  '/campaigns',
  '/publishers',
  '/buyers',
  '/numbers',

  // Build. Call routing and voice-AI authoring are platform configuration.
  '/flows',
  '/voice-agents',
  '/voice-studio',
  '/settings/carriers',

  // Tools. Removing all four empties the Tools group, which then does not
  // render — see nav-config.ts, which drops groups left with no items.
  '/tools/recording-analyzer',
  '/tools/campaign-map',
  '/tools/industry-research',
  '/music-console',

  // Cross-agency admin. These two were already absent from the agency sidebar
  // and their endpoints already require `isPlatformAdmin`; listing them here
  // adds the redirect the nav filter never gave them.
  '/admin/agencies',
  '/admin/onboarding',

  /*
   * NetEnroll's two unbuilt screens, which an agency principal was being shown
   * as "Soon".
   *
   * Neither has a page: both are `pending: true` entries in PLATFORM_NAV and
   * render as greyed, unclickable text. That is precisely why they were missed
   * -- nothing was reachable, so nothing looked wrong -- but an agency reading
   * its own sidebar cannot tell a stub from a feature, and these two are not
   * theirs to be promised. `/admin/live` is the CROSS-AGENCY live board, which
   * shows every agency at once. `/payouts` is what NetEnroll pays its
   * PUBLISHERS for the calls it buys; an agency has no publishers and is never
   * paid out -- it is billed. Advertising a payout screen to a customer who
   * only ever owes money is the wrong way round.
   *
   * An agency's own money keeps its screens and they are not here: Delivery,
   * Settlements and Billing all stay. So does `/admin/payroll`, which is the
   * agency paying its own agents -- see the note above the list.
   */
  '/admin/live',
  '/payouts',
] as const;

/**
 * The pathname as this module compares it.
 *
 * A trailing slash is dropped, and a query string is cut, so `/campaigns/` and
 * `/publishers?id=abc` both compare as their path. The nav stores at least one
 * href with a query on it (`/buyer/calls?hasRecording=true`), so callers that
 * pass an href rather than a pathname must not silently miss.
 */
function normalise(pathname: string | null | undefined): string {
  const path = (pathname ?? '').trim().split('?')[0].split('#')[0];
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path;
}

/**
 * True when this route belongs to NetEnroll staff and not to an agency.
 *
 * An empty or null pathname answers false: before the router has said where we
 * are, redirecting is a guess, and the callers all wait for their own loading
 * state to settle before asking.
 */
export function isStaffOnlyRoute(pathname: string | null | undefined): boolean {
  const path = normalise(pathname);
  if (!path) return false;

  return STAFF_ONLY_ROUTES.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
}
