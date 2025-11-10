import { FastifyRequest } from 'fastify';
import pino from 'pino';

const isDevelopment = process.env.NODE_ENV === 'development';

export const logger = pino({
  level: process.env.LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
  transport: isDevelopment
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  formatters: {
    level: label => {
      return { level: label };
    },
  },
  base: {
    service: 'hopwhistle-api',
    version: process.env.npm_package_version || '1.0.0',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export function createRequestLogger(request: FastifyRequest) {
  const requestId = request.id;
  const tenantId = (request as any).user?.tenantId || 'unknown';
  const userId = (request as any).user?.userId || 'unknown';

  return logger.child({
    requestId,
    tenantId,
    userId,
    method: request.method,
    url: request.url,
  });
}

export function createServiceLogger(service: string, context?: Record<string, unknown>) {
  return logger.child({
    service,
    ...context,
  });
}
