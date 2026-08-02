import { describe, expect, it } from 'vitest';

import { DialingMode } from '../pacing/controller.js';

import { defaultSimulatorConfig, runSimulation } from './simulator.js';

describe('determinism', () => {
  it('produces identical results for the same seed', () => {
    const config = defaultSimulatorConfig({ seed: 42, ticks: 300 });
    const a = runSimulation(config);
    const b = runSimulation(config);

    expect(a.totalAttempts).toBe(b.totalAttempts);
    expect(a.totalLiveAnswers).toBe(b.totalLiveAnswers);
    expect(a.totalAbandoned).toBe(b.totalAbandoned);
    expect(a.ticks.map(t => t.originated)).toEqual(b.ticks.map(t => t.originated));
  });

  it('produces different results for different seeds', () => {
    const a = runSimulation(defaultSimulatorConfig({ seed: 1, ticks: 300 }));
    const b = runSimulation(defaultSimulatorConfig({ seed: 2, ticks: 300 }));
    expect(a.totalAttempts).not.toBe(b.totalAttempts);
  });
});

describe('kill switches stop origination', () => {
  it('places no calls after the emergency stop engages', () => {
    const result = runSimulation(defaultSimulatorConfig({ ticks: 400, emergencyStopAt: 200 }));
    const after = result.ticks.filter(t => t.tick >= 200);
    expect(after.every(t => t.originated === 0)).toBe(true);
    // …and it was dialing beforehand, so the assertion is meaningful.
    expect(result.ticks.filter(t => t.tick < 200).some(t => t.originated > 0)).toBe(true);
  });

  it('places no calls while Redis is unavailable', () => {
    const result = runSimulation(
      defaultSimulatorConfig({ ticks: 400, redisOutage: { from: 150, to: 250 } })
    );
    const during = result.ticks.filter(t => t.tick >= 150 && t.tick <= 250);
    expect(during.every(t => t.originated === 0)).toBe(true);
    // Recovers afterwards.
    expect(result.ticks.filter(t => t.tick > 260).some(t => t.originated > 0)).toBe(true);
  });

  it('places no calls while telephony events are lagging', () => {
    const result = runSimulation(
      defaultSimulatorConfig({ ticks: 400, eventLagSpike: { from: 100, to: 200, lagMs: 8_000 } })
    );
    const during = result.ticks.filter(t => t.tick >= 100 && t.tick <= 200);
    expect(during.every(t => t.originated === 0)).toBe(true);
  });

  it('places no calls while the carrier has no capacity', () => {
    const result = runSimulation(
      defaultSimulatorConfig({ ticks: 400, carrierOutage: { from: 100, to: 200 } })
    );
    const during = result.ticks.filter(t => t.tick >= 100 && t.tick <= 200);
    expect(during.every(t => t.originated === 0)).toBe(true);
  });
});

describe('abandonment control', () => {
  it('stays inside the configured ceiling under steady conditions', () => {
    const result = runSimulation(defaultSimulatorConfig({ ticks: 1_800, agents: 20 }));
    expect(result.totalLiveAnswers).toBeGreaterThan(100);
    expect(result.abandonRate).toBeLessThan(0.03);
  });

  it('stays inside the ceiling on a smaller floor too', () => {
    const result = runSimulation(defaultSimulatorConfig({ ticks: 1_800, agents: 12 }));
    expect(result.abandonRate).toBeLessThan(0.03);
  });

  it('degrades gracefully when the answer rate jumps 4.5x without warning', () => {
    // The adversarial case: a list-quality shift is how a naive dialer floods
    // the floor. The transient does exceed the 3% target — this asserts the
    // bound it actually holds, and the limitation is documented in
    // PREDICTIVE_PACING_SPEC.md rather than hidden.
    const result = runSimulation(
      defaultSimulatorConfig({
        ticks: 1_800,
        agents: 20,
        liveAnswerRate: 0.1,
        answerRateShift: { atTick: 900, to: 0.45 },
      })
    );
    expect(result.abandonRate).toBeLessThan(0.08);
  });

  it('survives losing most of the floor without a call storm', () => {
    const result = runSimulation(
      defaultSimulatorConfig({
        ticks: 1_200,
        agents: 20,
        agentDrop: { atTick: 600, count: 15 },
      })
    );
    const after = result.ticks.filter(t => t.tick > 600);
    // Five agents remain; the 4-lines-per-agent ceiling caps this at 20.
    expect(Math.max(...after.map(t => t.originated))).toBeLessThanOrEqual(20);
  });
});

describe('anti-oscillation', () => {
  it('never spikes — growth is bounded by the ramp limit', () => {
    const result = runSimulation(defaultSimulatorConfig({ ticks: 1_200, agents: 20 }));
    // originate(t) <= originate(t-1) * 1.5 + 1, so the jump can never exceed
    // half the previous value plus one.
    for (let i = 1; i < result.ticks.length; i++) {
      const prev = result.ticks[i - 1].originated;
      const curr = result.ticks[i].originated;
      expect(curr).toBeLessThanOrEqual(Math.floor(prev * 1.5 + 1));
    }
  });

  it('respects the max-lines-per-agent ceiling at all times', () => {
    const config = defaultSimulatorConfig({ ticks: 1_200, agents: 12, maxLinesPerAgent: 4 });
    const result = runSimulation(config);
    for (const tick of result.ticks) {
      expect(tick.originated + tick.callsDialing).toBeLessThanOrEqual(
        config.agents * config.maxLinesPerAgent
      );
    }
  });
});

describe('mode degradation', () => {
  it('never uses predictive with a small agent pool', () => {
    const result = runSimulation(defaultSimulatorConfig({ ticks: 900, agents: 2 }));
    expect(result.modesUsed).not.toContain(DialingMode.PREDICTIVE);
    expect(result.modesUsed).not.toContain(DialingMode.POWER);
    expect(result.modesUsed).toEqual([DialingMode.PROGRESSIVE]);
  });

  it('reaches predictive once there are enough agents and enough data', () => {
    const result = runSimulation(defaultSimulatorConfig({ ticks: 900, agents: 20 }));
    expect(result.modesUsed).toContain(DialingMode.PREDICTIVE);
  });

  it('starts progressive before any data exists', () => {
    const result = runSimulation(defaultSimulatorConfig({ ticks: 900, agents: 20 }));
    expect(result.ticks[0].decision.mode).toBe(DialingMode.PROGRESSIVE);
  });
});

describe('progressive mode', () => {
  it('never dials beyond the available agents', () => {
    const result = runSimulation(
      defaultSimulatorConfig({ ticks: 900, agents: 15, configuredMode: DialingMode.PROGRESSIVE })
    );
    for (const tick of result.ticks) {
      expect(tick.originated + tick.callsDialing).toBeLessThanOrEqual(
        Math.max(tick.agentsAvailable, tick.callsDialing)
      );
    }
  });

  it('is safer than predictive but contacts fewer people', () => {
    const base = { ticks: 1_800, agents: 20, seed: 7 };
    const progressive = runSimulation(
      defaultSimulatorConfig({ ...base, configuredMode: DialingMode.PROGRESSIVE })
    );
    const predictive = runSimulation(
      defaultSimulatorConfig({ ...base, configuredMode: DialingMode.PREDICTIVE })
    );

    // Progressive cannot abandon at all: it never dials past a free agent.
    expect(progressive.abandonRate).toBe(0);
    expect(progressive.abandonRate).toBeLessThanOrEqual(predictive.abandonRate);

    // …and this is what predictive buys: more conversations and higher
    // occupancy, while still inside the compliance ceiling.
    expect(predictive.totalBridged).toBeGreaterThan(progressive.totalBridged);
    expect(predictive.occupancy).toBeGreaterThan(progressive.occupancy);
    expect(predictive.abandonRate).toBeLessThan(0.03);
  });
});

describe('lead inventory', () => {
  it('stops when leads run out', () => {
    const result = runSimulation(
      defaultSimulatorConfig({ ticks: 600, agents: 12, callableLeads: 50 })
    );
    expect(result.totalAttempts).toBeLessThanOrEqual(50);
    expect(result.ticks[result.ticks.length - 1].originated).toBe(0);
  });
});
