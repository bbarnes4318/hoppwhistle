-- Phase 2: measurement, the rate curve, and the daily rating engine.
--
-- ── How this migration is applied ────────────────────────────────────────────
--
-- The production database has no "_prisma_migrations" table and has never been
-- managed by `prisma migrate`. Every migration to date was applied by piping
-- its migration.sql into psql by hand, and this one is written to be applied
-- the same way:
--
--     psql "$DATABASE_URL" -f apps/api/prisma/migrations/20260908000000_add_rating_engine/migration.sql
--
-- So it is additive only, idempotent, and safe against a schema that may have
-- drifted from schema.prisma. Every statement is IF NOT EXISTS or guarded by a
-- DO block; running it twice is a no-op. It drops nothing and alters no
-- existing column's type or nullability. Do NOT add `prisma migrate deploy` to
-- the deploy path to apply it: against an empty migration history that would
-- try to replay every migration from the beginning.
--
-- ── What it adds ─────────────────────────────────────────────────────────────
--
-- Two columns on existing tables (one nullable timestamp, two indexes), and
-- seven new tables. Nothing here charges anyone; Phase 3 does that, from these
-- numbers.

BEGIN;

-- ── A note on the column names ───────────────────────────────────────────────
--
-- An earlier draft of THIS FILE named three of these columns after "business
-- days": "rating_settings.windowBusinessDays", "rate_changes.windowBusinessDays"
-- and "rate_changes.effectiveBusinessDay". That was wrong, and the file is
-- corrected in place rather than followed by a rename migration because it has
-- never been applied to production -- the whole change is still on its branch.
--
-- The correction matters beyond tidiness: "Business Day" means Monday to Friday
-- excluding US federal holidays and bounds four contractual notice periods, and
-- leaving the rating columns wearing that name is how the two get conflated
-- again. The rating window is counted in DELIVERY DAYS; the effective day is a
-- CALENDAR day. See docs/RATING.md.
--
-- The guarded block at the end of this file cleans up after that earlier draft
-- if anyone applied it to a scratch database, so re-running here is still a
-- no-op rather than an error.
--
-- ---------------------------------------------------------------------------
-- Measurement inputs on existing tables
-- ---------------------------------------------------------------------------

-- When an application first reached submitted state. Write-once, so an
-- application that reaches submitted twice counts once, and attribution is by
-- submission rather than by the call that produced it.
ALTER TABLE "insurance_carrier_applications"
    ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3);

-- Backfill the rows that are already submitted. `automationCompletedAt` is the
-- moment the carrier portal accepted the application, which is the submission
-- timestamp for every row written by the RPA; `updatedAt` is the fallback for
-- any row marked SUBMITTED by another path. Guarded on IS NULL so re-running
-- never moves a timestamp that has already been set.
UPDATE "insurance_carrier_applications"
   SET "submittedAt" = COALESCE("automationCompletedAt", "updatedAt")
 WHERE "status" = 'SUBMITTED'
   AND "submittedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "insurance_carrier_applications_tenantId_submittedAt_idx"
    ON "insurance_carrier_applications"("tenantId", "submittedAt");

-- Delivered calls are counted by `answeredAt`: a call is delivered when one of
-- the agency's agents picks it up.
CREATE INDEX IF NOT EXISTS "calls_tenantId_answeredAt_idx"
    ON "calls"("tenantId", "answeredAt");

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AgencyRatingStatus') THEN
        CREATE TYPE "AgencyRatingStatus" AS ENUM (
            'INTRODUCTORY',
            'OPENING_BLOCK',
            'RATED',
            'UNDER_REVIEW'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RateChangeStatus') THEN
        CREATE TYPE "RateChangeStatus" AS ENUM ('APPLIED', 'BELOW_MINIMUM', 'NO_DATA');
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- The curve, versioned
--
-- A change to the anchor points must never alter a rate already applied to a
-- completed settlement, so the curve is data with a version, every rate change
-- records the version that priced it, and a new curve is a new row rather than
-- an edit.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "rate_curve_versions" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "label" TEXT,
    "note" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),
    -- Below this closing percentage there is NO rate. The curve is never
    -- extrapolated downward; the agency is flagged for review instead.
    "minimumClosingPct" DECIMAL(6,3) NOT NULL,
    -- At and above this, the curve is flat at its highest anchor's rate.
    "flatFromClosingPct" DECIMAL(6,3) NOT NULL,
    -- The opening package. Deliberately not an anchor point: it is a
    -- commercial offer, not a point on the curve.
    "introductoryRate" DECIMAL(10,2) NOT NULL,
    "introductoryApplications" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "rate_curve_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "rate_curve_versions_version_key"
    ON "rate_curve_versions"("version");

CREATE TABLE IF NOT EXISTS "rate_curve_anchors" (
    "id" TEXT NOT NULL,
    "curveVersionId" TEXT NOT NULL,
    -- A percentage: 10.0 means 10%.
    "closingPct" DECIMAL(6,3) NOT NULL,
    -- Dollars per submitted application.
    "rate" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "rate_curve_anchors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "rate_curve_anchors_curveVersionId_closingPct_key"
    ON "rate_curve_anchors"("curveVersionId", "closingPct");

CREATE INDEX IF NOT EXISTS "rate_curve_anchors_curveVersionId_idx"
    ON "rate_curve_anchors"("curveVersionId");

-- ---------------------------------------------------------------------------
-- Operational settings. One row, id 'global'.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "rating_settings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    -- Trailing window, in DELIVERY DAYS, that sets tomorrow's rate.
    -- Configurable; 3 by default. A Delivery Day is a calendar day on which
    -- NetEnroll delivered at least one call to that agency: not calendar days
    -- (which price a weekday-only agency's Monday off two empty weekend days)
    -- and not Business Days (which are the contractual notice-period unit and
    -- would be wrong for an agency that does work weekends).
    --
    -- There is deliberately no minimum-call threshold beside it: with a
    -- continuous curve there are no band edges for a thin sample to fall off.
    "windowDeliveryDays" INTEGER NOT NULL DEFAULT 3,
    -- Calendar days to search back for those Delivery Days before giving up.
    -- A bound, not a business rule; a short window is recorded short.
    "deliveryDayLookback" INTEGER NOT NULL DEFAULT 60,
    "activeCurveVersionId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rating_settings_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- Per-agency state and the immutable history
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "agency_rating_states" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" "AgencyRatingStatus" NOT NULL DEFAULT 'INTRODUCTORY',
    -- Null in UNDER_REVIEW: an agency below the curve's minimum has no rate at
    -- all, which is not a rate of zero and must never render as one.
    "currentRate" DECIMAL(10,2),
    "curveVersionId" TEXT,
    -- 'YYYY-MM-DD' in America/New_York. A string, not a date column, so no
    -- layer between here and the browser can shift it by a timezone. A rate
    -- applies to a whole CALENDAR day: an agency that takes no calls on a
    -- Sunday still has a rate on Sunday, it simply does not earn at it.
    "currentRateCalendarDay" TEXT,
    "lastRatedCalendarDay" TEXT,
    "introductoryApplicationsUsed" INTEGER NOT NULL DEFAULT 0,
    -- An agreed opening rate and block, which supersede the introductory
    -- package. Set by a platform admin.
    "openingRate" DECIMAL(10,2),
    "openingBlockApplications" INTEGER,
    "openingAgreementNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agency_rating_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "agency_rating_states_tenantId_key"
    ON "agency_rating_states"("tenantId");

CREATE INDEX IF NOT EXISTS "agency_rating_states_status_idx"
    ON "agency_rating_states"("status");

-- One immutable rating decision. This is the row shown to an agency that
-- disputes its price, so it carries everything needed to recompute that price
-- from itself.
CREATE TABLE IF NOT EXISTS "rate_changes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    -- The calendar day this rate applies to: the day AFTER the window closed.
    "effectiveCalendarDay" TEXT NOT NULL,
    -- A Delivery Day window is NOT contiguous -- Thu/Fri/Mon spans a weekend --
    -- so these two instants cover five days while the counts cover three.
    -- Anything recomputing from this row must use "windowDayKeys"; both are
    -- stored so that is unambiguous rather than inferred.
    "windowStart" TIMESTAMP(3) NOT NULL,
    "windowEndExclusive" TIMESTAMP(3) NOT NULL,
    -- Delivery Days asked for, and how many were actually found. A short window
    -- is recorded short, never padded: it is a smaller sample and the row that
    -- an agency is shown in a dispute should say so.
    "windowDeliveryDays" INTEGER NOT NULL,
    "windowDaysFound" INTEGER NOT NULL DEFAULT 0,
    -- The day keys verbatim, so a reader never re-derives the window from a
    -- timezone.
    "windowDayKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "deliveredCalls" INTEGER NOT NULL,
    "submittedApplications" INTEGER NOT NULL,
    -- Null when there were no delivered calls. Never 0, which would read as
    -- "nobody closed anything" and price the agency for review.
    "closingPct" DECIMAL(9,6),
    "curveVersionId" TEXT NOT NULL,
    -- Denormalised so the row is quotable without a join.
    "curveVersion" INTEGER NOT NULL,
    "previousRate" DECIMAL(10,2),
    -- Null in BELOW_MINIMUM: there is no rate below the curve's floor.
    "newRate" DECIMAL(10,2),
    "status" "RateChangeStatus" NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_changes_pkey" PRIMARY KEY ("id")
);

-- One decision per agency per effective day. This is what makes the daily run
-- idempotent: a re-run writes nothing rather than a second, conflicting price.
CREATE UNIQUE INDEX IF NOT EXISTS "rate_changes_tenantId_effectiveCalendarDay_key"
    ON "rate_changes"("tenantId", "effectiveCalendarDay");

CREATE INDEX IF NOT EXISTS "rate_changes_tenantId_computedAt_idx"
    ON "rate_changes"("tenantId", "computedAt");

-- An agency measured below the curve's minimum. Raised by the engine, cleared
-- only by a platform admin: an agency cannot clear its own flag.
CREATE TABLE IF NOT EXISTS "rating_review_flags" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "raisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rateChangeId" TEXT NOT NULL,
    "closingPct" DECIMAL(9,6) NOT NULL,
    "deliveredCalls" INTEGER NOT NULL,
    "submittedApplications" INTEGER NOT NULL,
    "clearedAt" TIMESTAMP(3),
    "clearedByUserId" TEXT,
    "clearedNote" TEXT,

    CONSTRAINT "rating_review_flags_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "rating_review_flags_tenantId_clearedAt_idx"
    ON "rating_review_flags"("tenantId", "clearedAt");

-- ---------------------------------------------------------------------------
-- Foreign keys, each guarded so a re-run does not fail on an existing one.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rate_curve_anchors_curveVersionId_fkey') THEN
        ALTER TABLE "rate_curve_anchors"
            ADD CONSTRAINT "rate_curve_anchors_curveVersionId_fkey"
            FOREIGN KEY ("curveVersionId") REFERENCES "rate_curve_versions"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agency_rating_states_tenantId_fkey') THEN
        ALTER TABLE "agency_rating_states"
            ADD CONSTRAINT "agency_rating_states_tenantId_fkey"
            FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agency_rating_states_curveVersionId_fkey') THEN
        ALTER TABLE "agency_rating_states"
            ADD CONSTRAINT "agency_rating_states_curveVersionId_fkey"
            FOREIGN KEY ("curveVersionId") REFERENCES "rate_curve_versions"("id")
            ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rate_changes_tenantId_fkey') THEN
        ALTER TABLE "rate_changes"
            ADD CONSTRAINT "rate_changes_tenantId_fkey"
            FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    -- No cascade from the curve: a rate already applied must survive whatever
    -- happens to the curve that priced it, so the version cannot be deleted
    -- while any rate change references it.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rate_changes_curveVersionId_fkey') THEN
        ALTER TABLE "rate_changes"
            ADD CONSTRAINT "rate_changes_curveVersionId_fkey"
            FOREIGN KEY ("curveVersionId") REFERENCES "rate_curve_versions"("id")
            ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rating_review_flags_tenantId_fkey') THEN
        ALTER TABLE "rating_review_flags"
            ADD CONSTRAINT "rating_review_flags_tenantId_fkey"
            FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rating_review_flags_rateChangeId_fkey') THEN
        ALTER TABLE "rating_review_flags"
            ADD CONSTRAINT "rating_review_flags_rateChangeId_fkey"
            FOREIGN KEY ("rateChangeId") REFERENCES "rate_changes"("id")
            ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- Curve version 1, and the settings row that points at it.
--
-- The eleven anchors from the agreed schedule. The rate for any closing
-- percentage between two of them is their linear interpolation, rounded to the
-- nearest dollar; below 5.0% there is no rate; at and above 15.0% it is flat at
-- $134.
--
-- Seeded here rather than by application code so a fresh database and the
-- production database agree on version 1 byte for byte.
-- ---------------------------------------------------------------------------

INSERT INTO "rate_curve_versions" (
    "id", "version", "label", "note",
    "effectiveFrom", "minimumClosingPct", "flatFromClosingPct",
    "introductoryRate", "introductoryApplications"
)
VALUES (
    '00000000-0000-4000-8000-00000000c001',
    1,
    'Launch curve',
    'The continuous curve agreed for launch. Not a step scale: at 450 calls in '
    'a window the measured closing percentage carries about +/-1.4 points of '
    'sampling error, which is wider than a one-point band, so an agency sitting '
    'on a band edge would pay about 4% above its fair rate purely from '
    'randomness. Interpolation makes small errors symmetric.',
    CURRENT_TIMESTAMP,
    5.000,
    15.000,
    159.00,
    5
)
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "rate_curve_anchors" ("id", "curveVersionId", "closingPct", "rate")
VALUES
    ('00000000-0000-4000-8000-00000000a050', '00000000-0000-4000-8000-00000000c001',  5.000, 264.00),
    ('00000000-0000-4000-8000-00000000a060', '00000000-0000-4000-8000-00000000c001',  6.000, 234.00),
    ('00000000-0000-4000-8000-00000000a070', '00000000-0000-4000-8000-00000000c001',  7.000, 204.00),
    ('00000000-0000-4000-8000-00000000a080', '00000000-0000-4000-8000-00000000c001',  8.000, 184.00),
    ('00000000-0000-4000-8000-00000000a090', '00000000-0000-4000-8000-00000000c001',  9.000, 169.00),
    ('00000000-0000-4000-8000-00000000a100', '00000000-0000-4000-8000-00000000c001', 10.000, 159.00),
    ('00000000-0000-4000-8000-00000000a110', '00000000-0000-4000-8000-00000000c001', 11.000, 159.00),
    ('00000000-0000-4000-8000-00000000a120', '00000000-0000-4000-8000-00000000c001', 12.000, 149.00),
    ('00000000-0000-4000-8000-00000000a130', '00000000-0000-4000-8000-00000000c001', 13.000, 144.00),
    ('00000000-0000-4000-8000-00000000a140', '00000000-0000-4000-8000-00000000c001', 14.000, 139.00),
    ('00000000-0000-4000-8000-00000000a150', '00000000-0000-4000-8000-00000000c001', 15.000, 134.00)
ON CONFLICT ("curveVersionId", "closingPct") DO NOTHING;

INSERT INTO "rating_settings" (
    "id", "windowDeliveryDays", "deliveryDayLookback", "activeCurveVersionId", "updatedAt"
)
VALUES ('global', 3, 60, '00000000-0000-4000-8000-00000000c001', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- ---------------------------------------------------------------------------
-- Cleanup for the earlier draft of this file
--
-- Only fires on a database where a previous run of this migration created the
-- "business day" spelling of these columns. Production has never run either
-- version, so on production this block does nothing at all.
--
-- It does not DROP: it makes the stale columns nullable so that inserts against
-- the corrected shape succeed, and copies any values across. Dropping a column
-- is the one thing this file must never do, because a column that turns out to
-- have been wanted cannot be un-dropped.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'rating_settings' AND column_name = 'windowBusinessDays'
    ) THEN
        ALTER TABLE "rating_settings" ALTER COLUMN "windowBusinessDays" DROP NOT NULL;
        UPDATE "rating_settings"
           SET "windowDeliveryDays" = COALESCE("windowBusinessDays", 3)
         WHERE "windowDeliveryDays" IS DISTINCT FROM "windowBusinessDays";
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'rate_changes' AND column_name = 'windowBusinessDays'
    ) THEN
        ALTER TABLE "rate_changes" ALTER COLUMN "windowBusinessDays" DROP NOT NULL;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'rate_changes' AND column_name = 'effectiveBusinessDay'
    ) THEN
        ALTER TABLE "rate_changes" ALTER COLUMN "effectiveBusinessDay" DROP NOT NULL;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'agency_rating_states' AND column_name = 'currentRateBusinessDay'
    ) THEN
        ALTER TABLE "agency_rating_states"
            ADD COLUMN IF NOT EXISTS "currentRateCalendarDay" TEXT,
            ADD COLUMN IF NOT EXISTS "lastRatedCalendarDay" TEXT;
    END IF;
END
$$;

COMMIT;
