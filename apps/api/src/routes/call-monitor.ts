/**
 * Supervisor listen-in: an agency manager hears an agent's live call.
 *
 * ── Who ──────────────────────────────────────────────────────────────────────
 *
 * The agency's OWNER and ADMINs, and its MANAGERs -- `requireFloorSupervisor`.
 * A MANAGER exists for this: it supervises the call floor and administers
 * nobody, so it is NOT an agency principal and every money, invitation and
 * configuration route still refuses it. An AGENT can never listen to a
 * colleague, whatever the `roles` table says (`calls:monitor` is on the AGENT
 * floor in middleware/rbac.ts).
 *
 * ── How ──────────────────────────────────────────────────────────────────────
 *
 * The manager's own browser softphone is rung with a leg that runs FreeSWITCH
 * `eavesdrop` on the agent's leg, so they hear both the agent and the customer.
 * It is listen-only: eavesdrop's DTMF controls (whisper, barge) are switched
 * off, so nothing the manager says reaches either party. The softphone answers
 * the leg itself and mutes its microphone; hanging up ends the listen and
 * leaves the call untouched.
 *
 * ── Nothing here takes a tenant from the wire ────────────────────────────────
 *
 * The acting agency is `resolveTenant`, from the authenticated principal.
 * `:userId` is re-validated as an AGENT of THAT agency before the switch is
 * asked anything, and the channel listened to is found from that agent's own
 * extension -- never from a channel id, call id or SIP Call-ID in the request,
 * which is what would let a request name somebody else's call on a switch with
 * no tenant dimension.
 *
 * Every listen is audited, refused or not.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { requireFloorSupervisor } from '../lib/platform-context.js';
import { getPrismaClient } from '../lib/prisma.js';
import { getActingUserId, resolveTenant } from '../lib/tenant-context.js';
import { authenticate } from '../middleware/auth.js';
import { auditLog } from '../services/audit.js';
import { freeswitchService, ListenInError } from '../services/freeswitch-service.js';

type ListenRefusal =
  | 'AGENT_NOT_FOUND'
  | 'AGENT_HAS_NO_SOFTPHONE'
  | 'AGENT_NOT_ON_A_CALL'
  | 'LISTENER_HAS_NO_SOFTPHONE'
  | 'LISTENER_NOT_REGISTERED'
  | 'CANNOT_LISTEN_TO_SELF';

const REFUSALS: Record<ListenRefusal, { status: number; message: string }> = {
  AGENT_NOT_FOUND: { status: 404, message: 'Agent not found' },
  AGENT_HAS_NO_SOFTPHONE: {
    status: 409,
    message: 'This agent has no softphone, so there is no call to listen to here.',
  },
  AGENT_NOT_ON_A_CALL: {
    status: 409,
    message: 'This agent is not on a connected softphone call right now.',
  },
  LISTENER_HAS_NO_SOFTPHONE: {
    status: 409,
    message: 'Your softphone is not set up yet. Reload the page and allow the microphone.',
  },
  LISTENER_NOT_REGISTERED: {
    status: 409,
    message: 'Your softphone is not connected. Reload the page, then try again.',
  },
  CANNOT_LISTEN_TO_SELF: { status: 400, message: 'You cannot listen to your own call.' },
};

export async function registerCallMonitorRoutes(fastify: FastifyInstance): Promise<void> {
  await Promise.resolve();
  const prisma = getPrismaClient();

  /**
   * POST /api/v1/call-monitor/agents/:userId/listen
   *
   * Ring the caller's softphone with a listen-only leg on the call this agent
   * is on. 202 with the leg's id once the switch has been asked; the phone
   * answers it by itself.
   */
  fastify.post<{ Params: { userId: string } }>(
    '/api/v1/call-monitor/agents/:userId/listen',
    { preHandler: [authenticate, requireFloorSupervisor] },
    async (request: FastifyRequest<{ Params: { userId: string } }>, reply: FastifyReply) => {
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;

      const listenerId = getActingUserId(request);
      if (!listenerId) {
        return reply.code(401).send({
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        });
      }

      const agentId = request.params.userId;

      const audit = (outcome: string, extra: Record<string, unknown> = {}): Promise<void> =>
        auditLog({
          tenantId,
          userId: listenerId,
          action: 'call_monitor.listen',
          entityType: 'User',
          entityId: agentId,
          resource: `/api/v1/call-monitor/agents/${agentId}/listen`,
          method: 'POST',
          changes: { outcome, ...extra },
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
          requestId: request.id,
          success: outcome === 'STARTED',
        }).catch((err: unknown) => {
          request.log.error({ err, agentId }, 'call-monitor: audit write failed');
        });

      const refuse = async (code: ListenRefusal): Promise<FastifyReply> => {
        await audit(code);
        const { status, message } = REFUSALS[code];
        return reply.code(status).send({ error: { code, message } });
      };

      if (agentId === listenerId) return refuse('CANNOT_LISTEN_TO_SELF');

      // Not found and not ours read the same: an id in a path is client-supplied.
      const agent = await prisma.user.findFirst({
        where: {
          id: agentId,
          tenantId,
          roles: { some: { role: { name: 'AGENT' } } },
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          sipCredential: { select: { extension: true, status: true } },
        },
      });
      if (!agent) return refuse('AGENT_NOT_FOUND');

      const agentExtension =
        agent.sipCredential?.status === 'ACTIVE' ? agent.sipCredential.extension : null;
      if (!agentExtension) return refuse('AGENT_HAS_NO_SOFTPHONE');

      /*
       * The listener's softphone is the one this account registers with. A
       * platform operator inside the agency has none here and is told so --
       * their phone, if any, belongs to no agency.
       */
      const listenerCredential = await prisma.agentSipCredential.findUnique({
        where: { userId: listenerId },
        select: { extension: true, status: true, tenantId: true },
      });
      if (
        !listenerCredential ||
        listenerCredential.status !== 'ACTIVE' ||
        listenerCredential.tenantId !== tenantId
      ) {
        return refuse('LISTENER_HAS_NO_SOFTPHONE');
      }

      const targetUuid = await freeswitchService.findAgentLiveLeg(agentExtension);
      if (!targetUuid) return refuse('AGENT_NOT_ON_A_CALL');

      const agentName = [agent.firstName, agent.lastName].filter(Boolean).join(' ') || agent.email;

      let legUuid: string;
      try {
        legUuid = await freeswitchService.startListenIn({
          listenerExtension: listenerCredential.extension,
          targetUuid,
          agentExtension,
          agentName,
        });
      } catch (err) {
        if (err instanceof ListenInError) return refuse(err.code);
        request.log.error({ err, agentId, targetUuid }, 'call-monitor: originate failed');
        await audit('FAILED', { error: (err as Error).message });
        return reply.code(502).send({
          error: {
            code: 'LISTEN_FAILED',
            message: 'The phone system could not start listening. Try again.',
          },
        });
      }

      await audit('STARTED', { legUuid, agentExtension });

      return reply.code(202).send({
        data: { legUuid, agent: { id: agent.id, name: agentName } },
      });
    }
  );
}
