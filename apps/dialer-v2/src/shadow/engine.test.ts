import { describe, expect, it } from 'vitest';

import { SAFE_DEFAULTS, type DialerV2Flags } from '../config/flags.js';
import { DialingMode, PacingReason } from '../pacing/controller.js';

import {
  InMemoryShadowDecisionStore,
  ShadowBlockReason,
  ShadowEngine,
  buildPacingInputs,
  type ShadowObservation,
} from './engine.js';

const T0 = 1_800_000_000_000;

function shadowFlags(overrides: Partial<DialerV2Flags> = {}): DialerV2Flags {
  return {
    ...SAFE_DEFAULTS,
    enabled: true,
    shadowEnabled: true,
    allowedTenantIds: ['tenant-a'],
    allowedCampaignIds: ['camp-1'],
    ...overrides,
  };
}

function observation(overrides: Partial<ShadowObservation> = {}): ShadowObservation {
  return {
    nowMs: T0,
    policy: {
      tenantId: 'tenant-a',
      campaignId: 'camp-1',
      configuredMode: DialingMode.PREDICTIVE,
      targetOccupancy: 0.9,
      abandonTarget: 0.03,
      abandonWarn: 0.02,
      maxLinesPerAgent: 4,
      powerLinesPerAvailableAgent: 2,
      maxCps: 30,
      campaignConcurrencyRemaining: 500,
      tenantConcurrencyRemaining: 500,
      gatewayCapacityRemaining: 500,
      callableLeads: 10_000,
      minSampleSize: 50,
      minAbandonSample: 50,
      assignmentDeadlineMs: 2_000,
    },
    capacity: {
      eligible: 20,
      available: 8,
      reserved: 0,
      onCall: 12,
      wrapUp: 0,
      stale: 0,
      paused: 0,
      freshestHeartbeatAgeMs: 500,
    },
    calls: { dialing: 0, ringing: 0, answered: 0, bridged: 12, liveAnswersWaiting: 0 },
    rates: {
      attempts: 800,
      liveAnswers: 150,
      meanAnswerLatencyMs: 6_000,
      p95AnswerLatencyMs: 12_000,
      meanHandleTimeMs: 150_000,
      meanWrapUpMs: 15_000,
      abandonRate: 0.005,
      abandonSampleSize: 150,
      assignmentLatencyMsP95: 400,
    },
    health: {
      eslHealthy: true,
      redisHealthy: true,
      eventLagMs: 50,
      maxEventLagMs: 1_000,
      agentStateAgeMs: 500,
      maxAgentStateAgeMs: 10_000,
    },
    ...overrides,
  };
}

function engine() {
  const store = new InMemoryShadowDecisionStore();
  return { store, engine: new ShadowEngine(store) };
}

describe('no origination, ever', () => {
  it('marks every record as not originated', async () => {
    const { engine: e } = engine();

    const cases: Array<Partial<ShadowObservation>> = [
      {},
      { capacity: { ...observation().capacity, available: 100 } },
      { calls: { dialing: 0, ringing: 0, answered: 0, bridged: 0, liveAnswersWaiting: 0 } },
    ];

    for (const override of cases) {
      const record = await e.evaluate(shadowFlags(), observation(override));
      expect(record.originated).toBe(false);
    }
  });

  it('stays hypothetical even with origination fully enabled', async () => {
    // Shadow mode must not become live dialing because someone flipped the
    // origination flags. There is no code path from this module to an originate.
    const { engine: e } = engine();
    const record = await e.evaluate(
      shadowFlags({ originateEnabled: true, dryRun: false, maxGlobalCalls: 999, maxGlobalCps: 99 }),
      observation()
    );

    expect(record.originated).toBe(false);
    expect(record.recommendedOriginateCount).toBeGreaterThan(0);
  });

  it('exposes no method that could place a call', () => {
    const { engine: e } = engine();
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(e));
    for (const name of methods) {
      expect(name).not.toMatch(/originate|dial|call|bridge/i);
    }
  });
});

describe('allowlist and kill-switch enforcement', () => {
  const cases: Array<[string, Partial<DialerV2Flags>, ShadowBlockReason]> = [
    ['V2 disabled', { enabled: false }, ShadowBlockReason.V2_DISABLED],
    ['shadow disabled', { shadowEnabled: false }, ShadowBlockReason.SHADOW_DISABLED],
    ['emergency stop', { emergencyStop: true }, ShadowBlockReason.EMERGENCY_STOP],
    [
      'tenant not allowlisted',
      { allowedTenantIds: ['other'] },
      ShadowBlockReason.TENANT_NOT_ALLOWLISTED,
    ],
    [
      'campaign not allowlisted',
      { allowedCampaignIds: ['other'] },
      ShadowBlockReason.CAMPAIGN_NOT_ALLOWLISTED,
    ],
  ];

  it.each(cases)('%s blocks evaluation entirely', async (_n, override, reason) => {
    const { engine: e } = engine();
    const record = await e.evaluate(shadowFlags(override), observation());

    expect(record.blockedBy).toContain(reason);
    expect(record.decision).toBeNull();
    expect(record.recommendedOriginateCount).toBe(0);
    expect(record.bindingConstraint).toBe('NOT_EVALUATED');
    expect(record.explanation).toContain('not running');
  });

  it('evaluates when everything is permitted', async () => {
    const { engine: e } = engine();
    const record = await e.evaluate(shadowFlags(), observation());
    expect(record.blockedBy).toEqual([]);
    expect(record.decision).not.toBeNull();
  });
});

describe('observed state drives the controller', () => {
  it('maps capacity and calls into the input vector', () => {
    const inputs = buildPacingInputs(observation());
    expect(inputs.agentsEligible).toBe(20);
    expect(inputs.agentsAvailable).toBe(8);
    expect(inputs.agentsOnCall).toBe(12);
    expect(inputs.abandonSampleSize).toBe(150);
  });

  it('treats ringing calls as still dialing', () => {
    const inputs = buildPacingInputs(
      observation({
        calls: { dialing: 3, ringing: 4, answered: 0, bridged: 0, liveAnswersWaiting: 0 },
      })
    );
    expect(inputs.callsDialing).toBe(7);
  });

  it('never passes the emergency stop into the controller, recording it separately', async () => {
    // The recorded decision should reflect pacing logic; the kill switch is a
    // separate fact, not something that silently rewrites the maths.
    const inputs = buildPacingInputs(observation());
    expect(inputs.emergencyStop).toBe(false);

    const { engine: e } = engine();
    const record = await e.evaluate(shadowFlags({ emergencyStop: true }), observation());
    expect(record.blockedBy).toContain(ShadowBlockReason.EMERGENCY_STOP);
  });
});

describe('degradation is visible', () => {
  it('reduces pacing when agents go stale', async () => {
    // Compare steady state, not the first tick: the ramp limit pins every
    // campaign to 1 on tick zero, so a single-tick comparison proves nothing.
    const settle = async (obs: Partial<ShadowObservation>) => {
      const { engine: e } = engine();
      let last = 0;
      for (let i = 0; i < 12; i++) {
        const record = await e.evaluate(
          shadowFlags(),
          observation({ ...obs, nowMs: T0 + i * 1_000 })
        );
        last = record.recommendedOriginateCount;
      }
      return last;
    };

    const healthy = await settle({});
    const degraded = await settle({
      capacity: { ...observation().capacity, eligible: 4, available: 1, onCall: 3, stale: 16 },
    });

    expect(healthy).toBeGreaterThan(0);
    expect(degraded).toBeLessThan(healthy);
  });

  it('says so in the explanation when agents have been excluded as stale', async () => {
    const { engine: e } = engine();
    const record = await e.evaluate(
      shadowFlags(),
      observation({ capacity: { ...observation().capacity, stale: 16 } })
    );
    expect(record.explanation).toContain('stale');
  });

  it('recommends zero when ESL is unhealthy', async () => {
    const { engine: e } = engine();
    const record = await e.evaluate(
      shadowFlags(),
      observation({ health: { ...observation().health, eslHealthy: false } })
    );
    expect(record.recommendedOriginateCount).toBe(0);
    expect(record.bindingConstraint).toBe(PacingReason.ESL_UNHEALTHY);
  });

  it('recommends zero when Redis is unhealthy', async () => {
    const { engine: e } = engine();
    const record = await e.evaluate(
      shadowFlags(),
      observation({ health: { ...observation().health, redisHealthy: false } })
    );
    expect(record.recommendedOriginateCount).toBe(0);
    expect(record.bindingConstraint).toBe(PacingReason.REDIS_UNHEALTHY);
  });

  it('recommends zero when telephony events are lagging', async () => {
    const { engine: e } = engine();
    const record = await e.evaluate(
      shadowFlags(),
      observation({ health: { ...observation().health, eventLagMs: 30_000 } })
    );
    expect(record.recommendedOriginateCount).toBe(0);
    expect(record.bindingConstraint).toBe(PacingReason.EVENT_LAG);
  });

  it('records the degraded mode when the floor is too small for predictive', async () => {
    const { engine: e } = engine();
    const record = await e.evaluate(
      shadowFlags(),
      observation({
        capacity: { ...observation().capacity, eligible: 3, available: 2, onCall: 1 },
      })
    );
    expect(record.degradationMode).toBe(DialingMode.PROGRESSIVE);
    expect(record.safetyReasons).toContain(PacingReason.MODE_DEGRADED);
  });
});

describe('decision persistence', () => {
  it('stores every decision with its full input vector', async () => {
    const { engine: e, store } = engine();
    await e.evaluate(shadowFlags(), observation());

    const recent = await store.recent('tenant-a', 10);
    expect(recent).toHaveLength(1);
    expect(recent[0].tenantId).toBe('tenant-a');
    expect(recent[0].campaignId).toBe('camp-1');
    expect(recent[0].controllerVersion).toBeTruthy();
    expect(recent[0].inputs.agentsAvailable).toBe(8);
    expect(recent[0].decidedAtMs).toBe(T0);
  });

  it('carries pacing state forward, so the ramp limit applies across ticks', async () => {
    const { engine: e, store } = engine();
    for (let i = 0; i < 4; i++) {
      await e.evaluate(shadowFlags(), observation({ nowMs: T0 + i * 1_000 }));
    }

    const recent = await store.recent('tenant-a', 10);
    const counts = recent.map(r => r.recommendedOriginateCount).reverse();
    expect(counts[0]).toBe(1);
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeLessThanOrEqual(Math.floor(counts[i - 1] * 1.5 + 1));
    }
  });

  it('never returns another tenant decisions', async () => {
    const { engine: e, store } = engine();
    await e.evaluate(shadowFlags(), observation());
    await e.evaluate(
      shadowFlags({ allowedTenantIds: ['tenant-a', 'tenant-b'] }),
      observation({ policy: { ...observation().policy, tenantId: 'tenant-b' } })
    );

    const forA = await store.recent('tenant-a', 10);
    expect(forA.every(d => d.tenantId === 'tenant-a')).toBe(true);
    expect(forA).toHaveLength(1);
  });

  it('filters by campaign when asked', async () => {
    const { engine: e, store } = engine();
    await e.evaluate(shadowFlags(), observation());
    await e.evaluate(
      shadowFlags({ allowedCampaignIds: ['camp-1', 'camp-2'] }),
      observation({ policy: { ...observation().policy, campaignId: 'camp-2' } })
    );

    expect(await store.recent('tenant-a', 10, 'camp-2')).toHaveLength(1);
  });

  it('bounds stored history', async () => {
    const store = new InMemoryShadowDecisionStore(5);
    const e = new ShadowEngine(store);
    for (let i = 0; i < 20; i++) {
      await e.evaluate(shadowFlags(), observation({ nowMs: T0 + i }));
    }
    expect(store.size()).toBe(5);
  });
});

describe('explanations', () => {
  it('answers why the dialer would place calls', async () => {
    const { engine: e } = engine();
    const record = await e.evaluate(shadowFlags(), observation());
    expect(record.explanation).toMatch(/would place \d+ call/);
    expect(record.explanation).toContain('limiting factor');
  });

  it('answers why it would not', async () => {
    const { engine: e } = engine();
    const record = await e.evaluate(
      shadowFlags(),
      observation({ policy: { ...observation().policy, callableLeads: 0 } })
    );
    expect(record.explanation).toContain('no calls');
    expect(record.explanation).toContain(PacingReason.NO_CALLABLE_LEADS);
  });
});
