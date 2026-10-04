import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AGENT_NAV,
  PLATFORM_NAV,
  SALES_GROUP,
  allNavItems,
  navFor,
  type NavViewer,
} from '@/components/layout/nav-config';
import {
  isRouteBlockedFor,
  isStaffOnlyRoute,
  whiteLabelRedirectFor,
} from '@/lib/staff-only-routes';

/**
 * The B2B Sales CRM in the navigation.
 *
 * It is drawn from the server's answer (`salesWorkspace` on `/api/auth/me`),
 * never from a role name the browser holds: the owner gets it, an agent the
 * owner granted gets it, every other agent -- and a child agency, and a
 * normal agency -- does not. It is a separate thing from `CRM`
 * (`/insurance-leads`), the consumer CRM, which stays exactly where it is.
 */

const APP_DIR = resolve(__dirname, '../../../app');
const hasPage = (href: string) => existsSync(join(APP_DIR, '(dashboard)', href, 'page.tsx'));

const BASE: NavViewer = {
  isPlatformAdmin: false,
  previewing: false,
  hasFullAccess: false,
  isWhiteLabel: false,
  isPublisherOnly: false,
  isBuyerOnly: false,
  isAgentOnly: false,
  isReadonlyOnly: false,
  canViewRecordings: true,
};

const hrefs = (viewer: NavViewer) => allNavItems(navFor(viewer)).map(i => i.href);

describe('Sales CRM navigation', () => {
  it('gives NetEnroll staff their own Sales CRM, and keeps Agreements under Admin', () => {
    const nav = hrefs({ ...BASE, isPlatformAdmin: true });
    expect(nav).toContain('/sales-crm');
    expect(nav).toContain('/admin/agreements');
    expect(nav).toContain('/insurance-leads');
    expect(PLATFORM_NAV.find(g => g.label === 'Sales')?.items.map(i => i.name)).toEqual([
      'Sales CRM',
    ]);
  });

  it('gives a white-label owner a Sales group with Sales CRM and Agreements when the server says so', () => {
    const viewer = { ...BASE, hasFullAccess: true, isWhiteLabel: true };
    const groups = navFor({ ...viewer, salesWorkspace: { scope: 'TENANT' } });
    const sales = groups.find(g => g.label === 'Sales');
    expect(sales?.items.map(i => [i.name, i.href])).toEqual([
      ['Sales CRM', '/sales-crm'],
      ['Agreements', '/sales-crm/agreements'],
    ]);
    // Right after Workspace, and the consumer CRM is untouched.
    expect(groups.map(g => g.label).indexOf('Sales')).toBe(
      groups.map(g => g.label).indexOf('Workspace') + 1
    );
    expect(
      allNavItems(groups)
        .filter(i => i.href === '/insurance-leads')
        .map(i => i.name)
    ).toEqual(['CRM']);
  });

  it('hides it from a white-label owner when the server reports none', () => {
    const viewer = { ...BASE, hasFullAccess: true, isWhiteLabel: true };
    expect(hrefs({ ...viewer, salesWorkspace: null })).not.toContain('/sales-crm');
  });

  it('hides it from an ordinary licensed agent', () => {
    const agent = { ...BASE, isAgentOnly: true, isWhiteLabelAgent: true, upgrades: [] };
    expect(hrefs(agent)).not.toContain('/sales-crm');
    expect(hrefs({ ...agent, salesWorkspace: null })).not.toContain('/sales-crm/agreements');
  });

  it('shows it to an agent the owner explicitly granted, without changing the rest of their nav', () => {
    const agent = { ...BASE, isAgentOnly: true, isWhiteLabelAgent: true, upgrades: [] };
    const granted = navFor({ ...agent, salesWorkspace: { scope: 'TENANT' } });
    expect(allNavItems(granted).map(i => i.href)).toEqual(
      expect.arrayContaining(['/sales-crm', '/sales-crm/agreements', '/insurance-leads'])
    );
    const without = allNavItems(navFor(agent)).map(i => i.href);
    expect(
      allNavItems(granted)
        .map(i => i.href)
        .filter(h => !h.startsWith('/sales-crm'))
    ).toEqual(without);
  });

  it('hides it from a child agency owner and a normal agency owner', () => {
    expect(hrefs({ ...BASE, hasFullAccess: true, isChild: true })).not.toContain('/sales-crm');
    expect(hrefs({ ...BASE, hasFullAccess: true })).not.toContain('/sales-crm');
  });

  it('follows the previewed role for staff previewing an agency', () => {
    const preview = { ...BASE, isPlatformAdmin: true, previewing: true, isAgentOnly: true };
    expect(hrefs(preview)).not.toContain('/sales-crm');
  });

  it('links to pages that exist, none of them staff-only or redirected', () => {
    for (const item of SALES_GROUP.items) {
      expect(hasPage(item.href), item.href).toBe(true);
      expect(isStaffOnlyRoute(item.href)).toBe(false);
      expect(isRouteBlockedFor(item.href, { isPlatformAdmin: false, isWhiteLabel: true })).toBe(
        false
      );
      expect(isRouteBlockedFor(item.href, { isPlatformAdmin: false, isWhiteLabel: false })).toBe(
        false
      );
      expect(whiteLabelRedirectFor(item.href)).toBeNull();
    }
    for (const path of [
      '/sales-crm/settings',
      '/sales-crm/agreements/new',
      '/sales-crm/prospects/[id]',
    ]) {
      expect(existsSync(join(APP_DIR, '(dashboard)', path, 'page.tsx')), path).toBe(true);
    }
  });

  it("keeps NetEnroll's agreement screens staff-only", () => {
    expect(isStaffOnlyRoute('/admin/agreements')).toBe(true);
    expect(
      isRouteBlockedFor('/admin/agreements', { isPlatformAdmin: false, isWhiteLabel: true })
    ).toBe(true);
  });

  it('is not the call-sales /sales route the white-label tier redirects', () => {
    expect(whiteLabelRedirectFor('/sales')).toBe('/revenue');
    expect(AGENT_NAV.flatMap(g => g.items).some(i => i.href === '/sales-crm')).toBe(false);
  });
});
