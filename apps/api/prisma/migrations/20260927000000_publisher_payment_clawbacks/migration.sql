-- Returns after the publisher was paid come out of that publisher's next payment.
--
-- "kind" is PAYMENT for a payment the agency recorded (every existing row), or
-- CLAWBACK for a buyer return accepted on a call whose publisher had already
-- been paid. A clawback carries a negative amount and the call it came from.
--
-- "appliedToPaymentId" is the PAYMENT a clawback was deducted from. NULL means
-- it is still waiting for the publisher's next payment.
--
-- Applied by hand with psql (this database has no _prisma_migrations table):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/prisma/migrations/20260927000000_publisher_payment_clawbacks/migration.sql
--
-- Idempotent throughout, and one transaction, so a failure leaves nothing
-- half-applied and a second run is a no-op.

BEGIN;

ALTER TABLE "publisher_payments"
  ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'PAYMENT',
  ADD COLUMN IF NOT EXISTS "callId" TEXT,
  ADD COLUMN IF NOT EXISTS "appliedToPaymentId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'publisher_payments_appliedToPaymentId_fkey') THEN
    ALTER TABLE "publisher_payments"
      ADD CONSTRAINT "publisher_payments_appliedToPaymentId_fkey"
      FOREIGN KEY ("appliedToPaymentId") REFERENCES "publisher_payments"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'publisher_payments_callId_fkey') THEN
    ALTER TABLE "publisher_payments"
      ADD CONSTRAINT "publisher_payments_callId_fkey"
      FOREIGN KEY ("callId") REFERENCES "calls"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'publisher_payments_kind_amount_check') THEN
    ALTER TABLE "publisher_payments"
      ADD CONSTRAINT "publisher_payments_kind_amount_check"
      CHECK (
        ("kind" = 'PAYMENT' AND "amount" > 0)
        OR ("kind" = 'CLAWBACK' AND "amount" < 0 AND "callId" IS NOT NULL)
      );
  END IF;
END $$;

-- One clawback per call: a second accept of the same return cannot deduct twice.
CREATE UNIQUE INDEX IF NOT EXISTS "publisher_payments_clawback_call_key"
  ON "publisher_payments"("callId") WHERE "kind" = 'CLAWBACK';

-- The clawbacks still waiting for a publisher's next payment.
CREATE INDEX IF NOT EXISTS "publisher_payments_unapplied_idx"
  ON "publisher_payments"("tenantId", "publisherId")
  WHERE "kind" = 'CLAWBACK' AND "appliedToPaymentId" IS NULL;

COMMIT;
