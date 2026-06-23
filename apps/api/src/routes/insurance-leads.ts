/**
 * Insurance Lead Pipeline — API Routes
 *
 * All routes under /api/v1/insurance-leads
 * Uses the existing Fastify API-key auth pattern (x-api-key header)
 * so tenantId resolves from the global auth hook.
 */

import { FastifyInstance, FastifyRequest } from 'fastify';

interface AuthenticatedUser {
  tenantId?: string;
  apiKeyId?: string;
  userId?: string;
  scopes?: string[];
}

type AuthRequest = FastifyRequest & { user?: AuthenticatedUser };

function getTenantId(request: FastifyRequest): string | null {
  const user = (request as AuthRequest).user;
  const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
  return demoTenantId || user?.tenantId || null;
}

// eslint-disable-next-line @typescript-eslint/require-await
export async function registerInsuranceLeadRoutes(fastify: FastifyInstance) {
  // -----------------------------------------------------------------------
  // POST /api/v1/insurance-leads/inbound/:vertical — Inbound webhook
  // -----------------------------------------------------------------------
  fastify.post<{
    Params: { vertical: string };
    Body: Record<string, unknown>;
  }>('/api/v1/insurance-leads/inbound/:vertical', async (request, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Valid API key required' } };
    }

    const { vertical: rawVertical } = request.params;
    const vertical = rawVertical.toUpperCase();

    if (vertical !== 'ACA' && vertical !== 'FE') {
      void reply.code(400);
      return {
        error: {
          code: 'INVALID_VERTICAL',
          message: `Invalid vertical "${rawVertical}". Must be "aca" or "fe".`,
        },
      };
    }

    const body = request.body;
    if (!body || typeof body !== 'object') {
      void reply.code(400);
      return { error: { code: 'INVALID_BODY', message: 'Request body must be a JSON object' } };
    }

    try {
      const { ingestLead } = await import('../services/insurance-lead-service.js');
      const result = await ingestLead(tenantId, vertical as 'ACA' | 'FE', body);

      void reply.code(result.validationStatus === 'VALID' ? 200 : 422);
      return {
        success: result.validationStatus === 'VALID',
        insuranceLeadId: result.insuranceLeadId,
        submissionId: result.submissionId,
        validationStatus: result.validationStatus,
        postStatus: result.postStatus,
        postMode: result.postMode,
        ameriquoteStatus: result.ameriquoteStatus || null,
        errors: result.errors || null,
      };
    } catch (error: unknown) {
      void reply.code(500);
      return {
        error: {
          code: 'INGESTION_FAILED',
          message: (error as Error).message || 'Failed to ingest lead',
        },
      };
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/v1/insurance-leads/import — Bulk import
  // -----------------------------------------------------------------------
  fastify.post<{
    Body: {
      vertical: string;
      leads: Array<Record<string, unknown>>;
    };
  }>('/api/v1/insurance-leads/import', async (request, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Valid API key required' } };
    }

    const { vertical: rawVertical, leads } = request.body;
    if (!rawVertical || !Array.isArray(leads)) {
      void reply.code(400);
      return { error: { code: 'INVALID_BODY', message: 'Must provide vertical and leads array' } };
    }

    const vertical = rawVertical.toUpperCase();
    if (vertical !== 'ACA' && vertical !== 'FE') {
      void reply.code(400);
      return {
        error: {
          code: 'INVALID_VERTICAL',
          message: `Invalid vertical "${rawVertical}". Must be "aca" or "fe".`,
        },
      };
    }

    try {
      const { ingestLead } = await import('../services/insurance-lead-service.js');
      const results = [];

      for (const lead of leads) {
        try {
          const result = await ingestLead(tenantId, vertical as 'ACA' | 'FE', lead);
          results.push({
            success: result.validationStatus === 'VALID',
            phone: String(lead.phone || ''),
            name: `${String(lead.firstName || '')} ${String(lead.lastName || '')}`.trim(),
            errors: result.errors || null,
          });
        } catch (err: unknown) {
          results.push({
            success: false,
            phone: String(lead.phone || ''),
            name: `${String(lead.firstName || '')} ${String(lead.lastName || '')}`.trim(),
            errors: [
              { path: 'system', message: (err as Error).message || 'System ingestion failure' },
            ],
          });
        }
      }

      return {
        total: leads.length,
        successCount: results.filter(r => r.success).length,
        failCount: results.filter(r => !r.success).length,
        details: results,
      };
    } catch (error: unknown) {
      void reply.code(500);
      return {
        error: {
          code: 'IMPORT_FAILED',
          message: (error as Error).message || 'Failed to complete import process',
        },
      };
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/v1/insurance-leads — List leads with filtering
  // -----------------------------------------------------------------------
  fastify.get<{
    Querystring: {
      page?: string;
      limit?: string;
      vertical?: string;
      validationStatus?: string;
      postStatus?: string;
      postMode?: string;
      search?: string;
      startDate?: string;
      endDate?: string;
      status?: string;
      leadStage?: string;
      followUp?: string;
    };
  }>('/api/v1/insurance-leads', async (request, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const { getLeads } = await import('../services/insurance-lead-service.js');
    const q = request.query;

    const result = await getLeads(tenantId, {
      page: q.page ? parseInt(q.page) : undefined,
      limit: q.limit ? parseInt(q.limit) : undefined,
      vertical: q.vertical?.toUpperCase() as 'ACA' | 'FE' | undefined,
      validationStatus: q.validationStatus?.toUpperCase() as 'VALID' | 'INVALID' | undefined,
      postStatus: q.postStatus?.toUpperCase(),
      postMode: q.postMode?.toUpperCase() as 'TEST' | 'LIVE' | undefined,
      search: q.search,
      startDate: q.startDate,
      endDate: q.endDate,
      status: q.status,
      leadStage: q.leadStage,
      followUp: q.followUp,
    });

    return result;
  });

  // -----------------------------------------------------------------------
  // GET /api/v1/insurance-leads/stats — Aggregate stats
  // -----------------------------------------------------------------------
  fastify.get('/api/v1/insurance-leads/stats', async (request, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const { getStats } = await import('../services/insurance-lead-service.js');
    return await getStats(tenantId);
  });

  // -----------------------------------------------------------------------
  // GET /api/v1/insurance-leads/:id — Single lead detail
  // -----------------------------------------------------------------------
  fastify.get<{ Params: { id: string } }>('/api/v1/insurance-leads/:id', async (request, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const { getLeadById } = await import('../services/insurance-lead-service.js');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const lead = await getLeadById(tenantId, request.params.id);

    if (!lead) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Lead not found' } };
    }

    return lead;
  });

  // -----------------------------------------------------------------------
  // PATCH /api/v1/insurance-leads/:id — Edit CRM lead fields
  // -----------------------------------------------------------------------
  fastify.patch<{
    Params: { id: string };
    Body: Record<string, unknown>;
  }>('/api/v1/insurance-leads/:id', async (request, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const { updateLead } = await import('../services/insurance-lead-service.js');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const updated = await updateLead(tenantId, request.params.id, request.body);

    if (!updated) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Lead not found' } };
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    return { success: true, lead: updated };
  });

  // -----------------------------------------------------------------------
  // POST /api/v1/insurance-leads/:id/submissions/:submissionId/retry
  // -----------------------------------------------------------------------
  fastify.post<{
    Params: { id: string; submissionId: string };
  }>('/api/v1/insurance-leads/:id/submissions/:submissionId/retry', async (request, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const { retrySubmission } = await import('../services/insurance-lead-service.js');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const result = await retrySubmission(tenantId, request.params.id, request.params.submissionId);

    if ('error' in result) {
      void reply.code(400);
      return { error: { code: 'RETRY_FAILED', message: String(result.error) } };
    }

    return result;
  });

  // -----------------------------------------------------------------------
  // Tasks Endpoints
  // -----------------------------------------------------------------------

  // GET /api/v1/insurance-leads/:id/tasks — List tasks for a lead
  fastify.get<{
    Params: { id: string };
  }>('/api/v1/insurance-leads/:id/tasks', async (request, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const { getPrismaClient } = await import('../lib/prisma.js');
    const prisma = getPrismaClient();

    // Verify lead belongs to tenant
    const lead = await prisma.insuranceLead.findFirst({
      where: { id: request.params.id, tenantId },
    });
    if (!lead) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Lead not found' } };
    }

    const tasks = await prisma.insuranceTask.findMany({
      where: { insuranceLeadId: request.params.id, tenantId },
      orderBy: { createdAt: 'desc' },
    });

    return { tasks };
  });

  // POST /api/v1/insurance-leads/:id/tasks — Create a new task
  fastify.post<{
    Params: { id: string };
    Body: {
      title: string;
      description?: string;
      priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
      dueAt?: string;
    };
  }>('/api/v1/insurance-leads/:id/tasks', async (request, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const { getPrismaClient } = await import('../lib/prisma.js');
    const prisma = getPrismaClient();

    // Verify lead belongs to tenant
    const lead = await prisma.insuranceLead.findFirst({
      where: { id: request.params.id, tenantId },
    });
    if (!lead) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Lead not found' } };
    }

    const { title, description, priority, dueAt } = request.body;
    if (!title || typeof title !== 'string' || title.trim() === '') {
      void reply.code(400);
      return { error: { code: 'VALIDATION_ERROR', message: 'Task title is required' } };
    }

    const task = await prisma.insuranceTask.create({
      data: {
        tenantId,
        insuranceLeadId: request.params.id,
        title: title.trim(),
        description: description || null,
        priority: priority || 'NORMAL',
        dueAt: dueAt ? new Date(dueAt) : null,
        status: 'OPEN',
      },
    });

    // Create activity timeline entry
    try {
      await prisma.insuranceActivity.create({
        data: {
          tenantId,
          insuranceLeadId: request.params.id,
          type: 'TASK',
          title: 'Task Created',
          description: `New task added: "${task.title}". Priority: ${task.priority}.`,
          metadata: { taskId: task.id },
        },
      });
    } catch (err) {
      request.log.error(err, 'Failed to create task activity');
    }

    return { success: true, task };
  });

  // POST /api/v1/insurance-leads/:id/tasks/:taskId/complete — Complete a task
  fastify.post<{
    Params: { id: string; taskId: string };
  }>('/api/v1/insurance-leads/:id/tasks/:taskId/complete', async (request, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const { getPrismaClient } = await import('../lib/prisma.js');
    const prisma = getPrismaClient();

    // Verify task belongs to lead and tenant
    const task = await prisma.insuranceTask.findFirst({
      where: { id: request.params.taskId, insuranceLeadId: request.params.id, tenantId },
    });

    if (!task) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Task not found' } };
    }

    const updated = await prisma.insuranceTask.update({
      where: { id: request.params.taskId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    // Create activity timeline entry
    try {
      await prisma.insuranceActivity.create({
        data: {
          tenantId,
          insuranceLeadId: request.params.id,
          type: 'TASK',
          title: 'Task Completed',
          description: `Task completed: "${task.title}".`,
          metadata: { taskId: task.id },
        },
      });
    } catch (err) {
      request.log.error(err, 'Failed to create task completion activity');
    }

    return { success: true, task: updated };
  });

  // POST /api/v1/insurance-leads/:id/tasks/:taskId/cancel — Cancel a task
  fastify.post<{
    Params: { id: string; taskId: string };
  }>('/api/v1/insurance-leads/:id/tasks/:taskId/cancel', async (request, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const { getPrismaClient } = await import('../lib/prisma.js');
    const prisma = getPrismaClient();

    // Verify task belongs to lead and tenant
    const task = await prisma.insuranceTask.findFirst({
      where: { id: request.params.taskId, insuranceLeadId: request.params.id, tenantId },
    });

    if (!task) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Task not found' } };
    }

    const updated = await prisma.insuranceTask.update({
      where: { id: request.params.taskId },
      data: {
        status: 'CANCELLED',
      },
    });

    // Create activity timeline entry
    try {
      await prisma.insuranceActivity.create({
        data: {
          tenantId,
          insuranceLeadId: request.params.id,
          type: 'TASK',
          title: 'Task Cancelled',
          description: `Task cancelled: "${task.title}".`,
          metadata: { taskId: task.id },
        },
      });
    } catch (err) {
      request.log.error(err, 'Failed to create task cancellation activity');
    }

    return { success: true, task: updated };
  });
}
