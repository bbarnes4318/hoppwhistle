import { FastifyInstance } from 'fastify';

import { getPrismaClient } from '../lib/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { RecordingService } from '../services/recording-service.js';
import { getStorageService } from '../services/storage.js';

const recordingService = new RecordingService();
const prisma = getPrismaClient();

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
    try {
      const { callId, legId, url, format, size, duration } = request.body;

      // If URL is provided, download and upload to S3
      if (url) {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to download recording from ${url}`);
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        const uploadResult = await recordingService.uploadRecording({
          callId,
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

      // If file is uploaded directly (multipart/form-data)
      const data = await request.file();
      if (!data) {
        reply.code(400);
        return {
          error: {
            code: 'MISSING_FILE',
            message: 'No file provided',
          },
        };
      }

      const buffer = await data.toBuffer();
      const uploadResult = await recordingService.uploadRecording({
        callId,
        legId,
        format: format || data.filename?.split('.').pop() || 'wav',
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
    } catch (error) {
      reply.code(400);
      return {
        error: {
          code: 'UPLOAD_ERROR',
          message: error instanceof Error ? error.message : 'Failed to upload recording',
        },
      };
    }
  });

  // List recordings
  fastify.get('/api/v1/recordings', async (request, reply) => {
    const tenantId = (request as any).user?.tenantId;
    if (!tenantId) {
      reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const { page = 1, limit = 20, callId, status } = request.query as {
      page?: number;
      limit?: number;
      callId?: string;
      status?: string;
    };

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
      data: recordings.map((r) => ({
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
          call: {
            select: {
              id: true,
              callSid: true,
              fromNumber: { select: { number: true } },
              toNumber: true,
            },
          },
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
      const expiresIn = parseInt(request.query.expiresIn || '3600', 10);
      const signedUrl = await recordingService.getSignedUrl(
        request.params.recordingId,
        expiresIn
      );

      return {
        url: signedUrl,
        expiresIn,
        expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
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

  // Stream recording (redirects to signed URL)
  fastify.get<{ Params: { recordingId: string } }>(
    '/api/v1/recordings/:recordingId/stream',
    async (request, reply) => {
      const tenantId = (request as any).user?.tenantId;
      if (!tenantId) {
        reply.code(401);
        return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
      }

      try {
        const streamUrl = await recordingService.getStreamUrl(request.params.recordingId);
        reply.redirect(302, streamUrl);
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
}

