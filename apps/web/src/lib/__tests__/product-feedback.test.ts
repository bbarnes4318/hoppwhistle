import { describe, expect, it } from 'vitest';

import { buildTimeline } from '@/components/feedback/feedback-bits';
import { agentNav, navFor } from '@/components/layout/nav-config';
import {
  areaForRoute,
  productAreaLabel,
  productAreasFor,
  wantPhrase,
} from '@/lib/product-feedback';

describe('product areas come from the viewer’s own navigation', () => {
  const agentAreas = productAreasFor(agentNav(['POWER_DIALER'], { whiteLabel: true }));

  it('lists the screens an agent works in, by their sidebar names, then "Something else"', () => {
    expect(agentAreas.map(a => a.label)).toEqual([
      'Today',
      'Calls',
      'Applications',
      'CRM',
      'Quote',
      'Power Dialer',
      'Account',
      'Something else',
    ]);
    // Never Feedback & Roadmap itself.
    expect(agentAreas.map(a => a.value)).not.toContain('/feedback');
  });

  it('places a deep path under the area it belongs to', () => {
    expect(areaForRoute('/insurance-leads/abc-123/quote', agentAreas)).toBe('/insurance-leads');
    expect(areaForRoute('/quote?tab=settings', agentAreas)).toBe('/quote');
    expect(areaForRoute('/somewhere-else', agentAreas)).toBeNull();
    expect(areaForRoute(null, agentAreas)).toBeNull();
  });

  it('names a stored area wherever it came from', () => {
    expect(productAreaLabel('/insurance-leads')).toBe('CRM');
    expect(productAreaLabel('/dashboard')).toBe('Today');
    expect(productAreaLabel('other')).toBe('Other');
    expect(productAreaLabel('/some-new-screen')).toBe('Some new screen');
    expect(productAreaLabel(null)).toBeNull();
  });

  it('offers a publisher nothing, since a publisher has no feedback page', () => {
    const publisher = navFor({
      isPlatformAdmin: false,
      previewing: false,
      hasFullAccess: false,
      isWhiteLabel: false,
      isPublisherOnly: true,
      isBuyerOnly: false,
      isAgentOnly: false,
      isReadonlyOnly: false,
      canViewRecordings: false,
    });
    expect(productAreasFor(publisher).some(a => a.value === '/feedback')).toBe(false);
  });
});

describe('the status timeline', () => {
  const at = (day: number) => `2026-10-${String(day).padStart(2, '0')}T15:00:00.000Z`;

  it('draws only the stages reached as done, and the rest of the road hollow', () => {
    const steps = buildTimeline(
      [
        { status: 'NEW', at: at(1) },
        { status: 'UNDER_REVIEW', at: at(2) },
        { status: 'PLANNED', at: at(3) },
      ],
      'PLANNED'
    );
    expect(steps.map(s => [s.status, s.state])).toEqual([
      ['NEW', 'done'],
      ['UNDER_REVIEW', 'done'],
      ['PLANNED', 'current'],
      ['IN_PROGRESS', 'future'],
      ['TESTING', 'future'],
      ['SHIPPED', 'future'],
    ]);
    expect(steps.filter(s => s.state === 'future').every(s => s.at === null)).toBe(true);
  });

  it('never fakes a stage that was skipped', () => {
    const steps = buildTimeline(
      [
        { status: 'NEW', at: at(1) },
        { status: 'IN_PROGRESS', at: at(2) },
        { status: 'SHIPPED', at: at(5) },
      ],
      'SHIPPED'
    );
    expect(steps.map(s => s.status)).toEqual(['NEW', 'IN_PROGRESS', 'SHIPPED']);
  });

  it('continues the road after review while waiting on the submitter', () => {
    const steps = buildTimeline(
      [
        { status: 'NEW', at: at(1) },
        { status: 'NEEDS_INFO', at: at(2) },
      ],
      'NEEDS_INFO'
    );
    expect(steps.map(s => [s.status, s.state])).toEqual([
      ['NEW', 'done'],
      ['NEEDS_INFO', 'current'],
      ['PLANNED', 'future'],
      ['IN_PROGRESS', 'future'],
      ['TESTING', 'future'],
      ['SHIPPED', 'future'],
    ]);
  });

  it('ends where a decision not to build it ends it', () => {
    const steps = buildTimeline(
      [
        { status: 'NEW', at: at(1) },
        { status: 'NOT_PLANNED', at: at(3) },
      ],
      'NOT_PLANNED'
    );
    expect(steps.map(s => s.state)).toEqual(['done', 'current']);
  });
});

describe('interest, said plainly', () => {
  it('agrees with its number', () => {
    expect(wantPhrase(1)).toBe('1 person wants this');
    expect(wantPhrase(14)).toBe('14 people want this');
  });
});
