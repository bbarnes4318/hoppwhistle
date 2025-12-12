import { randomUUID } from 'crypto';

import { FastifyInstance } from 'fastify';

import { getStorageService } from '../services/storage.js';

/**
 * Helper to guess file extension from filename or content type
 */
function guessExt(filename: string, contentType: string): string {
  const lower = (filename || '').toLowerCase();
  if (lower.endsWith('.wav')) return 'wav';
  if (lower.endsWith('.mp3')) return 'mp3';
  if (lower.endsWith('.ogg')) return 'ogg';
  if (lower.endsWith('.opus')) return 'opus';
  if ((contentType || '').includes('wav')) return 'wav';
  if ((contentType || '').includes('mpeg') || (contentType || '').includes('mp3')) return 'mp3';
  if ((contentType || '').includes('ogg')) return 'ogg';
  if ((contentType || '').includes('opus')) return 'opus';
  return 'wav';
}

/**
 * Recording Analysis Upload routes - presigned URL generation for browser direct uploads
 */
export async function registerRecordingAnalysisUploadRoutes(fastify: FastifyInstance) {
  await Promise.resolve(); // ESLint requires await in async function

  /**
   * Generate presigned PUT URL for direct browser upload to S3
   */
  fastify.post<{
    Body: {
      filename: string;
      contentType?: string;
    };
  }>('/api/v1/recording-analysis/presign', async (request, reply) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
    const tenantId = (request as any).user?.tenantId as string | undefined;
    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const { filename, contentType } = request.body ?? {};

    if (!filename) {
      void reply.code(400);
      return { error: { code: 'VALIDATION_ERROR', message: 'filename is required' } };
    }

    const ext = guessExt(filename, contentType || '');
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    const random = randomUUID();
    const safeName = String(filename)
      .replace(/[^\w.-]+/g, '_')
      .slice(0, 80);

    const storageKey = `recording-analyzer/${year}/${month}/${day}/${tenantId}/${random}-${safeName}.${ext}`;

    const storage = getStorageService();
    const url = await storage.createPresignedPutUrl({
      storageKey,
      contentType: contentType || 'application/octet-stream',
      metadata: {
        tenantId,
        source: 'recording-analyzer',
        originalFilename: safeName,
      },
      expiresInSec: 900,
    });

    return { storageKey, url };
  });
}
