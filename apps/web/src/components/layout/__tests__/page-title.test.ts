import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { AGENCY_OWNER_NAV, AGENT_NAV, PLATFORM_NAV, WHITE_LABEL_OWNER_NAV } from '../nav-config';
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
   * honestly carry two names: `/dashboard` is "Dashboard" to staff and "Today"
   * to an agent. The rule is that the title is one of
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
    // Moved off CompactPageShell onto page-canvas + PageHeader.
    'campaigns',
    'publishers',
    'buyers',
    'numbers',
    'live',
    'phone',
    'settings/carriers',
    'admin/agencies',
    'admin/onboarding',
  ];

  it.each(CONVERTED)('%s/page.tsx has no <h1>', page => {
    const source = readFileSync(join(PAGES_ROOT, page, 'page.tsx'), 'utf8');
    expect(source.includes('<h1')).toBe(false);
  });

  /**
   * One title per page, in the topbar. The topbar is the page header: it
   * always names the page, and a page's PageHeader renders its description,
   * actions and any title of its own into the topbar's slots through portals.
   * A header or hub that printed the title in the content again whenever the
   * topbar is there would put the second heading back on every page at once.
   */
  it('the topbar names every page, and PageHeader docks into it', () => {
    const header = readFileSync(join(__dirname, '..', 'page-header.tsx'), 'utf8');
    const body = header.slice(header.indexOf('export function PageHeader'));
    expect(body).toContain('useTopbarSlots()');
    expect(body).toContain(
      'createPortal(<span data-docked="">{description}</span>, descriptionTarget)'
    );
    expect(body).toContain('createPortal(actions, actionsTarget)');
    // The in-page heading is the no-topbar fallback only.
    expect(body).toContain('const standalone = slots.title === null');
    expect(body.match(/<h1/g)).toHaveLength(1);

    const topbar = readFileSync(join(__dirname, '..', 'topbar.tsx'), 'utf8');
    expect(topbar).toContain("publishTopbarSlot('title', el)");
    expect(topbar).toContain("publishTopbarSlot('description', el)");
    expect(topbar).toContain("publishTopbarSlot('actions', el)");
    expect(topbar).toContain(
      '{titleClaimed ? null : <span className="min-w-0 truncate">{title}</span>}'
    );

    const hub = readFileSync(join(__dirname, '..', '..', 'hub', 'hub-tabs.tsx'), 'utf8');
    expect(hub).toContain('useTopbarSlots().title === null ? nav : null');
    expect(hub).toContain('<InHubContext.Provider value={true}>');
  });
});

describe("the viewer's own nav names its pages first", () => {
  it('calls /dashboard Today for a white-label owner, and Dashboard otherwise', () => {
    expect(pageTitleFor('/dashboard', WHITE_LABEL_OWNER_NAV)).toBe('Today');
    expect(pageTitleFor('/dashboard')).toBe('Dashboard');
    expect(pageTitleFor('/buyers', WHITE_LABEL_OWNER_NAV)).toBe('Buyers');
    expect(pageTitleFor('/agents')).toBe('Agents');
  });

  it('calls a campaign Routing for a white-label owner, who opens it from there', () => {
    const campaign = '/campaigns/0b7c9d3e-5f1a-4c2b-9e8d-1a2b3c4d5e6f';
    expect(pageTitleFor(campaign, WHITE_LABEL_OWNER_NAV)).toBe('Routing');
    expect(pageTitleFor(campaign)).toBe('Campaigns');
    expect(pageTitleFor(campaign, AGENCY_OWNER_NAV)).toBe('Campaigns');
  });
});

describe("an agent's pages", () => {
  it('names them as the owner does: Today, Calls, Applications, CRM, Leaderboard', () => {
    expect(pageTitleFor('/dashboard', AGENT_NAV)).toBe('Today');
    expect(pageTitleFor('/calls', AGENT_NAV)).toBe('Calls');
    expect(pageTitleFor('/applications', AGENT_NAV)).toBe('Applications');
    expect(pageTitleFor('/insurance-leads', AGENT_NAV)).toBe('CRM');
    expect(pageTitleFor('/leaderboard', AGENT_NAV)).toBe('Leaderboard');
    expect(pageTitleFor('/account', AGENT_NAV)).toBe('Account');
  });

  it('titles a customer record by the CRM entry it is reached from', () => {
    expect(pageTitleFor('/insurance-leads/0f8c1d2e-aaaa-4bbb-8ccc-123456789abc', AGENT_NAV)).toBe(
      'CRM'
    );
    // The same name an owner's sidebar uses.
    expect(pageTitleFor('/insurance-leads', WHITE_LABEL_OWNER_NAV)).toBe('CRM');
  });

  it('gives an agent and a white-label owner the same name for /dashboard', () => {
    expect(pageTitleFor('/dashboard', WHITE_LABEL_OWNER_NAV)).toBe('Today');
    expect(pageTitleFor('/dashboard', AGENT_NAV)).toBe('Today');
  });
});
