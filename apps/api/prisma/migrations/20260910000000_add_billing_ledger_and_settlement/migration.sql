-- Phase 3: the credit ledger, Overrun, delivery gating and daily settlement.
--
-- ── How this migration is applied ────────────────────────────────────────────
--
-- The production database has no "_prisma_migrations" table and has never been
-- managed by `prisma migrate`. Every migration to date was applied by piping
-- its migration.sql into psql by hand, and this one is written to be applied
-- the same way:
--
--     psql "$DATABASE_URL" -f apps/api/prisma/migrations/20260910000000_add_billing_ledger_and_settlement/migration.sql
--
-- So it is additive only, idempotent, and safe against a schema that may have
-- drifted from schema.prisma. Every statement is IF NOT EXISTS or guarded by a
-- DO block; running it twice is a no-op. It drops nothing, and it alters no
-- existing column's type or nullability -- the only ALTERs below add one
-- nullable column and two DEFAULTs.
--
-- Nothing is added to the deploy path to apply it. In particular no
-- `prisma migrate deploy`: against an empty migration history that would try to
-- replay every migration from the beginning.
--
-- ── What it adds ─────────────────────────────────────────────────────────────
--
-- One nullable column and one index on "calls"; DEFAULTs on the two retired
-- introductory columns; five enums; six tables; and three triggers that make
-- "append-only" and "immutable" properties of the database rather than
-- conventions in the application.
--
-- ── What it deliberately does not add ────────────────────────────────────────
--
-- No refund, credit, reversal, rebate or make-good: not a table, not a column,
-- not an enum member. A carrier's decision after an application is submitted
-- never returns money, and the absence of the schema is what makes that true.
--
-- No balance counter. The balance is SUM("quantity") over the ledger, always.

BEGIN;

-- ---------------------------------------------------------------------------
-- Delivered calls, per agent
--
-- The softphone answer handler already knew which agent picked up and recorded
-- it inside `metadata`, where it cannot be indexed. The agency principal's
-- per-agent table is read live at 450 calls a day, so it becomes a column.
--
-- This does NOT narrow the Phase 2 delivered-call definition. A delivered call
-- is still a row with "answeredAt" set; this column only says which agent, and
-- a row where it is null is still delivered and still in the denominator.
-- ---------------------------------------------------------------------------

ALTER TABLE "calls"
    ADD COLUMN IF NOT EXISTS "answeredByUserId" TEXT;

-- Backfill from the JSON the answer handler has been writing all along.
-- Guarded on IS NULL so a re-run never overwrites a value already set, and on
-- the id actually existing in "users" so a stale metadata value cannot create a
-- per-agent row for somebody who is not an agent of this agency.
UPDATE "calls" c
   SET "answeredByUserId" = c."metadata"->>'answeredByAgentId'
 WHERE c."answeredByUserId" IS NULL
   AND c."metadata" ? 'answeredByAgentId'
   AND EXISTS (
       SELECT 1 FROM "users" u
        WHERE u."id" = c."metadata"->>'answeredByAgentId'
   );

CREATE INDEX IF NOT EXISTS "calls_tenantId_answeredByUserId_answeredAt_idx"
    ON "calls"("tenantId", "answeredByUserId", "answeredAt");

-- ---------------------------------------------------------------------------
-- The introductory package is retired
--
-- There is no introductory rate. An agency's opening rate and opening block are
-- agreed before its first Delivery Day and recorded per tenant; from the second
-- Delivery Day the rate curve governs.
--
-- The columns are NOT dropped. Dropping a column is the one thing an additive
-- migration must never do, and this file is applied by hand to a database with
-- no migration history to roll forward from. They get DEFAULTs instead, so a
-- new curve version can be published without supplying a number nobody reads.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'rate_curve_versions' AND column_name = 'introductoryRate'
    ) THEN
        ALTER TABLE "rate_curve_versions" ALTER COLUMN "introductoryRate" SET DEFAULT 0;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'rate_curve_versions' AND column_name = 'introductoryApplications'
    ) THEN
        ALTER TABLE "rate_curve_versions" ALTER COLUMN "introductoryApplications" SET DEFAULT 0;
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CreditLedgerEntryType') THEN
        -- No REFUND, CREDIT, REVERSAL or ADJUSTMENT member, deliberately.
        CREATE TYPE "CreditLedgerEntryType" AS ENUM ('PURCHASE', 'CONSUMPTION', 'OVERRUN');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SettlementPaymentStatus') THEN
        CREATE TYPE "SettlementPaymentStatus" AS ENUM (
            'PENDING', 'SUCCEEDED', 'FAILED', 'NOT_CHARGED',
            'HALTED_MAX_DEBIT', 'HALTED_NO_MANDATE'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AchMandateStatus') THEN
        CREATE TYPE "AchMandateStatus" AS ENUM ('NONE', 'PENDING_VERIFICATION', 'ACTIVE', 'REVOKED');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DeliveryHoldReason') THEN
        CREATE TYPE "DeliveryHoldReason" AS ENUM (
            'CEILING_REACHED', 'BELOW_MINIMUM_CLOSING', 'SETTLEMENT_UNPAID',
            'NO_MANDATE', 'ADMIN_SUSPENDED', 'NO_OPENING_AGREEMENT'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BillingNotificationKind') THEN
        CREATE TYPE "BillingNotificationKind" AS ENUM (
            'SETTLEMENT_FAILED', 'SETTLEMENT_UNPAID_GRACE_EXPIRED',
            'MAX_DAILY_DEBIT_EXCEEDED', 'CEILING_REACHED', 'DELIVERY_PAUSED',
            'MANDATE_MISSING', 'SETTLEMENT_RUN_FAILED'
        );
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- One agency's commercial terms and payment instrument
--
-- Every figure here bounds what the agency can be charged, so every one is set
-- by a platform admin or written by the server from a Stripe object it
-- retrieved itself. None of them is settable from an agency's browser.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "agency_billing_profiles" (
    "id"                              TEXT NOT NULL,
    "tenantId"                        TEXT NOT NULL,
    "dailyBlockApplications"          INTEGER NOT NULL DEFAULT 0,
    "maxDailyDebit"                   DECIMAL(12,2) NOT NULL,
    "ceilingPctBelowThreshold"        DECIMAL(6,2) NOT NULL DEFAULT 50,
    "ceilingPctAtThreshold"           DECIMAL(6,2) NOT NULL DEFAULT 100,
    "ceilingCleanSettlementThreshold" INTEGER NOT NULL DEFAULT 10,
    "ceilingPctOverride"              DECIMAL(6,2),
    "ceilingOverrideByUserId"         TEXT,
    "ceilingOverrideNote"             TEXT,
    "ceilingOverrideAt"               TIMESTAMP(3),
    "stripeCustomerId"                TEXT,
    "achPaymentMethodId"              TEXT,
    "achMandateStatus"                "AchMandateStatus" NOT NULL DEFAULT 'NONE',
    "achMandateVerifiedAt"            TIMESTAMP(3),
    "achBankName"                     TEXT,
    "achLast4"                        TEXT,
    "suspendedAt"                     TIMESTAMP(3),
    "suspendedByUserId"               TEXT,
    "suspensionReason"                TEXT,
    "createdAt"                       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- No DEFAULT, deliberately: Prisma's @updatedAt writes this from the client
    -- and generates the column without one. A default here would be invisible
    -- schema drift for the sake of nothing -- the only writer is Prisma.
    "updatedAt"                       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "agency_billing_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "agency_billing_profiles_tenantId_key"
    ON "agency_billing_profiles"("tenantId");

-- ---------------------------------------------------------------------------
-- The settlement record
--
-- Created before the ledger table because the ledger's "settlementId" points at
-- it. One row per agency per Delivery Day, and that uniqueness IS the
-- idempotency of the nightly job: a second run cannot double charge, cannot
-- sell a second block and cannot re-apply a rate, because the insert fails.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "daily_settlements" (
    "id"                      TEXT NOT NULL,
    "tenantId"                TEXT NOT NULL,
    "deliveryDay"             TEXT NOT NULL,
    "deliveredCalls"          INTEGER NOT NULL,
    "submittedApplications"   INTEGER NOT NULL,
    "windowClosingPct"        DECIMAL(9,6),
    "windowDeliveryDays"      INTEGER NOT NULL,
    "windowDaysFound"         INTEGER NOT NULL,
    "windowDayKeys"           TEXT[],
    "rate"                    DECIMAL(10,2),
    "curveVersionId"          TEXT,
    "curveVersion"            INTEGER,
    "rateChangeId"            TEXT,
    "overrunQuantity"         INTEGER NOT NULL DEFAULT 0,
    "overrunAmount"           DECIMAL(12,2) NOT NULL DEFAULT 0,
    "configuredBlockQuantity" INTEGER NOT NULL DEFAULT 0,
    "unusedPaidApplications"  INTEGER NOT NULL DEFAULT 0,
    "nextBlockQuantity"       INTEGER NOT NULL DEFAULT 0,
    "nextBlockAmount"         DECIMAL(12,2) NOT NULL DEFAULT 0,
    "totalCharged"            DECIMAL(12,2) NOT NULL DEFAULT 0,
    "maxDailyDebit"           DECIMAL(12,2) NOT NULL,
    "paymentStatus"           "SettlementPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "stripePaymentIntentId"   TEXT,
    "paymentFailureCode"      TEXT,
    "paymentFailureMessage"   TEXT,
    "paidAt"                  TIMESTAMP(3),
    "gracePeriodEndsOn"       TEXT,
    "computedAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "daily_settlements_pkey" PRIMARY KEY ("id")
);

-- The idempotency constraint. Not a check-then-act.
CREATE UNIQUE INDEX IF NOT EXISTS "daily_settlements_tenantId_deliveryDay_key"
    ON "daily_settlements"("tenantId", "deliveryDay");
CREATE INDEX IF NOT EXISTS "daily_settlements_tenantId_deliveryDay_idx"
    ON "daily_settlements"("tenantId", "deliveryDay");
CREATE INDEX IF NOT EXISTS "daily_settlements_paymentStatus_idx"
    ON "daily_settlements"("paymentStatus");

-- ---------------------------------------------------------------------------
-- The credit ledger
--
-- Append-only, per tenant, and the only source of a balance:
--
--     balance = SUM("quantity") WHERE "tenantId" = $1
--
-- There is no counter column here or anywhere else. A counter is wrong the
-- first time a write is retried, and this one decides whether a call is
-- delivered.
--
-- Two unique indexes carry the guarantees the application must not be trusted
-- with:
--
--   ("applicationId")               one row per application, ever. An
--                                   application that reaches submitted state
--                                   twice spends one credit -- or is recorded
--                                   as one overrun -- never both, never two.
--
--   ("purchaseEntryId","lotIndex")  one consumption per unit of a purchase lot.
--                                   Two applications submitted at the same
--                                   instant both compute the same next free
--                                   index; the database admits one and rejects
--                                   the other, which retries onto the next unit.
--                                   That is what stops two applications
--                                   spending the same credit.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "application_credit_ledger" (
    "id"                    TEXT NOT NULL,
    "tenantId"              TEXT NOT NULL,
    "entryType"             "CreditLedgerEntryType" NOT NULL,
    "quantity"              INTEGER NOT NULL,
    "deliveryDay"           TEXT NOT NULL,
    "unitRate"              DECIMAL(10,2),
    "amount"                DECIMAL(12,2),
    "curveVersionId"        TEXT,
    "curveVersion"          INTEGER,
    "applicationId"         TEXT,
    "purchaseEntryId"       TEXT,
    "lotIndex"              INTEGER,
    "stripePaymentIntentId" TEXT,
    "settlementId"          TEXT,
    "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "application_credit_ledger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "application_credit_ledger_applicationId_key"
    ON "application_credit_ledger"("applicationId");
CREATE UNIQUE INDEX IF NOT EXISTS "application_credit_ledger_purchaseEntryId_lotIndex_key"
    ON "application_credit_ledger"("purchaseEntryId", "lotIndex");
CREATE INDEX IF NOT EXISTS "application_credit_ledger_tenantId_createdAt_idx"
    ON "application_credit_ledger"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "application_credit_ledger_tenantId_entryType_createdAt_idx"
    ON "application_credit_ledger"("tenantId", "entryType", "createdAt");
CREATE INDEX IF NOT EXISTS "application_credit_ledger_tenantId_deliveryDay_idx"
    ON "application_credit_ledger"("tenantId", "deliveryDay");
CREATE INDEX IF NOT EXISTS "application_credit_ledger_settlementId_idx"
    ON "application_credit_ledger"("settlementId");

-- ---------------------------------------------------------------------------
-- Payment attempts, delivery holds, notifications
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "settlement_payment_attempts" (
    "id"                    TEXT NOT NULL,
    "settlementId"          TEXT NOT NULL,
    "attemptNumber"         INTEGER NOT NULL,
    "status"                "SettlementPaymentStatus" NOT NULL,
    "amount"                DECIMAL(12,2) NOT NULL,
    "stripePaymentIntentId" TEXT,
    "failureCode"           TEXT,
    "failureMessage"        TEXT,
    "occurredAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "settlement_payment_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "settlement_payment_attempts_settlementId_attemptNumber_key"
    ON "settlement_payment_attempts"("settlementId", "attemptNumber");
CREATE INDEX IF NOT EXISTS "settlement_payment_attempts_settlementId_idx"
    ON "settlement_payment_attempts"("settlementId");

-- One row per agency per Delivery Day per reason. The uniqueness is also the
-- notification de-duplication: the insert either wins and sends, or loses and
-- does not, so platform admins are told once rather than once per refused call.
CREATE TABLE IF NOT EXISTS "delivery_hold_events" (
    "id"          TEXT NOT NULL,
    "tenantId"    TEXT NOT NULL,
    "deliveryDay" TEXT NOT NULL,
    "reason"      "DeliveryHoldReason" NOT NULL,
    "detail"      JSONB,
    "occurredAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "delivery_hold_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "delivery_hold_events_tenantId_deliveryDay_reason_key"
    ON "delivery_hold_events"("tenantId", "deliveryDay", "reason");
CREATE INDEX IF NOT EXISTS "delivery_hold_events_tenantId_occurredAt_idx"
    ON "delivery_hold_events"("tenantId", "occurredAt");

-- The row is the record. Email and Slack are best-effort transports on top of
-- it, so "the agency and platform admins were notified" is answerable from the
-- database even when a transport was down.
CREATE TABLE IF NOT EXISTS "billing_notifications" (
    "id"         TEXT NOT NULL,
    "tenantId"   TEXT NOT NULL,
    "kind"       "BillingNotificationKind" NOT NULL,
    "toAgency"   BOOLEAN NOT NULL DEFAULT false,
    "toPlatform" BOOLEAN NOT NULL DEFAULT false,
    "subject"    TEXT NOT NULL,
    "body"       TEXT NOT NULL,
    "detail"     JSONB,
    "sentVia"    TEXT[],
    "subjectKey" TEXT NOT NULL,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "billing_notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "billing_notifications_tenantId_kind_subjectKey_key"
    ON "billing_notifications"("tenantId", "kind", "subjectKey");
CREATE INDEX IF NOT EXISTS "billing_notifications_tenantId_createdAt_idx"
    ON "billing_notifications"("tenantId", "createdAt");

-- ---------------------------------------------------------------------------
-- Foreign keys
--
-- Added in guarded blocks rather than inline, so re-running the file does not
-- fail on a constraint that already exists.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agency_billing_profiles_tenantId_fkey') THEN
        ALTER TABLE "agency_billing_profiles"
            ADD CONSTRAINT "agency_billing_profiles_tenantId_fkey"
            FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON UPDATE CASCADE ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_settlements_tenantId_fkey') THEN
        ALTER TABLE "daily_settlements"
            ADD CONSTRAINT "daily_settlements_tenantId_fkey"
            FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON UPDATE CASCADE ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'application_credit_ledger_tenantId_fkey') THEN
        ALTER TABLE "application_credit_ledger"
            ADD CONSTRAINT "application_credit_ledger_tenantId_fkey"
            FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON UPDATE CASCADE ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'application_credit_ledger_purchaseEntryId_fkey') THEN
        ALTER TABLE "application_credit_ledger"
            ADD CONSTRAINT "application_credit_ledger_purchaseEntryId_fkey"
            FOREIGN KEY ("purchaseEntryId") REFERENCES "application_credit_ledger"("id") ON UPDATE CASCADE ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'application_credit_ledger_settlementId_fkey') THEN
        ALTER TABLE "application_credit_ledger"
            ADD CONSTRAINT "application_credit_ledger_settlementId_fkey"
            FOREIGN KEY ("settlementId") REFERENCES "daily_settlements"("id") ON UPDATE CASCADE ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'settlement_payment_attempts_settlementId_fkey') THEN
        ALTER TABLE "settlement_payment_attempts"
            ADD CONSTRAINT "settlement_payment_attempts_settlementId_fkey"
            FOREIGN KEY ("settlementId") REFERENCES "daily_settlements"("id") ON UPDATE CASCADE ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'delivery_hold_events_tenantId_fkey') THEN
        ALTER TABLE "delivery_hold_events"
            ADD CONSTRAINT "delivery_hold_events_tenantId_fkey"
            FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON UPDATE CASCADE ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'billing_notifications_tenantId_fkey') THEN
        ALTER TABLE "billing_notifications"
            ADD CONSTRAINT "billing_notifications_tenantId_fkey"
            FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON UPDATE CASCADE ON DELETE CASCADE;
    END IF;
END
$$;

COMMIT;

-- ---------------------------------------------------------------------------
-- Append-only and immutability, enforced by the database
--
-- These are the properties the whole phase rests on, so they are not left to
-- the application. A `prisma db push` cannot create them either, which is why
-- they are repeated verbatim in prisma/sql/db-push-constraints.sql -- the file
-- CI runs immediately after building a schema from schema.prisma.
--
-- \i is not used and no psql meta-command appears anywhere in this file: it is
-- piped into psql by hand and must work when it is redirected on stdin.
-- ---------------------------------------------------------------------------

-- Nothing in this system mutates a balance. Not "no code path does" -- the
-- database refuses. A correction is a later row.
CREATE OR REPLACE FUNCTION "hopwhistle_ledger_append_only"() RETURNS TRIGGER AS $fn$
BEGIN
    RAISE EXCEPTION
        'application_credit_ledger is append-only: % on row % is refused. A correction is a later row.',
        TG_OP, COALESCE(OLD."id", '?');
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "application_credit_ledger_append_only" ON "application_credit_ledger";
CREATE TRIGGER "application_credit_ledger_append_only"
    BEFORE UPDATE OR DELETE ON "application_credit_ledger"
    FOR EACH ROW EXECUTE FUNCTION "hopwhistle_ledger_append_only"();

-- A settlement's figures are written once, inside the transaction that creates
-- the row, and never change. The payment lifecycle is the only thing that
-- advances afterwards, and every transition of it is also an appended
-- settlement_payment_attempts row.
--
-- An agency disputing a charge is answered from the settlement row, so the row
-- has to still say what it said on the night.
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

-- Every attempt at a debit is a row, and the row does not change afterwards.
CREATE OR REPLACE FUNCTION "hopwhistle_payment_attempts_append_only"() RETURNS TRIGGER AS $fn$
BEGIN
    RAISE EXCEPTION
        'settlement_payment_attempts is append-only: % is refused. A later attempt is a later row.',
        TG_OP;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "settlement_payment_attempts_append_only" ON "settlement_payment_attempts";
CREATE TRIGGER "settlement_payment_attempts_append_only"
    BEFORE UPDATE OR DELETE ON "settlement_payment_attempts"
    FOR EACH ROW EXECUTE FUNCTION "hopwhistle_payment_attempts_append_only"();
