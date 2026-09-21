-- When each agent works.
--
-- ── What was wrong ───────────────────────────────────────────────────────────
--
-- `agency_profiles` carries `deliveryDays`, `deliveryStartTime` and
-- `deliveryEndTime` for the WHOLE agency, and routing knew nothing about hours
-- at all -- it gated on licence, SIP registration and concurrency and nothing
-- else. An agency running two shifts could not express it, so an agent who
-- finished at 2pm kept being rung at 7pm: the call reached a phone nobody was
-- sitting at, and was not offered to the agent who was.
--
-- ── Absence means "follow the agency", never "never available" ───────────────
--
-- There is NO backfill, and that is the whole safety property of this
-- migration. Every agent starts with no row, and an agent with no row is not
-- restricted: `services/routing.ts` excludes an agent only when they HAVE a
-- schedule and the current time falls outside it.
--
-- Writing a default schedule for everybody -- say, the agency's own delivery
-- window -- would look helpful and would be the worst thing this file could do.
-- The agency window is a billing concept, not a staffing one; applying it as a
-- routing gate would silence every agent who works outside it the moment this
-- deployed, with nothing on any screen explaining why the phones went quiet.
--
-- It is the same posture `docs/AGENT_LICENSED_STATES_ROLLOUT.md` records for
-- licences, for the same reason: enforce what you have been told, never invent
-- a constraint from the absence of data.
--
-- An EMPTY `days` array is different from having no row, and deliberately so:
-- it is an agent on leave, and it does restrict them.
--
-- ── Strings, and one clock ───────────────────────────────────────────────────
--
-- `HH:MM` and `MON`..`SUN`, exactly as `agency_profiles` stores them, so
-- nothing between here and the browser can shift a shift by a timezone. There
-- is no timezone column: the agency's `deliveryTimeZone` is the clock its day
-- is measured on, and a second one per agent would be a second answer to "what
-- time is it here" that could disagree with the billing day.
--
-- `startTime` after `endTime` is an overnight shift (21:00 to 05:00), which the
-- gate reads as such. A night shift is ordinary in this business.
--
-- ── How this migration is applied ────────────────────────────────────────────
--
--     psql "$DATABASE_URL" -f apps/api/prisma/migrations/20260921010000_agent_schedules/migration.sql
--
-- Additive only, idempotent, and safe against a drifted schema. It creates one
-- table and two indexes, drops nothing, alters no existing column, and writes
-- no row.

BEGIN;

CREATE TABLE IF NOT EXISTS "agent_schedules" (
    "id"        TEXT NOT NULL,
    "tenantId"  TEXT NOT NULL,
    "userId"    TEXT NOT NULL,
    -- 'MON'..'SUN'. An empty array is an agent on leave; no ROW at all is an
    -- agent whose hours are not enforced. The two are not the same.
    --
    -- No DEFAULT, matching the Prisma model: a default here would be invisible
    -- drift between a migrated database and one built by `prisma db push`,
    -- which is how CI builds its own. Every writer supplies `days`.
    "days"      TEXT[] NOT NULL,
    -- 'HH:MM', 24-hour, in the agency's deliveryTimeZone.
    "startTime" TEXT NOT NULL,
    "endTime"   TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- No DEFAULT, matching Prisma's `@updatedAt`, which sets the value from the
    -- client. A default here would be drift between a migrated database and one
    -- built by `prisma db push`.
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "agent_schedules_pkey" PRIMARY KEY ("id")
);

-- One schedule per agent. Two rows would be two answers to "are they on".
CREATE UNIQUE INDEX IF NOT EXISTS "agent_schedules_userId_key"
    ON "agent_schedules" ("userId");

-- The routing read: every schedule in one agency, resolved at once.
CREATE INDEX IF NOT EXISTS "agent_schedules_tenantId_idx"
    ON "agent_schedules" ("tenantId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'agent_schedules_tenantId_fkey'
    ) THEN
        ALTER TABLE "agent_schedules"
            ADD CONSTRAINT "agent_schedules_tenantId_fkey"
            FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'agent_schedules_userId_fkey'
    ) THEN
        ALTER TABLE "agent_schedules"
            ADD CONSTRAINT "agent_schedules_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "users"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

COMMIT;
