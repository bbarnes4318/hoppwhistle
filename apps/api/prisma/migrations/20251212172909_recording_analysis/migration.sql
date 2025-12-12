/*
  Warnings:

  - You are about to drop the column `error` on the `stir_shaken_status` table. All the data in the column will be lost.
  - You are about to drop the column `verified` on the `stir_shaken_status` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[externalId]` on the table `calls` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `scopes` to the `api_keys` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tokenHash` to the `consent_tokens` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `name` on the `roles` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Added the required column `phoneNumber` to the `stir_shaken_status` table without a default value. This is not possible if the table is not empty.
  - Added the required column `tenantId` to the `stir_shaken_status` table without a default value. This is not possible if the table is not empty.
  - Added the required column `attestation` to the `stir_shaken_status` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "BudgetAlertType" AS ENUM ('DAILY_THRESHOLD', 'DAILY_EXCEEDED', 'MONTHLY_THRESHOLD', 'MONTHLY_EXCEEDED');

-- CreateEnum
CREATE TYPE "RoleName" AS ENUM ('OWNER', 'ADMIN', 'ANALYST', 'PUBLISHER', 'BUYER', 'READONLY');

-- CreateEnum
CREATE TYPE "RoutingMode" AS ENUM ('STATIC', 'PERFORMANCE', 'HYBRID');

-- CreateEnum
CREATE TYPE "RecordingStorageTier" AS ENUM ('HOT', 'WARM', 'COLD');

-- CreateEnum
CREATE TYPE "AccrualType" AS ENUM ('CALL_MINUTE_INBOUND', 'CALL_MINUTE_OUTBOUND', 'CONNECTION_FEE', 'RECORDING_FEE', 'CPA_CONVERSION', 'TAX', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ComplianceOverrideStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED', 'PENDING_APPROVAL');

-- CreateEnum
CREATE TYPE "StirAttestationLevel" AS ENUM ('A', 'B', 'C', 'NONE');

-- DropIndex
DROP INDEX "stir_shaken_status_verified_idx";

-- AlterTable
ALTER TABLE "api_keys" ADD COLUMN     "rateLimit" INTEGER,
ADD COLUMN     "scopes" JSONB NOT NULL;

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "apiKeyId" TEXT,
ADD COLUMN     "error" TEXT,
ADD COLUMN     "method" TEXT,
ADD COLUMN     "requestId" TEXT,
ADD COLUMN     "resource" TEXT,
ADD COLUMN     "success" BOOLEAN NOT NULL DEFAULT true,
ALTER COLUMN "entityId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "calls" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "importHash" TEXT;

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "routingMode" "RoutingMode" NOT NULL DEFAULT 'STATIC';

-- AlterTable
ALTER TABLE "consent_tokens" ADD COLUMN     "ipAddress" TEXT,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "tokenHash" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "phone_numbers" ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "importHash" TEXT,
ADD COLUMN     "importSource" TEXT,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "purchasedAt" TIMESTAMP(3),
ADD COLUMN     "releasedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "recordings" ADD COLUMN     "checksum" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "importHash" TEXT,
ADD COLUMN     "lifecyclePolicyId" TEXT,
ADD COLUMN     "movedToWarmAt" TIMESTAMP(3),
ADD COLUMN     "scheduledDeletionAt" TIMESTAMP(3),
ADD COLUMN     "storageTier" "RecordingStorageTier" NOT NULL DEFAULT 'HOT';

-- AlterTable
ALTER TABLE "roles" DROP COLUMN "name",
ADD COLUMN     "name" "RoleName" NOT NULL;

-- AlterTable
ALTER TABLE "stir_shaken_status" DROP COLUMN "error",
DROP COLUMN "verified",
ADD COLUMN     "identity" TEXT,
ADD COLUMN     "origId" TEXT,
ADD COLUMN     "override" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "overrideReason" TEXT,
ADD COLUMN     "overrideUserId" TEXT,
ADD COLUMN     "passthru" TEXT,
ADD COLUMN     "phoneNumber" TEXT NOT NULL,
ADD COLUMN     "tenantId" TEXT NOT NULL,
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedBy" TEXT,
DROP COLUMN "attestation",
ADD COLUMN     "attestation" "StirAttestationLevel" NOT NULL;

-- CreateTable
CREATE TABLE "tenant_quotas" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "maxConcurrentCalls" INTEGER,
    "maxMinutesPerDay" INTEGER,
    "maxRecordingRetentionDays" INTEGER,
    "maxPhoneNumbers" INTEGER,
    "maxStorageGB" DECIMAL(10,2),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_quotas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_budgets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "monthlyBudget" DECIMAL(10,2),
    "dailyBudget" DECIMAL(10,2),
    "alertThreshold" DECIMAL(65,30) NOT NULL DEFAULT 80,
    "alertEmails" TEXT[],
    "alertSlackWebhook" TEXT,
    "hardStopEnabled" BOOLEAN NOT NULL DEFAULT true,
    "overrideToken" TEXT,
    "overrideTokenExpiresAt" TIMESTAMP(3),
    "currentMonthSpend" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "currentDaySpend" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "lastAlertSentAt" TIMESTAMP(3),
    "lastAlertType" "BudgetAlertType",
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_alerts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "type" "BudgetAlertType" NOT NULL,
    "threshold" DECIMAL(10,2) NOT NULL,
    "actual" DECIMAL(10,2) NOT NULL,
    "sentVia" TEXT[],
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "budget_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quota_overrides" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "quotaType" TEXT NOT NULL,
    "overrideValue" INTEGER,
    "reason" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quota_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accrual_ledger" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "billingAccountId" TEXT NOT NULL,
    "publisherId" TEXT,
    "buyerId" TEXT,
    "callId" TEXT,
    "type" "AccrualType" NOT NULL,
    "amount" DECIMAL(10,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "description" TEXT NOT NULL,
    "periodDate" TIMESTAMP(3) NOT NULL,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "closedAt" TIMESTAMP(3),
    "invoiceId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accrual_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "identifier" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "apiKeyId" TEXT,

    CONSTRAINT "rate_limit_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_policies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'default',
    "enforceDnc" BOOLEAN NOT NULL DEFAULT true,
    "enforceConsent" BOOLEAN NOT NULL DEFAULT true,
    "allowOverride" BOOLEAN NOT NULL DEFAULT false,
    "requireAdminApproval" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_overrides" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "policyId" TEXT,
    "phoneNumber" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "callId" TEXT,
    "userId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "status" "ComplianceOverrideStatus" NOT NULL DEFAULT 'ACTIVE',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cnam_lookups" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "callerName" TEXT,
    "provider" TEXT NOT NULL,
    "cached" BOOLEAN NOT NULL DEFAULT false,
    "cachedUntil" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cnam_lookups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carrier_lookups" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "carrier" TEXT,
    "lata" TEXT,
    "ocn" TEXT,
    "provider" TEXT NOT NULL,
    "cached" BOOLEAN NOT NULL DEFAULT false,
    "cachedUntil" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carrier_lookups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recording_analysis" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "vertical" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "storageKey" TEXT,
    "filename" TEXT,
    "selectedFields" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "transcript" TEXT,
    "extracted" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recording_analysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_quotas_tenantId_key" ON "tenant_quotas"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_budgets_tenantId_key" ON "tenant_budgets"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_budgets_overrideToken_key" ON "tenant_budgets"("overrideToken");

-- CreateIndex
CREATE INDEX "budget_alerts_tenantId_idx" ON "budget_alerts"("tenantId");

-- CreateIndex
CREATE INDEX "budget_alerts_budgetId_idx" ON "budget_alerts"("budgetId");

-- CreateIndex
CREATE INDEX "budget_alerts_sentAt_idx" ON "budget_alerts"("sentAt");

-- CreateIndex
CREATE INDEX "quota_overrides_tenantId_idx" ON "quota_overrides"("tenantId");

-- CreateIndex
CREATE INDEX "quota_overrides_expiresAt_idx" ON "quota_overrides"("expiresAt");

-- CreateIndex
CREATE INDEX "accrual_ledger_tenantId_idx" ON "accrual_ledger"("tenantId");

-- CreateIndex
CREATE INDEX "accrual_ledger_billingAccountId_idx" ON "accrual_ledger"("billingAccountId");

-- CreateIndex
CREATE INDEX "accrual_ledger_periodDate_idx" ON "accrual_ledger"("periodDate");

-- CreateIndex
CREATE INDEX "accrual_ledger_closed_idx" ON "accrual_ledger"("closed");

-- CreateIndex
CREATE INDEX "accrual_ledger_publisherId_idx" ON "accrual_ledger"("publisherId");

-- CreateIndex
CREATE INDEX "accrual_ledger_buyerId_idx" ON "accrual_ledger"("buyerId");

-- CreateIndex
CREATE INDEX "accrual_ledger_callId_idx" ON "accrual_ledger"("callId");

-- CreateIndex
CREATE INDEX "rate_limit_entries_identifier_type_idx" ON "rate_limit_entries"("identifier", "type");

-- CreateIndex
CREATE INDEX "rate_limit_entries_windowStart_idx" ON "rate_limit_entries"("windowStart");

-- CreateIndex
CREATE INDEX "rate_limit_entries_tenantId_idx" ON "rate_limit_entries"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limit_entries_identifier_type_windowStart_key" ON "rate_limit_entries"("identifier", "type", "windowStart");

-- CreateIndex
CREATE INDEX "compliance_policies_tenantId_idx" ON "compliance_policies"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_policies_tenantId_name_key" ON "compliance_policies"("tenantId", "name");

-- CreateIndex
CREATE INDEX "compliance_overrides_tenantId_idx" ON "compliance_overrides"("tenantId");

-- CreateIndex
CREATE INDEX "compliance_overrides_phoneNumber_idx" ON "compliance_overrides"("phoneNumber");

-- CreateIndex
CREATE INDEX "compliance_overrides_callId_idx" ON "compliance_overrides"("callId");

-- CreateIndex
CREATE INDEX "compliance_overrides_status_idx" ON "compliance_overrides"("status");

-- CreateIndex
CREATE INDEX "compliance_overrides_expiresAt_idx" ON "compliance_overrides"("expiresAt");

-- CreateIndex
CREATE INDEX "cnam_lookups_tenantId_idx" ON "cnam_lookups"("tenantId");

-- CreateIndex
CREATE INDEX "cnam_lookups_phoneNumber_idx" ON "cnam_lookups"("phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "cnam_lookups_tenantId_phoneNumber_key" ON "cnam_lookups"("tenantId", "phoneNumber");

-- CreateIndex
CREATE INDEX "carrier_lookups_tenantId_idx" ON "carrier_lookups"("tenantId");

-- CreateIndex
CREATE INDEX "carrier_lookups_phoneNumber_idx" ON "carrier_lookups"("phoneNumber");

-- CreateIndex
CREATE INDEX "carrier_lookups_lata_idx" ON "carrier_lookups"("lata");

-- CreateIndex
CREATE INDEX "carrier_lookups_ocn_idx" ON "carrier_lookups"("ocn");

-- CreateIndex
CREATE UNIQUE INDEX "carrier_lookups_tenantId_phoneNumber_key" ON "carrier_lookups"("tenantId", "phoneNumber");

-- CreateIndex
CREATE INDEX "recording_analysis_tenantId_batchId_idx" ON "recording_analysis"("tenantId", "batchId");

-- CreateIndex
CREATE INDEX "recording_analysis_tenantId_createdAt_idx" ON "recording_analysis"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "recording_analysis_status_idx" ON "recording_analysis"("status");

-- CreateIndex
CREATE INDEX "audit_logs_apiKeyId_idx" ON "audit_logs"("apiKeyId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_success_idx" ON "audit_logs"("success");

-- CreateIndex
CREATE UNIQUE INDEX "calls_externalId_key" ON "calls"("externalId");

-- CreateIndex
CREATE INDEX "calls_externalId_idx" ON "calls"("externalId");

-- CreateIndex
CREATE INDEX "calls_importHash_idx" ON "calls"("importHash");

-- CreateIndex
CREATE INDEX "consent_tokens_tokenHash_idx" ON "consent_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "phone_numbers_tenantId_campaignId_idx" ON "phone_numbers"("tenantId", "campaignId");

-- CreateIndex
CREATE INDEX "phone_numbers_provider_idx" ON "phone_numbers"("provider");

-- CreateIndex
CREATE INDEX "recordings_storageTier_idx" ON "recordings"("storageTier");

-- CreateIndex
CREATE INDEX "recordings_scheduledDeletionAt_idx" ON "recordings"("scheduledDeletionAt");

-- CreateIndex
CREATE INDEX "recordings_importHash_idx" ON "recordings"("importHash");

-- CreateIndex
CREATE UNIQUE INDEX "roles_name_key" ON "roles"("name");

-- CreateIndex
CREATE INDEX "stir_shaken_status_tenantId_idx" ON "stir_shaken_status"("tenantId");

-- CreateIndex
CREATE INDEX "stir_shaken_status_phoneNumber_idx" ON "stir_shaken_status"("phoneNumber");

-- AddForeignKey
ALTER TABLE "tenant_quotas" ADD CONSTRAINT "tenant_quotas_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_budgets" ADD CONSTRAINT "tenant_budgets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_alerts" ADD CONSTRAINT "budget_alerts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_alerts" ADD CONSTRAINT "budget_alerts_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "tenant_budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quota_overrides" ADD CONSTRAINT "quota_overrides_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_numbers" ADD CONSTRAINT "phone_numbers_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accrual_ledger" ADD CONSTRAINT "accrual_ledger_billingAccountId_fkey" FOREIGN KEY ("billingAccountId") REFERENCES "billing_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accrual_ledger" ADD CONSTRAINT "accrual_ledger_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accrual_ledger" ADD CONSTRAINT "accrual_ledger_callId_fkey" FOREIGN KEY ("callId") REFERENCES "calls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "api_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_limit_entries" ADD CONSTRAINT "rate_limit_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_limit_entries" ADD CONSTRAINT "rate_limit_entries_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "api_keys"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_policies" ADD CONSTRAINT "compliance_policies_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_overrides" ADD CONSTRAINT "compliance_overrides_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_overrides" ADD CONSTRAINT "compliance_overrides_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "compliance_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stir_shaken_status" ADD CONSTRAINT "stir_shaken_status_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stir_shaken_status" ADD CONSTRAINT "stir_shaken_status_overrideUserId_fkey" FOREIGN KEY ("overrideUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cnam_lookups" ADD CONSTRAINT "cnam_lookups_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carrier_lookups" ADD CONSTRAINT "carrier_lookups_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
