-- Which tenants are real agencies, and which are fixtures?
--
-- Production has five tenants -- Demo Organization, Test Organization, Test
-- Tenant, Sean Grove's Workspace, Yazzyl Vasquezz's Workspace -- and the
-- platform-wide screens are about to be read every day. Nothing in this
-- codebase guesses which of them is which: a name that looks like a fixture is
-- not evidence, and a tenant quietly excluded from the numbers because of its
-- name is a worse failure than a cluttered table.
--
-- So this is the query, and the decision is the owner's. Run it, read it, and
-- mark the ones that are not real agencies:
--
--     psql "$DATABASE_URL" -f apps/api/prisma/sql/tenant-volume.sql
--
-- then, for each one, either
--
--     PUT /api/v1/platform/tenants/:tenantId/non-production  {"isNonProduction": true,
--                                                             "note": "seeded demo fixture"}
--
-- or the toggle beside its row on the platform view. Marking a tenant excludes
-- it from the platform totals and hides its row behind a toggle. It deletes
-- nothing, suspends nothing, un-enrols nothing and changes no delivery or
-- billing behaviour, and it is reversible with the same call.
--
-- Columns: lifetime and last-30-day call and application volume, plus whether
-- the tenant is in the billing system at all. A tenant with no calls ever and
-- no applications ever is the easy case; one carrying live client traffic is
-- the one to be careful about.

SELECT
    t."id",
    t."name",
    t."slug",
    t."status",
    t."isNonProduction"                                       AS "already_marked",
    t."createdAt"::date                                       AS "created",
    (bp."billingEnrolledAt" IS NOT NULL)                       AS "enrolled_in_billing",
    COALESCE(c."calls_total", 0)                               AS "calls_total",
    COALESCE(c."calls_answered_total", 0)                      AS "calls_answered_total",
    COALESCE(c."calls_30d", 0)                                 AS "calls_30d",
    COALESCE(a."applications_total", 0)                        AS "applications_total",
    COALESCE(a."applications_submitted_total", 0)              AS "applications_submitted_total",
    COALESCE(a."applications_30d", 0)                          AS "applications_30d",
    c."last_call_at"
FROM "tenants" t
LEFT JOIN "agency_billing_profiles" bp ON bp."tenantId" = t."id"
LEFT JOIN (
    SELECT
        "tenantId",
        COUNT(*)                                                          AS "calls_total",
        COUNT(*) FILTER (WHERE "answeredAt" IS NOT NULL)                  AS "calls_answered_total",
        COUNT(*) FILTER (WHERE "createdAt" > NOW() - INTERVAL '30 days')   AS "calls_30d",
        MAX("createdAt")                                                  AS "last_call_at"
      FROM "calls"
     GROUP BY "tenantId"
) c ON c."tenantId" = t."id"
LEFT JOIN (
    SELECT
        "tenantId",
        COUNT(*)                                                          AS "applications_total",
        COUNT(*) FILTER (WHERE "submittedAt" IS NOT NULL)                 AS "applications_submitted_total",
        COUNT(*) FILTER (WHERE "createdAt" > NOW() - INTERVAL '30 days')   AS "applications_30d"
      FROM "insurance_carrier_applications"
     GROUP BY "tenantId"
) a ON a."tenantId" = t."id"
ORDER BY COALESCE(c."calls_total", 0) DESC, t."name" ASC;
