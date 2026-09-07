-- Single-use activation grants: the only way a new account learns its tenant.
--
-- POST /api/auth/register answered "which tenant?" by inspecting the request.
-- The helper it used (auth.ts getDefaultTenantId) tried, in order:
--
--   1. the Host header matched against tenants.domain
--   2. the Referer header's hostname, overriding the above
--   3. the Origin header's hostname, overriding both
--   4. the first label of that host matched against tenants.slug
--   5. the tenant with slug 'test-org'
--   6. the tenant with slug 'default'
--   7. the oldest ACTIVE tenant row in the table
--   8. the oldest tenant row of any status
--   9. failing all of that, CREATE a tenant
--
-- Steps 1-4 are chosen by whoever sent the request. Steps 5-8 are chosen by row
-- order. With two agencies live on one host, step 7 is the one that fires, and
-- it puts every self-serve signup inside whichever agency was created first.
--
-- Registration no longer accepts a tenant from anywhere. It accepts a token,
-- and the row below is what the token resolves to. Rows are written only after
-- the server has verified something -- a completed Stripe Checkout session, or
-- an invitation from an authenticated OWNER/ADMIN of that same tenant.
--
-- Only the SHA-256 of the token is stored (as with "api_keys"."keyHash"), so a
-- database dump contains no usable activation links.

CREATE TYPE "TenantActivationSource" AS ENUM ('STRIPE_CHECKOUT', 'ADMIN_INVITE');

CREATE TABLE "tenant_activation_grants" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "roleName" "RoleName" NOT NULL DEFAULT 'AGENT',
    "source" "TenantActivationSource" NOT NULL,
    "stripeSessionId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "redeemedAt" TIMESTAMP(3),
    "redeemedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_activation_grants_pkey" PRIMARY KEY ("id")
);

-- The lookup key. Unique because a token names exactly one grant; a collision
-- would mean two tenants answer to the same link.
CREATE UNIQUE INDEX "tenant_activation_grants_tokenHash_key"
    ON "tenant_activation_grants"("tokenHash");

-- Unique so that a redelivered Stripe webhook mints no second grant for a
-- session that already has one. Stripe retries; idempotency has to live here
-- rather than in the handler's memory.
CREATE UNIQUE INDEX "tenant_activation_grants_stripeSessionId_key"
    ON "tenant_activation_grants"("stripeSessionId");

CREATE INDEX "tenant_activation_grants_tenantId_idx"
    ON "tenant_activation_grants"("tenantId");

CREATE INDEX "tenant_activation_grants_email_idx"
    ON "tenant_activation_grants"("email");

ALTER TABLE "tenant_activation_grants"
    ADD CONSTRAINT "tenant_activation_grants_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
