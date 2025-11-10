import { FastifyRequest, FastifyReply } from 'fastify';

import { logger } from '../lib/logger.js';
import { quotaService } from '../services/quota-service.js';

/**
 * Quota Middleware
 * 
 * Checks quotas before allowing call creation or other quota-limited operations.
 */
export function requireQuotaCheck(quotaType: 'concurrent_calls' | 'daily_minutes' | 'phone_numbers' | 'budget') {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const user = (request as any).user;
    if (!user || !user.tenantId) {
      reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const overrideToken = request.headers['x-quota-override'] as string | undefined;

    try {
      let result;

      switch (quotaType) {
        case 'concurrent_calls':
          result = await quotaService.checkConcurrentCalls(user.tenantId, overrideToken);
          break;

        case 'daily_minutes':
          const estimatedMinutes = (request.body as any)?.estimatedMinutes || 1;
          result = await quotaService.checkDailyMinutes(user.tenantId, estimatedMinutes, overrideToken);
          break;

        case 'phone_numbers':
          result = await quotaService.checkPhoneNumberQuota(user.tenantId, overrideToken);
          break;

        case 'budget':
          const estimatedCost = (request.body as any)?.estimatedCost || 0;
          result = await quotaService.checkBudget(user.tenantId, estimatedCost, overrideToken);
          break;

        default:
          reply.code(400);
          return { error: { code: 'INVALID_QUOTA_TYPE', message: 'Invalid quota type' } };
      }

      if (!result.allowed) {
        reply.code(403);
        return {
          error: {
            code: 'QUOTA_EXCEEDED',
            message: result.reason || 'Quota exceeded',
            current: result.current,
            limit: result.limit,
            remaining: result.remaining,
          },
        };
      }

      // Add quota info to request for downstream use
      (request as any).quotaCheck = result;
    } catch (error) {
      logger.error({ msg: 'Quota check failed', error, tenantId: user.tenantId });
      reply.code(500);
      return { error: { code: 'QUOTA_CHECK_FAILED', message: 'Failed to check quota' } };
    }
  };
}

