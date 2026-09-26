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
 * So the decision lives here once, and two readers import it:
 *
 *   app/(dashboard)/layout.tsx        redirects off it
 *   components/auth/staff-only-guard  the two shells that escape that layout
 *
 * `AGENCY_OWNER_NAV` is no longer built from this list. It is written out in
 * `components/layout/nav-config.ts`, because the agency sidebar now SHOWS
 * several of these screens as locked upgrades rather than hiding them. A locked
 * entry never navigates, and this list still stops the URL; the nav-config test
 * asserts that every locked item except `/call-center` is on it and every
 * working item is not.
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
 * The `/admin/` prefix is not what decides. What is listed is whatever belongs
 * to NetEnroll rather than to the agency, wherever it happens to sit in the
 * path -- `/payouts` carries no prefix at all and is staff's; `/settings/dnc`
 * sits under a staff-sounding parent and is the agency's.
 */
export const STAFF_ONLY_ROUTES = [
  // Market. The call marketplace is NetEnroll's side of the business: an agency
  // buys delivered calls, it does not run publishers, buyers or DID inventory.
  //
  // `/campaigns` is no longer here. Agencies are shown their own campaigns,
  // READ-ONLY: the list and detail pages draw no create, edit, duplicate,
  // delete or assignment controls for anybody who is not staff, and every
  // campaign write on the API is still refused to them (STAFF_ONLY_AREAS in
  // apps/api/src/lib/staff-only-endpoints.ts). Removing it here also opens
  // `/campaigns/[id]`.
  '/publishers',
  '/buyers',
  '/numbers',

  // Build. Call routing and voice-AI authoring are platform configuration.
  '/flows',
  '/voice-agents',
  '/voice-studio',
  '/settings/carriers',

  // Tools. None of the four appears in the agency sidebar at all.
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

  /*
   * Payroll administration: NetEnroll's, not the agency's.
   *
   * This was deliberately absent until now, on the reading that an agency pays
   * its own agents and should run that itself. That is not how NetEnroll works
   * it, so the screen leaves the agency portal.
   *
   * Two things this does NOT do, and both matter:
   *
   *   - An AGENT's own `/payroll` is untouched. Different route, different
   *     screen, still in AGENT_NAV, and it is where an agent reads what they
   *     are owed.
   *   - It does not close the API. `/api/v1/admin/payroll-report`,
   *     `/set-pay-rate` and `/payouts` are gated `requireRole('ADMIN','OWNER')`
   *     and tenant-scoped -- NOT `requirePlatformAdmin` -- so an agency owner's
   *     token still answers on them, as the note at the top of this file says
   *     of every route here. Closing that is a server change with its own blast
   *     radius and is not smuggled in behind a navigation edit.
   */
  '/admin/payroll',

  /*
   * Five more screens an agency was being shown that are not its own.
   *
   *   /insurance-leads/reports  which leads Ameriquote accepted and refused.
   *                             That is the MARKETPLACE's acceptance record,
   *                             not the agency's book. `/insurance-leads` --
   *                             the CRM itself -- stays, and the prefix match
   *                             is whole-segment so taking the reports child
   *                             does not take the parent with it.
   *   /reports                  publisher revenue, buyer costs and campaign
   *                             profitability: NetEnroll's margin on the calls
   *                             it buys and sells. An agency has no publishers,
   *                             no buyers and no campaigns, so all three
   *                             rendered empty for them anyway.
   *   /settings/quotas          concurrency and budget ceilings. Platform
   *                             capacity, set by whoever sells the capacity.
   *   /settings/webhooks        platform event plumbing.
   *   /settings/dnc             DNC list administration.
   *
   * What an agency keeps is still what an agency runs: the floor, its own
   * money with NetEnroll, and its own people.
   */
  '/insurance-leads/reports',
  '/reports',
  '/settings/quotas',
  '/settings/webhooks',
  '/settings/dnc',

  /*
   * The white-label tier's own screens. They exist for an agency that also
   * SELLS calls -- what its calls sold for, and the downline agencies it runs
   * -- so a normal agency, which only buys, is sent home from them like any
   * other screen here. `WHITE_LABEL_ROUTES` below is what opens them, and
   * only to a white-label agency's OWNER and ADMIN.
   */
  '/sales',
  '/network/agencies',
  '/network/onboarding',

  /*
   * The white-label tier's hubs: Agents, Revenue, Routing and Upgrades. Each
   * gathers screens a white-label owner used to reach one sidebar entry at a
   * time. A normal agency's nav does not link them, and a normal agency typed
   * onto one is sent home like any other screen here -- its own Leaderboard,
   * Team Members and Campaigns are where they always were.
   */
  '/agents',
  '/revenue',
  '/routing',
  '/upgrades',
] as const;

/**
 * The screens standard with the white-label tier.
 *
 * An agency that also sells calls runs its own call network: publishers,
 * buyers, numbers, what it owes its publishers, the reports on all of it, its
 * sales, and the downline agencies it onboards. For a white-label agency's
 * OWNER and ADMIN these are working screens, not upgrades -- `isRouteBlockedFor`
 * lets them through. Every one of them is still on STAFF_ONLY_ROUTES, so a
 * normal agency is redirected off each exactly as before.
 *
 * The API decides what those screens may DO, separately and on the server:
 * `WHITE_LABEL_ALLOWED` in apps/api/src/lib/staff-only-endpoints.ts. Buying or
 * releasing numbers, flows, voice tooling and carrier routing stay NetEnroll's
 * for everyone.
 */
export const WHITE_LABEL_ROUTES = [
  '/publishers',
  '/buyers',
  '/numbers',
  '/payouts',
  '/reports',
  '/sales',
  '/network/agencies',
  '/network/onboarding',
  '/agents',
  '/revenue',
  '/routing',
  '/upgrades',
  // The agency's own Do Not Call lists: the DNC lists tab of Settings, and the
  // page it also lives on. Still staff-only for a normal agency.
  '/settings/dnc',
] as const;

/**
 * Where a white-label viewer's old URLs go.
 *
 * The white-label nav gathers these screens into hubs, one tab each (see
 * WHITE_LABEL_OWNER_NAV). A bookmark or a link to the old URL must still land
 * on the screen it named, so the dashboard layout replaces each of these
 * paths with its hub tab -- for a white-label viewer only. Everybody else gets
 * the page at the old URL, which still renders the same view.
 *
 * EXACT paths, not prefixes. `/delivery` and `/delivery/settlements` go to
 * different sections, `/delivery/me` is an agent's own page and goes nowhere,
 * and `/campaigns/[id]` is still where a campaign's detail lives.
 * `/network/onboarding` is not here: the Agencies screen links to it.
 */
export const WHITE_LABEL_REDIRECTS: Readonly<Record<string, string>> = {
  '/live': '/dashboard',
  '/leaderboard': '/agents?tab=performance',
  '/delivery/team': '/agents?tab=period',
  '/settings/users': '/agents?tab=roster',
  '/sales': '/revenue',
  '/reports': '/revenue?tab=reports',
  '/payouts': '/publishers?tab=payouts',
  '/billing': '/buyers?tab=wallets',
  '/campaigns': '/routing',
  '/numbers': '/routing?tab=numbers',
  '/rating': '/settings?tab=plan',
  '/delivery': '/settings?tab=plan',
  '/delivery/settlements': '/settings?tab=plan&section=settlements',
};

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
 * The hub tab a white-label viewer on this path belongs on, or null.
 *
 * The path is compared after the same normalisation as the route lists, so a
 * trailing slash does not dodge it. A query on the old URL is carried across
 * underneath the tab's own -- Revenue links "your agents" to
 * `/leaderboard?period=THIS_WEEK`, and that has to open the Performance tab on
 * the same week, not on today.
 */
export function whiteLabelRedirectFor(pathname: string | null | undefined): string | null {
  const path = normalise(pathname);
  if (!Object.prototype.hasOwnProperty.call(WHITE_LABEL_REDIRECTS, path)) return null;

  const target = WHITE_LABEL_REDIRECTS[path];
  const query = (pathname ?? '').split('#')[0].split('?')[1];
  if (!query) return target;

  const [targetPath, targetQuery = ''] = target.split('?');
  const merged = new URLSearchParams(query);
  new URLSearchParams(targetQuery).forEach((value, key) => merged.set(key, value));
  return `${targetPath}?${merged.toString()}`;
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

/** Who is asking, for `isRouteBlockedFor`. Both from `useAuth()`. */
export interface RouteViewer {
  isPlatformAdmin: boolean;
  /** A white-label agency's OWNER or ADMIN. See `useAuth().isWhiteLabel`. */
  isWhiteLabel: boolean;
}

/**
 * True when this viewer must be sent away from this route.
 *
 * NetEnroll staff are never blocked. A white-label OWNER or ADMIN passes the
 * WHITE_LABEL_ROUTES, matched as whole segments exactly as STAFF_ONLY_ROUTES
 * are. Everybody else gets `isStaffOnlyRoute`'s answer, unchanged -- which is
 * what keeps a normal agency's redirects exactly as they were.
 */
export function isRouteBlockedFor(
  pathname: string | null | undefined,
  viewer: RouteViewer
): boolean {
  if (viewer.isPlatformAdmin) return false;

  if (viewer.isWhiteLabel) {
    const path = normalise(pathname);
    if (WHITE_LABEL_ROUTES.some(prefix => path === prefix || path.startsWith(`${prefix}/`))) {
      return false;
    }
  }

  return isStaffOnlyRoute(pathname);
}
