-- Enterprise Call Tracking Migration
-- Adds 35+ new fields for comprehensive call tracking

-- Add new timestamp fields
ALTER TABLE "calls" ADD COLUMN "callCompleteTimestamp" TIMESTAMP(3);
ALTER TABLE "calls" ADD COLUMN "callConnectedTimestamp" TIMESTAMP(3);
ALTER TABLE "calls" ADD COLUMN "previouslyConnectedDate" TIMESTAMP(3);

-- Add identity ID fields (Foreign Keys)
ALTER TABLE "calls" ADD COLUMN "publisherId" TEXT;
ALTER TABLE "calls" ADD COLUMN "buyerId" TEXT;
ALTER TABLE "calls" ADD COLUMN "targetId" TEXT;
ALTER TABLE "calls" ADD COLUMN "targetGroupId" TEXT;

-- Add identity name fields (Denormalized for Reporting)
ALTER TABLE "calls" ADD COLUMN "campaignName" TEXT;
ALTER TABLE "calls" ADD COLUMN "publisherName" TEXT;
ALTER TABLE "calls" ADD COLUMN "buyerName" TEXT;
ALTER TABLE "calls" ADD COLUMN "targetName" TEXT;
ALTER TABLE "calls" ADD COLUMN "targetGroupName" TEXT;

-- Add telephony data fields
ALTER TABLE "calls" ADD COLUMN "callerId" TEXT;
ALTER TABLE "calls" ADD COLUMN "callerIdAreaCode" INTEGER;
ALTER TABLE "calls" ADD COLUMN "callerIdState" TEXT;
ALTER TABLE "calls" ADD COLUMN "did" TEXT;
ALTER TABLE "calls" ADD COLUMN "targetNumber" TEXT;
ALTER TABLE "calls" ADD COLUMN "connectedDuration" INTEGER;
ALTER TABLE "calls" ADD COLUMN "durationFormatted" TEXT;
ALTER TABLE "calls" ADD COLUMN "connectedDurationFormatted" TEXT;
ALTER TABLE "calls" ADD COLUMN "recordingUrl" TEXT;

-- Add financial fields
ALTER TABLE "calls" ADD COLUMN "revenue" DECIMAL(10,4);
ALTER TABLE "calls" ADD COLUMN "payout" DECIMAL(10,4);
ALTER TABLE "calls" ADD COLUMN "profit" DECIMAL(10,4);

-- Add boolean/status fields with defaults
ALTER TABLE "calls" ADD COLUMN "isDuplicate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "calls" ADD COLUMN "converted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "calls" ADD COLUMN "missedCall" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "calls" ADD COLUMN "blocked" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "calls" ADD COLUMN "paidOut" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "calls" ADD COLUMN "previouslyConnected" BOOLEAN NOT NULL DEFAULT false;

-- Add reason code fields
ALTER TABLE "calls" ADD COLUMN "noPayoutReason" TEXT;
ALTER TABLE "calls" ADD COLUMN "noConversionReason" TEXT;
ALTER TABLE "calls" ADD COLUMN "blockReason" TEXT;
ALTER TABLE "calls" ADD COLUMN "previouslyConnectedTarget" TEXT;

-- Add foreign key constraints
ALTER TABLE "calls" ADD CONSTRAINT "calls_publisherId_fkey" FOREIGN KEY ("publisherId") REFERENCES "publishers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "calls" ADD CONSTRAINT "calls_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "buyers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add indexes for new queryable fields
CREATE INDEX "calls_publisherId_idx" ON "calls"("publisherId");
CREATE INDEX "calls_buyerId_idx" ON "calls"("buyerId");
CREATE INDEX "calls_converted_idx" ON "calls"("converted");
CREATE INDEX "calls_isDuplicate_idx" ON "calls"("isDuplicate");
CREATE INDEX "calls_callConnectedTimestamp_idx" ON "calls"("callConnectedTimestamp");
