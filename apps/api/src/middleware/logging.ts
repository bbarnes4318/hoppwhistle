import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import { createRequestLogger } from '../lib/logger.js';
import { httpRequestDuration, httpRequestTotal, httpRequestErrors } from '../lib/metrics.js';

export async function registerLoggingMiddleware(fastify: FastifyInstance): Promise<void> {
  // Request logging
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const requestLogger = createRequestLogger(request);
    request.log = requestLogger as any;
    requestLogger.info({ msg: 'Incoming request' });
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

