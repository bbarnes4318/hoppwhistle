-- What an upgrade's price is per, and the line under it.
--
-- `priceUnit` says whether `monthlyCents` is charged once per agency
-- ('AGENCY') or once per agent ('AGENT'); /upgrades reads "$99 per agent /
-- month" for the second. `usageNote` is the one line under the price
-- ("Includes 5,000 outbound minutes per agent, then $0.01/min.").
--
-- Then the launch price list. ON CONFLICT (key) DO NOTHING: a price a platform
-- admin has already set by hand on Admin -> Agencies is kept, not overwritten.
--
-- 20261002000000_upgrade_catalog is merged and may already be applied, so this
-- is a migration of its own rather than an edit to that one.
--
-- Applied by hand with psql (this database has no _prisma_migrations table):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/prisma/migrations/20261003000000_upgrade_price_units/migration.sql
--
-- Idempotent throughout, and one transaction.

BEGIN;

ALTER TABLE "upgrade_prices" ADD COLUMN IF NOT EXISTS "priceUnit" TEXT NOT NULL DEFAULT 'AGENCY';
ALTER TABLE "upgrade_prices" ADD COLUMN IF NOT EXISTS "usageNote" TEXT NULL;

-- ADD CONSTRAINT has no IF NOT EXISTS; guarded so a second run does not fail.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'upgrade_prices_price_unit_check'
  ) THEN
    ALTER TABLE "upgrade_prices"
      ADD CONSTRAINT "upgrade_prices_price_unit_check" CHECK ("priceUnit" IN ('AGENCY', 'AGENT'));
  END IF;
END $$;

INSERT INTO "upgrade_prices" ("key", "monthlyCents", "setupCents", "priceUnit", "usageNote")
VALUES
  ('POWER_DIALER', 9900, 0, 'AGENT',
   'Includes 5,000 outbound minutes per agent, then $0.01/min. Litigator scrub included.'),
  ('PREDICTIVE_DIALER', 14900, 0, 'AGENT',
   'Includes 10,000 outbound minutes per agent, then $0.01/min.'),
  ('CARRIER_ROUTING', 19900, 0, 'AGENCY', NULL),
  ('VOICE_AGENTS', 10000, 0, 'AGENCY',
   'Includes 1,000 AI minutes, then $0.10/min. Voice Studio included.'),
  ('VOICE_STUDIO', 0, 0, 'AGENCY', 'Included with Voice Agents.'),
  ('PAYROLL_ADMIN', 9900, 0, 'AGENCY', NULL)
ON CONFLICT ("key") DO NOTHING;

COMMIT;
