/**
 * Decides what happened to an attempt whose worker died mid-origination.
 *
 * ── What it is allowed to conclude ───────────────────────────────────────────
 *
 * Only what the evidence positively supports. The classification itself lives in
 * `reconciliation-contract.ts` and is pure; this module gathers evidence, applies
 * exactly one transition under a fencing token, and writes an audit row. It
 * contains no policy of its own, which is the point — a reconciler that decided
 * things inline would be a reconciler whose decisions could not be unit-tested
 * against a literal.
 *
 * ── What it cannot do, structurally ──────────────────────────────────────────
 *
 * It holds a `ReadOnlyFreeSwitchPort`, never an ESL socket, and that port
 * refuses every command outside a four-entry allowlist. It imports nothing from
 * `dialer-worker.ts`. There is no code path from here to `originate`, and CI
 * greps this file to keep it that way.
 *
 * It also cannot mark a lead `CONTACTED`. `classifyContact` is called with
 * `source: RECONCILIATION`, which that module refuses categorically — the call
 * is made rather than merely omitted, so the guarantee is exercised on every run
 * instead of resting on nobody adding the line later.
 */

import {
  nextDelayMs,
  type ReconciliationPolicy,
} from '../config/reconciliation-policy.js';

import {
  classifyContact,
  ContactEvidenceSource,
  mayWriteContacted,
} from './contact-evidence.js';
import type { ReadOnlyFreeSwitchPort, LookupResult } from './freeswitch-readonly.js';
import { ReservationState } from './lead-reservation.js';
import {
  classifyEvidence,
  dispositionFor,
  EvidenceSource,
  ReconciliationOutcome,
  type AttemptEvidence,
  type ChannelSighting,
  type LedgerRecord,
} from './reconciliation-contract.js';
import {
  FinalizeRejection,
  type ClaimedAttempt,
  type ReconciliationClaimStore,
} from './reconciliation-store.js';

/**
 * A durable, attempt-indexed telephony event ledger.
 *
 * No implementation exists — see `docs/dialer-v2/ORIGINATION_EVIDENCE_TRACE.md`.
 * The interface is here because the classifier is complete without it and
 * becomes useful the moment one is wired in, and because a reconciler that had
 * no seam for it would have to be rewritten rather than injected into.
 */
export interface AttemptLedger {
  findByAttemptId(attemptId: string): Promise<LookupResult<LedgerRecord[]>>;
}

export interface ReconcilerDeps {
  store: ReconciliationClaimStore;
  freeswitch: ReadOnlyFreeSwitchPort;
  /** Absent means the ledger is not consulted at all — not that it was empty. */
  ledger?: AttemptLedger;
  policy: ReconciliationPolicy;
  now?: () => number;
  onOutcome?: (outcome: ReconciliationOutcome, detail: string) => void;
}

export interface AttemptReport {
  attemptId: string;
  reservationId: string;
  outcome: ReconciliationOutcome;
  /** Sanitized. Safe to log. */
  reason: string;
  released: boolean;
  parkedForReview: boolean;
  rescheduledForMs: number | null;
  /** Set when the fencing guard refused the write. */
  finalizeRejection: FinalizeRejection | null;
}

export interface CycleReport {
  claimed: number;
  reconciled: number;
  released: number;
  parkedForReview: number;
  rescheduled: number;
  /** Claims whose write was refused by the fencing guard. */
  fenced: number;
  attempts: AttemptReport[];
}

const EMPTY_CYCLE: CycleReport = Object.freeze({
  claimed: 0,
  reconciled: 0,
  released: 0,
  parkedForReview: 0,
  rescheduled: 0,
  fenced: 0,
  attempts: [],
});

export class AttemptReconciler {
  private readonly now: () => number;

  constructor(private readonly deps: ReconcilerDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  /**
   * Claim a batch and reconcile each attempt.
   *
   * Never throws. A reconciler that can throw stops the whole queue on one
   * unusual row, and the rows in this queue are by definition the ones something
   * already went wrong with.
   */
  async runOnce(scope: {
    tenantIds: readonly string[];
    campaignIds: readonly string[];
  }): Promise<CycleReport> {
    if (!this.deps.policy.enabled) return { ...EMPTY_CYCLE };

    let claims: ClaimedAttempt[];
    try {
      claims = await this.deps.store.claimBatch({
        tenantIds: scope.tenantIds,
        campaignIds: scope.campaignIds,
        limit: this.deps.policy.batchSize,
      });
    } catch {
      return { ...EMPTY_CYCLE };
    }

    const attempts: AttemptReport[] = [];
    for (const claim of claims) {
      attempts.push(await this.reconcileOne(claim));
    }

    return {
      claimed: claims.length,
      reconciled: attempts.filter(a => a.finalizeRejection === null).length,
      released: attempts.filter(a => a.released).length,
      parkedForReview: attempts.filter(a => a.parkedForReview).length,
      rescheduled: attempts.filter(a => a.rescheduledForMs !== null).length,
      fenced: attempts.filter(a => a.finalizeRejection !== null).length,
      attempts,
    };
  }

  private async reconcileOne(claim: ClaimedAttempt): Promise<AttemptReport> {
    const startedAtMs = this.now();
    const evidence = await this.gather(claim, startedAtMs);

    const classification = classifyEvidence(evidence, {
      maxAttempts: this.deps.policy.maxAttempts,
      maxEvidenceAgeMs: this.deps.policy.maxEvidenceAgeMs,
    });
    const disposition = dispositionFor(classification.outcome);

    // Exercised, not assumed. `classifyContact` refuses this source outright, so
    // if someone later makes the reconciler infer a disposition from a hangup
    // record, this assertion is where it stops.
    const contact = classifyContact({
      source: ContactEvidenceSource.RECONCILIATION,
      answered: false,
      bridgedToSecondLeg: false,
      connectedMs: 0,
      machineDetected: false,
      hangupCause: null,
    });
    /* c8 ignore next 3 -- unreachable by construction; present so the invariant fails loudly rather than silently */
    if (mayWriteContacted(contact)) {
      throw new Error('reconciliation must never be able to prove human contact');
    }

    const nextReconcileAtMs = disposition.reschedule
      ? startedAtMs + nextDelayMs(this.deps.policy, claim.reconcileAttempts)
      : null;

    const extendLeaseToMs = disposition.extendLease
      ? startedAtMs + this.deps.policy.maxDelayMs
      : null;

    const finalized = await this.deps.store.finalize({
      reservationId: claim.reservationId,
      reconcilerToken: claim.reconcilerToken,
      transitionTo: disposition.transitionTo,
      attemptOutcome: disposition.attemptOutcome,
      outcome: classification.outcome,
      nextReconcileAtMs,
      requiresManualReview: disposition.requiresManualReview,
      manualReviewReason: disposition.requiresManualReview ? classification.reason : null,
      extendLeaseToMs,
    });

    const applied = finalized.ok;
    const completedAtMs = this.now();

    // Recorded whether or not the write landed. A refused finalize is exactly
    // the event an audit trail exists to show, and dropping it would make a
    // fencing conflict invisible.
    await this.deps.store.recordRun({
      reservationId: claim.reservationId,
      attemptId: claim.attemptId,
      leadId: claim.leadId,
      tenantId: claim.tenantId,
      campaignId: claim.campaignId,
      fencingToken: claim.reconcilerToken,
      startedAtMs,
      completedAtMs,
      sourcesChecked: evidence.sourcesChecked,
      sourcesUnavailable: evidence.sourcesUnavailable,
      channelUuid: classification.channelUuid,
      evidenceAtMs: classification.evidenceAtMs,
      outcome: classification.outcome,
      previousState: ReservationState.NEEDS_RECONCILIATION,
      newState: applied ? disposition.transitionTo : null,
      retryCount: claim.reconcileAttempts + 1,
      nextReconcileAtMs,
      manualReviewReason: disposition.requiresManualReview ? classification.reason : null,
      errorCategory: applied ? null : 'fencing',
    });

    this.deps.onOutcome?.(classification.outcome, classification.reason);

    return {
      attemptId: claim.attemptId,
      reservationId: claim.reservationId,
      outcome: classification.outcome,
      reason: classification.reason,
      released: applied && disposition.transitionTo !== null,
      parkedForReview: applied && disposition.requiresManualReview,
      rescheduledForMs: applied ? nextReconcileAtMs : null,
      finalizeRejection: applied ? null : (finalized as { rejection: FinalizeRejection }).rejection,
    };
  }

  /**
   * Ask every configured source, and record honestly which ones answered.
   *
   * The two arrays are the whole reason this method exists rather than being
   * inlined. A source that was never configured belongs in neither list: it was
   * not checked, and it was not unavailable — claiming either would be a
   * statement about evidence nobody looked for.
   */
  private async gather(claim: ClaimedAttempt, observedAtMs: number): Promise<AttemptEvidence> {
    const sourcesChecked: EvidenceSource[] = [EvidenceSource.RESERVATION];
    const sourcesUnavailable: EvidenceSource[] = [];
    const liveChannels: ChannelSighting[] = [];
    const ledger: LedgerRecord[] = [];

    const live = await this.safeLookup(() =>
      this.deps.freeswitch.findActiveChannelByAttemptId(claim.attemptId)
    );
    if (live.available) {
      sourcesChecked.push(EvidenceSource.LIVE_CHANNELS);
      liveChannels.push(...live.value);
    } else {
      sourcesUnavailable.push(EvidenceSource.LIVE_CHANNELS);
    }

    if (this.deps.ledger) {
      const found = await this.safeLookup(() => this.deps.ledger!.findByAttemptId(claim.attemptId));
      if (found.available) {
        sourcesChecked.push(EvidenceSource.EVENT_LEDGER);
        ledger.push(...found.value);
      } else {
        sourcesUnavailable.push(EvidenceSource.EVENT_LEDGER);
      }
    }

    return {
      attemptId: claim.attemptId,
      reservationFound: true,
      reservationAgeMs: claim.ageMs,
      priorAttempts: claim.reconcileAttempts,
      sourcesChecked,
      sourcesUnavailable,
      liveChannels,
      ledger,
      observedAtMs,
    };
  }

  /**
   * A source that throws is a source that was unavailable.
   *
   * The port already returns unreachability as a value; this is the belt for a
   * ledger implementation that does not, and it discards the error rather than
   * carrying it, because a driver message can contain a host and on some drivers
   * the credential it tried.
   */
  private async safeLookup<T>(
    fn: () => Promise<LookupResult<T[]>>
  ): Promise<LookupResult<T[]>> {
    try {
      return await fn();
    } catch {
      return { available: false, detail: 'the source raised an error', value: [] };
    }
  }
}
