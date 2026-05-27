import type { Prisma } from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { getPrismaClient } from '../lib/prisma.js';
import { callStateService } from '../services/call-state.js';
import { eventBus } from '../services/event-bus.js';
import { freeswitchService } from '../services/freeswitch-service.js';
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
   * Initiate an outbound call via FreeSWITCH - persists to PostgreSQL
   * Uses the same VOIP setup as the AI bot (Telnyx/Voxbeam/Anveo)
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

      const isAuthenticatedUser = userId !== 'demo-agent';
      let outboundCallerId = callerId || '12816991120';

      if (isAuthenticatedUser) {
        const userNumbers = await prisma.phoneNumber.findMany({
          where: {
            tenantId,
            userId,
            status: 'ACTIVE',
          },
        });

        const userRecord = await prisma.user.findUnique({
          where: { id: userId },
          include: {
            roles: {
              include: {
                role: true,
              },
            },
          },
        });
        const userRoles = userRecord?.roles.map(ur => ur.role.name) || [];
        const isAdminOrOwner = userRoles.some(role => role === 'ADMIN' || role === 'OWNER');

        if (userNumbers.length === 0 && !isAdminOrOwner) {
          void reply.code(400);
          return {
            error: {
              code: 'NO_ASSIGNED_NUMBER',
              message: 'You do not have any phone numbers assigned to your account. Please add a phone number on the Phone Numbers page first.',
            },
          };
        }

        if (userNumbers.length > 0) {
          const hasNumber = userNumbers.some(n => n.number === callerId || n.number.replace(/\D/g, '') === callerId?.replace(/\D/g, ''));
          if (!hasNumber || !callerId) {
            outboundCallerId = userNumbers[0].number;
          }
        }
      }

      // Normalize caller ID to exactly 11 digits (e.g. 12816991120)
      const digitsOnly = outboundCallerId.replace(/\D/g, '');
      const fsCallerId = digitsOnly.length === 10 ? '1' + digitsOnly : digitsOnly;

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
          // Recording lifecycle: mark intent at call creation
          recordingStatus: recordingEnabled ? 'PENDING' : null,
          metadata: {
            callerId: fsCallerId,
            agentId: userId,
            originatedBy: 'agent-phone',
            recordingEnabled,
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
        metadata: { callerId: fsCallerId, campaignId, dbCallId: call.id },
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
          } as Prisma.JsonObject,
        },
      });

      // Auto-start server-side recording via FreeSWITCH ESL
      // This is fire-and-forget - the call should proceed even if recording fails
      if (recordingEnabled) {
        freeswitchService.startRecording(call.callSid, callId)
          .then((started) => {
            if (!started) {
              throw new Error('Recording start returned false (check FreeSWITCH connection or logs)');
            }
          })
          .catch((err) => {
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
  }>(
    '/api/v1/agent/call/:callId/hangup',
    async (request, reply: FastifyReply) => {
      const { callId } = request.params;
      const { duration: bodyDuration, startedAt: bodyStartedAt, answeredAt: bodyAnsweredAt, endedAt: bodyEndedAt, endReason } = request.body || {};
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
      if (bodyDuration !== undefined && typeof bodyDuration === 'number' && Number.isFinite(bodyDuration) && bodyDuration >= 0) {
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
      const updatedMetadata = {
        ...callMetadata,
        ...(endReason ? { endReason } : {}),
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
          endReason: endReason || 'agent_hangup',
          timestamp: endedAt.toISOString(),
        },
      });

      // ======================================================================
      // Recording finalization failsafe
      // ======================================================================
      // The FreeSWITCH hangup hook should upload the recording file within ~15s.
      // Schedule a delayed check: if the recording is still PROCESSING after 20s,
      // try to fetch it from the FS container or mark it as failed.
      if (recordingUpdate.recordingStatus === 'PROCESSING') {
        const checkDelay = 20_000; // 20 seconds
        setTimeout(async () => {
          try {
            const prismaForFailsafe = getPrismaClient();

            // 1. Check for existing recording row first
            const existingRecording = await prismaForFailsafe.recording.findFirst({
              where: { callId },
            });

            if (existingRecording) {
              const playbackUrl = `/api/v1/recordings/${existingRecording.id}/stream`;
              await prismaForFailsafe.call.update({
                where: { id: callId },
                data: {
                  primaryRecordingId: existingRecording.id,
                  recordingStatus: 'READY',
                  recordingUrl: playbackUrl,
                  recordingCompletedAt: existingRecording.createdAt,
                  recordingError: null,
                },
              });
              console.info(`[Recording] Failsafe: Found existing recording row for call ${callId}. Updated call status to READY.`);
              return;
            }

            const freshCall = await prismaForFailsafe.call.findUnique({
              where: { id: callId },
              select: { recordingStatus: true },
            });

            if (freshCall?.recordingStatus === 'PROCESSING') {
              console.warn(
                `[Recording] Call ${callId} still PROCESSING after ${checkDelay / 1000}s — ` +
                'FS hangup hook may have failed. Attempting direct file fetch...'
              );

              // Try to find and upload the recording file from the shared volume
              const fs = await import('fs');
              const recordingPath = `/recordings/${callId}.wav`;
              const altPath = `/tmp/recordings/${callId}.wav`;

              let filePath: string | null = null;
              if (fs.existsSync(recordingPath)) {
                filePath = recordingPath;
              } else if (fs.existsSync(altPath)) {
                filePath = altPath;
              }

              if (filePath) {
                console.info(`[Recording] Failsafe: Found recording file at ${filePath}, uploading...`);
                const fileBuffer = fs.readFileSync(filePath);
                const { RecordingService } = await import('../services/recording-service.js');
                const recordingService = new RecordingService();
                await recordingService.uploadRecording({
                  callId,
                  format: 'wav',
                  file: fileBuffer,
                  duration: duration > 0 ? duration : undefined,
                });
                console.info(`[Recording] Failsafe: Successfully uploaded recording for call ${callId} via failsafe`);
                // Clean up the file
                try { fs.unlinkSync(filePath); } catch { /* ignore */ }
              } else {
                console.warn(
                  `[Recording] Failsafe: No recording file found for call ${callId} at ${recordingPath} or ${altPath}. ` +
                  'Marking as FAILED.'
                );
                await prismaForFailsafe.call.update({
                  where: { id: callId },
                  data: {
                    recordingStatus: 'FAILED',
                    recordingError: 'Recording file not found after hangup hook timeout',
                  },
                });
              }
            }
          } catch (err) {
            console.error(`[Recording] Failsafe check failed for call ${callId}:`, err);
            // Mark as FAILED so UI doesn't spin forever
            try {
              const prismaForError = getPrismaClient();
              await prismaForError.call.update({
                where: { id: callId },
                data: {
                  recordingStatus: 'FAILED',
                  recordingError: `Failsafe upload failed: ${err instanceof Error ? err.message : 'unknown error'}`,
                },
              });
            } catch { /* ignore update errors */ }
          }
        }, checkDelay);
      }

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
        request.log.error({ msg: 'Merge failed', err });
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
      const user = await prisma.user.findUnique({ where: { id: userId } });
      const extension = (user?.metadata as any)?.extension;

      // Generate temporary credentials or use static extension mapping
      const username = extension ? `${extension}@${tenantId}` : `${userId}@${tenantId}`;
      const password = extension ? '1234' : Buffer.from(`${userId}:${Date.now()}`).toString('base64').slice(0, 16);
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
            console.log(`[TCPA-BLOCK] Blocking litigator ${callerNumber} (cached=${tcpaResult.cached})`);

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
