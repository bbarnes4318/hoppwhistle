import { ADMIN_NAV, AGENT_NAV, buyerNav, publisherNav } from './nav-config';

/**
 * The page title shown in the topbar, in the display face.
 *
 * Derived from the nav so the topbar and the sidebar always agree on what a
 * page is called — renaming "Costs" to "Spend" in one place renames it in both.
 * Routes with no nav entry (detail pages, settings sub-pages) fall back to a
 * humanised last segment, which is right often enough and never wrong-looking.
 */

const EXPLICIT: Record<string, string> = {
  '/calls/my': 'My calls',
  '/design-preview': 'Design system',
  '/admin/live': 'Live board',
  '/publisher/tester': 'Request tester',
  '/settings/users': 'Users',
  '/settings/webhooks': 'Webhooks',
  '/settings/dnc': 'DNC lists',
  '/settings/quotas': 'Quotas & budgets',
  '/admin/payroll': 'Payroll admin',
};

const ALL_ITEMS = [...ADMIN_NAV, ...AGENT_NAV, ...publisherNav(true), ...buyerNav(true)].flatMap(
  g => g.items
);

function humanise(segment: string): string {
  return segment
    .split('-')
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export function pageTitleFor(pathname: string | null): string {
  if (!pathname) return '';
  if (EXPLICIT[pathname]) return EXPLICIT[pathname];

  // Longest matching nav href wins, so /publisher/calls beats /publisher.
  const match = ALL_ITEMS.filter(i => {
    const href = i.href.split('?')[0];
    return pathname === href || pathname.startsWith(`${href}/`);
  }).sort((a, b) => b.href.length - a.href.length)[0];

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
