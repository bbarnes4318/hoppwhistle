import { describe, expect, it } from 'vitest';

import { SAFE_DEFAULTS, type DialerV2Flags, readFlagsFromEnv } from '../config/flags.js';

import { buildHealthReport, type HealthSnapshot } from './report.js';

function snapshot(overrides: Partial<HealthSnapshot> = {}): HealthSnapshot {
  return {
    eslConnected: true,
    eslDegraded: false,
    eslDetail: 'connected',
    eslConsecutiveFailures: 0,
    redisConnected: true,
    postgresConnected: true,
    lastEventAgeMs: 200,
    maxEventAgeMs: 60_000,
    eventLagMs: 50,
    maxEventLagMs: 1_000,
    unresolvedEventCount: 0,
    staleAgentCount: 0,
    totalAgentCount: 10,
    reconciliationLagMs: 1_000,
    maxReconciliationLagMs: 30_000,
    campaignsObserved: 2,
    shadowDecisionsRecorded: 40,
    mode: 'production',
    dedupeBackend: 'redis',
    decisionBackend: 'redis',
    decisionsFenced: true,
    sessionBackend: 'redis',
    agentStateBackend: 'redis',
    sipBackend: 'redis',
    observationBackend: 'redis',
    channelBackend: 'redis',
    extensionSource: 'database',
    assignmentSource: 'database',
    lockBackend: 'redis',
    reconstructionComplete: true,
    assignmentsResolvable: true,
    shadowWritesRejected: 0,
    agentStateStaleWrites: 0,
    registrationsOutOfOrder: 0,
    ...overrides,
  };
}

const dialing: DialerV2Flags = {
  ...SAFE_DEFAULTS,
  enabled: true,
  originateEnabled: true,
  dryRun: false,
  allowedTenantIds: ['t1'],
  maxGlobalCps: 5,
  maxGlobalCalls: 50,
};

describe('dialing liveness, not process liveness', () => {
  it('fails when FreeSWITCH is unreachable even though the process is fine', () => {
    const report = buildHealthReport(dialing, snapshot({ eslConnected: false }));
    expect(report.status).toBe('fail');
    expect(report.ingestionHealthy).toBe(false);
    expect(report.ready).toBe(false);
  });

  it('warns when connected but the event flow has gone quiet', () => {
    const report = buildHealthReport(dialing, snapshot({ eslDegraded: true }));
    expect(report.checks.find(c => c.name === 'freeswitch_esl')?.status).toBe('warn');
    expect(report.ingestionHealthy).toBe(false);
  });

  it('distinguishes "no event yet" from "events have stopped"', () => {
    const fresh = buildHealthReport(dialing, snapshot({ lastEventAgeMs: null }));
    expect(fresh.checks.find(c => c.name === 'event_freshness')?.status).toBe('warn');
    expect(fresh.checks.find(c => c.name === 'event_freshness')?.detail).toContain('yet');

    const stopped = buildHealthReport(dialing, snapshot({ lastEventAgeMs: 120_000 }));
    expect(stopped.checks.find(c => c.name === 'event_freshness')?.status).toBe('fail');
  });

  it('warns on event lag above budget', () => {
    const report = buildHealthReport(dialing, snapshot({ eventLagMs: 5_000 }));
    expect(report.checks.find(c => c.name === 'event_lag')?.status).toBe('warn');
  });
});

describe('readiness reflects ingestion, not just dependencies', () => {
  it('is not ready when ingestion is unhealthy despite healthy stores', () => {
    const report = buildHealthReport(dialing, snapshot({ eslConnected: false }));
    expect(report.ready).toBe(false);
  });

  it('is ready only when stores AND ingestion are healthy', () => {
    expect(buildHealthReport(dialing, snapshot()).ready).toBe(true);
    expect(buildHealthReport(dialing, snapshot({ postgresConnected: false })).ready).toBe(false);
    expect(buildHealthReport(dialing, snapshot({ redisConnected: false })).ready).toBe(false);
  });

  it('stays live when a dependency is down, so nothing restart-loops it', () => {
    const report = buildHealthReport(dialing, snapshot({ redisConnected: false }));
    expect(report.live).toBe(true);
  });
});

describe('phase 1 observability', () => {
  it('surfaces unresolved events', () => {
    const report = buildHealthReport(dialing, snapshot({ unresolvedEventCount: 3 }));
    const check = report.checks.find(c => c.name === 'unresolved_events');
    expect(check?.status).toBe('warn');
    expect(check?.detail).toContain('3');
  });

  it('surfaces stale agents', () => {
    const report = buildHealthReport(
      dialing,
      snapshot({ staleAgentCount: 4, totalAgentCount: 10 })
    );
    const check = report.checks.find(c => c.name === 'stale_agents');
    expect(check?.status).toBe('warn');
    expect(check?.detail).toContain('excluded from capacity');
  });

  it('fails when reconciliation has fallen behind', () => {
    const report = buildHealthReport(dialing, snapshot({ reconciliationLagMs: 120_000 }));
    expect(report.checks.find(c => c.name === 'reconciliation')?.status).toBe('fail');
  });

  it('warns when reconciliation has never run', () => {
    const report = buildHealthReport(dialing, snapshot({ reconciliationLagMs: null }));
    expect(report.checks.find(c => c.name === 'reconciliation')?.status).toBe('warn');
  });
});

describe('origination permission is reported, never treated as a fault', () => {
  it('is a healthy pass when origination is disabled by default', () => {
    const report = buildHealthReport(readFlagsFromEnv({}), snapshot());
    expect(report.originationPermitted).toBe(false);
    expect(report.checks.find(c => c.name === 'origination_permitted')?.status).toBe('pass');
    expect(report.checks.find(c => c.name === 'origination_permitted')?.detail).toContain(
      'expected default'
    );
  });

  it('always reports that no origination path is implemented in this build', () => {
    expect(buildHealthReport(dialing, snapshot()).originationImplemented).toBe(false);
  });

  it('requires every switch and granted capacity before reporting permitted', () => {
    expect(buildHealthReport(dialing, snapshot()).originationPermitted).toBe(true);
    const cases: Array<Partial<DialerV2Flags>> = [
      { enabled: false },
      { originateEnabled: false },
      { dryRun: true },
      { emergencyStop: true },
      { allowedTenantIds: [] },
      { maxGlobalCalls: 0 },
      { maxGlobalCps: 0 },
    ];
    for (const override of cases) {
      expect(buildHealthReport({ ...dialing, ...override }, snapshot()).originationPermitted).toBe(
        false
      );
    }
  });

  it('surfaces an engaged emergency stop', () => {
    const report = buildHealthReport({ ...dialing, emergencyStop: true }, snapshot());
    expect(report.emergencyStop).toBe(true);
    expect(report.checks.find(c => c.name === 'emergency_stop')?.detail).toContain('ENGAGED');
  });

  it('reports shadow mode activity', () => {
    const report = buildHealthReport({ ...dialing, shadowEnabled: true }, snapshot());
    expect(report.shadowEnabled).toBe(true);
    expect(report.checks.find(c => c.name === 'shadow_mode')?.detail).toContain('40 decision');
  });
});

describe('health states what is actually true, not what is convenient', () => {
  const find = (r: ReturnType<typeof buildHealthReport>, name: string) =>
    r.checks.find(c => c.name === name);

  // Each backend is reported separately because each fails separately. One
  // `storeBackend` flag used to stand for all of them, and it said `redis`
  // whenever a Redis CONNECTION existed — while sessions were in a process map
  // and decisions were written through a store that discarded every fencing
  // token it was given.
  const cases = [
    ['dedupe_backend', { dedupeBackend: 'memory' }, /doubled/],
    ['decision_backend', { decisionBackend: 'memory' }, /lost on restart/],
    ['decision_fencing', { decisionsFenced: false }, /lost its lock/],
    ['session_backend', { sessionBackend: 'memory' }, /unknown to every other replica/],
    ['agent_state_backend', { agentStateBackend: 'memory' }, /restart loses every agent/],
    ['sip_backend', { sipBackend: 'memory' }, /only the replica/],
    ['observation_backend', { observationBackend: 'memory' }, /half the sample/],
    ['channel_backend', { channelBackend: 'memory' }, /look idle/],
    ['extension_source', { extensionSource: 'static' }, /static developer fixtures/],
    ['assignment_source', { assignmentSource: 'static' }, /static developer fixtures/],
    ['loop_coordination', { lockBackend: 'noop' }, /double-processing/],
    ['state_reconstruction', { reconstructionComplete: false }, /floor, not a measurement/],
  ] as const;

  for (const [name, override, detail] of cases) {
    it(`names ${name} specifically when it is not shared`, () => {
      const r = buildHealthReport(SAFE_DEFAULTS, snapshot(override as Partial<HealthSnapshot>));
      expect(find(r, name)?.detail).toMatch(detail);
    });

    it(`fails readiness on ${name} in production`, () => {
      // In staging and production a single-instance backend is a defect, not a
      // stated choice, so it must not report ready.
      const r = buildHealthReport(
        SAFE_DEFAULTS,
        snapshot({ ...(override as Partial<HealthSnapshot>), mode: 'production' })
      );
      expect(find(r, name)?.status).toBe('fail');
      expect(r.ready).toBe(false);
    });

    it(`only warns on ${name} in development`, () => {
      const r = buildHealthReport(
        SAFE_DEFAULTS,
        snapshot({ ...(override as Partial<HealthSnapshot>), mode: 'development' })
      );
      expect(find(r, name)?.status).toBe('warn');
      expect(r.ready).toBe(true);
    });
  }

  it('does not let one Redis-backed capability vouch for another', () => {
    // The specific way the old single flag misled: everything else in Redis,
    // sessions in a process map, and the surface said "redis".
    const r = buildHealthReport(SAFE_DEFAULTS, snapshot({ sessionBackend: 'memory' }));
    expect(find(r, 'decision_backend')?.status).toBe('pass');
    expect(r.allBackendsShared).toBe(false);
  });

  it('reports unresolvable assignment as a capability gap, not an empty roster', () => {
    // Zero assigned agents and "assignment cannot be resolved" produce the same
    // number and mean completely different things.
    const r = buildHealthReport(SAFE_DEFAULTS, snapshot({ assignmentsResolvable: false }));
    expect(find(r, 'campaign_assignments')?.status).toBe('warn');
    expect(find(r, 'campaign_assignments')?.detail).toMatch(/every campaign forecast has zero/);
  });

  it('surfaces refused writes without failing on them', () => {
    // Refusals are the mechanism working. A rise is worth seeing; it is not a
    // fault.
    const r = buildHealthReport(
      SAFE_DEFAULTS,
      snapshot({ shadowWritesRejected: 3, agentStateStaleWrites: 2, registrationsOutOfOrder: 1 })
    );
    expect(find(r, 'rejected_writes')?.status).toBe('warn');
    expect(find(r, 'rejected_writes')?.detail).toMatch(/3 decision\(s\), 2 agent write\(s\) and 1/);
  });
});

describe('shadow evidence is judged separately from readiness', () => {
  it('is trustworthy only when everything it depends on holds', () => {
    const r = buildHealthReport(SAFE_DEFAULTS, snapshot());
    expect(r.ready).toBe(true);
    expect(r.shadowEvidenceTrustworthy).toBe(true);
  });

  for (const [label, override] of [
    ['unresolvable assignments', { assignmentsResolvable: false }],
    ['memory decisions', { decisionBackend: 'memory' }],
    ['unfenced decisions', { decisionsFenced: false }],
    ['memory sessions', { sessionBackend: 'memory' }],
    ['memory agent state', { agentStateBackend: 'memory' }],
    ['memory SIP state', { sipBackend: 'memory' }],
    ['memory observations', { observationBackend: 'memory' }],
    ['memory channel state', { channelBackend: 'memory' }],
    ['static extensions', { extensionSource: 'static' }],
    ['no distributed lock', { lockBackend: 'noop' }],
    ['incomplete reconstruction', { reconstructionComplete: false }],
  ] as const) {
    it(`is untrustworthy with ${label}`, () => {
      // A deployment can be perfectly healthy and still be recording decisions
      // that mean nothing. Promoting on those numbers is the failure this
      // separation exists to prevent.
      const r = buildHealthReport(
        SAFE_DEFAULTS,
        // Development, so readiness stays green and only trustworthiness moves.
        snapshot({ ...(override as Partial<HealthSnapshot>), mode: 'development' })
      );
      expect(r.ready).toBe(true);
      expect(r.shadowEvidenceTrustworthy).toBe(false);
    });
  }
});
