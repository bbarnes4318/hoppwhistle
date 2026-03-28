-- Add recording lifecycle fields to calls table
ALTER TABLE "calls" ADD COLUMN "primaryRecordingId" TEXT;
ALTER TABLE "calls" ADD COLUMN "recordingStatus" TEXT;
ALTER TABLE "calls" ADD COLUMN "recordingStartedAt" TIMESTAMP(3);
ALTER TABLE "calls" ADD COLUMN "recordingCompletedAt" TIMESTAMP(3);
ALTER TABLE "calls" ADD COLUMN "recordingError" TEXT;

-- Index for efficient recording status queries
CREATE INDEX "calls_recordingStatus_idx" ON "calls"("recordingStatus");
