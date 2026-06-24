/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument */
/**
 * Insurance Lead Pipeline — API Routes
 *
 * All routes under /api/v1/insurance-leads
 * Uses the existing Fastify API-key auth pattern (x-api-key header)
 * so tenantId resolves from the global auth hook.
 */

import { spawn } from 'child_process';

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

function runPreClosedPython(leads: any[]): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const scriptPath = 'scripts/process-preclosed.py';
    const pyProcess = spawn('python3', [scriptPath]);

    let stdoutData = '';
    let stderrData = '';

    pyProcess.stdout.on('data', data => {
      stdoutData += data.toString();
    });

    pyProcess.stderr.on('data', data => {
      stderrData += data.toString();
    });

    pyProcess.on('close', code => {
      if (code !== 0) {
        const fallbackProcess = spawn('python', [scriptPath]);
        let fStdout = '';
        let fStderr = '';

        fallbackProcess.stdout.on('data', d => {
          fStdout += d.toString();
        });
        fallbackProcess.stderr.on('data', d => {
          fStderr += d.toString();
        });
        fallbackProcess.on('close', fCode => {
          if (fCode !== 0) {
            reject(
              new Error(
                `Python process exited with code ${fCode}. Stderr: ${fStderr || stderrData}`
              )
            );
          } else {
            try {
              resolve(JSON.parse(fStdout));
            } catch (err) {
              reject(err);
            }
          }
        });

        fallbackProcess.stdin.write(JSON.stringify(leads));
        fallbackProcess.stdin.end();
      } else {
        try {
          resolve(JSON.parse(stdoutData));
        } catch (err) {
          reject(err);
        }
      }
    });

    pyProcess.stdin.write(JSON.stringify(leads));
    pyProcess.stdin.end();
  });
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
      listName?: string;
      listId?: string;
    };
  }>('/api/v1/insurance-leads/import', async (request, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Valid API key required' } };
    }

    const { vertical: rawVertical, leads, listName, listId: reqListId } = request.body;
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
      const { getPrismaClient, ingestLead } = await import('../services/insurance-lead-service.js');
      const prisma = getPrismaClient();

      let targetListId = reqListId || null;
      let listRecord = null;

      if (!targetListId && listName && listName.trim()) {
        const trimmedName = listName.trim();
        listRecord = await prisma.leadList.findFirst({
          where: { tenantId, name: { equals: trimmedName, mode: 'insensitive' } },
        });
        if (!listRecord) {
          listRecord = await prisma.leadList.create({
            data: {
              tenantId,
              name: trimmedName,
              vertical: vertical as 'ACA' | 'FE',
            },
          });
        }
        targetListId = listRecord.id;
      } else if (targetListId) {
        listRecord = await prisma.leadList.findUnique({ where: { id: targetListId } });
      }

      const isPreClosed = listRecord && listRecord.name.toLowerCase() === 'preclosed';
      let processedLeads = leads;

      if (isPreClosed) {
        try {
          processedLeads = await runPreClosedPython(leads);
        } catch (pyErr) {
          request.log.error(pyErr, 'Failed to process PreClosed leads in Python');
        }
      }

      const results = [];

      for (const lead of processedLeads) {
        try {
          let customFields =
            lead.customFields && typeof lead.customFields === 'object'
              ? { ...lead.customFields }
              : {};
          if (isPreClosed) {
            customFields = {
              ...customFields,
              primaryBeneficiaryName: lead.primaryBeneficiaryName || '',
              primaryBeneficiaryRelationship: lead.primaryBeneficiaryRelationship || '',
              amamQuote: lead.amamQuote || null,
              amamLessThanCurrent: lead.amamLessThanCurrent || null,
              gtlQuote: lead.gtlQuote || null,
              gtlLessThanCurrent: lead.gtlLessThanCurrent || null,
              cheapestCarrierUnderCurrent: lead.cheapestCarrierUnderCurrent || '',
              savingsVsCurrent: lead.savingsVsCurrent || null,
              dob: lead.dob || null,
              firstPremiumDate: lead.firstPremiumDate || null,
            };
          }

          const payload = {
            ...lead,
            customFields,
            ...(targetListId ? { listId: targetListId } : {}),
          };
          const result = await ingestLead(tenantId, vertical as 'ACA' | 'FE', payload);
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
      listId?: string;
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
      listId: q.listId,
    });

    return result;
  });

  // -----------------------------------------------------------------------
  // GET /api/v1/lead-lists — List all lead lists for tenant
  // -----------------------------------------------------------------------
  fastify.get('/api/v1/lead-lists', async (request, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const { getPrismaClient } = await import('../services/insurance-lead-service.js');
    const prisma = getPrismaClient();

    const lists = await prisma.leadList.findMany({
      where: { tenantId },
      include: {
        _count: {
          select: { leads: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return lists;
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

  // -----------------------------------------------------------------------
  // DELETE /api/v1/insurance-leads — Bulk delete leads
  // -----------------------------------------------------------------------
  fastify.delete<{
    Body: { ids: string[] };
  }>('/api/v1/insurance-leads', async (request, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const { ids } = request.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      void reply.code(400);
      return { error: { code: 'INVALID_BODY', message: 'Must provide an array of ids' } };
    }

    const { getPrismaClient } = await import('../lib/prisma.js');
    const prisma = getPrismaClient();

    const result = await prisma.insuranceLead.deleteMany({
      where: {
        tenantId,
        id: { in: ids },
      },
    });

    return { success: true, count: result.count };
  });

  // -----------------------------------------------------------------------
  // POST /api/v1/insurance-leads/bulk — Bulk import leads
  // -----------------------------------------------------------------------
  fastify.post<{
    Body: { leads: Array<Record<string, unknown>> };
  }>('/api/v1/insurance-leads/bulk', async (request, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const { leads } = request.body;
    if (!leads || !Array.isArray(leads)) {
      void reply.code(400);
      return { error: { code: 'INVALID_BODY', message: 'leads must be an array of objects' } };
    }

    try {
      const { bulkImportLeads } = await import('../services/insurance-lead-service.js');
      const result = await bulkImportLeads(tenantId, leads);
      return result;
    } catch (error: unknown) {
      void reply.code(500);
      return {
        error: {
          code: 'IMPORT_FAILED',
          message: (error as Error).message || 'Failed to bulk import leads',
        },
      };
    }
  });
}
