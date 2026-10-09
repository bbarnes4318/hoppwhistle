import { describe, expect, it } from 'vitest';

import { MANAGER_NAV, navFor, type NavViewer } from '@/components/layout/nav-config';
import { homePathForRoles } from '@/lib/roles';
import { isMonitorInvite } from '@/lib/softphone-call-id';

/**
 * The agency MANAGER: supervises the live floor and listens in on agents'
 * calls. These pin where they land, what they are shown, and how their
 * softphone recognises a listen-in leg.
 */

const VIEWER: NavViewer = {
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

const hrefs = (groups: ReturnType<typeof navFor>): string[] =>
  groups.flatMap(group => group.items.map(item => item.href));

describe('a MANAGER', () => {
  it('lands on the live floor', () => {
    expect(homePathForRoles(['MANAGER'])).toBe('/monitor');
    expect(homePathForRoles(['MANAGER', 'AGENT'])).toBe('/monitor');
    // An owner who also manages is still the owner.
    expect(homePathForRoles(['OWNER', 'MANAGER'])).toBe('/dashboard');
  });

  it('is shown the floor and their account, and nothing administrative', () => {
    const nav = navFor({ ...VIEWER, isManagerOnly: true });
    expect(nav).toBe(MANAGER_NAV);
    expect(hrefs(nav)).toEqual(['/monitor', '/account', '/feedback']);
  });

  it('keeps an agent’s pages when they also take calls', () => {
    const nav = hrefs(navFor({ ...VIEWER, isManagerOnly: true, isAgentOnly: true }));
    expect(nav[0]).toBe('/monitor');
    expect(nav).toContain('/calls');
  });
});

describe('isMonitorInvite', () => {
  it('reads the listen-in header', () => {
    expect(
      isMonitorInvite({
        getHeader: name =>
          name === 'X-Hopwhistle-Monitor' ? '0b9c1f3e-1111-4222-8333-444455556666' : undefined,
      })
    ).toBe(true);
    expect(isMonitorInvite({ headers: { 'x-hopwhistle-monitor': [{ raw: 'abc' }] } })).toBe(true);
  });

  it('is false for an ordinary call', () => {
    expect(isMonitorInvite({ getHeader: () => undefined })).toBe(false);
    expect(isMonitorInvite(null)).toBe(false);
  });
});
