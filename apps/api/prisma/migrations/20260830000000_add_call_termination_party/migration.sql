-- Record who ended each call, and the raw cause we derived that from.
--
-- Purely additive. One new enum and two nullable columns on `calls`, plus one
-- index. Both columns are nullable with no default, so the ALTER TABLE is a
-- catalog-only change in PostgreSQL 11+ — it does not rewrite the table and
-- holds ACCESS EXCLUSIVE only for the moment it takes to update the catalog.
--
-- Nothing is backfilled. Every row that exists today keeps NULL in both
-- columns, and callers must treat NULL as "we don't know", not as "nobody
-- hung up". The abandon-rate metric returns null while no row in the window
-- carries a terminationParty, and only goes live once the FreeSWITCH CDR
-- webhook has been writing them for long enough to fill a window.
--
-- The index is created non-concurrently, consistent with every other migration
-- in this directory. On a large `calls` table run the CREATE INDEX separately
-- with CONCURRENTLY instead, outside a transaction.
--
-- Rollback is `down.sql` in this directory.

-- CreateEnum
CREATE TYPE "CallTerminationParty" AS ENUM ('CALLER', 'CALLEE', 'SYSTEM', 'UNKNOWN');

-- AlterTable
ALTER TABLE "calls" ADD COLUMN     "terminationCause" TEXT,
ADD COLUMN     "terminationParty" "CallTerminationParty";

-- CreateIndex
CREATE INDEX "calls_tenantId_terminationParty_createdAt_idx" ON "calls"("tenantId", "terminationParty", "createdAt");
