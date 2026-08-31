-- Constraints that `prisma db push` cannot create.
--
-- db push builds a database from schema.prisma alone. Prisma's schema language
-- cannot express a partial unique index, so any such constraint lives only in
-- migration SQL -- and `prisma migrate deploy` has not run from an empty
-- database for some time (the history is missing CREATE TABLE for leads and
-- ai_campaign_calls, so it fails part way). Every database here is therefore
-- built by db push, and every constraint in this file was simply absent.
--
-- Run this immediately after db push, wherever a schema is created.
-- Every statement must be idempotent: this runs on databases that may already
-- have the object.

-- One active reservation per lead.
--
-- Without it, concurrent workers each see a lead as reservable and each claim
-- it -- ten simultaneous workers produced five winners in CI, which in
-- production means five agents dialing the same person at once. The worker's
-- reserve() relies on the insert failing for the losers; there is nothing else
-- serialising them.
--
-- Mirrors 20260803000000_add_lead_dial_reservations/migration.sql, which is
-- where this was first written and where it stopped being applied.
CREATE UNIQUE INDEX IF NOT EXISTS "lead_dial_reservations_active_lead_key"
  ON "lead_dial_reservations" ("leadId")
  WHERE "releasedAt" IS NULL;
