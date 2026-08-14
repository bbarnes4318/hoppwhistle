-- Attempt reconciliation: scheduling state, an append-only decision log, and an
-- append-only operator-action log.
--
-- ADDITIVE. This migration creates one enum and two tables, and adds nullable or
-- defaulted columns to `lead_dial_reservations` — a table created by
-- `20260803000000_add_lead_dial_reservations` and applied to no real database.
-- It alters no pre-existing table, no pre-existing enum, and nothing in the
-- protected AI-campaign zone. `leads` and `LeadStatus` are untouched.
--
-- ROLLBACK: `down.sql`, executed forward → rollback → forward in CI against a
-- throwaway PostgreSQL. It drops the decision and resolution logs, which is a
-- genuine loss of audit history — see the warning in that file.

-- ---------------------------------------------------------------------------
-- What an operator may decide about an attempt that cannot be resolved
-- automatically. Narrow on purpose: a free-text resolution field would let one
-- operator invent a disposition nothing downstream understands.
-- ---------------------------------------------------------------------------
CREATE TYPE "AttemptResolutionChoice" AS ENUM (
  -- A call happened and is over. Releases the reservation.
  'CONFIRM_COMPLETED',
  -- No call was ever placed. Releases the reservation and leaves the lead dialable.
  'CONFIRM_NEVER_ORIGINATED',
  -- Unknown, and it must never be dialed again. Releases nothing to the pool.
  'SUPPRESS_RETRY',
  -- Accepts the risk of a later second call. Requires an explicit acknowledgement.
  'RETURN_TO_ELIGIBLE'
);

-- ---------------------------------------------------------------------------
-- Scheduling and review state on the reservation itself.
--
-- These live on the reservation rather than in a side table because they are
-- part of deciding whether the row may be claimed, and a claim must be one
-- statement. A join would reintroduce the read-then-write this whole design
-- exists to avoid.
-- ---------------------------------------------------------------------------
ALTER TABLE "lead_dial_reservations"
  ADD COLUMN "reconcileAttempts"        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reconcileNotBefore"       TIMESTAMP(3),
  ADD COLUMN "reconcilerOwnerId"        TEXT,
  ADD COLUMN "reconcilerToken"          TEXT,
  ADD COLUMN "reconcilerLeaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "manualReviewRequired"     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "manualReviewReason"       TEXT,
  ADD COLUMN "lastReconciliationOutcome" TEXT,
  ADD COLUMN "resolvedBy"               TEXT,
  ADD COLUMN "resolvedAt"               TIMESTAMP(3),
  ADD COLUMN "resolutionChoice"         "AttemptResolutionChoice";

-- The reconciler's claim query reads exactly these columns in this order.
CREATE INDEX "lead_dial_reservations_reconcile_queue_idx"
  ON "lead_dial_reservations"("state", "manualReviewRequired", "reconcileNotBefore");

-- The operator queue: everything parked for a human.
CREATE INDEX "lead_dial_reservations_manual_review_idx"
  ON "lead_dial_reservations"("tenantId", "manualReviewRequired");

-- ---------------------------------------------------------------------------
-- Append-only decision log. One row per reconciliation run per attempt.
--
-- Never updated and never deleted by the application: an audit trail that can be
-- rewritten is not one. Every column here is either an identifier this system
-- generated or a classification it made. No ESL response body, no connection
-- string, no environment variable, no credential.
-- ---------------------------------------------------------------------------
CREATE TABLE "attempt_reconciliation_runs" (
  "id"                  TEXT NOT NULL,
  "reservationId"       TEXT NOT NULL,
  "attemptId"           TEXT NOT NULL,
  "leadId"              TEXT NOT NULL,
  "tenantId"            TEXT NOT NULL,
  "campaignId"          TEXT NOT NULL,

  -- Which reconciler, holding which fencing token, made this decision.
  "reconcilerOwnerId"   TEXT NOT NULL,
  "fencingToken"        TEXT NOT NULL,

  "startedAt"           TIMESTAMP(3) NOT NULL,
  "completedAt"         TIMESTAMP(3),

  -- Which sources were consulted, and which could not be. Separate arrays,
  -- because "asked and found nothing" and "could not ask" are different facts
  -- and the whole contract turns on not confusing them.
  "sourcesChecked"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "sourcesUnavailable"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  "channelUuid"         TEXT,
  "evidenceAt"          TIMESTAMP(3),

  "outcome"             TEXT NOT NULL,
  "previousState"       "LeadDialReservationState" NOT NULL,
  "newState"            "LeadDialReservationState",

  "retryCount"          INTEGER NOT NULL DEFAULT 0,
  "nextReconcileAt"     TIMESTAMP(3),

  "manualReviewReason"  TEXT,
  -- A category such as "transport" or "classification". Never a driver message:
  -- those carry hosts and, on some drivers, the credential that was attempted.
  "errorCategory"       TEXT,

  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "attempt_reconciliation_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "attempt_reconciliation_runs_reservationId_idx"
  ON "attempt_reconciliation_runs"("reservationId");
CREATE INDEX "attempt_reconciliation_runs_attemptId_idx"
  ON "attempt_reconciliation_runs"("attemptId");
CREATE INDEX "attempt_reconciliation_runs_tenantId_startedAt_idx"
  ON "attempt_reconciliation_runs"("tenantId", "startedAt");

ALTER TABLE "attempt_reconciliation_runs"
  ADD CONSTRAINT "attempt_reconciliation_runs_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "lead_dial_reservations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "attempt_reconciliation_runs"
  ADD CONSTRAINT "attempt_reconciliation_runs_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Append-only operator-action log.
--
-- Separate from the run log because these are the only rows a person authored.
-- Conflating them would make it impossible to answer "did a human decide this,
-- or did the machine" without parsing a discriminator, and that question is the
-- first one asked about any released reservation.
-- ---------------------------------------------------------------------------
CREATE TABLE "attempt_manual_resolutions" (
  "id"              TEXT NOT NULL,
  "reservationId"   TEXT NOT NULL,
  "attemptId"       TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,

  -- Who. An internal user id and a display label, never an email or a token.
  "actorId"         TEXT NOT NULL,
  "actorLabel"      TEXT,

  "choice"          "AttemptResolutionChoice" NOT NULL,
  -- Required by the API. An unexplained release is not auditable.
  "reason"          TEXT NOT NULL,
  -- RETURN_TO_ELIGIBLE is refused unless this is true.
  "acknowledgedRedialRisk" BOOLEAN NOT NULL DEFAULT false,

  -- The reservation token the operator's view was showing. A stale one is
  -- refused, so a decision made against a screen the reconciler has since moved
  -- past cannot be applied.
  "presentedToken"  TEXT NOT NULL,

  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "attempt_manual_resolutions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "attempt_manual_resolutions_reservationId_idx"
  ON "attempt_manual_resolutions"("reservationId");
CREATE INDEX "attempt_manual_resolutions_tenantId_createdAt_idx"
  ON "attempt_manual_resolutions"("tenantId", "createdAt");

ALTER TABLE "attempt_manual_resolutions"
  ADD CONSTRAINT "attempt_manual_resolutions_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "lead_dial_reservations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "attempt_manual_resolutions"
  ADD CONSTRAINT "attempt_manual_resolutions_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- One resolution per reservation. A second operator acting on the same parked
-- attempt is refused by the database rather than by application ordering, which
-- is what makes the operator path idempotent under a double-click.
CREATE UNIQUE INDEX "attempt_manual_resolutions_reservationId_key"
  ON "attempt_manual_resolutions"("reservationId");
