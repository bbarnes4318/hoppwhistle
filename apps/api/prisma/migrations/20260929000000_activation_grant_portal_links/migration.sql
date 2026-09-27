-- Activation grants carry the buyer or publisher a portal login is linked to.
--
-- Every invitation now goes through POST /api/v1/auth/activation-grants,
-- including the buyer and publisher portal logins that used to be created with
-- a temporary password by POST /api/v1/users/invite. A BUYER grant names the
-- buyer the new login sees, a PUBLISHER grant the publisher; registration reads
-- them off the grant, never off the request. Both are nullable and null for
-- every existing grant.
--
-- Applied by hand with psql (this database has no _prisma_migrations table):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/prisma/migrations/20260929000000_activation_grant_portal_links/migration.sql
--
-- One ALTER TABLE, so atomic; IF NOT EXISTS, so a second run is a no-op.

ALTER TABLE "tenant_activation_grants"
  ADD COLUMN IF NOT EXISTS "buyerId" TEXT,
  ADD COLUMN IF NOT EXISTS "publisherId" TEXT;
