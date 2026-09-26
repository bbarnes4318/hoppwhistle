import { describe, expect, it } from 'vitest';

import {
  agentPriorityFor,
  answerOrderFromMetadata,
  isAnswerOrder,
  planAnswerOrder,
} from '../services/campaigns/answer-order.js';

/**
 * The "who answers first" rule, without a database.
 *
 * min is the lowest buyer priority on the campaign; buyers keep their own rank
 * (p - min), shifted past the agents when agents go first; agents sit at 0, or
 * at 1000 behind every buyer when buyers go first.
 */

const rows = {
  agents: [
    { id: 'a1', priority: null },
    { id: 'a2', priority: 7 },
  ],
  buyers: [
    { id: 'b1', priority: 5 },
    { id: 'b2', priority: 8 },
    { id: 'b3', priority: 6 },
  ],
};

const byId = (list: Array<{ id: string; priority: number }>) =>
  Object.fromEntries(list.map(row => [row.id, row.priority]));

describe('planAnswerOrder', () => {
  it('AGENTS_FIRST: agents 0, buyers 10 + (p - min)', () => {
    const plan = planAnswerOrder('AGENTS_FIRST', rows);
    expect(byId(plan.agents)).toEqual({ a1: 0, a2: 0 });
    expect(byId(plan.buyers)).toEqual({ b1: 10, b2: 13, b3: 11 });
  });

  it('BUYERS_FIRST: buyers (p - min), agents 1000', () => {
    const plan = planAnswerOrder('BUYERS_FIRST', rows);
    expect(byId(plan.agents)).toEqual({ a1: 1000, a2: 1000 });
    expect(byId(plan.buyers)).toEqual({ b1: 0, b2: 3, b3: 1 });
  });

  it('TOGETHER: agents 0, buyers (p - min)', () => {
    const plan = planAnswerOrder('TOGETHER', rows);
    expect(byId(plan.agents)).toEqual({ a1: 0, a2: 0 });
    expect(byId(plan.buyers)).toEqual({ b1: 0, b2: 3, b3: 1 });
  });

  it('keeps a three-buyer weighted split level under every mode', () => {
    const split = {
      agents: [],
      buyers: [
        { id: 'x', priority: 4 },
        { id: 'y', priority: 4 },
        { id: 'z', priority: 4 },
      ],
    };
    for (const mode of ['AGENTS_FIRST', 'BUYERS_FIRST', 'TOGETHER'] as const) {
      const values = new Set(planAnswerOrder(mode, split).buyers.map(b => b.priority));
      expect(values.size, mode).toBe(1);
    }
    expect(planAnswerOrder('AGENTS_FIRST', split).buyers[0].priority).toBe(10);
    expect(planAnswerOrder('TOGETHER', split).buyers[0].priority).toBe(0);
  });

  it('takes min as 0 when there are no buyers, and handles negative priorities', () => {
    expect(
      planAnswerOrder('BUYERS_FIRST', { agents: [{ id: 'a', priority: 3 }], buyers: [] })
    ).toEqual({
      agents: [{ id: 'a', priority: 1000 }],
      buyers: [],
    });
    const plan = planAnswerOrder('TOGETHER', {
      agents: [],
      buyers: [
        { id: 'n', priority: -2 },
        { id: 'p', priority: 1 },
      ],
    });
    expect(byId(plan.buyers)).toEqual({ n: 0, p: 3 });
  });
});

describe('answer-order helpers', () => {
  it('reads the mode off campaign metadata, and nothing else', () => {
    expect(answerOrderFromMetadata({ answerOrder: 'TOGETHER', other: 1 })).toBe('TOGETHER');
    expect(answerOrderFromMetadata({ answerOrder: 'SOMETIMES' })).toBeNull();
    expect(answerOrderFromMetadata(null)).toBeNull();
    expect(answerOrderFromMetadata(['AGENTS_FIRST'])).toBeNull();
  });

  it('places a new agent at 0, or 1000 when buyers go first', () => {
    expect(agentPriorityFor('AGENTS_FIRST')).toBe(0);
    expect(agentPriorityFor('TOGETHER')).toBe(0);
    expect(agentPriorityFor('BUYERS_FIRST')).toBe(1000);
  });

  it('validates the value', () => {
    expect(isAnswerOrder('AGENTS_FIRST')).toBe(true);
    expect(isAnswerOrder('agents_first')).toBe(false);
    expect(isAnswerOrder(undefined)).toBe(false);
  });
});
