-- NetEnroll platform staff, and the agency they are currently acting inside.
--
-- ── Why not a role ───────────────────────────────────────────────────────────
--
-- "RoleName" is per-tenant by construction: a "user_roles" row grants a name
-- inside the tenant its user belongs to. So every check on OWNER or ADMIN in
-- this codebase means "an administrator of SOME agency", not "an administrator
-- of the platform". Today the only OWNER accounts are NetEnroll's own, which is
-- why gating a platform-wide route on OWNER has not yet leaked anything. It
-- leaks the moment the first agency principal is given a login.
--
-- It is also deliberately not modelled as "OWNER of a special tenant": that
-- puts the capability back inside the tenant dimension, where a bug in tenant
-- resolution could confer it, and conflates "which agency am I acting in" with
-- "may I act across agencies". Those are different questions and now have
-- different tables.
--
-- ── Why the acting tenant is a table ─────────────────────────────────────────
--
-- A platform admin defaults to NO acting tenant: the cross-agency view, with
-- agency-scoped routes refusing them, because "no tenant" is not a wildcard. To
-- act inside one agency they select it explicitly, and that selection must live
-- where the browser cannot set it.
--
-- Not a header, query parameter or body field: the migration before this one
-- removed every such input, and re-adding one for privileged users would give
-- the most powerful accounts the weakest tenant resolution on the platform.
--
-- Not the Redis session: "middleware/session.ts" catches and swallows its own
-- errors, so a Redis blip silently drops whatever it held. A switch that
-- decides whose data an operator is looking at must not fail quietly.
--
-- So it is a row here. The enter endpoint writes it, the leave endpoint deletes
-- it, and the authentication middleware reads it and copies it onto
-- request.user.tenantId. "lib/tenant-context.ts" is unchanged and still reads
-- request.user and nothing else.

CREATE TABLE "platform_admins" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedBy" TEXT,
    "note" TEXT,

    CONSTRAINT "platform_admins_pkey" PRIMARY KEY ("id")
);

-- One row per user: holding the row IS the capability, so a second row would
-- mean nothing and a duplicate would only confuse revocation.
CREATE UNIQUE INDEX "platform_admins_userId_key" ON "platform_admins"("userId");

ALTER TABLE "platform_admins"
    ADD CONSTRAINT "platform_admins_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "platform_acting_tenants" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_acting_tenants_pkey" PRIMARY KEY ("id")
);

-- Unique on userId: an operator is inside one agency or none, never two. The
-- constraint is what makes "enter" idempotent-by-replacement rather than
-- accumulating selections nobody can see.
CREATE UNIQUE INDEX "platform_acting_tenants_userId_key"
    ON "platform_acting_tenants"("userId");

CREATE INDEX "platform_acting_tenants_tenantId_idx"
    ON "platform_acting_tenants"("tenantId");

ALTER TABLE "platform_acting_tenants"
    ADD CONSTRAINT "platform_acting_tenants_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Cascade on the tenant too: if an agency is deleted, nobody is left "inside"
-- it holding a dangling selection.
ALTER TABLE "platform_acting_tenants"
    ADD CONSTRAINT "platform_acting_tenants_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
