-- Grant khall@dbmgconsulting.com BOTH agency roles.
--
-- This is intentionally two UserRole rows, not a new composite RoleName. The
-- application already unions every role held by a user, so OWNER + ADMIN gives
-- the account both role identities and the union of their capabilities.
--
-- The statement is idempotent and safe if either the user or a role row is not
-- present yet: it simply inserts nothing. Once the account exists, deploying
-- this migration guarantees both roles are present without creating duplicates.
INSERT INTO "user_roles" ("id", "userId", "roleId", "createdAt")
SELECT
  md5(u."id" || ':' || r."id"),
  u."id",
  r."id",
  CURRENT_TIMESTAMP
FROM "users" u
CROSS JOIN "roles" r
WHERE lower(u."email") = 'khall@dbmgconsulting.com'
  AND r."name" IN ('OWNER', 'ADMIN')
  AND NOT EXISTS (
    SELECT 1
    FROM "user_roles" existing
    WHERE existing."userId" = u."id"
      AND existing."roleId" = r."id"
  );
