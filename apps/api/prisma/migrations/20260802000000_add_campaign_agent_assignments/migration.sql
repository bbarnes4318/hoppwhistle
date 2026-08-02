-- Dialer V2: agent-to-campaign assignments.
--
-- Purely additive. One new enum, one new table, and foreign keys pointing AT
-- existing tables. No existing table is altered, no column is dropped, and no
-- row is rewritten, so this can be applied to a live database without taking a
-- lock on anything the application is reading.
--
-- Rollback is `down.sql` in this directory.

-- CreateEnum
CREATE TYPE "CampaignAgentStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "campaign_agents" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "CampaignAgentStatus" NOT NULL DEFAULT 'ACTIVE',
    "priority" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_agents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaign_agents_tenantId_idx" ON "campaign_agents"("tenantId");

-- CreateIndex
CREATE INDEX "campaign_agents_campaignId_idx" ON "campaign_agents"("campaignId");

-- CreateIndex
CREATE INDEX "campaign_agents_userId_idx" ON "campaign_agents"("userId");

-- The dialer's hot read: every active campaign for one agent, within a tenant.
-- CreateIndex
CREATE INDEX "campaign_agents_tenantId_userId_status_idx" ON "campaign_agents"("tenantId", "userId", "status");

-- One row per agent per campaign. A duplicate would double-count that agent in
-- the campaign's available capacity, which is the input the pacing controller
-- multiplies by lines-per-agent.
-- CreateIndex
CREATE UNIQUE INDEX "campaign_agents_tenantId_campaignId_userId_key" ON "campaign_agents"("tenantId", "campaignId", "userId");

-- AddForeignKey
ALTER TABLE "campaign_agents" ADD CONSTRAINT "campaign_agents_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_agents" ADD CONSTRAINT "campaign_agents_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_agents" ADD CONSTRAINT "campaign_agents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
