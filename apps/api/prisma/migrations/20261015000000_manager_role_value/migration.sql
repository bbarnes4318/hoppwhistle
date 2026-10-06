-- MANAGER role: step 1 of 2, the enum value alone.
--
-- PostgreSQL will not let a newly added enum value be USED in the same
-- transaction that added it, and Prisma runs each migration file in its own
-- transaction, so the `roles` row that names it is inserted by the next
-- migration (see 20260922020000_payment_provider_melio_value for the same
-- split). Nothing reads the new member until that one lands.

ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'MANAGER';
