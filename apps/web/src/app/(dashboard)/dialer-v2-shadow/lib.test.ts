import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  SHADOW_BANNER,
  abandonTone,
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
