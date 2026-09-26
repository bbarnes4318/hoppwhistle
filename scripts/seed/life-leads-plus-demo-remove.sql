-- Remove the Life Leads Plus demo data seeded by scripts/seed/life-leads-plus-demo.sql.
--
--   cat scripts/seed/life-leads-plus-demo-remove.sql | docker exec -i hopwhistle-postgres-dev psql -U callfabric -d callfabric -v ON_ERROR_STOP=1
--
-- Deletes only marked rows (see the seed's header for the markers), in the
-- seed's order, including the two seeded child agencies, then clears the
-- non-production marker on Life Leads Plus. The white-label flag and the brand
-- stay as they are: they are the tenant's configuration, not demo data.
--
-- One transaction. Running it on a database with nothing seeded deletes nothing.

BEGIN;

DO $guard$
DECLARE
  found_count integer;
BEGIN
  SELECT count(*) INTO found_count FROM tenants WHERE name = 'Life Leads Plus';
  IF found_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one tenant named Life Leads Plus, found %', found_count;
  END IF;

  CREATE TEMP TABLE llp ON COMMIT DROP AS
    SELECT id FROM tenants WHERE name = 'Life Leads Plus';
END
$guard$;

-- Life Leads Plus and the child agencies this script seeded under it.
CREATE TEMP TABLE llp_scope ON COMMIT DROP AS
  SELECT id FROM llp
  UNION ALL
  SELECT t.id FROM tenants t
  WHERE t.slug LIKE 'llp-demo-%' AND t."parentTenantId" = (SELECT id FROM llp);

-- ─────────────────────────────────────────────────────────────────────────────
-- Delete every marked row, children first
-- ─────────────────────────────────────────────────────────────────────────────

DELETE FROM publisher_payments
WHERE "tenantId" IN (SELECT id FROM llp_scope)
  AND ("reference" LIKE 'LLPDEMO-%'
       OR "publisherId" IN (SELECT id FROM publishers
                            WHERE "tenantId" IN (SELECT id FROM llp_scope)
                              AND code LIKE 'LLPDEMO%'));

DELETE FROM insurance_carrier_applications
WHERE "tenantId" IN (SELECT id FROM llp_scope) AND "clientRequestId" LIKE 'llp-demo-%';

DELETE FROM calls
WHERE "tenantId" IN (SELECT id FROM llp_scope) AND "callSid" LIKE 'LLPDEMO-%';

DELETE FROM campaign_buyers
WHERE "tenantId" IN (SELECT id FROM llp_scope)
  AND (
    "campaignId" IN (
      SELECT id FROM campaigns
      WHERE "tenantId" IN (SELECT id FROM llp_scope) AND metadata->>'seed' = 'llp-demo'
    )
    OR "buyerId" IN (
      SELECT id FROM buyers
      WHERE "tenantId" IN (SELECT id FROM llp_scope) AND code LIKE 'LLPDEMO%'
    )
  );

DELETE FROM campaign_publishers
WHERE "tenantId" IN (SELECT id FROM llp_scope)
  AND (
    "campaignId" IN (
      SELECT id FROM campaigns
      WHERE "tenantId" IN (SELECT id FROM llp_scope) AND metadata->>'seed' = 'llp-demo'
    )
    OR "publisherId" IN (
      SELECT id FROM publishers
      WHERE "tenantId" IN (SELECT id FROM llp_scope) AND code LIKE 'LLPDEMO%'
    )
  );

DELETE FROM campaigns
WHERE "tenantId" IN (SELECT id FROM llp_scope) AND metadata->>'seed' = 'llp-demo';

DELETE FROM buyers
WHERE "tenantId" IN (SELECT id FROM llp_scope) AND code LIKE 'LLPDEMO%';

DELETE FROM publishers
WHERE "tenantId" IN (SELECT id FROM llp_scope) AND code LIKE 'LLPDEMO%';

DELETE FROM user_roles
WHERE "userId" IN (
  SELECT id FROM users
  WHERE "tenantId" IN (SELECT id FROM llp_scope) AND email LIKE '%@demo.lifeleadsplus.test'
);

DELETE FROM users
WHERE "tenantId" IN (SELECT id FROM llp_scope) AND email LIKE '%@demo.lifeleadsplus.test';

DELETE FROM tenants
WHERE slug LIKE 'llp-demo-%' AND "parentTenantId" = (SELECT id FROM llp);

UPDATE tenants SET
  "isNonProduction" = false,
  "nonProductionNote" = NULL,
  "nonProductionMarkedAt" = NULL,
  "updatedAt" = now()
WHERE id = (SELECT id FROM llp);

COMMIT;
