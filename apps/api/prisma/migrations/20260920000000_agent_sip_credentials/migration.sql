-- Per-agent SIP identity: one extension and one password per agent.
--
-- ── What was wrong ───────────────────────────────────────────────────────────
--
-- An agent's SIP identity lived in `users.metadata->>'extension'`, allocated by
-- `GET /api/v1/agent/webrtc/credentials` from the fixed range 1000..1019 and
-- scoped to the agency. The password was `SIP_AGENT_PASSWORD`: one value, the
-- same for every agent on the platform, matching the `$${default_password}` in
-- every file under `apps/freeswitch/conf/directory/default/`.
--
--   1. The pool was twenty wide and the allocator fell back to extension '1000'
--      when it ran out, silently, so an agency's twenty-first agent took over
--      the first agent's registration.
--
--   2. The pool was scoped per tenant, but FreeSWITCH's directory is ONE flat
--      `default` domain with no tenant dimension. Agency A's 1000 and agency
--      B's 1000 were the same SIP user, so whichever browser registered last
--      received both agencies' calls.
--
--   3. One shared password meant any agent could register as any extension on
--      the platform -- including another agency's -- and take their calls.
--
-- ── What this migration establishes ──────────────────────────────────────────
--
-- `extension` is UNIQUE across the whole table rather than per `tenantId`. That
-- is deliberate and it is the fix for (2): the constraint has to hold where
-- FreeSWITCH resolves the name, and FreeSWITCH resolves it globally. A unique
-- index scoped to the agency would re-create the collision it exists to stop.
--
-- The range stays 1000..1999 because that is what the dialplan already routes:
-- `apps/freeswitch/conf/dialplan/default.xml` matches `^(1[0-9]{3})$` and tests
-- `${local_ext}` against `^\d{4}$` in two further places. This takes the
-- platform from 20 identities to 1000 without touching call routing.
--
-- ── The backfill, and the collisions it has to resolve ───────────────────────
--
-- Existing agents keep their current extension WHERE IT IS STILL FREE, because
-- an agent whose extension changes under them has a registered softphone
-- pointing at a name that no longer authenticates. Where two agencies hold the
-- same extension -- which defect (2) guarantees for every agency past the first
-- -- the OLDEST user row keeps it and the others are left without a row. They
-- are not assigned a new extension here: the application allocates one on their
-- next credential fetch, inside the same transaction that writes the row, and
-- doing it there means one allocator rather than two that must agree.
--
-- No password is backfilled. There is no per-agent secret to migrate FROM --
-- the old one was global -- and writing the shared password into every row
-- would carry defect (3) across the migration. A backfilled row is therefore a
-- RESERVATION: it holds the name so the allocator cannot hand it to somebody
-- else, with `passwordEncrypted` NULL until the agent's next credential fetch
-- generates one. The directory refuses to authenticate a reservation, because
-- there is no password to check it against.
--
-- ── How this migration is applied ────────────────────────────────────────────
--
--     psql "$DATABASE_URL" -f apps/api/prisma/migrations/20260920000000_agent_sip_credentials/migration.sql
--
-- Additive only, idempotent, and safe against a drifted schema. It creates one
-- table, one enum and three indexes, drops nothing, and alters no existing
-- column. `users.metadata->>'extension'` is READ and left in place: the routing
-- service still falls back to it for any agent not yet provisioned here.

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AgentSipCredentialStatus') THEN
        CREATE TYPE "AgentSipCredentialStatus" AS ENUM ('ACTIVE', 'REVOKED');
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "agent_sip_credentials" (
    "id"                TEXT NOT NULL,
    "tenantId"          TEXT NOT NULL,
    "userId"            TEXT NOT NULL,
    -- The SIP username, '1000'..'1999'. TEXT rather than INTEGER because it is
    -- a name that FreeSWITCH compares as a string, and a leading zero or a
    -- future alphanumeric scheme must not be a type change.
    "extension"         TEXT NOT NULL,
    -- AES-256-GCM, 'enc:v1:<iv>:<tag>:<ciphertext>'. Never the clear value.
    -- NULL is a reservation awaiting its first issue; see the note above.
    "passwordEncrypted" TEXT,
    "status"            "AgentSipCredentialStatus" NOT NULL DEFAULT 'ACTIVE',
    "rotatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_sip_credentials_pkey" PRIMARY KEY ("id")
);

-- One identity per agent. Two rows for one agent is an agent whose calls go to
-- whichever browser registered last -- the same defect, one level down.
CREATE UNIQUE INDEX IF NOT EXISTS "agent_sip_credentials_userId_key"
    ON "agent_sip_credentials" ("userId");

-- THE constraint. Global, not per-tenant. See the note above.
CREATE UNIQUE INDEX IF NOT EXISTS "agent_sip_credentials_extension_key"
    ON "agent_sip_credentials" ("extension");

-- The agency-scoped roster read.
CREATE INDEX IF NOT EXISTS "agent_sip_credentials_tenantId_status_idx"
    ON "agent_sip_credentials" ("tenantId", "status");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'agent_sip_credentials_tenantId_fkey'
    ) THEN
        ALTER TABLE "agent_sip_credentials"
            ADD CONSTRAINT "agent_sip_credentials_tenantId_fkey"
            FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'agent_sip_credentials_userId_fkey'
    ) THEN
        ALTER TABLE "agent_sip_credentials"
            ADD CONSTRAINT "agent_sip_credentials_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "users"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

-- ── Backfill: claim the extensions that are already in use ───────────────────
--
-- `DISTINCT ON (extension) ... ORDER BY extension, "createdAt"` is the
-- collision rule: where several agents across the platform hold the same
-- extension -- which defect (2) guarantees for every agency past the first --
-- the OLDEST user row keeps it. The rest get no row here and are allocated a
-- free extension by the application on their next credential fetch.
--
-- Filtered to what can actually be honoured:
--   * `tenantId IS NOT NULL`  -- the column is nullable on `users`, and a
--                                credential has to belong to an agency.
--   * `^1[0-9]{3}$`           -- what the dialplan routes. A value outside it
--                                was never reachable and is not preserved.
--
-- `ON CONFLICT DO NOTHING` twice over (userId and extension are both unique),
-- so re-running this file claims nothing a second time.
INSERT INTO "agent_sip_credentials" ("id", "tenantId", "userId", "extension", "passwordEncrypted")
SELECT DISTINCT ON (claimed.extension)
       gen_random_uuid()::TEXT,
       claimed."tenantId",
       claimed.id,
       claimed.extension,
       NULL
FROM (
    SELECT u.id,
           u."tenantId",
           u."createdAt",
           trim(u.metadata->>'extension') AS extension
    FROM "users" u
    WHERE u."tenantId" IS NOT NULL
      AND u.metadata ? 'extension'
      AND trim(u.metadata->>'extension') ~ '^1[0-9]{3}$'
) AS claimed
ORDER BY claimed.extension, claimed."createdAt"
ON CONFLICT DO NOTHING;

COMMIT;
