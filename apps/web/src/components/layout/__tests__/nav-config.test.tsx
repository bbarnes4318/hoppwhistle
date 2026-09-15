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

describe('OWNER+ADMIN gets the full tenant-admin surface', () => {
  const ownerHrefs = new Set(AGENCY_OWNER_NAV.flatMap(group => group.items).map(item => pathOf(item.href)));
  const platformHrefs = new Set(PLATFORM_NAV.flatMap(group => group.items).map(item => pathOf(item.href)));

  it('matches PLATFORM_NAV for every tenant-scoped route', () => {
    for (const href of platformHrefs) {
      if (href === '/admin/agencies' || href === '/admin/onboarding') continue;
      expect(ownerHrefs.has(href), `OWNER+ADMIN missing ${href}`).toBe(true);
    }
  });

  it('does not expose the two cross-agency platform-only screens', () => {
    expect(ownerHrefs.has('/admin/agencies')).toBe(false);
    expect(ownerHrefs.has('/admin/onboarding')).toBe(false);
  });

  it('includes the previously hidden admin controls', () => {
    for (const href of [
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
      '/billing',
      '/reports',
    ]) {
      expect(ownerHrefs.has(href), `OWNER+ADMIN missing ${href}`).toBe(true);
    }
  });
});
