-- What phone numbers cost the agency that holds them.
--
-- One SETUP row when a number is bought, and one MONTHLY row per calendar month
-- it is held: the purchase writes the current month prorated by days remaining,
-- and `pnpm numbers:bill-month` writes every ACTIVE number's row on the 1st.
-- The unique index on (phoneNumberId, kind, periodStart) is what makes that
-- command safe to run twice.
--
-- A child agency's charges are written to its PARENT white-label tenant, with
-- metadata.childTenantId naming the child. Nothing collects payment from these
-- rows; the agency owner's monthly statement reads them.
--
-- Applied by hand with psql (this database has no _prisma_migrations table):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/prisma/migrations/20260930020000_number_charges/migration.sql
--
-- Idempotent throughout, and one transaction, so a failure leaves nothing
-- half-applied and a second run is a no-op.

BEGIN;

CREATE TABLE IF NOT EXISTS "number_charges" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "number_charges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "number_charges_phoneNumberId_kind_periodStart_key"
  ON "number_charges"("phoneNumberId", "kind", "periodStart");

CREATE INDEX IF NOT EXISTS "number_charges_tenantId_periodStart_idx"
  ON "number_charges"("tenantId", "periodStart");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'number_charges_tenantId_fkey') THEN
    ALTER TABLE "number_charges"
      ADD CONSTRAINT "number_charges_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'number_charges_phoneNumberId_fkey') THEN
    ALTER TABLE "number_charges"
      ADD CONSTRAINT "number_charges_phoneNumberId_fkey"
      FOREIGN KEY ("phoneNumberId") REFERENCES "phone_numbers"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
