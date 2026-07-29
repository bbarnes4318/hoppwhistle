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
import { getPrismaClient } from '../lib/prisma.js';
import { AuthenticatedUser } from '../middleware/auth.js';
import { provisioningService } from '../services/provisioning/provisioning-service.js';
import { resolveTenantId } from '../lib/tenant.js';

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
    const user = (request as AuthRequest).user;
    const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
    const tenantId = resolveTenantId(user, demoTenantId);

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
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
    Body: { areaCode?: string; number?: string; destination?: string; messagingEnabled?: boolean };
  }>('/api/v1/fractel/purchase', async (request, reply) => {
    const user = (request as AuthRequest).user;
    const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
    const tenantId = resolveTenantId(user, demoTenantId);

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const { areaCode, number, messagingEnabled } = request.body;

    if (!areaCode && !number) {
      void reply.code(400);
      return { error: { code: 'VALIDATION_ERROR', message: 'areaCode or number is required' } };
    }

    const prisma = getPrismaClient();

    try {
      logger.info({
        msg: 'Purchasing DID from FracTEL',
        tenantId,
        userId: user?.userId,
        areaCode,
        number,
      });

      const phoneNumber = await provisioningService.purchaseNumber(
        'fractel',
        { areaCode, number, features: { voice: true, sms: messagingEnabled ?? false } },
        { tenantId, userId: user?.userId, ipAddress: request.ip, requestId: request.id }
      );

      if (request.body.destination) {
        await prisma.didRoute.create({
          data: {
            tenantId,
            phoneNumberId: phoneNumber.id,
            did: phoneNumber.number,
            destination: request.body.destination,
            label: 'Auto-routed (Purchased)',
            status: 'ACTIVE',
            recordingEnabled: true,
          },
        });
      } else {
        const { didRouteService } = await import('../services/did-route-service.js');
        await didRouteService.syncDidRouteForNumber(phoneNumber.id, tenantId);
      }

      logger.info({
        msg: 'DID provisioned successfully from FracTEL',
        phoneNumberId: phoneNumber.id,
        number: phoneNumber.number,
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
