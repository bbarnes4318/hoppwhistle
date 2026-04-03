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
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/insurance-leads/:id',
    async (request, reply) => {
      const tenantId = getTenantId(request);
      if (!tenantId) {
        void reply.code(401);
        return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
      }

      const { getLeadById } = await import('../services/insurance-lead-service.js');
      const lead = await getLeadById(tenantId, request.params.id);

      if (!lead) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Lead not found' } };
      }

      return lead;
    }
  );

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
    const result = await retrySubmission(
      tenantId,
      request.params.id,
      request.params.submissionId,
    );

    if ('error' in result) {
      void reply.code(400);
      return { error: { code: 'RETRY_FAILED', message: String(result.error) } };
    }

    return result;
  });
}
