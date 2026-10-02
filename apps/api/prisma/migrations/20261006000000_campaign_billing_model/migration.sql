-- Let a campaign charge its buyers, and pay its publishers, per submitted
-- application instead of per billable call; and tag every application with the
-- campaign, buyer and publisher of the call it came off.
--
-- ── What was wrong ───────────────────────────────────────────────────────────
--
-- A campaign could only price calls. An application carried a `callId` and
-- nothing else, so "what does an application on this campaign cost this buyer"
-- had no answer, and an agency that sells to its buyers per application had no
-- way to say so.
--
-- ── What this adds ──────────────────────────────────────────────────────────
--
--   campaigns."billingModel"               PER_CALL (the default, unchanged) or
--                                          PER_APPLICATION. Exclusive: a call on
--                                          a PER_APPLICATION campaign is never
--                                          also priced per call, so a buyer is
--                                          never charged twice for one caller.
--   campaigns."buyerPricePerApplication"   default buyer price per application
--   campaigns."publisherPayoutPerApplication"
--   campaign_buyers."pricePerApplication"  per-assignment override (NULL = default)
--   campaign_publishers."payoutPerApplication"
--   insurance_carrier_applications."campaignId" / "buyerId" / "publisherId"
--                                          copied off the attributed call.
--
-- NetEnroll's own per-application billing of the agency
-- (`agency_billing_profiles`) is untouched: that is the platform billing the
-- agency, this is the agency billing its buyers.
--
-- ── How this migration is applied ────────────────────────────────────────────
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/prisma/migrations/20261006000000_campaign_billing_model/migration.sql
--
-- Additive and idempotent.
BEGIN;

DO $$ BEGIN
  CREATE TYPE "CampaignBillingModel" AS ENUM ('PER_CALL', 'PER_APPLICATION');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "billingModel" "CampaignBillingModel" NOT NULL DEFAULT 'PER_CALL',
  ADD COLUMN IF NOT EXISTS "buyerPricePerApplication" DECIMAL(10,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "publisherPayoutPerApplication" DECIMAL(10,4) NOT NULL DEFAULT 0;

ALTER TABLE "campaign_buyers"
  ADD COLUMN IF NOT EXISTS "pricePerApplication" DECIMAL(10,4);

ALTER TABLE "campaign_publishers"
  ADD COLUMN IF NOT EXISTS "payoutPerApplication" DECIMAL(10,4);

ALTER TABLE "insurance_carrier_applications"
  ADD COLUMN IF NOT EXISTS "campaignId" TEXT,
  ADD COLUMN IF NOT EXISTS "buyerId" TEXT,
  ADD COLUMN IF NOT EXISTS "publisherId" TEXT;

CREATE INDEX IF NOT EXISTS "insurance_carrier_applications_tenantId_campaignId_submitte_idx"
  ON "insurance_carrier_applications" ("tenantId", "campaignId", "submittedAt");
CREATE INDEX IF NOT EXISTS "insurance_carrier_applications_buyerId_idx"
  ON "insurance_carrier_applications" ("buyerId");
CREATE INDEX IF NOT EXISTS "insurance_carrier_applications_publisherId_idx"
  ON "insurance_carrier_applications" ("publisherId");

-- Backfill: an application that already names a call takes that call's
-- campaign, buyer and publisher. Copied, not inferred -- the call link itself
-- is whatever `callAttribution` says it is.
UPDATE "insurance_carrier_applications" a
SET "campaignId"  = c."campaignId",
    "buyerId"     = c."buyerId",
    "publisherId" = c."publisherId"
FROM "calls" c
WHERE a."callId" = c."id"
  AND a."tenantId" = c."tenantId"
  AND a."campaignId" IS NULL;

COMMIT;
