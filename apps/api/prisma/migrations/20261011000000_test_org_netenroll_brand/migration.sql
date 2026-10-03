-- Test Organization is NetEnroll's own tenant and is drawn as NetEnroll.
--
-- Clears any white-label brand theme, brand name or portal domain stored on
-- its row. The API also refuses to set them again and resolves no brand for it
-- whatever the row says (lib/tenant-brand.ts `NETENROLL_ONLY_TENANT_SLUGS`).
-- Data only, idempotent.

BEGIN;

UPDATE "tenants"
SET "brandTheme" = NULL,
    "brandName" = NULL,
    "domain" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'test-org'
  AND ("brandTheme" IS NOT NULL OR "brandName" IS NOT NULL OR "domain" IS NOT NULL);

COMMIT;
