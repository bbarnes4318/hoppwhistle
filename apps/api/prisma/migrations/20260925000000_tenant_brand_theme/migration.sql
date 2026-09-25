-- White-label brand theme per agency.
--
-- "brandTheme" is which brand theme the agency's portal is drawn in -- a key
-- from BRAND_THEME_KEYS in @hopwhistle/shared, validated by the API -- and
-- "brandName" the name the portal should say. Both nullable, and NULL is the
-- default NetEnroll look, so every existing tenant is unchanged.
--
-- Applied by hand with psql (this database has no _prisma_migrations table):
--   psql "$DATABASE_URL" -f apps/api/prisma/migrations/20260925000000_tenant_brand_theme/migration.sql
--
-- Idempotent throughout: safe to run twice.

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "brandTheme" TEXT,
  ADD COLUMN IF NOT EXISTS "brandName" TEXT;
