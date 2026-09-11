import { existsSync, readdirSync, statSync } from 'node:fs';
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

/**
 * Every link in the nav goes somewhere.
 *
 * ── The defect this exists for ───────────────────────────────────────────────
 *
 * `AGENT_NAV` had twelve items and seven of them were dead. `/calls/my` had no
 * route at all. Campaigns, Publishers, Buyers, Numbers and Billing were each
 * wrapped in a `RoleGuard` for ADMIN/OWNER that bounced an agent straight back
 * to /call-center. Reports required `reports:read`, which AGENT is not granted.
 *
 * An agent clicking seven of twelve items and being thrown back where they
 * started learns not to trust the nav — and nothing in the codebase said so. The
 * nav is data, the routes are files, and nobody was comparing them.
 *
 * This compares them. It resolves every href in all three full-access navs (and
 * the publisher and buyer navs, which cost nothing to include) against the page
 * files under `src/app`, so adding a link to a page that does not exist fails
 * here rather than in somebody's hands.
 *
 * ── What it does NOT check ──────────────────────────────────────────────────
 *
 * Whether the role that sees the link is allowed through the guard on the page
 * behind it. That is a property of the page, not of this file, and the
 * role-specific navs are now built so the question does not arise: the five
 * guarded pages are simply not in `AGENT_NAV` any more. A test that tried to
 * resolve RoleGuard statically would be asserting against a regex, not against
 * behaviour.
 *
 * Items marked `pending` are excluded by design: the flag means "this route is
 * deliberately not built yet", the sidebar renders them disabled rather than as
 * links, and the whole point is to show the shape of the product without
 * shipping a 404.
 */

const APP_DIR = resolve(__dirname, '../../../app');

/**
 * Every URL path that has a page, as Next resolves them.
 *
 * Route groups — the `(dashboard)`, `(research)` and `(platform)` directories —
 * are transparent in the URL, so they are stripped rather than walked around.
 * Dynamic segments (`[runId]`) are kept as they are written: no href in the nav
 * is dynamic, and a literal match against `[runId]` failing is the correct
 * outcome if one ever is.
 */
function collectRoutes(dir: string, urlPath = ''): Set<string> {
  const routes = new Set<string>();

  if (!existsSync(dir)) return routes;

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;

    // `_lib`, `__tests__` and the like are not routes.
    if (entry.startsWith('_') || entry.startsWith('.')) continue;

    // A route group contributes nothing to the URL.
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

/** The path an href points at, with any query string dropped. */
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

describe('the route table this test resolves against', () => {
  it('found the app directory and a plausible number of pages', () => {
    // A broken path would make every assertion below vacuously fail, or — if the
    // set were compared the other way round — vacuously pass. Pin it.
    expect(existsSync(APP_DIR), `no app directory at ${APP_DIR}`).toBe(true);
    expect(ROUTES.size).toBeGreaterThan(30);
    expect(ROUTES.has('/dashboard')).toBe(true);
    expect(ROUTES.has('/call-center')).toBe(true);
  });
});

describe.each(NAVS)('%s: every href resolves to a page', (name, groups) => {
  const items = liveItems(groups);

  it('has items at all', () => {
    expect(items.length, `${name} is empty`).toBeGreaterThan(0);
  });

  it.each(items.map(item => [item.name, item.href] as const))(
    '%s → %s',
    (_itemName, href) => {
      expect(
        ROUTES.has(pathOf(href)),
        `${name} links to ${href}, which has no page under src/app`
      ).toBe(true);
    }
  );
});

describe('the seven dead agent links, named', () => {
  /**
   * The exact hrefs that were in `AGENT_NAV` and should never return to it.
   *
   * `/calls/my` had no route. The other five are guarded for ADMIN/OWNER and
   * bounce an agent to /call-center; `/reports` needs `reports:read`, which AGENT
   * does not get. Listed by href rather than described, because "do not add dead
   * links" is advice and this is a check.
   */
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

  it.each(FORBIDDEN)('AGENT_NAV does not link to %s', href => {
    expect(agentHrefs).not.toContain(href);
  });
});

describe("AGENCY_OWNER_NAV is the agency's, not NetEnroll's", () => {
  /**
   * The platform machinery an agency principal has no use for, plus the two
   * screens the API refuses them outright (`/admin/agencies` and
   * `/admin/onboarding` are gated on `requirePlatformAdmin`).
   *
   * Every one of these resolves to a real page, so the href test above cannot
   * catch them. This is the check that the SPLIT holds — the bug was never a
   * broken link, it was sixteen working links to somebody else's console.
   */
  const PLATFORM_ONLY = [
    '/campaigns',
    '/publishers',
    '/buyers',
    '/numbers',
    '/settings/carriers',
    '/settings/dnc',
    '/settings/webhooks',
    '/settings/quotas',
    '/flows',
    '/voice-agents',
    '/voice-studio',
    '/music-console',
    '/tools/industry-research',
    '/billing',
    '/reports',
    '/admin/agencies',
    '/admin/onboarding',
  ];

  const ownerHrefs = AGENCY_OWNER_NAV.flatMap(group => group.items).map(item => pathOf(item.href));

  it.each(PLATFORM_ONLY)('AGENCY_OWNER_NAV does not link to %s', href => {
    expect(ownerHrefs).not.toContain(href);
  });

  it('still carries the rate and the delivery figures, which are the principal‘s', () => {
    expect(ownerHrefs).toContain('/rating');
    expect(ownerHrefs).toContain('/delivery');
    expect(ownerHrefs).toContain('/delivery/settlements');
  });

  it('PLATFORM_NAV keeps everything, including the two staff-only screens', () => {
    const platformHrefs = PLATFORM_NAV.flatMap(group => group.items).map(item => pathOf(item.href));
    expect(platformHrefs).toContain('/admin/agencies');
    expect(platformHrefs).toContain('/admin/onboarding');
    expect(platformHrefs).toContain('/campaigns');
  });
});
