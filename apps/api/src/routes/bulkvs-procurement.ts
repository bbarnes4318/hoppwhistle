/**
 * BulkVS Number Procurement Routes
 *
 * Provides endpoints for:
 * - Browsing available numbers by Area Code
 * - Purchasing numbers with billing integration
 */

import { FastifyInstance, FastifyRequest } from 'fastify';

import { logger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';
import { AuthenticatedUser } from '../middleware/auth.js';
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
    const user = (request as AuthRequest).user;
    const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
    const tenantId = demoTenantId || user?.tenantId;

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
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
    Body: {
      areaCode: string;
      title?: string;
      destination?: string;
    };
  }>('/api/v1/bulkvs/purchase', async (request, reply) => {
    const user = (request as AuthRequest).user;
    const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
    const tenantId = demoTenantId || user?.tenantId;

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const { areaCode, title } = request.body;

    if (!areaCode) {
      void reply.code(400);
      return {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'areaCode is required',
        },
      };
    }

    const prisma = getPrismaClient();

    try {
      logger.info({
        msg: 'Purchasing DID from BulkVS',
        tenantId,
        userId: user?.userId,
        areaCode,
      });

      // 1. Purchase the number (ProvisioningService handles calling adapter and creating DB entry)
      const phoneNumber = await provisioningService.purchaseNumber(
        'bulkvs',
        { areaCode },
        {
          tenantId,
          userId: user?.userId,
          ipAddress: request.ip,
          requestId: request.id,
        }
      );

      // The provisioning service creates the PhoneNumber record

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
          }
        });
      }

      logger.info({
        msg: 'DID provisioned successfully from BulkVS',
        phoneNumberId: phoneNumber.id,
        number: phoneNumber.number,
        routeCreated: !!request.body.destination,
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
