import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { MonitorPlay } from 'lucide-react';
import { describe, expect, it } from 'vitest';

import {
  AGENCY_OWNER_NAV,
  AGENT_NAV,
  FIRST_UPGRADE_GROUP,
  PLATFORM_NAV,
  allNavItems,
  buyerNav,
  isLockedGroup,
  navFor,
  publisherNav,
  type NavGroup,
  type NavItem,
} from '@/components/layout/nav-config';
import { isStaffOnlyRoute } from '@/lib/staff-only-routes';

const APP_DIR = resolve(__dirname, '../../../app');

function collectRoutes(dir: string, urlPath = ''): Set<string> {
  const routes = new Set<string>();
  if (!existsSync(dir)) return routes;

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    if (entry.startsWith('_') || entry.startsWith('.')) continue;

    const isGroup = entry.startsWith('(') && entry.endsWith(')');
    const childPath = isGroup ? urlPath : `${urlPath}/${entry}`;

    for (const file of ['page.tsx', 'page.ts', 'page.jsx', 'page.js']) {
      if (existsSync(join(full, file))) {
        routes.add(childPath || '/');
        break;
      }
    }

    for (const nested of collectRoutes(full, childPath)) routes.add(nested);
  }

  return routes;
}

const ROUTES = collectRoutes(APP_DIR);

function pathOf(href: string): string {
  return href.split('?')[0];
}

// Pending and locked items never navigate, so there is no page to demand of
// them (`/payouts` has none).
function liveItems(groups: NavGroup[]): NavItem[] {
  return groups.flatMap(group => group.items).filter(item => !item.pending && !item.locked);
}

const NAVS: Array<[string, NavGroup[]]> = [
  ['PLATFORM_NAV', PLATFORM_NAV],
  ['AGENCY_OWNER_NAV', AGENCY_OWNER_NAV],
  ['AGENT_NAV', AGENT_NAV],
  ['publisherNav', publisherNav(true)],
  ['buyerNav', buyerNav(true)],
];

describe('navigation route coverage', () => {
  it('finds the app directory and core routes', () => {
    expect(existsSync(APP_DIR)).toBe(true);
    expect(ROUTES.size).toBeGreaterThan(30);
    expect(ROUTES.has('/dashboard')).toBe(true);
    expect(ROUTES.has('/call-center')).toBe(true);
  });
});

describe.each(NAVS)('%s: every href resolves to a page', (name, groups) => {
  const items = liveItems(groups);

  it('has items', () => {
    expect(items.length, `${name} is empty`).toBeGreaterThan(0);
  });

  it.each(items.map(item => [item.name, item.href] as const))('%s → %s', (_itemName, href) => {
    expect(ROUTES.has(pathOf(href)), `${name} links to ${href}, which has no page`).toBe(true);
  });
});

describe('AGENT_NAV keeps non-agent admin surfaces out', () => {
  const FORBIDDEN = [
    '/calls/my',
    '/campaigns',
    '/publishers',
    '/buyers',
    '/numbers',
    '/billing',
    '/reports',
  ];
  const agentHrefs = AGENT_NAV.flatMap(group => group.items).map(item => pathOf(item.href));

  it.each(FORBIDDEN)('does not link to %s', href => {
    expect(agentHrefs).not.toContain(href);
  });
});

describe('AGENCY_OWNER_NAV: the working menu, then the upgrades', () => {
  const items = AGENCY_OWNER_NAV.flatMap(group => group.items);
  const working = items.filter(item => !item.locked);
  const locked = items.filter(item => item.locked);

  /**
   * The order asked for, spelled out rather than read from the nav.
   *
   * A test that imports the list it is checking passes whatever that list
   * happens to say; these are the requirement, written down a second time so
   * the two have to agree. ★ marks a locked item.
   */
  const EXPECTED: Array<[string | undefined, Array<[string, string, boolean]>]> = [
    [undefined, [['Dashboard', '/dashboard', false]]],
    [
      'Floor',
      [
        ['Live Board', '/live', false],
        ['Calls', '/calls', false],
        ['Applications', '/applications', false],
        ['Leaderboard', '/leaderboard', false],
        ['CRM', '/insurance-leads', false],
      ],
    ],
    [
      'Sales',
      [
        ['Campaigns', '/campaigns', false],
        ['Power Dialer', '/call-center', true],
      ],
    ],
    [
      'Money',
      [
        ['Rate', '/rating', false],
        ['Delivery', '/delivery', false],
        ['Team', '/delivery/team', false],
        ['Settlements', '/delivery/settlements', false],
        ['Billing', '/billing', false],
      ],
    ],
    [
      'Account',
      [
        ['Team Members', '/settings/users', false],
        ['Settings', '/settings', false],
      ],
    ],
    [
      'Call Network',
      [
        ['Publishers', '/publishers', true],
        ['Buyers', '/buyers', true],
        ['Numbers', '/numbers', true],
        ['VOIP Carrier Routing', '/settings/carriers', true],
      ],
    ],
    [
      'AI Voice',
      [
        ['Voice Agents', '/voice-agents', true],
        ['Voice Studio', '/voice-studio', true],
      ],
    ],
    [
      'Payouts & Payroll',
      [
        ['Payouts', '/payouts', true],
        ['Payroll Admin', '/admin/payroll', true],
      ],
    ],
    [
      'Agency Network',
      [
        ['Agencies', '/admin/agencies', true],
        ['Onboard an Agency', '/admin/onboarding', true],
      ],
    ],
  ];

  it('has the groups in order', () => {
    expect(AGENCY_OWNER_NAV.map(group => group.label)).toEqual(EXPECTED.map(([label]) => label));
  });

  it.each(EXPECTED.map(([label, want]) => [label ?? '(unlabelled)', want] as const))(
    '%s has its items in order, locked where marked',
    (label, want) => {
      const group = AGENCY_OWNER_NAV.find(g => (g.label ?? '(unlabelled)') === label);
      expect(group, `no group ${label}`).toBeDefined();
      expect(group!.items.map(item => [item.name, item.href, !!item.locked])).toEqual(want);
    }
  );

  it('does not carry `pending` onto any agency item', () => {
    for (const item of items) expect(item.pending, item.href).toBeFalsy();
  });

  it('gives every locked item a blurb', () => {
    for (const item of locked) expect(item.locked!.blurb.length, item.href).toBeGreaterThan(20);
  });

  it('never calls anything "booked" or an agent team a "desk"', () => {
    const copy = items.map(item => `${item.name} ${item.title ?? ''} ${item.locked?.blurb ?? ''}`);
    expect(copy.join(' ')).not.toMatch(/\bbooked\b|\bdesk\b/i);
  });

  it('gives the Live Board the MonitorPlay icon and its tooltip', () => {
    const live = items.find(item => item.href === '/live');
    expect(live?.icon).toBe(MonitorPlay);
    expect(live?.title).toBe(
      'Your agency right now: calls up, delivered and applications so far today'
    );
  });

  it('keeps the icon and tooltip staff have for the same screen', () => {
    const platform = new Map(
      PLATFORM_NAV.flatMap(group => group.items).map(item => [item.href, item] as const)
    );
    for (const item of items) {
      const staff = platform.get(item.href);
      if (!staff) continue;
      expect(item.icon, item.href).toBe(staff.icon);
      expect(item.title, item.href).toBe(staff.title);
    }
  });

  it.each(working.map(item => [item.name, item.href] as const))(
    'working item %s (%s) is not staff-only',
    (_name, href) => {
      expect(isStaffOnlyRoute(href)).toBe(false);
    }
  );

  /*
   * A locked item is never a way in. The sidebar will not navigate to it, and
   * the dashboard layout redirects an agency off it by URL -- except the Power
   * Dialer, whose page is where the agency's AGENTS work and stays reachable.
   */
  it.each(locked.map(item => [item.name, item.href] as const))(
    'locked item %s (%s) is staff-only, unless it is the Power Dialer',
    (_name, href) => {
      expect(isStaffOnlyRoute(href)).toBe(href !== '/call-center');
    }
  );

  it('leaves /call-center reachable and AGENT_NAV\'s Power Dialer untouched', () => {
    expect(isStaffOnlyRoute('/call-center')).toBe(false);
    const agentDialer = AGENT_NAV.flatMap(group => group.items).find(
      item => item.href === '/call-center'
    );
    expect(agentDialer?.name).toBe('Power Dialer');
    expect(agentDialer?.locked).toBeUndefined();
  });

  it('returns no locked item from allNavItems, so the command palette offers none', () => {
    const offered = allNavItems(AGENCY_OWNER_NAV);
    expect(offered.some(item => item.locked)).toBe(false);
    expect(offered.map(item => item.href)).not.toContain('/publishers');
    expect(offered.map(item => item.href)).not.toContain('/call-center');
    expect(offered.map(item => item.href)).toContain('/live');
    expect(offered.map(item => item.href)).toContain('/campaigns');
  });

  it('puts every locked group below the "Unlock more" divider, and only those', () => {
    const labels = AGENCY_OWNER_NAV.map(group => group.label);
    const divider = labels.indexOf(FIRST_UPGRADE_GROUP);
    expect(divider).toBeGreaterThan(0);
    AGENCY_OWNER_NAV.forEach((group, i) => {
      expect(isLockedGroup(group), group.label).toBe(i >= divider);
    });
  });

  /**
   * NetEnroll's own screens that are neither working nor offered as an
   * upgrade: an agency does not see them at all.
   */
  it.each([
    '/admin/live',
    '/flows',
    '/tools/recording-analyzer',
    '/tools/campaign-map',
    '/tools/industry-research',
    '/music-console',
    '/insurance-leads/reports',
    '/reports',
    '/settings/quotas',
    '/settings/webhooks',
    '/settings/dnc',
  ])('does not show %s at all, and it is staff-only', href => {
    expect(items.map(item => pathOf(item.href))).not.toContain(href);
    expect(isStaffOnlyRoute(href)).toBe(true);
  });

  it('leaves Build to staff, who still have its three screens', () => {
    const build = PLATFORM_NAV.find(group => group.label === 'Build');
    expect(build, 'PLATFORM_NAV lost its Build group').toBeDefined();
    expect(build!.items.map(item => pathOf(item.href))).toEqual([
      '/flows',
      '/voice-agents',
      '/voice-studio',
    ]);
  });
});

describe('navFor: which nav each viewer gets', () => {
  const NOBODY = {
    isPlatformAdmin: false,
    previewing: false,
    hasFullAccess: false,
    isWhiteLabel: false,
    isPublisherOnly: false,
    isBuyerOnly: false,
    isAgentOnly: false,
    isReadonlyOnly: false,
    canViewRecordings: false,
  };

  it('gives staff the platform nav, even inside an agency where they hold OWNER', () => {
    expect(navFor({ ...NOBODY, isPlatformAdmin: true, hasFullAccess: true })).toBe(PLATFORM_NAV);
  });

  it('gives an agency principal the agency nav', () => {
    expect(navFor({ ...NOBODY, hasFullAccess: true })).toBe(AGENCY_OWNER_NAV);
  });

  /*
   * The preview case. `isPlatformAdmin` stays true for the whole of a preview,
   * and the API has replaced the roles with the previewed one. Reading the
   * capability first handed a previewing operator PLATFORM_NAV.
   */
  it('gives a platform admin previewing an agency as OWNER the agency nav', () => {
    expect(
      navFor({ ...NOBODY, isPlatformAdmin: true, previewing: true, hasFullAccess: true })
    ).toBe(AGENCY_OWNER_NAV);
  });

  it('gives a platform admin previewing as AGENT the agent nav', () => {
    expect(navFor({ ...NOBODY, isPlatformAdmin: true, previewing: true, isAgentOnly: true })).toBe(
      AGENT_NAV
    );
  });

  it('gives an agent the agent nav, and nobody-with-no-role nothing', () => {
    expect(navFor({ ...NOBODY, isAgentOnly: true })).toBe(AGENT_NAV);
    expect(navFor(NOBODY)).toEqual([]);
  });
});

describe('isStaffOnlyRoute matches whole segments', () => {
  /**
   * The near-misses. Each of these shares a prefix with an entry in
   * STAFF_ONLY_ROUTES and belongs to somebody else entirely.
   */
  it.each([
    ['/buyer', '/buyers'],
    ['/buyer/dashboard', '/buyers'],
    ['/publisher/calls', '/publishers'],
    ['/voice-agents-archive', '/voice-agents'],
    ['/numbers-lookup', '/numbers'],
    /*
     * `/payroll` is an AGENT's own pay, and `/admin/payroll` -- which is now
     * staff's -- must not take it. They share five characters and nothing else:
     * one is the screen an agent reads what they are owed on, and it is in
     * AGENT_NAV. This replaces a case that paired `/admin/payroll` with
     * `/admin/agencies`, which stopped proving anything once `/admin/payroll`
     * became staff-only on its own account.
     */
    ['/payroll', '/admin/payroll'],
    ['/payouts-summary', '/payouts'],
  ])('%s is not swallowed by %s', path => {
    expect(isStaffOnlyRoute(path)).toBe(false);
  });

  it('matches a nested path under a staff-only screen', () => {
    expect(isStaffOnlyRoute('/publishers/abc-123')).toBe(true);
    expect(isStaffOnlyRoute('/music-console/reports')).toBe(true);
    expect(isStaffOnlyRoute('/tools/industry-research/new')).toBe(true);
  });

  it('ignores a trailing slash and a query string', () => {
    expect(isStaffOnlyRoute('/publishers/')).toBe(true);
    expect(isStaffOnlyRoute('/buyers?id=abc')).toBe(true);
  });

  // Before the router has said where we are, redirecting is a guess.
  it('answers false for nothing at all', () => {
    expect(isStaffOnlyRoute(null)).toBe(false);
    expect(isStaffOnlyRoute(undefined)).toBe(false);
    expect(isStaffOnlyRoute('')).toBe(false);
  });
});

/**
 * The nav and the redirects have to be reading the same list.
 *
 * Structural, on the source, because the defect this guards against is not
 * visible in any one component's output: a screen dropped from the sidebar but
 * left routable is a working page with no link to it, and it looks correct from
 * everywhere except the address bar. What has to hold is that the three places
 * that take these screens away all consult `isStaffOnlyRoute`.
 */
describe('one list, read by everyone who takes a screen away', () => {
  const webSrc = resolve(__dirname, '../../..');
  const read = (relative: string) => readFileSync(join(webSrc, relative), 'utf8');

  it.each([
    ['app/(dashboard)/layout.tsx', 'the dashboard redirect'],
    ['components/auth/staff-only-guard.tsx', 'the shells outside (dashboard)'],
  ])('%s imports isStaffOnlyRoute', relative => {
    expect(read(relative)).toContain("from '@/lib/staff-only-routes'");
  });

  /**
   * Industry Research and the Music Console each render their own shell outside
   * the `(dashboard)` route group, so the layout redirect never reaches them.
   * They were the two most exposed entries in the removal -- no sidebar to have
   * been removed from -- and each has to mount the guard by hand.
   */
  it.each([['app/(research)/layout.tsx'], ['app/music-console/layout.tsx']])(
    '%s mounts StaffOnlyGuard',
    relative => {
      const source = read(relative);
      expect(source).toContain('StaffOnlyGuard');
      expect(source).toContain("from '@/components/auth/staff-only-guard'");
    }
  );
});
