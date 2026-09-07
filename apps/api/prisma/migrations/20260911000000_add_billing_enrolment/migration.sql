-- Phase 3, follow-up: the billing enrolment switch, the charging switch, and
-- the dry-run closeout.
--
-- ── Why this exists ──────────────────────────────────────────────────────────
--
-- Phase 3 shipped with no opt-in. The delivery gate refuses an agency with no
-- valid ACH mandate, and an agency with no billing profile at all has no
-- mandate -- so every existing tenant would have been refused with NO_MANDATE
-- the moment the gate went live, including one carrying live client traffic.
-- Deploying it as written would have stopped call delivery platform-wide.
--
-- So being subject to the billing system is now an explicit, per-tenant act:
--
--   billing_enrolled_at   NULL  ->  not gated, not metered, not settled.
--                                   Calls deliver exactly as they did before
--                                   Phase 3 existed.
--   billing_enrolled_at   set   ->  every part of Phase 3 applies, unchanged.
--
-- and placing a real debit is a SECOND explicit act on top of it:
--
--   charges_enabled  false ->  the settlement computes everything and writes
--                              the full immutable record; only the Stripe
--                              charge is skipped. paymentStatus = 'DRY_RUN'.
--   charges_enabled  true  ->  the debit is placed.
--
-- ── THIS MIGRATION ENROLS NOBODY ─────────────────────────────────────────────
--
-- Every column below is added nullable or with a safe default, and there is no
-- UPDATE that sets an enrolment anywhere in this file. Applying it to
-- production leaves all five existing tenants exactly as they are: unenrolled,
-- ungated, unmetered, unsettled and uncharged. `settlement.test.ts` asserts
-- that against a database this file has actually been applied to, rather than
-- trusting the reading.
--
-- ── How this migration is applied ────────────────────────────────────────────
--
--     psql "$DATABASE_URL" -f apps/api/prisma/migrations/20260911000000_add_billing_enrolment/migration.sql
--
-- Additive only, idempotent, and safe against a drifted schema. It drops
-- nothing and alters no existing column's type or nullability.

BEGIN;

-- ---------------------------------------------------------------------------
-- The enrolment switch
--
-- Null means not enrolled, which is the default for every row that already
-- exists and for every row created without naming it.
-- ---------------------------------------------------------------------------

ALTER TABLE "agency_billing_profiles"
    ADD COLUMN IF NOT EXISTS "billingEnrolledAt"       TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "billingEnrolledByUserId" TEXT,
    ADD COLUMN IF NOT EXISTS "billingEnrolmentNote"    TEXT;

-- ---------------------------------------------------------------------------
-- The charging switch
--
-- DEFAULT false, deliberately. An agency that is enrolled but has not had
-- charging turned on gets full settlements it can be checked against, and no
-- money moves. Turning it on is a separate act with its own audit row.
-- ---------------------------------------------------------------------------

ALTER TABLE "agency_billing_profiles"
    ADD COLUMN IF NOT EXISTS "chargesEnabled"         BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "chargesEnabledAt"       TIMESTAMP(3),
    ADD COLUMN IF NOT EXISTS "chargesEnabledByUserId" TEXT;

-- Only enrolled agencies are ever read as a set -- the settlement run walks
-- tenants and skips the rest -- so the index is on the enrolment column alone.
CREATE INDEX IF NOT EXISTS "agency_billing_profiles_billingEnrolledAt_idx"
    ON "agency_billing_profiles"("billingEnrolledAt");

COMMIT;

-- ---------------------------------------------------------------------------
-- The DRY_RUN payment status
--
-- Outside the transaction above, deliberately: `ALTER TYPE ... ADD VALUE` is
-- not permitted inside a transaction block before PostgreSQL 12, and on 12 and
-- later the new value cannot be USED in the transaction that adds it. Adding it
-- as its own autocommitted statement is correct on every version, and this file
-- is piped into psql where each statement outside BEGIN/COMMIT commits on its
-- own.
--
-- IF NOT EXISTS so a re-run is a no-op rather than an error.
-- ---------------------------------------------------------------------------

ALTER TYPE "SettlementPaymentStatus" ADD VALUE IF NOT EXISTS 'DRY_RUN';

-- ---------------------------------------------------------------------------
-- The DRY_RUN_CLOSEOUT ledger entry type
--
-- The credits from one dry-run block, retired at the moment the agency starts
-- being charged. A dry-run settlement sells the next day's block so the agency
-- keeps delivering realistically, and that block is never paid for; leaving it
-- on the balance would reduce the first CHARGED settlement's block, because the
-- block is the daily target minus unused paid applications and the ledger
-- cannot tell an unpaid dry-run credit from a bought one.
--
-- It is NOT a reversal and it is not a refund. Nothing is returned to anybody
-- and no money moves, because no money ever moved. It retires credits that were
-- issued to make an observation possible and were never sold, by appending a
-- row -- the ledger stays append-only and the purchases are untouched.
--
-- Same placement and reasoning as the value above: its own autocommitted
-- statement, outside any transaction block.
-- ---------------------------------------------------------------------------

ALTER TYPE "CreditLedgerEntryType" ADD VALUE IF NOT EXISTS 'DRY_RUN_CLOSEOUT';
