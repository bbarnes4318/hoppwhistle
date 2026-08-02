import { describe, expect, it } from 'vitest';

import {
  DialingMode,
  P_LIVE_FLOOR,
  PacingReason,
  abandonDamping,
  baselinePacingInputs,
  completionProbability,
  decidePacing,
  liveAnswerProbability,
} from './controller.js';

/** A previous state high enough that the ramp limit is not the binding constraint. */
const RAMPED = { originateCount: 1_000 };

describe('live-answer probability', () => {
  it('starts pessimistic with no data', () => {
    // Prior mean 0.10 — a new campaign under-dials rather than over-dials.
    expect(liveAnswerProbability(0, 0)).toBeCloseTo(0.1, 6);
  });

  it('converges on the observed rate as evidence accumulates', () => {
    const early = liveAnswerProbability(6, 20);
    const late = liveAnswerProbability(3_000, 10_000);
    expect(late).toBeGreaterThan(early);
    expect(late).toBeCloseTo(0.3, 2);
  });

  it('is floored so the deficit division cannot diverge', () => {
    expect(liveAnswerProbability(0, 1_000_000)).toBe(P_LIVE_FLOOR);
  });

  it('tolerates impossible inputs', () => {
    expect(liveAnswerProbability(-5, -5)).toBeGreaterThan(0);
    expect(liveAnswerProbability(100, 1)).toBeLessThanOrEqual(1);
  });
});

describe('completion probability', () => {
  it('rises with the horizon and falls with the mean duration', () => {
    expect(completionProbability(10_000, 100_000)).toBeLessThan(
      completionProbability(50_000, 100_000)
    );
    expect(completionProbability(10_000, 500_000)).toBeLessThan(
      completionProbability(10_000, 50_000)
    );
  });

  it('is bounded in [0, 1]', () => {
    expect(completionProbability(0, 1_000)).toBe(0);
    expect(completionProbability(1e9, 1_000)).toBeLessThanOrEqual(1);
  });
});

describe('hard stops', () => {
  const cases: Array<[string, Parameters<typeof baselinePacingInputs>[0], PacingReason]> = [
    ['emergency stop', { emergencyStop: true }, PacingReason.EMERGENCY_STOP],
    ['redis down', { redisHealthy: false }, PacingReason.REDIS_UNHEALTHY],
    ['esl down', { eslHealthy: false }, PacingReason.ESL_UNHEALTHY],
    ['stale agent state', { agentStateAgeMs: 60_000 }, PacingReason.AGENT_STATE_STALE],
    ['event lag', { eventLagMs: 5_000 }, PacingReason.EVENT_LAG],
    ['abandonment at ceiling', { abandonRate: 0.03 }, PacingReason.ABANDON_LIMIT_REACHED],
    ['no leads', { callableLeads: 0 }, PacingReason.NO_CALLABLE_LEADS],
    ['no agents', { agentsEligible: 0 }, PacingReason.NO_ELIGIBLE_AGENTS],
  ];

  it.each(cases)('%s stops all origination', (_name, override, reason) => {
    const decision = decidePacing(baselinePacingInputs(override), RAMPED);
    expect(decision.originateCount).toBe(0);
    expect(decision.bindingConstraint).toBe(reason);
  });

  it('signals a campaign pause only when abandonment hits the hard ceiling', () => {
    expect(decidePacing(baselinePacingInputs({ abandonRate: 0.03 }), RAMPED).pauseCampaign).toBe(
      true
    );
    expect(decidePacing(baselinePacingInputs({ abandonRate: 0.025 }), RAMPED).pauseCampaign).toBe(
      false
    );
  });

  it('does not interrupt anything — it only withholds new calls', () => {
    const decision = decidePacing(
      baselinePacingInputs({ emergencyStop: true, callsBridged: 40 }),
      RAMPED
    );
    // The decision is purely "originate zero"; nothing in it tears down calls.
    expect(decision.originateCount).toBe(0);
  });
});

describe('predictive demand', () => {
  it('places calls ahead of agent availability', () => {
    const decision = decidePacing(baselinePacingInputs(), RAMPED);
    expect(decision.mode).toBe(DialingMode.PREDICTIVE);
    // More calls than free agents — that is what makes it predictive — but
    // bounded well below the naive capacity/answer-rate figure by the variance
    // buffer.
    expect(decision.originateCount).toBeGreaterThan(baselinePacingInputs().agentsAvailable);
    expect(decision.originateCount).toBeLessThan(20);
  });

  it('holds back a variance buffer that is proportionally larger for small floors', () => {
    // sqrt(n)/n shrinks as n grows, so a big floor is dialed closer to its
    // nominal capacity than a small one.
    const smallFloor = decidePacing(
      baselinePacingInputs({ agentsAvailable: 4, agentsOnCall: 0, agentsEligible: 10 }),
      RAMPED
    );
    const bigFloor = decidePacing(
      baselinePacingInputs({ agentsAvailable: 100, agentsOnCall: 0, agentsEligible: 200 }),
      RAMPED
    );
    const smallUtilisation = (smallFloor.originateCount * smallFloor.pLive) / 4;
    const bigUtilisation = (bigFloor.originateCount * bigFloor.pLive) / 100;
    expect(smallUtilisation).toBeLessThan(bigUtilisation);
  });

  it('dials more when the answer rate is lower', () => {
    const high = decidePacing(
      baselinePacingInputs({ liveAnswers: 250, attempts: 500 }),
      RAMPED
    ).originateCount;
    const low = decidePacing(
      baselinePacingInputs({ liveAnswers: 25, attempts: 500 }),
      RAMPED
    ).originateCount;
    expect(low).toBeGreaterThan(high);
  });

  it('stops when no capacity is forecast', () => {
    const decision = decidePacing(
      baselinePacingInputs({ agentsAvailable: 0, agentsOnCall: 0, agentsWrapUp: 0 }),
      RAMPED
    );
    expect(decision.originateCount).toBe(0);
    expect(decision.bindingConstraint).toBe(PacingReason.NO_AVAILABLE_CAPACITY);
  });

  it('counts calls already in flight against the deficit', () => {
    const idle = decidePacing(baselinePacingInputs({ callsDialing: 0 }), RAMPED).originateCount;
    const busy = decidePacing(baselinePacingInputs({ callsDialing: 20 }), RAMPED).originateCount;
    expect(busy).toBeLessThan(idle);
  });

  it('counts unassigned live answers as consumed capacity', () => {
    const decision = decidePacing(baselinePacingInputs({ callsLiveWaiting: 10 }), RAMPED);
    expect(decision.originateCount).toBe(0);
  });
});

describe('safety ceilings', () => {
  it('never exceeds max lines per agent even if the answer rate estimate collapses', () => {
    const decision = decidePacing(
      baselinePacingInputs({ liveAnswers: 0, attempts: 100_000, maxLinesPerAgent: 4 }),
      RAMPED
    );
    expect(decision.pLive).toBe(P_LIVE_FLOOR);
    // 4 lines × 10 eligible agents.
    expect(decision.originateCount).toBeLessThanOrEqual(40);
    expect(decision.bindingConstraint).toBe(PacingReason.MAX_LINES_PER_AGENT);
  });

  const capCases: Array<[string, Parameters<typeof baselinePacingInputs>[0], PacingReason]> = [
    [
      'campaign concurrency',
      { campaignConcurrencyRemaining: 3 },
      PacingReason.CAMPAIGN_CONCURRENCY,
    ],
    ['tenant concurrency', { tenantConcurrencyRemaining: 2 }, PacingReason.TENANT_CONCURRENCY],
    ['gateway capacity', { gatewayCapacityRemaining: 4 }, PacingReason.GATEWAY_CAPACITY],
    ['cps', { maxCps: 5 }, PacingReason.MAX_CPS],
    ['lead inventory', { callableLeads: 6 }, PacingReason.LEAD_INVENTORY],
  ];

  it.each(capCases)(
    'respects %s and names it as the binding constraint',
    (_n, override, reason) => {
      const decision = decidePacing(baselinePacingInputs(override), RAMPED);
      expect(decision.bindingConstraint).toBe(reason);
      expect(decision.reasons).toContain(reason);
    }
  );

  it('applies the smallest cap when several bind', () => {
    const decision = decidePacing(
      baselinePacingInputs({ campaignConcurrencyRemaining: 8, maxCps: 3, callableLeads: 5 }),
      RAMPED
    );
    expect(decision.originateCount).toBe(3);
    expect(decision.bindingConstraint).toBe(PacingReason.MAX_CPS);
  });
});

describe('ramp limiting', () => {
  it('starts at one call from a standing start', () => {
    const decision = decidePacing(baselinePacingInputs(), { originateCount: 0 });
    expect(decision.originateCount).toBe(1);
    expect(decision.bindingConstraint).toBe(PacingReason.RAMP_LIMIT);
  });

  it('ramps geometrically rather than spiking', () => {
    // A large floor so that demand, not capacity, exceeds the ramp at each step.
    const large = { agentsAvailable: 200, agentsEligible: 200, agentsOnCall: 0 };
    const seen: number[] = [];
    let prev = { originateCount: 0 };
    for (let i = 0; i < 6; i++) {
      const decision = decidePacing(baselinePacingInputs(large), prev);
      seen.push(decision.originateCount);
      prev = { originateCount: decision.originateCount };
    }
    expect(seen).toEqual([1, 2, 4, 7, 11, 17]);
  });

  it('does not rate-limit reductions — pacing may fall to zero in one tick', () => {
    const decision = decidePacing(baselinePacingInputs({ agentsAvailable: 0, agentsOnCall: 0 }), {
      originateCount: 500,
    });
    expect(decision.originateCount).toBe(0);
  });
});

describe('abandonment damping', () => {
  it('brakes continuously from zero and reaches a full stop at the ceiling', () => {
    expect(abandonDamping(0, 0.03)).toBe(1);
    expect(abandonDamping(0.01, 0.03)).toBeCloseTo(1 - (1 / 3) ** 2, 6);
    expect(abandonDamping(0.025, 0.03)).toBeCloseTo(1 - (0.025 / 0.03) ** 2, 6);
    expect(abandonDamping(0.03, 0.03)).toBe(0);
    expect(abandonDamping(0.5, 0.03)).toBe(0);
  });

  it('is ignored entirely below the minimum sample size', () => {
    // A 3% rate cannot be represented by 8 samples; acting on it latches the
    // campaign off for no reason. Verified against the simulator.
    const tiny = decidePacing(
      baselinePacingInputs({ abandonRate: 0.5, abandonSampleSize: 8, minAbandonSample: 50 }),
      RAMPED
    );
    expect(tiny.originateCount).toBeGreaterThan(0);
    expect(tiny.abandonWarning).toBe(false);

    const measured = decidePacing(
      baselinePacingInputs({ abandonRate: 0.5, abandonSampleSize: 200, minAbandonSample: 50 }),
      RAMPED
    );
    expect(measured.originateCount).toBe(0);
    expect(measured.pauseCampaign).toBe(true);
  });

  it('reduces pacing monotonically as abandonment rises', () => {
    // The core safety property: more abandonment never means more calls.
    let previous = Number.POSITIVE_INFINITY;
    for (const rate of [0, 0.005, 0.01, 0.015, 0.02, 0.022, 0.025, 0.028, 0.03, 0.05]) {
      const count = decidePacing(
        baselinePacingInputs({ abandonRate: rate }),
        RAMPED
      ).originateCount;
      expect(count).toBeLessThanOrEqual(previous);
      previous = count;
    }
    expect(previous).toBe(0);
  });

  it('flags the warning before the ceiling is reached', () => {
    const decision = decidePacing(baselinePacingInputs({ abandonRate: 0.022 }), RAMPED);
    expect(decision.abandonWarning).toBe(true);
    expect(decision.pauseCampaign).toBe(false);
    expect(decision.reasons).toContain(PacingReason.ABANDON_DAMPING);
  });
});

describe('assignment latency damping', () => {
  it('reduces pacing when answered calls are waiting too long for an agent', () => {
    const fast = decidePacing(
      baselinePacingInputs({ assignmentLatencyMsP95: 200 }),
      RAMPED
    ).originateCount;
    const slow = decidePacing(
      baselinePacingInputs({ assignmentLatencyMsP95: 3_000 }),
      RAMPED
    ).originateCount;
    expect(slow).toBeLessThan(fast);
  });

  it('stops entirely at twice the assignment deadline', () => {
    const decision = decidePacing(
      baselinePacingInputs({ assignmentLatencyMsP95: 4_000, assignmentDeadlineMs: 2_000 }),
      RAMPED
    );
    expect(decision.originateCount).toBe(0);
  });
});

describe('automatic mode degradation', () => {
  it('uses predictive only with enough agents and enough data', () => {
    expect(decidePacing(baselinePacingInputs(), RAMPED).mode).toBe(DialingMode.PREDICTIVE);
  });

  it('degrades to progressive for a small agent pool', () => {
    const decision = decidePacing(baselinePacingInputs({ agentsEligible: 3 }), RAMPED);
    expect(decision.mode).toBe(DialingMode.PROGRESSIVE);
    expect(decision.confidence).toBe('LOW');
    expect(decision.reasons).toContain(PacingReason.MODE_DEGRADED);
  });

  it('degrades when there is not enough answer-rate history', () => {
    const decision = decidePacing(baselinePacingInputs({ attempts: 0, liveAnswers: 0 }), RAMPED);
    expect(decision.mode).toBe(DialingMode.PROGRESSIVE);
  });

  it('uses power as the intermediate step', () => {
    const decision = decidePacing(
      baselinePacingInputs({ attempts: 30, liveAnswers: 6, agentsEligible: 5 }),
      RAMPED
    );
    expect(decision.mode).toBe(DialingMode.POWER);
    expect(decision.confidence).toBe('MEDIUM');
  });

  it('treats the configured mode as a ceiling, never a floor', () => {
    // A progressive campaign with abundant data and agents stays progressive.
    const decision = decidePacing(
      baselinePacingInputs({ configuredMode: DialingMode.PROGRESSIVE, agentsEligible: 50 }),
      RAMPED
    );
    expect(decision.mode).toBe(DialingMode.PROGRESSIVE);
  });
});

describe('progressive mode invariant', () => {
  it('never intentionally creates more live answers than available agents', () => {
    for (const agentsAvailable of [0, 1, 3, 7, 12, 40]) {
      for (const callsDialing of [0, 1, 5, 20]) {
        const decision = decidePacing(
          baselinePacingInputs({
            configuredMode: DialingMode.PROGRESSIVE,
            agentsAvailable,
            callsDialing,
            agentsEligible: 50,
          }),
          RAMPED
        );
        expect(decision.originateCount + callsDialing).toBeLessThanOrEqual(
          Math.max(agentsAvailable, callsDialing)
        );
      }
    }
  });
});

describe('robustness', () => {
  it('never returns a negative or fractional count', () => {
    const hostile = [
      { agentsAvailable: -5 },
      { callsDialing: -10 },
      { agentsEligible: Number.NaN },
      { meanHandleTimeMs: 0 },
      { meanWrapUpMs: -1 },
      { targetOccupancy: 100 },
      { p95AnswerLatencyMs: Number.POSITIVE_INFINITY },
      { maxCps: -1 },
      { tickSeconds: 0 },
    ];
    for (const override of hostile) {
      const decision = decidePacing(baselinePacingInputs(override), RAMPED);
      expect(Number.isInteger(decision.originateCount)).toBe(true);
      expect(decision.originateCount).toBeGreaterThanOrEqual(0);
    }
  });

  it('always names a binding constraint', () => {
    for (const override of [{}, { abandonRate: 0.05 }, { maxCps: 1 }, { agentsEligible: 0 }]) {
      const decision = decidePacing(baselinePacingInputs(override), RAMPED);
      expect(decision.bindingConstraint).toBeTruthy();
      expect(decision.reasons).toContain(decision.bindingConstraint);
    }
  });

  it('is deterministic', () => {
    const inputs = baselinePacingInputs();
    expect(decidePacing(inputs, RAMPED)).toEqual(decidePacing(inputs, RAMPED));
  });
});
