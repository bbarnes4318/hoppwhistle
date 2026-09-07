-- Phase 4: a record of when each agent was available.
--
-- ── Why this exists ──────────────────────────────────────────────────────────
--
-- The per-agent table on the delivery portal is the product's real lever: an
-- agency that pulls its two worst closers off the queue raises its blended
-- closing percentage, which lowers its rate. To make that decision a principal
-- needs to see not only how an agent closed but how much of the day they were
-- actually on the queue -- a 4% closer who was available for six hours is a
-- different problem from one who was available for forty minutes.
--
-- Agent presence was Redis-only: one key per agent holding the CURRENT status
-- and when it was set, with a 24-hour TTL. That answers "what is this agent
-- doing now" and cannot answer "how long were they available today", because
-- each write overwrites the last and nothing accumulates.
--
-- So each status transition is now also appended here. One row per change, and
-- time in a state is the span from its row to the next one.
--
-- ── It is a log, not a state ─────────────────────────────────────────────────
--
-- Redis stays the source of truth for the CURRENT status: it is read on every
-- routing decision and must not become a database round trip. This table is
-- written beside it and read only by the portal. A failed write here must never
-- fail a status change, and it does not: the write is best-effort and logged.
--
-- ── There is no backfill, and there cannot be ────────────────────────────────
--
-- Nothing recorded these transitions before this table existed, so days before
-- deploy have no rows. The portal renders that as an em dash rather than as
-- zero minutes available: an agent who was on the queue all day and a day we
-- did not measure are different facts, and showing the second as the first
-- would put a coaching decision on a number nobody recorded.
--
-- ── How this migration is applied ────────────────────────────────────────────
--
--     psql "$DATABASE_URL" -f apps/api/prisma/migrations/20260912000000_add_agent_state_events/migration.sql
--
-- Additive only, idempotent, and safe against a drifted schema. It creates one
-- table and two indexes, drops nothing, and alters no existing column.

BEGIN;

CREATE TABLE IF NOT EXISTS "agent_state_events" (
    "id"         TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    -- 'available', 'away', 'dnd', 'offline', 'on-call'. Deliberately TEXT and
    -- not an enum: these values come from the softphone, a new one appearing
    -- must not fail an agent's status change, and an unrecognised state simply
    -- is not counted as available.
    "status"     TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_state_events_pkey" PRIMARY KEY ("id")
);

-- The only query shape: one agent's transitions across a day, in order.
CREATE INDEX IF NOT EXISTS "agent_state_events_userId_occurredAt_idx"
    ON "agent_state_events" ("userId", "occurredAt");

-- And the same across a whole agency for the per-agent table, which reads every
-- agent's day at once.
CREATE INDEX IF NOT EXISTS "agent_state_events_occurredAt_idx"
    ON "agent_state_events" ("occurredAt");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'agent_state_events_userId_fkey'
    ) THEN
        ALTER TABLE "agent_state_events"
            ADD CONSTRAINT "agent_state_events_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "users"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

COMMIT;
