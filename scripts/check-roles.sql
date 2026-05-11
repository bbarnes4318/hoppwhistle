SELECT u.email, array_agg(r.name) as roles
FROM users u
LEFT JOIN user_roles ur ON u.id = ur."userId"
LEFT JOIN roles r ON ur."roleId" = r.id
GROUP BY u.email
ORDER BY u.email;
