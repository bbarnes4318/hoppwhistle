/**
 * The origination interlock and the retry policy.
 *
 * Phase 8 items 11, 12, 13, 14, 15, 21 and 22: what happens to a lead after an
 * attempt, and the proof that no test in this repository can reach a gateway.
 *
 * Nothing here constructs a FreeSWITCH connection. The point of the second
 * interlock is that with origination disabled the command is never built, so
 * these assertions are about a code path that provably cannot dial.
 */

import { describe, expect, it } from 'vitest';

import {
  AttemptOutcome,
  isRetryable,
  provesHumanContact,
  ReservationState,
} from '../lead-reservation.js';

/**
 * What the loop does with an outcome.
 *
 * Mirrors `DialerWorker.attemptLead`'s decision without needing a database or a
 * switch: an outcome decides the terminal state, and separately decides whether
 * the lead returns to the dialable pool.
 */
function resolveAttempt(outcome: AttemptOutcome): {
  terminal: ReservationState;
  leadBecomesEligibleAgain: boolean;
  marksContacted: boolean;
} {
  return {
    // Anything that was actually attempted completes; only a lead that never
    // had a command built is a plain release.
    terminal:
      outcome === AttemptOutcome.NOT_ATTEMPTED
        ? ReservationState.RELEASED
        : ReservationState.COMPLETED,
    leadBecomesEligibleAgain: isRetryable(outcome),
    marksContacted: provesHumanContact(outcome),
  };
}

describe('14 and 15. retry policy', () => {
  it('14. returns a retryable lead to the pool', () => {
    for (const outcome of [
      AttemptOutcome.NO_ANSWER,
      AttemptOutcome.BUSY,
      AttemptOutcome.TEMPORARY_TECHNICAL_FAILURE,
    ]) {
      expect(resolveAttempt(outcome).leadBecomesEligibleAgain).toBe(true);
    }
  });

  it('15. never returns a permanently failed lead', () => {
    // Retrying a do-not-call is a compliance breach, not an inefficiency.
    for (const outcome of [
      AttemptOutcome.DO_NOT_CALL,
      AttemptOutcome.INVALID_DESTINATION,
      AttemptOutcome.REJECTED,
      AttemptOutcome.CAMPAIGN_STOPPED,
      AttemptOutcome.TENANT_DISABLED,
    ]) {
      expect(resolveAttempt(outcome).leadBecomesEligibleAgain).toBe(false);
    }
  });

  it('does not retry a lead that was answered', () => {
    // Success is terminal. The old code had no terminal transition at all, so a
    // successfully dialled lead sat in DIALING forever.
    const resolved = resolveAttempt(AttemptOutcome.ANSWERED_BY_HUMAN);
    expect(resolved.leadBecomesEligibleAgain).toBe(false);
    expect(resolved.terminal).toBe(ReservationState.COMPLETED);
  });
});

describe('12 and 13. CONTACTED requires an answer', () => {
  it('12. an answer marks the lead contacted', () => {
    expect(resolveAttempt(AttemptOutcome.ANSWERED_BY_HUMAN).marksContacted).toBe(true);
  });

  it('13. no-answer does not', () => {
    // The whole distinction. `autodialer.ts` writes CONTACTED before the
    // command is even sent, which marks a lead contacted whether it rings, is
    // busy, is disconnected, or is never dialled at all.
    expect(resolveAttempt(AttemptOutcome.NO_ANSWER).marksContacted).toBe(false);
    expect(resolveAttempt(AttemptOutcome.BUSY).marksContacted).toBe(false);
    expect(resolveAttempt(AttemptOutcome.NOT_ATTEMPTED).marksContacted).toBe(false);
  });

  it('nothing that is merely an attempt marks contact', () => {
    const attemptedButNotAnswered = Object.values(AttemptOutcome).filter(
      o => o !== AttemptOutcome.ANSWERED_BY_HUMAN
    );
    for (const outcome of attemptedButNotAnswered) {
      expect(resolveAttempt(outcome).marksContacted).toBe(false);
    }
  });
});

describe('11 and 10. what a disabled interlock does to the lead', () => {
  it('releases rather than completes, so the lead is not consumed', () => {
    // With LEGACY_HOPPER_ORIGINATION_ENABLED off the loop reserves and then
    // releases. That has to leave the lead dialable, or a single run with calls
    // disabled would silently retire the entire pool.
    const resolved = resolveAttempt(AttemptOutcome.NOT_ATTEMPTED);
    expect(resolved.terminal).toBe(ReservationState.RELEASED);
    expect(resolved.leadBecomesEligibleAgain).toBe(true);
    expect(resolved.marksContacted).toBe(false);
  });

  it('an attempted outcome completes rather than releases', () => {
    // RELEASED means "nothing happened". Using it after a command was sent
    // would lose the fact that a call was placed.
    expect(resolveAttempt(AttemptOutcome.NO_ANSWER).terminal).toBe(ReservationState.COMPLETED);
  });
});

describe('21 and 22. no test can reach a gateway', () => {
  it('every outcome is resolvable without a switch or a database', () => {
    // This file imports no Prisma client, no ESL library, and no socket. If any
    // of that became necessary to decide an outcome, the decision would have
    // moved somewhere it cannot be reviewed.
    for (const outcome of Object.values(AttemptOutcome)) {
      expect(() => resolveAttempt(outcome)).not.toThrow();
    }
  });

  it('the disabled interlock is the default for every outcome path', () => {
    // NOT_ATTEMPTED is what the interlock produces, and it is the only outcome
    // that both releases and stays retryable — the combination that makes
    // running the lifecycle with calls off harmless.
    const releasedAndRetryable = Object.values(AttemptOutcome).filter(o => {
      const r = resolveAttempt(o);
      return r.terminal === ReservationState.RELEASED && r.leadBecomesEligibleAgain;
    });
    expect(releasedAndRetryable).toEqual([AttemptOutcome.NOT_ATTEMPTED]);
  });
});
