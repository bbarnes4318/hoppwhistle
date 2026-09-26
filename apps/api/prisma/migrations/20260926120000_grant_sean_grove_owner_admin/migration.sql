-- Grant seangrove@gmail.com BOTH agency roles (OWNER + ADMIN).
--
-- Same shape as 20260915153900_grant_khall_owner_admin: two UserRole rows, which
-- the application unions. The account already holds ADMIN, so in practice this
-- adds OWNER; the NOT EXISTS keeps it idempotent and never duplicates a row. If
-- the account is not present it simply inserts nothing.
INSERT INTO "user_roles" ("id", "userId", "roleId", "createdAt")
SELECT
  md5(u."id" || ':' || r."id"),
  u."id",
  r."id",
  CURRENT_TIMESTAMP
FROM "users" u
CROSS JOIN "roles" r
WHERE lower(u."email") = 'seangrove@gmail.com'
  AND r."name" IN ('OWNER', 'ADMIN')
  AND NOT EXISTS (
    SELECT 1
    FROM "user_roles" existing
    WHERE existing."userId" = u."id"
      AND existing."roleId" = r."id"
  );
