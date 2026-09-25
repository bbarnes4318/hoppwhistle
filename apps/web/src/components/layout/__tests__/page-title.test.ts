import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AGENCY_OWNER_NAV, AGENT_NAV, PLATFORM_NAV } from '../nav-config';
import { pageTitleFor } from '../page-title';

/**
 * One page title, at the top, and only one.
 *
 * Every screen under the dashboard used to render the page's name twice: the
 * topbar's `<h1 className="t-title">` from `pageTitleFor`, and a second
 * identical `<h1>` from the page itself a few pixels below it. Several pages
 * then opened with a section heading carrying the same word again, so the name
 * could appear three times before any data did.
 *
 * These tests hold both halves of the fix: that the one remaining title says
 * the right thing, and that the pages fixed have not grown a second one back.
 */

const PAGES_ROOT = join(__dirname, '..', '..', '..', 'app', '(dashboard)');

describe('the topbar is the only place a page is named', () => {
  /**
   * The titles asked for, spelled out rather than read from the nav.
   *
   * A test that imports the list it is checking passes whatever that list
   * happens to say, including after somebody edits it. These are the
   * requirement, written down a second time so the two have to agree.
   */
  const REQUIRED: Array<[string, string]> = [
    /*
     * `/settings/agents` is not here any more. It was its own page with its own
     * title; the roster merged into Team Members and the path is a redirect, so
     * the only honest assertion about its title is that nobody reads one.
     */
    ['/settings/users', 'Team Members'],
    ['/settings/webhooks', 'Webhooks'],
    ['/settings/dnc', 'DNC Lists'],
    ['/settings/quotas', 'Quotas & Budgets'],
    ['/admin/payroll', 'Payroll Admin'],
    // Renamed in PLATFORM_NAV; the topbar follows the nav.
    ['/settings/carriers', 'VOIP Carrier Routing'],
    ['/live', 'Live Board'],
    ['/admin/live', 'Live board'],
  ];

  it.each(REQUIRED)('%s is titled "%s"', (path, title) => {
    expect(pageTitleFor(path)).toBe(title);
  });

  /**
   * The heading is a name the nav actually gives the page.
   *
   * `page-title.ts` derives from the nav precisely so renaming a sidebar entry
   * renames the heading and the browser tab with it. An EXPLICIT override for a
   * path that IS a nav item silently breaks that: the override wins, the nav
   * moves on without it, and the two disagree with nothing to say so. Five
   * settings routes were in exactly that state, which is why `/settings/users`
   * could be renamed in the sidebar and go on reading "Users" at the top of the
   * page it named.
   *
   * Not "equals the name of every nav item on that path", because one path can
   * honestly carry two names: `/calls` is "Calls" to staff and "My calls" to an
   * agent, and `/delivery/me` likewise. The rule is that the title is one of
   * them and never something only the override remembers.
   */
  it('never lets an override shadow a nav entry', () => {
    const namesByPath = new Map<string, string[]>();
    for (const item of [...PLATFORM_NAV, ...AGENCY_OWNER_NAV, ...AGENT_NAV].flatMap(g => g.items)) {
      const path = item.href.split('?')[0];
      namesByPath.set(path, [...(namesByPath.get(path) ?? []), item.name]);
    }

    for (const [path, names] of namesByPath) {
      expect(
        names,
        `${path} is titled "${pageTitleFor(path)}", which no nav entry calls it`
      ).toContain(pageTitleFor(path));
    }
  });
});

describe('the pages that were fixed render no title of their own', () => {
  /**
   * The screens named in the request. Scoped to them on purpose: the same
   * duplication is still present on the publisher and buyer portals, the AI
   * campaign screens, Voice Studio and the call centre, and this list is what
   * says which ones have been dealt with.
   */
  const CONVERTED = [
    'dashboard',
    'calls',
    'applications',
    'leaderboard',
    'insurance-leads',
    'insurance-leads/reports',
    'rating',
    'delivery',
    'delivery/team',
    'delivery/settlements',
    'billing',
    'reports',
    'settings',
    'settings/agents',
    'settings/users',
    'admin/live',
    'settings/webhooks',
    'settings/dnc',
    'settings/quotas',
    'admin/payroll',
  ];

  it.each(CONVERTED)('%s/page.tsx has no <h1>', page => {
    const source = readFileSync(join(PAGES_ROOT, page, 'page.tsx'), 'utf8');
    expect(source.includes('<h1')).toBe(false);
  });

  /**
   * The shared header no longer carries a title either, which is what made the
   * fix one edit rather than twenty-four. A `title` prop reaching it again
   * would put the second heading back on every page at once.
   */
  it('CompactPageHeader renders no heading and takes no title', () => {
    const source = readFileSync(join(__dirname, '..', 'compact-layout.tsx'), 'utf8');

    const start = source.indexOf('export function CompactPageHeader');
    const body = source.slice(start, source.indexOf('\ninterface', start));
    expect(body).not.toContain('<h1');

    // The interface body alone. The doc comment above the function legitimately
    // uses the word "title" to explain why it no longer takes one.
    const declStart = source.indexOf('interface CompactPageHeaderProps');
    const props = source.slice(declStart, source.indexOf('}', declStart));
    expect(props).not.toMatch(/^\s*title\??:/m);
    expect(props).not.toMatch(/^\s*icon\??:/m);
  });
});
