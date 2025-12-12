// Route handlers - placeholder implementations
import { FastifyInstance, FastifyRequest } from 'fastify';

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

      const [numbers, total] = await Promise.all([
        prisma.phoneNumber.findMany({
          where: { tenantId },
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
          },
        }),
        prisma.phoneNumber.count({ where: { tenantId } }),
      ]);

      return {
        data: numbers.map(n => ({
          id: n.id,
          number: n.number,
          status: n.status,
          provider: n.provider,
          capabilities: n.capabilities,
          campaign: n.campaign ? { id: n.campaign.id, name: n.campaign.name } : null,
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
      provider?: 'local' | 'signalwire' | 'telnyx' | 'bandwidth';
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
    } catch (error: any) {
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
      capabilities?: {
        voice?: boolean;
        sms?: boolean;
        mms?: boolean;
        fax?: boolean;
      };
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
      const updateData: any = {};
      if (body.status !== undefined) {
        updateData.status = body.status;
      }
      if (body.campaignId !== undefined) {
        updateData.campaignId = body.campaignId;
      }
      if (body.capabilities !== undefined) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        updateData.capabilities = { ...(existingNumber.capabilities as any), ...body.capabilities };
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
        },
      });

      // Audit log
      const { auditUpdate } = await import('../services/audit.js');
      await auditUpdate(tenantId, 'PhoneNumber', numberId, existingNumber, updatedNumber, {
        userId: (user as AuthenticatedUser)?.userId,
        ipAddress: request.ip,
        requestId: request.id,
      });

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
        purchasedAt: updatedNumber.purchasedAt?.toISOString(),
        createdAt: updatedNumber.createdAt.toISOString(),
        updatedAt: updatedNumber.updatedAt.toISOString(),
      };
    } catch (error: any) {
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
          publisherId: c.publisherId,
          publisher: c.publisher,
          flowId: c.flowId,
          flow: c.flow,
          callerIdPoolId: c.callerIdPoolId,
          metadata: c.metadata,
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
      flowId?: string;
      callerIdPoolId?: string;
      status?: 'ACTIVE' | 'PAUSED';
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
          status: body.status || 'ACTIVE',
          flowId: body.flowId || null,
          callerIdPoolId: body.callerIdPoolId || null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          metadata: (body.metadata as any) || {},
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
          userId: (user as AuthenticatedUser)?.userId,
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
        status: campaign.status,
        flowId: campaign.flowId,
        callerIdPoolId: campaign.callerIdPoolId,
        metadata: campaign.metadata,
        createdAt: campaign.createdAt.toISOString(),
        updatedAt: campaign.updatedAt.toISOString(),
      };
    } catch (error: any) {
      void reply.code(400);
      return {
        error: {
          code: 'CREATE_FAILED',
          message: (error as Error).message || 'Failed to create campaign',
        },
      };
    }
  });

  fastify.get<{ Params: { campaignId: string } }>(
    '/api/v1/campaigns/:campaignId',
    async (request, _reply) => {
      return {
        id: request.params.campaignId,
        tenantId: '00000000-0000-0000-0000-000000000000',
        publisherId: '00000000-0000-0000-0000-000000000000',
        name: 'Campaign',
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  );

  fastify.patch<{ Params: { campaignId: string } }>(
    '/api/v1/campaigns/:campaignId',
    async (request, _reply) => {
      return {
        id: request.params.campaignId,
        tenantId: '00000000-0000-0000-0000-000000000000',
        publisherId: '00000000-0000-0000-0000-000000000000',
        name: 'Campaign',
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  );

  fastify.delete<{ Params: { campaignId: string } }>(
    '/api/v1/campaigns/:campaignId',
    async (_request, reply) => {
      void reply.code(204);
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
  fastify.get('/api/v1/publishers', async (request, reply) => {
    const user = (request as AuthRequest).user;
    const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
    const tenantId = demoTenantId || user?.tenantId;

    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const prisma = (await import('../lib/prisma.js')).getPrismaClient();
    const publishers = await prisma.publisher.findMany({
      where: { tenantId, status: 'ACTIVE' },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        code: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      data: publishers.map(p => ({
        id: p.id,
        name: p.name,
        code: p.code,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      })),
    };
  });
}

// Public API - Calls
export async function registerCallRoutes(fastify: FastifyInstance) {
  await Promise.resolve();
  fastify.get<{ Querystring: { page?: string; limit?: string } }>(
    '/api/v1/calls',
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

      const [calls, total] = await Promise.all([
        prisma.call.findMany({
          where: { tenantId },
          take: limit,
          skip,
          orderBy: { createdAt: 'desc' },
          include: {
            campaign: true,
            fromNumber: true,
          },
        }),
        prisma.call.count({ where: { tenantId } }),
      ]);

      return {
        data: calls,
        meta: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
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

  fastify.get<{ Params: { callId: string } }>('/api/v1/calls/:callId', async (request, _reply) => {
    return {
      id: request.params.callId,
      tenantId: '00000000-0000-0000-0000-000000000000',
      toNumber: '+15551234567',
      callSid: 'call_1234567890',
      status: 'INITIATED',
      direction: 'OUTBOUND',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
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

    const updateData: any = {};
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
          userId: (user as AuthenticatedUser)?.userId,
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

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: {
        tenantId_email: {
          tenantId,
          email: body.email.toLowerCase().trim(),
        },
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

    // Get default role if no roles specified (or use ANALYST as default)
    let roleIds = body.roleIds;
    if (!roleIds || roleIds.length === 0) {
      const defaultRole = await prisma.role.findUnique({
        where: { name: 'ANALYST' },
      });
      if (defaultRole) {
        roleIds = [defaultRole.id];
      } else {
        // If ANALYST doesn't exist, try ADMIN, then get first available role
        const adminRole = await prisma.role.findUnique({
          where: { name: 'ADMIN' },
        });
        if (adminRole) {
          roleIds = [adminRole.id];
        } else {
          const firstRole = await prisma.role.findFirst();
          if (firstRole) {
            roleIds = [firstRole.id];
          } else {
            void reply.code(400);
            return { error: { code: 'NO_ROLES', message: 'No roles available in system' } };
          }
        }
      }
    }

    // Create user
    const newUser = await prisma.user.create({
      data: {
        tenantId,
        email: body.email.toLowerCase().trim(),
        passwordHash,
        firstName: body.firstName || null,
        lastName: body.lastName || null,
        status: 'ACTIVE',
        metadata: {
          tempPassword: true, // Flag that password needs to be changed
          invitedBy: (user as AuthenticatedUser)?.userId,
        },
        roles: {
          create: roleIds.map(roleId => ({
            roleId,
          })),
        },
      },
      include: {
        roles: {
          include: {
            role: true,
          },
        },
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
      },
      {
        userId: (user as AuthenticatedUser)?.userId,
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
      createdAt: newUser.createdAt.toISOString(),
      // In production, don't return temp password - send via email
      tempPassword: tempPassword, // Only for development/testing
    };
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const decoded = await (request as any).jwtVerify(token);
        (request as AuthRequest).user = decoded as AuthenticatedUser;
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
