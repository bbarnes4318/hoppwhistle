-- Shared routing groups take individual agents as well as whole campaigns.
--
-- A member is now either a campaign (every ACTIVE agent assigned to it) or a
-- single agent (userId), in the rotation whether or not they are on a
-- campaign. An agent member's campaignId, when set, is the campaign their
-- answered calls are recorded under.
--
-- The one-member-per-agency unique index goes: an agency may now have a
-- campaign member and agent members. One campaign member per agency is still
-- enforced by the API.

BEGIN;

DROP INDEX "shared_routing_group_members_groupId_campaignId_key";
DROP INDEX "shared_routing_group_members_groupId_tenantId_key";

ALTER TABLE "shared_routing_group_members" ADD COLUMN "userId" TEXT,
ALTER COLUMN "campaignId" DROP NOT NULL;

CREATE INDEX "shared_routing_group_members_groupId_tenantId_idx"
  ON "shared_routing_group_members"("groupId", "tenantId");
CREATE INDEX "shared_routing_group_members_userId_idx"
  ON "shared_routing_group_members"("userId");
CREATE UNIQUE INDEX "shared_routing_group_members_groupId_userId_key"
  ON "shared_routing_group_members"("groupId", "userId");

ALTER TABLE "shared_routing_group_members"
  ADD CONSTRAINT "shared_routing_group_members_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Prisma cannot express this one: a member names a campaign, an agent, or both.
ALTER TABLE "shared_routing_group_members"
  ADD CONSTRAINT "shared_routing_group_members_campaign_or_agent"
  CHECK ("campaignId" IS NOT NULL OR "userId" IS NOT NULL);

COMMIT;
