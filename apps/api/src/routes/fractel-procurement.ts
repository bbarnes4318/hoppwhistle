/**
 * FracTEL / FoneStorm Number Procurement Routes
 *
 * Endpoints for the Numbers page:
 * - Search available local numbers by area code
 * - Search available toll-free numbers
 * - Purchase a number (creates the PhoneNumber record + DID route)
 */

import { FastifyInstance, FastifyRequest } from 'fastify';

import { logger } from '../lib/logger.js';
import { getActingTenantId, sendTenantRefusal } from '../lib/tenant-context.js';
import { AuthenticatedUser } from '../middleware/auth.js';
import { assertCarrierEnabled } from '../services/numbers/number-carriers.js';
import {
  NumberPurchaseError,
  purchaseNumberForTenant,
} from '../services/numbers/number-purchase.js';
import { provisioningService } from '../services/provisioning/provisioning-service.js';

type AuthRequest = FastifyRequest & { user?: AuthenticatedUser };

export async function registerFractelProcurementRoutes(fastify: FastifyInstance): Promise<void> {
  await Promise.resolve();

  // ==========================================================================
  // INVENTORY BROWSING (local + toll-free)
  // ==========================================================================

  /**
   * List available numbers.
   *   /api/v1/fractel/available?areaCode=608          → local
   *   /api/v1/fractel/available?type=tollfree          → toll-free (all prefixes)
   *   /api/v1/fractel/available?type=tollfree&areaCode=888 → toll-free (specific prefix)
   */
  fastify.get<{
    Querystring: { areaCode?: string; type?: string };
  }>('/api/v1/fractel/available', async (request, reply) => {
    const tenantId = getActingTenantId(request);

    if (!tenantId) {
      return sendTenantRefusal(request, reply);
    }

    // A carrier the platform has switched off is not searched either: its
    // inventory could not be bought.
    try {
      await assertCarrierEnabled('fractel');
    } catch (error) {
      if (error instanceof NumberPurchaseError) {
        void reply.code(error.status);
        return { error: { code: error.code, message: error.message } };
      }
      throw error;
    }

    const numberType = request.query.type === 'tollfree' ? 'tollfree' : 'local';

    try {
      const numbers = await provisioningService.listNumbers('fractel', {
        areaCode: request.query.areaCode,
        numberType,
      });

      return {
        data: numbers,
        meta: { areaCode: request.query.areaCode, type: numberType, count: numbers.length },
      };
    } catch (error) {
      logger.error({ msg: 'Failed to list FracTEL numbers', error });
      void reply.code(500);
      return {
        error: {
          code: 'FRACTEL_ERROR',
          message: error instanceof Error ? error.message : 'Failed to fetch available numbers',
        },
      };
    }
  });

  // ==========================================================================
  // NUMBER PURCHASE
  // ==========================================================================

  /**
   * Purchase a number from FracTEL / FoneStorm inventory.
   */
  fastify.post<{
    Body: {
      areaCode?: string;
      number?: string;
      campaignId?: string | null;
      messagingEnabled?: boolean;
    };
  }>('/api/v1/fractel/purchase', async (request, reply) => {
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
        msg: 'Purchasing DID from FracTEL',
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
      // Refused when the platform has switched FracTEL off on Settings ->
      // Number carriers; see services/numbers/number-carriers.ts.
      await assertCarrierEnabled('fractel');

      const phoneNumber = await purchaseNumberForTenant({
        provider: 'fractel',
        request: {
          areaCode,
          number,
          features: { voice: true, sms: request.body?.messagingEnabled ?? false },
        },
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
        msg: 'Failed to purchase FracTEL DID',
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
