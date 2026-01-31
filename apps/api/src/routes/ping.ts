/**
 * RTB Ping Routes
 *
 * POST /api/v1/ping - Process a lead ping request and return bid
 *
 * Authentication: Publisher API Key (x-api-key header)
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import { logger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';
import { auctionService, PingPayload } from '../services/auction-service.js';

// ============================================================================
// Types
// ============================================================================

interface PingRequestBody {
  request_id?: string;
  vertical?: string;
  caller: {
    zip?: string;
    state?: string;
    age?: number;
    [key: string]: unknown;
  };
  source?: string;
  min_bid?: number;
}

// ============================================================================
// Route Registration
// ============================================================================

export async function registerPingRoutes(fastify: FastifyInstance): Promise<void> {
  const prisma = getPrismaClient();

  /**
   * POST /api/v1/ping
   *
   * Process a lead ping and run auction against eligible buyers.
   *
   * Headers:
   *   x-api-key: Publisher API key (required)
   *
   * Body:
   * {
   *   "request_id": "optional-uuid",       // For idempotency
   *   "vertical": "health_insurance",      // Optional vertical filter
   *   "caller": {
   *     "zip": "37901",
   *     "state": "TN",
   *     "age": 67
   *   },
   *   "source": "landing_page",
   *   "min_bid": 10.00                     // Optional minimum bid floor
   * }
   *
   * Success Response (200):
   * {
   *   "ping_id": "uuid",
   *   "bid": 45.00,
   *   "token": "eyJ...",
   *   "expires_at": "2026-01-31T21:15:00Z"
   * }
   *
   * No Match Response (200):
   * {
   *   "ping_id": "uuid",
   *   "bid": 0,
   *   "message": "No matching buyers"
   * }
   *
   * Error Response (401/400):
   * {
   *   "error": {
   *     "code": "UNAUTHORIZED",
   *     "message": "Invalid API key"
   *   }
   * }
   */
  fastify.post<{ Body: PingRequestBody }>(
    '/api/v1/ping',
    async (request: FastifyRequest<{ Body: PingRequestBody }>, reply: FastifyReply) => {
      const startTime = Date.now();

      try {
        // ================================================================
        // 1. Authenticate Publisher via API Key
        // ================================================================
        const apiKey = request.headers['x-api-key'] as string;

        if (!apiKey) {
          void reply.code(401);
          return {
            error: {
              code: 'UNAUTHORIZED',
              message: 'API key required (x-api-key header)',
            },
          };
        }

        // Hash the API key and look it up
        const crypto = await import('crypto');
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
          logger.warn({
            msg: 'Invalid API key for ping request',
            keyPrefix: apiKey.substring(0, 8),
          });
          void reply.code(401);
          return {
            error: {
              code: 'UNAUTHORIZED',
              message: 'Invalid or inactive API key',
            },
          };
        }

        // Check if API key has expired
        if (apiKeyRecord.expiresAt && apiKeyRecord.expiresAt < new Date()) {
          void reply.code(401);
          return {
            error: {
              code: 'UNAUTHORIZED',
              message: 'API key has expired',
            },
          };
        }

        // Get publisher ID from the key's tenant or from metadata
        const publisherId =
          (apiKeyRecord.metadata as { publisherId?: string })?.publisherId ||
          apiKeyRecord.tenant.publishers[0]?.id;

        if (!publisherId) {
          logger.warn({
            msg: 'No publisher associated with API key',
            tenantId: apiKeyRecord.tenantId,
          });
          void reply.code(400);
          return {
            error: {
              code: 'BAD_REQUEST',
              message: 'No publisher associated with this API key',
            },
          };
        }

        // Update lastUsedAt
        await prisma.apiKey
          .update({
            where: { id: apiKeyRecord.id },
            data: { lastUsedAt: new Date() },
          })
          .catch(() => {}); // Non-blocking

        // ================================================================
        // 2. Validate Request Body
        // ================================================================
        const body = request.body;

        if (!body || !body.caller) {
          void reply.code(400);
          return {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Request body must include "caller" object',
            },
          };
        }

        // ================================================================
        // 3. Process Ping through Auction Service
        // ================================================================
        const payload: PingPayload = {
          request_id: body.request_id,
          vertical: body.vertical,
          caller: body.caller,
          source: body.source,
          min_bid: body.min_bid,
        };

        const result = await auctionService.processPing(publisherId, payload);

        // Log latency for performance monitoring
        const latency = Date.now() - startTime;
        logger.info({
          msg: 'Ping request processed',
          pingId: result.ping_id,
          bid: result.bid,
          latencyMs: latency,
          publisherId,
        });

        // ================================================================
        // 4. Return Response
        // ================================================================
        return result;
      } catch (error) {
        const latency = Date.now() - startTime;
        logger.error({
          msg: 'Error processing ping request',
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          latencyMs: latency,
        });

        void reply.code(500);
        return {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to process ping request',
          },
        };
      }
    }
  );

  /**
   * POST /api/v1/ping/verify
   *
   * Verify a bid token (for debugging/testing)
   *
   * Body:
   * {
   *   "token": "eyJ..."
   * }
   */
  fastify.post<{ Body: { token: string } }>(
    '/api/v1/ping/verify',
    async (request: FastifyRequest<{ Body: { token: string } }>, reply: FastifyReply) => {
      const { token } = request.body;

      if (!token) {
        void reply.code(400);
        return {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Token is required',
          },
        };
      }

      const result = await auctionService.verifyBidToken(token);

      if (!result.valid) {
        void reply.code(400);
        return {
          valid: false,
          error: result.error,
        };
      }

      return {
        valid: true,
        ping_id: result.pingId,
        bid_amount: result.bidAmount,
        buyer_id: result.buyerId,
      };
    }
  );
}
