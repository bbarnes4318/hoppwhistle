/**
 * Anveo Number Procurement Routes
 *
 * Provides endpoints for:
 * - Browsing inventory (countries, states, areas with pricing)
 * - Purchasing numbers with billing integration
 * - Number provisioning and routing configuration
 */

import { FastifyInstance, FastifyRequest } from 'fastify';

import { logger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';
import { AuthenticatedUser } from '../middleware/auth.js';
import { getAnveoDIDService } from '../services/provisioning/anveo-did-service.js';
import { getActingTenantId } from '../lib/tenant-context.js';

type AuthRequest = FastifyRequest & { user?: AuthenticatedUser };

export async function registerAnveoProcurementRoutes(fastify: FastifyInstance): Promise<void> {
  await Promise.resolve();

  // ==========================================================================
  // INVENTORY BROWSING
  // ==========================================================================

  /**
   * List available countries for DID purchase
   */
  fastify.get<{
    Querystring: { didType?: string };
  }>('/api/v1/anveo/countries', async (request, reply) => {
    const tenantId = getActingTenantId(request);

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    try {
      const service = getAnveoDIDService();
      const didType = request.query.didType || 'GEOGRAPHIC';
      const countries = await service.listCountries(didType);

      return {
        data: countries,
        meta: {
          didType,
          count: countries.length,
        },
      };
    } catch (error) {
      logger.error({ msg: 'Failed to list Anveo countries', error });
      void reply.code(500);
      return {
        error: {
          code: 'ANVEO_ERROR',
          message: error instanceof Error ? error.message : 'Failed to fetch countries',
        },
      };
    }
  });

  /**
   * List states for a country
   */
  fastify.get<{
    Params: { countryId: string };
    Querystring: { didType?: string };
  }>('/api/v1/anveo/countries/:countryId/states', async (request, reply) => {
    const tenantId = getActingTenantId(request);

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    try {
      const service = getAnveoDIDService();
      const { countryId } = request.params;
      const didType = request.query.didType || 'GEOGRAPHIC';
      const states = await service.listStates(countryId, didType);

      return {
        data: states,
        meta: {
          countryId,
          didType,
          count: states.length,
        },
      };
    } catch (error) {
      logger.error({ msg: 'Failed to list Anveo states', error });
      void reply.code(500);
      return {
        error: {
          code: 'ANVEO_ERROR',
          message: error instanceof Error ? error.message : 'Failed to fetch states',
        },
      };
    }
  });

  /**
   * List area codes with availability and pricing
   */
  fastify.get<{
    Querystring: {
      didType?: string;
      countryId?: string;
      stateId?: string;
    };
  }>('/api/v1/anveo/areas', async (request, reply) => {
    const tenantId = getActingTenantId(request);

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    try {
      const service = getAnveoDIDService();
      const areas = await service.listAreas({
        didType: request.query.didType || 'GEOGRAPHIC',
        countryId: request.query.countryId,
        stateId: request.query.stateId,
      });

      return {
        data: areas,
        meta: {
          count: areas.length,
          totalStock: areas.reduce((sum, a) => sum + a.stock, 0),
        },
      };
    } catch (error) {
      logger.error({ msg: 'Failed to list Anveo areas', error });
      void reply.code(500);
      return {
        error: {
          code: 'ANVEO_ERROR',
          message: error instanceof Error ? error.message : 'Failed to fetch areas',
        },
      };
    }
  });

  // ==========================================================================
  // NUMBER PURCHASE WITH BILLING
  // ==========================================================================

  /**
   * Purchase a number from Anveo inventory
   *
   * This implements the atomic purchase flow:
   * 1. Order DID from Anveo
   * 2. Save to PhoneNumber table with tenant/user ownership
   * 3. Create billing transaction/invoice line
   * 4. Configure routing to FreeSWITCH
   */
  fastify.post<{
    Body: {
      areaId: string;
      ratePlanId: string;
      didType?: 'GEOGRAPHIC' | 'NATIONAL' | 'TOLLFREE' | 'MOBILE';
      title?: string;
    };
  }>('/api/v1/anveo/purchase', async (request, reply) => {
    const user = (request as AuthRequest).user;
    const tenantId = getActingTenantId(request);

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const { areaId, ratePlanId, didType = 'GEOGRAPHIC', title } = request.body;

    if (!areaId || !ratePlanId) {
      void reply.code(400);
      return {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'areaId and ratePlanId are required',
        },
      };
    }

    const prisma = getPrismaClient();
    const service = getAnveoDIDService();

    try {
      // Step 1: Order the DID from Anveo
      logger.info({
        msg: 'Purchasing DID from Anveo',
        tenantId,
        userId: user?.userId,
        areaId,
        ratePlanId,
      });

      const orderedDids = await service.orderDid({
        didType,
        areaId,
        ratePlanId,
        quantity: 1,
        title: title || `HopWhistle-${tenantId.slice(0, 8)}`,
      });

      if (orderedDids.length === 0) {
        throw new Error('No DID returned from Anveo order');
      }

      const anveoDid = orderedDids[0];

      // Step 2: Configure routing to FreeSWITCH
      const smsWebhookUrl = `https://hopwhistle.com/api/v1/webhooks/sms/${anveoDid.e164}`;
      await service.configureForFreeSWITCH(anveoDid.e164, smsWebhookUrl);

      // Step 3: Save to database with STRICT ownership
      const phoneNumber = await prisma.phoneNumber.create({
        data: {
          tenantId, // CRITICAL: Links number to tenant
          number: `+${anveoDid.e164}`,
          provider: 'anveo',
          status: 'ACTIVE',
          capabilities: {
            voice: true,
            sms: anveoDid.smsUrl ? true : false,
          },
          purchasedAt: new Date(),
          metadata: {
            anveoDid: anveoDid.e164,
            areaId,
            ratePlanId,
            areaCode: anveoDid.areaCode,
            areaName: anveoDid.areaName,
            countryName: anveoDid.countryName,
            monthly100: anveoDid.monthly100,
            userId: user?.userId, // Track who purchased
          },
        },
      });

      // Step 4: Create billing record
      // Convert cents to dollars: monthly100 and setup are in cents
      const setupPriceCents = 249; // Default setup fee in cents
      const monthlyPriceCents = anveoDid.monthly100 || 149;
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
            e164: anveoDid.e164,
            purchasedBy: user?.userId,
          },
          lines: {
            create: [
              {
                description: `New Number Provisioning: +${anveoDid.e164}`,
                quantity: 1,
                unitPrice: setupPriceCents / 100,
                total: setupPriceCents / 100,
                metadata: { type: 'setup_fee' },
              },
              {
                description: `Monthly Service: +${anveoDid.e164} (${anveoDid.areaCode})`,
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

      // Audit log
      const { auditCreate } = await import('../services/audit.js');
      await auditCreate(
        tenantId,
        'PhoneNumber',
        phoneNumber.id,
        {
          number: phoneNumber.number,
          provider: 'anveo',
          anveoDid: anveoDid.e164,
          invoiceId: invoice.id,
          totalCharged: totalDollars,
        },
        {
          userId: user?.userId,
          ipAddress: request.ip,
          requestId: request.id,
        }
      );

      logger.info({
        msg: 'DID purchased and provisioned successfully',
        phoneNumberId: phoneNumber.id,
        e164: anveoDid.e164,
        invoiceId: invoice.id,
        totalCharged: totalDollars,
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
            areaCode: anveoDid.areaCode,
            areaName: anveoDid.areaName,
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
          routing: {
            configured: true,
            sipUri: `$[E164]$@${process.env.PUBLIC_IP}:5080`,
            smsWebhookUrl,
          },
        },
      };
    } catch (error) {
      logger.error({
        msg: 'Failed to purchase DID',
        tenantId,
        areaId,
        ratePlanId,
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

  // ==========================================================================
  // USER'S NUMBERS (Isolated by tenant)
  // ==========================================================================

  /**
   * Get current user's purchased numbers
   * SECURITY: Always filters by tenantId
   */
  fastify.get<{
    Querystring: { page?: string; limit?: string };
  }>('/api/v1/anveo/my-numbers', async (request, reply) => {
    const tenantId = getActingTenantId(request);

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    try {
      const prisma = getPrismaClient();
      const page = parseInt(request.query.page || '1');
      const limit = parseInt(request.query.limit || '20');
      const skip = (page - 1) * limit;

      // SECURITY: Always filter by tenantId
      const [numbers, total] = await Promise.all([
        prisma.phoneNumber.findMany({
          where: {
            tenantId, // STRICT isolation
            provider: 'anveo',
          },
          take: limit,
          skip,
          orderBy: { createdAt: 'desc' },
          include: {
            campaign: { select: { id: true, name: true } },
          },
        }),
        prisma.phoneNumber.count({
          where: {
            tenantId,
            provider: 'anveo',
          },
        }),
      ]);

      return {
        data: numbers.map(n => ({
          id: n.id,
          number: n.number,
          status: n.status,
          provider: n.provider,
          areaCode: (n.metadata as Record<string, unknown>)?.areaCode,
          areaName: (n.metadata as Record<string, unknown>)?.areaName,
          monthlyPrice:
            (((n.metadata as Record<string, unknown>)?.monthly100 as number) || 149) / 100,
          campaign: n.campaign,
          purchasedAt: n.purchasedAt?.toISOString(),
          createdAt: n.createdAt.toISOString(),
        })),
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error({ msg: 'Failed to fetch user numbers', error });
      void reply.code(500);
      return {
        error: {
          code: 'FETCH_FAILED',
          message: 'Failed to fetch numbers',
        },
      };
    }
  });

  /**
   * Release/cancel a purchased number
   */
  fastify.delete<{
    Params: { numberId: string };
  }>('/api/v1/anveo/numbers/:numberId', async (request, reply) => {
    const user = (request as AuthRequest).user;
    const tenantId = getActingTenantId(request);

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const { numberId } = request.params;
    const prisma = getPrismaClient();

    try {
      // SECURITY: Verify ownership before canceling
      const phoneNumber = await prisma.phoneNumber.findFirst({
        where: {
          id: numberId,
          tenantId, // STRICT ownership check
          provider: 'anveo',
        },
      });

      if (!phoneNumber) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Number not found' } };
      }

      const anveoDid = (phoneNumber.metadata as Record<string, unknown>)?.anveoDid as string;

      if (anveoDid) {
        // Cancel on Anveo
        const service = getAnveoDIDService();
        await service.cancelDid(anveoDid);
      }

      // Update status in database
      await prisma.phoneNumber.update({
        where: { id: numberId },
        data: {
          status: 'INACTIVE',
          releasedAt: new Date(),
        },
      });

      // Audit log
      const { auditUpdate } = await import('../services/audit.js');
      await auditUpdate(
        tenantId,
        'PhoneNumber',
        numberId,
        phoneNumber,
        { status: 'INACTIVE', releasedAt: new Date() },
        {
          userId: user?.userId,
          ipAddress: request.ip,
          requestId: request.id,
        }
      );

      logger.info({
        msg: 'Number released',
        phoneNumberId: numberId,
        e164: anveoDid,
        tenantId,
      });

      return { success: true, message: 'Number released successfully' };
    } catch (error) {
      logger.error({ msg: 'Failed to release number', error });
      void reply.code(500);
      return {
        error: {
          code: 'RELEASE_FAILED',
          message: error instanceof Error ? error.message : 'Failed to release number',
        },
      };
    }
  });
}
