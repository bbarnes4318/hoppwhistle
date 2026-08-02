-- Rollback for 20260802000000_add_campaign_agent_assignments.
--
-- Safe to run at any time. Nothing outside Dialer V2 reads `campaign_agents`,
-- and dropping it restores the previous behaviour exactly: assignment
-- resolution reports NO_SCHEMA_SUPPORT, every campaign forecast counts zero
-- agents, and `shadowEvidenceTrustworthy` returns to false.
--
-- Dropping the table DOES destroy the assignments themselves. They are
-- operator-entered data with no other source, so take a copy first if the
-- rollback is expected to be temporary:
--
--   COPY campaign_agents TO '/tmp/campaign_agents.csv' CSV HEADER;

ALTER TABLE "campaign_agents" DROP CONSTRAINT IF EXISTS "campaign_agents_userId_fkey";
ALTER TABLE "campaign_agents" DROP CONSTRAINT IF EXISTS "campaign_agents_campaignId_fkey";
ALTER TABLE "campaign_agents" DROP CONSTRAINT IF EXISTS "campaign_agents_tenantId_fkey";

DROP TABLE IF EXISTS "campaign_agents";

DROP TYPE IF EXISTS "CampaignAgentStatus";
