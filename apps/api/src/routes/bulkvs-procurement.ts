/**
 * BulkVS Number Procurement Routes
 *
 * Provides endpoints for:
 * - Browsing available numbers by Area Code
 * - Purchasing numbers with billing integration
 */

import { FastifyInstance, FastifyRequest } from 'fastify';

import { logger } from '../lib/logger.js';
import { getActingTenantId, sendTenantRefusal } from '../lib/tenant-context.js';
import { AuthenticatedUser } from '../middleware/auth.js';
import {
  NumberPurchaseError,
  purchaseNumberForTenant,
} from '../services/numbers/number-purchase.js';
import { provisioningService } from '../services/provisioning/provisioning-service.js';

type AuthRequest = FastifyRequest & { user?: AuthenticatedUser };

export async function registerBulkvsProcurementRoutes(fastify: FastifyInstance): Promise<void> {
  await Promise.resolve();

  // ==========================================================================
  // INVENTORY BROWSING
  // ==========================================================================

  /**
   * List available numbers by area code
   */
  fastify.get<{
    Querystring: { areaCode?: string };
  }>('/api/v1/bulkvs/available', async (request, reply) => {
    const tenantId = getActingTenantId(request);

    if (!tenantId) {
      return sendTenantRefusal(request, reply);
    }

    try {
      const areaCode = request.query.areaCode;

      const numbers = await provisioningService.listNumbers('bulkvs', { areaCode });

      return {
        data: numbers,
        meta: {
          areaCode,
          count: numbers.length,
        },
      };
    } catch (error) {
      logger.error({ msg: 'Failed to list BulkVS numbers', error });
      void reply.code(500);
      return {
        error: {
          code: 'BULKVS_ERROR',
          message: error instanceof Error ? error.message : 'Failed to fetch available numbers',
        },
      };
    }
  });

  // ==========================================================================
  // NUMBER PURCHASE WITH BILLING
  // ==========================================================================

  /**
   * Purchase a number from BulkVS inventory
   */
  fastify.post<{
    Body: { areaCode?: string; number?: string; campaignId?: string | null };
  }>('/api/v1/bulkvs/purchase', async (request, reply) => {
    const user = (request as AuthRequest).user;
    const tenantId = getActingTenantId(request);

    if (!tenantId) {
      return sendTenantRefusal(request, reply);
    }

    const { areaCode, number, campaignId } = request.body ?? {};

    if (!areaCode && !number) {
      void reply.code(400);
      return { error: { code: 'VALIDATION_ERROR', message: 'areaCode or number is required' } };
    }

    try {
      logger.info({
        msg: 'Purchasing DID from BulkVS',
        tenantId,
        userId: user?.userId,
        areaCode,
        number,
      });

      /*
       * Quota under a per-tenant lock, the carrier purchase, the PhoneNumber
       * row and its charges, in one transaction -- and the number released at
       * the carrier again if the write fails. The number is the agency's, not
       * the purchaser's, and is attached to `campaignId` (validated to this
       * tenant) or left unattached. See `services/numbers/number-purchase.ts`.
       */
      const phoneNumber = await purchaseNumberForTenant({
        provider: 'bulkvs',
        request: { areaCode, number },
        tenantId,
        campaignId: campaignId ?? null,
        actor: { userId: user?.userId, ipAddress: request.ip, requestId: request.id },
      });

      void reply.code(201);
      return {
        success: true,
        data: {
          phoneNumber: {
            id: phoneNumber.id,
            number: phoneNumber.number,
            provider: phoneNumber.provider,
            status: phoneNumber.status,
            purchasedAt: phoneNumber.purchasedAt?.toISOString(),
          },
        },
      };
    } catch (error) {
      if (error instanceof NumberPurchaseError) {
        void reply.code(error.status);
        return { error: { code: error.code, message: error.message, ...(error.detail ?? {}) } };
      }
      logger.error({
        msg: 'Failed to purchase BulkVS DID',
        tenantId,
        areaCode,
        error: error instanceof Error ? error.message : String(error),
      });
      void reply.code(400);
      return {
        error: {
          code: 'PURCHASE_FAILED',
          message: error instanceof Error ? error.message : 'Failed to purchase number',
        },
      };
    }
  });
}
