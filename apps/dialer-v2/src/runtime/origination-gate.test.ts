import { describe, expect, it } from 'vitest';

import { SAFE_DEFAULTS, type DialerV2Flags, readFlagsFromEnv } from '../config/flags.js';

import { GateFailure, evaluateOriginationGate, permissiveContext } from './origination-gate.js';

/** The minimum flag set that permits origination for tenant `t1`, campaign `c1`. */
function permissiveFlags(overrides: Partial<DialerV2Flags> = {}): DialerV2Flags {
  return {
    ...SAFE_DEFAULTS,
    enabled: true,
    originateEnabled: true,
    dryRun: false,
    emergencyStop: false,
    allowedTenantIds: ['t1'],
    allowedCampaignIds: ['c1'],
    maxGlobalCps: 10,
    maxGlobalCalls: 100,
    ...overrides,
  };
}

const ctx = permissiveContext({ tenantId: 't1', campaignId: 'c1' });

describe('default configuration', () => {
  it('refuses to originate with an empty environment', () => {
    const result = evaluateOriginationGate(readFlagsFromEnv({}), ctx);
    expect(result.allowed).toBe(false);
  });

  it('reports every independent reason, not just the first', () => {
    const result = evaluateOriginationGate(readFlagsFromEnv({}), ctx);

    expect(result.failures).toEqual(
      expect.arrayContaining([
        GateFailure.V2_DISABLED,
        GateFailure.ORIGINATION_DISABLED,
        GateFailure.DRY_RUN,
        GateFailure.TENANT_NOT_ALLOWLISTED,
        GateFailure.CAMPAIGN_NOT_ALLOWLISTED,
        GateFailure.GLOBAL_CALL_CEILING,
        GateFailure.GLOBAL_CPS_CEILING,
      ])
    );
    // Six independent switches would each have to be flipped.
    expect(result.failures.length).toBeGreaterThanOrEqual(6);
  });

  it('produces human-readable explanations for the supervisor UI', () => {
    const result = evaluateOriginationGate(readFlagsFromEnv({}), ctx);
    expect(result.explanations.length).toBe(result.failures.length);
    for (const text of result.explanations) {
      expect(text.length).toBeGreaterThan(0);
    }
  });
});

describe('fully permissive configuration', () => {
  it('allows origination', () => {
    const result = evaluateOriginationGate(permissiveFlags(), ctx);
    expect(result.failures).toEqual([]);
    expect(result.allowed).toBe(true);
  });
});

describe('each condition independently blocks', () => {
  const flagCases: Array<[string, Partial<DialerV2Flags>, GateFailure]> = [
    ['master switch off', { enabled: false }, GateFailure.V2_DISABLED],
    ['origination off', { originateEnabled: false }, GateFailure.ORIGINATION_DISABLED],
    ['dry run', { dryRun: true }, GateFailure.DRY_RUN],
    ['emergency stop', { emergencyStop: true }, GateFailure.EMERGENCY_STOP],
    ['tenant not allowlisted', { allowedTenantIds: ['other'] }, GateFailure.TENANT_NOT_ALLOWLISTED],
    [
      'campaign not allowlisted',
      { allowedCampaignIds: ['other'] },
      GateFailure.CAMPAIGN_NOT_ALLOWLISTED,
    ],
    ['no global call capacity', { maxGlobalCalls: 0 }, GateFailure.GLOBAL_CALL_CEILING],
    ['no global cps capacity', { maxGlobalCps: 0 }, GateFailure.GLOBAL_CPS_CEILING],
  ];

  it.each(flagCases)('%s', (_name, override, expected) => {
    const result = evaluateOriginationGate(permissiveFlags(override), ctx);
    expect(result.allowed).toBe(false);
    expect(result.failures).toContain(expected);
  });

  const ctxCases: Array<[string, Parameters<typeof permissiveContext>[0], GateFailure]> = [
    ['FreeSWITCH down', { freeswitchHealthy: false }, GateFailure.FREESWITCH_UNHEALTHY],
    ['Redis down', { redisHealthy: false }, GateFailure.REDIS_UNHEALTHY],
    ['Postgres down', { postgresHealthy: false }, GateFailure.POSTGRES_UNHEALTHY],
    ['campaign paused', { campaignActive: false }, GateFailure.CAMPAIGN_NOT_ACTIVE],
    ['outside schedule', { withinSchedule: false }, GateFailure.OUTSIDE_SCHEDULE],
    ['compliance block', { compliancePassed: false }, GateFailure.COMPLIANCE_BLOCKED],
    ['no carrier capacity', { carrierCapacityAvailable: false }, GateFailure.NO_CARRIER_CAPACITY],
    ['no caller ID', { callerIdAvailable: false }, GateFailure.NO_CALLER_ID_AVAILABLE],
    ['stale agent state', { agentStateAgeMs: 60_000 }, GateFailure.AGENT_STATE_STALE],
    ['pacing says no', { pacingAllows: false }, GateFailure.PACING_DISALLOWS],
    ['campaign still on V1', { campaignDialerVersion: 1 }, GateFailure.CAMPAIGN_NOT_ON_V2],
  ];

  it.each(ctxCases)('%s', (_name, override, expected) => {
    const result = evaluateOriginationGate(
      permissiveFlags(),
      permissiveContext({ tenantId: 't1', campaignId: 'c1', ...override })
    );
    expect(result.allowed).toBe(false);
    expect(result.failures).toContain(expected);
  });
});

describe('campaign isolation from the Hopper', () => {
  it('refuses any campaign that has not explicitly opted in to V2', () => {
    // This is what prevents V1 and V2 ever contending for the same campaign.
    for (const version of [0, 1, 3, Number.NaN]) {
      const result = evaluateOriginationGate(
        permissiveFlags(),
        permissiveContext({ tenantId: 't1', campaignId: 'c1', campaignDialerVersion: version })
      );
      expect(result.failures).toContain(GateFailure.CAMPAIGN_NOT_ON_V2);
    }
  });
});

describe('agent heartbeat enforcement', () => {
  it('is skipped when the operator has explicitly disabled it', () => {
    const result = evaluateOriginationGate(
      permissiveFlags({ requireHealthyAgentHeartbeats: false }),
      permissiveContext({ tenantId: 't1', campaignId: 'c1', agentStateAgeMs: 60_000 })
    );
    expect(result.failures).not.toContain(GateFailure.AGENT_STATE_STALE);
  });
});

describe('compliance detail', () => {
  it('is surfaced in the explanation', () => {
    const result = evaluateOriginationGate(
      permissiveFlags(),
      permissiveContext({
        tenantId: 't1',
        campaignId: 'c1',
        compliancePassed: false,
        complianceDetail: 'number is on the tenant DNC list',
      })
    );
    expect(result.explanations.join(' ')).toContain('tenant DNC list');
  });
});

describe('gate robustness', () => {
  it('never throws, whatever it is handed', () => {
    const nonsense = {
      ...permissiveContext(),
      tenantId: '',
      campaignId: '',
      agentStateAgeMs: Number.NaN,
      globalActiveCalls: Number.NaN,
    };
    expect(() => evaluateOriginationGate(readFlagsFromEnv({}), nonsense)).not.toThrow();
    expect(evaluateOriginationGate(readFlagsFromEnv({}), nonsense).allowed).toBe(false);
  });
});
