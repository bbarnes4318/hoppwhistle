import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AGENCY_OWNER_NAV,
  AGENT_NAV,
  PLATFORM_NAV,
  buyerNav,
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

function liveItems(groups: NavGroup[]): NavItem[] {
  return groups.flatMap(group => group.items).filter(item => !item.pending);
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

describe("AGENCY_OWNER_NAV: NetEnroll's own screens are gone", () => {
  const ownerHrefs = new Set(
    AGENCY_OWNER_NAV.flatMap(group => group.items).map(item => pathOf(item.href))
  );
  const platformHrefs = new Set(
    PLATFORM_NAV.flatMap(group => group.items).map(item => pathOf(item.href))
  );

  /**
   * The twelve screens named in the removal, the two cross-agency admin screens
   * that were already absent from the sidebar, and NetEnroll's two unbuilt
   * stubs -- the cross-agency live board, and the payouts screen for the
   * publishers NetEnroll buys calls from. An agency has no publishers and is
   * never paid out; it is billed.
   *
   * Spelled out here rather than read from STAFF_ONLY_ROUTES on purpose. A test
   * that imports the list it is checking passes whatever the list happens to
   * say, including after somebody deletes a line from it; these paths are the
   * requirement, written down a second time so the two have to agree.
   */
  const REMOVED = [
    '/campaigns',
    '/publishers',
    '/buyers',
    '/numbers',
    '/flows',
    '/voice-agents',
    '/voice-studio',
    '/tools/recording-analyzer',
    '/tools/campaign-map',
    '/tools/industry-research',
    '/music-console',
    '/settings/carriers',
    '/admin/agencies',
    '/admin/onboarding',
    '/admin/live',
    '/payouts',
    '/admin/payroll',
  ];

  it.each(REMOVED)('does not link to %s', href => {
    expect(ownerHrefs.has(href), `AGENCY_OWNER_NAV still links to ${href}`).toBe(false);
  });

  it('agrees with isStaffOnlyRoute about every one of them', () => {
    for (const href of REMOVED) {
      expect(isStaffOnlyRoute(href), `${href} is not in STAFF_ONLY_ROUTES`).toBe(true);
    }
  });

  /**
   * The other direction, and the one that catches an over-broad prefix.
   *
   * `/buyers` must not take `/buyer/dashboard` with it and `/campaigns` must not
   * take `/ai-campaigns`; a filter written with `includes` or an unanchored
   * `startsWith` would remove screens nobody asked to remove, and the only
   * symptom would be a shorter sidebar.
   */
  it('keeps every platform screen that is not staff-only', () => {
    for (const href of platformHrefs) {
      if (isStaffOnlyRoute(href)) continue;
      expect(ownerHrefs.has(href), `AGENCY_OWNER_NAV lost ${href}`).toBe(true);
    }
  });

  it("keeps the floor, the money and the agency's own administration", () => {
    for (const href of [
      '/dashboard',
      '/call-center',
      '/calls',
      '/applications',
      '/insurance-leads',
      '/insurance-leads/reports',
      '/rating',
      '/delivery',
      '/delivery/settlements',
      '/billing',
      '/reports',
      '/settings',
      '/settings/users',
      '/settings/webhooks',
      '/settings/dnc',
      '/settings/quotas',
    ]) {
      expect(ownerHrefs.has(href), `AGENCY_OWNER_NAV missing ${href}`).toBe(true);
    }
  });

  /**
   * Removing all four Tools entries empties that group. A NavGroup with a label
   * and no items renders its header over nothing, so the group has to go too --
   * and "Market" goes the same way, all four of its entries being staff's.
   */
  it('renders no group left with nothing in it', () => {
    for (const group of AGENCY_OWNER_NAV) {
      expect(
        group.items.length,
        `group "${group.label ?? '(unlabelled)'}" is empty`
      ).toBeGreaterThan(0);
    }
  });

  /*
   * Market, Tools and Build all empty out for an agency principal: the
   * marketplace, the four Tools entries, and Build's flow builder and two voice
   * screens are all NetEnroll's. Build only survives for staff, who keep those
   * three.
   */
  it('drops the Market, Tools and Build groups entirely', () => {
    const labels = AGENCY_OWNER_NAV.map(group => group.label);
    expect(labels).not.toContain('Market');
    expect(labels).not.toContain('Tools');
    expect(labels).not.toContain('Build');
  });

  it('leaves the agency four groups and no more', () => {
    expect(AGENCY_OWNER_NAV.map(group => group.label)).toEqual([
      undefined,
      'Live',
      'Money',
      'Admin',
    ]);
  });

  /*
   * Settings sits with its own sub-pages.
   *
   * It used to be in Build, and /settings/users, /settings/webhooks,
   * /settings/dnc and /settings/quotas -- the pages reached FROM it -- have
   * always been in Admin. Nothing noticed while Build had three other items;
   * removing them left an agency principal a group labelled "Build" holding
   * only Settings, with its own children under a different heading.
   */
  it('puts Settings with its sub-pages, in Admin', () => {
    const admin = AGENCY_OWNER_NAV.find(group => group.label === 'Admin');
    expect(admin, 'there is no Admin group').toBeDefined();

    const hrefs = admin!.items.map(item => pathOf(item.href));
    expect(hrefs).toContain('/settings');
    for (const child of [
      '/settings/users',
      '/settings/webhooks',
      '/settings/dnc',
      '/settings/quotas',
    ]) {
      expect(hrefs, `${child} is not beside its parent`).toContain(child);
    }

    // First, before the pages it leads to.
    expect(hrefs[0]).toBe('/settings');
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

describe('isStaffOnlyRoute matches whole segments', () => {
  /**
   * The near-misses. Each of these shares a prefix with an entry in
   * STAFF_ONLY_ROUTES and belongs to somebody else entirely.
   */
  it.each([
    ['/buyer', '/buyers'],
    ['/buyer/dashboard', '/buyers'],
    ['/publisher/calls', '/publishers'],
    ['/ai-campaigns', '/campaigns'],
    ['/ai-campaigns/new', '/campaigns'],
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
    expect(isStaffOnlyRoute('/campaigns/abc-123')).toBe(true);
    expect(isStaffOnlyRoute('/music-console/reports')).toBe(true);
    expect(isStaffOnlyRoute('/tools/industry-research/new')).toBe(true);
  });

  it('ignores a trailing slash and a query string', () => {
    expect(isStaffOnlyRoute('/campaigns/')).toBe(true);
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
    ['components/layout/nav-config.ts', 'the agency sidebar'],
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
