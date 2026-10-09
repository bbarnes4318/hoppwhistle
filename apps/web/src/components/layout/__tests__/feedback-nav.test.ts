import { describe, expect, it } from 'vitest';

import {
  FEEDBACK_ITEM,
  PLATFORM_NAV,
  allNavItems,
  navFor,
  type NavViewer,
} from '@/components/layout/nav-config';
import { isRouteBlockedFor, isStaffOnlyRoute } from '@/lib/staff-only-routes';

/**
 * Feedback & Roadmap in the navigation: every role that works the product has
 * it, in the group about their own account; staff have the product team's
 * console under Admin; buyers, publishers and read-only accounts have neither.
 */

const NOBODY: NavViewer = {
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

const hrefs = (viewer: Partial<NavViewer>) =>
  allNavItems(navFor({ ...NOBODY, ...viewer })).map(item => item.href);

const groupOf = (viewer: Partial<NavViewer>, href: string) =>
  navFor({ ...NOBODY, ...viewer }).find(group => group.items.some(item => item.href === href))
    ?.label;

describe('Feedback & Roadmap in the navigation', () => {
  it('is named and described for the people who use it', () => {
    expect(FEEDBACK_ITEM.name).toBe('Feedback & Roadmap');
    expect(FEEDBACK_ITEM.href).toBe('/feedback');
  });

  it('gives a Life Leads Plus agent it under Account, apart from the selling workflow', () => {
    const agent = {
      isAgentOnly: true,
      isWhiteLabelAgent: true,
      brandTheme: 'life-leads-plus',
      upgrades: [],
    };
    expect(hrefs(agent)).toContain('/feedback');
    expect(groupOf(agent, '/feedback')).toBe('Account');
    // The last entry of the agent's menu, never among Today, Calls or the CRM.
    const nav = navFor({ ...NOBODY, ...agent });
    expect(nav[nav.length - 1].items.at(-1)?.href).toBe('/feedback');
  });

  it('gives it to every agent, with or without the Power Dialer', () => {
    for (const upgrades of [[], ['POWER_DIALER']]) {
      expect(hrefs({ isAgentOnly: true, upgrades })).toContain('/feedback');
    }
  });

  it('gives a white-label owner or admin it under Administration', () => {
    const owner = { hasFullAccess: true, isWhiteLabel: true, brandTheme: 'life-leads-plus' };
    expect(hrefs(owner)).toContain('/feedback');
    expect(groupOf(owner, '/feedback')).toBe('Administration');
  });

  it('gives a normal agency owner, a downline owner and a manager it under Account', () => {
    expect(groupOf({ hasFullAccess: true }, '/feedback')).toBe('Account');
    expect(groupOf({ hasFullAccess: true, isChild: true }, '/feedback')).toBe('Account');
    expect(groupOf({ isManagerOnly: true }, '/feedback')).toBe('Account');
  });

  it('gives buyers, publishers and read-only accounts nothing of it', () => {
    for (const viewer of [
      { isBuyerOnly: true },
      { isPublisherOnly: true },
      { isReadonlyOnly: true },
      {},
    ]) {
      expect(hrefs(viewer)).not.toContain('/feedback');
      expect(hrefs(viewer)).not.toContain('/admin/product-feedback');
    }
  });

  it('gives no agency role the product team’s console, and does not let one open it', () => {
    for (const viewer of [
      { isAgentOnly: true },
      { hasFullAccess: true },
      { hasFullAccess: true, isWhiteLabel: true },
      { isManagerOnly: true },
    ]) {
      expect(hrefs(viewer)).not.toContain('/admin/product-feedback');
    }
    expect(isStaffOnlyRoute('/admin/product-feedback')).toBe(true);
    expect(
      isRouteBlockedFor('/admin/product-feedback', { isPlatformAdmin: false, isWhiteLabel: true })
    ).toBe(true);
  });

  it('gives staff the console under Admin, and keeps /feedback open to agencies', () => {
    const admin = PLATFORM_NAV.find(group => group.label === 'Admin');
    expect(admin?.items.map(item => item.href)).toContain('/admin/product-feedback');
    expect(hrefs({ isPlatformAdmin: true })).toContain('/admin/product-feedback');
    expect(isStaffOnlyRoute('/feedback')).toBe(false);
  });
});
