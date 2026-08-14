/**
 * What an operator may decide about an attempt the reconciler could not resolve,
 * and the single guarded write that applies it.
 *
 * ── Why this lives in the shared package ─────────────────────────────────────
 *
 * Two processes care. `apps/api` exposes the operator surface; `apps/worker`
 * owns `lead_dial_reservations` and proves the transactional behaviour against
 * real PostgreSQL. If each wrote its own `UPDATE`, the guard that stops a stale
 * decision being applied would exist twice and could drift, and the half that
 * drifted would be the half nobody tested. One implementation, parameterised
 * over a narrow database interface, is testable from both sides and cannot
 * disagree with itself.
 *
 * ── What an operator cannot do ───────────────────────────────────────────────
 *
 * Originate a call. Enable the Hopper. Enable origination. Mark a lead
 * `CONTACTED`. None of those is expressible here: the choices are an enum of
 * four, each maps to a fixed reservation state, and no branch writes to `leads`
 * at all. `RETURN_TO_ELIGIBLE` — the only choice that can lead to a later dial —
 * additionally requires an explicit acknowledgement, because "this lead may be
 * called again and I accept that" is a different statement from "I have finished
 * looking at this screen".
 */

/** The four decisions. Narrow on purpose — free text would invent dispositions. */
export enum AttemptResolutionChoice {
  /** A call happened and is over. Releases the reservation, lead not retried. */
  CONFIRM_COMPLETED = 'CONFIRM_COMPLETED',
  /** No call was ever placed. Releases it and leaves the lead dialable. */
  CONFIRM_NEVER_ORIGINATED = 'CONFIRM_NEVER_ORIGINATED',
  /** Unknown, and it must never be dialed again. */
  SUPPRESS_RETRY = 'SUPPRESS_RETRY',
  /** Accepts the risk of a second call to somebody who may already have had one. */
  RETURN_TO_ELIGIBLE = 'RETURN_TO_ELIGIBLE',
}

/** `AttemptOutcome` values, restated here so the shared package needs no import. */
export const RESOLUTION_OUTCOME: Readonly<Record<AttemptResolutionChoice, string>> = Object.freeze({
  [AttemptResolutionChoice.CONFIRM_COMPLETED]: 'NO_ANSWER',
  [AttemptResolutionChoice.CONFIRM_NEVER_ORIGINATED]: 'NOT_ATTEMPTED',
  // Not retryable — that is the whole point of the choice.
  [AttemptResolutionChoice.SUPPRESS_RETRY]: 'DO_NOT_CALL',
  [AttemptResolutionChoice.RETURN_TO_ELIGIBLE]: 'NOT_ATTEMPTED',
});

/**
 * None of the four marks a lead contacted.
 *
 * Exported so a test can assert the whole map rather than each entry, which is
 * what stops a fifth choice being added with `ANSWERED_BY_HUMAN` quietly
 * attached to it.
 */
export const CONTACT_PROVING_OUTCOME = 'ANSWERED_BY_HUMAN';

export enum ResolutionRejection {
  /** The reservation is gone, or was never parked for review. */
  NOT_IN_REVIEW = 'NOT_IN_REVIEW',
  /** The token the operator's view was showing is no longer current. */
  STALE_TOKEN = 'STALE_TOKEN',
  /** Already resolved. A second decision is refused, not silently applied. */
  ALREADY_RESOLVED = 'ALREADY_RESOLVED',
  /** RETURN_TO_ELIGIBLE without the acknowledgement. */
  ACKNOWLEDGEMENT_REQUIRED = 'ACKNOWLEDGEMENT_REQUIRED',
  /** A missing or unusable reason, actor, or choice. */
  INVALID_REQUEST = 'INVALID_REQUEST',
  /** The reservation belongs to a different tenant than the caller. */
  WRONG_TENANT = 'WRONG_TENANT',
  STORE_UNAVAILABLE = 'STORE_UNAVAILABLE',
}

export interface ResolutionRequest {
  reservationId: string;
  /** The tenant the authenticated caller is scoped to. Checked in the predicate. */
  tenantId: string;
  /** The reservation token the operator's view was showing. */
  presentedToken: string;
  choice: AttemptResolutionChoice;
  /** Free text from the operator. Required. */
  reason: string;
  actorId: string;
  actorLabel?: string | null;
  /** Required, and must be true, for RETURN_TO_ELIGIBLE. */
  acknowledgedRedialRisk?: boolean;
}

export type ResolutionResult =
  | { ok: true; reservationId: string; choice: AttemptResolutionChoice; alreadyApplied: boolean }
  | { ok: false; rejection: ResolutionRejection; detail: string };

/** Shortest reason that can mean anything. */
export const MIN_REASON_LENGTH = 10;
export const MAX_REASON_LENGTH = 2_000;

/**
 * Validate a request without touching a database.
 *
 * Separated so the API can reject a malformed request before opening a
 * transaction, and so every branch is testable against a literal.
 */
export function validateResolutionRequest(
  request: ResolutionRequest
): { ok: true } | { ok: false; rejection: ResolutionRejection; detail: string } {
  if (!Object.values(AttemptResolutionChoice).includes(request.choice)) {
    return {
      ok: false,
      rejection: ResolutionRejection.INVALID_REQUEST,
      detail: 'choice must be one of the four declared resolutions',
    };
  }
  for (const [field, value] of [
    ['reservationId', request.reservationId],
    ['tenantId', request.tenantId],
    ['presentedToken', request.presentedToken],
    ['actorId', request.actorId],
  ] as const) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return {
        ok: false,
        rejection: ResolutionRejection.INVALID_REQUEST,
        detail: `${field} is required`,
      };
    }
  }
  const reason = typeof request.reason === 'string' ? request.reason.trim() : '';
  if (reason.length < MIN_REASON_LENGTH || reason.length > MAX_REASON_LENGTH) {
    // An unexplained release of a possibly-live call is not auditable, and
    // "ok" is not an explanation.
    return {
      ok: false,
      rejection: ResolutionRejection.INVALID_REQUEST,
      detail: `reason must be between ${MIN_REASON_LENGTH} and ${MAX_REASON_LENGTH} characters`,
    };
  }
  if (
    request.choice === AttemptResolutionChoice.RETURN_TO_ELIGIBLE &&
    request.acknowledgedRedialRisk !== true
  ) {
    return {
      ok: false,
      rejection: ResolutionRejection.ACKNOWLEDGEMENT_REQUIRED,
      detail:
        'returning an unresolved attempt to the pool may place a second call to somebody who ' +
        'already received one; acknowledgedRedialRisk must be true',
    };
  }
  return { ok: true };
}

/** The narrow database surface this module needs. */
export interface ResolutionDb {
  $queryRawUnsafe<T = unknown>(sql: string, ...values: unknown[]): Promise<T>;
}

export interface ApplyOptions {
  db: ResolutionDb;
  now?: () => number;
  newId?: () => string;
}

/**
 * Apply an operator's decision.
 *
 * Two statements, in this order, and the order is the idempotence argument.
 *
 * The `INSERT` into `attempt_manual_resolutions` goes first and carries a UNIQUE
 * constraint on `reservationId`. A double-click therefore loses at the database
 * rather than at an application check that raced, and the loser can distinguish
 * "I already did this" from "somebody else did something else" by reading back
 * what is there. The reservation `UPDATE` follows, guarded on the presented
 * token so a decision made against a screen the reconciler has since moved past
 * cannot land.
 *
 * `SUPPRESS_RETRY` and `RETURN_TO_ELIGIBLE` differ only in the recorded outcome:
 * both release the reservation, and it is `isRetryable(outcome)` on the dialing
 * side that decides whether the lead is ever selected again. Encoding the
 * difference as an outcome rather than as two different writes means the
 * distinction survives into the audit trail.
 */
export async function applyManualResolution(
  request: ResolutionRequest,
  options: ApplyOptions
): Promise<ResolutionResult> {
  const validation = validateResolutionRequest(request);
  if (!validation.ok) return validation;

  const now = new Date((options.now ?? Date.now)());
  const newId = options.newId ?? (() => globalThis.crypto.randomUUID());
  const reason = request.reason.trim();

  // ── Is it ours, and is it in review? ──────────────────────────────────────
  let current: Array<{
    id: string;
    token: string;
    tenantId: string;
    manualReviewRequired: boolean;
    releasedAt: Date | null;
    resolutionChoice: string | null;
  }>;
  try {
    current = await options.db.$queryRawUnsafe(
      `SELECT "id", "token", "tenantId", "manualReviewRequired", "releasedAt", "resolutionChoice"
         FROM "lead_dial_reservations" WHERE "id" = $1`,
      request.reservationId
    );
  } catch {
    return {
      ok: false,
      rejection: ResolutionRejection.STORE_UNAVAILABLE,
      detail: 'the reservation store could not be read',
    };
  }

  const row = current[0];
  if (!row) {
    return {
      ok: false,
      rejection: ResolutionRejection.NOT_IN_REVIEW,
      detail: 'no such reservation',
    };
  }
  if (row.tenantId !== request.tenantId) {
    // Reported as if it did not exist. Confirming that a reservation id belongs
    // to some other tenant is itself a cross-tenant disclosure.
    return {
      ok: false,
      rejection: ResolutionRejection.WRONG_TENANT,
      detail: 'no such reservation',
    };
  }
  if (row.resolutionChoice !== null) {
    return {
      ok: false,
      rejection: ResolutionRejection.ALREADY_RESOLVED,
      detail: 'this attempt has already been resolved',
    };
  }
  if (!row.manualReviewRequired || row.releasedAt !== null) {
    return {
      ok: false,
      rejection: ResolutionRejection.NOT_IN_REVIEW,
      detail: 'this attempt is not awaiting manual review',
    };
  }
  if (row.token !== request.presentedToken) {
    return {
      ok: false,
      rejection: ResolutionRejection.STALE_TOKEN,
      detail: 'the attempt has changed since it was displayed; reload and decide again',
    };
  }

  // ── Record the human decision first ───────────────────────────────────────
  try {
    await options.db.$queryRawUnsafe(
      `INSERT INTO "attempt_manual_resolutions" (
         "id", "reservationId", "attemptId", "tenantId", "actorId", "actorLabel",
         "choice", "reason", "acknowledgedRedialRisk", "presentedToken", "createdAt"
       )
       SELECT $1, r."id", r."attemptId", r."tenantId", $2, $3,
              $4::"AttemptResolutionChoice", $5, $6, $7, $8
         FROM "lead_dial_reservations" r
        WHERE r."id" = $9 AND r."token" = $7`,
      newId(),
      request.actorId,
      request.actorLabel ?? null,
      request.choice,
      reason,
      request.acknowledgedRedialRisk === true,
      request.presentedToken,
      now,
      request.reservationId
    );
  } catch {
    // The UNIQUE index on reservationId is the only realistic failure, and it
    // means a concurrent operator got there first.
    return {
      ok: false,
      rejection: ResolutionRejection.ALREADY_RESOLVED,
      detail: 'another operator resolved this attempt concurrently',
    };
  }

  // ── Then release the reservation, under the same token ────────────────────
  try {
    const updated = await options.db.$queryRawUnsafe<Array<{ id: string }>>(
      `UPDATE "lead_dial_reservations"
          SET "state" = 'COMPLETED'::"LeadDialReservationState",
              "outcome" = $1,
              "releasedAt" = $2,
              "manualReviewRequired" = false,
              "resolvedBy" = $3,
              "resolvedAt" = $2,
              "resolutionChoice" = $4::"AttemptResolutionChoice",
              "reconcileNotBefore" = NULL,
              "reconcilerOwnerId" = NULL,
              "reconcilerToken" = NULL,
              "reconcilerLeaseExpiresAt" = NULL,
              "updatedAt" = $2
        WHERE "id" = $5
          AND "token" = $6
          AND "releasedAt" IS NULL
          AND "tenantId" = $7
        RETURNING "id"`,
      RESOLUTION_OUTCOME[request.choice],
      now,
      request.actorId,
      request.choice,
      request.reservationId,
      request.presentedToken,
      request.tenantId
    );

    if (updated.length === 0) {
      return {
        ok: false,
        rejection: ResolutionRejection.STALE_TOKEN,
        detail: 'the attempt changed between reading it and applying the decision',
      };
    }
  } catch {
    return {
      ok: false,
      rejection: ResolutionRejection.STORE_UNAVAILABLE,
      detail: 'the decision was recorded but could not be applied; retry',
    };
  }

  return {
    ok: true,
    reservationId: request.reservationId,
    choice: request.choice,
    alreadyApplied: false,
  };
}
