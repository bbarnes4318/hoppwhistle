-- Rollback for 20260803000000_add_lead_dial_reservations.
--
-- A genuine rollback, and that is the point. This migration ADDS a table and an
-- enum type, so dropping them restores the previous schema exactly. Nothing
-- outside the legacy Hopper reads `lead_dial_reservations`, and `leads` was
-- never altered, so no existing row changes meaning.
--
-- Contrast with the design that was rejected: adding `DIALING` to `LeadStatus`
-- could not be rolled back at all. PostgreSQL has no `DROP VALUE`, and reversing
-- it would mean creating a replacement type, rewriting every column that uses
-- it, and dropping the old one — a full rewrite of the production `leads` table
-- under lock, valid only if no row held the value.
--
-- ── What running this DOES destroy ──────────────────────────────────────────
--
-- In-flight reservations. Any lead currently held by a worker is released
-- implicitly, so after rollback the Hopper's `NOT EXISTS` check finds nothing
-- and those leads become eligible again. If a reservation was in
-- ORIGINATION_SUBMITTED or ORIGINATION_ACCEPTED, a call may be in progress that
-- nothing now records — which is exactly the uncertainty
-- NEEDS_RECONCILIATION exists to prevent.
--
-- So do NOT roll this back while the Hopper is enabled. Set
-- LEGACY_HOPPER_ENABLED=false first, let in-flight attempts drain, and take a
-- copy if the rows will be needed:
--
--   COPY lead_dial_reservations TO '/tmp/lead_dial_reservations.csv' CSV HEADER;

ALTER TABLE "lead_dial_reservations"
  DROP CONSTRAINT IF EXISTS "lead_dial_reservations_campaignId_fkey";
ALTER TABLE "lead_dial_reservations"
  DROP CONSTRAINT IF EXISTS "lead_dial_reservations_tenantId_fkey";
ALTER TABLE "lead_dial_reservations"
  DROP CONSTRAINT IF EXISTS "lead_dial_reservations_leadId_fkey";

DROP TABLE IF EXISTS "lead_dial_reservations";

DROP TYPE IF EXISTS "LeadDialReservationState";
