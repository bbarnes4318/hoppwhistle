-- CreateEnum
CREATE TYPE "InsuranceVertical" AS ENUM ('ACA', 'FE');

-- CreateEnum
CREATE TYPE "InsuranceValidationStatus" AS ENUM ('VALID', 'INVALID');

-- CreateEnum
CREATE TYPE "InsurancePostStatus" AS ENUM ('PENDING', 'SKIPPED', 'MATCHED', 'UNMATCHED', 'ERROR');

-- CreateEnum
CREATE TYPE "InsuranceLeadMode" AS ENUM ('TEST', 'LIVE');

-- CreateEnum
CREATE TYPE "InsuranceLeadStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST');

-- CreateTable
CREATE TABLE "insurance_leads" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vertical" "InsuranceVertical" NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "fullName" TEXT,
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "address" TEXT,
    "address2" TEXT,
    "city" TEXT,
    "county" TEXT,
    "state" TEXT,
    "zipCode" TEXT,
    "birthDate" TEXT,
    "age" INTEGER,
    "gender" TEXT,
    "source" TEXT,
    "status" "InsuranceLeadStatus" NOT NULL DEFAULT 'NEW',
    "customFields" JSONB,
    "notes" TEXT,
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insurance_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_lead_submissions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "insuranceLeadId" TEXT NOT NULL,
    "vertical" "InsuranceVertical" NOT NULL,
    "source" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawPayload" JSONB NOT NULL,
    "normalizedPayload" JSONB,
    "mappedOutboundPayload" JSONB,
    "validationStatus" "InsuranceValidationStatus" NOT NULL DEFAULT 'INVALID',
    "validationErrors" JSONB,
    "postStatus" "InsurancePostStatus" NOT NULL DEFAULT 'PENDING',
    "postMode" "InsuranceLeadMode" NOT NULL DEFAULT 'TEST',
    "ameriquoteResponseRaw" TEXT,
    "ameriquoteResponseStatus" TEXT,
    "ameriquoteLeadId" TEXT,
    "ameriquotePrice" TEXT,
    "ameriquoteErrorMessage" TEXT,
    "postedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insurance_lead_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "insurance_leads_tenantId_idx" ON "insurance_leads"("tenantId");
CREATE INDEX "insurance_leads_tenantId_vertical_idx" ON "insurance_leads"("tenantId", "vertical");
CREATE INDEX "insurance_leads_phone_idx" ON "insurance_leads"("phone");
CREATE INDEX "insurance_leads_tenantId_phone_vertical_idx" ON "insurance_leads"("tenantId", "phone", "vertical");
CREATE INDEX "insurance_leads_tenantId_status_idx" ON "insurance_leads"("tenantId", "status");
CREATE INDEX "insurance_leads_createdAt_idx" ON "insurance_leads"("createdAt");

-- CreateIndex
CREATE INDEX "insurance_lead_submissions_tenantId_idx" ON "insurance_lead_submissions"("tenantId");
CREATE INDEX "insurance_lead_submissions_insuranceLeadId_idx" ON "insurance_lead_submissions"("insuranceLeadId");
CREATE INDEX "insurance_lead_submissions_tenantId_vertical_idx" ON "insurance_lead_submissions"("tenantId", "vertical");
CREATE INDEX "insurance_lead_submissions_tenantId_postStatus_idx" ON "insurance_lead_submissions"("tenantId", "postStatus");
CREATE INDEX "insurance_lead_submissions_tenantId_validationStatus_idx" ON "insurance_lead_submissions"("tenantId", "validationStatus");
CREATE INDEX "insurance_lead_submissions_tenantId_postMode_idx" ON "insurance_lead_submissions"("tenantId", "postMode");
CREATE INDEX "insurance_lead_submissions_receivedAt_idx" ON "insurance_lead_submissions"("receivedAt");

-- AddForeignKey
ALTER TABLE "insurance_leads" ADD CONSTRAINT "insurance_leads_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_lead_submissions" ADD CONSTRAINT "insurance_lead_submissions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_lead_submissions" ADD CONSTRAINT "insurance_lead_submissions_insuranceLeadId_fkey" FOREIGN KEY ("insuranceLeadId") REFERENCES "insurance_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
