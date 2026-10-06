-- MANAGER role: step 2 of 2, the `roles` row an invitation attaches.
--
-- An agency manager supervises the agency's agents: the live floor, their
-- calls and recordings, and listening in on a call in progress (listen-only,
-- FreeSWITCH eavesdrop). They administer nobody and change no configuration.
--
-- The capabilities themselves are defined in code (ROLE_PERMISSIONS.MANAGER in
-- apps/api/src/middleware/rbac.ts). The JSON column here only mirrors them,
-- and `effectivePermissionsFor` filters anything it adds through a floor, so
-- this row cannot widen the role past its definition.
--
-- Idempotent: a database where the row was created by hand keeps its id, so
-- any `user_roles` already pointing at it stay valid.

INSERT INTO "roles" ("id", "name", "description", "permissions", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::text,
  'MANAGER',
  'Agency manager: supervises agents on the live floor and can listen in on their calls',
  '["calls:read","calls:monitor","recordings:read","reports:read","campaigns:read","users:read"]'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("name") DO NOTHING;
