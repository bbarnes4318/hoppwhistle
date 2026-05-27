import { FastifyInstance } from 'fastify';

import { getPrismaClient } from '../lib/prisma.js';
import { RecordingService } from '../services/recording-service.js';

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
      const { callId, legId, url, format, duration } = request.body || {};

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

      let fileBuffer: Buffer | null = null;
      let resolvedCallId: string | undefined = callId;
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

      if (!fileBuffer) {
        reply.code(400);
        return {
          error: {
            code: 'MISSING_FILE',
            message: 'No file provided',
          },
        };
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
      const signedUrl = await recordingService.getSignedUrl(request.params.recordingId, expiresIn);

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
      try {
        const streamUrl = await recordingService.getStreamUrl(request.params.recordingId);
        reply.redirect(302, streamUrl);
        return;
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
      const storageKey = params['*'];
      if (!storageKey) {
        reply.code(400);
        return { error: { code: 'BAD_REQUEST', message: 'Missing storage key' } };
      }

      const fs = await import('fs');
      const path = await import('path');
      const localDir = process.env.LOCAL_STORAGE_DIR || '/tmp/uploads';
      const localFilePath = path.join(localDir, storageKey);

      if (!fs.existsSync(localFilePath)) {
        reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Local recording file not found' } };
      }

      const stream = fs.createReadStream(localFilePath);
      void reply.type('audio/wav');
      return reply.send(stream);
    }
  );
}
