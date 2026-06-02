// Route handlers - placeholder implementations
import { FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';

import { AuthenticatedUser } from '../middleware/auth.js';

type AuthRequest = FastifyRequest & { user?: AuthenticatedUser };

// Public API - Numbers
export async function registerNumberRoutes(fastify: FastifyInstance) {
  await Promise.resolve();
  fastify.get<{ Querystring: { page?: string; limit?: string } }>(
    '/api/v1/numbers',
    async (request, reply) => {
      const user = (request as AuthRequest).user;
      const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
      const tenantId = demoTenantId || user?.tenantId;

      if (!tenantId) {
        void reply.code(401);
        return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
      }

      const prisma = (await import('../lib/prisma.js')).getPrismaClient();
      const page = parseInt(request.query.page || '1');
      const limit = parseInt(request.query.limit || '20');
      const skip = (page - 1) * limit;

      let userRoles: string[] = [];
      if (user?.userId) {
        const userRecord = await prisma.user.findUnique({
          where: { id: user.userId },
          include: { roles: { include: { role: true } } },
        });
        userRoles = userRecord?.roles.map(ur => ur.role.name) || [];
      }
      const isAdminOrOwner = userRoles.some(role => role === 'ADMIN' || role === 'OWNER');

      const where: Record<string, any> = { tenantId };
      if (!isAdminOrOwner && user?.userId) {
        where.userId = user.userId;
      }

      const [numbers, total] = await Promise.all([
        prisma.phoneNumber.findMany({
          where,
          take: limit,
          skip,
          orderBy: { createdAt: 'desc' },
          include: {
            campaign: {
              select: {
                id: true,
                name: true,
              },
            },
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        }),
        prisma.phoneNumber.count({ where }),
      ]);

      return {
        data: numbers.map(n => ({
          id: n.id,
          number: n.number,
          status: n.status,
          provider: n.provider,
          capabilities: n.capabilities,
          poolType: n.poolType,
          poolStatus: n.poolStatus,
          campaign: n.campaign ? { id: n.campaign.id, name: n.campaign.name } : null,
          user: n.user
            ? {
                id: n.user.id,
                name: `${n.user.firstName || ''} ${n.user.lastName || ''}`.trim() || n.user.email,
              }
            : null,
          purchasedAt: n.purchasedAt?.toISOString(),
          createdAt: n.createdAt.toISOString(),
          updatedAt: n.updatedAt.toISOString(),
        })),
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    }
  );

  fastify.post<{
    Body: {
      areaCode?: string;
      country?: string;
      region?: string;
      provider?: 'local' | 'signalwire' | 'telnyx' | 'bandwidth' | 'anveo';
      features?: {
        voice?: boolean;
        sms?: boolean;
        mms?: boolean;
        fax?: boolean;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        [key: string]: any;
      };
    };
  }>('/api/v1/numbers', async (request, reply) => {
    try {
      const user = (request as AuthRequest).user;
      const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
      const tenantId = demoTenantId || user?.tenantId;

      if (!tenantId) {
        void reply.code(401);
        return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
      }

      const body = request.body;
      const provider = body.provider;

      // Check quota if not demo mode
      if (!demoTenantId) {
        const { quotaService } = await import('../services/quota-service.js');
        const quotaCheck = await quotaService.checkPhoneNumberQuota(tenantId);
        if (!quotaCheck.allowed) {
          void reply.code(403);
          return {
            error: {
              code: 'QUOTA_EXCEEDED',
              message: quotaCheck.reason || 'Phone number quota exceeded',
              current: quotaCheck.current,
              limit: quotaCheck.limit,
            },
          };
        }
      }

      // Purchase number using provisioning service
      const { provisioningService } = await import(
        '../services/provisioning/provisioning-service.js'
      );
      const provisioned = await provisioningService.purchaseNumber(
        provider,
        {
          areaCode: body.areaCode,
          country: body.country || 'US',
          region: body.region,
          features: body.features || { voice: true },
        },
        {
          tenantId,
          userId: user?.userId,
          ipAddress: request.ip,
          requestId: request.id,
        }
      );

      // Get the created number from database
      const prisma = (await import('../lib/prisma.js')).getPrismaClient();
      const dbNumber = await prisma.phoneNumber.findUnique({
        where: { id: provisioned.id },
      });

      if (!dbNumber) {
        void reply.code(500);
        return {
          error: { code: 'NOT_FOUND', message: 'Number was purchased but not found in database' },
        };
      }

      // Automatically sync/create inbound DidRoute pointing to user's extension
      const { didRouteService } = await import('../services/did-route-service.js');
      await didRouteService.syncDidRouteForNumber(dbNumber.id, tenantId);

      void reply.code(201);
      return {
        id: dbNumber.id,
        tenantId: dbNumber.tenantId,
        number: dbNumber.number,
        status: dbNumber.status,
        provider: dbNumber.provider,
        capabilities: dbNumber.capabilities,
        createdAt: dbNumber.createdAt.toISOString(),
        updatedAt: dbNumber.updatedAt.toISOString(),
      };
    } catch (error: unknown) {
      void reply.code(400);
      return {
        error: {
          code: 'PURCHASE_FAILED',
          message: (error as Error).message || 'Failed to purchase number',
        },
      };
    }
  });

  fastify.get<{ Params: { numberId: string } }>(
    '/api/v1/numbers/:numberId',
    async (request, _reply) => {
      return {
        id: request.params.numberId,
        tenantId: '00000000-0000-0000-0000-000000000000',
        number: '+15551234567',
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  );

  fastify.patch<{
    Params: { numberId: string };
    Body: {
      status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
      campaignId?: string | null;
      userId?: string | null;
      capabilities?: {
        voice?: boolean;
        sms?: boolean;
        mms?: boolean;
        fax?: boolean;
      };
      poolType?: string;
      poolStatus?: string;
    };
  }>('/api/v1/numbers/:numberId', async (request, reply) => {
    try {
      const user = (request as AuthRequest).user;
      const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
      const tenantId = demoTenantId || user?.tenantId;

      if (!tenantId) {
        void reply.code(401);
        return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
      }

      const { numberId } = request.params as { numberId: string };
      const body = request.body;

      const prisma = (await import('../lib/prisma.js')).getPrismaClient();

      // Verify number exists and belongs to tenant
      const existingNumber = await prisma.phoneNumber.findFirst({
        where: {
          id: numberId,
          tenantId: tenantId,
        },
      });

      if (!existingNumber) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Phone number not found' } };
      }

      // Verify campaign exists if provided
      if (body.campaignId !== undefined && body.campaignId !== null) {
        const campaign = await prisma.campaign.findFirst({
          where: {
            id: body.campaignId,
            tenantId: tenantId,
          },
        });

        if (!campaign) {
          void reply.code(404);
          return { error: { code: 'NOT_FOUND', message: 'Campaign not found' } };
        }
      }

      // Update number
      const updateData: Record<string, unknown> = {};
      if (body.status !== undefined) {
        updateData.status = body.status;
      }
      if (body.campaignId !== undefined) {
        updateData.campaignId = body.campaignId;
      }
      if (body.userId !== undefined) {
        updateData.userId = body.userId;
      }
      if (body.capabilities !== undefined) {
        updateData.capabilities = {
          ...((existingNumber.capabilities as Record<string, unknown>) ?? {}),
          ...body.capabilities,
        };
      }
      // RTB Pool fields
      if (body.poolType !== undefined) {
        updateData.poolType = body.poolType;
      }
      if (body.poolStatus !== undefined) {
        updateData.poolStatus = body.poolStatus;
      }

      const updatedNumber = await prisma.phoneNumber.update({
        where: { id: numberId },
        data: updateData,
        include: {
          campaign: {
            select: {
              id: true,
              name: true,
            },
          },
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      });

      // Audit log
      const { auditUpdate } = await import('../services/audit.js');
      await auditUpdate(tenantId, 'PhoneNumber', numberId, existingNumber, updatedNumber, {
        userId: user?.userId,
        ipAddress: request.ip,
        requestId: request.id,
      });

      // Sync inbound DidRoute for the updated user assignment
      const { didRouteService } = await import('../services/did-route-service.js');
      await didRouteService.syncDidRouteForNumber(numberId, tenantId);

      return {
        id: updatedNumber.id,
        tenantId: updatedNumber.tenantId,
        number: updatedNumber.number,
        status: updatedNumber.status,
        provider: updatedNumber.provider,
        capabilities: updatedNumber.capabilities,
        campaign: updatedNumber.campaign
          ? { id: updatedNumber.campaign.id, name: updatedNumber.campaign.name }
          : null,
        user: updatedNumber.user
          ? {
              id: updatedNumber.user.id,
              name:
                `${updatedNumber.user.firstName || ''} ${updatedNumber.user.lastName || ''}`.trim() ||
                updatedNumber.user.email,
            }
          : null,
        purchasedAt: updatedNumber.purchasedAt?.toISOString(),
        createdAt: updatedNumber.createdAt.toISOString(),
        updatedAt: updatedNumber.updatedAt.toISOString(),
      };
    } catch (error: unknown) {
      void reply.code(400);
      return {
        error: {
          code: 'UPDATE_FAILED',
          message: (error as Error).message || 'Failed to update phone number',
        },
      };
    }
  });
}

// Public API - Campaigns
export async function registerCampaignRoutes(fastify: FastifyInstance) {
  await Promise.resolve();
  fastify.get<{ Querystring: { page?: string; limit?: string } }>(
    '/api/v1/campaigns',
    async (request, reply) => {
      const user = (request as AuthRequest).user;
      const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
      const tenantId = demoTenantId || user?.tenantId;

      if (!tenantId) {
        void reply.code(401);
        return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
      }

      const prisma = (await import('../lib/prisma.js')).getPrismaClient();
      const page = parseInt(request.query.page || '1');
      const limit = parseInt(request.query.limit || '20');
      const skip = (page - 1) * limit;

      const [campaigns, total] = await Promise.all([
        prisma.campaign.findMany({
          where: { tenantId },
          take: limit,
          skip,
          orderBy: { createdAt: 'desc' },
          include: {
            publisher: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
            flow: {
              select: {
                id: true,
                name: true,
              },
            },
            _count: {
              select: {
                calls: true,
                phoneNumbers: true,
              },
            },
          },
        }),
        prisma.campaign.count({ where: { tenantId } }),
      ]);

      return {
        data: campaigns.map(c => ({
          id: c.id,
          name: c.name,
          status: c.status,
          offerName: c.offerName,
          country: c.country,
          recordingEnabled: c.recordingEnabled,
          publisherId: c.publisherId,
          publisher: c.publisher,
          flowId: c.flowId,
          flow: c.flow,
          callerIdPoolId: c.callerIdPoolId,
          metadata: c.metadata,
          billableDurationSeconds: c.billableDurationSeconds,
          publisherPayoutPerBillableCall: c.publisherPayoutPerBillableCall,
          buyerPricePerBillableCall: c.buyerPricePerBillableCall,
          calls: c._count.calls,
          phoneNumbers: c._count.phoneNumbers,
          createdAt: c.createdAt.toISOString(),
          updatedAt: c.updatedAt.toISOString(),
        })),
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    }
  );

  fastify.post<{
    Body: {
      name: string;
      publisherId: string;
      offerName?: string;
      country?: string;
      recordingEnabled?: boolean;
      flowId?: string;
      callerIdPoolId?: string;
      status?: 'ACTIVE' | 'PAUSED';
      billableDurationSeconds?: number;
      publisherPayoutPerBillableCall?: number;
      buyerPricePerBillableCall?: number;
      metadata?: Record<string, unknown>;
    };
  }>('/api/v1/campaigns', async (request, reply) => {
    try {
      const user = (request as AuthRequest).user;
      const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
      const tenantId = demoTenantId || user?.tenantId;

      if (!tenantId) {
        void reply.code(401);
        return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
      }

      const body = request.body;

      if (!body.name || !body.name.trim()) {
        void reply.code(400);
        return { error: { code: 'VALIDATION_ERROR', message: 'Campaign name is required' } };
      }

      if (!body.publisherId) {
        void reply.code(400);
        return { error: { code: 'VALIDATION_ERROR', message: 'Publisher ID is required' } };
      }

      const billableDurationSeconds = body.billableDurationSeconds !== undefined ? body.billableDurationSeconds : 60;
      const publisherPayoutPerBillableCall = body.publisherPayoutPerBillableCall !== undefined ? body.publisherPayoutPerBillableCall : 0;
      const buyerPricePerBillableCall = body.buyerPricePerBillableCall !== undefined ? body.buyerPricePerBillableCall : 0;

      if (billableDurationSeconds < 0) {
        void reply.code(400);
        return { error: { code: 'VALIDATION_ERROR', message: 'Billable duration seconds must be >= 0' } };
      }
      if (publisherPayoutPerBillableCall < 0) {
        void reply.code(400);
        return { error: { code: 'VALIDATION_ERROR', message: 'Publisher payout per billable call must be >= 0' } };
      }
      if (buyerPricePerBillableCall < 0) {
        void reply.code(400);
        return { error: { code: 'VALIDATION_ERROR', message: 'Buyer price per billable call must be >= 0' } };
      }

      // Verify publisher exists and belongs to tenant
      const prisma = (await import('../lib/prisma.js')).getPrismaClient();
      const publisher = await prisma.publisher.findFirst({
        where: {
          id: body.publisherId,
          tenantId: tenantId,
        },
      });

      if (!publisher) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Publisher not found' } };
      }

      // Verify flow exists if provided
      if (body.flowId) {
        const flow = await prisma.flow.findFirst({
          where: {
            id: body.flowId,
            tenantId: tenantId,
          },
        });

        if (!flow) {
          void reply.code(404);
          return { error: { code: 'NOT_FOUND', message: 'Flow not found' } };
        }
      }

      // Verify caller ID pool exists if provided
      if (body.callerIdPoolId) {
        const callerIdPool = await prisma.callerIdPool.findFirst({
          where: {
            id: body.callerIdPoolId,
            tenantId: tenantId,
          },
        });

        if (!callerIdPool) {
          void reply.code(404);
          return { error: { code: 'NOT_FOUND', message: 'Caller ID pool not found' } };
        }
      }

      // Create campaign
      const campaign = await prisma.campaign.create({
        data: {
          tenantId: tenantId,
          publisherId: body.publisherId,
          name: body.name.trim(),
          offerName: body.offerName?.trim() || null,
          country: body.country || 'US',
          recordingEnabled: body.recordingEnabled !== false,
          status: body.status || 'ACTIVE',
          flowId: body.flowId || null,
          callerIdPoolId: body.callerIdPoolId || null,
          billableDurationSeconds,
          publisherPayoutPerBillableCall: new Prisma.Decimal(publisherPayoutPerBillableCall),
          buyerPricePerBillableCall: new Prisma.Decimal(buyerPricePerBillableCall),
          metadata: (body.metadata as import('@prisma/client').Prisma.InputJsonValue) || {},
        },
      });

      // Automatically create a CampaignPublisher assignment row backfill/link for backward compatibility
      await prisma.campaignPublisher.create({
        data: {
          tenantId: tenantId,
          campaignId: campaign.id,
          publisherId: body.publisherId,
          payoutPerBillableCall: null,
          status: 'ACTIVE',
        },
      });

      // Audit log
      const { auditCreate } = await import('../services/audit.js');
      await auditCreate(
        tenantId,
        'Campaign',
        campaign.id,
        {
          name: campaign.name,
          publisherId: campaign.publisherId,
          status: campaign.status,
          flowId: campaign.flowId,
        },
        {
          userId: user?.userId,
          ipAddress: request.ip,
          requestId: request.id,
        }
      );

      void reply.code(201);
      return {
        id: campaign.id,
        tenantId: campaign.tenantId,
        publisherId: campaign.publisherId,
        name: campaign.name,
        offerName: campaign.offerName,
        country: campaign.country,
        recordingEnabled: campaign.recordingEnabled,
        status: campaign.status,
        flowId: campaign.flowId,
        callerIdPoolId: campaign.callerIdPoolId,
        billableDurationSeconds: campaign.billableDurationSeconds,
        publisherPayoutPerBillableCall: campaign.publisherPayoutPerBillableCall,
        buyerPricePerBillableCall: campaign.buyerPricePerBillableCall,
        metadata: campaign.metadata,
        createdAt: campaign.createdAt.toISOString(),
        updatedAt: campaign.updatedAt.toISOString(),
      };
    } catch (error: unknown) {
      void reply.code(400);
      return {
        error: {
          code: 'CREATE_FAILED',
          message: (error as Error).message || 'Failed to create campaign',
        },
      };
    }
  });

  // GET campaign stats (call counts by time window)
  fastify.get('/api/v1/campaigns/stats', async (request, reply) => {
    const user = (request as AuthRequest).user;
    const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
    const tenantId = demoTenantId || user?.tenantId;

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();

    // Get all campaigns for this tenant
    const campaigns = await prisma.campaign.findMany({
      where: { tenantId },
      select: { id: true },
    });

    const campaignIds = campaigns.map(c => c.id);

    // Calculate time boundaries
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Aggregate stats using groupBy for each time window
    const [liveStats, hourStats, dayStats, monthStats, totalStats] = await Promise.all([
      // Live calls (ANSWERED or RINGING status)
      prisma.call.groupBy({
        by: ['campaignId'],
        where: {
          tenantId,
          campaignId: { in: campaignIds },
          status: { in: ['ANSWERED', 'RINGING'] },
        },
        _count: { id: true },
      }),
      // Last hour
      prisma.call.groupBy({
        by: ['campaignId'],
        where: {
          tenantId,
          campaignId: { in: campaignIds },
          createdAt: { gte: oneHourAgo },
        },
        _count: { id: true },
      }),
      // Today
      prisma.call.groupBy({
        by: ['campaignId'],
        where: {
          tenantId,
          campaignId: { in: campaignIds },
          createdAt: { gte: startOfToday },
        },
        _count: { id: true },
      }),
      // This month
      prisma.call.groupBy({
        by: ['campaignId'],
        where: {
          tenantId,
          campaignId: { in: campaignIds },
          createdAt: { gte: startOfMonth },
        },
        _count: { id: true },
      }),
      // All time
      prisma.call.groupBy({
        by: ['campaignId'],
        where: {
          tenantId,
          campaignId: { in: campaignIds },
        },
        _count: { id: true },
      }),
    ]);

    // Create lookup maps
    const liveMap = new Map(liveStats.map(s => [s.campaignId, s._count.id]));
    const hourMap = new Map(hourStats.map(s => [s.campaignId, s._count.id]));
    const dayMap = new Map(dayStats.map(s => [s.campaignId, s._count.id]));
    const monthMap = new Map(monthStats.map(s => [s.campaignId, s._count.id]));
    const totalMap = new Map(totalStats.map(s => [s.campaignId, s._count.id]));

    // Build response
    const stats = campaignIds.map(campaignId => ({
      campaignId,
      liveCount: liveMap.get(campaignId) || 0,
      hourCount: hourMap.get(campaignId) || 0,
      dayCount: dayMap.get(campaignId) || 0,
      monthCount: monthMap.get(campaignId) || 0,
      totalCount: totalMap.get(campaignId) || 0,
    }));

    return { data: stats };
  });

  fastify.get<{ Params: { campaignId: string } }>(
    '/api/v1/campaigns/:campaignId',
    async (request, reply) => {
      const user = (request as AuthRequest).user;
      const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
      const tenantId = demoTenantId || user?.tenantId;

      if (!tenantId) {
        void reply.code(401);
        return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
      }

      const prisma = (await import('../lib/prisma.js')).getPrismaClient();
      const campaign = await prisma.campaign.findFirst({
        where: {
          id: request.params.campaignId,
          tenantId,
        },
        include: {
          publisher: { select: { id: true, name: true, code: true } },
          flow: { select: { id: true, name: true } },
          _count: { select: { calls: true, phoneNumbers: true } },
        },
      });

      if (!campaign) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Campaign not found' } };
      }

      return {
        id: campaign.id,
        name: campaign.name,
        offerName: campaign.offerName,
        country: campaign.country,
        recordingEnabled: campaign.recordingEnabled,
        status: campaign.status,
        publisherId: campaign.publisherId,
        publisher: campaign.publisher,
        flowId: campaign.flowId,
        flow: campaign.flow,
        callerIdPoolId: campaign.callerIdPoolId,
        metadata: campaign.metadata,
        billableDurationSeconds: campaign.billableDurationSeconds,
        publisherPayoutPerBillableCall: campaign.publisherPayoutPerBillableCall,
        buyerPricePerBillableCall: campaign.buyerPricePerBillableCall,
        calls: campaign._count.calls,
        phoneNumbers: campaign._count.phoneNumbers,
        createdAt: campaign.createdAt.toISOString(),
        updatedAt: campaign.updatedAt.toISOString(),
      };
    }
  );

  fastify.patch<{
    Params: { campaignId: string };
    Body: {
      name?: string;
      offerName?: string;
      country?: string;
      recordingEnabled?: boolean;
      status?: 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
      flowId?: string | null;
      callerIdPoolId?: string | null;
      billableDurationSeconds?: number;
      publisherPayoutPerBillableCall?: number;
      buyerPricePerBillableCall?: number;
    };
  }>('/api/v1/campaigns/:campaignId', async (request, reply) => {
    try {
      const user = (request as AuthRequest).user;
      const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
      const tenantId = demoTenantId || user?.tenantId;

      if (!tenantId) {
        void reply.code(401);
        return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
      }

      const { campaignId } = request.params;
      const body = request.body;
      const prisma = (await import('../lib/prisma.js')).getPrismaClient();

      // Verify campaign exists and belongs to tenant
      const existingCampaign = await prisma.campaign.findFirst({
        where: { id: campaignId, tenantId },
      });

      if (!existingCampaign) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Campaign not found' } };
      }

      // Build update data
      const updateData: Record<string, unknown> = {};
      if (body.name !== undefined) updateData.name = body.name.trim();
      if (body.offerName !== undefined) updateData.offerName = body.offerName?.trim() || null;
      if (body.country !== undefined) updateData.country = body.country;
      if (body.recordingEnabled !== undefined) updateData.recordingEnabled = body.recordingEnabled;
      if (body.status !== undefined) updateData.status = body.status;
      if (body.flowId !== undefined) updateData.flowId = body.flowId;
      if (body.callerIdPoolId !== undefined) updateData.callerIdPoolId = body.callerIdPoolId;

      if (body.billableDurationSeconds !== undefined) {
        if (body.billableDurationSeconds < 0) {
          void reply.code(400);
          return { error: { code: 'VALIDATION_ERROR', message: 'Billable duration seconds must be >= 0' } };
        }
        updateData.billableDurationSeconds = body.billableDurationSeconds;
      }
      if (body.publisherPayoutPerBillableCall !== undefined) {
        if (body.publisherPayoutPerBillableCall < 0) {
          void reply.code(400);
          return { error: { code: 'VALIDATION_ERROR', message: 'Publisher payout must be >= 0' } };
        }
        updateData.publisherPayoutPerBillableCall = new Prisma.Decimal(body.publisherPayoutPerBillableCall);
      }
      if (body.buyerPricePerBillableCall !== undefined) {
        if (body.buyerPricePerBillableCall < 0) {
          void reply.code(400);
          return { error: { code: 'VALIDATION_ERROR', message: 'Buyer price must be >= 0' } };
        }
        updateData.buyerPricePerBillableCall = new Prisma.Decimal(body.buyerPricePerBillableCall);
      }

      // Update campaign
      const updatedCampaign = await prisma.campaign.update({
        where: { id: campaignId },
        data: updateData,
        include: {
          publisher: { select: { id: true, name: true, code: true } },
          flow: { select: { id: true, name: true } },
        },
      });

      // Audit log
      const { auditUpdate } = await import('../services/audit.js');
      await auditUpdate(tenantId, 'Campaign', campaignId, existingCampaign, updatedCampaign, {
        userId: user?.userId,
        ipAddress: request.ip,
        requestId: request.id,
      });

      return {
        id: updatedCampaign.id,
        name: updatedCampaign.name,
        offerName: updatedCampaign.offerName,
        country: updatedCampaign.country,
        recordingEnabled: updatedCampaign.recordingEnabled,
        status: updatedCampaign.status,
        publisherId: updatedCampaign.publisherId,
        publisher: updatedCampaign.publisher,
        flowId: updatedCampaign.flowId,
        flow: updatedCampaign.flow,
        callerIdPoolId: updatedCampaign.callerIdPoolId,
        metadata: updatedCampaign.metadata,
        billableDurationSeconds: updatedCampaign.billableDurationSeconds,
        publisherPayoutPerBillableCall: updatedCampaign.publisherPayoutPerBillableCall,
        buyerPricePerBillableCall: updatedCampaign.buyerPricePerBillableCall,
        createdAt: updatedCampaign.createdAt.toISOString(),
        updatedAt: updatedCampaign.updatedAt.toISOString(),
      };
    } catch (error: unknown) {
      void reply.code(400);
      return {
        error: {
          code: 'UPDATE_FAILED',
          message: (error as Error).message || 'Failed to update campaign',
        },
      };
    }
  });

  // Duplicate campaign
  fastify.post<{ Params: { campaignId: string } }>(
    '/api/v1/campaigns/:campaignId/duplicate',
    async (request, reply) => {
      try {
        const user = (request as AuthRequest).user;
        const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
        const tenantId = demoTenantId || user?.tenantId;

        if (!tenantId) {
          void reply.code(401);
          return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
        }

        const { campaignId } = request.params;
        const prisma = (await import('../lib/prisma.js')).getPrismaClient();

        // Get the original campaign
        const original = await prisma.campaign.findFirst({
          where: { id: campaignId, tenantId },
        });

        if (!original) {
          void reply.code(404);
          return { error: { code: 'NOT_FOUND', message: 'Campaign not found' } };
        }

        // Create a copy with " - Copy" appended and status set to PAUSED
        const duplicate = await prisma.campaign.create({
          data: {
            tenantId: original.tenantId,
            publisherId: original.publisherId,
            name: `${original.name} - Copy`,
            offerName: original.offerName,
            country: original.country,
            recordingEnabled: original.recordingEnabled,
            status: 'PAUSED',
            routingMode: original.routingMode,
            flowId: original.flowId,
            callerIdPoolId: original.callerIdPoolId,
            metadata: original.metadata || {},
          },
          include: {
            publisher: { select: { id: true, name: true, code: true } },
            flow: { select: { id: true, name: true } },
          },
        });

        // Audit log
        const { auditCreate } = await import('../services/audit.js');
        await auditCreate(
          tenantId,
          'Campaign',
          duplicate.id,
          { duplicatedFrom: campaignId, name: duplicate.name },
          {
            userId: user?.userId,
            ipAddress: request.ip,
            requestId: request.id,
          }
        );

        void reply.code(201);
        return {
          id: duplicate.id,
          name: duplicate.name,
          offerName: duplicate.offerName,
          country: duplicate.country,
          recordingEnabled: duplicate.recordingEnabled,
          status: duplicate.status,
          publisherId: duplicate.publisherId,
          publisher: duplicate.publisher,
          flowId: duplicate.flowId,
          flow: duplicate.flow,
          callerIdPoolId: duplicate.callerIdPoolId,
          metadata: duplicate.metadata,
          createdAt: duplicate.createdAt.toISOString(),
          updatedAt: duplicate.updatedAt.toISOString(),
        };
      } catch (error: unknown) {
        void reply.code(400);
        return {
          error: {
            code: 'DUPLICATE_FAILED',
            message: (error as Error).message || 'Failed to duplicate campaign',
          },
        };
      }
    }
  );

  fastify.delete<{ Params: { campaignId: string } }>(
    '/api/v1/campaigns/:campaignId',
    async (request, reply) => {
      try {
        const user = (request as AuthRequest).user;
        const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
        const tenantId = demoTenantId || user?.tenantId;

        if (!tenantId) {
          void reply.code(401);
          return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
        }

        const { campaignId } = request.params;
        const prisma = (await import('../lib/prisma.js')).getPrismaClient();

        // Verify campaign exists and belongs to tenant
        const campaign = await prisma.campaign.findFirst({
          where: { id: campaignId, tenantId },
        });

        if (!campaign) {
          void reply.code(404);
          return { error: { code: 'NOT_FOUND', message: 'Campaign not found' } };
        }

        // Delete campaign
        await prisma.campaign.delete({ where: { id: campaignId } });

        // Audit log
        const { auditDelete } = await import('../services/audit.js');
        await auditDelete(tenantId, 'Campaign', campaignId, campaign, {
          userId: user?.userId,
          ipAddress: request.ip,
          requestId: request.id,
        });

        void reply.code(204);
        return;
      } catch (error: unknown) {
        void reply.code(400);
        return {
          error: {
            code: 'DELETE_FAILED',
            message: (error as Error).message || 'Failed to delete campaign',
          },
        };
      }
    }
  );

  // GET campaign publishers
  fastify.get<{ Params: { campaignId: string } }>(
    '/api/v1/campaigns/:campaignId/publishers',
    async (request, reply) => {
      const user = (request as AuthRequest).user;
      const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
      const tenantId = demoTenantId || user?.tenantId;
      if (!tenantId) return reply.code(401).send({ error: 'Unauthorized' });

      const { campaignId } = request.params;
      const prisma = (await import('../lib/prisma.js')).getPrismaClient();

      const campaign = await prisma.campaign.findFirst({
        where: { id: campaignId, tenantId },
      });
      if (!campaign) return reply.code(404).send({ error: 'Campaign not found' });

      const publishers = await prisma.campaignPublisher.findMany({
        where: { campaignId, tenantId },
        include: {
          publisher: { select: { id: true, name: true, code: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      return { data: publishers };
    }
  );

  // POST campaign publisher assignment
  fastify.post<{
    Params: { campaignId: string };
    Body: {
      publisherId: string;
      payoutPerBillableCall?: number;
      status?: 'ACTIVE' | 'INACTIVE';
    };
  }>(
    '/api/v1/campaigns/:campaignId/publishers',
    async (request, reply) => {
      const user = (request as AuthRequest).user;
      const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
      const tenantId = demoTenantId || user?.tenantId;
      if (!tenantId) return reply.code(401).send({ error: 'Unauthorized' });

      const { campaignId } = request.params;
      const { publisherId, payoutPerBillableCall, status } = request.body;

      if (!publisherId) {
        return reply.code(400).send({ error: 'publisherId is required' });
      }

      const prisma = (await import('../lib/prisma.js')).getPrismaClient();

      // Verify campaign & publisher belong to tenant
      const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, tenantId } });
      if (!campaign) return reply.code(404).send({ error: 'Campaign not found' });

      const publisher = await prisma.publisher.findFirst({ where: { id: publisherId, tenantId } });
      if (!publisher) return reply.code(404).send({ error: 'Publisher not found' });

      // Check duplicate
      const existing = await prisma.campaignPublisher.findUnique({
        where: {
          tenantId_campaignId_publisherId: { tenantId, campaignId, publisherId },
        },
      });

      if (existing) {
        return reply.code(409).send({ error: 'Publisher is already assigned to this campaign', existingId: existing.id });
      }

      const assignment = await prisma.campaignPublisher.create({
        data: {
          tenantId,
          campaignId,
          publisherId,
          payoutPerBillableCall: payoutPerBillableCall !== undefined ? new Prisma.Decimal(payoutPerBillableCall) : null,
          status: status || 'ACTIVE',
        },
        include: {
          publisher: { select: { id: true, name: true } },
        },
      });

      return reply.code(201).send({ data: assignment });
    }
  );

  // PATCH campaign publisher assignment
  fastify.patch<{
    Params: { campaignId: string; assignmentId: string };
    Body: {
      payoutPerBillableCall?: number | null;
      status?: 'ACTIVE' | 'INACTIVE';
    };
  }>(
    '/api/v1/campaigns/:campaignId/publishers/:assignmentId',
    async (request, reply) => {
      const user = (request as AuthRequest).user;
      const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
      const tenantId = demoTenantId || user?.tenantId;
      if (!tenantId) return reply.code(401).send({ error: 'Unauthorized' });

      const { campaignId, assignmentId } = request.params;
      const { payoutPerBillableCall, status } = request.body;
      const prisma = (await import('../lib/prisma.js')).getPrismaClient();

      const existing = await prisma.campaignPublisher.findFirst({
        where: { id: assignmentId, campaignId, tenantId },
      });
      if (!existing) return reply.code(404).send({ error: 'Assignment not found' });

      const updated = await prisma.campaignPublisher.update({
        where: { id: assignmentId },
        data: {
          payoutPerBillableCall: payoutPerBillableCall !== undefined 
            ? (payoutPerBillableCall === null ? null : new Prisma.Decimal(payoutPerBillableCall))
            : undefined,
          status: status || undefined,
        },
        include: {
          publisher: { select: { id: true, name: true } },
        },
      });

      return { data: updated };
    }
  );

  // DELETE campaign publisher assignment
  fastify.delete<{ Params: { campaignId: string; assignmentId: string } }>(
    '/api/v1/campaigns/:campaignId/publishers/:assignmentId',
    async (request, reply) => {
      const user = (request as AuthRequest).user;
      const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
      const tenantId = demoTenantId || user?.tenantId;
      if (!tenantId) return reply.code(401).send({ error: 'Unauthorized' });

      const { campaignId, assignmentId } = request.params;
      const prisma = (await import('../lib/prisma.js')).getPrismaClient();

      const existing = await prisma.campaignPublisher.findFirst({
        where: { id: assignmentId, campaignId, tenantId },
      });
      if (!existing) return reply.code(404).send({ error: 'Assignment not found' });

      await prisma.campaignPublisher.delete({ where: { id: assignmentId } });
      return reply.code(204).send();
    }
  );

  // GET campaign buyers
  fastify.get<{ Params: { campaignId: string } }>(
    '/api/v1/campaigns/:campaignId/buyers',
    async (request, reply) => {
      const user = (request as AuthRequest).user;
      const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
      const tenantId = demoTenantId || user?.tenantId;
      if (!tenantId) return reply.code(401).send({ error: 'Unauthorized' });

      const { campaignId } = request.params;
      const prisma = (await import('../lib/prisma.js')).getPrismaClient();

      const campaign = await prisma.campaign.findFirst({
        where: { id: campaignId, tenantId },
      });
      if (!campaign) return reply.code(404).send({ error: 'Campaign not found' });

      const buyers = await prisma.campaignBuyer.findMany({
        where: { campaignId, tenantId },
        include: {
          buyer: { select: { id: true, name: true, code: true } },
          buyerEndpoint: { select: { id: true, name: true, destination: true } },
        },
        orderBy: { priority: 'desc' },
      });

      return { data: buyers };
    }
  );

  // POST campaign buyer assignment
  fastify.post<{
    Params: { campaignId: string };
    Body: {
      buyerId: string;
      buyerEndpointId?: string;
      destinationNumber: string;
      pricePerBillableCall?: number;
      priority?: number;
      status?: 'ACTIVE' | 'INACTIVE';
    };
  }>(
    '/api/v1/campaigns/:campaignId/buyers',
    async (request, reply) => {
      const user = (request as AuthRequest).user;
      const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
      const tenantId = demoTenantId || user?.tenantId;
      if (!tenantId) return reply.code(401).send({ error: 'Unauthorized' });

      const { campaignId } = request.params;
      const { buyerId, buyerEndpointId, destinationNumber, pricePerBillableCall, priority, status } = request.body;

      if (!buyerId || !destinationNumber) {
        return reply.code(400).send({ error: 'buyerId and destinationNumber are required' });
      }

      const prisma = (await import('../lib/prisma.js')).getPrismaClient();

      // Verify campaign & buyer belong to tenant
      const campaign = await prisma.campaign.findFirst({ where: { id: campaignId, tenantId } });
      if (!campaign) return reply.code(404).send({ error: 'Campaign not found' });

      const buyer = await prisma.buyer.findFirst({ where: { id: buyerId, tenantId } });
      if (!buyer) return reply.code(404).send({ error: 'Buyer not found' });

      // Verify endpoint type and validate destination number format
      let normalizedDestination = destinationNumber.trim();
      let isPstn = true;

      if (buyerEndpointId) {
        const ep = await prisma.buyerEndpoint.findFirst({ where: { id: buyerEndpointId, buyerId } });
        if (!ep) return reply.code(404).send({ error: 'Buyer endpoint not found' });
        if (ep.type === 'SIP' || ep.type === 'WEBRTC') {
          isPstn = false;
        }
      }

      if (isPstn) {
        // E.164 normalization & validation
        const digits = normalizedDestination.replace(/\D/g, '');
        if (digits.length < 10) {
          return reply.code(400).send({ error: 'PSTN destination number must have at least 10 digits' });
        }
        normalizedDestination = digits.length === 10 ? `+1${digits}` : `+${digits}`;
        // Validate with standard E.164 regex
        if (!/^\+[1-9]\d{1,14}$/.test(normalizedDestination)) {
          return reply.code(400).send({ error: 'Invalid destination number format' });
        }
      }

      // Check duplicate (unique tenantId, campaignId, buyerId, destinationNumber)
      const existing = await prisma.campaignBuyer.findUnique({
        where: {
          tenantId_campaignId_buyerId_destinationNumber: {
            tenantId,
            campaignId,
            buyerId,
            destinationNumber: normalizedDestination,
          },
        },
      });

      if (existing) {
        return reply.code(409).send({ error: 'Buyer with this destination is already assigned to this campaign', existingId: existing.id });
      }

      const assignment = await prisma.campaignBuyer.create({
        data: {
          tenantId,
          campaignId,
          buyerId,
          buyerEndpointId: buyerEndpointId || null,
          destinationNumber: normalizedDestination,
          pricePerBillableCall: pricePerBillableCall !== undefined ? new Prisma.Decimal(pricePerBillableCall) : null,
          priority: priority || 0,
          status: status || 'ACTIVE',
        },
        include: {
          buyer: { select: { id: true, name: true } },
          buyerEndpoint: { select: { id: true, name: true } },
        },
      });

      return reply.code(201).send({ data: assignment });
    }
  );

  // PATCH campaign buyer assignment
  fastify.patch<{
    Params: { campaignId: string; assignmentId: string };
    Body: {
      buyerEndpointId?: string | null;
      destinationNumber?: string;
      pricePerBillableCall?: number | null;
      priority?: number;
      status?: 'ACTIVE' | 'INACTIVE';
    };
  }>(
    '/api/v1/campaigns/:campaignId/buyers/:assignmentId',
    async (request, reply) => {
      const user = (request as AuthRequest).user;
      const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
      const tenantId = demoTenantId || user?.tenantId;
      if (!tenantId) return reply.code(401).send({ error: 'Unauthorized' });

      const { campaignId, assignmentId } = request.params;
      const { buyerEndpointId, destinationNumber, pricePerBillableCall, priority, status } = request.body;
      const prisma = (await import('../lib/prisma.js')).getPrismaClient();

      const existing = await prisma.campaignBuyer.findFirst({
        where: { id: assignmentId, campaignId, tenantId },
      });
      if (!existing) return reply.code(404).send({ error: 'Assignment not found' });

      let normalizedDestination = destinationNumber !== undefined ? destinationNumber.trim() : existing.destinationNumber;
      let isPstn = true;

      const targetEpId = buyerEndpointId !== undefined ? buyerEndpointId : existing.buyerEndpointId;
      if (targetEpId) {
        const ep = await prisma.buyerEndpoint.findFirst({ where: { id: targetEpId, buyerId: existing.buyerId } });
        if (!ep) return reply.code(404).send({ error: 'Buyer endpoint not found' });
        if (ep.type === 'SIP' || ep.type === 'WEBRTC') {
          isPstn = false;
        }
      }

      if (isPstn && destinationNumber !== undefined) {
        const digits = normalizedDestination.replace(/\D/g, '');
        if (digits.length < 10) {
          return reply.code(400).send({ error: 'PSTN destination number must have at least 10 digits' });
        }
        normalizedDestination = digits.length === 10 ? `+1${digits}` : `+${digits}`;
        if (!/^\+[1-9]\d{1,14}$/.test(normalizedDestination)) {
          return reply.code(400).send({ error: 'Invalid destination number format' });
        }
      }

      // Check duplicate if destination number is changing
      if (destinationNumber !== undefined && normalizedDestination !== existing.destinationNumber) {
        const dup = await prisma.campaignBuyer.findUnique({
          where: {
            tenantId_campaignId_buyerId_destinationNumber: {
              tenantId,
              campaignId,
              buyerId: existing.buyerId,
              destinationNumber: normalizedDestination,
            },
          },
        });
        if (dup && dup.id !== assignmentId) {
          return reply.code(409).send({ error: 'Another assignment exists with this destination' });
        }
      }

      const updated = await prisma.campaignBuyer.update({
        where: { id: assignmentId },
        data: {
          buyerEndpointId: buyerEndpointId !== undefined ? buyerEndpointId : undefined,
          destinationNumber: destinationNumber !== undefined ? normalizedDestination : undefined,
          pricePerBillableCall: pricePerBillableCall !== undefined
            ? (pricePerBillableCall === null ? null : new Prisma.Decimal(pricePerBillableCall))
            : undefined,
          priority: priority !== undefined ? priority : undefined,
          status: status || undefined,
        },
        include: {
          buyer: { select: { id: true, name: true } },
          buyerEndpoint: { select: { id: true, name: true } },
        },
      });

      return { data: updated };
    }
  );

  // DELETE campaign buyer assignment
  fastify.delete<{ Params: { campaignId: string; assignmentId: string } }>(
    '/api/v1/campaigns/:campaignId/buyers/:assignmentId',
    async (request, reply) => {
      const user = (request as AuthRequest).user;
      const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
      const tenantId = demoTenantId || user?.tenantId;
      if (!tenantId) return reply.code(401).send({ error: 'Unauthorized' });

      const { campaignId, assignmentId } = request.params;
      const prisma = (await import('../lib/prisma.js')).getPrismaClient();

      const existing = await prisma.campaignBuyer.findFirst({
        where: { id: assignmentId, campaignId, tenantId },
      });
      if (!existing) return reply.code(404).send({ error: 'Assignment not found' });

      await prisma.campaignBuyer.delete({ where: { id: assignmentId } });
      return reply.code(204).send();
    }
  );
}

// Public API - Flows
export async function registerFlowRoutes(fastify: FastifyInstance) {
  await Promise.resolve();
  fastify.get('/api/v1/flows', async (request, reply) => {
    const user = (request as AuthRequest).user;
    const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
    const tenantId = demoTenantId || user?.tenantId;

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();
    const flows = await prisma.flow.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
          select: {
            version: true,
          },
        },
      },
    });

    return {
      data: flows.map(f => ({
        id: f.id,
        name: f.name,
        version: f.versions[0]?.version || 1,
        status: f.status,
        createdAt: f.createdAt.toISOString(),
        updatedAt: f.updatedAt.toISOString(),
      })),
      meta: {
        total: flows.length,
      },
    };
  });

  fastify.post('/api/v1/flows', async (_request, reply) => {
    void reply.code(201);
    return {
      id: '00000000-0000-0000-0000-000000000000',
      tenantId: '00000000-0000-0000-0000-000000000000',
      name: 'Flow',
      status: 'DRAFT',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });

  fastify.get<{ Params: { flowId: string } }>('/api/v1/flows/:flowId', async (request, _reply) => {
    return {
      id: request.params.flowId,
      tenantId: '00000000-0000-0000-0000-000000000000',
      name: 'Flow',
      status: 'DRAFT',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });

  fastify.patch<{ Params: { flowId: string } }>(
    '/api/v1/flows/:flowId',
    async (request, _reply) => {
      return {
        id: request.params.flowId,
        tenantId: '00000000-0000-0000-0000-000000000000',
        name: 'Flow',
        status: 'DRAFT',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  );
}

// Public API - Publishers
export async function registerPublisherRoutes(fastify: FastifyInstance) {
  await Promise.resolve();

  // GET all publishers (with pagination)
  fastify.get<{ Querystring: { page?: string; limit?: string; status?: string } }>(
    '/api/v1/publishers',
    async (request, reply) => {
      const user = (request as AuthRequest).user;
      const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
      const tenantId = demoTenantId || user?.tenantId;

      if (!tenantId) {
        void reply.code(401);
        return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
      }

      const prisma = (await import('../lib/prisma.js')).getPrismaClient();
      const page = parseInt(request.query.page || '1');
      const limit = parseInt(request.query.limit || '50');
      const skip = (page - 1) * limit;
      const statusFilter = request.query.status;

      const whereClause: { tenantId: string; status?: 'ACTIVE' | 'INACTIVE' } = { tenantId };
      if (statusFilter === 'ACTIVE' || statusFilter === 'INACTIVE') {
        whereClause.status = statusFilter;
      }

      const [publishers, total] = await Promise.all([
        prisma.publisher.findMany({
          where: whereClause,
          take: limit,
          skip,
          orderBy: { name: 'asc' },
          select: {
            id: true,
            name: true,
            code: true,
            email: true,
            accessToRecordings: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        prisma.publisher.count({ where: whereClause }),
      ]);

      return {
        data: publishers.map(p => ({
          id: p.id,
          name: p.name,
          code: p.code,
          email: p.email,
          accessToRecordings: p.accessToRecordings,
          status: p.status,
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
        })),
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    }
  );

  // GET publisher stats (server-side aggregation)
  fastify.get('/api/v1/publishers/stats', async (request, reply) => {
    const user = (request as AuthRequest).user;
    const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
    const tenantId = demoTenantId || user?.tenantId;

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();

    // Get all publishers for this tenant
    const publishers = await prisma.publisher.findMany({
      where: { tenantId },
      select: { id: true, name: true, code: true, status: true },
    });

    // Aggregate call stats for each publisher using Prisma groupBy
    const callStats = await prisma.call.groupBy({
      by: ['publisherId'],
      where: { tenantId, publisherId: { not: null } },
      _count: { id: true },
    });

    const billableStats = await prisma.call.groupBy({
      by: ['publisherId'],
      where: { tenantId, publisherId: { not: null }, paidOut: true },
      _count: { id: true },
    });

    const missedStats = await prisma.call.groupBy({
      by: ['publisherId'],
      where: { tenantId, publisherId: { not: null }, missedCall: true },
      _count: { id: true },
    });

    // Create lookup maps
    const totalCallsMap = new Map(callStats.map(s => [s.publisherId, s._count.id]));
    const billableCallsMap = new Map(billableStats.map(s => [s.publisherId, s._count.id]));
    const missedCallsMap = new Map(missedStats.map(s => [s.publisherId, s._count.id]));

    // Combine data
    const stats = publishers.map(p => {
      const totalCalls = totalCallsMap.get(p.id) || 0;
      const billableCalls = billableCallsMap.get(p.id) || 0;
      const missedCalls = missedCallsMap.get(p.id) || 0;
      const conversionRate = totalCalls > 0 ? (billableCalls / totalCalls) * 100 : 0;

      return {
        publisherId: p.id,
        name: p.name,
        code: p.code,
        status: p.status,
        totalCalls,
        billableCalls,
        missedCalls,
        conversionRate: Math.round(conversionRate * 100) / 100,
      };
    });

    return { data: stats };
  });

  // POST create publisher
  fastify.post<{
    Body: {
      name: string;
      email?: string;
      accessToRecordings?: boolean;
    };
  }>('/api/v1/publishers', async (request, reply) => {
    try {
      const user = (request as AuthRequest).user;
      const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
      const tenantId = demoTenantId || user?.tenantId;

      if (!tenantId) {
        void reply.code(401);
        return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
      }

      const body = request.body;

      if (!body.name || !body.name.trim()) {
        void reply.code(400);
        return { error: { code: 'VALIDATION_ERROR', message: 'Publisher name is required' } };
      }

      const prisma = (await import('../lib/prisma.js')).getPrismaClient();
      const { generatePublisherCode, sendWelcomeEmail } = await import(
        '../services/publisher-email.js'
      );

      // Generate 32-char hex code
      const code = generatePublisherCode();

      // Create publisher
      const publisher = await prisma.publisher.create({
        data: {
          tenantId,
          name: body.name.trim(),
          code,
          email: body.email?.trim() || null,
          accessToRecordings: body.accessToRecordings || false,
          status: 'ACTIVE',
        },
      });

      // Send welcome email if email provided
      if (publisher.email) {
        await sendWelcomeEmail({
          email: publisher.email,
          publisherName: publisher.name,
          publisherId: publisher.code,
          accessToRecordings: publisher.accessToRecordings,
        });
      }

      // Audit log
      const { auditCreate } = await import('../services/audit.js');
      await auditCreate(
        tenantId,
        'Publisher',
        publisher.id,
        {
          name: publisher.name,
          code: publisher.code,
          email: publisher.email,
          accessToRecordings: publisher.accessToRecordings,
          status: publisher.status,
        },
        {
          userId: user?.userId,
          ipAddress: request.ip,
          requestId: request.id,
        }
      );

      void reply.code(201);
      return {
        id: publisher.id,
        tenantId: publisher.tenantId,
        name: publisher.name,
        code: publisher.code,
        email: publisher.email,
        accessToRecordings: publisher.accessToRecordings,
        status: publisher.status,
        createdAt: publisher.createdAt.toISOString(),
        updatedAt: publisher.updatedAt.toISOString(),
      };
    } catch (error: unknown) {
      void reply.code(400);
      return {
        error: {
          code: 'CREATE_FAILED',
          message: (error as Error).message || 'Failed to create publisher',
        },
      };
    }
  });

  // PATCH update publisher
  fastify.patch<{
    Params: { publisherId: string };
    Body: {
      name?: string;
      email?: string;
      accessToRecordings?: boolean;
      status?: 'ACTIVE' | 'INACTIVE';
    };
  }>('/api/v1/publishers/:publisherId', async (request, reply) => {
    try {
      const user = (request as AuthRequest).user;
      const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
      const tenantId = demoTenantId || user?.tenantId;

      if (!tenantId) {
        void reply.code(401);
        return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
      }

      const { publisherId } = request.params;
      const body = request.body;

      const prisma = (await import('../lib/prisma.js')).getPrismaClient();

      // Verify publisher exists and belongs to tenant
      const existingPublisher = await prisma.publisher.findFirst({
        where: { id: publisherId, tenantId },
      });

      if (!existingPublisher) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Publisher not found' } };
      }

      // Build update data
      const updateData: {
        name?: string;
        email?: string | null;
        accessToRecordings?: boolean;
        status?: 'ACTIVE' | 'INACTIVE';
      } = {};

      if (body.name !== undefined) updateData.name = body.name.trim();
      if (body.email !== undefined) updateData.email = body.email?.trim() || null;
      if (body.accessToRecordings !== undefined)
        updateData.accessToRecordings = body.accessToRecordings;
      if (body.status !== undefined) updateData.status = body.status;

      const publisher = await prisma.publisher.update({
        where: { id: publisherId },
        data: updateData,
      });

      // Audit log
      const { auditUpdate } = await import('../services/audit.js');
      await auditUpdate(tenantId, 'Publisher', publisher.id, existingPublisher, publisher, {
        userId: user?.userId,
        ipAddress: request.ip,
        requestId: request.id,
      });

      return {
        id: publisher.id,
        tenantId: publisher.tenantId,
        name: publisher.name,
        code: publisher.code,
        email: publisher.email,
        accessToRecordings: publisher.accessToRecordings,
        status: publisher.status,
        createdAt: publisher.createdAt.toISOString(),
        updatedAt: publisher.updatedAt.toISOString(),
      };
    } catch (error: unknown) {
      void reply.code(400);
      return {
        error: {
          code: 'UPDATE_FAILED',
          message: (error as Error).message || 'Failed to update publisher',
        },
      };
    }
  });

  // DELETE publisher
  fastify.delete<{ Params: { publisherId: string } }>(
    '/api/v1/publishers/:publisherId',
    async (request, reply) => {
      try {
        const user = (request as AuthRequest).user;
        const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
        const tenantId = demoTenantId || user?.tenantId;

        if (!tenantId) {
          void reply.code(401);
          return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
        }

        const { publisherId } = request.params;
        const prisma = (await import('../lib/prisma.js')).getPrismaClient();

        // Verify publisher exists and belongs to tenant
        const publisher = await prisma.publisher.findFirst({
          where: { id: publisherId, tenantId },
        });

        if (!publisher) {
          void reply.code(404);
          return { error: { code: 'NOT_FOUND', message: 'Publisher not found' } };
        }

        // Delete publisher (cascades to related data per schema)
        await prisma.publisher.delete({
          where: { id: publisherId },
        });

        // Audit log
        const { auditDelete } = await import('../services/audit.js');
        await auditDelete(tenantId, 'Publisher', publisher.id, publisher, {
          userId: user?.userId,
          ipAddress: request.ip,
          requestId: request.id,
        });

        void reply.code(204);
        return;
      } catch (error: unknown) {
        void reply.code(400);
        return {
          error: {
            code: 'DELETE_FAILED',
            message: (error as Error).message || 'Failed to delete publisher',
          },
        };
      }
    }
  );
}

// Public API - Calls
export async function registerCallRoutes(fastify: FastifyInstance) {
  await Promise.resolve();

  function formatDuration(seconds?: number | null): string {
    if (seconds === undefined || seconds === null || isNaN(seconds)) return '0:00';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${minutes}:${String(secs).padStart(2, '0')}`;
  }

  function getPublicApiBaseUrl(request: FastifyRequest): string {
    const envUrl = process.env.PUBLIC_API_URL || process.env.API_PUBLIC_URL;
    if (envUrl) {
      return envUrl;
    }
    const protocol = (request.headers['x-forwarded-proto'] as string) || 'http';
    const host = request.headers.host || 'localhost:3001';
    return `${protocol}://${host}`;
  }

  function buildRecordingPlaybackUrls(call: any, apiBaseUrl: string, token?: string) {
    const latestRecording = call.recordings?.[0] ?? null;
    const primaryId = call.primaryRecordingId || latestRecording?.id || null;

    let primaryUrl = '';
    if (primaryId) {
      primaryUrl = `${apiBaseUrl.replace(/\/$/, '')}/api/v1/recordings/${primaryId}/stream`;
      if (token) {
        primaryUrl += `?token=${token}`;
      }
    } else if (call.recordingUrl) {
      if (call.recordingUrl.startsWith('http://') || call.recordingUrl.startsWith('https://')) {
        primaryUrl = call.recordingUrl;
      } else {
        primaryUrl = `${apiBaseUrl.replace(/\/$/, '')}${call.recordingUrl}`;
        if (token && !primaryUrl.includes('?token=')) {
          primaryUrl += `?token=${token}`;
        }
      }
    }

    // All recordings
    const allUrls = call.recordings && call.recordings.length > 0
      ? call.recordings.map((rec: any) => {
          let u = `${apiBaseUrl.replace(/\/$/, '')}/api/v1/recordings/${rec.id}/stream`;
          if (token) {
            u += `?token=${token}`;
          }
          return u;
        }).join('; ')
      : primaryUrl;

    return { primaryUrl, allUrls };
  }

  function csvEscape(value: any): string {
    if (value === null || value === undefined) return '""';
    const str = String(value);
    return `"${str.replace(/"/g, '""')}"`;
  }

  function buildCallWhere(params: {
    tenantId: string;
    isAdminOrOwner: boolean;
    userId?: string;
    userNumbers: string[];
    search?: string;
    phone?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const { tenantId, isAdminOrOwner, userId, userNumbers, search, phone, startDate, endDate } = params;
    const where: Record<string, any> = { tenantId };

    if (!isAdminOrOwner && userId) {
      const numberFormats: string[] = [];
      for (const num of userNumbers) {
        numberFormats.push(num);
        if (num.startsWith('+1')) {
          numberFormats.push(num.substring(2)); // 10 digit
          numberFormats.push(num.substring(1)); // 11 digit (1xxxxxxxxxx)
        } else if (num.startsWith('1') && num.length === 11) {
          numberFormats.push('+' + num);
          numberFormats.push(num.substring(1));
        } else if (num.length === 10) {
          numberFormats.push('+1' + num);
          numberFormats.push('1' + num);
        }
      }
      where.OR = [
        { createdById: userId },
        { fromNumber: { userId: userId } },
        { callerId: { in: numberFormats } },
        { toNumber: { in: numberFormats } },
        { did: { in: numberFormats } },
      ];
    }

    const andClauses: any[] = [];

    if (phone) {
      andClauses.push({
        OR: [
          { toNumber: phone },
          { callerId: phone },
          { toNumber: phone.replace(/^\+1/, '') },
          { callerId: phone.replace(/^\+1/, '') },
        ],
      });
    }

    if (startDate) {
      const parsedStart = new Date(startDate);
      if (!isNaN(parsedStart.getTime())) {
        andClauses.push({ createdAt: { gte: parsedStart } });
      }
    }
    if (endDate) {
      const parsedEnd = new Date(endDate);
      if (!isNaN(parsedEnd.getTime())) {
        andClauses.push({ createdAt: { lte: parsedEnd } });
      }
    }

    if (search && search.trim()) {
      const searchLower = search.trim();
      andClauses.push({
        OR: [
          { id: { contains: searchLower, mode: 'insensitive' } },
          { callSid: { contains: searchLower, mode: 'insensitive' } },
          { callerId: { contains: searchLower, mode: 'insensitive' } },
          { toNumber: { contains: searchLower, mode: 'insensitive' } },
          { targetNumber: { contains: searchLower, mode: 'insensitive' } },
          { did: { contains: searchLower, mode: 'insensitive' } },
          { disposition: { contains: searchLower, mode: 'insensitive' } },
          { dispositionNotes: { contains: searchLower, mode: 'insensitive' } },
          { callSource: { contains: searchLower, mode: 'insensitive' } },
          { campaign: { name: { contains: searchLower, mode: 'insensitive' } } },
        ],
      });
    }

    if (andClauses.length > 0) {
      if (where.OR) {
        where.AND = [
          { OR: where.OR },
          ...andClauses
        ];
        delete where.OR;
      } else {
        where.AND = andClauses;
      }
    }

    return where;
  }

  function mapCallRecord(call: any, apiBaseUrl: string, prisma: any, request: any, skipDbUpdate = false) {
    const latestRecording = call.recordings?.[0] ?? null;

    const effectivePrimaryRecordingId =
      call.primaryRecordingId || latestRecording?.id || null;

    const effectiveRecordingUrl =
      call.recordingUrl ||
      (effectivePrimaryRecordingId
        ? `/api/v1/recordings/${effectivePrimaryRecordingId}/stream`
        : null);

    const effectiveRecordingStatus =
      effectiveRecordingUrl || effectivePrimaryRecordingId
        ? 'READY'
        : call.recordingStatus;

    if (!skipDbUpdate && latestRecording && call.recordingStatus !== 'READY') {
      prisma.call.update({
        where: { id: call.id },
        data: {
          primaryRecordingId: latestRecording.id,
          recordingStatus: 'READY',
          recordingUrl: `/api/v1/recordings/${latestRecording.id}/stream`,
          recordingCompletedAt: latestRecording.createdAt,
          recordingError: null,
        },
      }).catch((err: any) => {
        request.log.error(
          { err, callId: call.id, recordingId: latestRecording.id },
          'Failed to repair stale call recording status from existing recording row'
        );
      });
    }

    const playbackUrls = buildRecordingPlaybackUrls(call, apiBaseUrl);

    return {
      id: call.id,
      tenantId: call.tenantId,
      callSid: call.callSid,
      externalId: call.externalId,
      createdById: call.createdById,
      toNumber: call.toNumber,
      direction: call.direction,
      status: call.status,
      duration: call.duration,
      connectedDuration: call.connectedDuration,
      cost: call.cost,
      revenue: call.revenue,
      callerId: call.callerId,
      did: call.did,
      targetNumber: call.targetNumber,
      converted: call.converted,
      paidOut: call.paidOut,
      missedCall: call.missedCall,
      blocked: call.blocked,
      recordingUrl: effectiveRecordingUrl,
      absoluteRecordingUrl: playbackUrls.primaryUrl,
      allRecordingUrls: playbackUrls.allUrls,
      recordingStatus: effectiveRecordingStatus,
      recordingError: effectiveRecordingStatus === 'READY' ? null : call.recordingError,
      primaryRecordingId: effectivePrimaryRecordingId,
      recordingStartedAt: call.recordingStartedAt?.toISOString() ?? null,
      recordingCompletedAt:
        call.recordingCompletedAt?.toISOString() ??
        latestRecording?.createdAt?.toISOString?.() ??
        null,
      disposition: call.disposition,
      dispositionNotes: call.dispositionNotes,
      callSource: call.callSource,
      followUpAt: call.followUpAt?.toISOString() ?? null,
      followUpStatus: call.followUpStatus,
      campaign: call.campaign ? { id: call.campaign.id, name: call.campaign.name } : null,
      fromNumber: call.fromNumber
        ? { id: call.fromNumber.id, number: call.fromNumber.number }
        : null,
      createdBy: call.createdBy
        ? { firstName: call.createdBy.firstName, lastName: call.createdBy.lastName }
        : null,
      createdAt: call.createdAt.toISOString(),
      updatedAt: call.updatedAt.toISOString(),
      startedAt: call.startedAt?.toISOString(),
      answeredAt: call.answeredAt?.toISOString(),
      endedAt: call.endedAt?.toISOString(),
      metadata: call.metadata,
    };
  }

  // 1. GET /api/v1/calls — List all calls
  fastify.get<{
    Querystring: {
      page?: string;
      limit?: string;
      phone?: string;
      search?: string;
      startDate?: string;
      endDate?: string;
    };
  }>(
    '/api/v1/calls',
    async (request, reply) => {
      const user = (request as AuthRequest).user;
      const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
      const tenantId = demoTenantId || user?.tenantId;

      if (!tenantId) {
        void reply.code(401);
        return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
      }

      const startDate = request.query.startDate;
      const endDate = request.query.endDate;

      if (startDate) {
        const parsed = new Date(startDate);
        if (isNaN(parsed.getTime())) {
          void reply.code(400);
          return { error: { code: 'VALIDATION_ERROR', message: 'Invalid startDate format' } };
        }
      }

      if (endDate) {
        const parsed = new Date(endDate);
        if (isNaN(parsed.getTime())) {
          void reply.code(400);
          return { error: { code: 'VALIDATION_ERROR', message: 'Invalid endDate format' } };
        }
      }

      if (startDate && endDate) {
        if (new Date(startDate) > new Date(endDate)) {
          void reply.code(400);
          return { error: { code: 'VALIDATION_ERROR', message: 'startDate cannot be after endDate' } };
        }
      }

      try {
        const { reconcileStaleRecordingsForTenant } = await import(
          '../services/recording-reconciler.js'
        );
        await reconcileStaleRecordingsForTenant(tenantId);
      } catch (err) {
        request.log.error(
          { err, tenantId },
          'Recording reconciliation failed before call list fetch'
        );
      }

      const prisma = (await import('../lib/prisma.js')).getPrismaClient();
      const page = parseInt(request.query.page || '1');
      const limit = parseInt(request.query.limit || '20');
      const skip = (page - 1) * limit;

      let userRoles: string[] = [];
      let userNumbers: string[] = [];
      if (user?.userId) {
        const userRecord = await prisma.user.findUnique({
          where: { id: user.userId },
          include: { roles: { include: { role: true } } },
        });
        userRoles = userRecord?.roles.map(ur => ur.role.name) || [];

        if (!userRoles.some(role => role === 'ADMIN' || role === 'OWNER')) {
          const fetchedNumbers = await prisma.phoneNumber.findMany({
            where: {
              tenantId,
              userId: user.userId,
            },
            select: {
              number: true,
            },
          });
          userNumbers = fetchedNumbers.map(n => n.number);
        }
      }
      const isAdminOrOwner = userRoles.some(role => role === 'ADMIN' || role === 'OWNER');

      const where = buildCallWhere({
        tenantId,
        isAdminOrOwner,
        userId: user?.userId,
        userNumbers,
        search: request.query.search,
        phone: request.query.phone,
        startDate: request.query.startDate,
        endDate: request.query.endDate,
      });

      const [calls, total] = await Promise.all([
        prisma.call.findMany({
          where,
          take: limit,
          skip,
          orderBy: [
            { createdAt: 'desc' },
            { id: 'desc' },
          ],
          include: {
            campaign: true,
            fromNumber: true,
            createdBy: { select: { firstName: true, lastName: true } },
            recordings: {
              where: { deletedAt: null },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        }),
        prisma.call.count({ where }),
      ]);

      const apiBaseUrl = getPublicApiBaseUrl(request);
      const mappedCalls = calls.map(call => mapCallRecord(call, apiBaseUrl, prisma, request, false));

      return {
        data: mappedCalls,
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    }
  );

  // 2. GET /api/v1/calls/export.csv — Export all matching calls to CSV
  fastify.get<{
    Querystring: {
      phone?: string;
      search?: string;
      startDate?: string;
      endDate?: string;
    };
  }>(
    '/api/v1/calls/export.csv',
    async (request, reply) => {
      const user = (request as AuthRequest).user;
      const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
      const tenantId = demoTenantId || user?.tenantId;

      if (!tenantId) {
        void reply.code(401);
        return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
      }

      const startDate = request.query.startDate;
      const endDate = request.query.endDate;

      if (startDate) {
        const parsed = new Date(startDate);
        if (isNaN(parsed.getTime())) {
          void reply.code(400);
          return { error: { code: 'VALIDATION_ERROR', message: 'Invalid startDate format' } };
        }
      }

      if (endDate) {
        const parsed = new Date(endDate);
        if (isNaN(parsed.getTime())) {
          void reply.code(400);
          return { error: { code: 'VALIDATION_ERROR', message: 'Invalid endDate format' } };
        }
      }

      if (startDate && endDate) {
        if (new Date(startDate) > new Date(endDate)) {
          void reply.code(400);
          return { error: { code: 'VALIDATION_ERROR', message: 'startDate cannot be after endDate' } };
        }
      }

      const prisma = (await import('../lib/prisma.js')).getPrismaClient();

      let userRoles: string[] = [];
      let userNumbers: string[] = [];
      if (user?.userId) {
        const userRecord = await prisma.user.findUnique({
          where: { id: user.userId },
          include: { roles: { include: { role: true } } },
        });
        userRoles = userRecord?.roles.map(ur => ur.role.name) || [];

        if (!userRoles.some(role => role === 'ADMIN' || role === 'OWNER')) {
          const fetchedNumbers = await prisma.phoneNumber.findMany({
            where: {
              tenantId,
              userId: user.userId,
            },
            select: {
              number: true,
            },
          });
          userNumbers = fetchedNumbers.map(n => n.number);
        }
      }
      const isAdminOrOwner = userRoles.some(role => role === 'ADMIN' || role === 'OWNER');

      const where = buildCallWhere({
        tenantId,
        isAdminOrOwner,
        userId: user?.userId,
        userNumbers,
        search: request.query.search,
        phone: request.query.phone,
        startDate,
        endDate,
      });

      const apiBaseUrl = getPublicApiBaseUrl(request);
      const authHeader = request.headers.authorization;
      const queryToken = (request.query as any)?.token;
      let token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : queryToken;

      if (!token && tenantId) {
        try {
          token = await (reply as any).jwtSign(
            {
              tenantId,
              userId: user?.userId,
              email: user?.email,
              roles: ['ADMIN'],
            },
            { expiresIn: '7d' }
          );
        } catch (err) {
          request.log.error({ err }, 'Failed to sign token for CSV export');
        }
      }

      const headers = [
        'Time',
        'Call ID',
        'Call SID',
        'From',
        'To',
        'Duration',
        'Status',
        'Disposition',
        'Source',
        'Recording URL',
        'All Recording URLs',
        'Recording Status',
        'Notes',
      ];

      const batchSize = 1000;
      let offset = 0;
      let hasMore = true;
      const allRows: string[][] = [];

      while (hasMore) {
        const batch = await prisma.call.findMany({
          where,
          skip: offset,
          take: batchSize,
          orderBy: [
            { createdAt: 'desc' },
            { id: 'desc' }
          ],
          include: {
            campaign: true,
            fromNumber: true,
            createdBy: { select: { firstName: true, lastName: true } },
            recordings: {
              where: { deletedAt: null },
              orderBy: { createdAt: 'desc' },
            },
          },
        });

        if (batch.length === 0) {
          hasMore = false;
          break;
        }

        const mappedBatch = batch.map(call => {
          const playbackUrls = buildRecordingPlaybackUrls(call, apiBaseUrl, token);
          
          const time = call.createdAt.toISOString();
          const callId = call.id;
          const callSid = call.callSid || '';
          const from = call.callerId || call.fromNumber?.number || '';
          const to = call.toNumber || call.targetNumber || call.did || '';
          
          const dur = call.connectedDuration || call.duration || 0;
          const duration = formatDuration(dur);

          const status = call.status;
          const disposition = call.disposition || '';
          const source = call.callSource || '';
          const recUrl = playbackUrls.primaryUrl;
          const allRecUrls = playbackUrls.allUrls;
          const recStatus = call.recordingStatus || '';
          const notes = call.dispositionNotes || '';

          return [
            time,
            callId,
            callSid,
            from,
            to,
            duration,
            status,
            disposition,
            source,
            recUrl,
            allRecUrls,
            recStatus,
            notes,
          ];
        });

        allRows.push(...mappedBatch);
        
        offset += batch.length;
        if (batch.length < batchSize) {
          hasMore = false;
        }
      }

      const csvContent = [
        headers.join(','),
        ...allRows.map(row => row.map(cell => csvEscape(cell)).join(',')),
      ].join('\n');

      const dateStr = new Date().toISOString().slice(0, 10);
      void reply.header('Content-Type', 'text/csv; charset=utf-8');
      void reply.header('Content-Disposition', `attachment; filename="call-logs-${dateStr}.csv"`);
      return reply.send(csvContent);
    }
  );

  fastify.post('/api/v1/calls', async (request, reply) => {
    const user = (request as AuthRequest).user;
    if (!user || !user.tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const body = request.body as {
      estimatedMinutes?: number;
      estimatedCost?: number;
      toNumber?: string;
    };
    const { quotaService } = await import('../services/quota-service.js');

    // Check concurrent calls quota
    const overrideToken = request.headers['x-quota-override'] as string | undefined;
    const concurrentCheck = await quotaService.checkConcurrentCalls(user.tenantId, overrideToken);
    if (!concurrentCheck.allowed) {
      void reply.code(403);
      return {
        error: {
          code: 'QUOTA_EXCEEDED',
          message: concurrentCheck.reason || 'Concurrent call limit exceeded',
          current: concurrentCheck.current,
          limit: concurrentCheck.limit,
        },
      };
    }

    // Check daily minutes quota
    const estimatedMinutes = body.estimatedMinutes || 1;
    const minutesCheck = await quotaService.checkDailyMinutes(
      user.tenantId,
      estimatedMinutes,
      overrideToken
    );
    if (!minutesCheck.allowed) {
      void reply.code(403);
      return {
        error: {
          code: 'QUOTA_EXCEEDED',
          message: minutesCheck.reason || 'Daily minute limit exceeded',
          current: minutesCheck.current,
          limit: minutesCheck.limit,
        },
      };
    }

    // Check budget
    const estimatedCost = body.estimatedCost || 0;
    const budgetCheck = await quotaService.checkBudget(user.tenantId, estimatedCost, overrideToken);
    if (!budgetCheck.allowed) {
      void reply.code(403);
      return {
        error: {
          code: 'BUDGET_EXCEEDED',
          message: budgetCheck.reason || 'Budget limit exceeded',
          current: budgetCheck.current,
          limit: budgetCheck.limit,
        },
      };
    }

    // Create call (placeholder - implement actual call creation)
    void reply.code(201);
    return {
      id: '00000000-0000-0000-0000-000000000000',
      tenantId: user.tenantId,
      toNumber: body.toNumber || '+15551234567',
      callSid: `call_${Date.now()}`,
      status: 'INITIATED',
      direction: 'OUTBOUND',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      quota: {
        concurrentCalls: concurrentCheck,
        dailyMinutes: minutesCheck,
        budget: budgetCheck,
      },
    };
  });

  fastify.get<{ Params: { callId: string } }>('/api/v1/calls/:callId', async (request, reply) => {
    const user = (request as AuthRequest).user;
    const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
    const tenantId = demoTenantId || user?.tenantId;

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();
    const { callId } = request.params;

    const call = await prisma.call.findFirst({
      where: {
        id: callId,
        tenantId,
      },
      include: {
        campaign: true,
        fromNumber: true,
        publisher: true,
        buyer: true,
        recordings: true,
        transcriptions: true,
      },
    });

    if (!call) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Call not found' } };
    }

    return {
      // Core fields
      id: call.id,
      tenantId: call.tenantId,
      callSid: call.callSid,
      externalId: call.externalId,
      createdById: call.createdById,
      status: call.status,
      direction: call.direction,

      // Timestamps
      callDate: call.createdAt,
      callCompleteTimestamp: call.callCompleteTimestamp,
      callConnectedTimestamp: call.callConnectedTimestamp,
      previouslyConnectedDate: call.previouslyConnectedDate,
      createdAt: call.createdAt,
      updatedAt: call.updatedAt,
      startedAt: call.startedAt,
      answeredAt: call.answeredAt,
      endedAt: call.endedAt,

      // Identity IDs
      campaignId: call.campaignId,
      publisherId: call.publisherId,
      buyerId: call.buyerId,
      targetId: call.targetId,
      targetGroupId: call.targetGroupId,

      // Identity Names (denormalized)
      campaignName: call.campaignName || call.campaign?.name,
      publisherName: call.publisherName || call.publisher?.name,
      buyerName: call.buyerName || call.buyer?.name,
      targetName: call.targetName,
      targetGroupName: call.targetGroupName,

      // Telephony
      callerId: call.callerId,
      callerIdAreaCode: call.callerIdAreaCode,
      callerIdState: call.callerIdState,
      did: call.did,
      toNumber: call.toNumber,
      targetNumber: call.targetNumber,
      duration: call.duration,
      durationFormatted: call.durationFormatted,
      connectedDuration: call.connectedDuration,
      connectedDurationFormatted: call.connectedDurationFormatted,
      recordingUrl: call.recordingUrl,
      recordingStatus: call.recordingStatus,
      primaryRecordingId: call.primaryRecordingId,
      recordingStartedAt: call.recordingStartedAt,
      recordingCompletedAt: call.recordingCompletedAt,
      recordingError: call.recordingError,

      // Financials
      revenue: call.revenue,
      payout: call.payout,
      profit: call.profit,
      cost: call.cost,

      // Boolean/Status
      isDuplicate: call.isDuplicate,
      converted: call.converted,
      missedCall: call.missedCall,
      blocked: call.blocked,
      paidOut: call.paidOut,
      previouslyConnected: call.previouslyConnected,

      // Reason Codes
      noPayoutReason: call.noPayoutReason,
      noConversionReason: call.noConversionReason,
      blockReason: call.blockReason,
      previouslyConnectedTarget: call.previouslyConnectedTarget,

      // Contractor Call Intelligence
      disposition: call.disposition,
      dispositionNotes: call.dispositionNotes,
      callSource: call.callSource,
      followUpAt: call.followUpAt?.toISOString() ?? null,
      followUpStatus: call.followUpStatus,

      // Related entities
      campaign: call.campaign,
      publisher: call.publisher,
      buyer: call.buyer,
      fromNumber: call.fromNumber,
      recordings: call.recordings,
      transcriptions: call.transcriptions,
    };
  });

  // ── Recording Status POST — Update recording lifecycle state ──
  fastify.post<{
    Params: { callId: string };
    Body: {
      status: 'started' | 'recording' | 'stopped' | 'processing' | 'ready' | 'error' | 'failed';
      error?: string;
    };
  }>('/api/v1/calls/:callId/recording-status', async (request, reply) => {
    const { callId } = request.params;
    const { status, error: errorMsg } = request.body || {};

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();

    // Check if call exists first
    const call = await prisma.call.findUnique({
      where: { id: callId },
    });

    if (!call) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Call not found' } };
    }

    const updateData: Record<string, any> = {};
    const now = new Date();

    switch (status) {
      case 'started':
      case 'recording':
        updateData.recordingStatus = 'RECORDING';
        if (!call.recordingStartedAt) {
          updateData.recordingStartedAt = now;
        }
        break;
      case 'stopped':
      case 'processing':
        updateData.recordingStatus = 'PROCESSING';
        updateData.recordingError = null;
        break;
      case 'ready':
        // only set READY if recordingUrl or primaryRecordingId exists
        if (!call.recordingUrl && !call.primaryRecordingId) {
          void reply.code(400);
          return {
            error: {
              code: 'INVALID_STATE',
              message:
                'Cannot set status to READY without a playable recordingUrl or primaryRecordingId',
            },
          };
        }
        updateData.recordingStatus = 'READY';
        break;
      case 'error':
      case 'failed':
        updateData.recordingStatus = 'FAILED';
        updateData.recordingError = errorMsg || 'Recording failed';
        updateData.recordingCompletedAt = now;
        
        // Try to parse HTTP code from the error message if it's there
        let uploadHttpCode: number | null = null;
        if (errorMsg) {
          const match = errorMsg.match(/HTTP (\d+)/);
          if (match) {
            uploadHttpCode = parseInt(match[1], 10);
          }
        }
        const callMetadata = (call.metadata as any) || {};
        const existingRecordingDebug = callMetadata.recordingDebug || {};
        updateData.metadata = {
          ...callMetadata,
          recordingDebug: {
            ...existingRecordingDebug,
            uploadAttemptedAt: now.toISOString(),
            uploadHttpCode,
            uploadError: errorMsg || 'Recording failed',
          },
        };
        break;
      default:
        void reply.code(400);
        return {
          error: { code: 'INVALID_STATUS', message: `Unknown status: ${status as string}` },
        };
    }

    try {
      const updatedCall = await prisma.call.update({
        where: { id: callId },
        data: updateData,
      });

      return {
        success: true,
        callId,
        recordingStatus: updatedCall.recordingStatus,
      };
    } catch (err) {
      request.log.error({ error: err, callId }, 'Failed to update recording status');
      void reply.code(500);
      return { error: { code: 'UPDATE_FAILED', message: 'Failed to update recording status' } };
    }
  });

  // ── Recording Debug GET — Debug pipeline issues for a single call ──
  fastify.get<{ Params: { callId: string } }>(
    '/api/v1/calls/:callId/recording-debug',
    async (request, reply) => {
      const { callId } = request.params;
      const prisma = (await import('../lib/prisma.js')).getPrismaClient();

      const call = await prisma.call.findUnique({
        where: { id: callId },
        include: {
          recordings: true,
        },
      });

      if (!call) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Call not found' } };
      }

      // Determine storage type
      const storageType = process.env.S3_BUCKET ? 'S3' : 'local';

      const fs = await import('fs');
      const path = await import('path');
      const localDir = process.env.LOCAL_STORAGE_DIR || '/tmp/uploads';

      const wavPath = `/recordings/${callId}.wav`;
      const tmpWavPath = `/tmp/recordings/${callId}.wav`;

      const apiRecordingsWavExists = fs.existsSync(wavPath);
      let apiRecordingsWavSize: string | null = null;
      if (apiRecordingsWavExists) {
        try {
          apiRecordingsWavSize = fs.statSync(wavPath).size.toString();
        } catch {}
      }

      const apiTmpRecordingsWavExists = fs.existsSync(tmpWavPath);
      let apiTmpRecordingsWavSize: string | null = null;
      if (apiTmpRecordingsWavExists) {
        try {
          apiTmpRecordingsWavSize = fs.statSync(tmpWavPath).size.toString();
        } catch {}
      }

      const recordingsWithFileCheck = call.recordings.map(r => {
        let fileExists: boolean | null = null;
        if (storageType === 'local' && r.storageKey) {
          const localFilePath = path.join(localDir, r.storageKey);
          fileExists = fs.existsSync(localFilePath);
        }
        return {
          id: r.id,
          callId: r.callId,
          legId: r.legId,
          url: r.url,
          storageKey: r.storageKey,
          format: r.format,
          size: r.size?.toString(),
          status: r.status,
          createdAt: r.createdAt,
          fileExists,
        };
      });

      return {
        call: {
          id: call.id,
          callSid: call.callSid,
          status: call.status,
          recordingStatus: call.recordingStatus,
          recordingUrl: call.recordingUrl,
          primaryRecordingId: call.primaryRecordingId,
          recordingError: call.recordingError,
          recordingStartedAt: call.recordingStartedAt,
          recordingCompletedAt: call.recordingCompletedAt,
          externalId: (call as any).externalId ?? null,
          callSource: (call as any).callSource ?? null,
          metadata: call.metadata,
        },
        recordings: recordingsWithFileCheck,
        diagnostics: {
          apiRecordingsWavExists,
          apiRecordingsWavSize,
          apiTmpRecordingsWavExists,
          apiTmpRecordingsWavSize,
        },
        storage: {
          type: storageType,
          bucket: process.env.S3_BUCKET || null,
          endpoint: process.env.S3_ENDPOINT || null,
          localStorageDir: localDir,
        },
      };
    }
  );

  // ── Disposition POST — Save/update disposition for a call ──
  const VALID_DISPOSITIONS = [
    'SET_APPOINTMENT',
    'SET_CALLBACK',
    'FOLLOW_UP',
    'NOT_INTERESTED',
    'NOT_QUALIFIED',
    'NO_ANSWER',
    'WRONG_NUMBER',
    'DISCONNECTED',
  ];
  const VALID_CALL_SOURCES = ['CALL_CENTER', 'SOFTPHONE', 'AI_VOICE'];
  const VALID_FOLLOW_UP_STATUSES = ['PENDING', 'COMPLETED', 'CANCELLED'];

  fastify.post<{
    Body: {
      callId?: string;
      callSid?: string;
      disposition: string;
      notes?: string;
      duration?: number;
      callerNumber?: string;
      callSource?: string;
      direction?: string;
      followUpAt?: string;
    };
  }>('/api/v1/calls/disposition', async (request, reply) => {
    const user = (request as AuthRequest).user;
    const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
    const tenantId = demoTenantId || user?.tenantId;

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const {
      callId,
      callSid,
      disposition,
      notes,
      duration,
      callerNumber,
      callSource,
      direction,
      followUpAt,
    } = request.body;

    // Validate disposition
    if (!disposition || !VALID_DISPOSITIONS.includes(disposition)) {
      void reply.code(400);
      return {
        error: {
          code: 'INVALID_DISPOSITION',
          message: `Disposition must be one of: ${VALID_DISPOSITIONS.join(', ')}`,
        },
      };
    }

    // Validate callSource if provided
    if (callSource && !VALID_CALL_SOURCES.includes(callSource)) {
      void reply.code(400);
      return {
        error: {
          code: 'INVALID_CALL_SOURCE',
          message: `Call source must be one of: ${VALID_CALL_SOURCES.join(', ')}`,
        },
      };
    }

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();

    // Find the call by callId or callSid (idempotent — supports repeated saves)
    let call = null;
    if (callId) {
      call = await prisma.call.findFirst({
        where: { id: callId, tenantId },
      });
    }
    if (!call && callSid) {
      call = await prisma.call.findFirst({
        where: { callSid, tenantId },
      });
    }

    // Build update data
    const updateData: Record<string, unknown> = {
      disposition,
      dispositionNotes: notes || null,
    };
    if (callSource) updateData.callSource = callSource;
    if (duration !== undefined) updateData.duration = duration;
    if (followUpAt) {
      updateData.followUpAt = new Date(followUpAt);
      updateData.followUpStatus = 'PENDING';
    }

    if (call) {
      const finalEndedAt = call.endedAt || new Date();
      let finalDuration = call.duration;
      if (
        duration !== undefined &&
        typeof duration === 'number' &&
        Number.isFinite(duration) &&
        duration >= 0
      ) {
        finalDuration = duration;
      } else if (finalDuration === null || finalDuration === undefined) {
        finalDuration = 0;
      }

      const recordingStatusUpdate: Record<string, unknown> = {};
      if (call.recordingStatus === 'RECORDING') {
        recordingStatusUpdate.recordingStatus = 'PROCESSING';
      } else if (call.recordingStatus === 'PENDING') {
        if (!call.answeredAt) {
          recordingStatusUpdate.recordingStatus = 'FAILED';
          recordingStatusUpdate.recordingError = 'Call was not answered, no recording generated.';
        } else {
          recordingStatusUpdate.recordingStatus = 'PROCESSING';
        }
      }

      // Update existing call record (idempotent upsert pattern)
      const updated = await prisma.call.update({
        where: { id: call.id },
        data: {
          ...updateData,
          status: 'COMPLETED',
          endedAt: finalEndedAt,
          duration: finalDuration,
          connectedDuration: call.answeredAt ? finalDuration : 0,
          ...recordingStatusUpdate,
        },
      });
      return {
        id: updated.id,
        callSid: updated.callSid,
        disposition: updated.disposition,
        dispositionNotes: updated.dispositionNotes,
        callSource: updated.callSource,
        followUpAt: updated.followUpAt?.toISOString() ?? null,
        followUpStatus: updated.followUpStatus,
        updatedAt: updated.updatedAt.toISOString(),
      };
    } else {
      // Create a new call record if none exists (e.g. softphone call not yet tracked)
      // Use actual direction from the payload instead of hardcoding OUTBOUND
      const callDirection = direction === 'INBOUND' ? 'INBOUND' : 'OUTBOUND';
      const newCall = await prisma.call.create({
        data: {
          tenantId,
          callSid: callSid || `disp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          toNumber: callerNumber || 'unknown',
          status: 'COMPLETED',
          direction: callDirection,
          createdById: user?.userId || null,
          ...updateData,
        },
      });
      void reply.code(201);
      return {
        id: newCall.id,
        callSid: newCall.callSid,
        disposition: newCall.disposition,
        dispositionNotes: newCall.dispositionNotes,
        callSource: newCall.callSource,
        followUpAt: newCall.followUpAt?.toISOString() ?? null,
        followUpStatus: newCall.followUpStatus,
        createdAt: newCall.createdAt.toISOString(),
      };
    }
  });

  // ── Disposition PATCH — Update disposition after the fact ──
  fastify.patch<{
    Params: { callId: string };
    Body: {
      disposition?: string;
      notes?: string;
      followUpAt?: string;
      followUpStatus?: string;
    };
  }>('/api/v1/calls/:callId/disposition', async (request, reply) => {
    const user = (request as AuthRequest).user;
    const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
    const tenantId = demoTenantId || user?.tenantId;

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const { callId } = request.params;
    const { disposition, notes, followUpAt, followUpStatus } = request.body;

    if (disposition && !VALID_DISPOSITIONS.includes(disposition)) {
      void reply.code(400);
      return { error: { code: 'INVALID_DISPOSITION', message: `Invalid disposition value` } };
    }

    if (followUpStatus && !VALID_FOLLOW_UP_STATUSES.includes(followUpStatus)) {
      void reply.code(400);
      return {
        error: {
          code: 'INVALID_STATUS',
          message: `Follow-up status must be one of: ${VALID_FOLLOW_UP_STATUSES.join(', ')}`,
        },
      };
    }

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();
    const call = await prisma.call.findFirst({ where: { id: callId, tenantId } });
    if (!call) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Call not found' } };
    }

    const updateData: Record<string, unknown> = {};
    if (disposition !== undefined) updateData.disposition = disposition;
    if (notes !== undefined) updateData.dispositionNotes = notes;
    if (followUpAt !== undefined) updateData.followUpAt = followUpAt ? new Date(followUpAt) : null;
    if (followUpStatus !== undefined) updateData.followUpStatus = followUpStatus;

    const updated = await prisma.call.update({
      where: { id: callId },
      data: updateData,
    });

    return {
      id: updated.id,
      disposition: updated.disposition,
      dispositionNotes: updated.dispositionNotes,
      followUpAt: updated.followUpAt?.toISOString() ?? null,
      followUpStatus: updated.followUpStatus,
      updatedAt: updated.updatedAt.toISOString(),
    };
  });

  // ── Follow-Ups GET — List upcoming and overdue follow-ups ──
  fastify.get<{
    Querystring: { status?: string; limit?: string };
  }>('/api/v1/calls/follow-ups', async (request, reply) => {
    const user = (request as AuthRequest).user;
    const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
    const tenantId = demoTenantId || user?.tenantId;

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();
    const limit = parseInt(request.query.limit || '50');
    const statusFilter = request.query.status || 'PENDING';

    const followUps = await prisma.call.findMany({
      where: {
        tenantId,
        followUpAt: { not: null },
        followUpStatus: statusFilter,
      },
      orderBy: { followUpAt: 'asc' },
      take: limit,
      select: {
        id: true,
        callSid: true,
        callerId: true,
        toNumber: true,
        disposition: true,
        dispositionNotes: true,
        callSource: true,
        followUpAt: true,
        followUpStatus: true,
        duration: true,
        createdAt: true,
      },
    });

    const now = new Date();
    return {
      data: followUps.map(f => ({
        ...f,
        followUpAt: f.followUpAt?.toISOString() ?? null,
        createdAt: f.createdAt.toISOString(),
        isOverdue: f.followUpAt ? f.followUpAt < now : false,
      })),
    };
  });
}

// Public API - Recordings (legacy placeholder routes)
export async function registerRecordingRoutes(fastify: FastifyInstance) {
  await Promise.resolve();
  // These routes are now handled by registerRecordingManagementRoutes
  // Keeping for backward compatibility
  fastify.get('/api/v1/recordings', async (_request, _reply) => {
    return {
      data: [],
      meta: {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      },
    };
  });

  fastify.get<{ Params: { recordingId: string } }>(
    '/api/v1/recordings/:recordingId',
    async (request, _reply) => {
      return {
        id: request.params.recordingId,
        callId: '00000000-0000-0000-0000-000000000000',
        url: 'https://example.com/recording.wav',
        format: 'wav',
        status: 'COMPLETED',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  );
}

// Public API - Webhooks
export async function registerWebhookRoutes(fastify: FastifyInstance) {
  await Promise.resolve();
  fastify.get<{ Querystring: { page?: string; limit?: string } }>(
    '/api/v1/webhooks',
    async (request, reply) => {
      const user = (request as AuthRequest).user;
      const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
      const tenantId = demoTenantId || user?.tenantId;

      if (!tenantId) {
        void reply.code(401);
        return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
      }

      const prisma = (await import('../lib/prisma.js')).getPrismaClient();
      const page = parseInt(request.query.page || '1');
      const limit = parseInt(request.query.limit || '20');
      const skip = (page - 1) * limit;

      const [webhooks, total] = await Promise.all([
        prisma.webhook.findMany({
          where: { tenantId },
          take: limit,
          skip,
          orderBy: { createdAt: 'desc' },
        }),
        prisma.webhook.count({ where: { tenantId } }),
      ]);

      return {
        data: webhooks.map(w => ({
          id: w.id,
          url: w.url,
          events: w.events,
          status: w.status.toLowerCase(),
          lastTriggeredAt: w.lastTriggeredAt?.toISOString() || null,
          createdAt: w.createdAt.toISOString(),
          updatedAt: w.updatedAt.toISOString(),
        })),
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    }
  );

  fastify.post<{
    Body: {
      url: string;
      events: string[];
      status?: 'ACTIVE' | 'INACTIVE';
    };
  }>('/api/v1/webhooks', async (request, reply) => {
    const user = (request as AuthRequest).user;
    const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
    const tenantId = demoTenantId || user?.tenantId;

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const body = request.body;

    if (!body.url || !body.url.trim()) {
      void reply.code(400);
      return { error: { code: 'VALIDATION_ERROR', message: 'URL is required' } };
    }

    if (!body.events || !Array.isArray(body.events) || body.events.length === 0) {
      void reply.code(400);
      return { error: { code: 'VALIDATION_ERROR', message: 'At least one event is required' } };
    }

    // Validate URL format
    try {
      new URL(body.url);
    } catch {
      void reply.code(400);
      return { error: { code: 'VALIDATION_ERROR', message: 'Invalid URL format' } };
    }

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();
    const { randomBytes } = await import('crypto');

    // Generate webhook secret
    const secret = randomBytes(32).toString('hex');

    const webhook = await prisma.webhook.create({
      data: {
        tenantId,
        url: body.url.trim(),
        events: body.events,
        secret,
        status: body.status || 'ACTIVE',
      },
    });

    // Audit log
    const { auditCreate } = await import('../services/audit.js');
    await auditCreate(
      tenantId,
      'Webhook',
      webhook.id,
      {
        url: webhook.url,
        events: webhook.events,
        status: webhook.status,
      },
      {
        userId: user?.userId,
        ipAddress: request.ip,
        requestId: request.id,
      }
    );

    void reply.code(201);
    return {
      id: webhook.id,
      tenantId: webhook.tenantId,
      url: webhook.url,
      events: webhook.events,
      status: webhook.status.toLowerCase(),
      createdAt: webhook.createdAt.toISOString(),
      updatedAt: webhook.updatedAt.toISOString(),
    };
  });

  fastify.get<{ Params: { webhookId: string } }>(
    '/api/v1/webhooks/:webhookId',
    async (request, reply) => {
      const user = (request as AuthRequest).user;
      const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
      const tenantId = demoTenantId || user?.tenantId;

      if (!tenantId) {
        void reply.code(401);
        return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
      }

      const { webhookId } = request.params as { webhookId: string };
      const prisma = (await import('../lib/prisma.js')).getPrismaClient();

      const webhook = await prisma.webhook.findFirst({
        where: {
          id: webhookId,
          tenantId,
        },
      });

      if (!webhook) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Webhook not found' } };
      }

      return {
        id: webhook.id,
        tenantId: webhook.tenantId,
        url: webhook.url,
        events: webhook.events,
        status: webhook.status.toLowerCase(),
        lastTriggeredAt: webhook.lastTriggeredAt?.toISOString() || null,
        createdAt: webhook.createdAt.toISOString(),
        updatedAt: webhook.updatedAt.toISOString(),
      };
    }
  );

  fastify.patch<{
    Params: { webhookId: string };
    Body: {
      url?: string;
      events?: string[];
      status?: 'ACTIVE' | 'INACTIVE' | 'FAILED';
    };
  }>('/api/v1/webhooks/:webhookId', async (request, reply) => {
    const user = (request as AuthRequest).user;
    const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
    const tenantId = demoTenantId || user?.tenantId;

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const { webhookId } = request.params as { webhookId: string };
    const body = request.body;
    const prisma = (await import('../lib/prisma.js')).getPrismaClient();

    const existingWebhook = await prisma.webhook.findFirst({
      where: {
        id: webhookId,
        tenantId,
      },
    });

    if (!existingWebhook) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Webhook not found' } };
    }

    const updateData: Record<string, unknown> = {};
    if (body.url !== undefined) {
      try {
        new URL(body.url);
        updateData.url = body.url.trim();
      } catch {
        void reply.code(400);
        return { error: { code: 'VALIDATION_ERROR', message: 'Invalid URL format' } };
      }
    }
    if (body.events !== undefined) {
      if (!Array.isArray(body.events) || body.events.length === 0) {
        void reply.code(400);
        return { error: { code: 'VALIDATION_ERROR', message: 'At least one event is required' } };
      }
      updateData.events = body.events;
    }
    if (body.status !== undefined) {
      updateData.status = body.status.toUpperCase();
    }

    const updatedWebhook = await prisma.webhook.update({
      where: { id: webhookId },
      data: updateData,
    });

    // Audit log
    const { auditUpdate } = await import('../services/audit.js');
    await auditUpdate(tenantId, 'Webhook', webhookId, existingWebhook, updatedWebhook, {
      userId: user?.userId,
      ipAddress: request.ip,
      requestId: request.id,
    });

    return {
      id: updatedWebhook.id,
      tenantId: updatedWebhook.tenantId,
      url: updatedWebhook.url,
      events: updatedWebhook.events,
      status: updatedWebhook.status.toLowerCase(),
      lastTriggeredAt: updatedWebhook.lastTriggeredAt?.toISOString() || null,
      createdAt: updatedWebhook.createdAt.toISOString(),
      updatedAt: updatedWebhook.updatedAt.toISOString(),
    };
  });

  fastify.delete<{ Params: { webhookId: string } }>(
    '/api/v1/webhooks/:webhookId',
    async (request, reply) => {
      const user = (request as AuthRequest).user;
      const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
      const tenantId = demoTenantId || user?.tenantId;

      if (!tenantId) {
        void reply.code(401);
        return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
      }

      const { webhookId } = request.params as { webhookId: string };
      const prisma = (await import('../lib/prisma.js')).getPrismaClient();

      const webhook = await prisma.webhook.findFirst({
        where: {
          id: webhookId,
          tenantId,
        },
      });

      if (!webhook) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Webhook not found' } };
      }

      await prisma.webhook.delete({
        where: { id: webhookId },
      });

      // Audit log
      const { auditCreate } = await import('../services/audit.js');
      await auditCreate(
        tenantId,
        'Webhook',
        webhookId,
        { deleted: true, url: webhook.url },
        {
          userId: user?.userId,
          ipAddress: request.ip,
          requestId: request.id,
        }
      );

      return reply.code(204).send();
    }
  );
}

// Public API - Users
export async function registerUserRoutes(fastify: FastifyInstance) {
  await Promise.resolve();
  fastify.get<{ Querystring: { page?: string; limit?: string } }>(
    '/api/v1/users',
    async (request, reply) => {
      const user = (request as AuthRequest).user;
      const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
      const tenantId = demoTenantId || user?.tenantId;

      if (!tenantId) {
        void reply.code(401);
        return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
      }

      const prisma = (await import('../lib/prisma.js')).getPrismaClient();
      const page = parseInt(request.query.page || '1');
      const limit = parseInt(request.query.limit || '20');
      const skip = (page - 1) * limit;

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where: { tenantId },
          take: limit,
          skip,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            status: true,
            createdAt: true,
            lastLoginAt: true,
            buyerId: true,
            buyer: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
            roles: {
              select: {
                role: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        }),
        prisma.user.count({ where: { tenantId } }),
      ]);

      return {
        data: users.map(u => ({
          id: u.id,
          email: u.email,
          firstName: u.firstName,
          lastName: u.lastName,
          status: u.status.toLowerCase(),
          roles: u.roles.map(ur => ur.role.name.toLowerCase()),
          buyerId: u.buyerId,
          buyerName: u.buyer?.name || null,
          buyerCode: u.buyer?.code || null,
          invitedAt: u.createdAt.toISOString(),
          lastLoginAt: u.lastLoginAt?.toISOString() || null,
        })),
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    }
  );

  fastify.post<{
    Body: {
      email: string;
      firstName?: string;
      lastName?: string;
      role?: string;
      buyerId?: string;
      createNewBuyer?: boolean;
      newBuyerName?: string;
      roleIds?: string[];
    };
  }>('/api/v1/users/invite', async (request, reply) => {
    const user = (request as AuthRequest).user;
    const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
    const tenantId = demoTenantId || user?.tenantId;

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const body = request.body;

    if (!body.email || !body.email.trim()) {
      void reply.code(400);
      return { error: { code: 'VALIDATION_ERROR', message: 'Email is required' } };
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.email)) {
      void reply.code(400);
      return { error: { code: 'VALIDATION_ERROR', message: 'Invalid email format' } };
    }

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();

    // Validate role
    const requestedRole = body.role?.toUpperCase() || 'ANALYST';
    const validRoles = ['ADMIN', 'OWNER', 'ANALYST', 'AGENT', 'BUYER'];
    if (!validRoles.includes(requestedRole)) {
      void reply.code(400);
      return {
        error: {
          code: 'VALIDATION_ERROR',
          message: `Invalid role. Must be one of: ${validRoles.join(', ')}`,
        },
      };
    }

    // BUYER role requires buyerId OR createNewBuyer
    if (requestedRole === 'BUYER' && !body.buyerId && !body.createNewBuyer) {
      void reply.code(400);
      return {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'buyerId or createNewBuyer is required for BUYER role',
        },
      };
    }

    // Auto-create buyer if requested
    let buyerRecord = null;
    if (requestedRole === 'BUYER' && body.createNewBuyer && body.newBuyerName) {
      // Generate a unique code for the buyer
      const generateCode = () => {
        const chars = '0123456789ABCDEF';
        let result = '';
        for (let i = 0; i < 8; i++) {
          result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
      };

      buyerRecord = await prisma.buyer.create({
        data: {
          tenantId: tenantId,
          name: body.newBuyerName.trim(),
          code: generateCode(),
          status: 'ACTIVE',
          billingType: 'UPFRONT',
        },
      });
      body.buyerId = buyerRecord.id;
    } else if (body.buyerId) {
      // Validate buyerId exists if provided
      buyerRecord = await prisma.buyer.findUnique({
        where: { id: body.buyerId },
      });
      if (!buyerRecord) {
        void reply.code(400);
        return {
          error: { code: 'VALIDATION_ERROR', message: 'Invalid buyerId - buyer not found' },
        };
      }
      // Ensure the buyer belongs to the same tenant
      if (buyerRecord.tenantId !== tenantId) {
        void reply.code(400);
        return {
          error: { code: 'VALIDATION_ERROR', message: 'Buyer does not belong to your tenant' },
        };
      }
    }

    // Constraint: Cannot have ADMIN role with buyerId (internal vs external user)
    if ((requestedRole === 'ADMIN' || requestedRole === 'OWNER') && body.buyerId) {
      void reply.code(400);
      return {
        error: {
          code: 'VALIDATION_ERROR',
          message:
            'ADMIN and OWNER roles cannot be assigned to external buyer users. Use BUYER role instead.',
        },
      };
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: {
        email: body.email.toLowerCase().trim(),
      },
    });

    if (existingUser) {
      void reply.code(409);
      return { error: { code: 'CONFLICT', message: 'User with this email already exists' } };
    }

    // Generate temporary password
    const { randomBytes } = await import('crypto');
    const tempPassword = randomBytes(16).toString('hex');
    const { hash } = await import('bcryptjs');
    const passwordHash = await hash(tempPassword, 10);

    // Get role ID for the requested role
    const roleRecord = await prisma.role.findUnique({
      where: { name: requestedRole },
    });

    if (!roleRecord) {
      void reply.code(400);
      return {
        error: { code: 'ROLE_NOT_FOUND', message: `Role ${requestedRole} not found in system` },
      };
    }

    // Create user with role and optional buyerId
    const newUser = await prisma.user.create({
      data: {
        tenantId,
        email: body.email.toLowerCase().trim(),
        passwordHash,
        firstName: body.firstName || null,
        lastName: body.lastName || null,
        status: 'ACTIVE',
        buyerId: body.buyerId || null,
        metadata: {
          tempPassword: true, // Flag that password needs to be changed
          invitedBy: user?.userId,
        },
        roles: {
          create: [
            {
              roleId: roleRecord.id,
            },
          ],
        },
      },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
        buyer: true,
      },
    });

    // Audit log
    const { auditCreate } = await import('../services/audit.js');
    await auditCreate(
      tenantId,
      'User',
      newUser.id,
      {
        email: newUser.email,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        roles: newUser.roles.map(r => r.role.name),
        buyerId: newUser.buyerId,
        buyerName: newUser.buyer?.name || null,
      },
      {
        userId: user?.userId,
        ipAddress: request.ip,
        requestId: request.id,
      }
    );

    // TODO: Send invitation email with temp password
    // For now, we'll just return success (in production, send email)

    void reply.code(201);
    return {
      id: newUser.id,
      email: newUser.email,
      firstName: newUser.firstName,
      lastName: newUser.lastName,
      status: newUser.status.toLowerCase(),
      roles: newUser.roles.map(r => r.role.name.toLowerCase()),
      buyerId: newUser.buyerId,
      buyerName: newUser.buyer?.name || null,
      createdAt: newUser.createdAt.toISOString(),
      // In production, don't return temp password - send via email
      tempPassword: tempPassword, // Only for development/testing
    };
  });

  fastify.patch<{
    Params: { userId: string };
    Body: {
      firstName?: string;
      lastName?: string;
      status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
      metadata?: Record<string, unknown>;
    };
  }>('/api/v1/users/:userId', async (request, reply) => {
    try {
      const user = (request as AuthRequest).user;
      const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
      const tenantId = demoTenantId || user?.tenantId;

      if (!tenantId) {
        void reply.code(401);
        return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
      }

      const { userId } = request.params;
      const body = request.body;
      const prisma = (await import('../lib/prisma.js')).getPrismaClient();

      // Verify user exists and belongs to tenant
      const existingUser = await prisma.user.findFirst({
        where: {
          id: userId,
          tenantId: tenantId,
        },
      });

      if (!existingUser) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'User not found' } };
      }

      const updateData: Record<string, unknown> = {};
      if (body.firstName !== undefined) {
        updateData.firstName = body.firstName;
      }
      if (body.lastName !== undefined) {
        updateData.lastName = body.lastName;
      }
      if (body.status !== undefined) {
        updateData.status = body.status;
      }

      let metadataChanged = false;
      let newExtension: string | null = null;
      let oldExtension: string | null = null;

      if (body.metadata !== undefined) {
        const currentMetadata = (existingUser.metadata as Record<string, any>) || {};
        const mergedMetadata = {
          ...currentMetadata,
          ...body.metadata,
        };
        updateData.metadata = mergedMetadata;

        oldExtension = currentMetadata.extension || null;
        newExtension = body.metadata.extension !== undefined ? (body.metadata.extension as string | null) : oldExtension;
        if (newExtension !== oldExtension) {
          metadataChanged = true;
        }
      }

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: updateData,
        include: {
          roles: {
            include: {
              role: true,
            },
          },
          buyer: true,
        },
      });

      // Audit log
      const { auditUpdate } = await import('../services/audit.js');
      await auditUpdate(tenantId, 'User', userId, existingUser, updatedUser, {
        userId: user?.userId,
        ipAddress: request.ip,
        requestId: request.id,
      });

      // Sync inbound DidRoute if user's extension changed
      if (metadataChanged) {
        const phoneNumbers = await prisma.phoneNumber.findMany({
          where: { userId, tenantId, status: 'ACTIVE' },
        });

        const { didRouteService } = await import('../services/did-route-service.js');
        for (const num of phoneNumbers) {
          await didRouteService.syncDidRouteForNumber(num.id, tenantId);
        }

        const { logger } = await import('../lib/logger.js');
        logger.info({
          msg: 'User extension updated; synced did routes for assigned phone numbers',
          userId,
          phoneNumbersCount: phoneNumbers.length,
          oldExtension,
          newExtension,
        });
      }

      return {
        id: updatedUser.id,
        email: updatedUser.email,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        status: updatedUser.status.toLowerCase(),
        roles: updatedUser.roles.map(r => r.role.name.toLowerCase()),
        buyerId: updatedUser.buyerId,
        buyerName: updatedUser.buyer?.name || null,
        metadata: updatedUser.metadata,
        createdAt: updatedUser.createdAt.toISOString(),
      };
    } catch (error: unknown) {
      void reply.code(400);
      return {
        error: {
          code: 'UPDATE_FAILED',
          message: (error as Error).message || 'Failed to update user',
        },
      };
    }
  });
}

// Public API - Reporting
export async function registerReportingRoutes(fastify: FastifyInstance) {
  await Promise.resolve();
  const { analyticsService } = await import('../services/analytics.js');
  const { getPrismaClient } = await import('../lib/prisma.js');
  const { createHash } = await import('crypto');

  // Optional authentication hook - try to authenticate but don't fail if it doesn't work
  fastify.addHook('onRequest', async (request, _reply) => {
    const authHeader = request.headers.authorization;
    const apiKey = request.headers['x-api-key'] as string;

    // Try to authenticate without failing the request
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const token = authHeader.substring(7);
        const decoded = await (
          request as unknown as { jwtVerify: (token: string) => Promise<AuthenticatedUser> }
        ).jwtVerify(token);
        (request as AuthRequest).user = decoded;
      } catch (err) {
        // Ignore - will use default tenant
      }
    } else if (apiKey) {
      try {
        const prisma = getPrismaClient();
        const keyHash = createHash('sha256').update(apiKey).digest('hex');
        const dbApiKey = await prisma.apiKey.findUnique({
          where: { keyHash },
          include: { tenant: true },
        });

        if (
          dbApiKey &&
          dbApiKey.status === 'ACTIVE' &&
          (!dbApiKey.expiresAt || dbApiKey.expiresAt > new Date()) &&
          dbApiKey.tenant.status === 'ACTIVE'
        ) {
          const scopes =
            dbApiKey.scopes && Array.isArray(dbApiKey.scopes) ? (dbApiKey.scopes as string[]) : [];
          (request as AuthRequest).user = {
            tenantId: dbApiKey.tenantId,
            apiKeyId: dbApiKey.id,
            scopes,
          };
        }
      } catch (err) {
        // Ignore - will use default tenant
      }
    }
  });

  // Helper to get authenticated user profile (role, buyerId, publisherId)
  async function getUserProfile(request: FastifyRequest, prisma: any) {
    const user = (request as AuthRequest).user;
    let userRoles: string[] = [];
    let buyerId: string | null = null;
    let publisherId: string | null = null;

    if (user?.userId) {
      const userRecord = await prisma.user.findUnique({
        where: { id: user.userId },
        include: { roles: { include: { role: true } } },
      });
      if (userRecord) {
        userRoles = userRecord.roles.map((ur: any) => ur.role.name) || [];
        buyerId = userRecord.buyerId || null;
        publisherId = (userRecord.metadata as any)?.publisherId || null;
      }
    }
    const isAdminOrOwner = userRoles.some(role => role === 'ADMIN' || role === 'OWNER');
    return {
      isAdminOrOwner,
      userRoles,
      buyerId,
      publisherId,
    };
  }

  // Helper to generate CSV
  function toCsv(headers: string[], rows: any[][]): string {
    const formatCell = (val: any) => {
      if (val === null || val === undefined) return '';
      const str = String(val);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };
    const headerLine = headers.map(formatCell).join(',');
    const rowLines = rows.map(r => r.map(formatCell).join(','));
    return [headerLine, ...rowLines].join('\n');
  }

  fastify.get<{
    Querystring: {
      startDate?: string;
      endDate?: string;
      campaignId?: string;
      publisherId?: string;
      buyerId?: string;
      granularity?: 'hour' | 'day';
    };
  }>('/api/v1/reporting/metrics', async (request, _reply) => {
    const user = (request as AuthRequest).user;
    const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
    const tenantId = demoTenantId || user?.tenantId || 'default';
    const startDate = request.query.startDate
      ? new Date(request.query.startDate)
      : new Date(Date.now() - 24 * 60 * 60 * 1000); // Default: last 24 hours
    const endDate = request.query.endDate ? new Date(request.query.endDate) : new Date();

    const filters = {
      tenantId,
      demoTenantId,
      startDate,
      endDate,
      campaignId: request.query.campaignId,
      publisherId: request.query.publisherId,
      buyerId: request.query.buyerId,
      granularity: request.query.granularity || 'hour',
    };

    const result = await analyticsService.getMetrics(filters);
    return result;
  });

  fastify.get('/api/v1/reporting/calls', async (request, _reply) => {
    const tenantId = (request as AuthRequest).user?.tenantId || 'default';
    const startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const endDate = new Date();

    const filters = {
      tenantId,
      startDate,
      endDate,
      granularity: 'hour' as const,
    };

    const result = await analyticsService.getMetrics(filters);
    return result;
  });

  fastify.get<{
    Params: { campaignId: string };
    Querystring: { startDate?: string; endDate?: string };
  }>('/api/v1/reporting/campaigns/:campaignId', async (request, _reply) => {
    const tenantId = (request as AuthRequest).user?.tenantId || 'default';
    const startDate = request.query.startDate
      ? new Date(request.query.startDate)
      : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // Default: last 7 days
    const endDate = request.query.endDate ? new Date(request.query.endDate) : new Date();

    const filters = {
      tenantId,
      startDate,
      endDate,
      campaignId: request.params.campaignId,
      granularity: 'day' as const,
    };

    const result = await analyticsService.getMetrics(filters);
    return {
      campaignId: request.params.campaignId,
      ...result,
    };
  });

  // ── Dashboard Stats (contractor KPIs from Call model) ──
  fastify.get<{
    Querystring: { startDate?: string; endDate?: string };
  }>('/api/v1/dashboard/stats', async (request, _reply) => {
    const tenantId = (request as AuthRequest).user?.tenantId || 'default';
    const prisma = getPrismaClient();

    // Parse date range — default to current month
    const now = new Date();
    const startDate = request.query.startDate
      ? new Date(request.query.startDate)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = request.query.endDate ? new Date(request.query.endDate) : now;

    const dateFilter = {
      createdAt: { gte: startDate, lte: endDate },
    };

    const whereClause = { tenantId, ...dateFilter };

    // Non-connected dispositions (excluded from connected count)
    const nonConnectedDispositions = ['NO_ANSWER', 'WRONG_NUMBER', 'DISCONNECTED'];

    // Run all aggregations in parallel
    const [
      totalCalls,
      appointmentsSet,
      callbacksScheduled,
      followUpsDue,
      connectedCalls,
      dispositionBreakdown,
    ] = await Promise.all([
      // Total calls in range
      prisma.call.count({ where: whereClause }),

      // Appointments set
      prisma.call.count({
        where: { ...whereClause, disposition: 'SET_APPOINTMENT' },
      }),

      // Callbacks scheduled
      prisma.call.count({
        where: { ...whereClause, disposition: 'SET_CALLBACK' },
      }),

      // Follow-ups due (pending, followUpAt in the future or overdue)
      prisma.call.count({
        where: {
          tenantId,
          followUpStatus: 'PENDING',
          followUpAt: { not: null },
        },
      }),

      // Connected calls = total minus non-connected dispositions
      prisma.call.count({
        where: {
          ...whereClause,
          OR: [
            { disposition: { notIn: nonConnectedDispositions } },
            { disposition: null }, // Calls without disposition are counted as connected
          ],
        },
      }),

      // Disposition breakdown
      prisma.call.groupBy({
        by: ['disposition'],
        where: { ...whereClause, disposition: { not: null } },
        _count: { id: true },
      }),
    ]);

    // Appointment Rate = appointments / connected calls
    const appointmentRate =
      connectedCalls > 0 ? Math.round((appointmentsSet / connectedCalls) * 10000) / 100 : 0;

    // Build disposition breakdown map
    const dispositions: Record<string, number> = {};
    for (const entry of dispositionBreakdown) {
      if (entry.disposition) {
        dispositions[entry.disposition] = entry._count.id;
      }
    }

    return {
      totalCalls,
      connectedCalls,
      appointmentsSet,
      callbacksScheduled,
      followUpsDue,
      appointmentRate,
      dispositions,
      dateRange: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
    };
  });

  // ── Publisher Revenue Report ──
  fastify.get<{
    Querystring: {
      startDate?: string;
      endDate?: string;
      campaignId?: string;
      publisherId?: string;
    };
  }>('/api/v1/reports/publisher-revenue', async (request, reply) => {
    const prisma = getPrismaClient();
    const { isAdminOrOwner, userRoles, publisherId: userPubId } = await getUserProfile(request, prisma);
    
    // Authorization check
    if (!isAdminOrOwner && !userRoles.includes('PUBLISHER')) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const user = (request as AuthRequest).user;
    const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
    const tenantId = demoTenantId || user?.tenantId;
    if (!tenantId) return reply.code(401).send({ error: 'Unauthorized' });

    const startDate = request.query.startDate ? new Date(request.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = request.query.endDate ? new Date(request.query.endDate) : new Date();

    let targetPublisherId = request.query.publisherId || null;
    if (userRoles.includes('PUBLISHER') && !isAdminOrOwner) {
      targetPublisherId = userPubId;
    }

    const calls = await prisma.call.findMany({
      where: {
        tenantId,
        createdAt: { gte: startDate, lte: endDate },
        ...(request.query.campaignId ? { campaignId: request.query.campaignId } : {}),
        ...(targetPublisherId ? { publisherId: targetPublisherId } : {}),
      },
      select: {
        id: true,
        publisherId: true,
        publisherName: true,
        campaignId: true,
        campaignName: true,
        did: true,
        billable: true,
        publisherPayoutAmount: true,
        connectedDuration: true,
        duration: true,
      },
    });

    const groupsMap = new Map<string, any>();
    let totalCalls = 0;
    let billableCalls = 0;
    let nonBillableCalls = 0;
    let totalRevenue = new Prisma.Decimal(0);
    let totalDuration = 0;

    for (const call of calls) {
      const pubId = call.publisherId || 'unknown';
      const pubName = call.publisherName || 'Unknown Publisher';
      const campId = call.campaignId || 'unknown';
      const campName = call.campaignName || 'Unknown Campaign';
      const did = call.did || 'unknown';
      const key = `${pubId}_${campId}_${did}`;

      totalCalls++;
      if (call.billable) billableCalls++;
      else nonBillableCalls++;

      const payout = call.publisherPayoutAmount ? new Prisma.Decimal(call.publisherPayoutAmount) : new Prisma.Decimal(0);
      totalRevenue = totalRevenue.plus(payout);

      const dur = call.connectedDuration !== null && call.connectedDuration !== undefined
        ? call.connectedDuration 
        : (call.duration || 0);
      totalDuration += dur;

      if (!groupsMap.has(key)) {
        groupsMap.set(key, {
          publisherId: pubId,
          publisherName: pubName,
          campaignId: campId,
          campaignName: campName,
          trackingNumber: did,
          totalCalls: 0,
          billableCalls: 0,
          nonBillableCalls: 0,
          totalDuration: 0,
          publisherRevenue: new Prisma.Decimal(0),
        });
      }

      const g = groupsMap.get(key);
      g.totalCalls++;
      if (call.billable) g.billableCalls++;
      else g.nonBillableCalls++;
      g.totalDuration += dur;
      g.publisherRevenue = g.publisherRevenue.plus(payout);
    }

    const rows = [...groupsMap.values()].map(g => {
      const billableRate = g.totalCalls > 0 ? (g.billableCalls / g.totalCalls) : 0;
      const averageDuration = g.totalCalls > 0 ? Math.round(g.totalDuration / g.totalCalls) : 0;
      const payoutPerBillableCall = g.billableCalls > 0 
        ? g.publisherRevenue.dividedBy(g.billableCalls).toFixed(4)
        : '0.0000';

      return {
        publisherId: g.publisherId,
        publisherName: g.publisherName,
        campaignId: g.campaignId,
        campaignName: g.campaignName,
        trackingNumber: g.trackingNumber,
        totalCalls: g.totalCalls,
        billableCalls: g.billableCalls,
        nonBillableCalls: g.nonBillableCalls,
        billableRate,
        averageDuration,
        payoutPerBillableCall,
        publisherRevenue: g.publisherRevenue.toFixed(4),
      };
    });

    const overallBillableRate = totalCalls > 0 ? (billableCalls / totalCalls) : 0;
    const overallAvgDuration = totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0;

    return {
      totals: {
        totalCalls,
        billableCalls,
        nonBillableCalls,
        averageDuration: overallAvgDuration,
        billableRate: overallBillableRate,
        publisherRevenue: totalRevenue.toFixed(4),
      },
      rows,
    };
  });

  // ── Publisher Revenue CSV Export ──
  fastify.get<{
    Querystring: {
      startDate?: string;
      endDate?: string;
      campaignId?: string;
      publisherId?: string;
    };
  }>('/api/v1/reports/publisher-revenue/export.csv', async (request, reply) => {
    const prisma = getPrismaClient();
    const { isAdminOrOwner, userRoles, publisherId: userPubId } = await getUserProfile(request, prisma);
    
    if (!isAdminOrOwner && !userRoles.includes('PUBLISHER')) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const user = (request as AuthRequest).user;
    const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
    const tenantId = demoTenantId || user?.tenantId;
    if (!tenantId) return reply.code(401).send({ error: 'Unauthorized' });

    const startDate = request.query.startDate ? new Date(request.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = request.query.endDate ? new Date(request.query.endDate) : new Date();

    let targetPublisherId = request.query.publisherId || null;
    if (userRoles.includes('PUBLISHER') && !isAdminOrOwner) {
      targetPublisherId = userPubId;
    }

    const calls = await prisma.call.findMany({
      where: {
        tenantId,
        createdAt: { gte: startDate, lte: endDate },
        ...(request.query.campaignId ? { campaignId: request.query.campaignId } : {}),
        ...(targetPublisherId ? { publisherId: targetPublisherId } : {}),
      },
      select: {
        publisherName: true,
        campaignName: true,
        did: true,
        billable: true,
        publisherPayoutAmount: true,
        connectedDuration: true,
        duration: true,
      },
    });

    const groupsMap = new Map<string, any>();
    for (const call of calls) {
      const pubName = call.publisherName || 'Unknown Publisher';
      const campName = call.campaignName || 'Unknown Campaign';
      const did = call.did || 'unknown';
      const key = `${pubName}_${campName}_${did}`;

      const payout = call.publisherPayoutAmount ? new Prisma.Decimal(call.publisherPayoutAmount) : new Prisma.Decimal(0);
      const dur = call.connectedDuration !== null && call.connectedDuration !== undefined
        ? call.connectedDuration 
        : (call.duration || 0);

      if (!groupsMap.has(key)) {
        groupsMap.set(key, {
          publisherName: pubName,
          campaignName: campName,
          trackingNumber: did,
          totalCalls: 0,
          billableCalls: 0,
          nonBillableCalls: 0,
          totalDuration: 0,
          publisherRevenue: new Prisma.Decimal(0),
        });
      }

      const g = groupsMap.get(key);
      g.totalCalls++;
      if (call.billable) g.billableCalls++;
      else g.nonBillableCalls++;
      g.totalDuration += dur;
      g.publisherRevenue = g.publisherRevenue.plus(payout);
    }

    const rows = [...groupsMap.values()].map(g => {
      const billableRate = g.totalCalls > 0 ? (g.billableCalls / g.totalCalls) : 0;
      const averageDuration = g.totalCalls > 0 ? Math.round(g.totalDuration / g.totalCalls) : 0;
      const payoutPerBillableCall = g.billableCalls > 0 
        ? g.publisherRevenue.dividedBy(g.billableCalls).toFixed(4)
        : '0.0000';

      return [
        g.publisherName,
        g.campaignName,
        g.trackingNumber,
        g.totalCalls,
        g.billableCalls,
        g.nonBillableCalls,
        (billableRate * 100).toFixed(2) + '%',
        averageDuration,
        payoutPerBillableCall,
        g.publisherRevenue.toFixed(4),
      ];
    });

    const csvHeaders = ['Publisher', 'Campaign', 'Tracking Number', 'Total Calls', 'Billable Calls', 'Non-Billable Calls', 'Billable Rate (%)', 'Avg Duration (s)', 'Payout / Billable Call ($)', 'Publisher Revenue ($)'];
    const csvContent = toCsv(csvHeaders, rows);
    void reply
      .type('text/csv')
      .header('Content-Disposition', 'attachment; filename="publisher_revenue_report.csv"')
      .send(csvContent);
  });

  // ── Buyer Costs Report ──
  fastify.get<{
    Querystring: {
      startDate?: string;
      endDate?: string;
      campaignId?: string;
      buyerId?: string;
    };
  }>('/api/v1/reports/buyer-costs', async (request, reply) => {
    const prisma = getPrismaClient();
    const { isAdminOrOwner, userRoles, buyerId: userBuyerId } = await getUserProfile(request, prisma);

    if (!isAdminOrOwner && !userRoles.includes('BUYER')) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const user = (request as AuthRequest).user;
    const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
    const tenantId = demoTenantId || user?.tenantId;
    if (!tenantId) return reply.code(401).send({ error: 'Unauthorized' });

    const startDate = request.query.startDate ? new Date(request.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = request.query.endDate ? new Date(request.query.endDate) : new Date();

    let targetBuyerId = request.query.buyerId || null;
    if (userRoles.includes('BUYER') && !isAdminOrOwner) {
      targetBuyerId = userBuyerId;
    }

    const calls = await prisma.call.findMany({
      where: {
        tenantId,
        createdAt: { gte: startDate, lte: endDate },
        ...(request.query.campaignId ? { campaignId: request.query.campaignId } : {}),
        ...(targetBuyerId ? { buyerId: targetBuyerId } : {}),
      },
      select: {
        id: true,
        buyerId: true,
        buyerName: true,
        campaignId: true,
        campaignName: true,
        targetNumber: true,
        billable: true,
        buyerBillableAmount: true,
        connectedDuration: true,
        duration: true,
      },
    });

    const groupsMap = new Map<string, any>();
    let totalCalls = 0;
    let billableCalls = 0;
    let nonBillableCalls = 0;
    let totalCost = new Prisma.Decimal(0);
    let totalDuration = 0;

    for (const call of calls) {
      const bId = call.buyerId || 'unknown';
      const bName = call.buyerName || 'Unknown Buyer';
      const campId = call.campaignId || 'unknown';
      const campName = call.campaignName || 'Unknown Campaign';
      const dest = call.targetNumber || 'unknown';
      const key = `${bId}_${campId}_${dest}`;

      totalCalls++;
      if (call.billable) billableCalls++;
      else nonBillableCalls++;

      const cost = call.buyerBillableAmount ? new Prisma.Decimal(call.buyerBillableAmount) : new Prisma.Decimal(0);
      totalCost = totalCost.plus(cost);

      const dur = call.connectedDuration !== null && call.connectedDuration !== undefined
        ? call.connectedDuration 
        : (call.duration || 0);
      totalDuration += dur;

      if (!groupsMap.has(key)) {
        groupsMap.set(key, {
          buyerId: bId,
          buyerName: bName,
          campaignId: campId,
          campaignName: campName,
          destinationNumber: dest,
          totalCalls: 0,
          billableCalls: 0,
          nonBillableCalls: 0,
          totalDuration: 0,
          buyerCost: new Prisma.Decimal(0),
        });
      }

      const g = groupsMap.get(key);
      g.totalCalls++;
      if (call.billable) g.billableCalls++;
      else g.nonBillableCalls++;
      g.totalDuration += dur;
      g.buyerCost = g.buyerCost.plus(cost);
    }

    const rows = [...groupsMap.values()].map(g => {
      const billableRate = g.totalCalls > 0 ? (g.billableCalls / g.totalCalls) : 0;
      const averageDuration = g.totalCalls > 0 ? Math.round(g.totalDuration / g.totalCalls) : 0;
      const pricePerBillableCall = g.billableCalls > 0 
        ? g.buyerCost.dividedBy(g.billableCalls).toFixed(4)
        : '0.0000';

      return {
        buyerId: g.buyerId,
        buyerName: g.buyerName,
        campaignId: g.campaignId,
        campaignName: g.campaignName,
        destinationNumber: g.destinationNumber,
        totalCalls: g.totalCalls,
        billableCalls: g.billableCalls,
        nonBillableCalls: g.nonBillableCalls,
        billableRate,
        averageDuration,
        pricePerBillableCall,
        buyerCost: g.buyerCost.toFixed(4),
      };
    });

    const overallBillableRate = totalCalls > 0 ? (billableCalls / totalCalls) : 0;
    const overallAvgDuration = totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0;

    return {
      totals: {
        totalCalls,
        billableCalls,
        nonBillableCalls,
        averageDuration: overallAvgDuration,
        billableRate: overallBillableRate,
        buyerCost: totalCost.toFixed(4),
      },
      rows,
    };
  });

  // ── Buyer Costs CSV Export ──
  fastify.get<{
    Querystring: {
      startDate?: string;
      endDate?: string;
      campaignId?: string;
      buyerId?: string;
    };
  }>('/api/v1/reports/buyer-costs/export.csv', async (request, reply) => {
    const prisma = getPrismaClient();
    const { isAdminOrOwner, userRoles, buyerId: userBuyerId } = await getUserProfile(request, prisma);

    if (!isAdminOrOwner && !userRoles.includes('BUYER')) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const user = (request as AuthRequest).user;
    const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
    const tenantId = demoTenantId || user?.tenantId;
    if (!tenantId) return reply.code(401).send({ error: 'Unauthorized' });

    const startDate = request.query.startDate ? new Date(request.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = request.query.endDate ? new Date(request.query.endDate) : new Date();

    let targetBuyerId = request.query.buyerId || null;
    if (userRoles.includes('BUYER') && !isAdminOrOwner) {
      targetBuyerId = userBuyerId;
    }

    const calls = await prisma.call.findMany({
      where: {
        tenantId,
        createdAt: { gte: startDate, lte: endDate },
        ...(request.query.campaignId ? { campaignId: request.query.campaignId } : {}),
        ...(targetBuyerId ? { buyerId: targetBuyerId } : {}),
      },
      select: {
        buyerName: true,
        campaignName: true,
        targetNumber: true,
        billable: true,
        buyerBillableAmount: true,
        connectedDuration: true,
        duration: true,
      },
    });

    const groupsMap = new Map<string, any>();
    for (const call of calls) {
      const bName = call.buyerName || 'Unknown Buyer';
      const campName = call.campaignName || 'Unknown Campaign';
      const dest = call.targetNumber || 'unknown';
      const key = `${bName}_${campName}_${dest}`;

      const cost = call.buyerBillableAmount ? new Prisma.Decimal(call.buyerBillableAmount) : new Prisma.Decimal(0);
      const dur = call.connectedDuration !== null && call.connectedDuration !== undefined
        ? call.connectedDuration 
        : (call.duration || 0);

      if (!groupsMap.has(key)) {
        groupsMap.set(key, {
          buyerName: bName,
          campaignName: campName,
          destinationNumber: dest,
          totalCalls: 0,
          billableCalls: 0,
          nonBillableCalls: 0,
          totalDuration: 0,
          buyerCost: new Prisma.Decimal(0),
        });
      }

      const g = groupsMap.get(key);
      g.totalCalls++;
      if (call.billable) g.billableCalls++;
      else g.nonBillableCalls++;
      g.totalDuration += dur;
      g.buyerCost = g.buyerCost.plus(cost);
    }

    const rows = [...groupsMap.values()].map(g => {
      const billableRate = g.totalCalls > 0 ? (g.billableCalls / g.totalCalls) : 0;
      const averageDuration = g.totalCalls > 0 ? Math.round(g.totalDuration / g.totalCalls) : 0;
      const pricePerBillableCall = g.billableCalls > 0 
        ? g.buyerCost.dividedBy(g.billableCalls).toFixed(4)
        : '0.0000';

      return [
        g.buyerName,
        g.campaignName,
        g.destinationNumber,
        g.totalCalls,
        g.billableCalls,
        g.nonBillableCalls,
        (billableRate * 100).toFixed(2) + '%',
        averageDuration,
        pricePerBillableCall,
        g.buyerCost.toFixed(4),
      ];
    });

    const csvHeaders = ['Buyer', 'Campaign', 'Destination Number', 'Total Calls', 'Billable Calls', 'Non-Billable Calls', 'Billable Rate (%)', 'Avg Duration (s)', 'Cost / Billable Call ($)', 'Buyer Cost ($)'];
    const csvContent = toCsv(csvHeaders, rows);
    void reply
      .type('text/csv')
      .header('Content-Disposition', 'attachment; filename="buyer_costs_report.csv"')
      .send(csvContent);
  });

  // ── Campaign Profitability Report ──
  fastify.get<{
    Querystring: {
      startDate?: string;
      endDate?: string;
      campaignId?: string;
    };
  }>('/api/v1/reports/campaign-profitability', async (request, reply) => {
    const prisma = getPrismaClient();
    const { isAdminOrOwner } = await getUserProfile(request, prisma);

    if (!isAdminOrOwner) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const user = (request as AuthRequest).user;
    const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
    const tenantId = demoTenantId || user?.tenantId;
    if (!tenantId) return reply.code(401).send({ error: 'Unauthorized' });

    const startDate = request.query.startDate ? new Date(request.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = request.query.endDate ? new Date(request.query.endDate) : new Date();

    const calls = await prisma.call.findMany({
      where: {
        tenantId,
        createdAt: { gte: startDate, lte: endDate },
        ...(request.query.campaignId ? { campaignId: request.query.campaignId } : {}),
      },
      select: {
        id: true,
        campaignId: true,
        campaignName: true,
        billable: true,
        buyerBillableAmount: true,
        publisherPayoutAmount: true,
        cost: true,
      },
    });

    const groupsMap = new Map<string, any>();
    let totalCalls = 0;
    let billableCalls = 0;
    let totalRev = new Prisma.Decimal(0);
    let totalPayout = new Prisma.Decimal(0);
    let totalCallCost = new Prisma.Decimal(0);

    for (const call of calls) {
      const campId = call.campaignId || 'unknown';
      const campName = call.campaignName || 'Unknown Campaign';

      totalCalls++;
      if (call.billable) billableCalls++;

      const rev = call.buyerBillableAmount ? new Prisma.Decimal(call.buyerBillableAmount) : new Prisma.Decimal(0);
      const pay = call.publisherPayoutAmount ? new Prisma.Decimal(call.publisherPayoutAmount) : new Prisma.Decimal(0);
      const callCost = call.cost ? new Prisma.Decimal(call.cost) : new Prisma.Decimal(0);

      totalRev = totalRev.plus(rev);
      totalPayout = totalPayout.plus(pay);
      totalCallCost = totalCallCost.plus(callCost);

      if (!groupsMap.has(campId)) {
        groupsMap.set(campId, {
          campaignId: campId,
          campaignName: campName,
          totalCalls: 0,
          billableCalls: 0,
          buyerRevenue: new Prisma.Decimal(0),
          publisherPayout: new Prisma.Decimal(0),
          callCost: new Prisma.Decimal(0),
        });
      }

      const g = groupsMap.get(campId);
      g.totalCalls++;
      if (call.billable) g.billableCalls++;
      g.buyerRevenue = g.buyerRevenue.plus(rev);
      g.publisherPayout = g.publisherPayout.plus(pay);
      g.callCost = g.callCost.plus(callCost);
    }

    const rows = [...groupsMap.values()].map(g => {
      const profit = g.buyerRevenue.minus(g.publisherPayout).minus(g.callCost);
      const margin = g.buyerRevenue.gt(0) 
        ? profit.dividedBy(g.buyerRevenue).toNumber()
        : 0;

      return {
        campaignId: g.campaignId,
        campaignName: g.campaignName,
        totalCalls: g.totalCalls,
        billableCalls: g.billableCalls,
        buyerRevenue: g.buyerRevenue.toFixed(4),
        publisherPayout: g.publisherPayout.toFixed(4),
        callCost: g.callCost.toFixed(4),
        profit: profit.toFixed(4),
        margin,
      };
    });

    const overallProfit = totalRev.minus(totalPayout).minus(totalCallCost);
    const overallMargin = totalRev.gt(0) 
      ? overallProfit.dividedBy(totalRev).toNumber()
      : 0;

    return {
      totals: {
        totalCalls,
        billableCalls,
        buyerRevenue: totalRev.toFixed(4),
        publisherPayout: totalPayout.toFixed(4),
        callCost: totalCallCost.toFixed(4),
        profit: overallProfit.toFixed(4),
        margin: overallMargin,
      },
      rows,
    };
  });

  // ── Campaign Profitability CSV Export ──
  fastify.get<{
    Querystring: {
      startDate?: string;
      endDate?: string;
      campaignId?: string;
    };
  }>('/api/v1/reports/campaign-profitability/export.csv', async (request, reply) => {
    const prisma = getPrismaClient();
    const { isAdminOrOwner } = await getUserProfile(request, prisma);

    if (!isAdminOrOwner) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const user = (request as AuthRequest).user;
    const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
    const tenantId = demoTenantId || user?.tenantId;
    if (!tenantId) return reply.code(401).send({ error: 'Unauthorized' });

    const startDate = request.query.startDate ? new Date(request.query.startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = request.query.endDate ? new Date(request.query.endDate) : new Date();

    const calls = await prisma.call.findMany({
      where: {
        tenantId,
        createdAt: { gte: startDate, lte: endDate },
        ...(request.query.campaignId ? { campaignId: request.query.campaignId } : {}),
      },
      select: {
        campaignName: true,
        billable: true,
        buyerBillableAmount: true,
        publisherPayoutAmount: true,
        cost: true,
      },
    });

    const groupsMap = new Map<string, any>();
    for (const call of calls) {
      const campName = call.campaignName || 'Unknown Campaign';

      const rev = call.buyerBillableAmount ? new Prisma.Decimal(call.buyerBillableAmount) : new Prisma.Decimal(0);
      const pay = call.publisherPayoutAmount ? new Prisma.Decimal(call.publisherPayoutAmount) : new Prisma.Decimal(0);
      const callCost = call.cost ? new Prisma.Decimal(call.cost) : new Prisma.Decimal(0);

      if (!groupsMap.has(campName)) {
        groupsMap.set(campName, {
          campaignName: campName,
          totalCalls: 0,
          billableCalls: 0,
          buyerRevenue: new Prisma.Decimal(0),
          publisherPayout: new Prisma.Decimal(0),
          callCost: new Prisma.Decimal(0),
        });
      }

      const g = groupsMap.get(campName);
      g.totalCalls++;
      if (call.billable) g.billableCalls++;
      g.buyerRevenue = g.buyerRevenue.plus(rev);
      g.publisherPayout = g.publisherPayout.plus(pay);
      g.callCost = g.callCost.plus(callCost);
    }

    const rows = [...groupsMap.values()].map(g => {
      const profit = g.buyerRevenue.minus(g.publisherPayout).minus(g.callCost);
      const margin = g.buyerRevenue.gt(0) 
        ? (profit.dividedBy(g.buyerRevenue).toNumber() * 100).toFixed(2) + '%'
        : '0.00%';

      return [
        g.campaignName,
        g.totalCalls,
        g.billableCalls,
        g.buyerRevenue.toFixed(4),
        g.publisherPayout.toFixed(4),
        g.callCost.toFixed(4),
        profit.toFixed(4),
        margin,
      ];
    });

    const csvHeaders = ['Campaign', 'Total Calls', 'Billable Calls', 'Buyer Revenue ($)', 'Publisher Payout ($)', 'Call Cost ($)', 'Profit ($)', 'Margin (%)'];
    const csvContent = toCsv(csvHeaders, rows);
    void reply
      .type('text/csv')
      .header('Content-Disposition', 'attachment; filename="campaign_profitability_report.csv"')
      .send(csvContent);
  });
}

// Public API - Billing
export async function registerBillingRoutes(fastify: FastifyInstance) {
  await Promise.resolve();
  fastify.get<{ Querystring: { page?: string; limit?: string } }>(
    '/api/v1/billing/invoices',
    async (request, reply) => {
      const user = (request as AuthRequest).user;
      const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
      const tenantId = demoTenantId || user?.tenantId;

      if (!tenantId) {
        void reply.code(401);
        return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
      }

      const prisma = (await import('../lib/prisma.js')).getPrismaClient();
      const page = parseInt(request.query.page || '1');
      const limit = parseInt(request.query.limit || '20');
      const skip = (page - 1) * limit;

      // Get billing account for tenant
      const billingAccount = await prisma.billingAccount.findFirst({
        where: { tenantId },
      });

      if (!billingAccount) {
        return {
          data: [],
          meta: {
            page,
            limit,
            total: 0,
            totalPages: 0,
          },
        };
      }

      const [invoices, total] = await Promise.all([
        prisma.invoice.findMany({
          where: { billingAccountId: billingAccount.id },
          take: limit,
          skip,
          orderBy: { createdAt: 'desc' },
          include: {
            lines: {
              select: {
                id: true,
                description: true,
                quantity: true,
                unitPrice: true,
                total: true,
              },
            },
          },
        }),
        prisma.invoice.count({ where: { billingAccountId: billingAccount.id } }),
      ]);

      return {
        data: invoices.map(inv => ({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          status: inv.status.toLowerCase(),
          period: {
            start: inv.periodStart.toISOString(),
            end: inv.periodEnd.toISOString(),
          },
          subtotal: inv.subtotal.toString(),
          tax: inv.tax.toString(),
          total: inv.total.toString(),
          dueDate: inv.dueDate.toISOString(),
          paidAt: inv.paidAt?.toISOString() || null,
          lines: inv.lines.map(line => ({
            id: line.id,
            description: line.description,
            quantity: line.quantity.toString(),
            unitPrice: line.unitPrice.toString(),
            total: line.total.toString(),
          })),
          createdAt: inv.createdAt.toISOString(),
          updatedAt: inv.updatedAt.toISOString(),
        })),
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    }
  );

  fastify.get<{ Params: { invoiceId: string } }>(
    '/api/v1/billing/invoices/:invoiceId',
    async (request, reply) => {
      const user = (request as AuthRequest).user;
      const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
      const tenantId = demoTenantId || user?.tenantId;

      if (!tenantId) {
        void reply.code(401);
        return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
      }

      const prisma = (await import('../lib/prisma.js')).getPrismaClient();
      const { invoiceId } = request.params as { invoiceId: string };

      // Get billing account for tenant
      const billingAccount = await prisma.billingAccount.findFirst({
        where: { tenantId },
      });

      if (!billingAccount) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Billing account not found' } };
      }

      const invoice = await prisma.invoice.findFirst({
        where: {
          id: invoiceId,
          billingAccountId: billingAccount.id,
        },
        include: {
          lines: true,
        },
      });

      if (!invoice) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Invoice not found' } };
      }

      return {
        id: invoice.id,
        billingAccountId: invoice.billingAccountId,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status.toLowerCase(),
        periodStart: invoice.periodStart.toISOString(),
        periodEnd: invoice.periodEnd.toISOString(),
        subtotal: invoice.subtotal.toString(),
        tax: invoice.tax.toString(),
        total: invoice.total.toString(),
        dueDate: invoice.dueDate.toISOString(),
        paidAt: invoice.paidAt?.toISOString() || null,
        lines: invoice.lines.map(line => ({
          id: line.id,
          description: line.description,
          quantity: line.quantity.toString(),
          unitPrice: line.unitPrice.toString(),
          total: line.total.toString(),
        })),
        createdAt: invoice.createdAt.toISOString(),
        updatedAt: invoice.updatedAt.toISOString(),
      };
    }
  );

  fastify.get('/api/v1/billing/balance', async (request, reply) => {
    const user = (request as AuthRequest).user;
    const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
    const tenantId = demoTenantId || user?.tenantId;

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();

    // Get billing account for tenant
    const billingAccount = await prisma.billingAccount.findFirst({
      where: { tenantId },
    });

    if (!billingAccount) {
      // Return zero balance if no billing account exists
      return {
        billingAccountId: null,
        currency: 'USD',
        available: '0.00',
        pending: '0.00',
        held: '0.00',
        total: '0.00',
      };
    }

    // Get balances by type
    const balances = await prisma.balance.findMany({
      where: { billingAccountId: billingAccount.id },
    });

    const available = balances
      .filter(b => b.type === 'AVAILABLE')
      .reduce((sum, b) => sum + Number(b.amount), 0);
    const pending = balances
      .filter(b => b.type === 'PENDING')
      .reduce((sum, b) => sum + Number(b.amount), 0);
    const held = balances
      .filter(b => b.type === 'HELD')
      .reduce((sum, b) => sum + Number(b.amount), 0);
    const total = available + pending + held;

    return {
      billingAccountId: billingAccount.id,
      currency: billingAccount.currency,
      available: available.toFixed(2),
      pending: pending.toFixed(2),
      held: held.toFixed(2),
      total: total.toFixed(2),
    };
  });
}

// Admin API - Tenants
export async function registerAdminTenantRoutes(fastify: FastifyInstance) {
  await Promise.resolve();
  fastify.get('/admin/api/v1/tenants', async (_request, _reply) => {
    return {
      data: [],
      meta: {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      },
    };
  });

  fastify.post('/admin/api/v1/tenants', async (_request, reply) => {
    void reply.code(201);
    return {
      id: '00000000-0000-0000-0000-000000000000',
      name: 'Tenant',
      slug: 'tenant',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });

  fastify.get<{ Params: { tenantId: string } }>(
    '/admin/api/v1/tenants/:tenantId',
    async (request, _reply) => {
      return {
        id: request.params.tenantId,
        name: 'Tenant',
        slug: 'tenant',
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  );

  fastify.patch<{ Params: { tenantId: string } }>(
    '/admin/api/v1/tenants/:tenantId',
    async (request, _reply) => {
      return {
        id: request.params.tenantId,
        name: 'Tenant',
        slug: 'tenant',
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  );
}

// Admin API - Numbers
export async function registerAdminNumberRoutes(fastify: FastifyInstance) {
  await Promise.resolve();
  fastify.post('/admin/api/v1/numbers/provision', async (_request, reply) => {
    void reply.code(201);
    return {
      id: '00000000-0000-0000-0000-000000000000',
      tenantId: '00000000-0000-0000-0000-000000000000',
      number: '+15551234567',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });
}

// Admin API - Carriers
export async function registerAdminCarrierRoutes(fastify: FastifyInstance) {
  await Promise.resolve();
  fastify.get('/admin/api/v1/carriers', async (_request, _reply) => {
    return {
      data: [],
      meta: {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      },
    };
  });

  fastify.post('/admin/api/v1/carriers', async (_request, reply) => {
    void reply.code(201);
    return {
      id: '00000000-0000-0000-0000-000000000000',
      tenantId: '00000000-0000-0000-0000-000000000000',
      name: 'Carrier',
      code: 'CARRIER_001',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });

  fastify.get<{ Params: { carrierId: string } }>(
    '/admin/api/v1/carriers/:carrierId',
    async (request, _reply) => {
      return {
        id: request.params.carrierId,
        tenantId: '00000000-0000-0000-0000-000000000000',
        name: 'Carrier',
        code: 'CARRIER_001',
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  );

  fastify.patch<{ Params: { carrierId: string } }>(
    '/admin/api/v1/carriers/:carrierId',
    async (request, _reply) => {
      return {
        id: request.params.carrierId,
        tenantId: '00000000-0000-0000-0000-000000000000',
        name: 'Carrier',
        code: 'CARRIER_001',
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  );
}

// Admin API - Trunks
export async function registerAdminTrunkRoutes(fastify: FastifyInstance) {
  await Promise.resolve();
  fastify.get('/admin/api/v1/trunks', async (_request, _reply) => {
    return {
      data: [],
      meta: {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      },
    };
  });

  fastify.post('/admin/api/v1/trunks', async (_request, reply) => {
    void reply.code(201);
    return {
      id: '00000000-0000-0000-0000-000000000000',
      tenantId: '00000000-0000-0000-0000-000000000000',
      carrierId: '00000000-0000-0000-0000-000000000000',
      name: 'Trunk',
      type: 'SIP',
      host: 'sip.example.com',
      port: 5060,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });

  fastify.get<{ Params: { trunkId: string } }>(
    '/admin/api/v1/trunks/:trunkId',
    async (request, _reply) => {
      return {
        id: request.params.trunkId,
        tenantId: '00000000-0000-0000-0000-000000000000',
        carrierId: '00000000-0000-0000-0000-000000000000',
        name: 'Trunk',
        type: 'SIP',
        host: 'sip.example.com',
        port: 5060,
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  );

  fastify.patch<{ Params: { trunkId: string } }>(
    '/admin/api/v1/trunks/:trunkId',
    async (request, _reply) => {
      return {
        id: request.params.trunkId,
        tenantId: '00000000-0000-0000-0000-000000000000',
        carrierId: '00000000-0000-0000-0000-000000000000',
        name: 'Trunk',
        type: 'SIP',
        host: 'sip.example.com',
        port: 5060,
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  );
}

// Admin API - Rate Cards
export async function registerAdminRateCardRoutes(fastify: FastifyInstance) {
  await Promise.resolve();
  fastify.get('/admin/api/v1/rate-cards', async (_request, _reply) => {
    return {
      data: [],
      meta: {
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      },
    };
  });

  fastify.post('/admin/api/v1/rate-cards', async (_request, reply) => {
    void reply.code(201);
    return {
      id: '00000000-0000-0000-0000-000000000000',
      billingAccountId: '00000000-0000-0000-0000-000000000000',
      name: 'Rate Card',
      effectiveFrom: new Date().toISOString(),
      status: 'ACTIVE',
      rates: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });

  fastify.get<{ Params: { rateCardId: string } }>(
    '/admin/api/v1/rate-cards/:rateCardId',
    async (request, _reply) => {
      return {
        id: request.params.rateCardId,
        billingAccountId: '00000000-0000-0000-0000-000000000000',
        name: 'Rate Card',
        effectiveFrom: new Date().toISOString(),
        status: 'ACTIVE',
        rates: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  );

  fastify.patch<{ Params: { rateCardId: string } }>(
    '/admin/api/v1/rate-cards/:rateCardId',
    async (request, _reply) => {
      return {
        id: request.params.rateCardId,
        billingAccountId: '00000000-0000-0000-0000-000000000000',
        name: 'Rate Card',
        effectiveFrom: new Date().toISOString(),
        status: 'ACTIVE',
        rates: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  );
}
