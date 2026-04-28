-- AlterTable: Add contractor call intelligence fields to Call model
ALTER TABLE "Call" ADD COLUMN IF NOT EXISTS "disposition" TEXT;
ALTER TABLE "Call" ADD COLUMN IF NOT EXISTS "dispositionNotes" TEXT;
ALTER TABLE "Call" ADD COLUMN IF NOT EXISTS "callSource" TEXT;
ALTER TABLE "Call" ADD COLUMN IF NOT EXISTS "followUpAt" TIMESTAMP(3);
ALTER TABLE "Call" ADD COLUMN IF NOT EXISTS "followUpStatus" TEXT;

-- CreateIndex: Optimize queries by disposition, follow-up, and call source
CREATE INDEX IF NOT EXISTS "idx_call_disposition" ON "Call"("disposition");
CREATE INDEX IF NOT EXISTS "idx_call_followup" ON "Call"("followUpAt", "followUpStatus");
CREATE INDEX IF NOT EXISTS "idx_call_source" ON "Call"("callSource");
