import { FastifyInstance } from 'fastify';
import { getPrismaClient } from '../lib/prisma.js';
import { quotaService } from '../services/quota-service.js';
import { requirePermission } from '../middleware/rbac.js';
import { auditCreate, auditUpdate } from '../services/audit.js';
import { createHash, randomBytes } from 'crypto';

/**
 * Quota Management Routes
 */
export async function registerQuotaRoutes(fastify: FastifyInstance) {
  // Get tenant quota
  fastify.get(
    '/admin/api/v1/tenants/:tenantId/quota',
    { preHandler: [requirePermission('admin:full')] },
    async (request, reply) => {
      const prisma = getPrismaClient();
      const { tenantId } = request.params as { tenantId: string };

      const quota = await prisma.tenantQuota.findUnique({
        where: { tenantId },
      });

      if (!quota) {
        reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Quota not found' } };
      }

      return quota;
    }
  );

  // Update tenant quota
  fastify.patch(
    '/admin/api/v1/tenants/:tenantId/quota',
    { preHandler: [requirePermission('admin:full')] },
    async (request, reply) => {
      const prisma = getPrismaClient();
      const { tenantId } = request.params as { tenantId: string };
      const body = request.body as any;
      const user = (request as any).user;

      const before = await prisma.tenantQuota.findUnique({
        where: { tenantId },
      });

      if (!before) {
        // Create quota if it doesn't exist
        const quota = await prisma.tenantQuota.create({
          data: {
            tenantId,
            maxConcurrentCalls: body.maxConcurrentCalls,
            maxMinutesPerDay: body.maxMinutesPerDay,
            maxRecordingRetentionDays: body.maxRecordingRetentionDays,
            maxPhoneNumbers: body.maxPhoneNumbers,
            maxStorageGB: body.maxStorageGB,
            enabled: body.enabled ?? true,
          },
        });

        await auditCreate(
          tenantId,
          'TenantQuota',
          quota.id,
          quota,
          {
            userId: user?.userId,
            ipAddress: request.ip,
            requestId: (request as any).id,
          }
        );

        return quota;
      }

      const after = await prisma.tenantQuota.update({
        where: { tenantId },
        data: {
          maxConcurrentCalls: body.maxConcurrentCalls ?? before.maxConcurrentCalls,
          maxMinutesPerDay: body.maxMinutesPerDay ?? before.maxMinutesPerDay,
          maxRecordingRetentionDays: body.maxRecordingRetentionDays ?? before.maxRecordingRetentionDays,
          maxPhoneNumbers: body.maxPhoneNumbers ?? before.maxPhoneNumbers,
          maxStorageGB: body.maxStorageGB ?? before.maxStorageGB,
          enabled: body.enabled ?? before.enabled,
        },
      });

      await auditUpdate(
        tenantId,
        'TenantQuota',
        after.id,
        before,
        after,
        {
          userId: user?.userId,
          ipAddress: request.ip,
          requestId: (request as any).id,
        }
      );

      return after;
    }
  );

  // Get tenant budget
  fastify.get(
    '/admin/api/v1/tenants/:tenantId/budget',
    { preHandler: [requirePermission('admin:full')] },
    async (request, reply) => {
      const prisma = getPrismaClient();
      const { tenantId } = request.params as { tenantId: string };

      const budget = await prisma.tenantBudget.findUnique({
        where: { tenantId },
        include: {
          alerts: {
            orderBy: { sentAt: 'desc' },
            take: 10,
          },
        },
      });

      if (!budget) {
        reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Budget not found' } };
      }

      return budget;
    }
  );

  // Update tenant budget
  fastify.patch(
    '/admin/api/v1/tenants/:tenantId/budget',
    { preHandler: [requirePermission('admin:full')] },
    async (request, reply) => {
      const prisma = getPrismaClient();
      const { tenantId } = request.params as { tenantId: string };
      const body = request.body as any;
      const user = (request as any).user;

      const before = await prisma.tenantBudget.findUnique({
        where: { tenantId },
      });

      if (!before) {
        const budget = await prisma.tenantBudget.create({
          data: {
            tenantId,
            monthlyBudget: body.monthlyBudget,
            dailyBudget: body.dailyBudget,
            alertThreshold: body.alertThreshold ?? 80,
            alertEmails: body.alertEmails ?? [],
            alertSlackWebhook: body.alertSlackWebhook,
            hardStopEnabled: body.hardStopEnabled ?? true,
            enabled: body.enabled ?? true,
          },
        });

        await auditCreate(
          tenantId,
          'TenantBudget',
          budget.id,
          budget,
          {
            userId: user?.userId,
            ipAddress: request.ip,
            requestId: (request as any).id,
          }
        );

        return budget;
      }

      const after = await prisma.tenantBudget.update({
        where: { tenantId },
        data: {
          monthlyBudget: body.monthlyBudget ?? before.monthlyBudget,
          dailyBudget: body.dailyBudget ?? before.dailyBudget,
          alertThreshold: body.alertThreshold ?? before.alertThreshold,
          alertEmails: body.alertEmails ?? before.alertEmails,
          alertSlackWebhook: body.alertSlackWebhook ?? before.alertSlackWebhook,
          hardStopEnabled: body.hardStopEnabled ?? before.hardStopEnabled,
          enabled: body.enabled ?? before.enabled,
        },
      });

      await auditUpdate(
        tenantId,
        'TenantBudget',
        after.id,
        before,
        after,
        {
          userId: user?.userId,
          ipAddress: request.ip,
          requestId: (request as any).id,
        }
      );

      return after;
    }
  );

  // Generate override token
  fastify.post(
    '/admin/api/v1/tenants/:tenantId/budget/override-token',
    { preHandler: [requirePermission('admin:full')] },
    async (request, reply) => {
      const prisma = getPrismaClient();
      const { tenantId } = request.params as { tenantId: string };
      const body = request.body as { expiresInHours?: number };
      const user = (request as any).user;

      const budget = await prisma.tenantBudget.findUnique({
        where: { tenantId },
      });

      if (!budget) {
        reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Budget not found' } };
      }

      // Generate secure token
      const token = `qot_${randomBytes(32).toString('hex')}`;
      const expiresInHours = body.expiresInHours ?? 24;
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + expiresInHours);

      await prisma.tenantBudget.update({
        where: { tenantId },
        data: {
          overrideToken: token,
          overrideTokenExpiresAt: expiresAt,
        },
      });

      await auditCreate(
        tenantId,
        'BudgetOverrideToken',
        budget.id,
        {
          tokenGenerated: true,
          expiresAt: expiresAt.toISOString(),
        },
        {
          userId: user?.userId,
          ipAddress: request.ip,
          requestId: (request as any).id,
        }
      );

      return {
        token,
        expiresAt: expiresAt.toISOString(),
        expiresInHours,
      };
    }
  );

  // Revoke override token
  fastify.delete(
    '/admin/api/v1/tenants/:tenantId/budget/override-token',
    { preHandler: [requirePermission('admin:full')] },
    async (request, reply) => {
      const prisma = getPrismaClient();
      const { tenantId } = request.params as { tenantId: string };
      const user = (request as any).user;

      await prisma.tenantBudget.update({
        where: { tenantId },
        data: {
          overrideToken: null,
          overrideTokenExpiresAt: null,
        },
      });

      await auditCreate(
        tenantId,
        'BudgetOverrideToken',
        tenantId,
        {
          tokenRevoked: true,
        },
        {
          userId: user?.userId,
          ipAddress: request.ip,
          requestId: (request as any).id,
        }
      );

      return { success: true };
    }
  );

  // Get quota status (current usage)
  fastify.get(
    '/admin/api/v1/tenants/:tenantId/quota/status',
    { preHandler: [requirePermission('admin:full')] },
    async (request, reply) => {
      const prisma = getPrismaClient();
      const { tenantId } = request.params as { tenantId: string };

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        include: {
          quota: true,
          budget: true,
        },
      });

      if (!tenant) {
        reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Tenant not found' } };
      }

      // Get current concurrent calls
      const concurrentCalls = await prisma.call.count({
        where: {
          tenantId,
          status: {
            in: ['INITIATED', 'RINGING', 'ANSWERED'],
          },
        },
      });

      // Get today's minutes
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      const todayCalls = await prisma.call.findMany({
        where: {
          tenantId,
          createdAt: {
            gte: todayStart,
            lte: todayEnd,
          },
          duration: { not: null },
        },
        select: { duration: true },
      });

      const todayMinutes = Math.ceil(
        todayCalls.reduce((sum, call) => sum + (call.duration || 0), 0) / 60
      );

      // Get current phone numbers
      const phoneNumbers = await prisma.phoneNumber.count({
        where: {
          tenantId,
          status: 'ACTIVE',
        },
      });

      return {
        concurrentCalls: {
          current: concurrentCalls,
          limit: tenant.quota?.maxConcurrentCalls ?? null,
          remaining: tenant.quota?.maxConcurrentCalls
            ? Math.max(0, tenant.quota.maxConcurrentCalls - concurrentCalls)
            : null,
        },
        dailyMinutes: {
          current: todayMinutes,
          limit: tenant.quota?.maxMinutesPerDay ?? null,
          remaining: tenant.quota?.maxMinutesPerDay
            ? Math.max(0, tenant.quota.maxMinutesPerDay - todayMinutes)
            : null,
        },
        phoneNumbers: {
          current: phoneNumbers,
          limit: tenant.quota?.maxPhoneNumbers ?? null,
          remaining: tenant.quota?.maxPhoneNumbers
            ? Math.max(0, tenant.quota.maxPhoneNumbers - phoneNumbers)
            : null,
        },
        budget: tenant.budget
          ? {
              daily: {
                current: Number(tenant.budget.currentDaySpend),
                limit: tenant.budget.dailyBudget ? Number(tenant.budget.dailyBudget) : null,
                percentage: tenant.budget.dailyBudget
                  ? (Number(tenant.budget.currentDaySpend) / Number(tenant.budget.dailyBudget)) * 100
                  : null,
              },
              monthly: {
                current: Number(tenant.budget.currentMonthSpend),
                limit: tenant.budget.monthlyBudget ? Number(tenant.budget.monthlyBudget) : null,
                percentage: tenant.budget.monthlyBudget
                  ? (Number(tenant.budget.currentMonthSpend) / Number(tenant.budget.monthlyBudget)) * 100
                  : null,
              },
            }
          : null,
      };
    }
  );

  // Create quota override
  fastify.post(
    '/admin/api/v1/tenants/:tenantId/quota/overrides',
    { preHandler: [requirePermission('admin:full')] },
    async (request, reply) => {
      const prisma = getPrismaClient();
      const { tenantId } = request.params as { tenantId: string };
      const body = request.body as {
        quotaType: string;
        overrideValue?: number;
        reason: string;
        expiresInHours?: number;
      };
      const user = (request as any).user;

      const expiresAt = body.expiresInHours
        ? new Date(Date.now() + body.expiresInHours * 60 * 60 * 1000)
        : null;

      const override = await prisma.quotaOverride.create({
        data: {
          tenantId,
          quotaType: body.quotaType,
          overrideValue: body.overrideValue,
          reason: body.reason,
          expiresAt,
          createdBy: user?.userId,
        },
      });

      await auditCreate(
        tenantId,
        'QuotaOverride',
        override.id,
        override,
        {
          userId: user?.userId,
          ipAddress: request.ip,
          requestId: (request as any).id,
        }
      );

      reply.code(201);
      return override;
    }
  );

  // List quota overrides
  fastify.get(
    '/admin/api/v1/tenants/:tenantId/quota/overrides',
    { preHandler: [requirePermission('admin:full')] },
    async (request, reply) => {
      const prisma = getPrismaClient();
      const { tenantId } = request.params as { tenantId: string };

      const overrides = await prisma.quotaOverride.findMany({
        where: {
          tenantId,
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } },
          ],
        },
        orderBy: { createdAt: 'desc' },
      });

      return { data: overrides };
    }
  );

  // Delete quota override
  fastify.delete(
    '/admin/api/v1/tenants/:tenantId/quota/overrides/:overrideId',
    { preHandler: [requirePermission('admin:full')] },
    async (request, reply) => {
      const prisma = getPrismaClient();
      const { tenantId, overrideId } = request.params as { tenantId: string; overrideId: string };
      const user = (request as any).user;

      await prisma.quotaOverride.delete({
        where: { id: overrideId },
      });

      await auditCreate(
        tenantId,
        'QuotaOverride',
        overrideId,
        { deleted: true },
        {
          userId: user?.userId,
          ipAddress: request.ip,
          requestId: (request as any).id,
        }
      );

      return { success: true };
    }
  );
}

