-- One DID shared across agencies: a group of member campaigns (one per agency)
-- whose agents are offered calls in round-robin order. Each call is recorded
-- under the agency whose agent answered it.

BEGIN;

CREATE TYPE "SharedRoutingGroupStatus" AS ENUM ('ACTIVE', 'PAUSED');

CREATE TABLE "shared_routing_groups" (
  "id"        TEXT                       NOT NULL,
  "name"      TEXT                       NOT NULL,
  "status"    "SharedRoutingGroupStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3)               NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3)               NOT NULL,
  CONSTRAINT "shared_routing_groups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shared_routing_group_members" (
  "id"         TEXT                       NOT NULL,
  "groupId"    TEXT                       NOT NULL,
  "tenantId"   TEXT                       NOT NULL,
  "campaignId" TEXT                       NOT NULL,
  "status"     "SharedRoutingGroupStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt"  TIMESTAMP(3)               NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3)               NOT NULL,
  CONSTRAINT "shared_routing_group_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shared_routing_group_members_groupId_campaignId_key"
  ON "shared_routing_group_members"("groupId", "campaignId");
CREATE UNIQUE INDEX "shared_routing_group_members_groupId_tenantId_key"
  ON "shared_routing_group_members"("groupId", "tenantId");
CREATE INDEX "shared_routing_group_members_tenantId_idx"
  ON "shared_routing_group_members"("tenantId");
CREATE INDEX "shared_routing_group_members_campaignId_idx"
  ON "shared_routing_group_members"("campaignId");

ALTER TABLE "shared_routing_group_members"
  ADD CONSTRAINT "shared_routing_group_members_groupId_fkey"
  FOREIGN KEY ("groupId") REFERENCES "shared_routing_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shared_routing_group_members"
  ADD CONSTRAINT "shared_routing_group_members_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shared_routing_group_members"
  ADD CONSTRAINT "shared_routing_group_members_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "did_routes" ADD COLUMN "sharedRoutingGroupId" TEXT;
CREATE INDEX "did_routes_sharedRoutingGroupId_idx" ON "did_routes"("sharedRoutingGroupId");
ALTER TABLE "did_routes"
  ADD CONSTRAINT "did_routes_sharedRoutingGroupId_fkey"
  FOREIGN KEY ("sharedRoutingGroupId") REFERENCES "shared_routing_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
