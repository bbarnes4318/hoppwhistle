-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN "offerName" TEXT;
ALTER TABLE "campaigns" ADD COLUMN "country" TEXT NOT NULL DEFAULT 'US';
ALTER TABLE "campaigns" ADD COLUMN "recordingEnabled" BOOLEAN NOT NULL DEFAULT true;
