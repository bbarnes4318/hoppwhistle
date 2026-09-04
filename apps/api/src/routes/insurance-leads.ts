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

interface DeliverySelector {
  listId?: string;
  vertical?: 'ACA' | 'FE' | 'B2B';
  submissionIds?: string[];
}

/**
 * Bulk delivery must always be scoped. Without a listId or an explicit set of
 * submissions, one call would release every held lead the tenant has ever
 * imported, which is not something anyone means to do by accident.
 */
function parseDeliverySelector(body: {
  listId?: string;
  vertical?: string;
  submissionIds?: string[];
}): { value: DeliverySelector } | { error: string } {
  const listId =
    typeof body.listId === 'string' && body.listId.trim() ? body.listId.trim() : undefined;
  const submissionIds =
    Array.isArray(body.submissionIds) && body.submissionIds.length
      ? body.submissionIds.filter(id => typeof id === 'string' && id.trim()).map(id => id.trim())
      : undefined;

  if (!listId && !submissionIds?.length) {
    return { error: 'Provide a listId or submissionIds — a bulk send must be scoped to a batch' };
  }

  let vertical: DeliverySelector['vertical'];
  if (body.vertical) {
    const upper = String(body.vertical).toUpperCase();
    if (upper !== 'ACA' && upper !== 'FE' && upper !== 'B2B') {
      return { error: `Invalid vertical "${body.vertical}". Must be "aca", "fe", or "b2b".` };
    }
    vertical = upper;
  }

  return { value: { listId, submissionIds, vertical } };
}

/**
 * Query-string booleans arrive as strings, and `Boolean('false')` is true. Only
 * an affirmative spelling counts, so `?deliver=false` does not post a lead.
 */
/**
 * A CSV export covers the whole filtered set, so it deliberately skips the
 * page size the grid uses. This ceiling is what keeps "export everything" from
 * meaning "stream the entire tenant into one response".
 */
const MAX_EXPORT_ROWS = 50000;

type ReportOutcome = 'ACCEPTED' | 'NOT_ACCEPTED' | 'NOT_SENT';

/**
 * `?outcome=` is the filter a human reaches for first — "show me the ones that
 * were not accepted". A typo must not silently widen that to every row, so an
 * unrecognised value is a 400 rather than an ignored filter.
 */
function parseOutcome(
  value: string | undefined
): { value: ReportOutcome | undefined } | { error: string } {
  if (!value || !value.trim()) return { value: undefined };
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  const aliases: Record<string, ReportOutcome> = {
    ACCEPTED: 'ACCEPTED',
    NOT_ACCEPTED: 'NOT_ACCEPTED',
    REJECTED: 'NOT_ACCEPTED',
    NOT_SENT: 'NOT_SENT',
    UNSENT: 'NOT_SENT',
  };
  const match = aliases[normalized];
  if (!match) {
    return {
      error: `Invalid outcome "${value}". Must be "accepted", "not_accepted", or "not_sent".`,
    };
  }
  return { value: match };
}

export function isTruthyFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
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
    Querystring: { deliver?: string; force?: string };
    Body: Record<string, unknown>;
  }>('/api/v1/insurance-leads/inbound/:vertical', async (request, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Valid API key required' } };
    }

    const { vertical: rawVertical } = request.params;
    const vertical = rawVertical.toUpperCase();

    if (vertical !== 'ACA' && vertical !== 'FE' && vertical !== 'B2B') {
      void reply.code(400);
      return {
        error: {
          code: 'INVALID_VERTICAL',
          message: `Invalid vertical "${rawVertical}". Must be "aca", "fe", or "b2b".`,
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
      const result = await ingestLead(tenantId, vertical as 'ACA' | 'FE' | 'B2B', body);

      // Ingest parks every lead on HOLD and never posts as a side effect. That
      // default stays: ?deliver=true is the caller saying "and send it", so a
      // system that means to post one lead per request can do it in one call
      // without every other importer silently gaining the same behaviour.
      let delivery = null;
      if (isTruthyFlag(request.query?.deliver) && result.validationStatus === 'VALID') {
        const { bulkDeliverInsuranceLeads } = await import(
          '../services/insurance-lead-bulk-delivery.js'
        );
        delivery = await bulkDeliverInsuranceLeads(tenantId, {
          submissionIds: [result.submissionId],
          force: isTruthyFlag(request.query?.force),
        });
      }

      const outcome = delivery?.results[0];
      void reply.code(result.validationStatus === 'VALID' ? 200 : 422);
      return {
        success: result.validationStatus === 'VALID',
        insuranceLeadId: result.insuranceLeadId,
        submissionId: result.submissionId,
        validationStatus: result.validationStatus,
        // The post status after delivery, when one was asked for — reporting
        // the pre-send HOLD here would tell the caller the opposite of what
        // just happened.
        postStatus: outcome ? outcome.outcome : result.postStatus,
        postMode: result.postMode,
        ameriquoteStatus: outcome ? outcome.outcome : result.ameriquoteStatus || null,
        ameriquoteLeadId: outcome?.ameriquoteLeadId ?? null,
        ameriquotePrice: outcome?.ameriquotePrice ?? null,
        deliveryMessage: outcome?.message ?? null,
        deliveryBlockers: outcome?.blockers ?? null,
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
      deliver?: boolean;
      force?: boolean;
    };
  }>('/api/v1/insurance-leads/import', async (request, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Valid API key required' } };
    }

    const {
      vertical: rawVertical,
      leads,
      listName,
      listId: reqListId,
      deliver,
      force,
    } = request.body;
    if (!rawVertical || !Array.isArray(leads)) {
      void reply.code(400);
      return { error: { code: 'INVALID_BODY', message: 'Must provide vertical and leads array' } };
    }

    // A delivering import posts to the buyer inside the request, so the batch
    // has to fit in one HTTP timeout. Import without `deliver` stays unbounded.
    const { MAX_BATCH_SIZE } = await import('../services/insurance-lead-bulk-delivery.js');
    if (deliver === true && leads.length > MAX_BATCH_SIZE) {
      void reply.code(400);
      return {
        error: {
          code: 'BATCH_TOO_LARGE',
          message:
            `A delivering import is capped at ${MAX_BATCH_SIZE} leads per call (got ${leads.length}). ` +
            'Send it in chunks, or import without `deliver` and release the list with ' +
            'POST /api/v1/insurance-leads/delivery/send.',
        },
      };
    }

    const vertical = rawVertical.toUpperCase();
    if (vertical !== 'ACA' && vertical !== 'FE' && vertical !== 'B2B') {
      void reply.code(400);
      return {
        error: {
          code: 'INVALID_VERTICAL',
          message: `Invalid vertical "${rawVertical}". Must be "aca", "fe", or "b2b".`,
        },
      };
    }

    try {
      const { ingestLead } = await import('../services/insurance-lead-service.js');
      const { getPrismaClient } = await import('../lib/prisma.js');
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
              vertical: vertical as 'ACA' | 'FE' | 'B2B',
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
            // SubSource is how a matched lead is traced back to the batch it
            // came from. No CSV carries a column for it, so it defaults to the
            // list name — a mapped Source column still wins.
            ...(lead.source || !listRecord ? {} : { source: listRecord.name }),
          };
          const result = await ingestLead(tenantId, vertical as 'ACA' | 'FE' | 'B2B', payload);
          results.push({
            success: result.validationStatus === 'VALID',
            phone: String(lead.phone || ''),
            name: `${String(lead.firstName || '')} ${String(lead.lastName || '')}`.trim(),
            submissionId: result.submissionId,
            errors: result.errors || null,
          });
        } catch (err: unknown) {
          results.push({
            success: false,
            phone: String(lead.phone || ''),
            name: `${String(lead.firstName || '')} ${String(lead.lastName || '')}`.trim(),
            submissionId: null,
            errors: [
              { path: 'system', message: (err as Error).message || 'System ingestion failure' },
            ],
          });
        }
      }

      // Import parks every lead on HOLD by default — nothing reaches the buyer
      // as a side effect of storing it. `deliver: true` is the caller asking
      // for the send as well, scoped to exactly the submissions this call
      // created so it can never release the rest of the list.
      let delivery = null;
      if (deliver === true) {
        const ids = results
          .map(r => r.submissionId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0);

        if (ids.length) {
          const { bulkDeliverInsuranceLeads } = await import(
            '../services/insurance-lead-bulk-delivery.js'
          );
          delivery = await bulkDeliverInsuranceLeads(tenantId, {
            submissionIds: ids,
            limit: ids.length,
            force: force === true,
          });
        }
      }

      return {
        total: leads.length,
        successCount: results.filter(r => r.success).length,
        failCount: results.filter(r => !r.success).length,
        // Null when the caller did not ask to deliver, so "we sent nothing"
        // and "we sent and everything bounced" stay tellable apart.
        delivery,
        // Returned so a chunked import can pin every later batch to the list
        // the first batch created, and so the caller can preflight delivery.
        listId: targetListId,
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
      format?: string;
    };
  }>('/api/v1/insurance-leads', async (request, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const { getLeads } = await import('../services/insurance-lead-service.js');
    const q = request.query;
    const wantsCsv = q.format?.toLowerCase() === 'csv';

    const result = await getLeads(tenantId, {
      // An export covers the whole filtered set, not the page on screen.
      page: wantsCsv ? 1 : q.page ? parseInt(q.page) : undefined,
      limit: wantsCsv ? MAX_EXPORT_ROWS : q.limit ? parseInt(q.limit) : undefined,
      vertical: q.vertical?.toUpperCase() as 'ACA' | 'FE' | 'B2B' | undefined,
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

    if (wantsCsv) {
      const { leadsToCsv, reportFilename } = await import('../services/insurance-lead-reports.js');
      return reply
        .type('text/csv; charset=utf-8')
        .header(
          'Content-Disposition',
          `attachment; filename="${reportFilename('crm_leads', q.startDate, q.endDate)}"`
        )
        .send(leadsToCsv(result.data));
    }

    return result;
  });

  // -----------------------------------------------------------------------
  // GET /api/v1/insurance-leads/delivery-report
  //
  // Which leads Ameriquote accepted, which it did not, and the reason it gave
  // for each. Renders as JSON, or as a CSV with `?format=csv` — the export is
  // built from the same rows the screen shows, so the two cannot disagree.
  // -----------------------------------------------------------------------
  fastify.get<{
    Querystring: {
      startDate?: string;
      endDate?: string;
      vertical?: string;
      listId?: string;
      postStatus?: string;
      postMode?: string;
      outcome?: string;
      search?: string;
      page?: string;
      limit?: string;
      format?: string;
    };
  }>('/api/v1/insurance-leads/delivery-report', async (request, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const q = request.query;
    const wantsCsv = q.format?.toLowerCase() === 'csv';

    const outcome = parseOutcome(q.outcome);
    if ('error' in outcome) {
      void reply.code(400);
      return { error: { code: 'INVALID_OUTCOME', message: outcome.error } };
    }

    const vertical = q.vertical?.toUpperCase();
    if (vertical && vertical !== 'ACA' && vertical !== 'FE' && vertical !== 'B2B') {
      void reply.code(400);
      return {
        error: {
          code: 'INVALID_VERTICAL',
          message: `Invalid vertical "${q.vertical}". Must be "aca", "fe", or "b2b".`,
        },
      };
    }

    const { getDeliveryReport, deliveryReportToCsv, reportFilename, MAX_REPORT_ROWS } =
      await import('../services/insurance-lead-reports.js');

    const report = await getDeliveryReport(tenantId, {
      startDate: q.startDate,
      endDate: q.endDate,
      vertical: vertical as 'ACA' | 'FE' | 'B2B' | undefined,
      listId: q.listId,
      postStatus: q.postStatus?.toUpperCase(),
      postMode: q.postMode?.toUpperCase() as 'TEST' | 'LIVE' | undefined,
      outcome: outcome.value,
      search: q.search,
      page: wantsCsv ? 1 : q.page ? parseInt(q.page) : undefined,
      limit: wantsCsv ? MAX_REPORT_ROWS : q.limit ? parseInt(q.limit) : undefined,
    });

    if (wantsCsv) {
      return reply
        .type('text/csv; charset=utf-8')
        .header(
          'Content-Disposition',
          `attachment; filename="${reportFilename('ameriquote_delivery_report', q.startDate, q.endDate)}"`
        )
        .send(deliveryReportToCsv(report.rows));
    }

    return report;
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

    const { getPrismaClient } = await import('../lib/prisma.js');
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
  // DELETE /api/v1/lead-lists/:id — Delete a lead list and its leads
  // -----------------------------------------------------------------------
  fastify.delete<{ Params: { id: string } }>('/api/v1/lead-lists/:id', async (request, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const { id } = request.params;
    const { getPrismaClient } = await import('../lib/prisma.js');
    const prisma = getPrismaClient();

    // Verify list exists and belongs to the tenant
    const list = await prisma.leadList.findFirst({
      where: { id, tenantId },
    });

    if (!list) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Lead list not found' } };
    }

    // Delete all leads in this list first
    await prisma.insuranceLead.deleteMany({
      where: {
        tenantId,
        listId: id,
      },
    });

    // Delete the list itself
    await prisma.leadList.delete({
      where: { id },
    });

    return { success: true };
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
  // POST /api/v1/insurance-leads/delivery/preflight
  //
  // Read-only. Reports how many held leads the buyer would accept, and why
  // the rest would bounce, so a 1,000-lead batch can be checked before a
  // single post is spent on it.
  // -----------------------------------------------------------------------
  fastify.post<{
    Body: { listId?: string; vertical?: string; submissionIds?: string[] };
  }>('/api/v1/insurance-leads/delivery/preflight', async (request, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const selector = parseDeliverySelector(request.body || {});
    if ('error' in selector) {
      void reply.code(400);
      return { error: { code: 'INVALID_BODY', message: selector.error } };
    }

    try {
      const { preflightBulkDelivery } = await import('../services/insurance-lead-bulk-delivery.js');
      return await preflightBulkDelivery(tenantId, selector.value);
    } catch (error: unknown) {
      void reply.code(500);
      return {
        error: {
          code: 'PREFLIGHT_FAILED',
          message: (error as Error).message || 'Failed to run delivery preflight',
        },
      };
    }
  });

  // -----------------------------------------------------------------------
  // POST /api/v1/insurance-leads/delivery/send
  //
  // The explicit bulk release. Ingest never posts on its own, so this is the
  // only path that sends imported leads to the buyer in bulk. Batched by
  // cursor: keep calling with the returned nextCursor until it comes back null.
  // -----------------------------------------------------------------------
  fastify.post<{
    Body: {
      listId?: string;
      vertical?: string;
      submissionIds?: string[];
      limit?: number;
      force?: boolean;
      cursor?: string;
    };
  }>('/api/v1/insurance-leads/delivery/send', async (request, reply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const body = request.body || {};
    const selector = parseDeliverySelector(body);
    if ('error' in selector) {
      void reply.code(400);
      return { error: { code: 'INVALID_BODY', message: selector.error } };
    }

    if (body.limit !== undefined && (typeof body.limit !== 'number' || body.limit < 1)) {
      void reply.code(400);
      return { error: { code: 'INVALID_BODY', message: 'limit must be a positive number' } };
    }

    try {
      const { bulkDeliverInsuranceLeads } = await import(
        '../services/insurance-lead-bulk-delivery.js'
      );
      return await bulkDeliverInsuranceLeads(tenantId, {
        ...selector.value,
        limit: body.limit,
        force: body.force === true,
        cursor: typeof body.cursor === 'string' && body.cursor ? body.cursor : undefined,
      });
    } catch (error: unknown) {
      void reply.code(500);
      return {
        error: {
          code: 'DELIVERY_FAILED',
          message: (error as Error).message || 'Failed to deliver leads',
        },
      };
    }
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
