-- Self-serve credit purchases and the agency's auto-refill choice.
--
-- 1. "autoRefill" on the billing profile. Whether the nightly settlement sells
--    the agency its next Daily Block. TRUE by default, so every existing agency
--    keeps exactly today's behaviour; an agency that turns it off is still
--    billed its Overrun each night but is sold no block, and buys credits
--    itself instead.
--
-- 2. "idempotencyKey" on the credit ledger. Set only on a purchase an agency
--    made itself, from the key its browser sent. Unique per tenant, so the same
--    purchase submitted twice -- a double click, a retried request -- writes one
--    ledger row. Null on every other row, and NULLs are distinct in a unique
--    index, so no existing row is affected.
--
-- Idempotent throughout: safe to run twice.

ALTER TABLE "agency_billing_profiles"
  ADD COLUMN IF NOT EXISTS "autoRefill" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "application_credit_ledger"
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "application_credit_ledger_tenantId_idempotencyKey_key"
  ON "application_credit_ledger" ("tenantId", "idempotencyKey");
