/**
 * The classification contract.
 *
 * Everything here is a literal in, a verdict out. That is the point of keeping
 * the contract pure: the rules that decide whether a possibly-live call may be
 * redialed are checkable without a database, a socket, or a clock.
 */

import { describe, expect, it } from 'vitest';

import { AttemptOutcome, ReservationState } from '../lead-reservation.js';
import {
  classifyEvidence,
  dispositionFor,
  EvidenceSource,
  LedgerClaim,
  ReconciliationOutcome,
  RELEASING_OUTCOMES,
  restsOnPositiveEvidence,
  type AttemptEvidence,
  type ChannelSighting,
  type ClassificationPolicy,
  type LedgerRecord,
} from '../reconciliation-contract.js';

const POLICY: ClassificationPolicy = { maxAttempts: 3, maxEvidenceAgeMs: 60_000 };

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

function evidence(overrides: Partial<AttemptEvidence> = {}): AttemptEvidence {
  return {
    attemptId: 'attempt-1',
    reservationFound: true,
    reservationAgeMs: 1_000,
    priorAttempts: 0,
    sourcesChecked: [EvidenceSource.RESERVATION, EvidenceSource.LIVE_CHANNELS],
    sourcesUnavailable: [],
    liveChannels: [],
    ledger: [],
    observedAtMs: 1_700_000_000_000,
    ...overrides,
  };
}

function sighting(uuid: string): ChannelSighting {
  return { channelUuid: uuid, attemptId: 'attempt-1', observedAtMs: 500, answerState: 'ACTIVE' };
}

function ledger(claim: LedgerClaim, uuid: string | null = UUID_A): LedgerRecord {
  return {
    claim,
    channelUuid: uuid,
    occurredAtMs: 400,
    hangupCause: claim === LedgerClaim.CHANNEL_TERMINATED ? 'NORMAL_CLEARING' : null,
    provesHumanContact: false,
  };
}

describe('the central rule: absence is never proof', () => {
  it('never releases when nothing was found', () => {
    // The single most important assertion in this file. Every source consulted,
    // every source answering, nothing found — and the lead stays held.
    const result = classifyEvidence(evidence(), POLICY);
    expect(RELEASING_OUTCOMES).not.toContain(result.outcome);
    expect(dispositionFor(result.outcome).transitionTo).toBeNull();
  });

  it('never releases when a source could not be reached', () => {
    const result = classifyEvidence(
      evidence({ sourcesUnavailable: [EvidenceSource.LIVE_CHANNELS] }),
      POLICY
    );
    expect(result.outcome).toBe(ReconciliationOutcome.FREESWITCH_UNREACHABLE);
    expect(dispositionFor(result.outcome).transitionTo).toBeNull();
  });

  it('never releases once the retry budget is spent', () => {
    const result = classifyEvidence(evidence({ priorAttempts: 5 }), POLICY);
    expect(result.outcome).toBe(ReconciliationOutcome.MANUAL_REVIEW_REQUIRED);
    expect(dispositionFor(result.outcome).transitionTo).toBeNull();
    expect(dispositionFor(result.outcome).requiresManualReview).toBe(true);
  });

  it('every releasing outcome rests on a positive claim', () => {
    // The invariant that keeps the two lists honest. A future outcome cannot be
    // added to RELEASING_OUTCOMES without someone deciding what proves it.
    for (const outcome of RELEASING_OUTCOMES) {
      expect(restsOnPositiveEvidence(outcome)).toBe(true);
    }
    for (const outcome of Object.values(ReconciliationOutcome)) {
      if (!restsOnPositiveEvidence(outcome)) {
        expect(dispositionFor(outcome).transitionTo).toBeNull();
      }
    }
  });
});

describe('active call confirmed', () => {
  it('is produced by exactly one live channel', () => {
    const result = classifyEvidence(evidence({ liveChannels: [sighting(UUID_A)] }), POLICY);
    expect(result.outcome).toBe(ReconciliationOutcome.ACTIVE_CALL_CONFIRMED);
    expect(result.channelUuid).toBe(UUID_A);
    expect(result.evidenceAtMs).toBe(500);
  });

  it('keeps the reservation and extends the lease', () => {
    const d = dispositionFor(ReconciliationOutcome.ACTIVE_CALL_CONFIRMED);
    expect(d.transitionTo).toBeNull();
    expect(d.extendLease).toBe(true);
    expect(d.reschedule).toBe(true);
    expect(d.requiresManualReview).toBe(false);
  });

  it('outranks a terminal ledger record by producing a conflict, not a release', () => {
    // A switch saying "up" and a ledger saying "ended" cannot both be right.
    const result = classifyEvidence(
      evidence({
        liveChannels: [sighting(UUID_A)],
        ledger: [ledger(LedgerClaim.CHANNEL_TERMINATED)],
      }),
      POLICY
    );
    expect(result.outcome).toBe(ReconciliationOutcome.EVIDENCE_CONFLICT);
  });
});

describe('terminal verdicts require a positive ledger claim', () => {
  it('completes on a termination record', () => {
    const result = classifyEvidence(
      evidence({
        sourcesChecked: [EvidenceSource.RESERVATION, EvidenceSource.LIVE_CHANNELS, EvidenceSource.EVENT_LEDGER],
        ledger: [ledger(LedgerClaim.CHANNEL_TERMINATED)],
      }),
      POLICY
    );
    expect(result.outcome).toBe(ReconciliationOutcome.COMPLETED_CALL_CONFIRMED);
    expect(result.reason).toContain('NORMAL_CLEARING');
  });

  it('a completed call is NOT a contact', () => {
    // A hangup proves a channel ended and nothing about who was on it.
    const d = dispositionFor(ReconciliationOutcome.COMPLETED_CALL_CONFIRMED);
    expect(d.transitionTo).toBe(ReservationState.COMPLETED);
    expect(d.attemptOutcome).not.toBe(AttemptOutcome.ANSWERED_BY_HUMAN);
  });

  it('records a rejection without marking the lead contacted', () => {
    const result = classifyEvidence(
      evidence({ ledger: [ledger(LedgerClaim.ORIGINATION_REJECTED, null)] }),
      POLICY
    );
    expect(result.outcome).toBe(ReconciliationOutcome.ORIGINATION_REJECTED_CONFIRMED);
    const d = dispositionFor(result.outcome);
    expect(d.attemptOutcome).toBe(AttemptOutcome.REJECTED);
    expect(d.transitionTo).toBe(ReservationState.COMPLETED);
  });

  it('confirms no channel ONLY from a positive record of absence', () => {
    const fromRecord = classifyEvidence(
      evidence({ ledger: [ledger(LedgerClaim.NO_CHANNEL_CREATED, null)] }),
      POLICY
    );
    expect(fromRecord.outcome).toBe(ReconciliationOutcome.NO_CHANNEL_CONFIRMED);
    expect(dispositionFor(fromRecord.outcome).attemptOutcome).toBe(AttemptOutcome.NOT_ATTEMPTED);

    // The same situation without the record — an empty ledger — is not it.
    const fromEmptiness = classifyEvidence(
      evidence({
        sourcesChecked: [EvidenceSource.RESERVATION, EvidenceSource.LIVE_CHANNELS, EvidenceSource.EVENT_LEDGER],
        ledger: [],
      }),
      POLICY
    );
    expect(fromEmptiness.outcome).not.toBe(ReconciliationOutcome.NO_CHANNEL_CONFIRMED);
  });

  it('refuses a terminal verdict while the switch is unreachable', () => {
    // The ledger might describe one of two channels, and the second cannot be
    // ruled out with the switch down.
    const result = classifyEvidence(
      evidence({
        sourcesUnavailable: [EvidenceSource.LIVE_CHANNELS],
        ledger: [ledger(LedgerClaim.CHANNEL_TERMINATED)],
      }),
      POLICY
    );
    expect(result.outcome).toBe(ReconciliationOutcome.FREESWITCH_UNREACHABLE);
  });
});

describe('conflict fails closed', () => {
  const cases: Array<[string, Partial<AttemptEvidence>]> = [
    ['two live channels', { liveChannels: [sighting(UUID_A), sighting(UUID_B)] }],
    [
      'two ledger channels',
      {
        ledger: [
          ledger(LedgerClaim.CHANNEL_PROGRESSED, UUID_A),
          ledger(LedgerClaim.CHANNEL_PROGRESSED, UUID_B),
        ],
      },
    ],
    [
      'live and never-created',
      { liveChannels: [sighting(UUID_A)], ledger: [ledger(LedgerClaim.NO_CHANNEL_CREATED, null)] },
    ],
    [
      'never-created and terminated',
      {
        ledger: [
          ledger(LedgerClaim.NO_CHANNEL_CREATED, null),
          ledger(LedgerClaim.CHANNEL_TERMINATED, UUID_A),
        ],
      },
    ],
    [
      'two terminations',
      {
        ledger: [
          { ...ledger(LedgerClaim.CHANNEL_TERMINATED, UUID_A) },
          { ...ledger(LedgerClaim.CHANNEL_TERMINATED, UUID_A), occurredAtMs: 900 },
        ],
      },
    ],
    [
      'live uuid differs from ledger uuid',
      { liveChannels: [sighting(UUID_A)], ledger: [ledger(LedgerClaim.CHANNEL_PROGRESSED, UUID_B)] },
    ],
  ];

  for (const [name, overrides] of cases) {
    it(`${name} enters manual review`, () => {
      const result = classifyEvidence(evidence(overrides), POLICY);
      expect(result.outcome).toBe(ReconciliationOutcome.EVIDENCE_CONFLICT);
      const d = dispositionFor(result.outcome);
      expect(d.requiresManualReview).toBe(true);
      expect(d.transitionTo).toBeNull();
      expect(d.reschedule).toBe(false);
    });
  }

  it('names no channel when several conflict', () => {
    // Naming one would present a guess as the subject of the record an operator
    // then reads and acts on.
    const result = classifyEvidence(
      evidence({ liveChannels: [sighting(UUID_A), sighting(UUID_B)] }),
      POLICY
    );
    expect(result.channelUuid).toBeNull();
  });
});

describe('pending, expiry and escalation', () => {
  it('stays pending while budget remains', () => {
    const result = classifyEvidence(evidence({ priorAttempts: 0 }), POLICY);
    expect(result.outcome).toBe(ReconciliationOutcome.EVIDENCE_PENDING);
    expect(dispositionFor(result.outcome).reschedule).toBe(true);
  });

  it('escalates on the last permitted attempt, not after it', () => {
    // maxAttempts of 3 means runs 1 and 2 are pending and run 3 escalates.
    expect(classifyEvidence(evidence({ priorAttempts: 1 }), POLICY).outcome).toBe(
      ReconciliationOutcome.EVIDENCE_PENDING
    );
    expect(classifyEvidence(evidence({ priorAttempts: 2 }), POLICY).outcome).toBe(
      ReconciliationOutcome.MANUAL_REVIEW_REQUIRED
    );
  });

  it('expires before it exhausts the budget when the reservation is old', () => {
    const result = classifyEvidence(
      evidence({ reservationAgeMs: POLICY.maxEvidenceAgeMs + 1, priorAttempts: 0 }),
      POLICY
    );
    expect(result.outcome).toBe(ReconciliationOutcome.EVIDENCE_EXPIRED);
    expect(dispositionFor(result.outcome).requiresManualReview).toBe(true);
    expect(result.reason).toContain('unresolved, not resolved');
  });

  it('reports a missing reservation rather than inventing one', () => {
    const result = classifyEvidence(evidence({ reservationFound: false }), POLICY);
    expect(result.outcome).toBe(ReconciliationOutcome.ATTEMPT_NOT_FOUND);
    const d = dispositionFor(result.outcome);
    expect(d.transitionTo).toBeNull();
    expect(d.reschedule).toBe(false);
    expect(d.requiresManualReview).toBe(false);
  });
});

describe('the reason string is safe to persist', () => {
  it('never echoes the attempt id or a channel variable value', () => {
    const result = classifyEvidence(
      evidence({ attemptId: 'SUPER-SECRET-CORRELATION' }),
      POLICY
    );
    expect(result.reason).not.toContain('SUPER-SECRET-CORRELATION');
  });

  it('every outcome has a disposition', () => {
    for (const outcome of Object.values(ReconciliationOutcome)) {
      expect(() => dispositionFor(outcome)).not.toThrow();
    }
  });
});
