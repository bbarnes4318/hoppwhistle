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


-- ---------------------------------------------------------------------------
-- Publisher clawbacks: a return accepted after the publisher was paid is a
-- negative publisher_payments row, deducted from that publisher's next payment.
--
-- The CHECK keeps the sign tied to the kind, and the partial unique index is
-- what stops one call being clawed back twice. The callId foreign key is here
-- too: schema.prisma declares callId as a plain column, so db push leaves it
-- unconstrained.
--
-- Mirrors prisma/migrations/20260927000000_publisher_payment_clawbacks/migration.sql
-- and 20260928000000_clawback_check_callid/migration.sql, which is where they
-- are applied to production.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'publisher_payments_callId_fkey') THEN
    ALTER TABLE "publisher_payments"
      ADD CONSTRAINT "publisher_payments_callId_fkey"
      FOREIGN KEY ("callId") REFERENCES "calls"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- A clawback outlives its call: the callId foreign key is ON DELETE SET NULL,
-- so the CHECK must not require callId. Dropped and re-added so a database
-- built before 20260928000000_clawback_check_callid gets the new definition.
ALTER TABLE "publisher_payments"
  DROP CONSTRAINT IF EXISTS "publisher_payments_kind_amount_check";
ALTER TABLE "publisher_payments"
  ADD CONSTRAINT "publisher_payments_kind_amount_check"
  CHECK (
    ("kind" = 'PAYMENT' AND "amount" > 0)
    OR ("kind" = 'CLAWBACK' AND "amount" < 0)
  );

CREATE UNIQUE INDEX IF NOT EXISTS "publisher_payments_clawback_call_key"
  ON "publisher_payments"("callId") WHERE "kind" = 'CLAWBACK';

CREATE INDEX IF NOT EXISTS "publisher_payments_unapplied_idx"
  ON "publisher_payments"("tenantId", "publisherId")
  WHERE "kind" = 'CLAWBACK' AND "appliedToPaymentId" IS NULL;


-- ---------------------------------------------------------------------------
-- Upgrade requests: one OPEN request per agency per upgrade.
--
-- "Request this upgrade" pressed twice returns the same open request rather
-- than a second one; the route relies on this index to settle the race. The
-- status CHECK is here too, since schema.prisma declares status as plain text.
--
-- Mirrors prisma/migrations/20261002000000_upgrade_catalog/migration.sql,
-- which is where they are applied to production.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS "upgrade_requests_open_tenant_key"
  ON "upgrade_requests"("tenantId", "upgradeKey")
  WHERE "status" = 'OPEN';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'upgrade_requests_status_check') THEN
    ALTER TABLE "upgrade_requests"
      ADD CONSTRAINT "upgrade_requests_status_check"
      CHECK ("status" IN ('OPEN', 'DONE', 'DECLINED'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Upgrade prices: what a price is per.
--
-- Mirrors prisma/migrations/20261003000000_upgrade_price_units/migration.sql.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'upgrade_prices_price_unit_check') THEN
    ALTER TABLE "upgrade_prices"
      ADD CONSTRAINT "upgrade_prices_price_unit_check"
      CHECK ("priceUnit" IN ('AGENCY', 'AGENT'));
  END IF;
END $$;


-- From prisma/migrations/20261007000000_agreements/migration.sql, with the
-- two trigger functions as 20261008000000_agreements_party_details replaces
-- them. Those migrations are where they are applied to production.
-- ---------------------------------------------------------------------------
-- Electronic agreements: the evidence rows are immutable.
-- ---------------------------------------------------------------------------

-- The audit trail is append-only. A correction is a later event.
CREATE OR REPLACE FUNCTION "agreement_events_append_only"() RETURNS TRIGGER AS $fn$
BEGIN
    RAISE EXCEPTION
        'agreement_events is append-only: % on event % is refused.',
        TG_OP, COALESCE(OLD."id", '?');
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "agreement_events_append_only" ON "agreement_events";
CREATE TRIGGER "agreement_events_append_only"
    BEFORE UPDATE OR DELETE ON "agreement_events"
    FOR EACH ROW EXECUTE FUNCTION "agreement_events_append_only"();

-- What the signer was shown never changes, and an executed PDF is written once.
CREATE OR REPLACE FUNCTION "agreement_documents_immutable"() RETURNS TRIGGER AS $fn$
BEGIN
    IF NEW."sentHtml" IS DISTINCT FROM OLD."sentHtml"
       OR NEW."sentHtmlSha256" IS DISTINCT FROM OLD."sentHtmlSha256" THEN
        RAISE EXCEPTION 'agreement_documents: the as-sent document % cannot be changed.', OLD."id";
    END IF;
    IF OLD."presentedHtml" IS NOT NULL AND (
         NEW."presentedHtml" IS DISTINCT FROM OLD."presentedHtml"
         OR NEW."presentedHtmlSha256" IS DISTINCT FROM OLD."presentedHtmlSha256") THEN
        RAISE EXCEPTION 'agreement_documents: the as-presented document % cannot be changed.', OLD."id";
    END IF;
    IF OLD."executedPdfKey" IS NOT NULL AND NEW."executedPdfKey" IS DISTINCT FROM OLD."executedPdfKey" THEN
        RAISE EXCEPTION 'agreement_documents: the executed PDF key of % cannot be changed.', OLD."id";
    END IF;
    IF OLD."executedPdfSha256" IS NOT NULL AND NEW."executedPdfSha256" IS DISTINCT FROM OLD."executedPdfSha256" THEN
        RAISE EXCEPTION 'agreement_documents: the executed PDF hash of % cannot be changed.', OLD."id";
    END IF;
    RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "agreement_documents_immutable" ON "agreement_documents";
CREATE TRIGGER "agreement_documents_immutable"
    BEFORE UPDATE ON "agreement_documents"
    FOR EACH ROW EXECUTE FUNCTION "agreement_documents_immutable"();

-- The frozen terms, the address the link went to and the link itself.
CREATE OR REPLACE FUNCTION "agreement_envelopes_immutable"() RETURNS TRIGGER AS $fn$
BEGIN
    IF NEW."terms" IS DISTINCT FROM OLD."terms" THEN
        RAISE EXCEPTION 'agreement_envelopes: the terms of % are frozen at send.', OLD."id";
    END IF;
    IF NEW."signerEmail" IS DISTINCT FROM OLD."signerEmail" THEN
        RAISE EXCEPTION 'agreement_envelopes: the signer email of % cannot be changed.', OLD."id";
    END IF;
    IF NEW."signTokenHash" IS DISTINCT FROM OLD."signTokenHash" THEN
        RAISE EXCEPTION 'agreement_envelopes: the signing link of % is never reissued.', OLD."id";
    END IF;
    IF OLD."partyDetails" IS NOT NULL AND NEW."partyDetails" IS DISTINCT FROM OLD."partyDetails" THEN
        RAISE EXCEPTION 'agreement_envelopes: the agency details of % cannot be changed once entered.', OLD."id";
    END IF;
    RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "agreement_envelopes_immutable" ON "agreement_envelopes";
CREATE TRIGGER "agreement_envelopes_immutable"
    BEFORE UPDATE ON "agreement_envelopes"
    FOR EACH ROW EXECUTE FUNCTION "agreement_envelopes_immutable"();


-- From prisma/migrations/20261009000000_sales_workspaces/migration.sql, which
-- is where they are applied to production: the one-PLATFORM-workspace index,
-- the check constraints, and the triggers that keep an envelope's issuer fixed,
-- its prospect in the same workspace, and every Sales CRM grant inside the
-- workspace's own tenant. The envelope trigger function here replaces the one
-- above; it is the same function plus the issuer columns.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS "sales_workspaces_platform_singleton" ON "sales_workspaces"("scopeType") WHERE "scopeType" = 'PLATFORM';

-- ── Check constraints ────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_workspaces_scope_tenant_check') THEN
    ALTER TABLE "sales_workspaces" ADD CONSTRAINT "sales_workspaces_scope_tenant_check" CHECK (
      ("scopeType" = 'PLATFORM' AND "tenantId" IS NULL) OR ("scopeType" = 'TENANT' AND "tenantId" IS NOT NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agreement_suites_reference_prefix_check') THEN
    ALTER TABLE "agreement_suites" ADD CONSTRAINT "agreement_suites_reference_prefix_check" CHECK ("referencePrefix" ~ '^[A-Z]{2,5}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agreement_suites_seal_ref_check') THEN
    -- A name, never key material: no base64 blob fits this.
    ALTER TABLE "agreement_suites" ADD CONSTRAINT "agreement_suites_seal_ref_check" CHECK ("sealSecretRef" IS NULL OR "sealSecretRef" ~ '^[A-Z][A-Z0-9_]{0,39}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_prospects_identity_check') THEN
    ALTER TABLE "sales_prospects" ADD CONSTRAINT "sales_prospects_identity_check" CHECK (
      COALESCE(NULLIF(btrim("companyName"), ''), NULLIF(btrim("primaryContactName"), ''),
               NULLIF(btrim("firstName"), ''), NULLIF(btrim("lastName"), ''), NULLIF(btrim("email"), '')) IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agreement_envelopes_signatory_check') THEN
    ALTER TABLE "agreement_envelopes" ADD CONSTRAINT "agreement_envelopes_signatory_check" CHECK (
      "netenrollSignatoryName" IS NOT NULL OR "issuerSignatoryName" IS NOT NULL);
  END IF;
END $$;

-- ── Triggers ─────────────────────────────────────────────────────────────────

-- The deploy applies migrations BEFORE the new API ships. An envelope the old
-- code writes in that window names no issuer: it can only be NetEnroll's.
CREATE OR REPLACE FUNCTION "agreement_envelopes_default_issuer"() RETURNS TRIGGER AS $fn$
BEGIN
    IF NEW."salesWorkspaceId" IS NULL THEN
        SELECT w."id", a."id" INTO NEW."salesWorkspaceId", NEW."agreementSuiteId"
        FROM "sales_workspaces" w JOIN "agreement_suites" a ON a."workspaceId" = w."id"
        WHERE w."scopeType" = 'PLATFORM';
    END IF;
    RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "agreement_envelopes_default_issuer" ON "agreement_envelopes";
CREATE TRIGGER "agreement_envelopes_default_issuer"
    BEFORE INSERT ON "agreement_envelopes"
    FOR EACH ROW EXECUTE FUNCTION "agreement_envelopes_default_issuer"();

-- A linked prospect belongs to the issuing workspace.
CREATE OR REPLACE FUNCTION "agreement_envelopes_prospect_workspace"() RETURNS TRIGGER AS $fn$
BEGIN
    IF NEW."salesProspectId" IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM "sales_prospects" p
        WHERE p."id" = NEW."salesProspectId" AND p."workspaceId" = NEW."salesWorkspaceId") THEN
        RAISE EXCEPTION 'agreement_envelopes: prospect % is not in the issuing workspace.', NEW."salesProspectId";
    END IF;
    RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "agreement_envelopes_prospect_workspace" ON "agreement_envelopes";
CREATE TRIGGER "agreement_envelopes_prospect_workspace"
    BEFORE INSERT OR UPDATE OF "salesProspectId", "salesWorkspaceId" ON "agreement_envelopes"
    FOR EACH ROW EXECUTE FUNCTION "agreement_envelopes_prospect_workspace"();

-- 20261008000000_agreements_party_details's function, plus: the issuer is set
-- once and never changes, and a linked prospect is never swapped for another
-- (it may only be cleared, which is what deleting the prospect does).
CREATE OR REPLACE FUNCTION "agreement_envelopes_immutable"() RETURNS TRIGGER AS $fn$
BEGIN
    IF NEW."terms" IS DISTINCT FROM OLD."terms" THEN
        RAISE EXCEPTION 'agreement_envelopes: the terms of % are frozen at send.', OLD."id";
    END IF;
    IF NEW."signerEmail" IS DISTINCT FROM OLD."signerEmail" THEN
        RAISE EXCEPTION 'agreement_envelopes: the signer email of % cannot be changed.', OLD."id";
    END IF;
    IF NEW."signTokenHash" IS DISTINCT FROM OLD."signTokenHash" THEN
        RAISE EXCEPTION 'agreement_envelopes: the signing link of % is never reissued.', OLD."id";
    END IF;
    IF OLD."partyDetails" IS NOT NULL AND NEW."partyDetails" IS DISTINCT FROM OLD."partyDetails" THEN
        RAISE EXCEPTION 'agreement_envelopes: the agency details of % cannot be changed once entered.', OLD."id";
    END IF;
    IF OLD."salesWorkspaceId" IS NOT NULL AND NEW."salesWorkspaceId" IS DISTINCT FROM OLD."salesWorkspaceId" THEN
        RAISE EXCEPTION 'agreement_envelopes: the issuing workspace of % cannot be changed.', OLD."id";
    END IF;
    IF OLD."agreementSuiteId" IS NOT NULL AND NEW."agreementSuiteId" IS DISTINCT FROM OLD."agreementSuiteId" THEN
        RAISE EXCEPTION 'agreement_envelopes: the issuing suite of % cannot be changed.', OLD."id";
    END IF;
    IF OLD."salesProspectId" IS NOT NULL AND NEW."salesProspectId" IS NOT NULL
       AND NEW."salesProspectId" IS DISTINCT FROM OLD."salesProspectId" THEN
        RAISE EXCEPTION 'agreement_envelopes: the prospect of % cannot be changed.', OLD."id";
    END IF;
    RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

-- A grant is for a user of the workspace's own tenant, and only TENANT
-- workspaces take grants (NetEnroll's is reached by platform admins).
CREATE OR REPLACE FUNCTION "sales_workspace_access_same_tenant"() RETURNS TRIGGER AS $fn$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM "sales_workspaces" w JOIN "users" u ON u."id" = NEW."userId"
        WHERE w."id" = NEW."workspaceId" AND w."scopeType" = 'TENANT'
          AND u."tenantId" IS NOT NULL AND u."tenantId" = w."tenantId") THEN
        RAISE EXCEPTION 'sales_workspace_access: user % is not in the tenant of workspace %.', NEW."userId", NEW."workspaceId";
    END IF;
    RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "sales_workspace_access_same_tenant" ON "sales_workspace_access";
CREATE TRIGGER "sales_workspace_access_same_tenant"
    BEFORE INSERT OR UPDATE ON "sales_workspace_access"
    FOR EACH ROW EXECUTE FUNCTION "sales_workspace_access_same_tenant"();

