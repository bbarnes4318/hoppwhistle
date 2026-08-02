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
    storeBackend: 'redis',
    sessionBackend: 'redis',
    lockDistributed: true,
    assignmentsResolvable: true,
    shadowWritesRejected: 0,
    agentStateStaleWrites: 0,
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

  it('says plainly when state is in process memory', () => {
    const r = buildHealthReport(SAFE_DEFAULTS, snapshot({ storeBackend: 'memory' }));
    expect(find(r, 'state_backend')?.status).toBe('warn');
    expect(find(r, 'state_backend')?.detail).toMatch(/single-instance|lost on restart/);
  });

  it('says plainly when sessions are not shared between replicas', () => {
    const r = buildHealthReport(SAFE_DEFAULTS, snapshot({ sessionBackend: 'memory' }));
    expect(find(r, 'session_backend')?.status).toBe('warn');
    expect(find(r, 'session_backend')?.detail).toMatch(/unknown to every other replica/);
  });

  it('says plainly when loop coordination is the no-op lock', () => {
    const r = buildHealthReport(SAFE_DEFAULTS, snapshot({ lockDistributed: false }));
    expect(find(r, 'loop_coordination')?.status).toBe('warn');
    expect(find(r, 'loop_coordination')?.detail).toMatch(/double-processing/);
  });

  it('reports missing assignment support as a capability gap, not an empty roster', () => {
    // Zero assigned agents and "the schema models no assignment" produce the
    // same number and mean completely different things.
    const r = buildHealthReport(SAFE_DEFAULTS, snapshot({ assignmentsResolvable: false }));
    expect(find(r, 'campaign_assignments')?.status).toBe('warn');
    expect(find(r, 'campaign_assignments')?.detail).toMatch(/no agent-to-campaign assignment/);
  });

  it('surfaces refused writes rather than swallowing them', () => {
    const r = buildHealthReport(
      SAFE_DEFAULTS,
      snapshot({ shadowWritesRejected: 3, agentStateStaleWrites: 2 })
    );
    expect(find(r, 'rejected_writes')?.status).toBe('warn');
    expect(find(r, 'rejected_writes')?.detail).toMatch(/3 shadow decision\(s\) and 2 agent/);
  });
});

describe('shadow evidence is judged separately from readiness', () => {
  it('is trustworthy only when everything it depends on holds', () => {
    const r = buildHealthReport(SAFE_DEFAULTS, snapshot());
    expect(r.ready).toBe(true);
    expect(r.shadowEvidenceTrustworthy).toBe(true);
  });

  for (const [label, override] of [
    ['no assignment model', { assignmentsResolvable: false }],
    ['memory stores', { storeBackend: 'memory' as const }],
    ['no distributed lock', { lockDistributed: false }],
  ] as const) {
    it(`is untrustworthy with ${label}, even while ready`, () => {
      // A deployment can be perfectly healthy and still be recording decisions
      // that mean nothing. Promoting on those numbers is the failure this
      // separation exists to prevent.
      const r = buildHealthReport(SAFE_DEFAULTS, snapshot(override));
      expect(r.shadowEvidenceTrustworthy).toBe(false);
    });
  }

  it('is untrustworthy when ingestion has stopped', () => {
    const r = buildHealthReport(SAFE_DEFAULTS, snapshot({ lastEventAgeMs: 999_999 }));
    expect(r.ingestionHealthy).toBe(false);
    expect(r.shadowEvidenceTrustworthy).toBe(false);
  });

  it('never claims trustworthy evidence while Redis is down', () => {
    const r = buildHealthReport(SAFE_DEFAULTS, snapshot({ redisConnected: false }));
    expect(r.shadowEvidenceTrustworthy).toBe(false);
    expect(r.ready).toBe(false);
  });

  it('keeps liveness independent so a correct refusal is not restart-looped', () => {
    const r = buildHealthReport(SAFE_DEFAULTS, snapshot({ redisConnected: false }));
    expect(r.live).toBe(true);
  });
});
