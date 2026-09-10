-- Agent-entered applications: the carrier-agnostic path into the closing
-- percentage.
--
-- ── How this migration is applied ────────────────────────────────────────────
--
-- Same as 20260908000000_add_rating_engine: the production database has no
-- "_prisma_migrations" table and has never been managed by `prisma migrate`.
-- Every migration to date was piped into psql by hand, and this one is written
-- to be applied the same way:
--
--     psql "$DATABASE_URL" -f apps/api/prisma/migrations/20260914000000_agent_entered_applications/migration.sql
--
-- So it is additive only, idempotent, and safe against a schema that may have
-- drifted from schema.prisma. Every statement is IF NOT EXISTS; running it
-- twice is a no-op. It drops nothing and alters no existing column's type or
-- nullability. Do NOT add `prisma migrate deploy` to the deploy path to apply
-- it: against an empty migration history that would try to replay every
-- migration from the beginning.
--
-- ── What it adds, and why there is no backfill ───────────────────────────────
--
-- Eight columns on "insurance_carrier_applications", one unique index and one
-- lookup index. Nothing is backfilled and nothing needs to be: every row that
-- exists today was written by the American Amicable RPA, so the AUTOMATION
-- default on "source" is already the correct value for all of them, and the
-- MONTHLY default on "paymentMode" matches the existing "monthlyPremium"
-- column those rows carry.
--
-- "monthlyPremium" is deliberately untouched. The RPA writes it, existing
-- readers read it, and the agent-entry path writes it too (annualised premium
-- divided by twelve) so nothing downstream has to learn about the new columns
-- before it can keep working.

BEGIN;

-- ---------------------------------------------------------------------------
-- How the application entered the system
-- ---------------------------------------------------------------------------

-- AUTOMATION: the carrier RPA submitted it. AGENT_ENTRY: an agent logged it
-- after writing the business themselves, on any carrier. Both count
-- identically in services/rating/measurement.ts -- there is no branch on this
-- column anywhere in the numerator, and adding one would be a second
-- definition of the closing percentage.
ALTER TABLE "insurance_carrier_applications"
    ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'AUTOMATION';

-- ---------------------------------------------------------------------------
-- Premium as written, and its annualisation
-- ---------------------------------------------------------------------------

-- MONTHLY | QUARTERLY | SEMI_ANNUAL | ANNUAL. The mode "modalPremium" is in.
ALTER TABLE "insurance_carrier_applications"
    ADD COLUMN IF NOT EXISTS "paymentMode" TEXT NOT NULL DEFAULT 'MONTHLY';

-- The premium as written, in the mode named by "paymentMode".
ALTER TABLE "insurance_carrier_applications"
    ADD COLUMN IF NOT EXISTS "modalPremium" DECIMAL(10,2);

-- "modalPremium" annualised, computed on write and stored rather than derived
-- per row at read time: agency production reporting sums this column across a
-- day or a month, and a sum that has to re-derive each row from a mode string
-- is a sum that can disagree with itself when the modes are mixed.
ALTER TABLE "insurance_carrier_applications"
    ADD COLUMN IF NOT EXISTS "annualizedPremium" DECIMAL(10,2);

-- ---------------------------------------------------------------------------
-- Idempotency for the agent's client
-- ---------------------------------------------------------------------------

-- Set by the agent's client per form instance. A double-submitted form is one
-- application rather than two.
--
-- Deliberately NOT keyed on the call: one call can legitimately produce two
-- applications -- a couple insuring together -- and a per-call unique index
-- would silently drop the second one. The form instance is the thing that gets
-- retried, so the form instance is what carries the key.
ALTER TABLE "insurance_carrier_applications"
    ADD COLUMN IF NOT EXISTS "clientRequestId" TEXT;

-- NULLs are distinct in a Postgres unique index, so every existing row (and
-- every future RPA row, which sets no client request id) is unaffected by this
-- constraint. It binds only the rows that carry a key.
CREATE UNIQUE INDEX IF NOT EXISTS "insurance_carrier_applications_tenantId_clientRequestId_key"
    ON "insurance_carrier_applications"("tenantId", "clientRequestId");

-- ---------------------------------------------------------------------------
-- Voiding
-- ---------------------------------------------------------------------------

-- A voided application is removed from the closing-percentage numerator and
-- from production reporting. Three properties, all deliberate:
--
--   PLATFORM STAFF ONLY. An agency cannot void its own applications: the
--   numerator is what its price is measured from, and letting it edit that
--   would let it set its own rate.
--
--   IT NEVER REVERSES A CREDIT. "application_credit_ledger" refuses UPDATE and
--   DELETE by trigger and has no reversal entry type by design. A credit that
--   was consumed stays consumed; voiding is a correction to the measurement,
--   not a refund path.
--
--   THE ROW STAYS. Voiding is a nullable timestamp, not a delete, so the
--   application is still visible -- struck through, with its reason -- to the
--   agency reconciling against its carrier statements.
ALTER TABLE "insurance_carrier_applications"
    ADD COLUMN IF NOT EXISTS "voidedAt" TIMESTAMP(3);

ALTER TABLE "insurance_carrier_applications"
    ADD COLUMN IF NOT EXISTS "voidedById" TEXT;

ALTER TABLE "insurance_carrier_applications"
    ADD COLUMN IF NOT EXISTS "voidReason" TEXT;

-- ---------------------------------------------------------------------------
-- The per-agent production query
-- ---------------------------------------------------------------------------

-- One agent's own applications for a window: the agent reading of
-- GET /api/v1/applications, which is narrowed to "createdById" server-side,
-- and the per-agent premium breakdown on the delivery page.
--
-- The name is Prisma's own for this index, not the one the naming convention
-- would spell out: Postgres caps an identifier at 63 characters, and Prisma
-- truncates the middle to keep its "_idx" suffix. Spelling it out here and
-- letting Postgres truncate the TAIL instead would give a database migrated by
-- this file a differently-named index from one built by `prisma db push`, which
-- is exactly the kind of drift `prisma migrate diff` then reports forever.
CREATE INDEX IF NOT EXISTS "insurance_carrier_applications_tenantId_createdById_submitt_idx"
    ON "insurance_carrier_applications"("tenantId", "createdById", "submittedAt");

COMMIT;
