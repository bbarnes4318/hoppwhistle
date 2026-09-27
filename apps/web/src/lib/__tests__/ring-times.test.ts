import { describe, expect, it } from 'vitest';

import { clampRingSeconds, ringTimesOf } from '../ring-times';

describe('campaign ring times', () => {
  it('defaults to 20 seconds for agents and 30 for buyers', () => {
    expect(ringTimesOf(null)).toEqual({ agentRingSeconds: 20, buyerRingSeconds: 30 });
    expect(ringTimesOf({ answerOrder: 'AGENTS_FIRST' })).toEqual({
      agentRingSeconds: 20,
      buyerRingSeconds: 30,
    });
  });

  it('reads what the metadata holds', () => {
    expect(ringTimesOf({ agentRingSeconds: 45, buyerRingSeconds: '60' })).toEqual({
      agentRingSeconds: 45,
      buyerRingSeconds: 60,
    });
  });

  it('clamps to 10-120 whole seconds, and falls back on anything not positive', () => {
    expect(clampRingSeconds(5, 20)).toBe(10);
    expect(clampRingSeconds(500, 20)).toBe(120);
    expect(clampRingSeconds(25.6, 20)).toBe(26);
    expect(clampRingSeconds(0, 20)).toBe(20);
    expect(clampRingSeconds('', 30)).toBe(30);
    expect(clampRingSeconds('abc', 30)).toBe(30);
    expect(clampRingSeconds(-4, 30)).toBe(30);
  });
});
