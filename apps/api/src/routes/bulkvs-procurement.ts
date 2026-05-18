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

      // The provisioning service creates the PhoneNumber record, but we need to create billing
      
      // Step 2: Create billing record
      const setupPriceCents = 100; // Example: $1.00 setup
      const monthlyPriceCents = 150; // Example: $1.50 monthly
      const totalCents = setupPriceCents + monthlyPriceCents;
      const totalDollars = totalCents / 100;

      // Find or create billing account for tenant
      let billingAccount = await prisma.billingAccount.findFirst({
        where: { tenantId },
      });

      if (!billingAccount) {
        billingAccount = await prisma.billingAccount.create({
          data: {
            tenantId,
            name: 'Default Billing Account',
            currency: 'USD',
          },
        });
      }

      // Create invoice for this purchase
      const invoiceNumber = `INV-${Date.now()}-${phoneNumber.id.slice(0, 8)}`;
      const now = new Date();
      const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

      const invoice = await prisma.invoice.create({
        data: {
          billingAccountId: billingAccount.id,
          invoiceNumber,
          status: 'SENT', // Ready for payment
          periodStart: now,
          periodEnd: endOfMonth,
          subtotal: totalDollars,
          tax: 0,
          total: totalDollars,
          dueDate: endOfMonth,
          metadata: {
            phoneNumberId: phoneNumber.id,
            e164: phoneNumber.number,
            purchasedBy: user?.userId,
          },
          lines: {
            create: [
              {
                description: `New Number Provisioning: ${phoneNumber.number}`,
                quantity: 1,
                unitPrice: setupPriceCents / 100,
                total: setupPriceCents / 100,
                metadata: { type: 'setup_fee' },
              },
              {
                description: `Monthly Service: ${phoneNumber.number}`,
                quantity: 1,
                unitPrice: monthlyPriceCents / 100,
                total: monthlyPriceCents / 100,
                metadata: { type: 'monthly_fee', prorated: true },
              },
            ],
          },
        },
        include: {
          lines: true,
        },
      });

      // Update the phone number metadata with invoice details
      await prisma.phoneNumber.update({
        where: { id: phoneNumber.id },
        data: {
          metadata: {
            ...(phoneNumber.metadata as Record<string, unknown> || {}),
            invoiceId: invoice.id,
            totalCharged: totalDollars,
          }
        }
      });

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
        msg: 'DID purchased and provisioned successfully from BulkVS',
        phoneNumberId: phoneNumber.id,
        number: phoneNumber.number,
        invoiceId: invoice.id,
        totalCharged: totalDollars,
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
          billing: {
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            setupFee: setupPriceCents / 100,
            monthlyFee: monthlyPriceCents / 100,
            total: totalDollars,
            status: invoice.status,
            dueDate: invoice.dueDate.toISOString(),
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
