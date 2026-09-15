-- Remove ADMIN role from cpoleway@dbmgconsulting.com
DELETE FROM user_roles
WHERE "userId" = (SELECT id FROM users WHERE email = 'cpoleway@dbmgconsulting.com')
  AND "roleId" = 'role-admin';

-- Verify
SELECT u.email, array_agg(r.name) as roles
FROM users u
LEFT JOIN user_roles ur ON u.id = ur."userId"
LEFT JOIN roles r ON ur."roleId" = r.id
GROUP BY u.email
ORDER BY u.email;
