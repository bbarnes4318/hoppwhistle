-- White-label tier, child agencies, and publisher payments.
--
-- "whiteLabel" marks an agency that also sells calls: its OWNER and ADMIN get
-- the call network (publishers, buyers, campaigns, numbers, payouts), what
-- their calls sold for, and downline agencies of their own. It defaults to
-- false, so every existing tenant is unchanged.
--
-- "parentTenantId" is the white-label agency that onboarded a child agency.
-- Nullable, and NULL for every existing tenant.
--
-- "publisher_payments" records a payment a white-label agency made to one of
-- its publishers. The platform moves no money; the row is what the agency
-- recorded, and the calls it covers are marked PAID alongside it.
--
-- Applied by hand with psql (this database has no _prisma_migrations table):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/prisma/migrations/20260926000000_tenant_white_label/migration.sql
--
-- Idempotent throughout, and one transaction, so a failure leaves nothing
-- half-applied and a second run is a no-op.

BEGIN;

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "whiteLabel" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "parentTenantId" TEXT;

CREATE INDEX IF NOT EXISTS "tenants_parentTenantId_idx" ON "tenants"("parentTenantId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_parentTenantId_fkey') THEN
    ALTER TABLE "tenants"
      ADD CONSTRAINT "tenants_parentTenantId_fkey"
      FOREIGN KEY ("parentTenantId") REFERENCES "tenants"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "publisher_payments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "publisherId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publisher_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "publisher_payments_tenantId_publisherId_idx"
  ON "publisher_payments"("tenantId", "publisherId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'publisher_payments_tenantId_fkey') THEN
    ALTER TABLE "publisher_payments"
      ADD CONSTRAINT "publisher_payments_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'publisher_payments_publisherId_fkey') THEN
    ALTER TABLE "publisher_payments"
      ADD CONSTRAINT "publisher_payments_publisherId_fkey"
      FOREIGN KEY ("publisherId") REFERENCES "publishers"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
