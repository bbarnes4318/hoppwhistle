-- A customer's timeline records the quotes run for them.
--
-- Its own migration: Postgres will not use an enum value added in the same
-- transaction, and nothing here needs to.
ALTER TYPE "InsuranceActivityType" ADD VALUE IF NOT EXISTS 'QUOTE';
