-- Constraints that `prisma db push` cannot create.
--
-- db push builds a database from schema.prisma alone. Prisma's schema language
-- cannot express a partial unique index, so any such constraint lives only in
-- migration SQL -- and `prisma migrate deploy` has not run from an empty
-- database for some time (the history is missing CREATE TABLE for leads and
-- ai_campaign_calls, so it fails part way). Every database here is therefore
-- built by db push, and every constraint in this file was simply absent.
--
-- Run this immediately after db push, wherever a schema is created.
-- Every statement must be idempotent: this runs on databases that may already
-- have the object.

-- One active reservation per lead.
--
-- Without it, concurrent workers each see a lead as reservable and each claim
-- it -- ten simultaneous workers produced five winners in CI, which in
-- production means five agents dialing the same person at once. The worker's
-- reserve() relies on the insert failing for the losers; there is nothing else
-- serialising them.
--
-- Mirrors 20260803000000_add_lead_dial_reservations/migration.sql, which is
-- where this was first written and where it stopped being applied.
CREATE UNIQUE INDEX IF NOT EXISTS "lead_dial_reservations_active_lead_key"
  ON "lead_dial_reservations" ("leadId")
  WHERE "releasedAt" IS NULL;


-- ---------------------------------------------------------------------------
-- Phase 3: the credit ledger is append-only and a settlement's figures are
-- immutable.
--
-- These are the properties the whole billing phase rests on, so they are
-- database triggers rather than conventions in the application. `db push`
-- builds from schema.prisma, which cannot express a trigger, so without this
-- file every database CI and every developer works against would silently
-- permit an UPDATE that moves a balance.
--
-- Verbatim from
-- prisma/migrations/20260910000000_add_billing_ledger_and_settlement/migration.sql,
-- which is where they are applied to production.
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
