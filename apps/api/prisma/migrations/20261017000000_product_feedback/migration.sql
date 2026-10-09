-- Feedback & Roadmap: agents and agency principals send the product team
-- ideas, problems and complaints, and follow each one from review to release.
--
--   product_feedback                 one request. `tenantId` is the agency it
--                                    came from (null only for an item the
--                                    product team put on the roadmap itself).
--   product_feedback_votes           "I want this too". UNIQUE (feedbackId,
--                                    userId) is what rejects a second vote.
--   product_feedback_comments        the thread: public updates, questions,
--                                    the agency's replies, internal notes.
--   product_feedback_status_events   every status actually reached, in order:
--                                    the timeline, never inferred.
--   product_feedback_reads           when a person last opened a request, for
--                                    the "New update" marker.
--
-- Applied by hand with psql, like every migration on this database (there is
-- no _prisma_migrations table):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/prisma/migrations/20261017000000_product_feedback/migration.sql
--
-- Purely additive: new types and tables, nothing existing is altered. Idempotent
-- throughout and one transaction, so a failure leaves nothing half-applied and
-- a second run is a no-op.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProductFeedbackCategory') THEN
    CREATE TYPE "ProductFeedbackCategory" AS ENUM ('IDEA', 'IMPROVEMENT', 'PROBLEM', 'WORKFLOW', 'COMPLAINT', 'OTHER');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProductFeedbackStatus') THEN
    CREATE TYPE "ProductFeedbackStatus" AS ENUM ('NEW', 'UNDER_REVIEW', 'NEEDS_INFO', 'CONSIDERING', 'PLANNED', 'IN_PROGRESS', 'TESTING', 'SHIPPED', 'NOT_PLANNED', 'MERGED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProductFeedbackPriority') THEN
    CREATE TYPE "ProductFeedbackPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProductFeedbackVisibility') THEN
    CREATE TYPE "ProductFeedbackVisibility" AS ENUM ('PRIVATE', 'TENANT', 'PUBLIC');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProductFeedbackUrgency') THEN
    CREATE TYPE "ProductFeedbackUrgency" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProductFeedbackTargetKind') THEN
    CREATE TYPE "ProductFeedbackTargetKind" AS ENUM ('NONE', 'WEEK', 'MONTH', 'QUARTER', 'DATE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProductFeedbackCommentKind') THEN
    CREATE TYPE "ProductFeedbackCommentKind" AS ENUM ('PUBLIC_UPDATE', 'QUESTION', 'USER_REPLY', 'INTERNAL_NOTE');
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS "product_feedback" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "number" SERIAL NOT NULL,
    "tenantId" TEXT,
    "submittedByUserId" TEXT,
    "submittedByRole" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "publicTitle" TEXT,
    "publicSummary" TEXT,
    "category" "ProductFeedbackCategory" NOT NULL,
    "productArea" TEXT,
    "urgency" "ProductFeedbackUrgency",
    "status" "ProductFeedbackStatus" NOT NULL DEFAULT 'NEW',
    "priority" "ProductFeedbackPriority" NOT NULL DEFAULT 'NORMAL',
    "visibility" "ProductFeedbackVisibility" NOT NULL DEFAULT 'PRIVATE',
    "sourceRoute" TEXT,
    "clientContext" JSONB,
    "targetKind" "ProductFeedbackTargetKind" NOT NULL DEFAULT 'NONE',
    "targetDate" DATE,
    "assignedToUserId" TEXT,
    "mergedIntoId" UUID,
    "shippedAt" TIMESTAMPTZ(3),
    "lastPublicActivityAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUserReplyAt" TIMESTAMPTZ(3),
    "lastStaffReplyAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_feedback_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "product_feedback_votes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "feedbackId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_feedback_votes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "product_feedback_comments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "feedbackId" UUID NOT NULL,
    "kind" "ProductFeedbackCommentKind" NOT NULL,
    "authorUserId" TEXT,
    "tenantId" TEXT,
    "headline" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_feedback_comments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "product_feedback_status_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "feedbackId" UUID NOT NULL,
    "fromStatus" "ProductFeedbackStatus",
    "toStatus" "ProductFeedbackStatus" NOT NULL,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_feedback_status_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "product_feedback_reads" (
    "userId" TEXT NOT NULL,
    "feedbackId" UUID NOT NULL,
    "lastReadAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_feedback_reads_pkey" PRIMARY KEY ("userId", "feedbackId")
);

-- Each index serves a query in routes/product-feedback.ts:
--   (tenantId, status)            an agency's own requests, and its owners' view
--   (submittedByUserId, createdAt) My Feedback
--   (visibility, status)          the public roadmap columns
--   (status, updatedAt)           the product team's queue
--   (mergedIntoId)                what was merged into a request
CREATE UNIQUE INDEX IF NOT EXISTS "product_feedback_number_key" ON "product_feedback"("number");
CREATE INDEX IF NOT EXISTS "product_feedback_tenantId_status_idx" ON "product_feedback"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "product_feedback_submittedByUserId_createdAt_idx" ON "product_feedback"("submittedByUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "product_feedback_visibility_status_idx" ON "product_feedback"("visibility", "status");
CREATE INDEX IF NOT EXISTS "product_feedback_status_updatedAt_idx" ON "product_feedback"("status", "updatedAt");
CREATE INDEX IF NOT EXISTS "product_feedback_mergedIntoId_idx" ON "product_feedback"("mergedIntoId");
CREATE INDEX IF NOT EXISTS "product_feedback_votes_userId_idx" ON "product_feedback_votes"("userId");
CREATE INDEX IF NOT EXISTS "product_feedback_votes_tenantId_idx" ON "product_feedback_votes"("tenantId");
-- One vote per person per request.
CREATE UNIQUE INDEX IF NOT EXISTS "product_feedback_votes_feedbackId_userId_key" ON "product_feedback_votes"("feedbackId", "userId");
CREATE INDEX IF NOT EXISTS "product_feedback_comments_feedbackId_createdAt_idx" ON "product_feedback_comments"("feedbackId", "createdAt");
CREATE INDEX IF NOT EXISTS "product_feedback_status_events_feedbackId_createdAt_idx" ON "product_feedback_status_events"("feedbackId", "createdAt");
CREATE INDEX IF NOT EXISTS "product_feedback_reads_feedbackId_idx" ON "product_feedback_reads"("feedbackId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_feedback_tenantId_fkey') THEN
    ALTER TABLE "product_feedback" ADD CONSTRAINT "product_feedback_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_feedback_submittedByUserId_fkey') THEN
    ALTER TABLE "product_feedback" ADD CONSTRAINT "product_feedback_submittedByUserId_fkey"
      FOREIGN KEY ("submittedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_feedback_assignedToUserId_fkey') THEN
    ALTER TABLE "product_feedback" ADD CONSTRAINT "product_feedback_assignedToUserId_fkey"
      FOREIGN KEY ("assignedToUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_feedback_mergedIntoId_fkey') THEN
    ALTER TABLE "product_feedback" ADD CONSTRAINT "product_feedback_mergedIntoId_fkey"
      FOREIGN KEY ("mergedIntoId") REFERENCES "product_feedback"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_feedback_votes_feedbackId_fkey') THEN
    ALTER TABLE "product_feedback_votes" ADD CONSTRAINT "product_feedback_votes_feedbackId_fkey"
      FOREIGN KEY ("feedbackId") REFERENCES "product_feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_feedback_votes_userId_fkey') THEN
    ALTER TABLE "product_feedback_votes" ADD CONSTRAINT "product_feedback_votes_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_feedback_votes_tenantId_fkey') THEN
    ALTER TABLE "product_feedback_votes" ADD CONSTRAINT "product_feedback_votes_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_feedback_comments_feedbackId_fkey') THEN
    ALTER TABLE "product_feedback_comments" ADD CONSTRAINT "product_feedback_comments_feedbackId_fkey"
      FOREIGN KEY ("feedbackId") REFERENCES "product_feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_feedback_comments_authorUserId_fkey') THEN
    ALTER TABLE "product_feedback_comments" ADD CONSTRAINT "product_feedback_comments_authorUserId_fkey"
      FOREIGN KEY ("authorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_feedback_status_events_feedbackId_fkey') THEN
    ALTER TABLE "product_feedback_status_events" ADD CONSTRAINT "product_feedback_status_events_feedbackId_fkey"
      FOREIGN KEY ("feedbackId") REFERENCES "product_feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_feedback_status_events_actorUserId_fkey') THEN
    ALTER TABLE "product_feedback_status_events" ADD CONSTRAINT "product_feedback_status_events_actorUserId_fkey"
      FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_feedback_reads_userId_fkey') THEN
    ALTER TABLE "product_feedback_reads" ADD CONSTRAINT "product_feedback_reads_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  -- Last, and the deploy script's probe: present means everything above is.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'product_feedback_reads_feedbackId_fkey') THEN
    ALTER TABLE "product_feedback_reads" ADD CONSTRAINT "product_feedback_reads_feedbackId_fkey"
      FOREIGN KEY ("feedbackId") REFERENCES "product_feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
