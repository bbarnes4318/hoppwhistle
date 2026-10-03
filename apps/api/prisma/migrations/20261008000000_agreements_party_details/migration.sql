-- Electronic agreements: the agency enters its own details when it signs.
--
-- ── What changes ────────────────────────────────────────────────────────────
--
-- NetEnroll now sends the commercial terms only. The agency's legal name,
-- state, entity type, address, principal, contact details and signer are
-- entered by the agency on the signing page, as a business or as an
-- individual licensed agent (who has no entity type or principal and signs
-- "Individually"). The documents are then completed with those details, and
-- that completed version is what the agency reviews and signs.
--
--   agreement_envelopes."partyDetails"        the agency's own details (JSON)
--   agreement_envelopes."partySubmittedAt"    when it entered them
--   agreement_envelopes."inviteeOrganization" NetEnroll's own label at send
--   agreement_documents."presentedHtml"       the completed document, as the
--   agreement_documents."presentedHtmlSha256" agency reviewed and signed it
--   AgreementEventType 'PARTY_DETAILS_SUBMITTED'
--
-- "sentHtml" keeps its meaning: the offer exactly as NetEnroll signed and sent
-- it, the agency fields reading "To be completed by Agency".
--
-- ── Immutability ─────────────────────────────────────────────────────────────
--
-- The two trigger functions from 20261007000000_agreements are replaced, not
-- added to: "partyDetails" and "presentedHtml"/"presentedHtmlSha256" join the
-- columns that cannot change once written. The same functions are in
-- prisma/sql/db-push-constraints.sql.
--
-- ── How this migration is applied ────────────────────────────────────────────
--
--   cat apps/api/prisma/migrations/20261008000000_agreements_party_details/migration.sql | docker exec -i hopwhistle-postgres-dev psql -U callfabric -d callfabric
--
-- scripts/deploy-netenroll.sh applies it too. Requires
-- 20261007000000_agreements. Additive and idempotent: safe to run twice.
BEGIN;

-- Adding an enum value inside a transaction is allowed (PostgreSQL 12+); the
-- value is not used until a later transaction.
ALTER TYPE "AgreementEventType" ADD VALUE IF NOT EXISTS 'PARTY_DETAILS_SUBMITTED';

ALTER TABLE "agreement_envelopes"
  ADD COLUMN IF NOT EXISTS "partyDetails" JSONB,
  ADD COLUMN IF NOT EXISTS "partySubmittedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "inviteeOrganization" TEXT;

ALTER TABLE "agreement_documents"
  ADD COLUMN IF NOT EXISTS "presentedHtml" TEXT,
  ADD COLUMN IF NOT EXISTS "presentedHtmlSha256" TEXT;

-- What the signer was shown never changes, and an executed PDF is written once.
-- The completed ("as presented") document is written once, when the agency
-- enters its own details.
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

-- The frozen terms, the address the link went to, the link itself, and the
-- agency's own details once it has entered them.
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

COMMIT;
