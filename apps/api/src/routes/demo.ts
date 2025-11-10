import { FastifyInstance } from 'fastify';

import { getPrismaClient } from '../lib/prisma.js';

/**
 * Demo Mode Routes
 * 
 * Provides endpoints to toggle demo mode and access demo data
 */
export async function registerDemoRoutes(fastify: FastifyInstance) {
  // Get demo mode status
  fastify.get('/api/v1/demo/status', async (request, reply) => {
    const demoTenant = await getPrismaClient().tenant.findUnique({
      where: { slug: 'demo' },
    });

    return {
      enabled: !!demoTenant,
      tenantId: demoTenant?.id || null,
    };
  });

  // Toggle demo mode (for UI)
  fastify.post('/api/v1/demo/toggle', async (request, reply) => {
    const body = request.body as { enabled: boolean };
    const user = (request as any).user;

    // Store demo mode preference in user metadata or session
    // For now, return the demo tenant ID if enabled
    if (body.enabled) {
      const demoTenant = await getPrismaClient().tenant.findUnique({
        where: { slug: 'demo' },
      });

      if (!demoTenant) {
        reply.code(404);
        return { error: { code: 'DEMO_NOT_FOUND', message: 'Demo tenant not found. Run db:seed:demo first.' } };
      }

      return {
        enabled: true,
        tenantId: demoTenant.id,
        message: 'Demo mode enabled',
      };
    }

    return {
      enabled: false,
      tenantId: user?.tenantId || null,
      message: 'Demo mode disabled',
    };
  });

  // Get demo statistics
  fastify.get('/api/v1/demo/stats', async (request, reply) => {
    const prisma = getPrismaClient();
    const demoTenant = await prisma.tenant.findUnique({
      where: { slug: 'demo' },
    });

    if (!demoTenant) {
      reply.code(404);
      return { error: { code: 'DEMO_NOT_FOUND', message: 'Demo tenant not found' } };
    }

    const [
      callCount,
      completedCalls,
      publisherCount,
      buyerCount,
      campaignCount,
      invoiceCount,
      totalRevenue,
    ] = await Promise.all([
      prisma.call.count({ where: { tenantId: demoTenant.id } }),
      prisma.call.count({ where: { tenantId: demoTenant.id, status: 'COMPLETED' } }),
      prisma.publisher.count({ where: { tenantId: demoTenant.id } }),
      prisma.buyer.count({ where: { tenantId: demoTenant.id } }),
      prisma.campaign.count({ where: { tenantId: demoTenant.id } }),
      prisma.invoice.count({ where: { tenantId: demoTenant.id } }),
      prisma.invoice.aggregate({
        where: { tenantId: demoTenant.id },
        _sum: { total: true },
      }),
    ]);

    return {
      calls: {
        total: callCount,
        completed: completedCalls,
        completionRate: callCount > 0 ? (completedCalls / callCount) * 100 : 0,
      },
      publishers: publisherCount,
      buyers: buyerCount,
      campaigns: campaignCount,
      invoices: invoiceCount,
      revenue: Number(totalRevenue._sum.total || 0),
    };
  });
}

