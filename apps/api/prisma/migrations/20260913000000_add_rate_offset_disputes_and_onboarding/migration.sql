-- Phase 5: the rate offset, card payment, chargeback containment, internal
-- onboarding, and the non-production tenant marker.
--
-- ── What this adds, and why each part is here ────────────────────────────────
--
-- THE RATE OFFSET. Card is a supported alternative to ACH and it is priced
-- through the rate, not through a fee. `agency_billing_profiles.rateOffset` is
-- dollars added to whatever the curve returns, at every point on the curve:
--
--     effective rate = curve rate for the closing percentage + rateOffset
--
-- Zero by default, so every existing agency is priced exactly as it was. It is
-- deliberately NOT a surcharge: a surcharge is an itemised fee added at the
-- point of payment, which is a regulated instrument requiring card-network
-- registration, capped at 3%, prohibited on debit cards and unlawful in several
-- states. A different price is none of those things, so there is no fee column
-- here, on the settlement, or in the export.
--
-- `rate_changes` and `daily_settlements` each gain `curveRate` and `rateOffset`
-- beside the effective `rate`, so a priced row can still be recomputed from
-- itself and a curve change is distinguishable from an offset change.
--
-- CARD PAYMENT. `paymentMethod` selects the instrument the daily settlement
-- debits, and `ceilingPctCard` is the flat 25% Overrun ceiling a card-paying
-- agency gets -- lower than the ACH schedule's 50%, and not rising with
-- settlement history, because a card payment can be taken back without our
-- consent and unsecured credit against a reversible instrument is exposure.
--
-- CHARGEBACKS. `settlement_disputes` records a dispute against the settlement
-- it hit. It is deliberately NOT a ledger entry type and NOT a settlement
-- status: consumed credits stay consumed, no credit is returned, and no
-- settlement figure moves. A chargeback is contained -- delivery stops, the
-- tenant is flagged, platform staff are told -- not reversed.
--
-- ONBOARDING. `agency_profiles` is the agency's own identity and delivery
-- schedule, written by a platform admin in the first step of the runbook. There
-- is no self-serve path that writes it.
--
-- THE NON-PRODUCTION MARKER. `tenants.isNonProduction`, false for every
-- existing row, excludes a tenant from the platform totals and hides it behind
-- a toggle. It deletes nothing, suspends nothing and un-enrols nothing, and
-- THIS FILE MARKS NOBODY: which of the production tenants are fixtures is a
-- decision for their owner, made from `prisma/sql/tenant-volume.sql`.
--
-- ── How this migration is applied ────────────────────────────────────────────
--
--     psql "$DATABASE_URL" -f apps/api/prisma/migrations/20260913000000_add_rate_offset_disputes_and_onboarding/migration.sql
--
-- The production database has no `_prisma_migrations` table and has never been
-- managed by `prisma migrate`. This file is written for the way every migration
-- to date was applied: piped into psql by hand. It is additive only, idempotent
-- (every statement is IF NOT EXISTS or inside a guarded DO block), and safe
-- against a schema that has drifted from schema.prisma. It drops nothing and it
-- alters no existing column's type or nullability. Nothing in the deploy path
-- invokes the Prisma CLI.

-- ---------------------------------------------------------------------------
-- Enum values first, outside any transaction.
--
-- `ALTER TYPE ... ADD VALUE` is not permitted inside a transaction block before
-- PostgreSQL 12, and on 12 and later the new value cannot be USED in the
-- transaction that adds it -- and the DEFAULT on `paymentMethod` below does use
-- one. Each of these commits on its own when piped into psql.
--
-- IF NOT EXISTS so a re-run is a no-op rather than an error.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AgencyPaymentMethod') THEN
        CREATE TYPE "AgencyPaymentMethod" AS ENUM ('ACH', 'CARD');
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SettlementDisputeStatus') THEN
        CREATE TYPE "SettlementDisputeStatus" AS ENUM (
            'OPEN', 'UNDER_REVIEW', 'WON', 'LOST', 'WITHDRAWN'
        );
    END IF;
END
$$;

-- Delivery stopped because a card payment was disputed. Its own reason, not
-- folded into ADMIN_SUSPENDED: the platform view shows it as its own state and
-- an operator needs to know which of the two they are looking at.
ALTER TYPE "DeliveryHoldReason" ADD VALUE IF NOT EXISTS 'PAYMENT_DISPUTED';

-- Both platform-only. A chargeback is a payment event for NetEnroll to answer;
-- telling an agency's floor about it before anybody has looked is alarm, not
-- information.
ALTER TYPE "BillingNotificationKind" ADD VALUE IF NOT EXISTS 'PAYMENT_DISPUTE_OPENED';
ALTER TYPE "BillingNotificationKind" ADD VALUE IF NOT EXISTS 'PAYMENT_DISPUTE_UPDATED';

BEGIN;

-- ---------------------------------------------------------------------------
-- The rate offset, the payment method, and the card ceiling
--
-- Every one of these carries a default that reproduces today's behaviour: an
-- offset of zero prices straight off the curve, and ACH is what every existing
-- agency already pays by.
-- ---------------------------------------------------------------------------

ALTER TABLE "agency_billing_profiles"
    ADD COLUMN IF NOT EXISTS "rateOffset"     DECIMAL(10,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "ceilingPctCard" DECIMAL(6,2)  NOT NULL DEFAULT 25;

ALTER TABLE "agency_billing_profiles"
    ADD COLUMN IF NOT EXISTS "paymentMethod" "AgencyPaymentMethod" NOT NULL DEFAULT 'ACH';

-- The saved card, written only from a SetupIntent the server read back from
-- Stripe. `cardMandateStatus` reuses "AchMandateStatus" rather than growing a
-- parallel enum with the same four members.
ALTER TABLE "agency_billing_profiles"
    ADD COLUMN IF NOT EXISTS "cardPaymentMethodId"   TEXT,
    ADD COLUMN IF NOT EXISTS "cardMandateVerifiedAt" TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "cardBrand"             TEXT,
    ADD COLUMN IF NOT EXISTS "cardLast4"             TEXT;

ALTER TABLE "agency_billing_profiles"
    ADD COLUMN IF NOT EXISTS "cardMandateStatus" "AchMandateStatus" NOT NULL DEFAULT 'NONE';

-- ---------------------------------------------------------------------------
-- The two parts of a rate, stored beside the effective one
--
-- `rate_changes.newRate` and `daily_settlements.rate` keep their meaning -- the
-- rate actually applied -- and now carry the curve rate and the offset that
-- produced them, so either row recomputes from itself.
--
-- An existing row gets curveRate = its stored rate and rateOffset = 0, which is
-- exactly true of every row written before this file: no offset existed, so the
-- effective rate WAS the curve rate. That is a backfill of a value that is
-- already known, not an assumption.
-- ---------------------------------------------------------------------------

ALTER TABLE "rate_changes"
    ADD COLUMN IF NOT EXISTS "curveRate"  DECIMAL(10,2),
    ADD COLUMN IF NOT EXISTS "rateOffset" DECIMAL(10,2) NOT NULL DEFAULT 0;

UPDATE "rate_changes" SET "curveRate" = "newRate"
 WHERE "curveRate" IS NULL AND "newRate" IS NOT NULL;

ALTER TABLE "daily_settlements"
    ADD COLUMN IF NOT EXISTS "curveRate"  DECIMAL(10,2),
    ADD COLUMN IF NOT EXISTS "rateOffset" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- The backfill runs BEFORE the immutability trigger is taught about these two
-- columns, immediately below. The order is deliberate and it is the whole
-- reason this is safe: the trigger as it stands does not guard columns that did
-- not exist, so this one-time write of a value the row already implies goes
-- through without the trigger ever being disabled. A migration that switched
-- off the guard on `daily_settlements` would be a migration that could, in
-- principle, rewrite what an agency was charged.
UPDATE "daily_settlements" SET "curveRate" = "rate"
 WHERE "curveRate" IS NULL AND "rate" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- ... and then they are immutable too
--
-- `curveRate` and `rateOffset` are figures the settlement was written with, so
-- they belong under the same guard as `rate` itself. This is what makes
-- "changing an agency's offset never alters a completed settlement" a property
-- of the database rather than a convention.
--
-- Repeated verbatim in prisma/sql/db-push-constraints.sql, which CI runs after
-- `prisma db push` -- db push builds from schema.prisma, which cannot express a
-- trigger.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "hopwhistle_settlement_figures_immutable"() RETURNS TRIGGER AS $fn$
BEGIN
    IF NEW."tenantId"                IS DISTINCT FROM OLD."tenantId"
    OR NEW."deliveryDay"             IS DISTINCT FROM OLD."deliveryDay"
    OR NEW."deliveredCalls"          IS DISTINCT FROM OLD."deliveredCalls"
    OR NEW."submittedApplications"   IS DISTINCT FROM OLD."submittedApplications"
    OR NEW."windowClosingPct"        IS DISTINCT FROM OLD."windowClosingPct"
    OR NEW."windowDeliveryDays"      IS DISTINCT FROM OLD."windowDeliveryDays"
    OR NEW."windowDaysFound"         IS DISTINCT FROM OLD."windowDaysFound"
    OR NEW."windowDayKeys"           IS DISTINCT FROM OLD."windowDayKeys"
    OR NEW."rate"                    IS DISTINCT FROM OLD."rate"
    OR NEW."curveRate"               IS DISTINCT FROM OLD."curveRate"
    OR NEW."rateOffset"              IS DISTINCT FROM OLD."rateOffset"
    OR NEW."curveVersionId"          IS DISTINCT FROM OLD."curveVersionId"
    OR NEW."curveVersion"            IS DISTINCT FROM OLD."curveVersion"
    OR NEW."rateChangeId"            IS DISTINCT FROM OLD."rateChangeId"
    OR NEW."overrunQuantity"         IS DISTINCT FROM OLD."overrunQuantity"
    OR NEW."overrunAmount"           IS DISTINCT FROM OLD."overrunAmount"
    OR NEW."configuredBlockQuantity" IS DISTINCT FROM OLD."configuredBlockQuantity"
    OR NEW."unusedPaidApplications"  IS DISTINCT FROM OLD."unusedPaidApplications"
    OR NEW."nextBlockQuantity"       IS DISTINCT FROM OLD."nextBlockQuantity"
    OR NEW."nextBlockAmount"         IS DISTINCT FROM OLD."nextBlockAmount"
    OR NEW."totalCharged"            IS DISTINCT FROM OLD."totalCharged"
    OR NEW."maxDailyDebit"           IS DISTINCT FROM OLD."maxDailyDebit"
    OR NEW."computedAt"              IS DISTINCT FROM OLD."computedAt"
    THEN
        RAISE EXCEPTION
            'daily_settlements row % is immutable: only the payment lifecycle may advance.',
            OLD."id";
    END IF;
    RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "daily_settlements_figures_immutable" ON "daily_settlements";
CREATE TRIGGER "daily_settlements_figures_immutable"
    BEFORE UPDATE ON "daily_settlements"
    FOR EACH ROW EXECUTE FUNCTION "hopwhistle_settlement_figures_immutable"();

-- ---------------------------------------------------------------------------
-- The non-production marker
--
-- DEFAULT false, and no UPDATE anywhere in this file sets it. Production has
-- five tenants and none of them is a real agency, but which is which is not
-- something a migration may guess: run `prisma/sql/tenant-volume.sql` and
-- decide.
-- ---------------------------------------------------------------------------

ALTER TABLE "tenants"
    ADD COLUMN IF NOT EXISTS "isNonProduction"             BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "nonProductionNote"           TEXT,
    ADD COLUMN IF NOT EXISTS "nonProductionMarkedAt"       TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "nonProductionMarkedByUserId" TEXT;

CREATE INDEX IF NOT EXISTS "tenants_isNonProduction_idx"
    ON "tenants"("isNonProduction");

-- ---------------------------------------------------------------------------
-- The agency's own identity and delivery schedule
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "agency_profiles" (
    "id"                 TEXT         NOT NULL,
    "tenantId"           TEXT         NOT NULL,
    "legalName"          TEXT         NOT NULL,
    "state"              TEXT         NOT NULL,
    "contactName"        TEXT         NOT NULL,
    "contactEmail"       TEXT         NOT NULL,
    "contactPhone"       TEXT         NOT NULL,
    "licensedAgentCount" INTEGER      NOT NULL,
    "deliveryDays"       TEXT[]       NOT NULL,
    "deliveryStartTime"  TEXT         NOT NULL,
    "deliveryEndTime"    TEXT         NOT NULL,
    "deliveryTimeZone"   TEXT         NOT NULL DEFAULT 'America/New_York',
    "createdByUserId"    TEXT,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- No DB default, matching what `@updatedAt` generates everywhere else in
    -- this schema: Prisma writes the value on every insert and update, and a
    -- DEFAULT here would be drift against schema.prisma.
    "updatedAt"          TIMESTAMP(3) NOT NULL,
    CONSTRAINT "agency_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "agency_profiles_tenantId_key"
    ON "agency_profiles"("tenantId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'agency_profiles_tenantId_fkey'
    ) THEN
        ALTER TABLE "agency_profiles"
            ADD CONSTRAINT "agency_profiles_tenantId_fkey"
            FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Card disputes
--
-- One row per Stripe dispute, against the settlement whose payment intent it
-- names when that can be identified. `stripeDisputeId` is unique, so a webhook
-- delivered twice records one dispute rather than two.
--
-- `deliveryResumedAt` is null until a platform admin explicitly stands the
-- suspension down. Nothing sets it automatically, and closing a dispute -- in
-- our favour or not -- does not set it.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "settlement_disputes" (
    "id"                      TEXT          NOT NULL,
    "tenantId"                TEXT          NOT NULL,
    "settlementId"            TEXT,
    "stripeDisputeId"         TEXT          NOT NULL,
    "stripeChargeId"          TEXT,
    "stripePaymentIntentId"   TEXT,
    "amount"                  DECIMAL(12,2) NOT NULL,
    "reason"                  TEXT,
    "status"                  "SettlementDisputeStatus" NOT NULL DEFAULT 'OPEN',
    "stripeStatus"            TEXT,
    "openedAt"                TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt"                TIMESTAMP(3),
    "deliveryResumedAt"       TIMESTAMP(3),
    "deliveryResumedByUserId" TEXT,
    "deliveryResumedNote"     TEXT,
    -- No DB default, for the same reason as above.
    "updatedAt"               TIMESTAMP(3)  NOT NULL,
    CONSTRAINT "settlement_disputes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "settlement_disputes_stripeDisputeId_key"
    ON "settlement_disputes"("stripeDisputeId");

-- The gate asks "does this tenant have a dispute nobody has stood down from"
-- on every call offered, so that is the index.
CREATE INDEX IF NOT EXISTS "settlement_disputes_tenantId_deliveryResumedAt_idx"
    ON "settlement_disputes"("tenantId", "deliveryResumedAt");

CREATE INDEX IF NOT EXISTS "settlement_disputes_tenantId_status_idx"
    ON "settlement_disputes"("tenantId", "status");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'settlement_disputes_tenantId_fkey'
    ) THEN
        ALTER TABLE "settlement_disputes"
            ADD CONSTRAINT "settlement_disputes_tenantId_fkey"
            FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'settlement_disputes_settlementId_fkey'
    ) THEN
        ALTER TABLE "settlement_disputes"
            ADD CONSTRAINT "settlement_disputes_settlementId_fkey"
            FOREIGN KEY ("settlementId") REFERENCES "daily_settlements"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END
$$;

COMMIT;
