import { randomUUID } from 'crypto';

import { FastifyInstance } from 'fastify';

import { getPrismaClient } from '../lib/prisma.js';
import { getRedisClient } from '../services/redis.js';
import { getStorageService } from '../services/storage.js';

const prisma = getPrismaClient();

type UploadRef = { storageKey: string; filename?: string };

/**
 * Recording Analysis routes for the Recording Analyzer tool
 */
export async function registerRecordingAnalysisRoutes(fastify: FastifyInstance) {
  await Promise.resolve(); // ESLint requires await in async function

  /**
   * Create analysis jobs and trigger transcription pipeline
   */
  fastify.post<{
    Body: {
      vertical: string;
      selectedFields: string[];
      urls?: string[];
      uploads?: UploadRef[];
    };
  }>('/api/v1/recording-analysis/analyze', async (request, reply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const tenantId = (request as any).user?.tenantId as string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const userId = (request as any).user?.userId as string | undefined;
    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const { vertical, selectedFields, urls = [], uploads = [] } = request.body ?? {};

    if (!vertical) {
      void reply.code(400);
      return { error: { code: 'VALIDATION_ERROR', message: 'vertical is required' } };
    }

    if (!Array.isArray(selectedFields)) {
      void reply.code(400);
      return { error: { code: 'VALIDATION_ERROR', message: 'selectedFields must be an array' } };
    }

    const redis = getRedisClient();
    const storage = getStorageService();
    const batchId = randomUUID();
    const jobIds: string[] = [];

    // URL jobs
    for (const url of urls) {
      if (!url || typeof url !== 'string') continue;

      const row = await prisma.recordingAnalysis.create({
        data: {
          tenantId,
          userId: userId || '',
          batchId,
          vertical,
          selectedFields,
          sourceType: 'url',
          sourceUrl: url,
          status: 'queued',
        },
        select: { id: true },
      });

      jobIds.push(row.id);

      await redis.xadd(
        'events:stream',
        '*',
        'channel',
        'recording.*',
        'payload',
        JSON.stringify({
          event: 'recording.ready',
          tenantId,
          data: { callId: row.id, recordingUrl: url, durationSec: 0 },
        })
      );

      await prisma.recordingAnalysis.update({
        where: { id: row.id },
        data: { status: 'transcribing' },
      });
    }

    // Upload jobs
    for (const up of uploads) {
      if (!up?.storageKey) continue;

      const signedUrl = await storage.getSignedUrl(up.storageKey, 86400);

      const row = await prisma.recordingAnalysis.create({
        data: {
          tenantId,
          userId: userId || '',
          batchId,
          vertical,
          selectedFields,
          sourceType: 'upload',
          storageKey: up.storageKey,
          filename: up.filename ?? null,
          status: 'queued',
        },
        select: { id: true },
      });

      jobIds.push(row.id);

      await redis.xadd(
        'events:stream',
        '*',
        'channel',
        'recording.*',
        'payload',
        JSON.stringify({
          event: 'recording.ready',
          tenantId,
          data: { callId: row.id, recordingUrl: signedUrl, durationSec: 0 },
        })
      );

      await prisma.recordingAnalysis.update({
        where: { id: row.id },
        data: { status: 'transcribing' },
      });
    }

    void reply.code(201);
    return { batchId, jobIds };
  });

  /**
   * Get batch status and results
   */
  fastify.get<{
    Params: { batchId: string };
  }>('/api/v1/recording-analysis/batch/:batchId', async (request, reply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const tenantId = (request as any).user?.tenantId as string | undefined;
    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const batchId = request.params.batchId;

    const items = await prisma.recordingAnalysis.findMany({
      where: { tenantId, batchId },
      orderBy: { createdAt: 'asc' },
    });

    return { batchId, items };
  });

  /**
   * Get single analysis result
   */
  fastify.get<{
    Params: { id: string };
  }>('/api/v1/recording-analysis/:id', async (request, reply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const tenantId = (request as any).user?.tenantId as string | undefined;
    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const id = request.params.id;

    const item = await prisma.recordingAnalysis.findFirst({
      where: { tenantId, id },
    });

    if (!item) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Analysis not found' } };
    }

    return item;
  });

  /**
   * List all analyses for tenant (paginated)
   */
  fastify.get<{
    Querystring: { page?: string; limit?: string; status?: string };
  }>('/api/v1/recording-analysis', async (request, reply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const tenantId = (request as any).user?.tenantId as string | undefined;
    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const page = parseInt(request.query.page || '1');
    const limit = parseInt(request.query.limit || '20');
    const skip = (page - 1) * limit;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: Record<string, any> = { tenantId };
    if (request.query.status) {
      where.status = request.query.status;
    }

    const [items, total] = await Promise.all([
      prisma.recordingAnalysis.findMany({
        where,
        take: limit,
        skip,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.recordingAnalysis.count({ where }),
    ]);

    return {
      data: items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  });

  /**
   * Re-run analysis with different fields
   */
  fastify.post<{
    Params: { id: string };
    Body: { selectedFields: string[] };
  }>('/api/v1/recording-analysis/:id/rerun', async (request, reply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const tenantId = (request as any).user?.tenantId as string | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const userId = (request as any).user?.userId as string | undefined;
    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const { id } = request.params;
    const { selectedFields } = request.body ?? {};

    if (!Array.isArray(selectedFields) || selectedFields.length === 0) {
      void reply.code(400);
      return {
        error: { code: 'VALIDATION_ERROR', message: 'selectedFields must be a non-empty array' },
      };
    }

    // Find original analysis
    const original = await prisma.recordingAnalysis.findFirst({
      where: { id, tenantId },
    });

    if (!original) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Analysis not found' } };
    }

    const redis = getRedisClient();
    const storage = getStorageService();
    const batchId = randomUUID();
    const jobIds: string[] = [];

    // Create new job with same source but different fields
    const row = await prisma.recordingAnalysis.create({
      data: {
        tenantId,
        userId: userId || '',
        batchId,
        vertical: original.vertical,
        selectedFields,
        sourceType: original.sourceType,
        sourceUrl: original.sourceUrl,
        storageKey: original.storageKey,
        filename: original.filename,
        status: 'queued',
      },
      select: { id: true },
    });

    jobIds.push(row.id);

    // Get recording URL
    let recordingUrl = original.sourceUrl;
    if (original.sourceType === 'upload' && original.storageKey) {
      recordingUrl = await storage.getSignedUrl(original.storageKey, 86400);
    }

    if (recordingUrl) {
      await redis.xadd(
        'events:stream',
        '*',
        'channel',
        'recording.*',
        'payload',
        JSON.stringify({
          event: 'recording.ready',
          tenantId,
          data: { callId: row.id, recordingUrl, durationSec: 0 },
        })
      );

      await prisma.recordingAnalysis.update({
        where: { id: row.id },
        data: { status: 'transcribing' },
      });
    }

    void reply.code(201);
    return { batchId, jobIds };
  });

  /**
   * Export batch as CSV
   */
  fastify.get<{
    Params: { batchId: string };
  }>('/api/v1/recording-analysis/batch/:batchId/csv', async (request, reply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const tenantId = (request as any).user?.tenantId as string | undefined;
    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const batchId = request.params.batchId;

    const items = await prisma.recordingAnalysis.findMany({
      where: { tenantId, batchId },
      orderBy: { createdAt: 'asc' },
    });

    if (items.length === 0) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Batch not found' } };
    }

    // Build CSV
    const allFields = new Set<string>();
    items.forEach(item => {
      if (item.extracted && typeof item.extracted === 'object') {
        Object.keys(item.extracted as object).forEach(k => allFields.add(k));
      }
    });

    const headers = [
      'id',
      'status',
      'sourceType',
      'sourceUrl',
      'filename',
      'vertical',
      ...Array.from(allFields),
    ];
    const rows = items.map(item => {
      const extracted = (item.extracted || {}) as Record<string, unknown>;
      return [
        item.id,
        item.status,
        item.sourceType,
        item.sourceUrl || '',
        item.filename || '',
        item.vertical,
        ...Array.from(allFields).map(f => {
          const val = extracted[f];
          if (val === null || val === undefined) return '';
          if (typeof val === 'object') return JSON.stringify(val);
          return String(val);
        }),
      ];
    });

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    void reply.header('Content-Type', 'text/csv');
    void reply.header('Content-Disposition', `attachment; filename="batch-${batchId}.csv"`);
    return csvContent;
  });
}
