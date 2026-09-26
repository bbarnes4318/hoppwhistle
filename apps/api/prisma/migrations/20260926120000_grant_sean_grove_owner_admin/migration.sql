-- Grant Sean Grove BOTH agency roles (OWNER + ADMIN).
--
-- Same shape as 20260915153900_grant_khall_owner_admin: two UserRole rows, which
-- the application unions. The account is matched by name because no email is on
-- record here; the match must be unique, so if zero or several users are named
-- Sean Grove this inserts nothing rather than granting the wrong account.
-- Idempotent: existing role rows are never duplicated.
WITH target AS (
  SELECT u."id"
  FROM "users" u
  WHERE lower(trim(u."firstName")) = 'sean'
    AND lower(trim(u."lastName")) = 'grove'
),
unique_target AS (
  SELECT "id" FROM target WHERE (SELECT count(*) FROM target) = 1
)
INSERT INTO "user_roles" ("id", "userId", "roleId", "createdAt")
SELECT
  md5(t."id" || ':' || r."id"),
  t."id",
  r."id",
  CURRENT_TIMESTAMP
FROM unique_target t
CROSS JOIN "roles" r
WHERE r."name" IN ('OWNER', 'ADMIN')
  AND NOT EXISTS (
    SELECT 1
    FROM "user_roles" existing
    WHERE existing."userId" = t."id"
      AND existing."roleId" = r."id"
  );
