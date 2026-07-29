import type { Prisma } from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { getPrismaClient } from '../lib/prisma.js';
import { callStateService } from '../services/call-state.js';
import { eventBus } from '../services/event-bus.js';
import { freeswitchService, MergeError } from '../services/freeswitch-service.js';
import { leadService } from '../services/lead-service.js';
import { getRedisClient } from '../services/redis.js';
import { tcpaValidationService } from '../services/tcpa-validation-service.js';

// ============================================================================
// Recording Helpers
// ============================================================================

/**
 * Determine whether a call should be recorded based on campaign settings.
 * If no campaign is attached, recording defaults to ON (business requirement).
 */
async function shouldRecordCall(campaignId?: string | null): Promise<boolean> {
  if (!campaignId) {
    // No campaign attached → record by default
    return true;
  }

  try {
    const prisma = getPrismaClient();
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { recordingEnabled: true },
    });

    // If campaign not found, record by default
    return campaign?.recordingEnabled ?? true;
  } catch {
    // If lookup fails, record by default (fail-safe)
    return true;
  }
}

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
  return user ?? { userId: 'demo-agent', tenantId: 'default-tenant-id' };
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
  try {
    const redis = getRedisClient();
    const key = `${AGENT_STATUS_PREFIX}${userId}`;
    const data = await redis.get(key);
    if (data) {
      return JSON.parse(data) as AgentStatusData;
    }
  } catch (err) {
    console.warn(
      `[AgentStatus] Redis read failed for ${userId}, returning default:`,
      (err as Error).message
    );
  }
  return {
    status: 'offline',
    lastUpdated: new Date().toISOString(),
  };
}

async function setAgentStatus(userId: string, status: AgentStatusData): Promise<void> {
  try {
    const redis = getRedisClient();
    const key = `${AGENT_STATUS_PREFIX}${userId}`;
    await redis.setex(key, AGENT_STATUS_TTL, JSON.stringify(status));
  } catch (err) {
    console.warn(
      `[AgentStatus] Redis write failed for ${userId}, skipping:`,
      (err as Error).message
    );
  }
}

// eslint-disable-next-line @typescript-eslint/require-await
export async function registerAgentPhoneRoutes(fastify: FastifyInstance): Promise<void> {
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

      const validStatuses = ['available', 'away', 'dnd', 'offline', 'on-call'];
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

  /**
   * GET /api/v1/agent/my-numbers
   * Returns the authenticated user's assigned phone numbers for caller ID selection
   */
  fastify.get('/api/v1/agent/my-numbers', async (request, _reply: FastifyReply) => {
    const { userId, tenantId } = getUser(request);

    if (userId === 'demo-agent') {
      return {
        numbers: [
          { id: 'demo-1', number: '12816991120', provider: 'local' },
          { id: 'demo-2', number: '12816991121', provider: 'local' },
          { id: 'demo-3', number: '12816991122', provider: 'local' },
        ],
      };
    }

    const prisma = getPrismaClient();

    // The softphone caller-ID picker should offer only the agent's OWN assigned
    // DIDs, not the tenant-wide rotation pool (that pool is for the auto-dialer).
    const numbers = await prisma.phoneNumber.findMany({
      where: {
        tenantId,
        status: 'ACTIVE',
        userId,
        NOT: {
          number: {
            contains: '555',
          },
        },
      },
      select: {
        id: true,
        number: true,
        provider: true,
        purchasedAt: true,
      },
      orderBy: { purchasedAt: 'asc' },
    });

    return { numbers };
  });

  // ============================================================================
  // Call Control Endpoints
  // ============================================================================

  /**
   * POST /api/v1/agent/call/originate
   * Initiate an outbound call via FreeSWITCH - persists to PostgreSQL
   * Uses the same VOIP setup as the AI bot (Telnyx/Voxbeam/Anveo)
   */
  fastify.post<{ Body: OriginateCallBody }>(
    '/api/v1/agent/call/originate',
    async (request, reply: FastifyReply) => {
      let { userId, tenantId } = getUser(request);
      const { phoneNumber, callerId, campaignId } = request.body;

      if (!phoneNumber) {
        void reply.code(400);
        return { error: { code: 'MISSING_PHONE', message: 'Phone number is required' } };
      }

      // Generate unique call SID
      const callSid = `call_${Date.now()}_${Math.random().toString(36).substring(7)}`;
      const prisma = getPrismaClient();

      let isAuthenticatedUser = userId !== 'demo-agent';

      // Resilience for an expired/missing browser token. The softphone still
      // sends the agent's assigned caller-ID DID, so recover the authoritative
      // tenant + user from that number's owner (server-side, never trusting a
      // client-supplied tenant). Without this, getUser falls back to a
      // non-existent 'default-tenant-id' and call.create dies with a raw
      // `calls_tenantId_fkey` foreign-key violation surfaced to the agent.
      if (!isAuthenticatedUser && callerId && callerId !== 'ROTATE') {
        const cidLast10 = callerId.replace(/\D/g, '').slice(-10);
        if (cidLast10.length === 10) {
          const owner = await prisma.phoneNumber.findFirst({
            where: { number: { endsWith: cidLast10 }, userId: { not: null }, status: 'ACTIVE' },
            select: { userId: true, tenantId: true },
          });
          if (owner?.userId) {
            userId = owner.userId;
            tenantId = owner.tenantId;
            isAuthenticatedUser = true;
            request.log.warn({
              msg: 'Originate: recovered tenant/user from caller-ID DID (missing/expired agent token)',
              callerId,
              userId,
              tenantId,
            });
          }
        }
      }

      // If the tenant still cannot be resolved, fail cleanly with a clear,
      // actionable message instead of a database FK crash.
      if (!tenantId || tenantId === 'default-tenant-id') {
        void reply.code(401);
        return {
          error: {
            code: 'SESSION_EXPIRED',
            message: 'Your session has expired. Please log out and log back in to place calls.',
          },
        };
      }

      let outboundCallerId = callerId || process.env.OUTBOUND_CALLER_ID || '12816991120';

      // Rotate the tenant's FracTEL POOL (least-recently-used) and return the
      // chosen number, or null if the pool is empty. Used by the call-center
      // dialer (callerId === 'ROTATE') and as a fallback for unassigned agents.
      const rotatePoolCallerId = async (): Promise<string | null> => {
        const pool = await prisma.phoneNumber.findMany({
          where: { tenantId, status: 'ACTIVE', userId: null, poolType: 'POOL' },
        });
        if (pool.length === 0) return null;
        const sortedPool = [...pool].sort((a, b) => {
          const timeA = a.lastAssignedAt ? new Date(a.lastAssignedAt).getTime() : 0;
          const timeB = b.lastAssignedAt ? new Date(b.lastAssignedAt).getTime() : 0;
          return timeA - timeB;
        });
        const selectedRecord = sortedPool[0];
        await prisma.phoneNumber.update({
          where: { id: selectedRecord.id },
          data: { lastAssignedAt: new Date() },
        });
        return selectedRecord.number;
      };

      if (isAuthenticatedUser) {
        if (callerId === 'ROTATE') {
          // Call-center auto-dialer: rotate across the tenant DID pool.
          const rotated = await rotatePoolCallerId();
          if (rotated) outboundCallerId = rotated;
        } else {
          // Manual softphone: the agent dials with their OWN assigned number.
          const userNumbers = await prisma.phoneNumber.findMany({
            where: {
              tenantId,
              status: 'ACTIVE',
              userId,
              NOT: {
                number: {
                  contains: '555',
                },
              },
            },
          });

          if (userNumbers.length > 0) {
            if (callerId) {
              const requested = userNumbers.find(
                n =>
                  n.number === callerId ||
                  n.number.replace(/\D/g, '') === callerId.replace(/\D/g, '')
              );
              outboundCallerId = (requested ?? userNumbers[0]).number;
            } else {
              outboundCallerId = userNumbers[0].number;
            }
          } else {
            // Agent has no assigned number — fall back to a pool DID so the call
            // still presents a valid FracTEL number rather than a dead default.
            const rotated = await rotatePoolCallerId();
            if (rotated) outboundCallerId = rotated;
          }
        }
      }

      // Normalize caller ID to exactly 11 digits (e.g. 12816991120)
      const digitsOnly = outboundCallerId.replace(/\D/g, '');
      const fsCallerId = digitsOnly.length === 10 ? '1' + digitsOnly : digitsOnly;

      // Find the PhoneNumber record in the DB to associate with the call
      const cleanFsCallerId = fsCallerId.replace(/\D/g, '');
      const last10 = cleanFsCallerId.length >= 10 ? cleanFsCallerId.slice(-10) : cleanFsCallerId;
      const dbNumber = await prisma.phoneNumber.findFirst({
        where: {
          tenantId,
          number: {
            endsWith: last10,
          },
        },
      });

      // Determine recording intent from campaign settings
      const recordingEnabled = await shouldRecordCall(campaignId);

      // Create call in PostgreSQL
      // Skip createdById for demo/unauthenticated requests to avoid FK constraint issues
      const call = await prisma.call.create({
        data: {
          tenantId,
          callSid,
          toNumber: phoneNumber,
          direction: 'OUTBOUND',
          status: 'INITIATED',
          ...(isAuthenticatedUser ? { createdById: userId } : {}),
          campaignId: campaignId ?? null,
          callerId: fsCallerId,
          fromNumberId: dbNumber?.id || null,
          // Recording lifecycle: mark intent at call creation
          recordingStatus: recordingEnabled ? 'PENDING' : null,
          metadata: {
            callerId: fsCallerId,
            agentId: userId,
            originatedBy: 'agent-phone',
            recordingEnabled,
            recordingDebug: {
              originateCreatedAt: new Date().toISOString(),
              sipHeaderSent: true,
            },
          } as Prisma.JsonObject,
          startedAt: new Date(),
        },
      });

      request.log.info(
        {
          callId: call.id,
          callSid: call.callSid,
          fromNumber: fsCallerId,
          toNumber: phoneNumber,
          recordingEnabled,
        },
        'HOPWHISTLE ORIGINATE DIAGNOSTIC LOG'
      );

      // Update agent status to on-call
      await setAgentStatus(userId, {
        status: 'on-call',
        lastUpdated: new Date().toISOString(),
        currentCallId: call.id,
      });

      // Also store in Redis for real-time state (with screen pop data etc)
      try {
        await callStateService.setCallState({
          id: call.id,
          tenantId,
          status: 'initiated',
          participants: [
            { id: userId, number: 'agent', role: 'agent', status: 'answered' },
            { id: 'callee', number: phoneNumber, role: 'callee', status: 'ringing' },
          ],
          timers: [],
          metadata: { callerId: fsCallerId, campaignId, dbCallId: call.id },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        console.warn(
          `[Originate] Redis callState write failed, continuing:`,
          (err as Error).message
        );
      }

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
          callerId: fsCallerId,
          campaignId,
          timestamp: new Date().toISOString(),
        },
      });

      // Note: The actual call is placed via Verto WebRTC from the browser.
      // The API just tracks the call state. The browser fetches Verto credentials
      // from /api/v1/agent/webrtc/credentials and connects directly to FreeSWITCH.

      void reply.code(201);
      return {
        callId: call.id,
        callSid,
        status: 'initiated',
        phoneNumber,
        callerId: fsCallerId,
        direction: 'outbound',
        createdAt: call.createdAt.toISOString(),
        // Browser should use these credentials to connect via Verto
        verto: {
          endpoint: '/api/v1/agent/webrtc/credentials',
        },
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

      // Check if already answered or completed
      if (call.status === 'ANSWERED' || call.status === 'COMPLETED') {
        const callMetadata = (call.metadata as Prisma.JsonObject) ?? {};
        const recordingEnabled = callMetadata.recordingEnabled !== false;
        return {
          callId,
          status: call.status.toLowerCase(),
          answeredAt: call.answeredAt?.toISOString() || new Date().toISOString(),
          recordingEnabled,
        };
      }

      // Check if recording should happen for this call
      const callMetadata = (call.metadata as Prisma.JsonObject) ?? {};
      const recordingEnabled = callMetadata.recordingEnabled !== false;
      const answeredAt = call.answeredAt || new Date();

      const existingRecordingDebug = (callMetadata.recordingDebug as Record<string, any>) || {};
      const recordingDebug = {
        ...existingRecordingDebug,
        answerNotifiedAt: answeredAt.toISOString(),
      };

      // Update call in PostgreSQL
      await prisma.call.update({
        where: { id: callId },
        data: {
          status: 'ANSWERED',
          answeredAt,
          // If recording is enabled, transition from PENDING → RECORDING
          ...(recordingEnabled && call.recordingStatus === 'PENDING'
            ? {
                recordingStatus: 'RECORDING',
                recordingStartedAt: new Date(),
              }
            : {}),
          metadata: {
            ...callMetadata,
            answeredByAgentId: userId,
            recordingDebug,
          } as Prisma.JsonObject,
        },
      });

      // Auto-start server-side recording via FreeSWITCH ESL
      // This is fire-and-forget - the call should proceed even if recording fails
      if (recordingEnabled) {
        freeswitchService
          .startRecording(call.callSid, callId)
          .then(started => {
            if (!started) {
              throw new Error(
                'Recording start returned false (check FreeSWITCH connection or logs)'
              );
            }
          })
          .catch(err => {
            console.error(`[Recording] Failed to start recording for call ${callId}:`, err);
            // Mark recording as failed so UI shows correct state
            const prismaForError = getPrismaClient();
            void prismaForError.call.update({
              where: { id: callId },
              data: {
                recordingStatus: 'FAILED',
                recordingError: err instanceof Error ? err.message : 'Recording start failed',
              },
            });
          });
      }

      // Update Redis state
      try {
        await callStateService.updateCallState(callId, { status: 'answered' });
      } catch (err) {
        console.warn(`[Answer] Redis callState update failed, continuing:`, (err as Error).message);
      }

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
          recordingEnabled,
          timestamp: answeredAt.toISOString(),
        },
      });

      return {
        callId,
        status: 'answered',
        answeredAt: answeredAt.toISOString(),
        recordingEnabled,
      };
    }
  );

  /**
   * POST /api/v1/agent/call/:callId/hangup
   * Hang up a call - updates PostgreSQL with duration
   */
  fastify.post<{
    Params: CallIdParams;
    Body?: {
      duration?: number;
      startedAt?: string;
      answeredAt?: string;
      endedAt?: string;
      endReason?: string;
    };
  }>('/api/v1/agent/call/:callId/hangup', async (request, reply: FastifyReply) => {
    const { callId } = request.params;
    const {
      duration: bodyDuration,
      startedAt: bodyStartedAt,
      answeredAt: bodyAnsweredAt,
      endedAt: bodyEndedAt,
      endReason,
    } = request.body || {};
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

    // If call is already COMPLETED, return the existing finalized values.
    if (call.status === 'COMPLETED') {
      if (
        call.recordingStatus === 'PENDING' ||
        call.recordingStatus === 'RECORDING' ||
        call.recordingStatus === 'PROCESSING'
      ) {
        const { reconcileRecordingForCall } = await import('../services/recording-reconciler.js');
        void reconcileRecordingForCall(callId).catch(err => {
          console.error(`[Recording] Reconcile failed for already completed call ${callId}:`, err);
        });
      }

      return {
        callId,
        status: 'completed',
        duration: call.duration ?? 0,
        endedAt: call.endedAt?.toISOString() || new Date().toISOString(),
      };
    }

    const endedAt = bodyEndedAt ? new Date(bodyEndedAt) : new Date();
    const answeredAt = call.answeredAt || (bodyAnsweredAt ? new Date(bodyAnsweredAt) : null);
    const startedAt = call.startedAt || (bodyStartedAt ? new Date(bodyStartedAt) : null);

    // Duration calculation logic
    let duration = 0;
    if (
      bodyDuration !== undefined &&
      typeof bodyDuration === 'number' &&
      Number.isFinite(bodyDuration) &&
      bodyDuration >= 0
    ) {
      duration = bodyDuration;
    } else if (answeredAt) {
      duration = Math.floor((endedAt.getTime() - answeredAt.getTime()) / 1000);
    } else if (startedAt) {
      duration = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000);
    }
    if (duration < 0) duration = 0;

    // Handle recordingStatus transitions:
    const recordingUpdate: Record<string, unknown> = {};
    if (call.recordingStatus === 'RECORDING') {
      recordingUpdate.recordingStatus = 'PROCESSING';
    } else if (call.recordingStatus === 'PENDING') {
      if (!answeredAt) {
        recordingUpdate.recordingStatus = 'FAILED';
        recordingUpdate.recordingError = 'Call was not answered, no recording generated.';
      } else {
        recordingUpdate.recordingStatus = 'PROCESSING';
      }
    }

    // Add metadata.endReason
    const callMetadata = (call.metadata as Prisma.JsonObject) ?? {};
    const existingRecordingDebug = (callMetadata.recordingDebug as Record<string, any>) || {};
    const recordingDebug = {
      ...existingRecordingDebug,
      hangupNotifiedAt: endedAt.toISOString(),
    };
    const updatedMetadata = {
      ...callMetadata,
      ...(endReason ? { endReason } : {}),
      recordingDebug,
    };

    // Update call in PostgreSQL
    await prisma.call.update({
      where: { id: callId },
      data: {
        status: 'COMPLETED',
        endedAt,
        answeredAt: answeredAt || undefined,
        duration,
        connectedDuration: answeredAt ? duration : 0,
        metadata: updatedMetadata as Prisma.JsonObject,
        ...recordingUpdate,
      },
    });

    // Update Redis state
    try {
      await callStateService.updateCallState(callId, { status: 'completed' });
    } catch (err) {
      console.warn(`[Hangup] Redis callState update failed, continuing:`, (err as Error).message);
    }

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
        endReason: endReason || 'agent_hangup',
        timestamp: endedAt.toISOString(),
      },
    });

    // ======================================================================
    // Recording finalization failsafe
    // ======================================================================
    const finalRecordingStatus = String(
      recordingUpdate.recordingStatus || call.recordingStatus || ''
    );

    if (['PENDING', 'RECORDING', 'PROCESSING'].includes(finalRecordingStatus)) {
      const { reconcileRecordingForCall } = await import('../services/recording-reconciler.js');

      setTimeout(() => {
        void reconcileRecordingForCall(callId).catch(err => {
          console.error(`[Recording] Delayed reconcile failed for call ${callId}:`, err);
        });
      }, 60_000);
    }

    return {
      callId,
      status: 'completed',
      duration,
      endedAt: endedAt.toISOString(),
    };
  });

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
   * POST /api/v1/agent/call/merge
   * Merge two calls into a conference (3-way calling)
   */
  fastify.post<{ Body: { activeCallId: string; heldCallId: string } }>(
    '/api/v1/agent/call/merge',
    async (request, reply) => {
      const { activeCallId, heldCallId } = request.body;
      const { userId } = getUser(request);

      if (!activeCallId || !heldCallId) {
        void reply.code(400);
        return {
          error: {
            code: 'MISSING_CALL_ID',
            message: 'Both activeCallId and heldCallId are required',
          },
        };
      }

      try {
        request.log.info({ msg: 'MERGE REQUEST', activeCallId, heldCallId, userId });
        await freeswitchService.mergeCalls(activeCallId, heldCallId);

        // Publish merge event
        void eventBus.publish('call.*', {
          event: 'call.merged',
          tenantId: getUser(request).tenantId,
          data: {
            activeSipCallId: activeCallId,
            heldSipCallId: heldCallId,
            agentId: userId,
            timestamp: new Date().toISOString(),
          },
        });

        return {
          success: true,
          message: 'Calls merged into conference',
        };
      } catch (err) {
        request.log.error({ msg: 'Merge failed', activeCallId, heldCallId, err });

        // A merge attempted before both legs are answered is a retryable
        // client-side timing problem, not a server fault — say so, and say
        // why, so the softphone can tell the agent what to do.
        if (err instanceof MergeError) {
          void reply.code(err.code === 'MERGE_NOT_ANSWERED' ? 409 : 400);
          return { error: { code: err.code, message: err.message } };
        }

        void reply.code(500);
        return { error: { code: 'MERGE_FAILED', message: 'Failed to merge calls' } };
      }
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

      const prisma = getPrismaClient();
      let user =
        userId && userId !== 'demo-agent'
          ? await prisma.user.findUnique({ where: { id: userId } })
          : null;
      let extension: string | null = null;
      if (user?.metadata && typeof user.metadata === 'object' && !Array.isArray(user.metadata)) {
        const meta = user.metadata as Record<string, unknown>;
        if (typeof meta.extension === 'string' || typeof meta.extension === 'number') {
          extension = String(meta.extension);
        }
      }

      // If user has no extension, dynamically assign a free one from 1000-1019
      if (!extension && user && userId && userId !== 'demo-agent') {
        const allUsers = await prisma.user.findMany({
          select: { metadata: true },
        });
        const usedExtensions = new Set<string>();
        for (const u of allUsers) {
          if (u.metadata && typeof u.metadata === 'object' && !Array.isArray(u.metadata)) {
            const meta = u.metadata as Record<string, unknown>;
            if (typeof meta.extension === 'string' || typeof meta.extension === 'number') {
              usedExtensions.add(String(meta.extension).trim());
            }
          }
        }

        let availableExtension: string | null = null;
        for (let extNum = 1000; extNum <= 1019; extNum++) {
          const extStr = extNum.toString();
          if (!usedExtensions.has(extStr)) {
            availableExtension = extStr;
            break;
          }
        }

        if (availableExtension) {
          const currentMetadata = (user.metadata as Record<string, unknown>) || {};
          const updatedMetadata = {
            ...currentMetadata,
            extension: availableExtension,
          };

          user = await prisma.user.update({
            where: { id: userId },
            data: { metadata: updatedMetadata },
          });
          extension = availableExtension;

          request.log.info({
            msg: 'webrtc/credentials: Automatically assigned free extension to user',
            userId,
            extension: extension || '',
          });

          // Sync DidRoute for any active phone numbers assigned to the user
          try {
            const { didRouteService } = await import('../services/did-route-service.js');
            const phoneNumbers = await prisma.phoneNumber.findMany({
              where: { userId, status: 'ACTIVE' },
            });
            for (const phoneNum of phoneNumbers) {
              await didRouteService.syncDidRouteForNumber(phoneNum.id, tenantId);
            }
          } catch (syncErr) {
            request.log.error({
              msg: 'webrtc/credentials: Failed to sync DID routes during auto-extension assignment',
              err: syncErr,
            });
          }
        }
      }

      const activeExt = extension || '1000';
      const username = activeExt;
      const password = '1234';
      const expiry = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

      // Build Verto WebSocket URL
      // Priority: VERTO_WS_URL env var > PUBLIC_IP:8082 > localhost fallback
      const publicIp = process.env.PUBLIC_IP;
      const vertoUrl =
        process.env.VERTO_WS_URL || (publicIp ? `wss://${publicIp}:8082` : 'wss://localhost:8082');

      return {
        username,
        password,
        realm: process.env.FREESWITCH_REALM ?? process.env.PUBLIC_IP ?? 'freeswitch',
        wsUrl: vertoUrl,
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

      // ── TCPA Litigator Check ─────────────────────────────────────────
      // Block known TCPA litigators BEFORE creating any call record
      if (callerNumber) {
        try {
          const tcpaResult = await tcpaValidationService.validateNumber(callerNumber);
          if (tcpaResult.isLitigator) {
            console.log(
              `[TCPA-BLOCK] Blocking litigator ${callerNumber} (cached=${tcpaResult.cached})`
            );

            // Create a blocked call record for audit trail
            const prismaBlock = getPrismaClient();
            await prismaBlock.call.create({
              data: {
                tenantId,
                callSid,
                toNumber: callerNumber,
                direction: 'INBOUND',
                status: 'FAILED',
                blocked: true,
                blockReason: 'TCPA_LITIGATOR',
                campaignId: campaignId || null,
                metadata: {
                  callerName,
                  queueName,
                  tcpaResult,
                  blockedAt: new Date().toISOString(),
                } as Prisma.JsonObject,
                startedAt: new Date(),
                endedAt: new Date(),
              },
            });

            void reply.code(403);
            return {
              blocked: true,
              reason: 'TCPA_LITIGATOR',
              message: 'Call blocked: caller is a known TCPA litigator',
            };
          }
        } catch (err) {
          // Fail-open: if TCPA check itself errors, let the call through
          console.error('[TCPA] Validation error (fail-open):', err);
        }
      }

      // Determine recording intent from campaign settings
      const prisma = getPrismaClient();
      const recordingEnabled = await shouldRecordCall(campaignId || null);

      // Create call in PostgreSQL
      const call = await prisma.call.create({
        data: {
          tenantId,
          callSid,
          toNumber: callerNumber, // For inbound, toNumber is the caller
          direction: 'INBOUND',
          status: 'RINGING',
          campaignId: campaignId || null,
          // Recording lifecycle: mark intent at call creation
          recordingStatus: recordingEnabled ? 'PENDING' : null,
          metadata: {
            callerName,
            queueName,
            screenPopData: screenPopData as Prisma.JsonObject,
            originatedBy: 'incoming-webhook',
            recordingEnabled,
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
