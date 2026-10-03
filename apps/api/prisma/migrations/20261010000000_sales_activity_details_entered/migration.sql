-- Sales CRM: the agency entering its own details on an agreement is a timeline
-- entry on the linked prospect, like sent / viewed / signed.
--
-- One statement, idempotent. ADD VALUE cannot run inside a transaction block
-- on older PostgreSQL, so this file is not wrapped in BEGIN..COMMIT.
ALTER TYPE "SalesActivityType" ADD VALUE IF NOT EXISTS 'AGREEMENT_DETAILS_ENTERED';
