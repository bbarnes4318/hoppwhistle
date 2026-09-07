-- Activation grants for NetEnroll staff: a grant with no tenant.
--
-- ── Why ──────────────────────────────────────────────────────────────────────
--
-- Production has exactly one platform admin. joel.vasquez@outlook.com has no
-- user account, so `platform:admins --sync` reported him as missing and granted
-- nothing. A launch set of one is a single point of failure: if that account is
-- lost, the dialer console, the quota routes and the /admin/api/v1 console are
-- unreachable for everybody, and there is no second operator to restore them.
--
-- Self-serve signup requires an invitation (Phase 1, migration
-- 20260906000000), and every invitation so far carries a tenant. Inviting
-- NetEnroll staff through an agency's invitation would create a NetEnroll
-- employee inside a customer's agency, visible in that customer's team roster,
-- holding one of its roles. A platform admin's User.tenantId is null by design
-- (docs/PLATFORM_ADMIN.md §1); the grant has to be able to say so.
--
-- ── Why this is not a new way in ─────────────────────────────────────────────
--
-- A tenant-less grant confers strictly LESS than an ordinary one. It creates an
-- account with no agency and no role, which can read nothing at all until
-- `platform:admins --grant` is run for it separately, on the host, by somebody
-- who already has DATABASE_URL.
--
-- There is deliberately NO HTTP route that issues one. `POST
-- /api/v1/auth/activation-grants` is unchanged and still has no tenantId field:
-- it invites into the caller's own agency and nowhere else. Only
-- `pnpm --filter @hopwhistle/api platform:admins -- --invite <email>` mints a
-- PLATFORM_INVITE, and that needs shell access to the host -- the same bar as
-- granting the capability directly.
--
-- ── How this is applied ──────────────────────────────────────────────────────
--
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--       -f apps/api/prisma/migrations/20260909000000_platform_activation_grants/migration.sql
--
-- Additive and idempotent. It relaxes one NOT NULL and adds one enum value; it
-- drops nothing and rewrites no data. Running it twice is a no-op.
--
-- Relaxing a NOT NULL is safe in both directions here: every existing row has a
-- tenant and keeps it, and nothing reads the column expecting non-null except
-- code shipped in the same change.

BEGIN;

-- The new source. ADD VALUE IF NOT EXISTS is idempotent; it cannot run inside a
-- transaction block on PostgreSQL below 12, and this database is 15+.
ALTER TYPE "TenantActivationSource" ADD VALUE IF NOT EXISTS 'PLATFORM_INVITE';

COMMIT;

BEGIN;

-- A grant for NetEnroll staff belongs to no agency.
ALTER TABLE "tenant_activation_grants" ALTER COLUMN "tenantId" DROP NOT NULL;

COMMIT;
