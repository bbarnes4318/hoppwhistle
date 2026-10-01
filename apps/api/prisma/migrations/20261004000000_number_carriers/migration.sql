-- Which carriers agencies may buy phone numbers from.
--
-- A NetEnroll platform admin chooses on Settings -> Number carriers; agency
-- owners never do. One row per carrier, `enabled` and at most one `isDefault`
-- (the carrier searched first). A carrier with no row takes the built-in
-- default in services/numbers/number-carriers.ts, which is what the Buy
-- numbers dialog did before this table existed: FracTEL (the default, local
-- and toll-free) and BulkVS (more local inventory) on, everything else off.
-- The rows below write that same starting point, so applying this changes
-- nothing until somebody changes it.
--
-- Applied by hand with psql (this database has no _prisma_migrations table):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/prisma/migrations/20261004000000_number_carriers/migration.sql
--
-- Idempotent throughout, and one transaction.

BEGIN;

CREATE TABLE IF NOT EXISTS "number_carrier_settings" (
  "provider"        TEXT         NOT NULL,
  "enabled"         BOOLEAN      NOT NULL DEFAULT false,
  "isDefault"       BOOLEAN      NOT NULL DEFAULT false,
  "updatedAt"       TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedByUserId" TEXT         NULL,
  CONSTRAINT "number_carrier_settings_pkey" PRIMARY KEY ("provider")
);

INSERT INTO "number_carrier_settings" ("provider", "enabled", "isDefault")
VALUES ('fractel', true, true), ('bulkvs', true, false)
ON CONFLICT ("provider") DO NOTHING;

COMMIT;
