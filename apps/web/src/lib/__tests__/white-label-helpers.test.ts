import { describe, expect, it } from 'vitest';

import { agentLiveStatus } from '../agent-status';
import { ANSWER_ORDERS, answerOrderOf } from '../answer-order';

describe('agentLiveStatus', () => {
  it.each([
    ['available', 'READY'],
    ['READY', 'READY'],
    ['Available', 'READY'],
    ['busy', 'ON_CALL'],
    ['ON_CALL', 'ON_CALL'],
    ['away', 'AWAY'],
    ['AWAY', 'AWAY'],
    ['offline', 'OFFLINE'],
    ['ringing', 'OFFLINE'],
    ['', 'OFFLINE'],
    [null, 'OFFLINE'],
    [undefined, 'OFFLINE'],
  ] as const)('reads %s as %s', (raw, want) => {
    expect(agentLiveStatus(raw)).toBe(want);
  });

  it("an 'on-call' agent counts as on a call", () => {
    // What the softphone writes today, beside the older spelling.
    expect(agentLiveStatus('on-call')).toBe('ON_CALL');
    expect(agentLiveStatus('on_call')).toBe('ON_CALL');
  });

  it('reads do-not-disturb as away', () => {
    expect(agentLiveStatus('dnd')).toBe('AWAY');
  });
});

describe('answer order', () => {
  it('offers the three orders, in the words asked for', () => {
    expect(ANSWER_ORDERS.map(order => [order.value, order.label])).toEqual([
      ['AGENTS_FIRST', 'Your agents first, then buyers'],
      ['BUYERS_FIRST', 'Buyers first, then your agents'],
      ['TOGETHER', 'Your agents and buyers at the same time'],
    ]);
  });

  it('reads the order off campaign metadata, and nothing else', () => {
    expect(answerOrderOf({ answerOrder: 'BUYERS_FIRST' })).toBe('BUYERS_FIRST');
    expect(answerOrderOf({ answerOrder: 'SOMETIMES' })).toBeNull();
    expect(answerOrderOf({})).toBeNull();
    expect(answerOrderOf(null)).toBeNull();
    expect(answerOrderOf('AGENTS_FIRST')).toBeNull();
  });
});
