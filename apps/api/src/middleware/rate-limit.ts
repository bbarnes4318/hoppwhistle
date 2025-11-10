import { FastifyRequest, FastifyReply } from 'fastify';
import { getPrismaClient } from '../lib/prisma.js';
import { getRedisClient } from '../services/redis.js';
import { auditLog } from '../services/audit.js';

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  identifier: string; // API key ID or IP address
  type: 'api_key' | 'ip';
}

/**
 * Rate limiting using Redis for distributed systems
 */
export async function checkRateLimit(
  request: FastifyRequest,
  config: RateLimitConfig
): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
  const redis = getRedisClient();
  const windowStart = Math.floor(Date.now() / config.windowMs) * config.windowMs;
  const key = `rate_limit:${config.type}:${config.identifier}:${windowStart}`;

  try {
    // Get current count
    const count = await redis.incr(key);
    
    // Set expiration on first request
    if (count === 1) {
      await redis.expire(key, Math.ceil(config.windowMs / 1000));
    }

    const remaining = Math.max(0, config.maxRequests - count);
    const resetAt = new Date(windowStart + config.windowMs);

    return {
      allowed: count <= config.maxRequests,
      remaining,
      resetAt,
    };
  } catch (error) {
    // If Redis fails, allow the request but log the error
    console.error('Rate limit check failed:', error);
    return {
      allowed: true,
      remaining: config.maxRequests,
      resetAt: new Date(Date.now() + config.windowMs),
    };
  }
}

/**
 * Rate limit middleware factory
 */
export function rateLimit(options: {
  windowMs?: number;
  maxRequests?: number;
  skipOnSuccess?: boolean;
}) {
  const windowMs = options.windowMs || 60000; // Default: 1 minute
  const maxRequests = options.maxRequests || 100; // Default: 100 requests per minute

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = request.user;
    let identifier: string;
    let type: 'api_key' | 'ip';

    // Determine identifier
    if (user?.apiKeyId) {
      identifier = user.apiKeyId;
      type = 'api_key';
    } else {
      // Use IP address
      identifier = request.ip || 'unknown';
      type = 'ip';
    }

    // Check API key-specific rate limit if applicable
    if (user?.apiKeyId) {
      const prisma = getPrismaClient();
      const apiKey = await prisma.apiKey.findUnique({
        where: { id: user.apiKeyId },
      });

      if (apiKey?.rateLimit) {
        const result = await checkRateLimit(request, {
          windowMs,
          maxRequests: apiKey.rateLimit,
          identifier: user.apiKeyId,
          type: 'api_key',
        });

        if (!result.allowed) {
          await auditLog({
            tenantId: user.tenantId,
            apiKeyId: user.apiKeyId,
            action: 'rate_limit.exceeded',
            entityType: 'RateLimit',
            resource: request.url,
            method: request.method,
            ipAddress: request.ip,
            userAgent: request.headers['user-agent'],
            requestId: request.id,
            success: false,
            error: `Rate limit exceeded: ${apiKey.rateLimit} requests per ${windowMs}ms`,
          });

          reply.code(429).send({
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: 'Rate limit exceeded',
              retryAfter: Math.ceil((result.resetAt.getTime() - Date.now()) / 1000),
            },
          });
          return;
        }

        // Add rate limit headers
        reply.header('X-RateLimit-Limit', apiKey.rateLimit.toString());
        reply.header('X-RateLimit-Remaining', result.remaining.toString());
        reply.header('X-RateLimit-Reset', result.resetAt.toISOString());

        if (options.skipOnSuccess && result.allowed) {
          return;
        }
      }
    }

    // Check IP-based rate limit
    const ipResult = await checkRateLimit(request, {
      windowMs,
      maxRequests,
      identifier: request.ip || 'unknown',
      type: 'ip',
    });

    if (!ipResult.allowed) {
      await auditLog({
        tenantId: user?.tenantId || 'unknown',
        userId: user?.userId,
        apiKeyId: user?.apiKeyId,
        action: 'rate_limit.exceeded',
        entityType: 'RateLimit',
        resource: request.url,
        method: request.method,
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        requestId: request.id,
        success: false,
        error: `IP rate limit exceeded: ${maxRequests} requests per ${windowMs}ms`,
      });

      reply.code(429).send({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Rate limit exceeded',
          retryAfter: Math.ceil((ipResult.resetAt.getTime() - Date.now()) / 1000),
        },
      });
      return;
    }

    // Add rate limit headers
    reply.header('X-RateLimit-Limit', maxRequests.toString());
    reply.header('X-RateLimit-Remaining', ipResult.remaining.toString());
    reply.header('X-RateLimit-Reset', ipResult.resetAt.toISOString());
  };
}

