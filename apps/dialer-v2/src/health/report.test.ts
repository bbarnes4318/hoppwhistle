import { describe, expect, it } from 'vitest';

import { SAFE_DEFAULTS, type DialerV2Flags, readFlagsFromEnv } from '../config/flags.js';

import { buildHealthReport, type HealthSnapshot } from './report.js';

function snapshot(overrides: Partial<HealthSnapshot> = {}): HealthSnapshot {
  return {
    freeswitchConnected: true,
    redisConnected: true,
    postgresConnected: true,
    lastEventAgeMs: 100,
    maxEventAgeMs: 5_000,
    agentStateAgeMs: 100,
    maxAgentStateAgeMs: 10_000,
    campaignsOwned: 1,
    activeAttempts: 0,
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
  it('reports a failure when FreeSWITCH is unreachable, even though the process is fine', () => {
    // CURRENT_STATE_AUDIT.md §5: the existing worker returns a static
    // {status:'ok'} literal, which is why the Hopper being unable to place a
    // single call is invisible to monitoring.
    const report = buildHealthReport(dialing, snapshot({ freeswitchConnected: false }));
    expect(report.status).toBe('fail');
    expect(report.checks.find(c => c.name === 'freeswitch_esl')?.status).toBe('fail');
  });

  it('warns when telemetry has gone stale', () => {
    const report = buildHealthReport(dialing, snapshot({ lastEventAgeMs: 60_000 }));
    expect(report.checks.find(c => c.name === 'event_freshness')?.status).toBe('warn');
    expect(report.checks.find(c => c.name === 'event_freshness')?.detail).toContain('60000');
  });

  it('warns when agent state has gone stale', () => {
    const report = buildHealthReport(dialing, snapshot({ agentStateAgeMs: 60_000 }));
    expect(report.checks.find(c => c.name === 'agent_state_freshness')?.status).toBe('warn');
  });
});

describe('liveness vs readiness', () => {
  it('stays live when a dependency is down, so an orchestrator does not restart-loop it', () => {
    const report = buildHealthReport(dialing, snapshot({ redisConnected: false }));
    expect(report.live).toBe(true);
    expect(report.ready).toBe(false);
  });

  it('is ready only when its durable stores are reachable', () => {
    expect(buildHealthReport(dialing, snapshot()).ready).toBe(true);
    expect(buildHealthReport(dialing, snapshot({ postgresConnected: false })).ready).toBe(false);
  });
});

describe('origination permission is reported, not treated as a fault', () => {
  it('is a healthy pass when origination is disabled by default', () => {
    const report = buildHealthReport(readFlagsFromEnv({}), snapshot());
    expect(report.originationPermitted).toBe(false);
    expect(report.status).toBe('pass');
    expect(report.checks.find(c => c.name === 'origination_permitted')?.detail).toContain(
      'expected default'
    );
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

  it('surfaces an engaged emergency stop prominently', () => {
    const report = buildHealthReport({ ...dialing, emergencyStop: true }, snapshot());
    expect(report.emergencyStop).toBe(true);
    expect(report.checks.find(c => c.name === 'emergency_stop')?.detail).toContain('ENGAGED');
  });
});
