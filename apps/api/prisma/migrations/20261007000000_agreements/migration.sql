-- Electronic agreements: the Master Services Agreement and the CPA / CPL
-- campaign agreements, generated, signed electronically and delivered from one
-- platform-admin screen (/admin/agreements). See docs/AGREEMENTS.md.
--
-- ── What this adds ──────────────────────────────────────────────────────────
--
--   agreement_settings          singleton ('default'): NetEnroll's notice
--                               address and email, default signatory, and the
--                               internal addresses that get every executed copy.
--                               Seeded below so sending works on first deploy.
--   agreement_envelopes         one set of agreements sent to one signer: the
--                               frozen terms, both parties' signature evidence,
--                               and the hashes of the signing / download tokens.
--   agreement_documents         each agreement as sent (HTML + SHA-256) and as
--                               executed (PDF key + SHA-256).
--   agreement_events            the hash-chained, append-only audit trail.
--   agreement_otps              emailed one-time codes (hashes only).
--   agreement_signing_sessions  sessions minted on code verification (hashes).
--
-- ── Why triggers ─────────────────────────────────────────────────────────────
--
-- The evidence must survive in court under ESIGN and Fla. Stat. §668.50: the
-- signature is associated with the exact record that was sent, and the record
-- is retained unchanged. So the database refuses, rather than the application
-- promising not to:
--
--   * any UPDATE or DELETE on agreement_events;
--   * an UPDATE of agreement_documents."sentHtml" / "sentHtmlSha256", and of
--     "executedPdfKey" / "executedPdfSha256" once they are set;
--   * an UPDATE of agreement_envelopes."terms", "signerEmail" or
--     "signTokenHash" (the sign token is never reissued; a resend re-sends the
--     same link).
--
-- `prisma db push` cannot create a trigger, so the same three are in
-- prisma/sql/db-push-constraints.sql for databases built that way.
--
-- ── How this migration is applied ────────────────────────────────────────────
--
--   cat apps/api/prisma/migrations/20261007000000_agreements/migration.sql | docker exec -i hopwhistle-postgres-dev psql -U callfabric -d callfabric
--
-- Production has no _prisma_migrations table and is never run through
-- `prisma migrate deploy`. Additive and idempotent: safe to run twice.
BEGIN;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "AgreementStatus" AS ENUM ('SENT', 'VIEWED', 'SIGNED', 'COMPLETED', 'CHANGES_REQUESTED', 'VOIDED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "AgreementDocumentKind" AS ENUM ('MSA', 'CPA', 'CPL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "AgreementSignatureMethod" AS ENUM ('TYPED', 'DRAWN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "AgreementActorType" AS ENUM ('NETENROLL', 'SIGNER', 'SYSTEM');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "AgreementEventType" AS ENUM ('CREATED', 'NETENROLL_SIGNED', 'SENT', 'EMAIL_NOT_SENT', 'RESENT', 'LINK_OPENED', 'OTP_SENT', 'OTP_VERIFIED', 'OTP_FAILED', 'OTP_LOCKED', 'CONSENT_GIVEN', 'DOCUMENT_REVIEWED', 'SIGNED', 'COMPLETED', 'COMPLETION_FAILED', 'CHANGES_REQUESTED', 'VOIDED', 'EXPIRED', 'COPIES_SENT', 'DOWNLOADED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "agreement_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "netenrollNoticeAddress" TEXT,
    "netenrollNoticeEmail" TEXT,
    "defaultSignatoryName" TEXT NOT NULL DEFAULT 'James Kelly',
    "defaultSignatoryTitle" TEXT NOT NULL DEFAULT 'Managing Partner',
    "internalCopyEmails" TEXT[],
    "updatedByUserId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agreement_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "agreement_envelopes" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "tenantId" TEXT,
    "status" "AgreementStatus" NOT NULL DEFAULT 'SENT',
    "includesMsa" BOOLEAN NOT NULL,
    "includesCpa" BOOLEAN NOT NULL,
    "includesCpl" BOOLEAN NOT NULL,
    "existingMsaEnvelopeId" TEXT,
    "terms" JSONB NOT NULL,
    "signerName" TEXT NOT NULL,
    "signerTitle" TEXT NOT NULL,
    "signerEmail" TEXT NOT NULL,
    "ccEmails" TEXT[],
    "netenrollSignatoryName" TEXT NOT NULL,
    "netenrollSignatoryTitle" TEXT NOT NULL,
    "netenrollSignedByUserId" TEXT NOT NULL,
    "netenrollSignedAt" TIMESTAMP(3) NOT NULL,
    "netenrollSignedIp" TEXT,
    "netenrollSignedUserAgent" TEXT,
    "sentByUserId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "viewedAt" TIMESTAMP(3),
    "consentedAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "voidedByUserId" TEXT,
    "changesRequestedAt" TIMESTAMP(3),
    "changesNote" TEXT,
    "signTokenHash" TEXT NOT NULL,
    "signTokenEnc" TEXT,
    "downloadTokenHash" TEXT,
    "downloadTokenExpiresAt" TIMESTAMP(3),
    "signerTypedSignature" TEXT,
    "signerInitials" TEXT,
    "signatureMethod" "AgreementSignatureMethod",
    "signatureImageKey" TEXT,
    "sealed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agreement_envelopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "agreement_documents" (
    "id" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "kind" "AgreementDocumentKind" NOT NULL,
    "title" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "sentHtml" TEXT NOT NULL,
    "sentHtmlSha256" TEXT NOT NULL,
    "contentPdfSha256" TEXT,
    "executedPdfKey" TEXT,
    "executedPdfSha256" TEXT,
    "executedPdfBytes" INTEGER,
    "pageCount" INTEGER,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "agreement_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "agreement_events" (
    "id" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" "AgreementEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "actorType" "AgreementActorType" NOT NULL,
    "actorUserId" TEXT,
    "actorEmail" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "detail" JSONB NOT NULL,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "agreement_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "agreement_otps" (
    "id" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agreement_otps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "agreement_signing_sessions" (
    "id" TEXT NOT NULL,
    "envelopeId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agreement_signing_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "agreement_envelopes_reference_key" ON "agreement_envelopes"("reference");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "agreement_envelopes_signTokenHash_key" ON "agreement_envelopes"("signTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "agreement_envelopes_downloadTokenHash_key" ON "agreement_envelopes"("downloadTokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agreement_envelopes_status_idx" ON "agreement_envelopes"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agreement_envelopes_tenantId_idx" ON "agreement_envelopes"("tenantId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agreement_envelopes_sentAt_idx" ON "agreement_envelopes"("sentAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "agreement_documents_executedPdfSha256_key" ON "agreement_documents"("executedPdfSha256");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agreement_documents_envelopeId_idx" ON "agreement_documents"("envelopeId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "agreement_events_envelopeId_seq_key" ON "agreement_events"("envelopeId", "seq");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agreement_otps_envelopeId_createdAt_idx" ON "agreement_otps"("envelopeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "agreement_signing_sessions_tokenHash_key" ON "agreement_signing_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "agreement_signing_sessions_envelopeId_idx" ON "agreement_signing_sessions"("envelopeId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agreement_envelopes_tenantId_fkey') THEN
    ALTER TABLE "agreement_envelopes" ADD CONSTRAINT "agreement_envelopes_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agreement_documents_envelopeId_fkey') THEN
    ALTER TABLE "agreement_documents" ADD CONSTRAINT "agreement_documents_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "agreement_envelopes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agreement_events_envelopeId_fkey') THEN
    ALTER TABLE "agreement_events" ADD CONSTRAINT "agreement_events_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "agreement_envelopes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agreement_otps_envelopeId_fkey') THEN
    ALTER TABLE "agreement_otps" ADD CONSTRAINT "agreement_otps_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "agreement_envelopes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agreement_signing_sessions_envelopeId_fkey') THEN
    ALTER TABLE "agreement_signing_sessions" ADD CONSTRAINT "agreement_signing_sessions_envelopeId_fkey" FOREIGN KEY ("envelopeId") REFERENCES "agreement_envelopes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

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
    RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "agreement_envelopes_immutable" ON "agreement_envelopes";
CREATE TRIGGER "agreement_envelopes_immutable"
    BEFORE UPDATE ON "agreement_envelopes"
    FOR EACH ROW EXECUTE FUNCTION "agreement_envelopes_immutable"();

-- ---------------------------------------------------------------------------
-- NetEnroll's agreement details, so sending is not blocked on first deploy.
-- Sending is refused again if either notice field is later cleared.
-- ---------------------------------------------------------------------------
INSERT INTO "agreement_settings"
    ("id", "netenrollNoticeAddress", "netenrollNoticeEmail", "defaultSignatoryName",
     "defaultSignatoryTitle", "internalCopyEmails", "updatedAt")
VALUES
    ('default', '2800 N 6th Street, STE 796, Saint Augustine, FL 32084', 'support@pvnvoice.com',
     'James Kelly', 'Managing Partner', ARRAY['support@pvnvoice.com'], CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

COMMIT;
