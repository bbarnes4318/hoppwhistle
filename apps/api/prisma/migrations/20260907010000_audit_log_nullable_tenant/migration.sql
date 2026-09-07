-- Let the audit trail record events that genuinely have no agency.
--
-- ── The bug ──────────────────────────────────────────────────────────────────
--
-- "audit_logs"."tenantId" was NOT NULL with a foreign key to "tenants". But the
-- events with no tenant are precisely the ones most worth recording:
--
--   auth.login.failed      an address that matches no account
--   auth.jwt.invalid       a token that verifies as nobody
--   csrf.*                 a forgery attempt on an unauthenticated request
--   auth.register.rejected an activation token that resolves to no agency
--
-- Callers had nowhere to put "none", so they passed the strings 'unknown' or
-- 'default'. Neither is a tenant id. Every one of those inserts violated the
-- foreign key, and `auditLog()` caught the error and discarded it. The trail
-- read as present in code review and recorded nothing at runtime.
--
-- ── The fix ──────────────────────────────────────────────────────────────────
--
-- NULL is the honest representation of "this event had no agency". The foreign
-- key is kept for every row that names one, so a fake id is now a loud failure
-- instead of a silent one -- and `auditLog()` no longer swallows, so it is loud
-- at the call site rather than in a log nobody reads.
--
-- This matters beyond tidiness: the acting-tenant switch writes an audit row for
-- every entry by NetEnroll staff into an agency's data. Those rows are the only
-- record of who looked at whose data.
--
-- Additive and reversible. No existing row changes: nothing could ever have been
-- written with a tenantId that was not a real tenant, so there is no bad data to
-- migrate -- the rows simply were not there.

ALTER TABLE "audit_logs" ALTER COLUMN "tenantId" DROP NOT NULL;

-- Postgres does not index NULLs in a way that helps "WHERE tenantId IS NULL",
-- and the tenant-less rows are a small, security-relevant slice that operators
-- will want to read on their own. A partial index keeps that query fast without
-- widening the existing composite index.
CREATE INDEX "audit_logs_no_tenant_idx"
    ON "audit_logs"("createdAt" DESC)
    WHERE "tenantId" IS NULL;
