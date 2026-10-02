-- The states an invited agent is licensed in, recorded when the invitation is
-- issued and copied onto the agent's account when they set it up, so an agent
-- never starts with no licence (and therefore no routed calls).
--
-- Applied by hand with psql (this database has no _prisma_migrations table):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/prisma/migrations/20261005000000_activation_grant_licensed_states/migration.sql
--
-- Idempotent.
ALTER TABLE "tenant_activation_grants"
  ADD COLUMN IF NOT EXISTS "licensedStates" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
