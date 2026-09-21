-- Tie every application to the call that produced it, and record on what
-- evidence.
--
-- ── What was wrong ───────────────────────────────────────────────────────────
--
-- The closing percentage prices every agency. Its two sides were CORRELATED BY
-- AGENT AND DAY rather than joined: delivered calls counted through
-- `calls.answeredByUserId`, submitted applications through
-- `insurance_carrier_applications.createdById`. That answers "this agent took
-- 40 calls and wrote 4 applications" and cannot answer "which call became this
-- application", so an agency disputing the number that sets its price had
-- nothing to drill into.
--
-- `callId` existed and was barely used: optional, so the agent's form almost
-- never sent it, and verified only against the TENANT -- correctly, which is
-- why another agency's call never reached it, but not against the submitting
-- AGENT. An agent could therefore attribute their application to a colleague's
-- call, and the per-agent closing percentages a principal decides coaching and
-- pay from would describe the wrong people.
--
-- ── What this column adds ────────────────────────────────────────────────────
--
-- `callAttribution` says HOW `callId` came to be set:
--
--   CLIENT    the agent's form named the call, and the server verified it is
--             this agency's AND was answered by this agent.
--   INFERRED  the server matched it to the call the agent was on, or had just
--             finished. Deliberately a weaker claim: an agent who hangs up,
--             takes a second call and then writes the FIRST caller's business
--             is matched to the wrong one.
--   NONE      nothing could be tied to it. Business written from a callback,
--             from paper, or hours later legitimately lands here.
--
-- The two are stored apart because a dispute over a price has to tell a claim
-- the agent made from one the server inferred. Recording them as the same fact
-- would hide exactly the thing somebody is disputing.
--
-- ── Why every existing row becomes NONE, and why that is right ───────────────
--
-- NONE is the DEFAULT, so the backfill is the default and there is no UPDATE
-- here at all.
--
-- It would be possible to run the same inference over history -- match each
-- application to its agent's nearest answered call -- and it is deliberately
-- not done. The inference is sound in the moment because the agent is at their
-- desk with the call in front of them; run over months of history it is
-- guesswork that produces rows indistinguishable from evidence, on the one
-- measurement an agency can dispute. A column full of honest NONEs is worth
-- more than one full of plausible fabrications.
--
-- Rows written before this migration that DO carry a `callId` also stay NONE,
-- for the same reason: that id was verified against the tenant but never
-- against the agent, so it does not meet the bar CLIENT now sets.
--
-- ── How this migration is applied ────────────────────────────────────────────
--
--     psql "$DATABASE_URL" -f apps/api/prisma/migrations/20260921000000_application_call_attribution/migration.sql
--
-- Additive only, idempotent, and safe against a drifted schema. It creates one
-- enum, adds one column with a default, and creates one index. It drops
-- nothing, rewrites no existing value, and alters no other column.

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CallAttribution') THEN
        CREATE TYPE "CallAttribution" AS ENUM ('CLIENT', 'INFERRED', 'NONE');
    END IF;
END
$$;

-- NOT NULL with a DEFAULT, which PostgreSQL 11+ applies without rewriting the
-- table: existing rows read NONE without every one of them being touched.
ALTER TABLE "insurance_carrier_applications"
    ADD COLUMN IF NOT EXISTS "callAttribution" "CallAttribution" NOT NULL DEFAULT 'NONE';

-- The drill-down the column exists for: every application that came off a call.
CREATE INDEX IF NOT EXISTS "insurance_carrier_applications_tenantId_callId_idx"
    ON "insurance_carrier_applications" ("tenantId", "callId");

COMMIT;
