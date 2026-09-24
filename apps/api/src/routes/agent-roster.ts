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

import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  CELL_FORWARD_METADATA_KEY,
  normalizeCellForwardNumber,
  readCellForwardNumber,
} from '../lib/agent-cell-forward.js';
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

const DAY_KEYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

const ScheduleSchema = z.object({
  /**
   * An EMPTY list is an agent on leave, and it restricts them. It is NOT the
   * same as having no schedule, which is what `DELETE` produces and is how
   * every agent starts. The two are opposite instructions to routing, which is
   * why clearing is its own verb rather than a special value here -- see the
   * DELETE route below.
   */
  days: z.array(z.enum(DAY_KEYS)).max(7),
  /** `HH:MM`, 24-hour, in the agency's delivery time zone. */
  startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'startTime must be HH:MM'),
  endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'endTime must be HH:MM'),
});

const AgentSettingsSchema = z
  .object({
    /**
     * How many calls this agent may hold at once. Bounded at 10 because this is
     * a human with one mouth: a larger number is a typo, and the cost of
     * accepting it is calls delivered to somebody who cannot answer them, which
     * the agency then pays for.
     */
    maxConcurrentCalls: z.number().int().min(1).max(10).optional(),
    /**
     * The agent's own mobile, when they take calls there instead of the
     * softphone. Routing dials it as this agent's leg and the CDR credits the
     * answered call to them. Null or an empty string turns forwarding off.
     */
    cellForwardNumber: z.string().max(32).nullable().optional(),
  })
  .refine(body => body.maxConcurrentCalls !== undefined || body.cellForwardNumber !== undefined, {
    message: 'Nothing to update',
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
 *
 * The agent's own on/off switch comes LAST, after every setup blocker. It is
 * the only reason here that is not the agency's to fix and not a fault: an
 * agent who is off for the afternoon is correctly configured. An agent who is
 * off AND has no campaign has a setup problem the owner should be told about
 * first, because it will still be there when they come back.
 */
type BlockerCode =
  | 'INVITE_PENDING'
  | 'ACCOUNT_STATUS'
  | 'NO_LICENSED_STATES'
  | 'NO_CAMPAIGN'
  | 'NO_SOFTPHONE'
  | 'UNAVAILABLE';

/**
 * The prose is for the person reading the screen; the code is for the screen.
 * A client that has to branch on the sentence breaks the moment the sentence
 * is reworded, and these sentences are written to be read, so they will be.
 */
function blocker(agent: {
  status: string;
  licensedStates: string[];
  hasSipCredential: boolean;
  campaignCount: number;
  availableForCalls: boolean;
  /** Calls go to their cell, so the softphone never has to be opened. */
  forwardsToCell?: boolean;
}): { code: BlockerCode; reason: string } | null {
  if (agent.status === 'PENDING') {
    return { code: 'INVITE_PENDING', reason: 'Has not accepted their invitation yet' };
  }
  if (agent.status !== 'ACTIVE') {
    return { code: 'ACCOUNT_STATUS', reason: `Account is ${agent.status.toLowerCase()}` };
  }
  if (agent.licensedStates.length === 0) {
    return { code: 'NO_LICENSED_STATES', reason: 'No licensed states recorded' };
  }
  if (agent.campaignCount === 0) {
    return { code: 'NO_CAMPAIGN', reason: 'Not assigned to a campaign' };
  }
  if (!agent.hasSipCredential && !agent.forwardsToCell) {
    return { code: 'NO_SOFTPHONE', reason: 'Has not opened the softphone yet' };
  }
  /*
   * `=== false`, not `!`. Same posture as the routing gate this mirrors: only a
   * POSITIVE "I am off" blocks. A value that is missing for any reason reads as
   * available, because that is what routing will do with it, and a roster that
   * said otherwise would send an owner looking for a problem that is not there.
   */
  if (agent.availableForCalls === false) {
    return { code: 'UNAVAILABLE', reason: 'Has turned their phone off' };
  }
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
          availableForCalls: true,
          availabilityChangedAt: true,
          lastLoginAt: true,
          metadata: true,
          createdAt: true,
          roles: { select: { role: { select: { name: true } } } },
          sipCredential: { select: { extension: true, status: true, passwordEncrypted: true } },
          schedule: { select: { days: true, startTime: true, endTime: true } },
        },
        orderBy: [{ firstName: 'asc' }, { email: 'asc' }],
      });

      const userIds = users.map(u => u.id);

      const [assignments, campaigns, statuses, agencyProfile] = await Promise.all([
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
        prisma.agencyProfile.findUnique({
          where: { tenantId },
          select: { deliveryTimeZone: true },
        }),
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

        const cellForwardNumber = readCellForwardNumber(meta);

        const blocked = blocker({
          status: user.status,
          licensedStates,
          hasSipCredential,
          campaignCount: assignedCampaigns.length,
          availableForCalls: user.availableForCalls,
          forwardsToCell: cellForwardNumber !== null,
        });

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
          cellForwardNumber,
          maxConcurrentCalls:
            Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : DEFAULT_MAX_CONCURRENT,
          campaignIds: assignedCampaigns,
          /*
           * Null means no hours are enforced for this agent, which is how every
           * agent starts. An empty `days` list is different -- an agent on
           * leave -- and the screen has to render the two differently.
           */
          schedule: user.schedule
            ? {
                days: user.schedule.days,
                startTime: user.schedule.startTime,
                endTime: user.schedule.endTime,
              }
            : null,
          softphoneStatus: statuses.get(user.id) ?? 'offline',
          /*
           * The agent's own switch, not the Redis presence key beside it.
           * `softphoneStatus` says what their browser is doing and is
           * overwritten automatically; this is what the person decided, and it
           * is the one routing obeys.
           */
          availableForCalls: user.availableForCalls,
          availabilityChangedAt: user.availabilityChangedAt?.toISOString() ?? null,
          blockedReason: blocked?.reason ?? null,
          /**
           * The same fact, machine-readable. `UNAVAILABLE` is the one the
           * screen renders differently: an agent who stepped away is not a
           * misconfiguration and must not be shown as one.
           */
          blockedBy: blocked?.code ?? null,
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
          /*
           * The clock every schedule on this screen is written in. There is
           * deliberately no per-agent zone -- the agency's is the one its
           * billing day is measured on -- so the screen states it once rather
           * than letting somebody assume their own.
           */
          deliveryTimeZone: agencyProfile?.deliveryTimeZone ?? 'America/New_York',
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
   * PUT /api/v1/agent-roster/:userId/schedule
   *
   * When this agent works, or `null` to stop enforcing hours for them.
   *
   * ── The two kinds of "not working", and why they are two verbs ──────────
   *
   * NO SCHEDULE means no hours are enforced: the agent is routable whenever
   * everything else allows it, which is how every agent starts. That is
   * `DELETE`.
   *
   * An EMPTY `days` list is an agent on leave, and it DOES stop calls reaching
   * them. That is `PUT` with `days: []`.
   *
   * They are opposite instructions to routing, and they are separate verbs
   * rather than one endpoint taking `null`, because a JSON `null` body is not
   * reliably distinguishable from no body at all -- `apiClient.put(url, null)`
   * in the web app sends no body, since `null` is falsy. An endpoint whose
   * "clear" case depends on that distinction would clear a schedule on a
   * malformed request and refuse one on a well-formed clear.
   */
  fastify.put<{ Params: { userId: string } }>(
    '/api/v1/agent-roster/:userId/schedule',
    { preHandler: [authenticate, requireAgencyPrincipal] },
    async (request, reply) => {
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;

      const parsed = ScheduleSchema.safeParse(request.body);
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
        select: { id: true },
      });
      if (!agent) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'No such agent in this agency' },
        });
      }

      const schedule = parsed.data;

      /*
       * `startTime` equal to or after `endTime` is NOT rejected: it is an
       * overnight shift (21:00 to 05:00), which is ordinary in this business,
       * and `services/telephony/agent-schedule.ts` reads it as one. Refusing it
       * would push a night-shift agency back to having no schedule at all.
       */
      await prisma.agentSchedule.upsert({
        where: { userId },
        create: {
          tenantId,
          userId,
          days: schedule.days,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
        },
        update: {
          days: schedule.days,
          startTime: schedule.startTime,
          endTime: schedule.endTime,
        },
      });

      await auditLog({
        tenantId,
        userId: getActingUserId(request) ?? undefined,
        action: 'agent_roster.schedule.set',
        entityType: 'AgentSchedule',
        entityId: userId,
        resource: `/api/v1/agent-roster/${userId}/schedule`,
        method: 'PUT',
        changes: { ...schedule },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        requestId: request.id,
        success: true,
      });

      return reply.send({ data: { userId, schedule } });
    }
  );

  /**
   * DELETE /api/v1/agent-roster/:userId/schedule
   *
   * Stop enforcing hours for this agent, returning them to the state every
   * agent starts in: routable whenever licence, registration and concurrency
   * allow it.
   *
   * Not the same as `PUT { days: [] }`, which is an agent on leave and stops
   * calls reaching them entirely. See the PUT above for why these are two
   * verbs.
   */
  fastify.delete<{ Params: { userId: string } }>(
    '/api/v1/agent-roster/:userId/schedule',
    { preHandler: [authenticate, requireAgencyPrincipal] },
    async (request, reply) => {
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;

      const { userId } = request.params;
      const agent = await prisma.user.findFirst({
        where: { id: userId, tenantId },
        select: { id: true },
      });
      if (!agent) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'No such agent in this agency' },
        });
      }

      // `deleteMany`, so clearing a schedule that is already absent is a no-op
      // rather than a 404 about a row the caller never claimed existed.
      await prisma.agentSchedule.deleteMany({ where: { tenantId, userId } });

      await auditLog({
        tenantId,
        userId: getActingUserId(request) ?? undefined,
        action: 'agent_roster.schedule.cleared',
        entityType: 'AgentSchedule',
        entityId: userId,
        resource: `/api/v1/agent-roster/${userId}/schedule`,
        method: 'DELETE',
        changes: { cleared: true },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        requestId: request.id,
        success: true,
      });

      return reply.send({ data: { userId, schedule: null } });
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

      const { maxConcurrentCalls, cellForwardNumber: rawCell } = parsed.data;
      let cellForwardNumber: string | null | undefined;
      if (rawCell !== undefined) {
        cellForwardNumber =
          rawCell === null || rawCell.trim() === '' ? null : normalizeCellForwardNumber(rawCell);
        if (cellForwardNumber === null && rawCell !== null && rawCell.trim() !== '') {
          return reply.code(400).send({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'cellForwardNumber: must be a 10-digit US phone number',
            },
          });
        }
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

      const changes: Record<string, unknown> = {};
      if (maxConcurrentCalls !== undefined) changes.maxConcurrentCalls = maxConcurrentCalls;
      if (cellForwardNumber !== undefined) changes[CELL_FORWARD_METADATA_KEY] = cellForwardNumber;

      const nextMetadata: Record<string, unknown> = { ...existing, ...changes };
      // Off is absence, so nothing downstream has to tell null from unset.
      if (nextMetadata[CELL_FORWARD_METADATA_KEY] === null) {
        delete nextMetadata[CELL_FORWARD_METADATA_KEY];
      }

      await prisma.user.update({
        where: { id: userId },
        data: { metadata: nextMetadata as Prisma.InputJsonObject },
      });

      await auditLog({
        tenantId,
        userId: getActingUserId(request) ?? undefined,
        action: 'agent_roster.settings.updated',
        entityType: 'User',
        entityId: userId,
        resource: `/api/v1/agent-roster/${userId}`,
        method: 'PATCH',
        changes,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        requestId: request.id,
        success: true,
      });

      return reply.send({
        data: { userId, ...changes },
      });
    }
  );
}
