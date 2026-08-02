import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  SHADOW_BANNER,
  abandonTone,
  decisionScopeLabel,
  displayableDecisions,
  emptyStateMessage,
  eslTone,
  eventFreshnessTone,
  formatAge,
  originationLabel,
  type ShadowDecision,
  type ShadowStatus,
} from './lib.js';

function status(overrides: Partial<ShadowStatus> = {}): ShadowStatus {
  return {
    serviceReachable: true,
    serviceDetail: 'connected',
    shadowEnabled: true,
    ingestionHealthy: true,
    eslConnected: true,
    eslDetail: 'connected',
    lastEventAgeMs: 200,
    staleAgentCount: 0,
    unresolvedEventCount: 0,
    emergencyStop: false,
    originationPermitted: false,
    originationImplemented: false,
    evidenceTrustworthy: true,
    checks: [],
    ...overrides,
  };
}

function decision(overrides: Partial<ShadowDecision> = {}): ShadowDecision {
  return {
    campaignId: 'camp-1',
    decidedAtMs: 1,
    recommendedOriginateCount: 3,
    bindingConstraint: 'AGENT_CAPACITY',
    degradationMode: 'PREDICTIVE',
    safetyReasons: [],
    blockedBy: [],
    originated: false,
    explanation: 'would place 3 calls',
    agentsAvailable: 5,
    agentsEligible: 20,
    callsDialing: 2,
    liveAnswersWaiting: 0,
    abandonRate: 0.01,
    pLive: 0.2,
    confidence: 'HIGH',
    ...overrides,
  };
}

describe('unhealthy states are never shown as healthy', () => {
  it('reports an unreachable service as bad, not neutral', () => {
    // A grey tile reads as "nothing to report" when the real meaning is
    // "we cannot see the switch".
    expect(eslTone(status({ serviceReachable: false }))).toBe('bad');
    expect(eslTone(null)).toBe('bad');
  });

  it('reports a disconnected ESL as bad', () => {
    expect(eslTone(status({ eslConnected: false }))).toBe('bad');
  });

  it('warns when connected but ingestion is unhealthy', () => {
    expect(eslTone(status({ ingestionHealthy: false }))).toBe('warn');
  });

  it('never reports event freshness as good when the service is unreachable', () => {
    expect(eventFreshnessTone(status({ serviceReachable: false }))).toBe('bad');
  });

  it('warns rather than passes when no event has ever arrived', () => {
    expect(eventFreshnessTone(status({ lastEventAgeMs: null }))).toBe('warn');
  });
});

describe('abandonment tone', () => {
  it('follows the compliance thresholds', () => {
    expect(abandonTone(0)).toBe('good');
    expect(abandonTone(0.019)).toBe('good');
    expect(abandonTone(0.02)).toBe('warn');
    expect(abandonTone(0.029)).toBe('warn');
    expect(abandonTone(0.03)).toBe('bad');
    expect(abandonTone(0.5)).toBe('bad');
  });

  it('does not claim good for a nonsensical rate', () => {
    expect(abandonTone(Number.NaN)).toBe('neutral');
    expect(abandonTone(-1)).toBe('neutral');
  });
});

describe('empty states distinguish their causes', () => {
  it('says the service is unreachable when it is', () => {
    const message = emptyStateMessage(status({ serviceReachable: false }), []);
    expect(message).toContain('not reachable');
    expect(message).toContain('Nothing below is live');
  });

  it('says shadow mode is disabled when it is', () => {
    expect(emptyStateMessage(status({ shadowEnabled: false }), [])).toContain('disabled');
  });

  it('says nothing has been observed when the pipeline is healthy but idle', () => {
    const message = emptyStateMessage(status(), []);
    expect(message).toContain('has not observed');
    expect(message).toContain('Nothing is being simulated');
  });

  it('shows no empty state while data is still loading', () => {
    expect(emptyStateMessage(status(), null)).toBeNull();
  });

  it('shows no empty state when there are decisions', () => {
    expect(emptyStateMessage(status(), [decision()])).toBeNull();
  });
});

describe('originated records never render', () => {
  it('drops a record claiming a call was placed', () => {
    // Shadow mode cannot originate; such a record is corrupt.
    const rows = displayableDecisions([decision(), decision({ originated: true })]);
    expect(rows).toHaveLength(1);
    expect(rows.every(d => d.originated === false)).toBe(true);
  });

  it('handles a null list', () => {
    expect(displayableDecisions(null)).toEqual([]);
  });
});

describe('origination label', () => {
  it('reports the absence of a code path, not a configuration value', () => {
    expect(originationLabel(status())).toEqual({ text: 'No code path', tone: 'good' });
  });

  it('flags loudly if an origination path ever appears', () => {
    expect(originationLabel(status({ originationImplemented: true })).tone).toBe('bad');
  });
});

describe('age formatting', () => {
  it('formats the ranges', () => {
    expect(formatAge(null)).toBe('never');
    expect(formatAge(250)).toBe('250 ms');
    expect(formatAge(1_500)).toBe('1.5 s');
    expect(formatAge(120_000)).toBe('2 min');
  });

  it('does not invent a value for nonsense', () => {
    expect(formatAge(Number.NaN)).toBe('unknown');
    expect(formatAge(-5)).toBe('unknown');
  });
});

describe('the page itself', () => {
  const source = readFileSync(join(__dirname, 'page.tsx'), 'utf8');

  it('renders the mandated banner', () => {
    // The page renders the shared constant rather than a literal, so assert
    // both halves: the page uses it, and it says the required thing.
    expect(source).toContain('{SHADOW_BANNER}');
    expect(SHADOW_BANNER).toBe('SHADOW MODE — NO CALLS ARE BEING PLACED');
  });

  it('states that no call was placed', () => {
    expect(SHADOW_BANNER.toLowerCase()).toContain('no calls are being placed');
    expect(source.toLowerCase()).toContain('no call has been placed');
  });

  it('contains no hardcoded sample or mock data', () => {
    // Every number on this page must come from the API.
    for (const banned of ['mockDecisions', 'sampleData', 'FAKE_', 'placeholderMetrics']) {
      expect(source).not.toContain(banned);
    }
  });

  it('sends credentials so the tenant comes from the verified session', () => {
    expect(source).toContain("credentials: 'include'");
  });

  it('never sends a tenantId from the browser', () => {
    expect(source).not.toMatch(/tenantId=\$\{/);
    expect(source).not.toContain('x-demo-tenant-id');
  });
});

describe('an empty table says WHY it is empty', () => {
  it('distinguishes "cannot be read as evidence" from "nothing observed"', () => {
    // These were previously the same message. The decision store returned an
    // empty list for any query without a campaign filter, so a deployment that
    // could not answer at all rendered as a quiet one — and an operator would
    // reasonably conclude the dialer had simply seen no traffic.
    const cannotAnswer = emptyStateMessage(status({ evidenceTrustworthy: false }), []);
    const nothingSeen = emptyStateMessage(status({ evidenceTrustworthy: true }), []);

    expect(cannotAnswer).not.toBe(nothingSeen);
    expect(cannotAnswer).toMatch(/not shared or not resolvable/);
    expect(nothingSeen).toMatch(/has not observed any campaign activity/);
  });

  it('still puts unreachable and disabled ahead of untrustworthy', () => {
    // An unreachable service explains everything downstream; reporting the
    // narrower cause first would send an operator to the wrong place.
    expect(
      emptyStateMessage(status({ serviceReachable: false, evidenceTrustworthy: false }), [])
    ).toMatch(/not reachable/);
    expect(
      emptyStateMessage(status({ shadowEnabled: false, evidenceTrustworthy: false }), [])
    ).toMatch(/Shadow mode is disabled/);
  });

  it('says nothing at all when there are decisions to show', () => {
    const decision = { originated: false } as ShadowDecision;
    expect(emptyStateMessage(status({ evidenceTrustworthy: false }), [decision])).toBeNull();
  });

  it('says nothing while decisions are still loading', () => {
    // null is "not loaded yet", which is not an empty result.
    expect(emptyStateMessage(status(), null)).toBeNull();
  });
});

describe('the decision list states its own scope', () => {
  it('names the campaign when one is selected', () => {
    expect(decisionScopeLabel('camp-1')).toBe('Recent decisions for campaign camp-1');
  });

  it('says plainly when the list spans every campaign', () => {
    // "These are every campaign's recent decisions" and "these are one
    // campaign's" are different claims, and a short list looks the same either
    // way.
    expect(decisionScopeLabel(null)).toMatch(/across every campaign in this tenant/);
  });
});
