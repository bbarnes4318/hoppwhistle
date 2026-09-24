-- NO_CREDITS as a delivery hold reason.
--
-- Agencies prepay for application credits. When the credit balance reaches
-- zero, delivery stops at once -- no Overrun is extended past a spent balance --
-- and resumes the moment more credits are added. CEILING_REACHED stays in the
-- type because rows recorded under it before this change must still read.
--
-- The enum value alone, in a file of its own: PostgreSQL will not let a value
-- added in a transaction be used in that same transaction. See
-- 20260922020000_payment_provider_melio_value for the longer note.

ALTER TYPE "DeliveryHoldReason" ADD VALUE IF NOT EXISTS 'NO_CREDITS';
