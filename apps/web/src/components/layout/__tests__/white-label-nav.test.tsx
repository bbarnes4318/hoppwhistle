import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AGENCY_OWNER_NAV,
  FIRST_UPGRADE_GROUP,
  WHITE_LABEL_OWNER_NAV,
  WHITE_LABEL_UPGRADES,
  allNavItems,
  firstUpgradeGroupOf,
  isLockedGroup,
  navFor,
  PLATFORM_NAV,
  whiteLabelOwnerNav,
  type NavGroup,
} from '@/components/layout/nav-config';
import {
  isRouteBlockedFor,
  isStaffOnlyRoute,
  STAFF_ONLY_ROUTES,
  WHITE_LABEL_REDIRECTS,
  WHITE_LABEL_ROUTES,
  whiteLabelRedirectFor,
} from '@/lib/staff-only-routes';

/**
 * The white-label tier's navigation, and the redirects that have to agree with it.
 *
 * A white-label agency sells calls as well as taking them. Its OWNER and ADMIN
 * get eleven entries in five groups, and nothing locked: the screens that used
 * to be separate entries are tabs of the hub they belong to, and the upgrades
 * are a page of their own. The requirement is spelled out below rather than
 * read back from the nav, so the two have to agree.
 */

const APP_DIR = resolve(__dirname, '../../../app');

/** A route that has a page, in the dashboard group or at the root. */
function hasPage(href: string): boolean {
  const path = href.split('?')[0];
  return (
    existsSync(join(APP_DIR, '(dashboard)', path, 'page.tsx')) ||
    existsSync(join(APP_DIR, path, 'page.tsx'))
  );
}

/** [label, [name, href, title]] -- exactly the list asked for. */
const EXPECTED: Array<[string | undefined, Array<[string, string, string | undefined]>]> = [
  [undefined, [['Today', '/dashboard', 'Your calls, agents, buyers and money right now']]],
  [
    'Floor',
    [
      ['Calls', '/calls', undefined],
      ['Applications', '/applications', undefined],
      ['Agents', '/agents', 'How your agents are doing, and who can take a call'],
    ],
  ],
  [
    'Call Sales',
    [
      ['Buyers', '/buyers', 'Your buyers: routing caps, balances, portal logins and returns'],
      ['Publishers', '/publishers', 'Your publishers: payouts, portal logins and performance'],
      ['Revenue', '/revenue', 'What your calls sold for, by buyer, publisher, campaign and day'],
    ],
  ],
  ['Routing', [['Routing', '/routing', 'Campaigns and phone numbers: where every call goes']]],
  [
    'Network',
    [
      [
        'Agencies',
        '/network/agencies',
        'Your agencies: calls, applications and closing percentage',
      ],
    ],
  ],
  [
    'Account',
    [
      ['Settings', '/settings', undefined],
      ['Upgrades', '/upgrades', 'Features you can add'],
    ],
  ],
];

const items = WHITE_LABEL_OWNER_NAV.flatMap(group => group.items);

describe('WHITE_LABEL_OWNER_NAV', () => {
  it('has the five groups in order', () => {
    expect(WHITE_LABEL_OWNER_NAV.map(group => group.label)).toEqual(
      EXPECTED.map(([label]) => label)
    );
  });

  it('has exactly eleven items, none of them locked or pending', () => {
    expect(items).toHaveLength(11);
    expect(items.filter(item => item.locked || item.pending)).toEqual([]);
    expect(allNavItems(WHITE_LABEL_OWNER_NAV)).toHaveLength(11);
  });

  it.each(EXPECTED.map(([label, want]) => [label ?? '(unlabelled)', want] as const))(
    '%s has its items in order, with the tooltips asked for',
    (label, want) => {
      const group = WHITE_LABEL_OWNER_NAV.find(g => (g.label ?? '(unlabelled)') === label);
      expect(group, `no group ${label}`).toBeDefined();
      expect(group!.items.map(item => [item.name, item.href])).toEqual(
        want.map(([name, href]) => [name, href])
      );
      want.forEach(([, href, title]) => {
        if (title === undefined) return;
        expect(group!.items.find(item => item.href === href)?.title, href).toBe(title);
      });
    }
  );

  it('carries the platform entries it reuses unchanged, apart from what was overridden', () => {
    const platform = new Map(
      PLATFORM_NAV.flatMap(group => group.items).map(item => [item.href, item] as const)
    );
    for (const href of ['/calls', '/applications', '/settings']) {
      const item = items.find(i => i.href === href)!;
      expect(item.title).toBe(platform.get(href)?.title);
      expect(item.icon).toBe(platform.get(href)?.icon);
    }
    expect(items.find(i => i.href === '/dashboard')?.icon).toBe(platform.get('/dashboard')?.icon);
  });

  it('no longer lists the screens that became tabs, or the old upgrades', () => {
    const hrefs = items.map(item => item.href);
    for (const href of [
      '/live',
      '/leaderboard',
      '/insurance-leads',
      '/sales',
      '/campaigns',
      '/reports',
      '/numbers',
      '/payouts',
      '/network/onboarding',
      '/rating',
      '/delivery',
      '/delivery/team',
      '/delivery/settlements',
      '/billing',
      '/settings/users',
      '/call-center',
      '/settings/carriers',
      '/voice-agents',
      '/voice-studio',
      '/admin/payroll',
    ]) {
      expect(hrefs, href).not.toContain(href);
    }
  });

  it('links every item to a page that exists', () => {
    for (const item of allNavItems(WHITE_LABEL_OWNER_NAV)) {
      expect(hasPage(item.href), `${item.href} has no page`).toBe(true);
    }
  });

  it('draws no "Unlock more" divider, because nothing is locked', () => {
    expect(firstUpgradeGroupOf(WHITE_LABEL_OWNER_NAV)).toBeNull();
    WHITE_LABEL_OWNER_NAV.forEach(group => expect(isLockedGroup(group), group.label).toBe(false));
  });

  it('still draws the agency divider where it was', () => {
    expect(firstUpgradeGroupOf(AGENCY_OWNER_NAV)).toBe(FIRST_UPGRADE_GROUP);
    expect(firstUpgradeGroupOf(PLATFORM_NAV)).toBeNull();
  });

  it('never calls anything "booked" or an agent team a "desk"', () => {
    const copy = [
      ...items.map(item => `${item.name} ${item.title ?? ''}`),
      ...WHITE_LABEL_UPGRADES.map(
        u => `${u.item.name} ${u.item.locked?.blurb ?? ''} ${u.note ?? ''}`
      ),
    ];
    expect(copy.join(' ')).not.toMatch(/\bbooked\b|\bdesk\b/i);
  });
});

describe('the white-label upgrades', () => {
  it('lists the five old locked items, with the blurbs a normal agency is shown', () => {
    const agency = new Map(
      AGENCY_OWNER_NAV.flatMap(group => group.items).map(item => [item.href, item] as const)
    );
    expect(WHITE_LABEL_UPGRADES.map(u => u.item.name)).toEqual([
      'Power Dialer',
      'VOIP Carrier Routing',
      'Voice Agents',
      'Voice Studio',
      'Payroll Admin',
    ]);
    for (const upgrade of WHITE_LABEL_UPGRADES) {
      expect(upgrade.item.locked?.blurb, upgrade.key).toBe(
        agency.get(upgrade.item.href)?.locked?.blurb
      );
    }
    expect(WHITE_LABEL_UPGRADES[0].note).toBe('Includes the CRM and lead lists your agents dial.');
  });

  it('adds the CRM to the floor only once Power Dialer is on', () => {
    expect(whiteLabelOwnerNav([])).toBe(WHITE_LABEL_OWNER_NAV);
    expect(whiteLabelOwnerNav(['VOICE_STUDIO'])).toBe(WHITE_LABEL_OWNER_NAV);

    const unlocked = whiteLabelOwnerNav(['POWER_DIALER']);
    const floor = unlocked.find(group => group.label === 'Floor')!;
    expect(floor.items.map(item => item.href)).toEqual([
      '/calls',
      '/applications',
      '/agents',
      '/insurance-leads',
    ]);
    // The constant itself is not touched.
    expect(WHITE_LABEL_OWNER_NAV.flatMap(g => g.items)).toHaveLength(11);
  });
});

describe('AGENCY_OWNER_NAV is unchanged', () => {
  /** A fingerprint of the normal agency nav, written down before this change. */
  const fingerprint = (groups: NavGroup[]) =>
    groups.map(group => [
      group.label ?? null,
      group.items.map(item => [item.name, item.href, item.locked?.blurb ?? null]),
    ]);

  it('lists the same groups and items, locked the same way', () => {
    expect(fingerprint(AGENCY_OWNER_NAV)).toEqual([
      [null, [['Dashboard', '/dashboard', null]]],
      [
        'Floor',
        [
          ['Live Board', '/live', null],
          ['Calls', '/calls', null],
          ['Applications', '/applications', null],
          ['Leaderboard', '/leaderboard', null],
          ['CRM', '/insurance-leads', null],
        ],
      ],
      [
        'Sales',
        [
          ['Campaigns', '/campaigns', null],
          [
            'Power Dialer',
            '/call-center',
            'Put your agents on a dialer that paces calls to how many agents are free.',
          ],
        ],
      ],
      [
        'Money',
        [
          ['Rate', '/rating', null],
          ['Delivery', '/delivery', null],
          ['Team', '/delivery/team', null],
          ['Settlements', '/delivery/settlements', null],
          ['Billing', '/billing', null],
        ],
      ],
      [
        'Account',
        [
          ['Team Members', '/settings/users', null],
          ['Settings', '/settings', null],
        ],
      ],
      [
        'Call Network',
        [
          [
            'Publishers',
            '/publishers',
            'See every source sending your agency calls and how each one converts.',
          ],
          [
            'Buyers',
            '/buyers',
            "Route calls your agents can't take to buyers and get paid for the overflow.",
          ],
          [
            'Numbers',
            '/numbers',
            'Buy and manage your own tracking numbers, with full call history on each.',
          ],
          [
            'VOIP Carrier Routing',
            '/settings/carriers',
            'Choose which VOIP carriers carry your calls and set automatic failover between them.',
          ],
        ],
      ],
      [
        'AI Voice',
        [
          [
            'Voice Agents',
            '/voice-agents',
            'AI voice agents that answer, qualify and transfer live callers straight to your agents.',
          ],
          [
            'Voice Studio',
            '/voice-studio',
            "Build and fine-tune your voice agents' scripts and voices before they go live.",
          ],
        ],
      ],
      [
        'Payouts & Payroll',
        [
          ['Payouts', '/payouts', 'Track what you owe every publisher and pay out on schedule.'],
          [
            'Payroll Admin',
            '/admin/payroll',
            'Run agent commissions and payroll from the same data as your submitted applications.',
          ],
        ],
      ],
      [
        'Agency Network',
        [
          [
            'Agencies',
            '/admin/agencies',
            'Manage the downline agencies working under your account.',
          ],
          [
            'Onboard an Agency',
            '/admin/onboarding',
            'Bring a new agency onto the platform with agreement, payment and portal access in one flow.',
          ],
        ],
      ],
    ]);
  });
});

describe('navFor with the white-label tier', () => {
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

  it('gives a white-label owner the white-label nav', () => {
    expect(navFor({ ...NOBODY, hasFullAccess: true, isWhiteLabel: true })).toBe(
      WHITE_LABEL_OWNER_NAV
    );
  });

  it('gives a normal owner the agency nav', () => {
    expect(navFor({ ...NOBODY, hasFullAccess: true })).toBe(AGENCY_OWNER_NAV);
  });

  it('gives staff the platform nav inside a white-label agency', () => {
    expect(
      navFor({ ...NOBODY, isPlatformAdmin: true, hasFullAccess: true, isWhiteLabel: true })
    ).toBe(PLATFORM_NAV);
  });

  it('follows the previewed role for staff previewing a white-label agency', () => {
    expect(
      navFor({
        ...NOBODY,
        isPlatformAdmin: true,
        previewing: true,
        hasFullAccess: true,
        isWhiteLabel: true,
      })
    ).toBe(WHITE_LABEL_OWNER_NAV);
  });

  it('adds the CRM for a white-label owner whose agency has Power Dialer', () => {
    const groups = navFor({
      ...NOBODY,
      hasFullAccess: true,
      isWhiteLabel: true,
      upgrades: ['POWER_DIALER'],
    });
    expect(allNavItems(groups).map(item => item.href)).toContain('/insurance-leads');
    expect(
      allNavItems(navFor({ ...NOBODY, hasFullAccess: true, isWhiteLabel: true })).map(i => i.href)
    ).not.toContain('/insurance-leads');
    // A normal agency's nav does not read upgrades at all.
    expect(navFor({ ...NOBODY, hasFullAccess: true, upgrades: ['POWER_DIALER'] })).toBe(
      AGENCY_OWNER_NAV
    );
  });

  it('never gives the white-label nav without full access', () => {
    expect(navFor({ ...NOBODY, isWhiteLabel: true, isAgentOnly: true })).not.toBe(
      WHITE_LABEL_OWNER_NAV
    );
    expect(navFor({ ...NOBODY, isWhiteLabel: true })).toEqual([]);
  });
});

describe('isRouteBlockedFor', () => {
  const OPENED = [
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
  ];
  const HUBS = ['/agents', '/revenue', '/routing', '/upgrades'];

  const WL = { isPlatformAdmin: false, isWhiteLabel: true };
  const NORMAL = { isPlatformAdmin: false, isWhiteLabel: false };
  const STAFF = { isPlatformAdmin: true, isWhiteLabel: false };

  it('is the routes asked for, the four hubs included', () => {
    expect([...WHITE_LABEL_ROUTES]).toEqual(OPENED);
  });

  it.each(HUBS)('lists the hub %s as staff-only, so a normal agency is sent home', path => {
    expect(STAFF_ONLY_ROUTES as readonly string[]).toContain(path);
    expect(WHITE_LABEL_ROUTES as readonly string[]).toContain(path);
  });

  it.each(OPENED)('lets a white-label owner through %s, and what is under it', path => {
    expect(isRouteBlockedFor(path, WL)).toBe(false);
    expect(isRouteBlockedFor(`${path}/`, WL)).toBe(false);
    expect(isRouteBlockedFor(`${path}?id=abc`, WL)).toBe(false);
  });

  it.each(OPENED)('blocks a normal owner on %s', path => {
    expect(isStaffOnlyRoute(path)).toBe(true);
    expect(isRouteBlockedFor(path, NORMAL)).toBe(true);
  });

  it('lets staff through everything', () => {
    for (const path of [...STAFF_ONLY_ROUTES, ...OPENED, '/dashboard']) {
      expect(isRouteBlockedFor(path, STAFF), path).toBe(false);
    }
  });

  it("keeps the rest of NetEnroll's screens closed to a white-label owner", () => {
    for (const path of [
      '/flows',
      '/voice-agents',
      '/voice-studio',
      '/settings/carriers',
      '/admin/agencies',
      '/admin/onboarding',
      '/admin/payroll',
      '/admin/live',
      '/tools/recording-analyzer',
      '/insurance-leads/reports',
    ]) {
      expect(isRouteBlockedFor(path, WL), path).toBe(true);
    }
  });

  it('matches whole segments, not a bare prefix', () => {
    expect(isRouteBlockedFor('/salesforce', WL)).toBe(false);
    expect(isStaffOnlyRoute('/salesforce')).toBe(false);
    expect(isRouteBlockedFor('/networking', NORMAL)).toBe(false);
  });

  it("answers the way the agency always got for the screens that are not the tier's", () => {
    for (const path of ['/dashboard', '/calls', '/campaigns', '/live', '/billing']) {
      expect(isRouteBlockedFor(path, NORMAL), path).toBe(isStaffOnlyRoute(path));
      expect(isRouteBlockedFor(path, WL), path).toBe(false);
    }
  });
});

describe('whiteLabelRedirectFor', () => {
  const ASKED: Array<[string, string]> = [
    ['/live', '/dashboard'],
    ['/leaderboard', '/agents?tab=performance'],
    ['/delivery/team', '/agents?tab=period'],
    ['/settings/users', '/agents?tab=roster'],
    ['/sales', '/revenue'],
    ['/reports', '/revenue?tab=reports'],
    ['/payouts', '/publishers?tab=payouts'],
    ['/billing', '/buyers?tab=wallets'],
    ['/campaigns', '/routing'],
    ['/numbers', '/routing?tab=numbers'],
    ['/rating', '/settings?tab=plan'],
    ['/delivery', '/settings?tab=plan'],
    ['/delivery/settlements', '/settings?tab=plan&section=settlements'],
  ];

  it('is exactly the redirects asked for', () => {
    expect(Object.entries(WHITE_LABEL_REDIRECTS)).toEqual(ASKED);
  });

  it.each(ASKED)('sends %s to %s', (from, to) => {
    expect(whiteLabelRedirectFor(from)).toBe(to);
    expect(whiteLabelRedirectFor(`${from}/`)).toBe(to);
  });

  it('lands every redirect on a page that exists', () => {
    for (const [, to] of ASKED) expect(hasPage(to), to).toBe(true);
  });

  it('matches exact paths only', () => {
    for (const path of [
      '/campaigns/abc-123',
      '/delivery/me',
      '/network/onboarding',
      '/settings',
      '/settings/webhooks',
      '/buyers',
      '/leaderboards',
      '/dashboard',
    ]) {
      expect(whiteLabelRedirectFor(path), path).toBeNull();
    }
  });

  it("carries the old URL's query under the tab's own", () => {
    expect(whiteLabelRedirectFor('/leaderboard?period=THIS_WEEK')).toBe(
      '/agents?period=THIS_WEEK&tab=performance'
    );
    expect(whiteLabelRedirectFor('/delivery/settlements?tab=x')).toBe(
      '/settings?tab=plan&section=settlements'
    );
  });
});
