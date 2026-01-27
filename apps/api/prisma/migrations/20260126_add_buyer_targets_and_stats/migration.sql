-- Add Buyer Targets and Stats Migration
-- This migration adds:
-- 1. New fields to Buyer model (subId, permission toggles)
-- 2. New fields to BuyerEndpoint model (name, cap settings)
-- 3. New BuyerStats model for pre-aggregated analytics

-- Buyer: Add new config fields
ALTER TABLE "buyers" ADD COLUMN IF NOT EXISTS "subId" TEXT;
ALTER TABLE "buyers" ADD COLUMN IF NOT EXISTS "canPauseTargets" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "buyers" ADD COLUMN IF NOT EXISTS "canSetCaps" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "buyers" ADD COLUMN IF NOT EXISTS "canDisputeConversions" BOOLEAN NOT NULL DEFAULT false;

-- BuyerEndpoint: Add name and cap fields
ALTER TABLE "buyer_endpoints" ADD COLUMN IF NOT EXISTS "name" TEXT NOT NULL DEFAULT 'Target';
ALTER TABLE "buyer_endpoints" ADD COLUMN IF NOT EXISTS "maxCap" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "buyer_endpoints" ADD COLUMN IF NOT EXISTS "capPeriod" TEXT NOT NULL DEFAULT 'DAY';
ALTER TABLE "buyer_endpoints" ADD COLUMN IF NOT EXISTS "maxConcurrency" INTEGER NOT NULL DEFAULT 10;

-- Create CapPeriod enum type if it doesn't exist
DO $$ BEGIN
    CREATE TYPE "CapPeriod" AS ENUM ('HOUR', 'DAY', 'MONTH');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Update capPeriod to use enum (optional, can keep as TEXT)
-- ALTER TABLE "buyer_endpoints" ALTER COLUMN "capPeriod" TYPE "CapPeriod" USING "capPeriod"::"CapPeriod";

-- BuyerStats: Create summary table for pre-aggregated analytics
CREATE TABLE IF NOT EXISTS "buyer_stats" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "buyerId" TEXT NOT NULL,
    "revenueHour" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "revenueDay" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "revenueMonth" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "revenueTotal" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "callsHour" INTEGER NOT NULL DEFAULT 0,
    "callsDay" INTEGER NOT NULL DEFAULT 0,
    "callsMonth" INTEGER NOT NULL DEFAULT 0,
    "callsTotal" INTEGER NOT NULL DEFAULT 0,
    "capConsumedToday" INTEGER NOT NULL DEFAULT 0,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buyer_stats_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "buyer_stats_buyerId_key" UNIQUE ("buyerId")
);

-- Add foreign key constraint
ALTER TABLE "buyer_stats"
ADD CONSTRAINT "buyer_stats_buyerId_fkey"
FOREIGN KEY ("buyerId") REFERENCES "buyers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create index on buyerId for BuyerStats
CREATE INDEX IF NOT EXISTS "buyer_stats_buyerId_idx" ON "buyer_stats"("buyerId");
