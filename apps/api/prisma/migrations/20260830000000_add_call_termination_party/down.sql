-- Rollback for 20260830000000_add_call_termination_party.
--
-- Safe to run at any time. Nothing reads `terminationParty` or
-- `terminationCause` except the abandon-rate metric, which returns null when
-- no row carries a party — the same value it returns today. Dropping the
-- columns restores that exactly.
--
-- Dropping the columns DOES destroy the recorded hangup data. It has no other
-- source: FreeSWITCH does not retain CDRs we failed to persist, and nothing
-- backfills. If the rollback is expected to be temporary, take a copy first:
--
--   CREATE TABLE calls_termination_backup AS
--     SELECT id, "terminationParty", "terminationCause" FROM calls
--     WHERE "terminationParty" IS NOT NULL;

DROP INDEX IF EXISTS "calls_tenantId_terminationParty_createdAt_idx";

ALTER TABLE "calls" DROP COLUMN IF EXISTS "terminationParty";
ALTER TABLE "calls" DROP COLUMN IF EXISTS "terminationCause";

DROP TYPE IF EXISTS "CallTerminationParty";
