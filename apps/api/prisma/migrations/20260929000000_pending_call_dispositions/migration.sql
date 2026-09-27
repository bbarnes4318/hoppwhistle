-- Softphone dispositions saved before their call's CDR has landed.
--
-- ── What was wrong ───────────────────────────────────────────────────────────
--
-- An inbound softphone call's row is written by the FreeSWITCH CDR after
-- hangup, under callSid `fs-<uuid>`. The softphone's disposition named the call
-- by the browser leg's SIP Call-ID instead, which no row carries, so
-- POST /api/v1/calls/disposition created a second INBOUND row for the one call.
--
-- FreeSWITCH now hands the softphone the call's own id (`X-Call-Id: fs-<uuid>`).
-- When the agent saves before the CDR arrives, the disposition waits here, and
-- the CDR handler merges it into the row it writes and deletes this one.
--
-- Applied by hand with psql (this database has no _prisma_migrations table):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/prisma/migrations/20260929000000_pending_call_dispositions/migration.sql
--
-- Idempotent and one transaction.

BEGIN;

CREATE TABLE IF NOT EXISTS "pending_call_dispositions" (
    "id"          TEXT NOT NULL,
    "tenantId"    TEXT NOT NULL,
    "callSid"     TEXT NOT NULL,
    "userId"      TEXT,
    "disposition" TEXT NOT NULL,
    "notes"       TEXT,
    "callSource"  TEXT,
    "followUpAt"  TIMESTAMP(3),
    "duration"    INTEGER,
    -- The validated application for APPLICATION_SUBMITTED, recorded at merge.
    "application" JSONB,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- No DEFAULT, matching Prisma's `@updatedAt`, which sets it from the client.
    "updatedAt"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "pending_call_dispositions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "pending_call_dispositions_tenantId_callSid_key"
    ON "pending_call_dispositions" ("tenantId", "callSid");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'pending_call_dispositions_tenantId_fkey'
    ) THEN
        ALTER TABLE "pending_call_dispositions"
            ADD CONSTRAINT "pending_call_dispositions_tenantId_fkey"
            FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

COMMIT;
