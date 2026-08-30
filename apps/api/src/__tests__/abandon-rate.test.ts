import { describe, it, expect } from 'vitest';

import { deriveTerminationParty, normalizeHangupCause } from '../lib/hangup-cause.js';
import { computeAbandonRate } from '../services/abandon-rate.js';
import type { AbandonRateCallDelegate } from '../services/abandon-rate.js';

/**
 * No database. The count delegate is faked so the tests can assert on the exact
 * `where` clauses — the definition of an abandon lives in those clauses, and a
 * test that cannot see them cannot prove the metric is not just
 * `1 - answerRate` with extra steps.
 */

interface Recorded {
  where: Record<string, unknown>;
}

/**
 * Answers each `count` by looking at the where clause it was given, rather than
 * by call order. If the implementation swapped the two queries the fake would
 * still answer correctly, so a passing test means the clauses are right — not
 * that they happen to be issued in the expected sequence.
 */
function fakeCalls(opts: { classified: number; abandoned: number }) {
  const recorded: Recorded[] = [];
  const delegate = {
    count: (args: { where: Record<string, unknown> }) => {
      recorded.push({ where: args.where });
      const party = args.where.terminationParty;
      if (party === 'CALLER') return Promise.resolve(opts.abandoned);
      return Promise.resolve(opts.classified);
    },
  };
  /*
   * Cast to the delegate type, not to `any`: the generated `count` signature is
   * generic and overloaded, so a structural fake cannot satisfy it directly,
   * but going through `unknown` keeps every call site in this file typed. An
   * `any` here would silently swallow a signature change in computeAbandonRate.
   */
  return { calls: delegate as unknown as AbandonRateCallDelegate, recorded };
}

const WHERE = { tenantId: 't1', createdAt: { gte: new Date('2026-08-30T12:00:00Z') } };

describe('computeAbandonRate', () => {
  it('is caller-hung-up-before-answer over total offered', async () => {
    const { calls } = fakeCalls({ classified: 100, abandoned: 7 });
    const result = await computeAbandonRate({ calls, where: WHERE, offered: 100 });
    expect(result.rate).toBe(0.07);
    expect(result.unavailable).toBeUndefined();
  });

  it('is NOT 1 minus the answer rate', async () => {
    /*
     * 100 offered, 40 answered => answer rate 0.4, so `1 - answerRate` would be
     * 0.6. Only 7 of the 60 unanswered were the caller giving up; the other 53
     * were busy, rejected or ring-timeout. Those are the buyer's problem, not an
     * abandon, and the two numbers must not agree.
     */
    const { calls } = fakeCalls({ classified: 100, abandoned: 7 });
    const result = await computeAbandonRate({ calls, where: WHERE, offered: 100 });
    expect(result.rate).toBe(0.07);
    expect(result.rate).not.toBe(0.6);
  });

  it('counts only calls that were never answered', async () => {
    const { calls, recorded } = fakeCalls({ classified: 10, abandoned: 1 });
    await computeAbandonRate({ calls, where: WHERE, offered: 10 });

    const numerator = recorded.find(r => r.where.terminationParty === 'CALLER');
    expect(numerator).toBeDefined();
    // A caller who hangs up after a two-minute conversation is not an abandon.
    expect(numerator?.where.answeredAt).toBeNull();
  });

  it('carries the caller-supplied scope into both queries', async () => {
    const scoped = { ...WHERE, publisherId: 'pub_1' };
    const { calls, recorded } = fakeCalls({ classified: 10, abandoned: 2 });
    await computeAbandonRate({ calls, where: scoped, offered: 10 });

    expect(recorded).toHaveLength(2);
    for (const r of recorded) {
      expect(r.where.tenantId).toBe('t1');
      expect(r.where.publisherId).toBe('pub_1');
      expect(r.where.createdAt).toEqual(scoped.createdAt);
    }
  });

  it('returns null, not 0, when no call in the window records a party', async () => {
    const { calls } = fakeCalls({ classified: 0, abandoned: 0 });
    const result = await computeAbandonRate({ calls, where: WHERE, offered: 250 });
    expect(result.rate).toBeNull();
    expect(result.unavailable).toMatch(/records who hung up/);
  });

  it('returns a real 0 once calls are instrumented and none abandoned', async () => {
    const { calls } = fakeCalls({ classified: 40, abandoned: 0 });
    const result = await computeAbandonRate({ calls, where: WHERE, offered: 40 });
    expect(result.rate).toBe(0);
    expect(result.unavailable).toBeUndefined();
  });

  it('returns null with no queries at all when nothing was offered', async () => {
    const { calls, recorded } = fakeCalls({ classified: 0, abandoned: 0 });
    const result = await computeAbandonRate({ calls, where: WHERE, offered: 0 });
    expect(result.rate).toBeNull();
    expect(result.unavailable).toMatch(/No calls offered/);
    expect(recorded).toHaveLength(0);
  });

  it('uses total offered as the denominator, not the instrumented subset', async () => {
    /*
     * Mid-deploy: 30 of 100 calls came from an upgraded FreeSWITCH, 6 of those
     * were abandons. Over the instrumented subset that reads 20%, which would
     * show as a spike and then decay as the deploy completes. Over total
     * offered it reads 6% and rises toward the truth.
     */
    const { calls } = fakeCalls({ classified: 30, abandoned: 6 });
    const result = await computeAbandonRate({ calls, where: WHERE, offered: 100 });
    expect(result.rate).toBe(0.06);
  });
});

describe('deriveTerminationParty', () => {
  it('maps a caller cancelling before answer to CALLER', () => {
    // This one case is the entire abandon numerator.
    expect(deriveTerminationParty('ORIGINATOR_CANCEL')).toBe('CALLER');
  });

  it.each([
    ['USER_BUSY'],
    ['NO_ANSWER'],
    ['NO_USER_RESPONSE'],
    ['CALL_REJECTED'],
    ['UNALLOCATED_NUMBER'],
  ])('does not count %s as the caller', cause => {
    expect(deriveTerminationParty(cause)).toBe('CALLEE');
  });

  it.each([['NETWORK_OUT_OF_ORDER'], ['RECOVERY_ON_TIMER_EXPIRE'], ['MANAGER_REQUEST']])(
    'attributes %s to the system',
    cause => {
      expect(deriveTerminationParty(cause)).toBe('SYSTEM');
    }
  );

  it('resolves NORMAL_CLEARING from the SIP disposition', () => {
    // recv_bye on the inbound leg: the caller sent the BYE.
    expect(deriveTerminationParty('NORMAL_CLEARING', 'recv_bye')).toBe('CALLER');
    // send_bye: we sent it, because the buyer leg went away first.
    expect(deriveTerminationParty('NORMAL_CLEARING', 'send_bye')).toBe('CALLEE');
    expect(deriveTerminationParty('NORMAL_CLEARING', 'recv_cancel')).toBe('CALLER');
  });

  it('records UNKNOWN for NORMAL_CLEARING with no disposition', () => {
    // A FreeSWITCH that has not picked up the Lua change yet. Guessing CALLER
    // here would invent abandons out of every completed call.
    expect(deriveTerminationParty('NORMAL_CLEARING')).toBe('UNKNOWN');
    expect(deriveTerminationParty('NORMAL_CLEARING', '')).toBe('UNKNOWN');
  });

  it('records UNKNOWN rather than guessing at an unmapped cause', () => {
    expect(deriveTerminationParty('SOME_FUTURE_CAUSE')).toBe('UNKNOWN');
    expect(deriveTerminationParty('')).toBe('UNKNOWN');
    expect(deriveTerminationParty(null)).toBe('UNKNOWN');
    expect(deriveTerminationParty(undefined)).toBe('UNKNOWN');
  });

  it('is insensitive to the case and padding FreeSWITCH sends', () => {
    expect(deriveTerminationParty(' originator_cancel ')).toBe('CALLER');
    expect(deriveTerminationParty('normal_clearing', ' RECV_BYE ')).toBe('CALLER');
  });
});

describe('normalizeHangupCause', () => {
  it('stores the cause verbatim, only normalising case and padding', () => {
    expect(normalizeHangupCause(' originator_cancel ')).toBe('ORIGINATOR_CANCEL');
    // An unmapped cause is still worth storing — it is how we learn the mapping
    // is incomplete.
    expect(normalizeHangupCause('SOME_FUTURE_CAUSE')).toBe('SOME_FUTURE_CAUSE');
  });

  it('stores nothing rather than a placeholder when told nothing', () => {
    expect(normalizeHangupCause('')).toBeNull();
    expect(normalizeHangupCause('   ')).toBeNull();
    expect(normalizeHangupCause(null)).toBeNull();
    expect(normalizeHangupCause(undefined)).toBeNull();
  });
});
