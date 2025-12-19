import type { Prisma } from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { getPrismaClient } from '../lib/prisma.js';
import { callStateService } from '../services/call-state.js';
import { eventBus } from '../services/event-bus.js';
import { leadService } from '../services/lead-service.js';
import { getRedisClient } from '../services/redis.js';

/**
 * Agent Phone API Routes
 * Handles agent status, call control, and WebRTC credentials
 * All data is persisted to PostgreSQL via Prisma
 */

// Request body interfaces
interface AgentStatusBody {
  status: 'available' | 'away' | 'dnd' | 'offline';
}

interface OriginateCallBody {
  phoneNumber: string;
  callerId?: string;
  campaignId?: string;
}

interface TransferCallBody {
  destination: string;
  type: 'blind' | 'warm';
}

interface DTMFBody {
  digit: string;
}

interface IncomingCallBody {
  tenantId?: string;
  callId?: string;
  from?: string;
  callerNumber?: string;
  callerName?: string;
  screenPopData?: Record<string, unknown>;
  prospectData?: Record<string, unknown>;
  queueName?: string;
  campaignId?: string;
}

// Route params
interface CallIdParams {
  callId: string;
}

// User info attached by auth middleware
interface UserInfo {
  userId: string;
  tenantId: string;
  apiKeyId?: string;
}

// Helper to get user from request
function getUser(request: FastifyRequest): UserInfo {
  const user = (request as FastifyRequest & { user?: UserInfo }).user;
  return user ?? { userId: 'demo-agent', tenantId: 'demo-tenant' };
}

// Redis key prefixes for agent data
const AGENT_STATUS_PREFIX = 'agent:status:';
const AGENT_STATUS_TTL = 86400; // 24 hours

// Get Prisma and Redis clients lazily to avoid blocking during plugin registration
// These are called inside functions rather than at module top-level

// ============================================================================
// Agent Status Helpers (Redis-backed for real-time, fast access)
// ============================================================================

interface AgentStatusData {
  status: string;
  lastUpdated: string;
  currentCallId?: string;
}

async function getAgentStatus(userId: string): Promise<AgentStatusData> {
  const redis = getRedisClient();
  const key = `${AGENT_STATUS_PREFIX}${userId}`;
  const data = await redis.get(key);
  if (data) {
    return JSON.parse(data) as AgentStatusData;
  }
  return {
    status: 'offline',
    lastUpdated: new Date().toISOString(),
  };
}

async function setAgentStatus(userId: string, status: AgentStatusData): Promise<void> {
  const redis = getRedisClient();
  const key = `${AGENT_STATUS_PREFIX}${userId}`;
  await redis.setex(key, AGENT_STATUS_TTL, JSON.stringify(status));
}

export function registerAgentPhoneRoutes(fastify: FastifyInstance): void {
  // ============================================================================
  // Agent Status Endpoints
  // ============================================================================

  /**
   * GET /api/v1/agent/status
   * Get current agent status
   */
  fastify.get('/api/v1/agent/status', async (request: FastifyRequest, _reply: FastifyReply) => {
    const { userId } = getUser(request);
    const status = await getAgentStatus(userId);

    return {
      agentId: userId,
      ...status,
    };
  });

  /**
   * PUT /api/v1/agent/status
   * Update agent status
   */
  fastify.put<{ Body: AgentStatusBody }>(
    '/api/v1/agent/status',
    async (request, reply: FastifyReply) => {
      const { userId, tenantId } = getUser(request);
      const { status } = request.body;

      const validStatuses = ['available', 'away', 'dnd', 'offline'];
      if (!validStatuses.includes(status)) {
        void reply.code(400);
        return { error: { code: 'INVALID_STATUS', message: 'Invalid status value' } };
      }

      const existingStatus = await getAgentStatus(userId);
      const agentStatus: AgentStatusData = {
        status,
        lastUpdated: new Date().toISOString(),
        currentCallId: existingStatus.currentCallId,
      };

      await setAgentStatus(userId, agentStatus);

      // Emit event for real-time updates
      void eventBus.publish('call.*', {
        event: 'agent.status.changed',
        tenantId,
        data: {
          agentId: userId,
          status,
          timestamp: new Date().toISOString(),
        },
      });

      return {
        agentId: userId,
        ...agentStatus,
      };
    }
  );

  // ============================================================================
  // Call Control Endpoints
  // ============================================================================

  /**
   * POST /api/v1/agent/call/originate
   * Initiate an outbound call - persists to PostgreSQL
   */
  fastify.post<{ Body: OriginateCallBody }>(
    '/api/v1/agent/call/originate',
    async (request, reply: FastifyReply) => {
      const { userId, tenantId } = getUser(request);
      const { phoneNumber, callerId, campaignId } = request.body;

      if (!phoneNumber) {
        void reply.code(400);
        return { error: { code: 'MISSING_PHONE', message: 'Phone number is required' } };
      }

      // Generate unique call SID
      const callSid = `call_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      const prisma = getPrismaClient();

      // Create call in PostgreSQL
      const call = await prisma.call.create({
        data: {
          tenantId,
          callSid,
          toNumber: phoneNumber,
          direction: 'OUTBOUND',
          status: 'INITIATED',
          createdById: userId,
          campaignId: campaignId ?? null,
          metadata: {
            callerId: callerId ?? null,
            agentId: userId,
            originatedBy: 'agent-phone',
          } as Prisma.JsonObject,
          startedAt: new Date(),
        },
      });

      // Update agent status to on-call
      await setAgentStatus(userId, {
        status: 'on-call',
        lastUpdated: new Date().toISOString(),
        currentCallId: call.id,
      });

      // Also store in Redis for real-time state (with screen pop data etc)
      await callStateService.setCallState({
        id: call.id,
        tenantId,
        status: 'initiated',
        participants: [
          { id: userId, number: 'agent', role: 'agent', status: 'answered' },
          { id: 'callee', number: phoneNumber, role: 'callee', status: 'ringing' },
        ],
        timers: [],
        metadata: { callerId, campaignId, dbCallId: call.id },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Emit call initiated event
      void eventBus.publish('call.*', {
        event: 'call.initiated',
        tenantId,
        data: {
          callId: call.id,
          callSid,
          direction: 'outbound',
          agentId: userId,
          phoneNumber,
          callerId,
          campaignId,
          timestamp: new Date().toISOString(),
        },
      });

      // Simulate call connection after 2 seconds (in production, this comes from carrier webhook)
      setTimeout(() => {
        void (async () => {
          const prisma = getPrismaClient();
          // Update PostgreSQL
          await prisma.call.update({
            where: { id: call.id },
            data: {
              status: 'ANSWERED',
              answeredAt: new Date(),
            },
          });

          // Update Redis state
          await callStateService.updateCallState(call.id, { status: 'answered' });

          // Emit event
          void eventBus.publish('call.*', {
            event: 'call.answered',
            tenantId,
            data: {
              callId: call.id,
              timestamp: new Date().toISOString(),
            },
          });
        })();
      }, 2000);

      void reply.code(201);
      return {
        callId: call.id,
        callSid,
        status: 'initiated',
        phoneNumber,
        direction: 'outbound',
        createdAt: call.createdAt.toISOString(),
      };
    }
  );

  /**
   * POST /api/v1/agent/call/:callId/answer
   * Answer an incoming call - updates PostgreSQL
   */
  fastify.post<{ Params: CallIdParams }>(
    '/api/v1/agent/call/:callId/answer',
    async (request, reply: FastifyReply) => {
      const { callId } = request.params;
      const { userId, tenantId } = getUser(request);
      const prisma = getPrismaClient();

      // Get call from PostgreSQL
      const call = await prisma.call.findUnique({
        where: { id: callId },
      });

      if (!call) {
        void reply.code(404);
        return { error: { code: 'CALL_NOT_FOUND', message: 'Call not found' } };
      }

      // Update call in PostgreSQL
      await prisma.call.update({
        where: { id: callId },
        data: {
          status: 'ANSWERED',
          answeredAt: new Date(),
          metadata: {
            ...((call.metadata as Prisma.JsonObject) ?? {}),
            answeredByAgentId: userId,
          } as Prisma.JsonObject,
        },
      });

      // Update Redis state
      await callStateService.updateCallState(callId, { status: 'answered' });

      // Update agent status
      await setAgentStatus(userId, {
        status: 'on-call',
        lastUpdated: new Date().toISOString(),
        currentCallId: callId,
      });

      // Emit answer event
      void eventBus.publish('call.*', {
        event: 'call.answered',
        tenantId,
        data: {
          callId,
          agentId: userId,
          timestamp: new Date().toISOString(),
        },
      });

      return {
        callId,
        status: 'answered',
        answeredAt: new Date().toISOString(),
      };
    }
  );

  /**
   * POST /api/v1/agent/call/:callId/hangup
   * Hang up a call - updates PostgreSQL with duration
   */
  fastify.post<{ Params: CallIdParams }>(
    '/api/v1/agent/call/:callId/hangup',
    async (request, reply: FastifyReply) => {
      const { callId } = request.params;
      const { userId, tenantId } = getUser(request);
      const prisma = getPrismaClient();

      // Get call from PostgreSQL
      const call = await prisma.call.findUnique({
        where: { id: callId },
      });

      if (!call) {
        void reply.code(404);
        return { error: { code: 'CALL_NOT_FOUND', message: 'Call not found' } };
      }

      // Calculate duration
      const endedAt = new Date();
      let duration = 0;
      if (call.answeredAt) {
        duration = Math.floor((endedAt.getTime() - call.answeredAt.getTime()) / 1000);
      }

      // Update call in PostgreSQL
      await prisma.call.update({
        where: { id: callId },
        data: {
          status: 'COMPLETED',
          endedAt,
          duration,
        },
      });

      // Update Redis state
      await callStateService.updateCallState(callId, { status: 'completed' });

      // Update agent status
      await setAgentStatus(userId, {
        status: 'available',
        lastUpdated: new Date().toISOString(),
        currentCallId: undefined,
      });

      // Emit hangup event
      void eventBus.publish('call.*', {
        event: 'call.ended',
        tenantId,
        data: {
          callId,
          agentId: userId,
          duration,
          endReason: 'agent_hangup',
          timestamp: endedAt.toISOString(),
        },
      });

      return {
        callId,
        status: 'completed',
        duration,
        endedAt: endedAt.toISOString(),
      };
    }
  );

  /**
   * POST /api/v1/agent/call/:callId/hold
   * Toggle call hold - uses Redis for real-time state
   */
  fastify.post<{ Params: CallIdParams }>(
    '/api/v1/agent/call/:callId/hold',
    async (request, reply: FastifyReply) => {
      const { callId } = request.params;
      const { tenantId } = getUser(request);

      const callState = await callStateService.getCallState(callId);

      if (!callState) {
        void reply.code(404);
        return { error: { code: 'CALL_NOT_FOUND', message: 'Call not found' } };
      }

      // Toggle hold state
      const metadata = (callState.metadata as Record<string, unknown>) ?? {};
      const currentHoldState = metadata.isOnHold === true;
      const isOnHold = !currentHoldState;

      await callStateService.updateCallState(callId, {
        metadata: { ...metadata, isOnHold },
      });

      // Emit hold event
      void eventBus.publish('call.*', {
        event: 'call.hold',
        tenantId,
        data: {
          callId,
          isOnHold,
          timestamp: new Date().toISOString(),
        },
      });

      return {
        callId,
        isOnHold,
      };
    }
  );

  /**
   * POST /api/v1/agent/call/:callId/mute
   * Toggle call mute (client-side, just acknowledges)
   */
  fastify.post<{ Params: CallIdParams }>(
    '/api/v1/agent/call/:callId/mute',
    async (request, _reply: FastifyReply) => {
      const { callId } = request.params;

      return {
        callId,
        acknowledged: true,
        message: 'Mute is handled client-side via WebRTC',
      };
    }
  );

  /**
   * POST /api/v1/agent/call/:callId/transfer
   * Transfer a call - updates PostgreSQL
   */
  fastify.post<{ Params: CallIdParams; Body: TransferCallBody }>(
    '/api/v1/agent/call/:callId/transfer',
    async (request, reply: FastifyReply) => {
      const { callId } = request.params;
      const { destination, type } = request.body;
      const { userId, tenantId } = getUser(request);

      if (!destination) {
        void reply.code(400);
        return {
          error: { code: 'MISSING_DESTINATION', message: 'Transfer destination is required' },
        };
      }

      // Get call from PostgreSQL
      const prisma = getPrismaClient();
      const call = await prisma.call.findUnique({
        where: { id: callId },
      });

      if (!call) {
        void reply.code(404);
        return { error: { code: 'CALL_NOT_FOUND', message: 'Call not found' } };
      }

      // Update call metadata with transfer info
      await prisma.call.update({
        where: { id: callId },
        data: {
          metadata: {
            ...((call.metadata as Prisma.JsonObject) ?? {}),
            transferred: true,
            transferType: type,
            transferDestination: destination,
            transferredByAgentId: userId,
            transferredAt: new Date().toISOString(),
          } as Prisma.JsonObject,
        },
      });

      // For blind transfer, update agent status immediately
      if (type === 'blind') {
        await setAgentStatus(userId, {
          status: 'available',
          lastUpdated: new Date().toISOString(),
          currentCallId: undefined,
        });

        // Emit transfer event
        void eventBus.publish('call.*', {
          event: 'call.transferred',
          tenantId,
          data: {
            callId,
            agentId: userId,
            destination,
            transferType: type,
            timestamp: new Date().toISOString(),
          },
        });
      }

      void reply.code(200);
      return {
        callId,
        transferType: type,
        destination,
        status: type === 'blind' ? 'transferred' : 'consulting',
      };
    }
  );

  /**
   * POST /api/v1/agent/call/:callId/dtmf
   * Send DTMF tones
   */
  fastify.post<{ Params: CallIdParams; Body: DTMFBody }>(
    '/api/v1/agent/call/:callId/dtmf',
    async (request, reply: FastifyReply) => {
      const { callId } = request.params;
      const { digit } = request.body;

      if (!digit || !/^[0-9*#]$/.test(digit)) {
        void reply.code(400);
        return { error: { code: 'INVALID_DIGIT', message: 'Invalid DTMF digit' } };
      }

      return {
        callId,
        digit,
        sent: true,
      };
    }
  );

  // ============================================================================
  // WebRTC Credentials
  // ============================================================================

  /**
   * GET /api/v1/agent/webrtc/credentials
   * Get Verto/WebRTC credentials for browser-based calling
   */
  fastify.get(
    '/api/v1/agent/webrtc/credentials',
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const { userId, tenantId } = getUser(request);

      // Generate temporary credentials
      const username = `${userId}@${tenantId}`;
      const password = Buffer.from(`${userId}:${Date.now()}`).toString('base64').slice(0, 16);
      const expiry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

      return {
        username,
        password,
        realm: process.env.FREESWITCH_REALM ?? 'freeswitch',
        wsUrl: process.env.VERTO_WS_URL ?? 'wss://localhost:8082',
        stunServers: ['stun:stun.l.google.com:19302'],
        turnServers: [],
        expiresAt: expiry.toISOString(),
      };
    }
  );

  // ============================================================================
  // Screen Pop Data
  // ============================================================================

  /**
   * GET /api/v1/agent/call/:callId/screenpop
   * Get screen pop data for a call (from Redis cache + PostgreSQL metadata)
   */
  fastify.get<{ Params: CallIdParams }>(
    '/api/v1/agent/call/:callId/screenpop',
    async (request, reply: FastifyReply) => {
      const { callId } = request.params;

      // First check Redis for real-time state
      const callState = await callStateService.getCallState(callId);

      if (callState?.metadata?.screenPopData) {
        return {
          callId,
          data: callState.metadata.screenPopData,
        };
      }

      // Fallback to PostgreSQL
      const prisma = getPrismaClient();
      const call = await prisma.call.findUnique({
        where: { id: callId },
      });

      if (!call) {
        void reply.code(404);
        return { error: { code: 'CALL_NOT_FOUND', message: 'Call not found' } };
      }

      const metadata = (call.metadata as Record<string, unknown>) ?? {};
      const screenPopData = (metadata.screenPopData as Record<string, unknown>) ?? {};

      return {
        callId,
        data: screenPopData,
      };
    }
  );

  /**
   * POST /api/v1/agent/call/incoming
   * Webhook for incoming calls with screen pop data - persists to PostgreSQL
   */
  fastify.post<{ Body: IncomingCallBody }>(
    '/api/v1/agent/call/incoming',
    async (request, reply: FastifyReply) => {
      const body = request.body;
      const tenantId = body.tenantId ?? 'demo-tenant';
      const callSid =
        body.callId ?? `call_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      const callerNumber = body.from ?? body.callerNumber ?? '';
      const callerName = body.callerName ?? '';
      const screenPopData = body.screenPopData ?? body.prospectData ?? {};
      const queueName = body.queueName ?? '';
      const campaignId = body.campaignId ?? '';

      // Create call in PostgreSQL
      const prisma = getPrismaClient();
      const call = await prisma.call.create({
        data: {
          tenantId,
          callSid,
          toNumber: callerNumber, // For inbound, toNumber is the caller
          direction: 'INBOUND',
          status: 'RINGING',
          campaignId: campaignId || null,
          metadata: {
            callerName,
            queueName,
            screenPopData: screenPopData as Prisma.JsonObject,
            originatedBy: 'incoming-webhook',
          } as Prisma.JsonObject,
          startedAt: new Date(),
        },
      });

      // Store in Redis for real-time access to screen pop data
      await callStateService.setCallState({
        id: call.id,
        tenantId,
        status: 'ringing',
        participants: [{ id: 'caller', number: callerNumber, role: 'caller', status: 'ringing' }],
        timers: [],
        metadata: { screenPopData, queueName, campaignId, callerName, dbCallId: call.id },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      // Emit incoming call event
      void eventBus.publish('call.*', {
        event: 'agent.call.incoming',
        tenantId,
        data: {
          callId: call.id,
          callSid,
          callerNumber,
          callerName,
          queueName,
          campaignId,
          screenPopData,
          prospectData: screenPopData,
          timestamp: new Date().toISOString(),
        },
      });

      void reply.code(201);
      return {
        callId: call.id,
        callSid,
        status: 'ringing',
        message: 'Incoming call notification sent',
      };
    }
  );

  // ============================================================================
  // Call History
  // ============================================================================

  /**
   * GET /api/v1/agent/calls
   * Get call history for the current agent from PostgreSQL
   */
  fastify.get('/api/v1/agent/calls', async (request: FastifyRequest, _reply: FastifyReply) => {
    const { userId, tenantId } = getUser(request);
    const query = request.query as { limit?: string; offset?: string };
    const limit = parseInt(query.limit ?? '50', 10);
    const offset = parseInt(query.offset ?? '0', 10);
    const prisma = getPrismaClient();

    const calls = await prisma.call.findMany({
      where: {
        tenantId,
        OR: [
          { createdById: userId },
          {
            metadata: {
              path: ['answeredByAgentId'],
              equals: userId,
            },
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      select: {
        id: true,
        callSid: true,
        toNumber: true,
        direction: true,
        status: true,
        duration: true,
        createdAt: true,
        answeredAt: true,
        endedAt: true,
        metadata: true,
      },
    });

    return {
      calls,
      pagination: {
        limit,
        offset,
        hasMore: calls.length === limit,
      },
    };
  });

  /**
   * GET /api/v1/agent/lead/lookup
   * Look up lead by phone number for screen pop
   */
  fastify.get('/api/v1/agent/lead/lookup', async (request: FastifyRequest, reply: FastifyReply) => {
    const { tenantId } = getUser(request);
    const query = request.query as { phoneNumber?: string };
    const phoneNumber = query.phoneNumber;

    if (!phoneNumber) {
      return reply.status(400).send({
        error: { code: 'MISSING_PHONE', message: 'phoneNumber query parameter is required' },
      });
    }

    try {
      const screenPopData = await leadService.getScreenPopData(tenantId, phoneNumber);

      if (!screenPopData) {
        return reply.status(404).send({
          error: { code: 'LEAD_NOT_FOUND', message: 'No lead found for this phone number' },
        });
      }

      return { lead: screenPopData };
    } catch (err) {
      console.error('[LeadLookup] Error:', err);
      return reply.status(500).send({
        error: { code: 'LOOKUP_FAILED', message: 'Failed to lookup lead' },
      });
    }
  });
}

export default registerAgentPhoneRoutes;
