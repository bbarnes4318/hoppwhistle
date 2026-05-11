-- Seed the ADMIN role into roles table
INSERT INTO roles (id, name, description, permissions, "createdAt", "updatedAt")
VALUES
  ('role-admin', 'ADMIN', 'Full platform access', '["*"]'::jsonb, NOW(), NOW()),
  ('role-owner', 'OWNER', 'Tenant owner', '["*"]'::jsonb, NOW(), NOW()),
  ('role-agent', 'AGENT', 'Call center agent', '["calls:*","contacts:*"]'::jsonb, NOW(), NOW()),
  ('role-buyer', 'BUYER', 'Buyer portal access', '["calls:read","reports:read"]'::jsonb, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Assign ADMIN role to ALL 3 existing users
INSERT INTO user_roles (id, "userId", "roleId", "createdAt")
SELECT 'ur-' || u.id, u.id, 'role-admin', NOW()
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM user_roles ur WHERE ur."userId" = u.id AND ur."roleId" = 'role-admin'
);

-- Verify
SELECT u.email, array_agg(r.name) as roles
FROM users u
LEFT JOIN user_roles ur ON u.id = ur."userId"
LEFT JOIN roles r ON ur."roleId" = r.id
GROUP BY u.email
ORDER BY u.email;
