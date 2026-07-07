/**
 * Carrier Application Automation Routes (American Amicable RPA).
 *
 * fe-rickie style asynchronous flow:
 *   1. Authenticate and resolve tenant.
 *   2. Validate & normalize the payload (400 before any browser work).
 *   3. Persist an InsuranceCarrierApplication row (sensitive fields encrypted).
 *   4. Create an in-memory job and start Puppeteer asynchronously.
 *   5. Return { success, jobId, applicationId } immediately.
 *   6. Stream progress via SSE; persist final status + carrier application
 *      number (or sanitized failure) to Postgres.
 *
 * Endpoints:
 *   POST /api/v1/automation/american-amicable/run   (canonical)
 *   GET  /api/v1/automation/jobs/:jobId
 *   GET  /api/v1/automation/jobs/:jobId/stream      (SSE)
 * Legacy fe-rickie-compatible aliases (explicitly authenticated in-route,
 * since /api/automation/* sits outside the global /api/v1 auth hook):
 *   POST /api/automation/run-carrier-app
 *   GET  /api/automation/status/:jobId              (SSE)
 *   GET  /api/automation/result/:jobId
 *   GET  /api/automation/stream/:jobId              (SSE)
 *
 * NOTE: This module is intentionally isolated from all phone/dialer/SIP/
 * FreeSWITCH/call-state functionality and must never import from those services.
 */

import { createHash } from 'crypto';

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { getPrismaClient } from '../lib/prisma.js';
import { runAmericanAmicableAutomation } from '../services/carrier-rpa/american-amicable.js';
import {
  createCarrierApplication,
  markAutomationCompleted,
  markAutomationFailed,
  markAutomationRunning,
} from '../services/carrier-rpa/application-store.js';
import {
  automationEvents,
  createJob,
  completeJob,
  failJob,
  generateJobId,
  getJob,
  type AutomationJob,
  type JobStep,
} from '../services/carrier-rpa/job-store.js';
import { validateAndNormalizePayload } from '../services/carrier-rpa/normalization.js';
import {
  redactPayload,
  safeApplicantSummary,
  sanitizeErrorMessage,
} from '../services/carrier-rpa/redaction.js';

interface TenantContext {
  tenantId: string;
  userId?: string;
}

interface AuthenticatedUser {
  tenantId?: string;
  userId?: string;
  apiKeyId?: string;
  scopes?: string[];
}

/**
 * Resolve the tenant for a request. For /api/v1/* routes the global auth hook
 * has already populated request.user; for the legacy /api/automation/* aliases
 * we perform the same checks explicitly (JWT header, query token, API key,
 * demo tenant header) so carrier submission is never unauthenticated.
 */
async function resolveTenantContext(
  fastify: FastifyInstance,
  request: FastifyRequest
): Promise<TenantContext | null> {
  const existingUser = (request as FastifyRequest & { user?: AuthenticatedUser }).user;
  if (existingUser?.tenantId) {
    return { tenantId: existingUser.tenantId, userId: existingUser.userId };
  }

  // JWT via Authorization header
  const authHeader = request.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- @fastify/jwt module augmentation is not reliably picked up (same pattern as middleware/auth.ts)
      const decoded = (await request.jwtVerify()) as { tenantId?: string; userId?: string };
      if (decoded?.tenantId) {
        return { tenantId: decoded.tenantId, userId: decoded.userId };
      }
    } catch {
      // Fall through to other auth methods
    }
  }

  // JWT via ?token= query param (required for EventSource/SSE clients)
  const queryToken = (request.query as Record<string, string | undefined>)?.token;
  if (queryToken) {
    try {
      const decoded = fastify.jwt.verify<{ tenantId?: string; userId?: string }>(queryToken);
      if (decoded?.tenantId) {
        return { tenantId: decoded.tenantId, userId: decoded.userId };
      }
    } catch {
      // Fall through
    }
  }

  // API key
  const apiKey = request.headers['x-api-key'] as string | undefined;
  if (apiKey) {
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
        return { tenantId: dbApiKey.tenantId };
      }
    } catch {
      // Fall through
    }
  }

  // Demo tenant (same fallback the global /api/v1 hook allows)
  const demoTenantId =
    (request.headers['x-demo-tenant-id'] as string | undefined) ||
    (request.query as Record<string, string | undefined>)?.demoTenantId;
  if (demoTenantId) {
    return { tenantId: demoTenantId };
  }

  return null;
}

function unauthorized(reply: FastifyReply): FastifyReply {
  return reply.code(401).send({
    error: {
      code: 'UNAUTHORIZED',
      message: 'Authentication required. Valid tenant context missing.',
    },
  });
}

/**
 * Start the RPA asynchronously for a validated payload.
 * Returns immediately with the jobId and persisted application id.
 */
async function startAutomationRun(
  fastify: FastifyInstance,
  body: Record<string, unknown>,
  tenant: TenantContext,
  reply: FastifyReply
): Promise<FastifyReply> {
  // 1. Validate & normalize BEFORE any job/browser work
  const validation = validateAndNormalizePayload(body as Record<string, never>);
  if (!validation.isValid) {
    fastify.log.warn({
      event: 'carrier_automation_validation_failed',
      tenantId: tenant.tenantId,
      errors: validation.errors,
    });
    return reply.code(400).send({
      success: false,
      error: 'Validation failed before starting automation',
      errors: validation.errors,
    });
  }

  const { normalized } = validation;
  const jobId = generateJobId();

  // 2. Persist the application (sensitive fields encrypted at rest)
  let applicationId: string | null = null;
  try {
    const application = await createCarrierApplication({
      tenantId: tenant.tenantId,
      jobId,
      normalized,
      createdById: tenant.userId || null,
    });
    applicationId = application.id;
  } catch (err) {
    fastify.log.error({
      event: 'carrier_application_persist_failed',
      tenantId: tenant.tenantId,
      jobId,
      error: sanitizeErrorMessage((err as Error).message),
    });
    return reply.code(500).send({
      success: false,
      error: 'Failed to persist carrier application record',
    });
  }

  // 3. Create the in-memory job (redacted input summary only)
  createJob(jobId, tenant.tenantId, redactPayload(normalized), applicationId);

  fastify.log.info({
    event: 'carrier_automation_started',
    jobId,
    tenantId: tenant.tenantId,
    applicationId,
    ...safeApplicantSummary(normalized),
  });

  // 4. Launch the Puppeteer automation ASYNCHRONOUSLY — do not await
  const persistedApplicationId = applicationId;
  void markAutomationRunning(persistedApplicationId)
    .catch(err => {
      fastify.log.error({
        event: 'carrier_automation_mark_running_failed',
        jobId,
        applicationId: persistedApplicationId,
        error: sanitizeErrorMessage((err as Error).message),
      });
    })
    .then(() => runAmericanAmicableAutomation(normalized, jobId))
    .then(async result => {
      if (result.success && result.applicationNumber) {
        completeJob(jobId, result as unknown as Record<string, unknown>);
        try {
          await markAutomationCompleted(persistedApplicationId, result.applicationNumber);
          fastify.log.info({
            event: 'carrier_automation_completed',
            jobId,
            applicationId: persistedApplicationId,
            carrierApplicationNumber: result.applicationNumber,
          });
        } catch (dbError) {
          fastify.log.error({
            event: 'carrier_automation_persist_completion_failed',
            jobId,
            applicationId: persistedApplicationId,
            error: sanitizeErrorMessage((dbError as Error).message),
          });
        }
      } else {
        const errMsg = sanitizeErrorMessage(result.error || 'Unknown automation failure');
        failJob(jobId, errMsg);
        try {
          await markAutomationFailed(persistedApplicationId, errMsg, result.debugSnapshotPath);
        } catch (dbError) {
          fastify.log.error({
            event: 'carrier_automation_persist_failure_failed',
            jobId,
            applicationId: persistedApplicationId,
            error: sanitizeErrorMessage((dbError as Error).message),
          });
        }
      }
    })
    .catch(async err => {
      const errMsg = sanitizeErrorMessage((err as Error).message || 'Automation crashed');
      failJob(jobId, errMsg);
      try {
        await markAutomationFailed(persistedApplicationId, errMsg);
      } catch (dbError) {
        fastify.log.error({
          event: 'carrier_automation_persist_exception_failed',
          jobId,
          applicationId: persistedApplicationId,
          error: sanitizeErrorMessage((dbError as Error).message),
        });
      }
    });

  // 5. Return immediately
  return reply.send({ success: true, jobId, applicationId });
}

/**
 * Fetch a job scoped to the requesting tenant.
 */
function getTenantJob(jobId: string, tenantId: string): AutomationJob | null {
  const job = getJob(jobId);
  if (!job) return null;
  if (job.tenantId !== tenantId) return null;
  return job;
}

/**
 * Stream a job's historical steps and live updates as SSE, closing when the
 * job reaches a terminal state. (fe-rickie /status/:jobId behavior)
 */
function streamJobAsSSE(request: FastifyRequest, reply: FastifyReply, job: AutomationJob): void {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  // Write historical updates immediately
  job.steps.forEach(step => {
    reply.raw.write(`data: ${JSON.stringify(step)}\n\n`);
  });

  if (job.status === 'completed' || job.status === 'failed') {
    reply.raw.end();
    return;
  }

  const onStatusUpdate = (update: JobStep): void => {
    if (reply.raw.writableEnded) return;
    reply.raw.write(`data: ${JSON.stringify(update)}\n\n`);

    if (update.status === 'completed' || update.status === 'failed') {
      cleanup();
    }
  };

  const cleanup = (): void => {
    automationEvents.removeListener(`status:${job.jobId}`, onStatusUpdate);
    if (!reply.raw.writableEnded) {
      reply.raw.end();
    }
  };

  automationEvents.on(`status:${job.jobId}`, onStatusUpdate);

  request.raw.on('close', () => {
    cleanup();
  });
}

function jobToResultResponse(job: AutomationJob): Record<string, unknown> {
  return {
    jobId: job.jobId,
    status: job.status,
    steps: job.steps,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    applicationNumber: job.applicationNumber,
    applicationId: job.applicationId,
    // job.result/inputSummary are already redacted or carrier-safe values
    result: job.result,
    error: job.error,
  };
}

// eslint-disable-next-line @typescript-eslint/require-await -- Fastify plugins must return a promise
export async function registerAutomationRoutes(fastify: FastifyInstance): Promise<void> {
  // ══════════════════════════════════════════════════════════════════════
  // Canonical v1 endpoints (global /api/v1 auth hook applies)
  // ══════════════════════════════════════════════════════════════════════

  fastify.post('/api/v1/automation/american-amicable/run', async (request, reply) => {
    const tenant = await resolveTenantContext(fastify, request);
    if (!tenant) return unauthorized(reply);
    return startAutomationRun(fastify, request.body as Record<string, unknown>, tenant, reply);
  });

  fastify.get<{ Params: { jobId: string } }>(
    '/api/v1/automation/jobs/:jobId',
    async (request, reply) => {
      const tenant = await resolveTenantContext(fastify, request);
      if (!tenant) return unauthorized(reply);

      const job = getTenantJob(request.params.jobId, tenant.tenantId);
      if (!job) {
        return reply.code(404).send({ success: false, error: 'Job not found' });
      }
      return reply.send(jobToResultResponse(job));
    }
  );

  fastify.get<{ Params: { jobId: string } }>(
    '/api/v1/automation/jobs/:jobId/stream',
    async (request, reply) => {
      const tenant = await resolveTenantContext(fastify, request);
      if (!tenant) return unauthorized(reply);

      const job = getTenantJob(request.params.jobId, tenant.tenantId);
      if (!job) {
        return reply.code(404).send({ success: false, error: 'Job not found' });
      }
      streamJobAsSSE(request, reply, job);
    }
  );

  // ══════════════════════════════════════════════════════════════════════
  // Legacy fe-rickie-compatible aliases (auth enforced in-route)
  // ══════════════════════════════════════════════════════════════════════

  fastify.post('/api/automation/run-carrier-app', async (request, reply) => {
    const tenant = await resolveTenantContext(fastify, request);
    if (!tenant) return unauthorized(reply);
    return startAutomationRun(fastify, request.body as Record<string, unknown>, tenant, reply);
  });

  // SSE stream of historical + live updates (fe-rickie style)
  fastify.get<{ Params: { jobId: string } }>(
    '/api/automation/status/:jobId',
    async (request, reply) => {
      const tenant = await resolveTenantContext(fastify, request);
      if (!tenant) return unauthorized(reply);

      const job = getTenantJob(request.params.jobId, tenant.tenantId);
      if (!job) {
        return reply.code(404).send({ error: 'Job not found' });
      }
      streamJobAsSSE(request, reply, job);
    }
  );

  // Alias kept for the ApplicationSubmission component
  fastify.get<{ Params: { jobId: string } }>(
    '/api/automation/stream/:jobId',
    async (request, reply) => {
      const tenant = await resolveTenantContext(fastify, request);
      if (!tenant) return unauthorized(reply);

      const job = getTenantJob(request.params.jobId, tenant.tenantId);
      if (!job) {
        return reply.code(404).send({ error: 'Job not found' });
      }
      streamJobAsSSE(request, reply, job);
    }
  );

  fastify.get<{ Params: { jobId: string } }>(
    '/api/automation/result/:jobId',
    async (request, reply) => {
      const tenant = await resolveTenantContext(fastify, request);
      if (!tenant) return unauthorized(reply);

      const job = getTenantJob(request.params.jobId, tenant.tenantId);
      if (!job) {
        return reply.code(404).send({ success: false, error: 'Job not found' });
      }
      return reply.send(jobToResultResponse(job));
    }
  );

  // Simple health check (no data exposure)
  fastify.get('/api/automation/test', async (_request, reply) => {
    return reply.send({
      status: 'Automation route is working',
      timestamp: new Date().toISOString(),
    });
  });
}
