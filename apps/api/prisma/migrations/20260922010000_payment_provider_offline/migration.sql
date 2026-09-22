-- Payment provider as a per-agency choice, and the OFFLINE provider.
--
-- ── What was wrong ───────────────────────────────────────────────────────────
--
-- `paymentGateway()` in `services/billing/ach.ts` was a process-wide singleton
-- returning `new StripeService()`. Every charge site in the platform -- the
-- daily settlement, the opening purchase, the mandate setup -- called it and
-- got Stripe. There was no seam at which an agency could pay any other way, and
-- no way at all to record money that arrived outside the platform.
--
-- That second half was not a theoretical gap. An agency that had already paid
-- for its opening block by check could not be given its credits: the only route
-- that writes an opening purchase charges Stripe first
-- (`routes/delivery-billing.ts`), so recording the block they had paid for
-- would have debited them a second time for the same money. The alternatives
-- were a hand-written ledger row with no audit trail, or charging and refunding
-- -- in a product whose first documented rule is that there are no refunds.
--
-- ── What this adds ───────────────────────────────────────────────────────────
--
--   1. `PaymentProvider`, and `agency_billing_profiles.paymentProvider`.
--      STRIPE by default, so every existing row keeps exactly the behaviour it
--      had and no agency's delivery changes on deploy.
--
--   2. `SettlementPaymentStatus.EXTERNAL` -- a settlement computed in full and
--      owed, with no debit attempted, because the agency is billed elsewhere.
--
--   3. `externalPaymentReference` on `daily_settlements` and on
--      `application_credit_ledger`: where the money actually went, for a row
--      this platform did not charge.
--
-- ── Why provider is a second column and not more members on the first ────────
--
-- `AgencyPaymentMethod` answers WHAT is debited (a bank account, a card).
-- Provider answers WHO debits it. Folding them together needs a member per
-- pair, and every site asking either question then has to enumerate both.
-- `ceilingFor()` asks only the first -- a card is reversible whoever processes
-- it -- and the settlement asks only the second.
--
-- ── Why EXTERNAL is not SUCCEEDED ────────────────────────────────────────────
--
-- Nothing in an EXTERNAL settlement observed money arriving. Recording it as
-- SUCCEEDED would enter it into `consecutiveCleanSettlements()`, which is what
-- raises an agency's Overrun ceiling from 50% to 100% -- so an unconfirmed
-- invoice would buy an agency more unsecured credit. It is excluded from that
-- count for the same reason DRY_RUN is.
--
-- Additive only: no column is dropped, no existing value is rewritten.

-- 1. The provider enum.
CREATE TYPE "PaymentProvider" AS ENUM ('STRIPE', 'OFFLINE');

-- 2. Every existing agency is on Stripe, because that is what it was on.
ALTER TABLE "agency_billing_profiles"
  ADD COLUMN "paymentProvider" "PaymentProvider" NOT NULL DEFAULT 'STRIPE';

-- 3. The settlement outcome for an agency billed outside this platform.
ALTER TYPE "SettlementPaymentStatus" ADD VALUE IF NOT EXISTS 'EXTERNAL';

-- 4. Where the money went, when it did not go through here.
ALTER TABLE "daily_settlements"
  ADD COLUMN "externalPaymentReference" TEXT;

ALTER TABLE "application_credit_ledger"
  ADD COLUMN "externalPaymentReference" TEXT;

-- 5. The platform-only notice that a settlement is owed but was not charged.
--    Not sent to the agency: being invoiced is what an offline agency agreed
--    to, and a nightly "we did not debit you" is noise on its floor.
ALTER TYPE "BillingNotificationKind" ADD VALUE IF NOT EXISTS 'SETTLEMENT_PAYABLE_EXTERNALLY';
