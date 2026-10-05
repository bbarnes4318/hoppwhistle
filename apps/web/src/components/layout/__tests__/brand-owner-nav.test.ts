import { describe, expect, it } from 'vitest';

import { allNavItems, navFor, type NavViewer } from '@/components/layout/nav-config';

const OWNER: NavViewer = {
  isPlatformAdmin: false,
  previewing: false,
  hasFullAccess: true,
  isWhiteLabel: true,
  isPublisherOnly: false,
  isBuyerOnly: false,
  isAgentOnly: false,
  isReadonlyOnly: false,
  canViewRecordings: true,
  salesWorkspace: { scope: 'TENANT' },
};

const HIDDEN = ['Sales CRM', 'Agreements', 'Buyers', 'Agencies', 'Upgrades', 'Revenue'];

function names(viewer: NavViewer): string[] {
  return navFor(viewer)
    .flatMap(group => group.items)
    .map(item => item.name);
}

describe('Powerhouse Insurance owner nav', () => {
  it('adds Campaigns beside Routing and hides the Sales CRM, Agreements, Buyers, Agencies, Upgrades and Revenue', () => {
    const nav = navFor({ ...OWNER, brandTheme: 'powerhouse-insurance' });
    const items = allNavItems(nav);
    expect(items.find(item => item.name === 'Campaigns')?.href).toBe('/campaigns');
    const admin = nav.find(group => group.label === 'Administration')!;
    const routing = admin.items.findIndex(item => item.href === '/routing');
    expect(admin.items[routing - 1].href).toBe('/campaigns');
    for (const name of HIDDEN) expect(items.map(item => item.name)).not.toContain(name);
    expect(nav.some(group => group.items.length === 0)).toBe(false);
  });

  it('puts Publishers under Administration, above Settings, and drops the empty Call Sales', () => {
    const nav = navFor({ ...OWNER, brandTheme: 'powerhouse-insurance' });
    const admin = nav.find(group => group.label === 'Administration')!;
    const hrefs = admin.items.map(item => item.href);
    expect(hrefs).toContain('/publishers');
    expect(hrefs.indexOf('/publishers')).toBe(hrefs.indexOf('/settings') - 1);
    expect(nav.map(group => group.label)).not.toContain('Call Sales');
    expect(allNavItems(nav).filter(item => item.href === '/publishers')).toHaveLength(1);
  });

  it('keeps Publishers under Call Sales for every other brand', () => {
    const nav = navFor({ ...OWNER, brandTheme: 'life-leads-plus' });
    const sales = nav.find(group => group.label === 'Call Sales')!;
    expect(sales.items.map(item => item.href)).toContain('/publishers');
  });

  it('hides the same items for a non-white-label Powerhouse agency, with one Campaigns', () => {
    const list = names({ ...OWNER, isWhiteLabel: false, brandTheme: 'powerhouse-insurance' });
    expect(list.filter(name => name === 'Campaigns')).toHaveLength(1);
    for (const name of HIDDEN) expect(list).not.toContain(name);
  });

  it('changes nothing for other brands or for agents', () => {
    const other = names({ ...OWNER, brandTheme: 'life-leads-plus' });
    expect(other).not.toContain('Campaigns');
    for (const name of HIDDEN) expect(other).toContain(name);
    expect(navFor({ ...OWNER, brandTheme: 'life-leads-plus' })).toEqual(navFor(OWNER));

    const agent = names({
      ...OWNER,
      hasFullAccess: false,
      isWhiteLabel: false,
      isAgentOnly: true,
      brandTheme: 'powerhouse-insurance',
    });
    expect(agent).toContain('Sales CRM');
  });
});
