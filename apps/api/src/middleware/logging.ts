import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import { createRequestLogger } from '../lib/logger.js';
import { httpRequestDuration, httpRequestTotal, httpRequestErrors } from '../lib/metrics.js';

function parseJsonResponsePayload(payload: unknown): Record<string, any> | null {
  try {
    if (typeof payload === 'string') {
      return JSON.parse(payload) as Record<string, any>;
    }
    if (Buffer.isBuffer(payload)) {
      return JSON.parse(payload.toString('utf8')) as Record<string, any>;
    }
    if (payload && typeof payload === 'object') {
      return payload as Record<string, any>;
    }
  } catch {
    // Not a JSON response; leave it untouched.
  }
  return null;
}

export async function registerLoggingMiddleware(fastify: FastifyInstance): Promise<void> {
  // Request logging
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestLogger = createRequestLogger(request);
    request.log = requestLogger as any;
    requestLogger.info({ msg: 'Incoming request' });
  });

  /**
   * Restore buyer delivery for the CRM insurance-lead workflow without
   * disturbing the newer CRM/timeline code in insurance-lead-service.ts.
   *
   * The legacy service currently stores valid submissions as HOLD and the
   * retry handler returns a disabled response. At the response boundary we
   * have the lead/submission IDs, so we complete the buyer post, persist the
   * actual result, and return that result to the caller.
   */
  fastify.addHook('onSend', async (request, reply, payload) => {
    if (request.method !== 'POST' || reply.statusCode >= 400) return payload;

    const requestPath = request.url.split('?')[0];
    const inboundMatch = requestPath.match(
      /^\/api\/v1\/insurance-leads\/inbound\/(aca|fe)$/i
    );
    const retryMatch = requestPath.match(
      /^\/api\/v1\/insurance-leads\/([^/]+)\/submissions\/([^/]+)\/retry$/i
    );

    if (!inboundMatch && !retryMatch) return payload;

    const responseBody = parseJsonResponsePayload(payload);
    if (!responseBody) return payload;

    const tenantId =
      ((request as any).user?.tenantId as string | undefined) ||
      (request.headers['x-demo-tenant-id'] as string | undefined);
    if (!tenantId) return payload;

    let insuranceLeadId: string | undefined;
    let submissionId: string | undefined;
    const isRetry = Boolean(retryMatch);

    if (inboundMatch) {
      // Invalid leads remain stored as SKIPPED and must never be posted.
      if (responseBody.validationStatus !== 'VALID') return payload;
      insuranceLeadId = responseBody.insuranceLeadId as string | undefined;
      submissionId = responseBody.submissionId as string | undefined;
    } else if (retryMatch) {
      insuranceLeadId = decodeURIComponent(retryMatch[1]);
      submissionId = decodeURIComponent(retryMatch[2]);
    }

    if (!insuranceLeadId || !submissionId) return payload;

    try {
      const { deliverInsuranceLeadSubmission } = await import(
        '../services/insurance-lead-delivery.js'
      );
      const result = await deliverInsuranceLeadSubmission(
        tenantId,
        insuranceLeadId,
        submissionId,
        {
          attemptAlreadyCounted: isRetry,
          trigger: isRetry ? 'RETRY' : 'AUTO',
        }
      );

      if ('error' in result) {
        responseBody.postStatus = 'ERROR';
        responseBody.ameriquoteStatus = 'Error';
        responseBody.deliveryError = result.error;

        if (isRetry) {
          responseBody.success = false;
          responseBody.message = result.error;
          delete responseBody.disabled;
        }
      } else {
        responseBody.postStatus = result.postStatus;
        responseBody.postMode = result.postMode;
        responseBody.ameriquoteStatus = result.ameriquoteStatus;
        responseBody.ameriquoteLeadId = result.ameriquoteLeadId || null;
        responseBody.ameriquotePrice = result.ameriquotePrice || null;
        responseBody.deliveryError = result.errorMessage || null;

        if (isRetry) {
          responseBody.success = true;
          delete responseBody.disabled;
          delete responseBody.message;
        }
      }

      return JSON.stringify(responseBody);
    } catch (error: unknown) {
      const requestLogger = createRequestLogger(request);
      requestLogger.error({
        msg: 'Insurance lead response delivery hook failed',
        err: error,
        insuranceLeadId,
        submissionId,
      });
      return payload;
    }
  });

  // Response logging and metrics
  fastify.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    const duration = reply.getResponseTime() / 1000; // Convert to seconds
    const tenantId = (request as any).user?.tenantId || 'unknown';
    const route = request.routerPath || request.url;
    const method = request.method;
    const statusCode = reply.statusCode;

    // Log response
    const requestLogger = createRequestLogger(request);
    requestLogger.info({
      msg: 'Request completed',
      statusCode,
      duration,
      responseTime: duration,
    });

    // Record metrics
    httpRequestDuration.observe(
      {
        method,
        route,
        status_code: statusCode.toString(),
        tenant_id: tenantId,
      },
      duration
    );

    httpRequestTotal.inc({
      method,
      route,
      status_code: statusCode.toString(),
      tenant_id: tenantId,
    });

    if (statusCode >= 400) {
      httpRequestErrors.inc({
        method,
        route,
        error_type: statusCode >= 500 ? 'server_error' : 'client_error',
        tenant_id: tenantId,
      });
    }
  });

  // Error logging
  fastify.setErrorHandler((error, request: FastifyRequest, reply: FastifyReply) => {
    const requestLogger = createRequestLogger(request);
    const tenantId = (request as any).user?.tenantId || 'unknown';
    const route = request.routerPath || request.url;
    const method = request.method;

    requestLogger.error({
      msg: 'Request error',
      err: error,
      statusCode: error.statusCode || 500,
      errorCode: error.code,
      errorMessage: error.message,
    });

    // Record error metrics
    httpRequestErrors.inc({
      method,
      route,
      error_type: error.statusCode >= 500 ? 'server_error' : 'client_error',
      tenant_id: tenantId,
    });

    reply.status(error.statusCode || 500).send({
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: error.message || 'Internal server error',
        requestId: request.id,
      },
    });
  });
}
