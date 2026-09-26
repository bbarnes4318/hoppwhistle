import {
  AGENCY_OWNER_NAV,
  AGENT_NAV,
  buyerNav,
  PLATFORM_NAV,
  publisherNav,
  WHITE_LABEL_OWNER_NAV,
  type NavGroup,
} from './nav-config';

/**
 * The page title shown in the topbar, in the display face.
 *
 * Derived from the nav so the topbar and the sidebar always agree on what a
 * page is called — renaming "Costs" to "Spend" in one place renames it in both.
 * Routes with no nav entry (detail pages, settings sub-pages) fall back to a
 * humanised last segment, which is right often enough and never wrong-looking.
 */

/**
 * Routes whose title the nav cannot supply, because they have no nav entry.
 *
 * Nothing that IS a nav entry belongs here. Five settings routes used to be
 * listed, repeating the name their sidebar item already carried -- and because
 * this map is consulted first, the copy WON. Renaming the sidebar entry then
 * changed the sidebar and left the heading and the browser tab saying the old
 * thing, which is the drift the comment above promises this module prevents.
 */
const EXPLICIT: Record<string, string> = {
  '/calls/my': 'My calls',
  '/design-preview': 'Design system',
  '/publisher/tester': 'Request tester',
  /*
   * The AI campaign screens have no nav entry, so the fallback would humanise
   * the last segment and title them "Ai campaigns" and "New" -- the first
   * mis-capitalised, the second meaningless on its own. Both pages used to
   * carry their own heading and that is what covered for this; now that the
   * topbar is the only place a page is named, it has to say something a person
   * would recognise.
   */
  '/ai-campaigns': 'AI campaigns',
  '/ai-campaigns/new': 'New AI campaign',
};

/**
 * Detail pages a viewer reaches from a hub in their own nav, titled as that
 * hub. A white-label owner opens a campaign from Routing (their Campaigns tab
 * is a tab there), so /campaigns/<id> reads "Routing" for them. Consulted only
 * when the viewer's own nav has the hub, so everybody else is unchanged.
 */
const DETAIL_HUB: Record<string, string> = {
  '/campaigns': '/routing',
};

const ALL_ITEMS = [
  ...PLATFORM_NAV,
  ...AGENCY_OWNER_NAV,
  ...WHITE_LABEL_OWNER_NAV,
  ...AGENT_NAV,
  ...publisherNav(true),
  ...buyerNav(true),
].flatMap(g => g.items);

function humanise(segment: string): string {
  return segment
    .split('-')
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/**
 * The title for `pathname`.
 *
 * `own` is the viewer's own navigation, when the caller knows it. Its entries
 * are consulted first, because the same href can be named differently in two
 * navs: `/dashboard` is "Dashboard" to staff and an agency, and "Today" to a
 * white-label owner, whose sidebar says Today.
 */
export function pageTitleFor(pathname: string | null, own?: NavGroup[]): string {
  if (!pathname) return '';
  if (EXPLICIT[pathname]) return EXPLICIT[pathname];

  const ownItems = own?.flatMap(group => group.items) ?? [];
  const exact = ownItems.find(item => item.href === pathname);
  if (exact) return exact.name;

  for (const [collection, hub] of Object.entries(DETAIL_HUB)) {
    if (!pathname.startsWith(`${collection}/`)) continue;
    const hubItem = ownItems.find(item => item.href === hub);
    if (hubItem) return hubItem.name;
  }

  // Longest matching nav PATH wins, so /publisher/calls beats /publisher.
  // Sorting by the raw href instead would let a filtered variant of a page win
  // on the strength of its query string alone — "Recordings"
  // (/buyer/calls?hasRecording=true) titling the plain /buyer/calls page.
  const match = ALL_ITEMS.filter(i => {
    const href = i.href.split('?')[0];
    return pathname === href || pathname.startsWith(`${href}/`);
  }).sort((a, b) => {
    const byPath = b.href.split('?')[0].length - a.href.split('?')[0].length;
    if (byPath !== 0) return byPath;
    // Same page, one of them filtered: the unfiltered item names it.
    return Number(a.href.includes('?')) - Number(b.href.includes('?'));
  })[0];

  if (match) return match.name;

  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return 'Dashboard';

  // A detail route ends in an id; name it after its collection instead of
  // putting a uuid in the topbar.
  const last = segments[segments.length - 1];
  const looksLikeId = /^[0-9a-f-]{8,}$/i.test(last) || /^\d+$/.test(last);
  const meaningful = looksLikeId && segments.length > 1 ? segments[segments.length - 2] : last;

  return humanise(meaningful);
}
