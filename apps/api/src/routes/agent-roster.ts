/**
 * The agency's own agents: who they are, and whether they can take a call.
 *
 * ── The gap this closes ──────────────────────────────────────────────────────
 *
 * The product's premise is that an agency adds the agents who work for it and
 * sets them up to receive calls. Before this, "sets them up" meant four
 * separate things in four places, and two of them had no agency-facing surface
 * at all:
 *
 *   1. invite the agent                    POST /api/v1/auth/activation-grants
 *   2. record the states they are licensed PATCH /api/v1/users/:userId
 *   3. give them a SIP identity            (none -- allocated on first fetch)
 *   4. put them in a campaign's call pool  (none -- NetEnroll staff hand-built
 *                                          a BuyerEndpoint per agent)
 *
 * Step 4 is why `CampaignAgent` has sat in the schema since it was written,
 * with a doc comment calling it "the dialer's hot read", referenced by nothing.
 * An agency could add a user all day and that user would never ring.
 *
 * This surface is steps 3 and 4 made real, plus the reads that let one screen
 * answer "is this agent actually able to take a call right now".
 *
 * ── It answers the whole question, not a piece of it ─────────────────────────
 *
 * `GET /api/v1/agent-roster` deliberately returns licence, SIP identity,
 * concurrency, live softphone status and campaign assignments together. They
 * are four separate systems and an agent is only working when ALL of them line
 * up; a screen that showed three would leave somebody guessing which one is
 * the reason the phone is quiet. `blockedReason` states it outright.
 *
 * ── Nothing here takes a tenant from the wire ────────────────────────────────
 *
 * Every route resolves the acting agency through `resolveTenant`, which reads
 * the authenticated principal and nothing else. `:userId` is always
 * re-validated as belonging to that agency before anything is written -- an id
 * in a path is a client-supplied value, and the one thing it must never do is
 * reach into another agency's roster.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { normalizeLicensedStates } from '../lib/licensed-states.js';
import { requireAgencyPrincipal } from '../lib/platform-context.js';
import { getPrismaClient } from '../lib/prisma.js';
import { resolveTenant, getActingUserId } from '../lib/tenant-context.js';
import { authenticate } from '../middleware/auth.js';
import { auditLog } from '../services/audit.js';
import { getRedisClient } from '../services/redis.js';

/** Mirrors `services/routing.ts`, which reads the same key for the same reason. */
const DEFAULT_MAX_CONCURRENT = Math.max(
  1,
  parseInt(process.env.AGENT_DEFAULT_MAX_CONCURRENT_CALLS || '1', 10) || 1
);

const CampaignAssignmentSchema = z.object({
  /**
   * The full set, not a delta. A PUT that added without removing would need a
   * second call to take an agent off a campaign, and the screen would have to
   * work out the difference -- which is how two clients end up disagreeing
   * about what the roster is.
   */
  campaignIds: z.array(z.string().uuid()).max(50),
});

const AgentSettingsSchema = z.object({
  /**
   * How many calls this agent may hold at once. Bounded at 10 because this is
   * a human with one mouth: a larger number is a typo, and the cost of
   * accepting it is calls delivered to somebody who cannot answer them, which
   * the agency then pays for.
   */
  maxConcurrentCalls: z.number().int().min(1).max(10),
});

/** One agent's live softphone status, from the key the softphone writes. */
async function readStatuses(userIds: string[]): Promise<Map<string, string>> {
  const statuses = new Map<string, string>();
  if (userIds.length === 0) return statuses;

  try {
    const redis = getRedisClient();
    const values = await redis.mget(userIds.map(id => `agent:status:${id}`));
    userIds.forEach((id, index) => {
      const raw = values[index];
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as { status?: string };
        if (parsed.status) statuses.set(id, parsed.status);
      } catch {
        // A malformed value is not a status. Absent reads as 'offline', which
        // is the honest reading of "we cannot tell".
      }
    });
  } catch {
    // Redis being unreachable must not fail the roster. Every agent then reads
    // as offline, which is what an unreachable presence store actually means.
  }
  return statuses;
}

/**
 * Why this agent is not taking calls, or null when nothing is stopping them.
 *
 * Ordered by what has to be fixed first. An agent with no licence AND no
 * campaign is told about the licence, because granting the campaign changes
 * nothing until the licence exists. One reason at a time, the earliest one.
 */
function blockedReason(agent: {
  status: string;
  licensedStates: string[];
  hasSipCredential: boolean;
  campaignCount: number;
}): string | null {
  if (agent.status === 'PENDING') return 'Has not accepted their invitation yet';
  if (agent.status !== 'ACTIVE') return `Account is ${agent.status.toLowerCase()}`;
  if (agent.licensedStates.length === 0) return 'No licensed states recorded';
  if (agent.campaignCount === 0) return 'Not assigned to a campaign';
  if (!agent.hasSipCredential) return 'Has not opened the softphone yet';
  return null;
}

// eslint-disable-next-line @typescript-eslint/require-await -- plugin signature
export async function registerAgentRosterRoutes(fastify: FastifyInstance): Promise<void> {
  const prisma = getPrismaClient();

  /**
   * GET /api/v1/agent-roster
   *
   * Every agent in the acting agency, with everything that decides whether
   * they can take a call.
   */
  fastify.get(
    '/api/v1/agent-roster',
    { preHandler: [authenticate, requireAgencyPrincipal] },
    async (request, reply) => {
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;

      const users = await prisma.user.findMany({
        where: {
          tenantId,
          roles: { some: { role: { name: 'AGENT' } } },
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          status: true,
          lastLoginAt: true,
          metadata: true,
          createdAt: true,
          roles: { select: { role: { select: { name: true } } } },
          sipCredential: { select: { extension: true, status: true, passwordEncrypted: true } },
        },
        orderBy: [{ firstName: 'asc' }, { email: 'asc' }],
      });

      const userIds = users.map(u => u.id);

      const [assignments, campaigns, statuses] = await Promise.all([
        prisma.campaignAgent.findMany({
          where: { tenantId, userId: { in: userIds }, status: 'ACTIVE' },
          select: { userId: true, campaignId: true },
        }),
        prisma.campaign.findMany({
          where: { tenantId, status: 'ACTIVE' },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        }),
        readStatuses(userIds),
      ]);

      const campaignsByUser = new Map<string, string[]>();
      for (const row of assignments) {
        const list = campaignsByUser.get(row.userId) ?? [];
        list.push(row.campaignId);
        campaignsByUser.set(row.userId, list);
      }

      const agents = users.map(user => {
        const meta =
          user.metadata && typeof user.metadata === 'object' && !Array.isArray(user.metadata)
            ? (user.metadata as Record<string, unknown>)
            : {};

        const licensedStates = normalizeLicensedStates(meta.licensedStates);
        const rawMax = meta.maxConcurrentCalls;
        const parsedMax = typeof rawMax === 'number' ? rawMax : parseInt(String(rawMax), 10);
        const assignedCampaigns = campaignsByUser.get(user.id) ?? [];

        /*
         * A credential row with no password is a RESERVATION: the migration
         * claimed this agent's old extension but there was never a per-agent
         * secret to carry over. It cannot authenticate, so the agent has not
         * really been provisioned yet -- see `AgentSipCredential`.
         */
        const hasSipCredential =
          user.sipCredential !== null &&
          user.sipCredential.status === 'ACTIVE' &&
          user.sipCredential.passwordEncrypted !== null;

        return {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          name: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email,
          status: user.status,
          roles: user.roles.map(r => r.role.name),
          invitedAt: user.createdAt.toISOString(),
          lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
          licensedStates,
          extension: user.sipCredential?.extension ?? null,
          hasSipCredential,
          maxConcurrentCalls:
            Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : DEFAULT_MAX_CONCURRENT,
          campaignIds: assignedCampaigns,
          softphoneStatus: statuses.get(user.id) ?? 'offline',
          blockedReason: blockedReason({
            status: user.status,
            licensedStates,
            hasSipCredential,
            campaignCount: assignedCampaigns.length,
          }),
        };
      });

      return reply.send({
        data: {
          agents,
          /*
           * The agency's own campaigns, so the screen can name an assignment
           * rather than print an id. An agency with exactly one -- the ordinary
           * case -- lets the screen render the whole thing as a single switch.
           */
          campaigns: campaigns.map(c => ({ id: c.id, name: c.name })),
          defaultMaxConcurrentCalls: DEFAULT_MAX_CONCURRENT,
        },
      });
    }
  );

  /**
   * PUT /api/v1/agent-roster/:userId/campaigns
   *
   * Set which of the agency's campaigns this agent takes calls from.
   *
   * This is the write that was missing entirely: `CampaignAgent` existed and
   * nothing created a row in it, so an agency had no way to put its own agent
   * into a call pool.
   */
  fastify.put<{ Params: { userId: string } }>(
    '/api/v1/agent-roster/:userId/campaigns',
    { preHandler: [authenticate, requireAgencyPrincipal] },
    async (request, reply) => {
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;

      const parsed = CampaignAssignmentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; '),
          },
        });
      }

      const { userId } = request.params;

      /*
       * The agent must be THIS agency's. `:userId` is a client-supplied value,
       * and the tenant filter here is what stops one agency writing an
       * assignment against another agency's user -- which would then put that
       * user in this agency's call pool.
       */
      const agent = await prisma.user.findFirst({
        where: { id: userId, tenantId },
        select: { id: true, roles: { select: { role: { select: { name: true } } } } },
      });
      if (!agent) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'No such agent in this agency' },
        });
      }

      if (!agent.roles.some(r => r.role.name === 'AGENT')) {
        return reply.code(400).send({
          error: {
            code: 'NOT_AN_AGENT',
            message: 'Only an account holding the AGENT role can be assigned to a campaign',
          },
        });
      }

      const requested = [...new Set(parsed.data.campaignIds)];

      /*
       * And the campaigns must be this agency's too, for the same reason in the
       * other direction: an id that named another agency's campaign would put
       * this agency's agent into that agency's call pool.
       */
      if (requested.length > 0) {
        const owned = await prisma.campaign.findMany({
          where: { id: { in: requested }, tenantId },
          select: { id: true },
        });
        if (owned.length !== requested.length) {
          const ownedIds = new Set(owned.map(c => c.id));
          return reply.code(400).send({
            error: {
              code: 'UNKNOWN_CAMPAIGN',
              message: `Not a campaign in this agency: ${requested
                .filter(id => !ownedIds.has(id))
                .join(', ')}`,
            },
          });
        }
      }

      /*
       * Replace, in one transaction. Deleting then inserting outside a
       * transaction leaves a window in which the agent is on NO campaign, and
       * the dialer reading during that window routes nothing to them.
       */
      await prisma.$transaction([
        prisma.campaignAgent.deleteMany({
          where: { tenantId, userId, campaignId: { notIn: requested.length ? requested : ['-'] } },
        }),
        ...requested.map(campaignId =>
          prisma.campaignAgent.upsert({
            where: { tenantId_campaignId_userId: { tenantId, campaignId, userId } },
            create: { tenantId, campaignId, userId, status: 'ACTIVE' },
            update: { status: 'ACTIVE' },
          })
        ),
      ]);

      await auditLog({
        tenantId,
        userId: getActingUserId(request) ?? undefined,
        action: 'agent_roster.campaigns.set',
        entityType: 'CampaignAgent',
        entityId: userId,
        resource: `/api/v1/agent-roster/${userId}/campaigns`,
        method: 'PUT',
        changes: { campaignIds: requested },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        requestId: request.id,
        success: true,
      });

      return reply.send({ data: { userId, campaignIds: requested } });
    }
  );

  /**
   * PATCH /api/v1/agent-roster/:userId
   *
   * The per-agent routing settings that had no screen: how many calls they may
   * hold at once.
   *
   * Licensed states are NOT set here. They already have a validated write at
   * `PATCH /api/v1/users/:userId`, and a second path into the one field that
   * decides what an agent may legally work is a second place for the two to
   * disagree.
   */
  fastify.patch<{ Params: { userId: string } }>(
    '/api/v1/agent-roster/:userId',
    { preHandler: [authenticate, requireAgencyPrincipal] },
    async (request, reply) => {
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;

      const parsed = AgentSettingsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; '),
          },
        });
      }

      const { userId } = request.params;
      const agent = await prisma.user.findFirst({
        where: { id: userId, tenantId },
        select: { id: true, metadata: true },
      });
      if (!agent) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'No such agent in this agency' },
        });
      }

      /*
       * Merged, never replaced. `metadata` also carries `licensedStates` and
       * `extension`; writing a fresh object here would silently revoke an
       * agent's licence as a side effect of changing their call limit.
       */
      const existing =
        agent.metadata && typeof agent.metadata === 'object' && !Array.isArray(agent.metadata)
          ? (agent.metadata as Record<string, unknown>)
          : {};

      await prisma.user.update({
        where: { id: userId },
        data: { metadata: { ...existing, maxConcurrentCalls: parsed.data.maxConcurrentCalls } },
      });

      await auditLog({
        tenantId,
        userId: getActingUserId(request) ?? undefined,
        action: 'agent_roster.settings.updated',
        entityType: 'User',
        entityId: userId,
        resource: `/api/v1/agent-roster/${userId}`,
        method: 'PATCH',
        changes: { maxConcurrentCalls: parsed.data.maxConcurrentCalls },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        requestId: request.id,
        success: true,
      });

      return reply.send({
        data: { userId, maxConcurrentCalls: parsed.data.maxConcurrentCalls },
      });
    }
  );
}
