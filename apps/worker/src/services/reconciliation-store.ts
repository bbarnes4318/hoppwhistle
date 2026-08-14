/**
 * The SQL behind attempt reconciliation.
 *
 * Same discipline as `lead-reservation-store.ts`: every claim and every
 * finalization is one statement, because the correctness is in the predicate and
 * a read-then-write through an ORM is not the same thing however it is spelled.
 *
 * ── Why the reconciler gets its own lease and its own token ──────────────────
 *
 * A reservation in `NEEDS_RECONCILIATION` got there because the worker holding
 * it died. Its dialing lease has expired and its dialing token was rotated by
 * the reaper. Reusing either for reconciliation would mean a resurrected worker
 * and a reconciler are fenced against each other by a token neither of them
 * minted for this purpose. So the reconciler mints its own, per row, and the
 * finalize guard checks the token, the owner, and that the lease has not expired.
 * The lease check is what actually revokes: a reconciler that hung past its
 * lease cannot finalize even holding a token nobody else has taken.
 *
 * Requires PostgreSQL 13 or later for the built-in `gen_random_uuid()`. CI runs
 * 15, and `cardinality`, `FOR UPDATE SKIP LOCKED` and partial unique indexes are
 * already load-bearing elsewhere in this schema.
 */

import {
  AttemptOutcome,
  isLegalTransition,
  isTerminal,
  ReservationState,
} from './lead-reservation.js';
import type { EvidenceSource, ReconciliationOutcome } from './reconciliation-contract.js';

/** The narrow database surface this store needs. */
export interface ReconciliationDb {
  $queryRawUnsafe<T = unknown>(sql: string, ...values: unknown[]): Promise<T>;
}

export interface ReconciliationStoreOptions {
  db: ReconciliationDb;
  /** Identifies this reconciler replica. Written into every claim it takes. */
  ownerId: string;
  /** How long a claim is valid before another reconciler may take it. */
  leaseMs: number;
  now?: () => number;
  newId?: () => string;
}

/** A reservation this reconciler now holds. */
export interface ClaimedAttempt {
  reservationId: string;
  attemptId: string;
  leadId: string;
  tenantId: string;
  campaignId: string;
  state: ReservationState;
  /** The reconciler's fencing token for this claim. */
  reconcilerToken: string;
  reconcileAttempts: number;
  reservedAtMs: number;
  /** Age at claim time. Feeds `AttemptEvidence.reservationAgeMs`. */
  ageMs: number;
}

interface ClaimRow {
  id: string;
  attemptId: string;
  leadId: string;
  tenantId: string;
  campaignId: string;
  state: ReservationState;
  reconcilerToken: string;
  reconcileAttempts: number;
  reservedAt: Date;
}

export enum FinalizeRejection {
  /** The reservation is gone, or was never claimed by this reconciler. */
  NOT_CLAIMED = 'NOT_CLAIMED',
  /** The claim lease expired, or another reconciler took it. */
  STALE_CLAIM = 'STALE_CLAIM',
  /** The requested move is not legal from `NEEDS_RECONCILIATION`. */
  ILLEGAL_TRANSITION = 'ILLEGAL_TRANSITION',
  STORE_UNAVAILABLE = 'STORE_UNAVAILABLE',
}

export type FinalizeResult = { ok: true } | { ok: false; rejection: FinalizeRejection };

/** What one completed run asserts. Written append-only, never updated. */
export interface RunRecord {
  reservationId: string;
  attemptId: string;
  leadId: string;
  tenantId: string;
  campaignId: string;
  fencingToken: string;
  startedAtMs: number;
  completedAtMs: number;
  sourcesChecked: readonly EvidenceSource[];
  sourcesUnavailable: readonly EvidenceSource[];
  channelUuid: string | null;
  evidenceAtMs: number | null;
  outcome: ReconciliationOutcome;
  previousState: ReservationState;
  newState: ReservationState | null;
  retryCount: number;
  nextReconcileAtMs: number | null;
  manualReviewReason: string | null;
  /** A category such as "transport". Never a driver message. */
  errorCategory: string | null;
}

/** What finalizing a run does to the reservation. */
export interface FinalizeInput {
  reservationId: string;
  reconcilerToken: string;
  /** Null leaves the reservation active in `NEEDS_RECONCILIATION`. */
  transitionTo: ReservationState | null;
  attemptOutcome: AttemptOutcome | null;
  outcome: ReconciliationOutcome;
  /** When the next automatic run may claim it. Null means never automatically. */
  nextReconcileAtMs: number | null;
  requiresManualReview: boolean;
  manualReviewReason: string | null;
  /** Push the dialing lease out because a live call was proven. */
  extendLeaseToMs: number | null;
}

/**
 * What the reconciler depends on.
 *
 * An interface rather than the class, so a test can supply a fake. The class has
 * private members, and TypeScript's structural compatibility excludes anything
 * with private fields — depending on the class directly would force every test
 * to reach a real database, which is the opposite of what a unit test of the
 * decision logic should need.
 */
export interface ReconciliationClaimStore {
  claimBatch(input: {
    tenantIds: readonly string[];
    campaignIds: readonly string[];
    limit: number;
  }): Promise<ClaimedAttempt[]>;
  finalize(input: FinalizeInput): Promise<FinalizeResult>;
  recordRun(record: RunRecord): Promise<{ ok: boolean }>;
}

export class ReconciliationStore implements ReconciliationClaimStore {
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(private readonly options: ReconciliationStoreOptions) {
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? (() => globalThis.crypto.randomUUID());
  }

  /**
   * Claim reservations awaiting reconciliation.
   *
   * One statement, and safe to run from several reconcilers at once:
   * `FOR UPDATE SKIP LOCKED` means a second reconciler steps over rows the first
   * is already claiming rather than blocking on them, and the predicate re-checks
   * that the row is still unclaimed at write time.
   *
   * Each row gets its OWN token from `gen_random_uuid()`. A batch-wide token
   * would let a reconciler that lost half a batch still finalize the other half
   * with a token another reconciler could not distinguish from a fresh one.
   *
   * `manualReviewRequired = false` is part of the predicate, not a filter after
   * the fact: an attempt parked for a person must be invisible to the automatic
   * queue, or the reconciler will keep re-deciding something a human owns.
   */
  async claimBatch(input: {
    tenantIds: readonly string[];
    campaignIds: readonly string[];
    limit: number;
  }): Promise<ClaimedAttempt[]> {
    const nowMs = this.now();
    const now = new Date(nowMs);
    const leaseExpiresAt = new Date(nowMs + this.options.leaseMs);

    const rows = await this.options.db.$queryRawUnsafe<ClaimRow[]>(
      `
      UPDATE "lead_dial_reservations"
      SET "reconcilerOwnerId" = $1,
          "reconcilerToken" = gen_random_uuid()::text,
          "reconcilerLeaseExpiresAt" = $2,
          "updatedAt" = $3
      WHERE "id" IN (
        SELECT "id" FROM "lead_dial_reservations"
        WHERE "state" = 'NEEDS_RECONCILIATION'::"LeadDialReservationState"
          AND "releasedAt" IS NULL
          AND "manualReviewRequired" = false
          AND ("reconcileNotBefore" IS NULL OR "reconcileNotBefore" <= $3)
          AND ("reconcilerLeaseExpiresAt" IS NULL OR "reconcilerLeaseExpiresAt" < $3)
          AND (cardinality($4::text[]) = 0 OR "tenantId" = ANY($4::text[]))
          AND (cardinality($5::text[]) = 0 OR "campaignId" = ANY($5::text[]))
        ORDER BY "reconcileNotBefore" ASC NULLS FIRST, "reservedAt" ASC
        LIMIT $6
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "attemptId", "leadId", "tenantId", "campaignId", "state",
                "reconcilerToken", "reconcileAttempts", "reservedAt"
      `,
      this.options.ownerId,
      leaseExpiresAt,
      now,
      [...input.tenantIds],
      [...input.campaignIds],
      input.limit
    );

    return rows.map(row => ({
      reservationId: row.id,
      attemptId: row.attemptId,
      leadId: row.leadId,
      tenantId: row.tenantId,
      campaignId: row.campaignId,
      state: row.state,
      reconcilerToken: row.reconcilerToken,
      reconcileAttempts: row.reconcileAttempts,
      reservedAtMs: new Date(row.reservedAt).getTime(),
      ageMs: Math.max(0, nowMs - new Date(row.reservedAt).getTime()),
    }));
  }

  /**
   * Apply one classification, atomically, under the fencing token.
   *
   * The guard has four parts and each removes a distinct way to get this wrong:
   *
   *   `reconcilerToken = $token`  — somebody else re-claimed it.
   *   `reconcilerOwnerId = $owner`— a different replica holds it.
   *   `reconcilerLeaseExpiresAt > now` — this reconciler hung past its lease and
   *                                 no longer speaks for the row, token or not.
   *   `releasedAt IS NULL`        — it is already terminal; releasing twice is
   *                                 refused rather than silently repeated.
   *
   * The claim is cleared in the same statement, which is what makes a repeated
   * call idempotent: the second one matches zero rows and reports a stale claim
   * instead of incrementing the retry count a second time.
   */
  async finalize(input: FinalizeInput): Promise<FinalizeResult> {
    if (input.transitionTo !== null) {
      // Checked here as well as in the predicate. The database enforces that the
      // row is still `NEEDS_RECONCILIATION`; this enforces that the move itself
      // is one the domain permits, so an illegal target is rejected with the
      // right reason rather than as a mysterious zero-row update.
      if (!isLegalTransition(ReservationState.NEEDS_RECONCILIATION, input.transitionTo)) {
        return { ok: false, rejection: FinalizeRejection.ILLEGAL_TRANSITION };
      }
    }

    const nowMs = this.now();
    const now = new Date(nowMs);
    const releasing = input.transitionTo !== null && isTerminal(input.transitionTo);

    try {
      const rows = await this.options.db.$queryRawUnsafe<Array<{ id: string }>>(
        `
        UPDATE "lead_dial_reservations"
        SET "state" = COALESCE($1::"LeadDialReservationState", "state"),
            "outcome" = COALESCE($2, "outcome"),
            "releasedAt" = CASE WHEN $3 THEN $4 ELSE "releasedAt" END,
            "leaseExpiresAt" = COALESCE($5, "leaseExpiresAt"),
            "reconcileAttempts" = "reconcileAttempts" + 1,
            "reconcileNotBefore" = $6,
            "manualReviewRequired" = $7,
            "manualReviewReason" = CASE WHEN $7 THEN $8 ELSE "manualReviewReason" END,
            "lastReconciliationOutcome" = $9,
            "reconcilerOwnerId" = NULL,
            "reconcilerToken" = NULL,
            "reconcilerLeaseExpiresAt" = NULL,
            "updatedAt" = $4
        WHERE "id" = $10
          AND "reconcilerToken" = $11
          AND "reconcilerOwnerId" = $12
          AND "reconcilerLeaseExpiresAt" > $4
          AND "releasedAt" IS NULL
          AND "state" = 'NEEDS_RECONCILIATION'::"LeadDialReservationState"
        RETURNING "id"
        `,
        input.transitionTo,
        input.attemptOutcome,
        releasing,
        now,
        input.extendLeaseToMs === null ? null : new Date(input.extendLeaseToMs),
        input.nextReconcileAtMs === null ? null : new Date(input.nextReconcileAtMs),
        input.requiresManualReview,
        input.manualReviewReason,
        input.outcome,
        input.reservationId,
        input.reconcilerToken,
        this.options.ownerId
      );

      if (rows.length === 0) return { ok: false, rejection: FinalizeRejection.STALE_CLAIM };
      return { ok: true };
    } catch {
      return { ok: false, rejection: FinalizeRejection.STORE_UNAVAILABLE };
    }
  }

  /**
   * Append one decision to the audit log.
   *
   * Deliberately never fails the run: an audit write that could abort the
   * reconciliation would turn a logging outage into a stuck queue. The caller is
   * told, and the run itself is already durable in the reservation's own
   * `lastReconciliationOutcome` and `reconcileAttempts`.
   */
  async recordRun(record: RunRecord): Promise<{ ok: boolean }> {
    try {
      await this.options.db.$queryRawUnsafe(
        `
        INSERT INTO "attempt_reconciliation_runs" (
          "id", "reservationId", "attemptId", "leadId", "tenantId", "campaignId",
          "reconcilerOwnerId", "fencingToken", "startedAt", "completedAt",
          "sourcesChecked", "sourcesUnavailable", "channelUuid", "evidenceAt",
          "outcome", "previousState", "newState", "retryCount", "nextReconcileAt",
          "manualReviewReason", "errorCategory", "createdAt"
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10,
          $11::text[], $12::text[], $13, $14,
          $15, $16::"LeadDialReservationState", $17::"LeadDialReservationState", $18, $19,
          $20, $21, $10
        )
        `,
        this.newId(),
        record.reservationId,
        record.attemptId,
        record.leadId,
        record.tenantId,
        record.campaignId,
        this.options.ownerId,
        record.fencingToken,
        new Date(record.startedAtMs),
        new Date(record.completedAtMs),
        [...record.sourcesChecked],
        [...record.sourcesUnavailable],
        record.channelUuid,
        record.evidenceAtMs === null ? null : new Date(record.evidenceAtMs),
        record.outcome,
        record.previousState,
        record.newState,
        record.retryCount,
        record.nextReconcileAtMs === null ? null : new Date(record.nextReconcileAtMs),
        record.manualReviewReason,
        record.errorCategory
      );
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  /** How many attempts are parked for a person. Reported through health. */
  async countManualReview(input: {
    tenantIds: readonly string[];
    campaignIds: readonly string[];
  }): Promise<number> {
    const rows = await this.options.db.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT COUNT(*)::int AS n FROM "lead_dial_reservations"
       WHERE "manualReviewRequired" = true AND "releasedAt" IS NULL
         AND (cardinality($1::text[]) = 0 OR "tenantId" = ANY($1::text[]))
         AND (cardinality($2::text[]) = 0 OR "campaignId" = ANY($2::text[]))`,
      [...input.tenantIds],
      [...input.campaignIds]
    );
    return rows[0]?.n ?? 0;
  }
}
