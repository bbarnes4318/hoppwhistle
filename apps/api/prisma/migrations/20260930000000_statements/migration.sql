-- Monthly statements: one closed month, for one party, as it was on the day
-- the month closed.
--
-- `pnpm statements:close [YYYY-MM]` writes one row per buyer, per publisher,
-- per agency and per child agency, on the 1st, after `numbers:bill-month`.
-- A closed month never changes: the row holds the totals and the rendered HTML
-- the PDF is printed from, so a return accepted later appears on the next
-- month's statement instead of rewriting this one. The unique index on
-- (tenantId, partyType, partyId, month) is what makes the command safe to run
-- twice.
--
--   partyType   'BUYER' | 'PUBLISHER' | 'AGENCY' | 'CHILD_AGENCY'
--   partyId     the buyer's id, the publisher's id, or the agency's tenant id
--   month       'YYYY-MM', an America/New_York calendar month
--
-- Applied by hand with psql (this database has no _prisma_migrations table):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/prisma/migrations/20260930000000_statements/migration.sql
--
-- Idempotent throughout, and one transaction, so a failure leaves nothing
-- half-applied and a second run is a no-op.

BEGIN;

CREATE TABLE IF NOT EXISTS "statements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "partyType" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "totals" JSONB NOT NULL,
    "html" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "statements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "statements_tenantId_partyType_partyId_month_key"
  ON "statements"("tenantId", "partyType", "partyId", "month");

CREATE INDEX IF NOT EXISTS "statements_partyType_partyId_idx"
  ON "statements"("partyType", "partyId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'statements_tenantId_fkey') THEN
    ALTER TABLE "statements"
      ADD CONSTRAINT "statements_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'statements_partyType_check') THEN
    ALTER TABLE "statements"
      ADD CONSTRAINT "statements_partyType_check"
      CHECK ("partyType" IN ('BUYER', 'PUBLISHER', 'AGENCY', 'CHILD_AGENCY'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'statements_month_check') THEN
    ALTER TABLE "statements"
      ADD CONSTRAINT "statements_month_check"
      CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
  END IF;
END $$;

COMMIT;
