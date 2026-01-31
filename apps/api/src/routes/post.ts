/**
 * RTB Post API Routes
 *
 * Handles POST endpoint for accepting winning bids and leasing numbers.
 * Also includes internal endpoint for number pool management.
 */

import crypto from 'crypto';

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import { logger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';
import { numberPoolService } from '../services/number-pool-service.js';
import { postService } from '../services/post-service.js';

// ============================================================================
// Types
// ============================================================================

interface PostRequestBody {
  token: string;
  caller_number?: string;
}

// ============================================================================
// Route Registration
// ============================================================================

export async function registerPostRoutes(fastify: FastifyInstance): Promise<void> {
  const prisma = getPrismaClient();

  /**
   * POST /api/v1/post
   * Accept a winning bid and lease a transfer number
   */
  fastify.post<{ Body: PostRequestBody }>(
    '/api/v1/post',
    async (request: FastifyRequest<{ Body: PostRequestBody }>, reply: FastifyReply) => {
      const startTime = Date.now();

      try {
        // 1. Authenticate Publisher via API Key
        const apiKey = request.headers['x-api-key'] as string;

        if (!apiKey) {
          void reply.code(401);
          return {
            error: { code: 'UNAUTHORIZED', message: 'API key required (x-api-key header)' },
          };
        }

        // Hash the API key and look it up
        const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

        const apiKeyRecord = await prisma.apiKey.findFirst({
          where: {
            keyHash,
            status: 'ACTIVE',
          },
          include: {
            tenant: {
              include: {
                publishers: {
                  where: { status: 'ACTIVE' },
                  take: 1,
                },
              },
            },
          },
        });

        if (!apiKeyRecord) {
          void reply.code(401);
          return { error: { code: 'UNAUTHORIZED', message: 'Invalid API key' } };
        }

        // Check expiration
        if (apiKeyRecord.expiresAt && apiKeyRecord.expiresAt < new Date()) {
          void reply.code(401);
          return { error: { code: 'UNAUTHORIZED', message: 'API key expired' } };
        }

        // Get publisher ID from the key's tenant or from metadata
        const publisherId =
          (apiKeyRecord.metadata as { publisherId?: string })?.publisherId ||
          apiKeyRecord.tenant.publishers[0]?.id;

        if (!publisherId) {
          void reply.code(400);
          return {
            error: { code: 'BAD_REQUEST', message: 'No publisher associated with this API key' },
          };
        }

        // Update last used (non-blocking)
        await prisma.apiKey
          .update({
            where: { id: apiKeyRecord.id },
            data: { lastUsedAt: new Date() },
          })
          .catch(() => {});

        // 2. Validate Request Body
        const body = request.body;

        if (!body?.token) {
          void reply.code(400);
          return { error: 'Bad Request', message: 'Token is required', statusCode: 400 };
        }

        // 3. Process POST through PostService
        const result = await postService.processPost(body.token, body.caller_number);

        // Log latency
        const latencyMs = Date.now() - startTime;
        logger.info({
          msg: 'POST request completed',
          publisherId,
          latencyMs,
          accepted: result.accepted,
          errorCode: result.error_code,
        });

        // 4. Return Response
        if (!result.accepted) {
          if (result.error_code === 'NO_CAPACITY') {
            void reply.code(503);
          } else if (
            result.error_code === 'INVALID_TOKEN' ||
            result.error_code === 'PING_NOT_FOUND'
          ) {
            void reply.code(400);
          } else {
            void reply.code(422);
          }
        }

        return result;
      } catch (error) {
        logger.error({ msg: 'POST request failed', error });
        void reply.code(500);
        return {
          status: 'error',
          accepted: false,
          error_code: 'INTERNAL_ERROR',
          message: 'Internal server error',
        };
      }
    }
  );

  /**
   * POST /internal/reclaim-numbers
   * Trigger the reaper to reclaim expired number leases
   * Called by external cron or internal scheduler
   */
  fastify.post(
    '/internal/reclaim-numbers',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // Simple internal auth - check for internal header or localhost
        const internalKey = request.headers['x-internal-key'] as string;
        const expectedKey = process.env.INTERNAL_API_KEY || 'internal-reclaim-key';

        // Allow localhost without auth for cron jobs on same server
        const isLocalhost =
          request.ip === '127.0.0.1' || request.ip === '::1' || request.ip === '::ffff:127.0.0.1';

        if (!isLocalhost && internalKey !== expectedKey) {
          void reply.code(401);
          return { error: 'Unauthorized' };
        }

        const result = await numberPoolService.reclaimExpiredLeases();

        logger.info({ msg: 'Reaper job completed', reclaimed: result.reclaimed });

        return {
          status: 'success',
          reclaimed: result.reclaimed,
          timestamp: new Date().toISOString(),
        };
      } catch (error) {
        logger.error({ msg: 'Reaper job failed', error });
        void reply.code(500);
        return { error: 'Internal server error' };
      }
    }
  );

  /**
   * GET /internal/pool-stats
   * Get number pool statistics
   */
  fastify.get('/internal/pool-stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const internalKey = request.headers['x-internal-key'] as string;
      const expectedKey = process.env.INTERNAL_API_KEY || 'internal-reclaim-key';

      const isLocalhost =
        request.ip === '127.0.0.1' || request.ip === '::1' || request.ip === '::ffff:127.0.0.1';

      if (!isLocalhost && internalKey !== expectedKey) {
        void reply.code(401);
        return { error: 'Unauthorized' };
      }

      const stats = await numberPoolService.getPoolStats();

      return {
        status: 'success',
        pool: stats,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      logger.error({ msg: 'Pool stats failed', error });
      void reply.code(500);
      return { error: 'Internal server error' };
    }
  });

  /**
   * GET /internal/route/:e164
   * Get routing info for a DID (used by telephony engine)
   */
  fastify.get<{ Params: { e164: string } }>(
    '/internal/route/:e164',
    async (request: FastifyRequest<{ Params: { e164: string } }>, reply: FastifyReply) => {
      try {
        const { e164 } = request.params;

        const routeInfo = await numberPoolService.getRouteInfo(e164);

        if (!routeInfo) {
          void reply.code(404);
          return { error: 'Route not found', e164 };
        }

        return {
          status: 'success',
          route: routeInfo,
        };
      } catch (error) {
        logger.error({ msg: 'Route lookup failed', error });
        void reply.code(500);
        return { error: 'Internal server error' };
      }
    }
  );
}
