INSERT INTO tenants (id, name, slug, status, "createdAt", "updatedAt")
VALUES ('default-tenant-id', 'Default Tenant', 'default', 'ACTIVE', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

UPDATE users SET "tenantId" = 'default-tenant-id' WHERE "tenantId" IS NULL;

SELECT id, name FROM tenants;
SELECT id, email, "tenantId" FROM users;
