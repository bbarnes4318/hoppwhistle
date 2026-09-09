import { describe, expect, it } from 'vitest';

import {
  HERO_BELOW,
  agencySlots,
  agentSlots,
  platformSlots,
} from '@/components/layout/use-live-metrics';
import type { StripPayload } from '@/components/layout/use-live-metrics';

/**
 * The rules the strip exists to keep, pinned where they can be run in a second.
 *
 * `apps/web/e2e/platform-landing.smoke.mjs` is the other half: it loads every
 * route in a real browser against the real API and checks that the figures on
 * the strip match the ones the page below reports for the same tenant. That is
 * the check that catches a wrong number. These are the ones that catch a wrong
 * SHAPE -- money on an agent's strip, a zeroed billing figure for an agency
 * that is not billed, the two rates collapsed into one -- and they run without
 * a database, a browser or a network.
 */

const AGENCY_ENROLLED: StripPayload = {
  scope: 'agency',
  generatedAt: '2026-09-09T15:00:00.000Z',
  calendarDay: '2026-09-09',
  timeZone: 'America/New_York',
  enrolled: true,
  callsDelivered: 168,
  callsInProgress: 4,
  applicationsSubmitted: 12,
  billing: {
    dailyBlockApplications: 40,
    applicationsRemainingOnBlock: 28,
    overrunToday: 0,
    overrunAmountTonight: 0,
    projectedTotalCharge: 6360,
    currentRate: 159,
    trackingRate: 149,
    trackingBelowMinimum: false,
  },
  unavailable: {},
};

/** The same agency, before a platform admin enrolled it in billing. */
const AGENCY_UNENROLLED: StripPayload = {
  scope: 'agency',
  generatedAt: '2026-09-09T15:00:00.000Z',
  calendarDay: '2026-09-09',
  timeZone: 'America/New_York',
  enrolled: false,
  callsDelivered: 168,
  callsInProgress: 4,
  applicationsSubmitted: 12,
  unavailable: {},
};

const AGENT: StripPayload = {
  scope: 'agent',
  generatedAt: '2026-09-09T15:00:00.000Z',
  calendarDay: '2026-09-09',
  callsTaken: 31,
  applications: 2,
  closingPct: 6.45,
  agencyClosingPct: 7.14,
  closingPctVsAgencyPoints: -0.7,
  unavailable: {},
};

const PLATFORM: StripPayload = {
  scope: 'platform',
  generatedAt: '2026-09-09T15:00:00.000Z',
  calendarDay: '2026-09-09',
  agencies: 5,
  agenciesDelivering: 2,
  deliveredCalls: 604,
  applications: 41,
  projectedSettlementTonight: 11840,
  agenciesNeedingAttention: 1,
  unavailable: {},
};

/** Everything a figure puts on screen, as one string. */
const rendered = (slots: ReturnType<typeof agencySlots>): string =>
  slots.map(s => `${s.label} ${s.value ?? ''} ${s.sub ?? ''}`).join(' | ');

describe('the agency principal reading', () => {
  it('answers the three questions, in order', () => {
    const ids = agencySlots(AGENCY_ENROLLED).map(s => s.id);

    // Am I on pace; what is today costing me; where is my rate going.
    expect(ids).toEqual([
      'applications',
      'calls',
      'block',
      'overrun',
      'tonight',
      'rate',
      'tracking',
    ]);
  });

  it('counts applications against the block they paid for, not against a target', () => {
    const applications = agencySlots(AGENCY_ENROLLED).find(s => s.id === 'applications');

    expect(applications?.value).toBe('12');
    expect(applications?.sub).toBe('of 40 block');
    // A percentage of a target nobody set is the thing this replaced.
    expect(applications?.value).not.toContain('%');
  });

  it('never conflates the rate in force with the rate tomorrow is tracking toward', () => {
    const slots = agencySlots(AGENCY_ENROLLED);
    const now = slots.find(s => s.id === 'rate');
    const tomorrow = slots.find(s => s.id === 'tracking');

    // Two figures, two different numbers, and each labelled with what it does.
    expect(now?.value).toBe('$159.00');
    expect(tomorrow?.value).toBe('$149.00');
    expect(now?.label).not.toBe(tomorrow?.label);
    expect(`${now?.label} ${now?.sub}`).toMatch(/now.*per application/i);
    expect(`${tomorrow?.label} ${tomorrow?.sub}`).toMatch(/tomorrow.*if today closed now/i);

    // Today's closing percentage is deliberately absent: a percentage beside
    // two rates is the one most likely to be read as the one that set them.
    expect(rendered(slots)).not.toMatch(/closing/i);
  });

  it('says a below-minimum window is under review rather than showing a $0 rate', () => {
    const tomorrow = agencySlots({
      ...AGENCY_ENROLLED,
      billing: { ...AGENCY_ENROLLED.billing!, trackingRate: null, trackingBelowMinimum: true },
    }).find(s => s.id === 'tracking');

    expect(tomorrow?.value).toBe('review');
    expect(tomorrow?.value).not.toBe('$0.00');
  });

  it('renders a rate the server could not source as absent, with the reason', () => {
    const slots = agencySlots({
      ...AGENCY_ENROLLED,
      billing: { ...AGENCY_ENROLLED.billing!, currentRate: null },
      unavailable: { currentRate: 'There is no rate in force for this agency today.' },
    });
    const now = slots.find(s => s.id === 'rate');

    // Null, so the strip renders a muted em dash -- never a fabricated zero.
    expect(now?.value).toBeNull();
    expect(now?.unavailableReason).toContain('no rate in force');
  });
});

describe('an agency that is not enrolled in billing', () => {
  it('gets the operational counts and nothing else', () => {
    const slots = agencySlots(AGENCY_UNENROLLED);

    expect(slots.map(s => s.id)).toEqual(['applications', 'calls']);
    expect(slots.find(s => s.id === 'applications')?.sub).toBe('submitted today');
  });

  it('is shown no money at all -- not zeroes, and not em dashes either', () => {
    const text = rendered(agencySlots(AGENCY_UNENROLLED));

    expect(text).not.toContain('$');
    expect(text).not.toMatch(/tonight|overrun|block|rate|debit/i);
    // An em dash under a label reading "tonight" is still a screen telling
    // somebody they owe an unknown amount, so there must be no such figure.
    expect(agencySlots(AGENCY_UNENROLLED).every(s => s.value !== null)).toBe(true);
  });
});

describe('the agent reading', () => {
  it('shows their own day against the agency, and no money', () => {
    const slots = agentSlots(AGENT);

    expect(slots.map(s => s.id)).toEqual(['calls', 'applications', 'closing']);
    expect(slots.find(s => s.id === 'closing')?.value).toBe('6.45%');
    expect(slots.find(s => s.id === 'closing')?.sub).toBe('agency 7.14% · −0.7 pts');
    expect(rendered(slots)).not.toContain('$');
  });

  it('names no other agent', () => {
    // The endpoint behind this loads no other agent's rows at all; this is the
    // rendering half of the same promise.
    const text = rendered(agentSlots(AGENT));
    expect(text).toMatch(/^Your|Your/);
    expect(text).not.toMatch(/agent/i);
  });

  it('shows no percentage before the agent has answered a call', () => {
    const slots = agentSlots({
      ...AGENT,
      callsTaken: 0,
      applications: 0,
      closingPct: null,
      closingPctVsAgencyPoints: null,
      unavailable: { closingPct: 'You have not answered a call yet today.' },
    });
    const closing = slots.find(s => s.id === 'closing');

    expect(closing?.value).toBeNull();
    expect(closing?.unavailableReason).toContain('not answered a call');
  });
});

describe('the platform reading', () => {
  it('shows the platform, not one agency', () => {
    const slots = platformSlots(PLATFORM);

    expect(slots.map(s => s.id)).toEqual([
      'delivering',
      'calls',
      'applications',
      'tonight',
      'attention',
    ]);
    expect(slots.find(s => s.id === 'delivering')?.sub).toBe('of 5 agencies');
    expect(slots.find(s => s.id === 'tonight')?.value).toBe('$11,840.00');
    expect(slots.find(s => s.id === 'attention')?.tone).toBe('dropped');
  });

  it('explains an unprojectable settlement rather than showing zero', () => {
    const tonight = platformSlots({
      ...PLATFORM,
      projectedSettlementTonight: null,
      unavailable: {
        projectedSettlementTonight: 'No production agency is enrolled in billing.',
      },
    }).find(s => s.id === 'tonight');

    expect(tonight?.value).toBeNull();
    expect(tonight?.unavailableReason).toContain('enrolled in billing');
  });
});

describe('not repeating a figure the page below renders as its hero', () => {
  /** What the strip keeps for one reading on one path. */
  const kept = (slots: ReturnType<typeof agencySlots>, scope: string, path: string): string[] => {
    const suppressed = HERO_BELOW[`${scope}:${path}`] ?? [];
    return slots.map(s => s.id).filter(id => !suppressed.includes(id));
  };

  it('drops the projected charge and the current rate for an agency on /delivery', () => {
    expect(kept(agencySlots(AGENCY_ENROLLED), 'agency', '/delivery')).toEqual([
      'applications',
      'calls',
      'block',
      'overrun',
      'tracking',
    ]);
  });

  it("drops the agent's own closing percentage on /delivery/me", () => {
    expect(kept(agentSlots(AGENT), 'agent', '/delivery/me')).toEqual(['calls', 'applications']);
  });

  it('drops nothing from the platform reading of /delivery', () => {
    /*
     * /delivery is two pages. The cross-agency one's hero is "Settled today",
     * which the strip never carries -- and the platform reading's own
     * `tonight` is a projection across every agency, not that hero. Keyed on
     * the figure id alone this deleted the figure staff came for.
     */
    expect(kept(platformSlots(PLATFORM), 'platform', '/delivery')).toEqual([
      'delivering',
      'calls',
      'applications',
      'tonight',
      'attention',
    ]);
  });

  it('drops nothing anywhere else', () => {
    expect(Object.keys(HERO_BELOW).sort()).toEqual(['agency:/delivery', 'agent:/delivery/me']);
    expect(kept(agencySlots(AGENCY_ENROLLED), 'agency', '/dashboard')).toHaveLength(7);
    expect(kept(agentSlots(AGENT), 'agent', '/call-center')).toHaveLength(3);
  });
});
