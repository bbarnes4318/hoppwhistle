-- A clawback survives the deletion of the call it came from.
--
-- 20260927000000_publisher_payment_clawbacks required a CLAWBACK to name its
-- call ("callId" IS NOT NULL) while the foreign key on "callId" is ON DELETE SET
-- NULL. The two disagreed: deleting a returned call tried to null the column,
-- the CHECK refused, and the delete failed -- a demo seed re-run or removal
-- among them. The deduction is money the publisher owes whether or not the
-- call row still exists, so the CHECK no longer asks for the call. "reference"
-- keeps the call id as text ("Return <callId>"), and routes/returns.ts still
-- always writes "callId".
--
-- Applied by hand with psql (this database has no _prisma_migrations table):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/prisma/migrations/20260928000000_clawback_check_callid/migration.sql
--
-- Idempotent and one transaction: it drops the constraint if present and adds
-- the new definition, so a second run leaves the same result.

BEGIN;

ALTER TABLE "publisher_payments"
  DROP CONSTRAINT IF EXISTS "publisher_payments_kind_amount_check";

ALTER TABLE "publisher_payments"
  ADD CONSTRAINT "publisher_payments_kind_amount_check"
  CHECK (
    ("kind" = 'PAYMENT' AND "amount" > 0)
    OR ("kind" = 'CLAWBACK' AND "amount" < 0)
  );

COMMIT;
