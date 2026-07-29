import { FastifyInstance } from 'fastify';

import { getPrismaClient } from '../lib/prisma.js';
import { RecordingService } from '../services/recording-service.js';

const recordingService = new RecordingService();
const prisma = getPrismaClient();

function getPublicApiBaseUrl(request: any): string {
  const envUrl = process.env.PUBLIC_API_URL || process.env.API_PUBLIC_URL;
  if (envUrl) {
    return envUrl.replace(/\/api\/?$/, '');
  }
  const protocol = (request.headers['x-forwarded-proto'] as string) || 'http';
  const host = request.headers.host || 'localhost:3001';
  return `${protocol}://${host}`;
}

/**
 * Recording management routes
 */
export async function registerRecordingManagementRoutes(fastify: FastifyInstance) {
  // Upload recording callback from FreeSWITCH
  fastify.post<{
    Body: {
      callId: string;
      legId?: string;
      url?: string;
      format?: string;
      size?: number;
      duration?: number;
    };
  }>('/api/v1/recordings/upload', async (request, reply) => {
    let resolvedCallId: string | undefined = undefined;
    try {
      const { callId, legId, url, format, duration } = request.body || {};
      resolvedCallId = callId;

      // If URL is provided, download and upload to S3
      if (url) {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to download recording from ${url}`);
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length === 0) {
          throw new Error('Downloaded recording file is empty');
        }
        const uploadResult = await recordingService.uploadRecording({
          callId: resolvedCallId || '',
          legId,
          format: format || 'wav',
          file: buffer,
          duration,
        });

        return {
          success: true,
          recordingId: uploadResult.id,
          storageKey: uploadResult.storageKey,
          size: uploadResult.size.toString(),
          checksum: uploadResult.checksum,
        };
      }

      let fileBuffer: Buffer | null = null;
      let resolvedFormat: string | undefined = format;
      let resolvedLegId: string | undefined = legId;
      let resolvedDuration: number | undefined = duration;

      if (request.isMultipart()) {
        const parts = request.parts();
        for await (const part of parts) {
          if (part.type === 'file') {
            fileBuffer = await part.toBuffer();
            if (!resolvedFormat && part.filename) {
              resolvedFormat = part.filename.split('.').pop();
            }
          } else {
            const fieldVal = part.value !== undefined ? String(part.value) : undefined;
            if (part.fieldname === 'callId') {
              resolvedCallId = fieldVal;
            } else if (part.fieldname === 'format') {
              resolvedFormat = fieldVal;
            } else if (part.fieldname === 'legId') {
              resolvedLegId = fieldVal;
            } else if (part.fieldname === 'duration') {
              resolvedDuration = fieldVal ? Number(fieldVal) : undefined;
            }
          }
        }
      }

      if (!resolvedCallId) {
        reply.code(400);
        return {
          error: {
            code: 'MISSING_CALL_ID',
            message: 'callId is required',
          },
        };
      }

      if (!fileBuffer || fileBuffer.length === 0) {
        throw new Error('No file provided or file is empty');
      }

      const uploadResult = await recordingService.uploadRecording({
        callId: resolvedCallId,
        legId: resolvedLegId,
        format: resolvedFormat || 'wav',
        file: fileBuffer,
        duration: resolvedDuration,
      });

      return {
        success: true,
        recordingId: uploadResult.id,
        storageKey: uploadResult.storageKey,
        size: uploadResult.size.toString(),
        checksum: uploadResult.checksum,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to upload recording';
      if (resolvedCallId) {
        try {
          await recordingService.markRecordingFailed(resolvedCallId, errorMsg);
        } catch (markErr) {
          request.log.error({ error: markErr, callId: resolvedCallId }, 'Failed to mark recording as failed');
        }
      }
      reply.code(400);
      return {
        error: {
          code: 'UPLOAD_ERROR',
          message: errorMsg,
        },
      };
    }
  });

  // Helper to get authenticated user profile (role, buyerId, publisherId, accessToRecordings)
  async function getUserProfile(request: any) {
    const user = request.user;
    let userRoles: string[] = [];
    let buyerId: string | null = null;
    let publisherId: string | null = null;
    let publisherAccessToRecordings = false;
    let buyerAccessToRecordings = false;

    if (user?.userId) {
      const userRecord = await prisma.user.findUnique({
        where: { id: user.userId },
        include: { roles: { include: { role: true } } },
      });
      if (userRecord) {
        userRoles = userRecord.roles.map((ur: any) => ur.role.name) || [];
        buyerId = userRecord.buyerId || null;
        publisherId = userRecord.publisherId || (userRecord.metadata as any)?.publisherId || null;
      }
    }

    if (user?.roles && Array.isArray(user.roles)) {
      for (const r of user.roles) {
        if (!userRoles.includes(r)) userRoles.push(r);
      }
    }

    if (publisherId) {
      const pub = await prisma.publisher.findUnique({
        where: { id: publisherId },
        select: { accessToRecordings: true },
      });
      publisherAccessToRecordings = pub?.accessToRecordings ?? false;
    }

    if (buyerId) {
      const buyer = await prisma.buyer.findUnique({
        where: { id: buyerId },
        select: { metadata: true },
      });
      buyerAccessToRecordings = !!(buyer?.metadata as any)?.accessToRecordings;
    }

    const isAdminOrOwner = userRoles.some(role => role === 'ADMIN' || role === 'OWNER') || 
                           (user?.roles?.some((role: string) => role === 'ADMIN' || role === 'OWNER') ?? false);

    return {
      isAdminOrOwner,
      userRoles,
      buyerId,
      publisherId,
      publisherAccessToRecordings,
      buyerAccessToRecordings,
    };
  }

  // Helper to verify recording access permissions
  async function checkRecordingAccess(recording: any, profile: any, tenantId: string, userId?: string): Promise<boolean> {
    if (profile.isAdminOrOwner) {
      return true;
    }
    if (profile.userRoles.includes('PUBLISHER')) {
      return !!(profile.publisherAccessToRecordings && recording.call?.publisherId === profile.publisherId);
    }
    if (profile.userRoles.includes('BUYER')) {
      return !!(profile.buyerAccessToRecordings && recording.call?.buyerId === profile.buyerId);
    }
    if (profile.userRoles.includes('AGENT') && userId) {
      if (recording.call?.createdById === userId) {
        return true;
      }
      // Fetch agent's phone numbers
      const fetchedNumbers = await prisma.phoneNumber.findMany({
        where: { tenantId, userId },
        select: { number: true },
      });
      const userNumbers = fetchedNumbers.map(n => n.number);
      const numberFormats: string[] = [];
      for (const num of userNumbers) {
        numberFormats.push(num);
        if (num.startsWith('+1')) {
          numberFormats.push(num.substring(2));
          numberFormats.push(num.substring(1));
        } else if (num.startsWith('1') && num.length === 11) {
          numberFormats.push('+' + num);
          numberFormats.push(num.substring(1));
        } else if (num.length === 10) {
          numberFormats.push('+1' + num);
          numberFormats.push('1' + num);
        }
      }
      const callCaller = recording.call?.callerId || '';
      const callTo = recording.call?.toNumber || '';
      const callDid = recording.call?.did || '';
      return numberFormats.includes(callCaller) || numberFormats.includes(callTo) || numberFormats.includes(callDid);
    }
    return false;
  }

  // List recordings
  fastify.get('/api/v1/recordings', async (request, reply) => {
    const tenantId = (request as any).user?.tenantId;
    if (!tenantId) {
      reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const {
      page = 1,
      limit = 20,
      callId,
      status,
    } = request.query as {
      page?: number;
      limit?: number;
      callId?: string;
      status?: string;
    };

    const profile = await getUserProfile(request);

    const where: any = {
      call: { tenantId },
      deletedAt: null,
    };

    if (callId) {
      where.callId = callId;
    }

    if (status) {
      where.status = status;
    }

    if (!profile.isAdminOrOwner) {
      if (profile.userRoles.includes('PUBLISHER')) {
        if (!profile.publisherAccessToRecordings) {
          return {
            data: [],
            meta: {
              page,
              limit,
              total: 0,
              totalPages: 0,
            },
          };
        }
        where.call.publisherId = profile.publisherId;
      } else if (profile.userRoles.includes('BUYER')) {
        if (!profile.buyerAccessToRecordings) {
          return {
            data: [],
            meta: {
              page,
              limit,
              total: 0,
              totalPages: 0,
            },
          };
        }
        where.call.buyerId = profile.buyerId;
      } else if (profile.userRoles.includes('AGENT')) {
        // Fetch agent's phone numbers
        const fetchedNumbers = await prisma.phoneNumber.findMany({
          where: { tenantId, userId: (request as any).user?.userId },
          select: { number: true },
        });
        const userNumbers = fetchedNumbers.map(n => n.number);
        const numberFormats: string[] = [];
        for (const num of userNumbers) {
          numberFormats.push(num);
          if (num.startsWith('+1')) {
            numberFormats.push(num.substring(2));
            numberFormats.push(num.substring(1));
          } else if (num.startsWith('1') && num.length === 11) {
            numberFormats.push('+' + num);
            numberFormats.push(num.substring(1));
          } else if (num.length === 10) {
            numberFormats.push('+1' + num);
            numberFormats.push('1' + num);
          }
        }
        where.call.OR = [
          { createdById: (request as any).user?.userId },
          { fromNumber: { userId: (request as any).user?.userId } },
          { callerId: { in: numberFormats } },
          { toNumber: { in: numberFormats } },
          { did: { in: numberFormats } },
        ];
      } else {
        return {
          data: [],
          meta: {
            page,
            limit,
            total: 0,
            totalPages: 0,
          },
        };
      }
    }

    const [recordings, total] = await Promise.all([
      prisma.recording.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          call: {
            select: {
              id: true,
              callSid: true,
              fromNumber: { select: { number: true } },
              toNumber: true,
            },
          },
        },
      }),
      prisma.recording.count({ where }),
    ]);

    return {
      data: recordings.map(r => ({
        id: r.id,
        callId: r.callId,
        legId: r.legId,
        format: r.format,
        size: r.size?.toString(),
        duration: r.duration,
        status: r.status,
        storageTier: r.storageTier,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  });

  // Get recording details
  fastify.get<{ Params: { recordingId: string } }>(
    '/api/v1/recordings/:recordingId',
    async (request, reply) => {
      const tenantId = (request as any).user?.tenantId;
      if (!tenantId) {
        reply.code(401);
        return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
      }

      const recording = await prisma.recording.findFirst({
        where: {
          id: request.params.recordingId,
          call: { tenantId },
          deletedAt: null,
        },
        include: {
          call: true,
        },
      });

      if (!recording) {
        reply.code(404);
        return {
          error: {
            code: 'NOT_FOUND',
            message: 'Recording not found',
          },
        };
      }

      const profile = await getUserProfile(request);
      const isAllowed = await checkRecordingAccess(recording, profile, tenantId, (request as any).user?.userId);

      if (!isAllowed) {
        reply.code(403);
        return { error: { code: 'FORBIDDEN', message: 'Access denied to this recording' } };
      }

      return {
        id: recording.id,
        callId: recording.callId,
        legId: recording.legId,
        url: recording.url,
        storageKey: recording.storageKey,
        format: recording.format,
        size: recording.size?.toString(),
        checksum: recording.checksum,
        duration: recording.duration,
        status: recording.status,
        storageTier: recording.storageTier,
        metadata: recording.metadata,
        createdAt: recording.createdAt.toISOString(),
        updatedAt: recording.updatedAt.toISOString(),
      };
    }
  );

  // Get signed URL for playback
  fastify.get<{
    Params: { recordingId: string };
    Querystring: { expiresIn?: string };
  }>('/api/v1/recordings/:recordingId/url', async (request, reply) => {
    const tenantId = (request as any).user?.tenantId;
    if (!tenantId) {
      reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    try {
      const { recordingId } = request.params;

      const recording = await prisma.recording.findFirst({
        where: {
          id: recordingId,
          deletedAt: null,
          call: { tenantId },
        },
        include: {
          call: true,
        },
      });

      if (!recording) {
        reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Recording not found' } };
      }

      const profile = await getUserProfile(request);
      const isAllowed = await checkRecordingAccess(recording, profile, tenantId, (request as any).user?.userId);

      if (!isAllowed) {
        reply.code(403);
        return { error: { code: 'FORBIDDEN', message: 'Access denied to this recording' } };
      }

      const token = await (reply as any).jwtSign(
        {
          tenantId,
          userId: (request as any).user?.userId,
          email: (request as any).user?.email,
        },
        { expiresIn: '1h' }
      );

      const apiBaseUrl = getPublicApiBaseUrl(request);
      const playbackUrl = `${apiBaseUrl.replace(/\/$/, '')}/api/v1/recordings/${recordingId}/stream?token=${token}`;

      return {
        url: playbackUrl,
        expiresIn: 3600,
        expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
      };
    } catch (error) {
      reply.code(404);
      return {
        error: {
          code: 'NOT_FOUND',
          message: error instanceof Error ? error.message : 'Recording not found',
        },
      };
    }
  });

  // Stream recording
  fastify.get<{ Params: { recordingId: string } }>(
    '/api/v1/recordings/:recordingId/stream',
    async (request, reply) => {
      const tenantId = (request as any).user?.tenantId;
      if (!tenantId) {
        reply.code(401);
        return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
      }

      try {
        const { recordingId } = request.params;

        const recording = await prisma.recording.findFirst({
          where: {
            id: recordingId,
            deletedAt: null,
            call: { tenantId },
          },
          include: {
            call: true,
          },
        });

        if (!recording) {
          reply.code(404);
          return { error: { code: 'NOT_FOUND', message: 'Recording not found' } };
        }

        const profile = await getUserProfile(request);
        const isAllowed = await checkRecordingAccess(recording, profile, tenantId, (request as any).user?.userId);

        if (!isAllowed) {
          reply.code(403);
          return { error: { code: 'FORBIDDEN', message: 'Access denied to this recording' } };
        }

        const { stream, contentType, contentLength } = await recordingService.getRecordingStream(recordingId);
        
        void reply.type(contentType);
        if (contentLength !== undefined) {
          void reply.header('Content-Length', contentLength.toString());
        }
        return reply.send(stream);
      } catch (error) {
        reply.code(404);
        return {
          error: {
            code: 'NOT_FOUND',
            message: error instanceof Error ? error.message : 'Recording not found',
          },
        };
      }
    }
  );

  // Backfill metadata for a recording
  fastify.post<{ Params: { recordingId: string } }>(
    '/api/v1/recordings/:recordingId/backfill',
    async (request, reply) => {
      try {
        await recordingService.backfillMetadata(request.params.recordingId);
        return {
          success: true,
          message: 'Metadata backfilled successfully',
        };
      } catch (error) {
        reply.code(400);
        return {
          error: {
            code: 'BACKFILL_ERROR',
            message: error instanceof Error ? error.message : 'Failed to backfill metadata',
          },
        };
      }
    }
  );

  // Local stream for development / when S3 is disabled
  fastify.get(
    '/api/v1/recordings/local-stream/*',
    async (request, reply) => {
      const params = request.params as Record<string, string>;
      let storageKey = params['*'];
      if (!storageKey) {
        reply.code(400);
        return { error: { code: 'BAD_REQUEST', message: 'Missing storage key' } };
      }

      // Ensure storage key is fully URL-decoded (handling %2F, %20, etc.)
      try {
        storageKey = decodeURIComponent(storageKey);
      } catch {
        // ignore decoding errors
      }

      const fs = await import('fs');
      const path = await import('path');
      const localDir = process.env.LOCAL_STORAGE_DIR || '/tmp/uploads';
      const localFilePath = path.join(localDir, storageKey);

      // Verify directory traversal protection
      const resolvedPath = path.resolve(localFilePath);
      const resolvedDir = path.resolve(localDir);
      if (!resolvedPath.startsWith(resolvedDir)) {
        reply.code(403);
        return { error: { code: 'FORBIDDEN', message: 'Access forbidden: invalid storage key' } };
      }

      if (!fs.existsSync(resolvedPath)) {
        reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Local recording file not found' } };
      }

      const stream = fs.createReadStream(resolvedPath);
      void reply.type('audio/wav');
      return reply.send(stream);
    }
  );
}
