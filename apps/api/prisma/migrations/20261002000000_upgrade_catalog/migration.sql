-- The upgrades catalog: a price per paid upgrade, and an agency's request for
-- one.
--
-- `upgrade_prices` holds NetEnroll's monthly and setup price for each key in
-- TENANT_UPGRADES (apps/api/src/lib/tenant-upgrades.ts), in cents, set by a
-- platform admin on Admin -> Agencies. A null price, or no row, reads "Ask for
-- pricing" on /upgrades.
--
-- `upgrade_requests` is an agency pressing "Request this upgrade". The partial
-- unique index on (tenantId, upgradeKey) WHERE status = 'OPEN' is what makes a
-- second press return the same open request instead of a second one. Turning
-- the upgrade on marks the request DONE; a platform admin may mark it DONE or
-- DECLINED by hand.
--
--   status   'OPEN' | 'DONE' | 'DECLINED'
--
-- Applied by hand with psql (this database has no _prisma_migrations table):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/prisma/migrations/20261002000000_upgrade_catalog/migration.sql
--
-- Idempotent throughout, and one transaction, so a failure leaves nothing
-- half-applied and a second run is a no-op.

BEGIN;

CREATE TABLE IF NOT EXISTS "upgrade_prices" (
    "key" TEXT NOT NULL,
    "monthlyCents" INTEGER,
    "setupCents" INTEGER,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "updatedByUserId" TEXT,

    CONSTRAINT "upgrade_prices_pkey" PRIMARY KEY ("key")
);

CREATE TABLE IF NOT EXISTS "upgrade_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "upgradeKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "decidedAt" TIMESTAMPTZ(3),

    CONSTRAINT "upgrade_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "upgrade_requests_tenantId_idx"
  ON "upgrade_requests"("tenantId");

-- One open request per agency per upgrade. Mirrored in
-- prisma/sql/db-push-constraints.sql, because db push cannot create it.
CREATE UNIQUE INDEX IF NOT EXISTS "upgrade_requests_open_tenant_key"
  ON "upgrade_requests"("tenantId", "upgradeKey")
  WHERE "status" = 'OPEN';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'upgrade_requests_tenantId_fkey') THEN
    ALTER TABLE "upgrade_requests"
      ADD CONSTRAINT "upgrade_requests_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'upgrade_requests_status_check') THEN
    ALTER TABLE "upgrade_requests"
      ADD CONSTRAINT "upgrade_requests_status_check"
      CHECK ("status" IN ('OPEN', 'DONE', 'DECLINED'));
  END IF;
END $$;

COMMIT;
