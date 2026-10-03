-- Sales workspaces: a B2B Sales CRM and an issuer-aware agreement suite for
-- NetEnroll (PLATFORM) and for each white-label issuer (TENANT), beginning with
-- Life Leads Plus. See docs/SALES_CRM.md and docs/AGREEMENTS.md.
--
-- ── What this adds ──────────────────────────────────────────────────────────
--
--   sales_workspaces            the company doing the selling. PLATFORM has no
--                               tenant (exactly one exists); TENANT names one
--                               white-label tenant (at most one each).
--   sales_workspace_access      explicit grants of a workspace to a user of the
--                               SAME tenant (trigger). Never a role change.
--   agreement_suites            one per workspace: the issuer's legal entity,
--                               notice details, signatory, copy addresses, link
--                               origin, brand, template set and a seal REFERENCE
--                               (an environment variable name, never a secret).
--   sales_prospects             B2B prospects (agencies, licensed agents,
--                               IMOs/FMOs, call centers). Not consumer leads.
--   sales_prospect_activities   their timeline, including rows written from
--                               agreement events (deduplicated by "sourceKey").
--   agreement_envelopes         + "salesWorkspaceId", "agreementSuiteId" (the
--                               ISSUER; "tenantId" keeps meaning the recipient),
--                               + "salesProspectId", + "issuerSignatory*".
--                               "netenrollSignatory*" become nullable: an
--                               envelope another suite issued was not signed by
--                               NetEnroll. No existing value changes.
--   AgreementActorType          + ISSUER
--   AgreementEventType          + ISSUER_SIGNED (NETENROLL_SIGNED rows untouched)
--
-- ── Backfill ─────────────────────────────────────────────────────────────────
--
--   * One PLATFORM workspace ("NetEnroll") and its suite, seeded from the
--     existing agreement_settings row (which is kept, unchanged, as the legacy
--     mirror the platform settings screen still writes).
--   * Every existing envelope is attached to that workspace and suite. Nothing
--     else on an envelope, document or event is written: no terms, hashes,
--     PDFs, tokens or event rows change.
--   * One TENANT workspace and suite for each top-level white-label tenant
--     ("whiteLabel" AND no parent), resolved from the tenant rows themselves --
--     no hard-coded id. A suite takes its brand from the tenant's brand theme;
--     its legal entity, notice details and signatory are left EMPTY on purpose
--     (the brand is not the contracting entity), so it cannot send until its
--     owner completes them. A Life Leads Plus-themed suite is pointed at the
--     'life-leads-plus' template set, which ships with NO contract text: it
--     shows "Contract templates not configured" and refuses to send until
--     approved text is installed (services/agreements/template-sets.ts).
--
-- ── How this migration is applied ────────────────────────────────────────────
--
--   cat apps/api/prisma/migrations/20261009000000_sales_workspaces/migration.sql | docker exec -i hopwhistle-postgres-dev psql -U callfabric -d callfabric
--
-- scripts/deploy-netenroll.sh applies it too. Requires
-- 20261008000000_agreements_party_details. Production has no
-- _prisma_migrations table. Additive and idempotent: safe to run twice, and
-- safe on a database built by `prisma db push`.
BEGIN;

DO $$ BEGIN
  CREATE TYPE "SalesWorkspaceScope" AS ENUM ('PLATFORM', 'TENANT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "SalesWorkspaceStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "SalesWorkspaceAccessLevel" AS ENUM ('MANAGER', 'MEMBER', 'READONLY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "SalesProspectType" AS ENUM ('INSURANCE_AGENCY', 'LICENSED_AGENT', 'IMO_FMO', 'CALL_CENTER', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "SalesProspectStage" AS ENUM ('NEW', 'ATTEMPTING_CONTACT', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'AGREEMENT_SENT', 'AGREEMENT_REVIEW', 'AGREEMENT_SIGNED', 'WON', 'LOST');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "SalesActivityType" AS ENUM ('NOTE', 'CALL', 'EMAIL', 'FOLLOW_UP', 'STAGE_CHANGE', 'AGREEMENT_SENT', 'AGREEMENT_VIEWED', 'AGREEMENT_SIGNED', 'AGREEMENT_COMPLETED', 'AGREEMENT_VOIDED', 'AGREEMENT_EXPIRED', 'CHANGES_REQUESTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  CREATE TYPE "AgreementSuiteStatus" AS ENUM ('ACTIVE', 'DISABLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Allowed inside a transaction (PostgreSQL 12+); not used until a later one.
ALTER TYPE "AgreementActorType" ADD VALUE IF NOT EXISTS 'ISSUER';
ALTER TYPE "AgreementEventType" ADD VALUE IF NOT EXISTS 'ISSUER_SIGNED';

CREATE TABLE IF NOT EXISTS "sales_workspaces" (
    "id" TEXT NOT NULL,
    "scopeType" "SalesWorkspaceScope" NOT NULL,
    "tenantId" TEXT,
    "name" TEXT NOT NULL,
    "status" "SalesWorkspaceStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sales_workspaces_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sales_workspace_access" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "level" "SalesWorkspaceAccessLevel" NOT NULL,
    "grantedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sales_workspace_access_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "agreement_suites" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "status" "AgreementSuiteStatus" NOT NULL DEFAULT 'ACTIVE',
    "displayName" TEXT NOT NULL,
    "legalEntityName" TEXT,
    "dbaName" TEXT,
    "noticeAddress" TEXT,
    "noticeEmail" TEXT,
    "replyToEmail" TEXT,
    "defaultSignatoryName" TEXT,
    "defaultSignatoryTitle" TEXT,
    "internalCopyEmails" TEXT[],
    "linkOrigin" TEXT,
    "brandTheme" TEXT,
    "templateSetKey" TEXT,
    "sealSecretRef" TEXT,
    "sealLocation" TEXT,
    "referencePrefix" TEXT NOT NULL DEFAULT 'AG',
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "agreement_suites_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sales_prospects" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" "SalesProspectType" NOT NULL,
    "companyName" TEXT,
    "primaryContactName" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "state" TEXT,
    "address" TEXT,
    "source" TEXT,
    "stage" "SalesProspectStage" NOT NULL DEFAULT 'NEW',
    "assignedUserId" TEXT,
    "nextFollowUpAt" TIMESTAMP(3),
    "lastContactedAt" TIMESTAMP(3),
    "summary" TEXT,
    "tags" TEXT[],
    "lostReason" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    CONSTRAINT "sales_prospects_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "sales_prospect_activities" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "type" "SalesActivityType" NOT NULL,
    "body" TEXT,
    "detail" JSONB,
    "agreementEnvelopeId" TEXT,
    "actorUserId" TEXT,
    "sourceKey" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sales_prospect_activities_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "agreement_envelopes"
  ADD COLUMN IF NOT EXISTS "issuerSignatoryName" TEXT,
  ADD COLUMN IF NOT EXISTS "issuerSignatoryTitle" TEXT,
  ADD COLUMN IF NOT EXISTS "issuerSignedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "issuerSignedByUserId" TEXT,
  ADD COLUMN IF NOT EXISTS "issuerSignedIp" TEXT,
  ADD COLUMN IF NOT EXISTS "issuerSignedUserAgent" TEXT,
  ADD COLUMN IF NOT EXISTS "salesWorkspaceId" TEXT,
  ADD COLUMN IF NOT EXISTS "agreementSuiteId" TEXT,
  ADD COLUMN IF NOT EXISTS "salesProspectId" TEXT;

-- Relaxing, not changing: every existing row keeps its value.
ALTER TABLE "agreement_envelopes"
  ALTER COLUMN "netenrollSignatoryName" DROP NOT NULL,
  ALTER COLUMN "netenrollSignatoryTitle" DROP NOT NULL,
  ALTER COLUMN "netenrollSignedByUserId" DROP NOT NULL,
  ALTER COLUMN "netenrollSignedAt" DROP NOT NULL;

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS "sales_workspaces_tenantId_key" ON "sales_workspaces"("tenantId");
CREATE INDEX IF NOT EXISTS "sales_workspaces_scopeType_idx" ON "sales_workspaces"("scopeType");
-- Exactly one PLATFORM workspace. Prisma cannot express a partial index.
CREATE UNIQUE INDEX IF NOT EXISTS "sales_workspaces_platform_singleton" ON "sales_workspaces"("scopeType") WHERE "scopeType" = 'PLATFORM';
CREATE INDEX IF NOT EXISTS "sales_workspace_access_userId_idx" ON "sales_workspace_access"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "sales_workspace_access_workspaceId_userId_key" ON "sales_workspace_access"("workspaceId", "userId");
CREATE UNIQUE INDEX IF NOT EXISTS "agreement_suites_workspaceId_key" ON "agreement_suites"("workspaceId");
CREATE UNIQUE INDEX IF NOT EXISTS "agreement_suites_id_workspaceId_key" ON "agreement_suites"("id", "workspaceId");
CREATE INDEX IF NOT EXISTS "sales_prospects_workspaceId_stage_idx" ON "sales_prospects"("workspaceId", "stage");
CREATE INDEX IF NOT EXISTS "sales_prospects_workspaceId_nextFollowUpAt_idx" ON "sales_prospects"("workspaceId", "nextFollowUpAt");
CREATE INDEX IF NOT EXISTS "sales_prospects_workspaceId_assignedUserId_idx" ON "sales_prospects"("workspaceId", "assignedUserId");
CREATE INDEX IF NOT EXISTS "sales_prospects_workspaceId_updatedAt_idx" ON "sales_prospects"("workspaceId", "updatedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "sales_prospects_id_workspaceId_key" ON "sales_prospects"("id", "workspaceId");
CREATE UNIQUE INDEX IF NOT EXISTS "sales_prospect_activities_sourceKey_key" ON "sales_prospect_activities"("sourceKey");
CREATE INDEX IF NOT EXISTS "sales_prospect_activities_prospectId_occurredAt_idx" ON "sales_prospect_activities"("prospectId", "occurredAt");
CREATE INDEX IF NOT EXISTS "sales_prospect_activities_workspaceId_occurredAt_idx" ON "sales_prospect_activities"("workspaceId", "occurredAt");
CREATE INDEX IF NOT EXISTS "agreement_envelopes_salesWorkspaceId_sentAt_idx" ON "agreement_envelopes"("salesWorkspaceId", "sentAt");
CREATE INDEX IF NOT EXISTS "agreement_envelopes_salesProspectId_idx" ON "agreement_envelopes"("salesProspectId");

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

-- ── Foreign keys (no cascade can reach an envelope) ──────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_workspaces_tenantId_fkey') THEN
    ALTER TABLE "sales_workspaces" ADD CONSTRAINT "sales_workspaces_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_workspace_access_workspaceId_fkey') THEN
    ALTER TABLE "sales_workspace_access" ADD CONSTRAINT "sales_workspace_access_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "sales_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_workspace_access_userId_fkey') THEN
    ALTER TABLE "sales_workspace_access" ADD CONSTRAINT "sales_workspace_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agreement_suites_workspaceId_fkey') THEN
    ALTER TABLE "agreement_suites" ADD CONSTRAINT "agreement_suites_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "sales_workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_prospects_workspaceId_fkey') THEN
    ALTER TABLE "sales_prospects" ADD CONSTRAINT "sales_prospects_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "sales_workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_prospects_assignedUserId_fkey') THEN
    ALTER TABLE "sales_prospects" ADD CONSTRAINT "sales_prospects_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_prospect_activities_workspaceId_fkey') THEN
    ALTER TABLE "sales_prospect_activities" ADD CONSTRAINT "sales_prospect_activities_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "sales_workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_prospect_activities_prospectId_workspaceId_fkey') THEN
    ALTER TABLE "sales_prospect_activities" ADD CONSTRAINT "sales_prospect_activities_prospectId_workspaceId_fkey" FOREIGN KEY ("prospectId", "workspaceId") REFERENCES "sales_prospects"("id", "workspaceId") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sales_prospect_activities_agreementEnvelopeId_fkey') THEN
    ALTER TABLE "sales_prospect_activities" ADD CONSTRAINT "sales_prospect_activities_agreementEnvelopeId_fkey" FOREIGN KEY ("agreementEnvelopeId") REFERENCES "agreement_envelopes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ── Backfill: NetEnroll's platform workspace and suite ───────────────────────
INSERT INTO "sales_workspaces" ("id", "scopeType", "tenantId", "name", "status", "updatedAt")
SELECT gen_random_uuid()::text, 'PLATFORM', NULL, 'NetEnroll', 'ACTIVE', CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "sales_workspaces" WHERE "scopeType" = 'PLATFORM');

INSERT INTO "agreement_suites" (
    "id", "workspaceId", "status", "displayName", "legalEntityName", "dbaName",
    "noticeAddress", "noticeEmail", "defaultSignatoryName", "defaultSignatoryTitle",
    "internalCopyEmails", "brandTheme", "templateSetKey", "sealSecretRef", "sealLocation",
    "referencePrefix", "updatedAt")
SELECT gen_random_uuid()::text, w."id", 'ACTIVE', 'NetEnroll', 'PVN LLC', 'NetEnroll',
       s."netenrollNoticeAddress", s."netenrollNoticeEmail",
       COALESCE(s."defaultSignatoryName", 'James Kelly'), COALESCE(s."defaultSignatoryTitle", 'Managing Partner'),
       COALESCE(s."internalCopyEmails", ARRAY[]::text[]), NULL, 'netenroll', 'DEFAULT',
       'Saint Augustine, Florida', 'NE', CURRENT_TIMESTAMP
FROM "sales_workspaces" w
LEFT JOIN "agreement_settings" s ON s."id" = 'default'
WHERE w."scopeType" = 'PLATFORM'
  AND NOT EXISTS (SELECT 1 FROM "agreement_suites" x WHERE x."workspaceId" = w."id");

-- Every existing envelope was issued by NetEnroll.
UPDATE "agreement_envelopes" e
SET "salesWorkspaceId" = w."id", "agreementSuiteId" = a."id"
FROM "sales_workspaces" w JOIN "agreement_suites" a ON a."workspaceId" = w."id"
WHERE w."scopeType" = 'PLATFORM' AND e."salesWorkspaceId" IS NULL;

ALTER TABLE "agreement_envelopes"
  ALTER COLUMN "salesWorkspaceId" SET NOT NULL,
  ALTER COLUMN "agreementSuiteId" SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agreement_envelopes_salesWorkspaceId_fkey') THEN
    ALTER TABLE "agreement_envelopes" ADD CONSTRAINT "agreement_envelopes_salesWorkspaceId_fkey" FOREIGN KEY ("salesWorkspaceId") REFERENCES "sales_workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  -- The suite must be the workspace's own: a composite key, not a promise.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agreement_envelopes_agreementSuiteId_salesWorkspaceId_fkey') THEN
    ALTER TABLE "agreement_envelopes" ADD CONSTRAINT "agreement_envelopes_agreementSuiteId_salesWorkspaceId_fkey" FOREIGN KEY ("agreementSuiteId", "salesWorkspaceId") REFERENCES "agreement_suites"("id", "workspaceId") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agreement_envelopes_salesProspectId_fkey') THEN
    ALTER TABLE "agreement_envelopes" ADD CONSTRAINT "agreement_envelopes_salesProspectId_fkey" FOREIGN KEY ("salesProspectId") REFERENCES "sales_prospects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ── Backfill: each top-level white-label tenant's workspace and suite ────────
INSERT INTO "sales_workspaces" ("id", "scopeType", "tenantId", "name", "status", "updatedAt")
SELECT gen_random_uuid()::text, 'TENANT', t."id",
       COALESCE(NULLIF(btrim(t."brandName"), ''), CASE WHEN t."brandTheme" = 'life-leads-plus' THEN 'Life Leads Plus' END, t."name"),
       'ACTIVE', CURRENT_TIMESTAMP
FROM "tenants" t
WHERE t."whiteLabel" = true AND t."parentTenantId" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "sales_workspaces" w WHERE w."tenantId" = t."id");

INSERT INTO "agreement_suites" (
    "id", "workspaceId", "status", "displayName", "internalCopyEmails", "brandTheme",
    "templateSetKey", "referencePrefix", "updatedAt")
SELECT gen_random_uuid()::text, w."id", 'ACTIVE', w."name", ARRAY[]::text[], t."brandTheme",
       CASE WHEN t."brandTheme" = 'life-leads-plus' THEN 'life-leads-plus' END,
       CASE WHEN t."brandTheme" = 'life-leads-plus' THEN 'LLP' ELSE 'AG' END,
       CURRENT_TIMESTAMP
FROM "sales_workspaces" w JOIN "tenants" t ON t."id" = w."tenantId"
WHERE w."scopeType" = 'TENANT'
  AND NOT EXISTS (SELECT 1 FROM "agreement_suites" x WHERE x."workspaceId" = w."id");

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

COMMIT;
