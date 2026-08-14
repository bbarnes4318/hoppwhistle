-- Rollback for 20260804000000_add_attempt_reconciliation.
--
-- Structurally a genuine rollback: this migration only added an enum, two
-- tables, and columns to a table it does not own outright, so dropping them
-- restores the previous schema exactly. `leads` and `LeadStatus` were never
-- touched and are not touched here.
--
-- ── What running this DOES destroy, stated plainly ──────────────────────────
--
-- The entire audit trail. `attempt_reconciliation_runs` records why every
-- uncertain attempt was resolved the way it was, and
-- `attempt_manual_resolutions` records which person decided what and on what
-- stated grounds. Both are append-only by design and neither is reconstructible
-- from anything else in the database. Dropping them is not a neutral schema
-- operation — it deletes the evidence that a release of a possibly-live call was
-- authorised.
--
-- The scheduling columns go with them, so any attempt parked for manual review
-- loses `manualReviewRequired` and rejoins the reconciler's queue from zero.
--
-- Before running this:
--
--   COPY attempt_reconciliation_runs TO '/tmp/attempt_reconciliation_runs.csv' CSV HEADER;
--   COPY attempt_manual_resolutions  TO '/tmp/attempt_manual_resolutions.csv'  CSV HEADER;
--
-- And set RECONCILER_ENABLED=false first, so nothing is mid-run.

ALTER TABLE "attempt_manual_resolutions"
  DROP CONSTRAINT IF EXISTS "attempt_manual_resolutions_tenantId_fkey";
ALTER TABLE "attempt_manual_resolutions"
  DROP CONSTRAINT IF EXISTS "attempt_manual_resolutions_reservationId_fkey";

DROP TABLE IF EXISTS "attempt_manual_resolutions";

ALTER TABLE "attempt_reconciliation_runs"
  DROP CONSTRAINT IF EXISTS "attempt_reconciliation_runs_tenantId_fkey";
ALTER TABLE "attempt_reconciliation_runs"
  DROP CONSTRAINT IF EXISTS "attempt_reconciliation_runs_reservationId_fkey";

DROP TABLE IF EXISTS "attempt_reconciliation_runs";

DROP INDEX IF EXISTS "lead_dial_reservations_manual_review_idx";
DROP INDEX IF EXISTS "lead_dial_reservations_reconcile_queue_idx";

ALTER TABLE "lead_dial_reservations"
  DROP COLUMN IF EXISTS "resolutionChoice",
  DROP COLUMN IF EXISTS "resolvedAt",
  DROP COLUMN IF EXISTS "resolvedBy",
  DROP COLUMN IF EXISTS "lastReconciliationOutcome",
  DROP COLUMN IF EXISTS "manualReviewReason",
  DROP COLUMN IF EXISTS "manualReviewRequired",
  DROP COLUMN IF EXISTS "reconcilerLeaseExpiresAt",
  DROP COLUMN IF EXISTS "reconcilerToken",
  DROP COLUMN IF EXISTS "reconcilerOwnerId",
  DROP COLUMN IF EXISTS "reconcileNotBefore",
  DROP COLUMN IF EXISTS "reconcileAttempts";

-- Dropped last: the column above depends on it.
DROP TYPE IF EXISTS "AttemptResolutionChoice";
