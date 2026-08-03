/**
 * The lead reservation state machine.
 *
 * These are the rules that replace `updateLeadStatus(lead.id, 'DIALING')`. The
 * one that matters most is the last group: an expired reservation that may
 * correspond to a live call must never go back into the dialable pool.
 */

import { describe, expect, it } from 'vitest';

import {
  AttemptOutcome,
  isLegalTransition,
  isRetryable,
  isTerminal,
  provesHumanContact,
  recoveryTargetFor,
  ReservationState,
} from '../lead-reservation.js';

const ALL_STATES = Object.values(ReservationState);
const ALL_OUTCOMES = Object.values(AttemptOutcome);

describe('the legal transitions', () => {
  it('lets a fresh reservation submit, release, or complete', () => {
    expect(
      isLegalTransition(ReservationState.RESERVED, ReservationState.ORIGINATION_SUBMITTED)
    ).toBe(true);
    // Pre-origination failure: nothing was built, so nothing rang.
    expect(isLegalTransition(ReservationState.RESERVED, ReservationState.RELEASED)).toBe(true);
    expect(isLegalTransition(ReservationState.RESERVED, ReservationState.COMPLETED)).toBe(true);
  });

  it('does not let a fresh reservation skip straight to accepted', () => {
    // "Submitted" and "accepted" are different facts. Collapsing them is what
    // makes the crash window unrecoverable.
    expect(
      isLegalTransition(ReservationState.RESERVED, ReservationState.ORIGINATION_ACCEPTED)
    ).toBe(false);
  });

  it('never lets a submitted reservation be simply released', () => {
    // THE rule. Once a command may have reached FreeSWITCH, "release it back to
    // the pool" is not an available answer, because the pool means redial.
    expect(
      isLegalTransition(ReservationState.ORIGINATION_SUBMITTED, ReservationState.RELEASED)
    ).toBe(false);
    expect(
      isLegalTransition(ReservationState.ORIGINATION_ACCEPTED, ReservationState.RELEASED)
    ).toBe(false);
  });

  it('lets an in-flight reservation complete or go to reconciliation', () => {
    for (const from of [
      ReservationState.ORIGINATION_SUBMITTED,
      ReservationState.ORIGINATION_ACCEPTED,
    ]) {
      expect(isLegalTransition(from, ReservationState.COMPLETED)).toBe(true);
      expect(isLegalTransition(from, ReservationState.NEEDS_RECONCILIATION)).toBe(true);
    }
  });

  it('treats completed and released as final', () => {
    for (const terminal of [ReservationState.COMPLETED, ReservationState.RELEASED]) {
      expect(isTerminal(terminal)).toBe(true);
      for (const to of ALL_STATES) {
        expect(isLegalTransition(terminal, to)).toBe(false);
      }
    }
  });

  it('lets reconciliation resolve only to completed', () => {
    // A reconciler with channel evidence closes it out. Nothing sends it back
    // to the pool, because by then a call may have happened.
    expect(
      isLegalTransition(ReservationState.NEEDS_RECONCILIATION, ReservationState.COMPLETED)
    ).toBe(true);
    expect(
      isLegalTransition(ReservationState.NEEDS_RECONCILIATION, ReservationState.RELEASED)
    ).toBe(false);
    expect(
      isLegalTransition(ReservationState.NEEDS_RECONCILIATION, ReservationState.RESERVED)
    ).toBe(false);
  });

  it('never permits a transition back into RESERVED', () => {
    // Re-reserving is a new reservation with a new token, not a rewind.
    for (const from of ALL_STATES) {
      expect(isLegalTransition(from, ReservationState.RESERVED)).toBe(false);
    }
  });
});

describe('crash recovery targets', () => {
  it('frees a reservation that never built a command', () => {
    // Nothing rang, so nothing is at risk.
    expect(recoveryTargetFor(ReservationState.RESERVED)).toBe(ReservationState.RELEASED);
  });

  it('holds anything that may already be a call', () => {
    // The hardest case in the whole design: the process died after FreeSWITCH
    // accepted but before the acceptance was recorded. Freeing this would dial
    // a person who is, at that moment, listening to their phone ring.
    expect(recoveryTargetFor(ReservationState.ORIGINATION_SUBMITTED)).toBe(
      ReservationState.NEEDS_RECONCILIATION
    );
    expect(recoveryTargetFor(ReservationState.ORIGINATION_ACCEPTED)).toBe(
      ReservationState.NEEDS_RECONCILIATION
    );
  });

  it('has nothing to recover from a resolved or already-held reservation', () => {
    expect(recoveryTargetFor(ReservationState.COMPLETED)).toBeNull();
    expect(recoveryTargetFor(ReservationState.RELEASED)).toBeNull();
    // Idempotence: a second reaper finds this and does nothing.
    expect(recoveryTargetFor(ReservationState.NEEDS_RECONCILIATION)).toBeNull();
  });

  it('never recovers anything into a state that redials', () => {
    for (const state of ALL_STATES) {
      const target = recoveryTargetFor(state);
      if (target === null) continue;
      // The only way a lead returns to the pool is RELEASED, and only from
      // RESERVED. Assert that, rather than assuming it.
      if (target === ReservationState.RELEASED) {
        expect(state).toBe(ReservationState.RESERVED);
      }
    }
  });
});

describe('outcomes decide whether a lead comes back', () => {
  it('retries the transient ones', () => {
    for (const outcome of [
      AttemptOutcome.NO_ANSWER,
      AttemptOutcome.BUSY,
      AttemptOutcome.TEMPORARY_TECHNICAL_FAILURE,
      AttemptOutcome.NOT_ATTEMPTED,
    ]) {
      expect(isRetryable(outcome)).toBe(true);
    }
  });

  it('never retries a permanent one', () => {
    for (const outcome of [
      AttemptOutcome.DO_NOT_CALL,
      AttemptOutcome.INVALID_DESTINATION,
      AttemptOutcome.REJECTED,
      AttemptOutcome.CAMPAIGN_STOPPED,
      AttemptOutcome.TENANT_DISABLED,
      AttemptOutcome.ANSWERED_BY_HUMAN,
    ]) {
      expect(isRetryable(outcome)).toBe(false);
    }
  });

  it('decides every outcome explicitly', () => {
    // A new member added without a decision would otherwise silently pick one,
    // and both mistakes are bad: retrying a do-not-call is a compliance breach,
    // retiring a busy signal quietly discards a lead somebody paid for.
    for (const outcome of ALL_OUTCOMES) {
      expect(typeof isRetryable(outcome)).toBe('boolean');
    }
  });

  it('treats an unattempted lead as retryable', () => {
    // The origination interlock being off must not consume the lead. This is
    // what lets the reservation lifecycle be exercised with calls disabled.
    expect(isRetryable(AttemptOutcome.NOT_ATTEMPTED)).toBe(true);
  });
});

describe('CONTACTED means a human was reached', () => {
  it('is proved by an answer and by nothing else', () => {
    expect(provesHumanContact(AttemptOutcome.ANSWERED_BY_HUMAN)).toBe(true);
    for (const outcome of ALL_OUTCOMES.filter(o => o !== AttemptOutcome.ANSWERED_BY_HUMAN)) {
      expect(provesHumanContact(outcome)).toBe(false);
    }
  });

  it('is not implied by a call having been attempted', () => {
    // The old worker set CONTACTED before the command was even sent, and
    // `autodialer.ts` still would. A dial attempt is not a conversation.
    expect(provesHumanContact(AttemptOutcome.NOT_ATTEMPTED)).toBe(false);
    expect(provesHumanContact(AttemptOutcome.NO_ANSWER)).toBe(false);
    expect(provesHumanContact(AttemptOutcome.BUSY)).toBe(false);
  });
});
