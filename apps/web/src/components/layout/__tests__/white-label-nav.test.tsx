import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AGENCY_OWNER_NAV,
  FIRST_UPGRADE_GROUP,
  WHITE_LABEL_FIRST_UPGRADE_GROUP,
  WHITE_LABEL_OWNER_NAV,
  allNavItems,
  firstUpgradeGroupOf,
  isLockedGroup,
  navFor,
  PLATFORM_NAV,
  type NavGroup,
} from '@/components/layout/nav-config';
import {
  isRouteBlockedFor,
  isStaffOnlyRoute,
  STAFF_ONLY_ROUTES,
  WHITE_LABEL_ROUTES,
} from '@/lib/staff-only-routes';

/**
 * The white-label tier's navigation, and the redirect that has to agree with it.
 *
 * A white-label agency sells calls as well as taking them, so for its OWNER and
 * ADMIN six screens a normal agency is shown as upgrades are working screens
 * -- Sales, Publishers, Buyers, Numbers, Payouts and their own agencies -- and
 * five are still upgrades. The requirement is spelled out below rather than
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

/** [label, [name, href, locked]] -- the order asked for. */
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
    'Call Sales',
    [
      ['Sales', '/sales', false],
      ['Campaigns', '/campaigns', false],
      ['Reports', '/reports', false],
    ],
  ],
  [
    'Call Network',
    [
      ['Publishers', '/publishers', false],
      ['Buyers', '/buyers', false],
      ['Numbers', '/numbers', false],
      ['Payouts', '/payouts', false],
    ],
  ],
  [
    'Agency Network',
    [
      ['Agencies', '/network/agencies', false],
      ['Onboard an Agency', '/network/onboarding', false],
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
    'Upgrades',
    [
      ['Power Dialer', '/call-center', true],
      ['VOIP Carrier Routing', '/settings/carriers', true],
      ['Voice Agents', '/voice-agents', true],
      ['Voice Studio', '/voice-studio', true],
      ['Payroll Admin', '/admin/payroll', true],
    ],
  ],
];

const items = WHITE_LABEL_OWNER_NAV.flatMap(group => group.items);
const locked = items.filter(item => item.locked);

describe('WHITE_LABEL_OWNER_NAV', () => {
  it('has the groups in order', () => {
    expect(WHITE_LABEL_OWNER_NAV.map(group => group.label)).toEqual(
      EXPECTED.map(([label]) => label)
    );
  });

  it.each(EXPECTED.map(([label, want]) => [label ?? '(unlabelled)', want] as const))(
    '%s has its items in order, locked where marked',
    (label, want) => {
      const group = WHITE_LABEL_OWNER_NAV.find(g => (g.label ?? '(unlabelled)') === label);
      expect(group, `no group ${label}`).toBeDefined();
      expect(group!.items.map(item => [item.name, item.href, !!item.locked])).toEqual(want);
    }
  );

  it('opens the six white-label screens, and leaves the five upgrades locked', () => {
    const open = allNavItems(WHITE_LABEL_OWNER_NAV).map(item => item.href);
    for (const href of [
      '/sales',
      '/publishers',
      '/buyers',
      '/numbers',
      '/payouts',
      '/network/agencies',
      '/network/onboarding',
    ]) {
      expect(open, href).toContain(href);
    }
    expect(locked.map(item => item.name)).toEqual([
      'Power Dialer',
      'VOIP Carrier Routing',
      'Voice Agents',
      'Voice Studio',
      'Payroll Admin',
    ]);
  });

  it('gives each upgrade the blurb a normal agency is shown for it', () => {
    const agency = new Map(
      AGENCY_OWNER_NAV.flatMap(group => group.items).map(item => [item.href, item] as const)
    );
    for (const item of locked) {
      expect(item.locked?.blurb, item.href).toBe(agency.get(item.href)?.locked?.blurb);
    }
  });

  it('carries the icons, and the tooltips asked for', () => {
    const byHref = new Map(items.map(item => [item.href, item] as const));
    expect(byHref.get('/sales')?.title).toBe(
      'What your calls sold for: buyers, revenue, payouts, profit'
    );
    expect(byHref.get('/payouts')?.title).toBe(
      'What you owe each publisher, and what you have paid'
    );
    expect(byHref.get('/network/agencies')?.title).toBe(
      'Your agencies: calls, applications and closing percentage'
    );
  });

  it('links every working item to a page that exists', () => {
    for (const item of allNavItems(WHITE_LABEL_OWNER_NAV)) {
      expect(hasPage(item.href), `${item.href} has no page`).toBe(true);
    }
  });

  it('draws the "Unlock more" divider above the upgrades, and only the upgrades', () => {
    expect(firstUpgradeGroupOf(WHITE_LABEL_OWNER_NAV)).toBe(WHITE_LABEL_FIRST_UPGRADE_GROUP);
    const divider = WHITE_LABEL_OWNER_NAV.findIndex(
      group => group.label === WHITE_LABEL_FIRST_UPGRADE_GROUP
    );
    WHITE_LABEL_OWNER_NAV.forEach((group, i) => {
      expect(isLockedGroup(group), group.label).toBe(i >= divider);
    });
  });

  it('still draws the agency divider where it was', () => {
    expect(firstUpgradeGroupOf(AGENCY_OWNER_NAV)).toBe(FIRST_UPGRADE_GROUP);
    expect(firstUpgradeGroupOf(PLATFORM_NAV)).toBeNull();
  });

  it('never calls anything "booked" or an agent team a "desk"', () => {
    const copy = items.map(item => `${item.name} ${item.title ?? ''} ${item.locked?.blurb ?? ''}`);
    expect(copy.join(' ')).not.toMatch(/\bbooked\b|\bdesk\b/i);
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

  it('never gives the white-label nav without full access', () => {
    expect(navFor({ ...NOBODY, isWhiteLabel: true, isAgentOnly: true })).not.toBe(
      WHITE_LABEL_OWNER_NAV
    );
    expect(navFor({ ...NOBODY, isWhiteLabel: true })).toEqual([]);
  });
});

describe('isRouteBlockedFor', () => {
  const EIGHT = [
    '/publishers',
    '/buyers',
    '/numbers',
    '/payouts',
    '/reports',
    '/sales',
    '/network/agencies',
    '/network/onboarding',
  ];

  const WL = { isPlatformAdmin: false, isWhiteLabel: true };
  const NORMAL = { isPlatformAdmin: false, isWhiteLabel: false };
  const STAFF = { isPlatformAdmin: true, isWhiteLabel: false };

  it('is the eight routes asked for', () => {
    expect([...WHITE_LABEL_ROUTES]).toEqual(EIGHT);
  });

  it.each(EIGHT)('lets a white-label owner through %s, and what is under it', path => {
    expect(isRouteBlockedFor(path, WL)).toBe(false);
    expect(isRouteBlockedFor(`${path}/`, WL)).toBe(false);
    expect(isRouteBlockedFor(`${path}?id=abc`, WL)).toBe(false);
  });

  it.each(EIGHT)('blocks a normal owner on %s', path => {
    expect(isStaffOnlyRoute(path)).toBe(true);
    expect(isRouteBlockedFor(path, NORMAL)).toBe(true);
  });

  it('lets staff through everything', () => {
    for (const path of [...STAFF_ONLY_ROUTES, ...EIGHT, '/dashboard']) {
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
