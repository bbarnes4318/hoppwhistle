/**
 * What may be concluded about an attempt whose reservation reached
 * `NEEDS_RECONCILIATION`, and what may be done about it.
 *
 * Pure. No database, no socket, no clock read — `observedAtMs` is an argument.
 * Every branch is therefore reachable from a test with a literal.
 *
 * ── The rule the whole module is built around ────────────────────────────────
 *
 * **Absence of evidence is not proof that no call exists.** A query returning
 * zero rows, a Redis miss, an empty live-channel list and a timeout are all the
 * same fact — *we did not find anything* — and none of them is the fact the
 * caller needs, which is *nothing is there*. Releasing a reservation on any of
 * them dials a person who may at that moment be listening to their phone ring.
 *
 * So no negative result releases anything. `NO_CHANNEL_CONFIRMED` exists, and is
 * reachable only from a ledger record that positively asserts no channel was
 * created — never from an empty query. `docs/dialer-v2/ORIGINATION_EVIDENCE_TRACE.md`
 * establishes that a live FreeSWITCH cannot produce that assertion even in
 * principle: its channel list describes what exists now, so a completed call and
 * a call that never happened are indistinguishable once the channel is gone.
 *
 * ── Why the classification order is what it is ───────────────────────────────
 *
 * Conflict beats confirmation, and unreachability beats every terminal verdict.
 * If the live-channel source failed we cannot rule out an active call, so we must
 * not act on a terminal ledger record that might describe only one of two
 * channels. That is the difference between "the ledger says this attempt ended"
 * and "this attempt ended".
 */

import { AttemptOutcome, ReservationState } from './lead-reservation.js';

/** What the evidence supports. Deliberately more than "found" and "not found". */
export enum ReconciliationOutcome {
  /** A channel carrying this attempt id exists right now. Positive proof. */
  ACTIVE_CALL_CONFIRMED = 'ACTIVE_CALL_CONFIRMED',
  /** A durable record proves a channel existed and reached a terminal state. */
  COMPLETED_CALL_CONFIRMED = 'COMPLETED_CALL_CONFIRMED',
  /** A durable record proves FreeSWITCH refused the command before any channel. */
  ORIGINATION_REJECTED_CONFIRMED = 'ORIGINATION_REJECTED_CONFIRMED',
  /**
   * A durable record positively asserts no channel was ever created.
   *
   * NOT produced by an empty result, a timeout, or a missing key. See the module
   * comment: nothing in this repository can currently assert this, so the
   * classifier cannot reach it from real data today. It is declared, tested and
   * kept honest rather than quietly conflated with "we found nothing".
   */
  NO_CHANNEL_CONFIRMED = 'NO_CHANNEL_CONFIRMED',
  /** Ingestion lag or transaction timing may explain the silence. Look again. */
  EVIDENCE_PENDING = 'EVIDENCE_PENDING',
  /** Sources disagree, or two channels claim one attempt. Fails closed. */
  EVIDENCE_CONFLICT = 'EVIDENCE_CONFLICT',
  /** Old enough that no source could still hold the answer. */
  EVIDENCE_EXPIRED = 'EVIDENCE_EXPIRED',
  /** The switch could not be asked. Never a release. */
  FREESWITCH_UNREACHABLE = 'FREESWITCH_UNREACHABLE',
  /** The reservation itself is gone. Nothing to reconcile. */
  ATTEMPT_NOT_FOUND = 'ATTEMPT_NOT_FOUND',
  /** Automatic resolution is not safe. An operator decides. */
  MANUAL_REVIEW_REQUIRED = 'MANUAL_REVIEW_REQUIRED',
}

/** Which evidence source produced, or failed to produce, a fact. */
export enum EvidenceSource {
  /** The `lead_dial_reservations` row itself. */
  RESERVATION = 'RESERVATION',
  /** A durable, attempt-indexed telephony event ledger. Not yet implemented. */
  EVENT_LEDGER = 'EVENT_LEDGER',
  /** The live channel list, via the read-only FreeSWITCH port. */
  LIVE_CHANNELS = 'LIVE_CHANNELS',
  /** Channel variables for a specific uuid, via the read-only port. */
  CHANNEL_VARIABLES = 'CHANNEL_VARIABLES',
}

/** A channel the switch reports as existing now. */
export interface ChannelSighting {
  channelUuid: string;
  attemptId: string;
  /** Source clock where available, our clock otherwise. */
  observedAtMs: number;
  /** FreeSWITCH `Answer-State`, when the query returned one. */
  answerState: string | null;
}

/** What a durable ledger record asserts. Each is a positive claim. */
export enum LedgerClaim {
  /** A channel existed and reached a terminal state. */
  CHANNEL_TERMINATED = 'CHANNEL_TERMINATED',
  /** The switch refused the command; no channel was created. */
  ORIGINATION_REJECTED = 'ORIGINATION_REJECTED',
  /** Positively recorded absence. The only route to NO_CHANNEL_CONFIRMED. */
  NO_CHANNEL_CREATED = 'NO_CHANNEL_CREATED',
  /** A channel existed and had not yet terminated when this was written. */
  CHANNEL_PROGRESSED = 'CHANNEL_PROGRESSED',
}

export interface LedgerRecord {
  claim: LedgerClaim;
  /** Null for claims that assert no channel. */
  channelUuid: string | null;
  occurredAtMs: number;
  /** FreeSWITCH hangup cause, when the claim is CHANNEL_TERMINATED. */
  hangupCause: string | null;
  /**
   * Whether this record carries evidence a human was reached. Supplied by the
   * ledger, never inferred here — see `contact-evidence.ts` for the rule that
   * decides it, and note that a reconciler may not manufacture it.
   */
  provesHumanContact: boolean;
}

/**
 * Everything gathered for one attempt in one reconciliation run.
 *
 * `sourcesChecked` and `sourcesUnavailable` are separate on purpose: a source
 * that returned nothing and a source that could not be reached lead to different
 * verdicts, and collapsing them is exactly the mistake this module exists to
 * prevent.
 */
export interface AttemptEvidence {
  attemptId: string;
  reservationFound: boolean;
  /** How long the reservation has been outstanding. Drives expiry. */
  reservationAgeMs: number;
  /** How many automatic reconciliation runs have already been spent. */
  priorAttempts: number;
  sourcesChecked: readonly EvidenceSource[];
  sourcesUnavailable: readonly EvidenceSource[];
  liveChannels: readonly ChannelSighting[];
  ledger: readonly LedgerRecord[];
  observedAtMs: number;
}

export interface ClassificationPolicy {
  /** Automatic runs allowed before the verdict becomes manual review. */
  maxAttempts: number;
  /** Past this age nothing could still hold the answer. */
  maxEvidenceAgeMs: number;
}

export interface Classification {
  outcome: ReconciliationOutcome;
  /** Sanitized. Names sources and counts, never a driver error or a credential. */
  reason: string;
  /** The channel this verdict is about, when exactly one is implicated. */
  channelUuid: string | null;
  /** Evidence timestamp the verdict rests on, when there is one. */
  evidenceAtMs: number | null;
}

/** What the caller may do with a verdict. */
export interface OutcomeDisposition {
  /** Reservation state to move to, or null to leave the reservation active. */
  transitionTo: ReservationState | null;
  attemptOutcome: AttemptOutcome | null;
  /** Schedule another bounded automatic run. */
  reschedule: boolean;
  /** Park it for an operator. Non-dialable until explicitly resolved. */
  requiresManualReview: boolean;
  /** A live call was proven; hold the reservation and take reconciliation ownership. */
  extendLease: boolean;
}

function distinct(values: readonly (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => typeof v === 'string' && v.length > 0))];
}

/**
 * Classify gathered evidence.
 *
 * Order is the safety argument, not a style choice:
 *
 *   1. No reservation — nothing to decide.
 *   2. Conflict — disagreement must never be resolved by picking a side.
 *   3. A live channel — positive, and the only outcome that keeps a call safe
 *      from a redial, so it outranks everything that could release.
 *   4. The switch could not be asked — an unreachable switch cannot rule out a
 *      live call, so no terminal verdict may be drawn past this point even if
 *      the ledger looks decisive. It might describe one of two channels.
 *   5..7. Positive ledger claims, in decreasing strength.
 *   8. Too old to learn anything.
 *   9. Retry budget remains.
 *  10. Otherwise a human decides.
 */
export function classifyEvidence(
  evidence: AttemptEvidence,
  policy: ClassificationPolicy
): Classification {
  if (!evidence.reservationFound) {
    return {
      outcome: ReconciliationOutcome.ATTEMPT_NOT_FOUND,
      reason: 'no reservation exists for this attempt id',
      channelUuid: null,
      evidenceAtMs: null,
    };
  }

  const liveUuids = distinct(evidence.liveChannels.map(c => c.channelUuid));
  const ledgerUuids = distinct(evidence.ledger.map(r => r.channelUuid));
  const terminated = evidence.ledger.filter(r => r.claim === LedgerClaim.CHANNEL_TERMINATED);
  const rejected = evidence.ledger.filter(r => r.claim === LedgerClaim.ORIGINATION_REJECTED);
  const neverCreated = evidence.ledger.filter(r => r.claim === LedgerClaim.NO_CHANNEL_CREATED);

  // ── 2. Conflict ─────────────────────────────────────────────────────────────
  const conflict = detectConflict({ liveUuids, ledgerUuids, terminated, rejected, neverCreated });
  if (conflict) {
    return {
      outcome: ReconciliationOutcome.EVIDENCE_CONFLICT,
      reason: conflict,
      // Deliberately null. Naming one of several conflicting channels would
      // present a guess as the subject of the record an operator then reads.
      channelUuid: null,
      evidenceAtMs: evidence.observedAtMs,
    };
  }

  // ── 3. A live channel ───────────────────────────────────────────────────────
  if (liveUuids.length === 1) {
    const sighting = evidence.liveChannels[0];
    return {
      outcome: ReconciliationOutcome.ACTIVE_CALL_CONFIRMED,
      reason: 'the switch reports one live channel carrying this attempt id',
      channelUuid: sighting.channelUuid,
      evidenceAtMs: sighting.observedAtMs,
    };
  }

  // ── 4. The switch could not be asked ────────────────────────────────────────
  if (evidence.sourcesUnavailable.includes(EvidenceSource.LIVE_CHANNELS)) {
    return {
      outcome: ReconciliationOutcome.FREESWITCH_UNREACHABLE,
      reason:
        'the live-channel source was unavailable; an active call cannot be ruled out, ' +
        'so no terminal verdict may be drawn from the remaining sources',
      channelUuid: null,
      evidenceAtMs: null,
    };
  }

  // ── 5. A channel existed and ended ──────────────────────────────────────────
  if (terminated.length === 1) {
    const record = terminated[0];
    return {
      outcome: ReconciliationOutcome.COMPLETED_CALL_CONFIRMED,
      reason: `the ledger records this attempt's channel terminating${
        record.hangupCause ? ` with cause ${record.hangupCause}` : ''
      }`,
      channelUuid: record.channelUuid,
      evidenceAtMs: record.occurredAtMs,
    };
  }

  // ── 6. The command was refused ──────────────────────────────────────────────
  if (rejected.length >= 1) {
    return {
      outcome: ReconciliationOutcome.ORIGINATION_REJECTED_CONFIRMED,
      reason: 'the ledger records the switch refusing the origination command',
      channelUuid: null,
      evidenceAtMs: rejected[0].occurredAtMs,
    };
  }

  // ── 7. Recorded absence ─────────────────────────────────────────────────────
  if (neverCreated.length >= 1) {
    return {
      outcome: ReconciliationOutcome.NO_CHANNEL_CONFIRMED,
      reason: 'the ledger positively records that no channel was created',
      channelUuid: null,
      evidenceAtMs: neverCreated[0].occurredAtMs,
    };
  }

  // Everything below here is an ABSENCE. None of it may release the lead.

  // ── 8. Too old for any source to still hold the answer ──────────────────────
  if (evidence.reservationAgeMs > policy.maxEvidenceAgeMs) {
    return {
      outcome: ReconciliationOutcome.EVIDENCE_EXPIRED,
      reason:
        `the reservation is older than the ${policy.maxEvidenceAgeMs} ms evidence window ` +
        'and no source produced a positive claim; this is unresolved, not resolved',
      channelUuid: null,
      evidenceAtMs: null,
    };
  }

  // ── 9. Budget remains ───────────────────────────────────────────────────────
  if (evidence.priorAttempts + 1 < policy.maxAttempts) {
    return {
      outcome: ReconciliationOutcome.EVIDENCE_PENDING,
      reason:
        `no positive claim from ${evidence.sourcesChecked.length} source(s) after ` +
        `${evidence.priorAttempts + 1} of ${policy.maxAttempts} attempts; ` +
        'ingestion lag may still explain it',
      channelUuid: null,
      evidenceAtMs: null,
    };
  }

  // ── 10. A human decides ─────────────────────────────────────────────────────
  return {
    outcome: ReconciliationOutcome.MANUAL_REVIEW_REQUIRED,
    reason:
      `${policy.maxAttempts} automatic attempts produced no positive claim about this ` +
      'attempt; absence of evidence is not proof no call was placed',
    channelUuid: null,
    evidenceAtMs: null,
  };
}

function detectConflict(input: {
  liveUuids: readonly string[];
  ledgerUuids: readonly string[];
  terminated: readonly LedgerRecord[];
  rejected: readonly LedgerRecord[];
  neverCreated: readonly LedgerRecord[];
}): string | null {
  if (input.liveUuids.length > 1) {
    return `${input.liveUuids.length} live channels claim this attempt id`;
  }
  if (input.ledgerUuids.length > 1) {
    return `${input.ledgerUuids.length} channel uuids appear in the ledger for this attempt id`;
  }
  if (input.liveUuids.length === 1 && input.terminated.length > 0) {
    // The switch says it is up; the ledger says it ended. One of them is wrong
    // and choosing either could strand a live call or double-dial a lead.
    return 'the switch reports a live channel while the ledger records termination';
  }
  if (input.liveUuids.length === 1 && input.neverCreated.length > 0) {
    return 'the switch reports a live channel while the ledger records that none was created';
  }
  if (input.neverCreated.length > 0 && (input.terminated.length > 0 || input.rejected.length > 0)) {
    return 'the ledger both records no channel was created and records channel activity';
  }
  if (input.terminated.length > 1) {
    return `${input.terminated.length} termination records exist for this attempt id`;
  }
  if (
    input.liveUuids.length === 1 &&
    input.ledgerUuids.length === 1 &&
    input.liveUuids[0] !== input.ledgerUuids[0]
  ) {
    return 'the live channel and the ledger channel have different uuids';
  }
  return null;
}

/**
 * What may be done about a verdict.
 *
 * Only three outcomes end a reservation, and each requires a positive claim.
 * Everything else either holds the reservation for another look or hands it to a
 * person — and holding is what keeps the lead out of the dialable pool, because
 * `NEEDS_RECONCILIATION` has `releasedAt IS NULL` and the partial unique index
 * makes the lead unreservable while that is true.
 */
export function dispositionFor(outcome: ReconciliationOutcome): OutcomeDisposition {
  switch (outcome) {
    case ReconciliationOutcome.ACTIVE_CALL_CONFIRMED:
      return {
        transitionTo: null,
        attemptOutcome: null,
        reschedule: true,
        requiresManualReview: false,
        // A live call will end; look again after it plausibly has, rather than
        // leaving the reservation to expire underneath a call in progress.
        extendLease: true,
      };

    case ReconciliationOutcome.COMPLETED_CALL_CONFIRMED:
      return {
        transitionTo: ReservationState.COMPLETED,
        // NOT ANSWERED_BY_HUMAN. A hangup proves a channel ended and nothing
        // about who, if anyone, was on it. The disposition upgrade happens only
        // through `contact-evidence.ts`, and only from an answer plus a bridge.
        attemptOutcome: AttemptOutcome.NO_ANSWER,
        reschedule: false,
        requiresManualReview: false,
        extendLease: false,
      };

    case ReconciliationOutcome.ORIGINATION_REJECTED_CONFIRMED:
      return {
        transitionTo: ReservationState.COMPLETED,
        // Rejected before a channel: the campaign retry policy decides what
        // happens to the lead, and `isRetryable(REJECTED)` is false.
        attemptOutcome: AttemptOutcome.REJECTED,
        reschedule: false,
        requiresManualReview: false,
        extendLease: false,
      };

    case ReconciliationOutcome.NO_CHANNEL_CONFIRMED:
      return {
        transitionTo: ReservationState.COMPLETED,
        // Nothing rang, so the lead is genuinely untouched and retryable.
        attemptOutcome: AttemptOutcome.NOT_ATTEMPTED,
        reschedule: false,
        requiresManualReview: false,
        extendLease: false,
      };

    case ReconciliationOutcome.EVIDENCE_PENDING:
      return {
        transitionTo: null,
        attemptOutcome: null,
        reschedule: true,
        requiresManualReview: false,
        extendLease: false,
      };

    case ReconciliationOutcome.FREESWITCH_UNREACHABLE:
      return {
        transitionTo: null,
        attemptOutcome: null,
        // A dependency failure is transient by assumption; retry, bounded, and
        // escalate at the same threshold as everything else.
        reschedule: true,
        requiresManualReview: false,
        extendLease: false,
      };

    case ReconciliationOutcome.EVIDENCE_CONFLICT:
    case ReconciliationOutcome.EVIDENCE_EXPIRED:
    case ReconciliationOutcome.MANUAL_REVIEW_REQUIRED:
      return {
        transitionTo: null,
        attemptOutcome: null,
        reschedule: false,
        requiresManualReview: true,
        extendLease: false,
      };

    case ReconciliationOutcome.ATTEMPT_NOT_FOUND:
      return {
        transitionTo: null,
        attemptOutcome: null,
        reschedule: false,
        requiresManualReview: false,
        extendLease: false,
      };
  }
}

/** Outcomes that end a reservation. Exported so tests can assert the set exactly. */
export const RELEASING_OUTCOMES: readonly ReconciliationOutcome[] = Object.freeze([
  ReconciliationOutcome.COMPLETED_CALL_CONFIRMED,
  ReconciliationOutcome.ORIGINATION_REJECTED_CONFIRMED,
  ReconciliationOutcome.NO_CHANNEL_CONFIRMED,
]);

/**
 * Whether an outcome rests on a positive claim rather than on an absence.
 *
 * The invariant every releasing outcome must satisfy. Asserted in tests against
 * `RELEASING_OUTCOMES` so a future outcome cannot be made releasing without
 * someone also deciding what positively proves it.
 */
export function restsOnPositiveEvidence(outcome: ReconciliationOutcome): boolean {
  switch (outcome) {
    case ReconciliationOutcome.ACTIVE_CALL_CONFIRMED:
    case ReconciliationOutcome.COMPLETED_CALL_CONFIRMED:
    case ReconciliationOutcome.ORIGINATION_REJECTED_CONFIRMED:
    case ReconciliationOutcome.NO_CHANNEL_CONFIRMED:
      return true;
    case ReconciliationOutcome.EVIDENCE_PENDING:
    case ReconciliationOutcome.EVIDENCE_CONFLICT:
    case ReconciliationOutcome.EVIDENCE_EXPIRED:
    case ReconciliationOutcome.FREESWITCH_UNREACHABLE:
    case ReconciliationOutcome.ATTEMPT_NOT_FOUND:
    case ReconciliationOutcome.MANUAL_REVIEW_REQUIRED:
      return false;
  }
}
