import { FastifyInstance } from 'fastify';
import { getPrismaClient } from '../lib/prisma.js';
import { getRedisClient } from '../services/redis.js';
import { clickhouseService } from '../services/clickhouse.js';
import { logger } from '../lib/logger.js';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: {
    database: { status: 'ok' | 'error'; latency?: number; error?: string };
    redis: { status: 'ok' | 'error'; latency?: number; error?: string };
    clickhouse: { status: 'ok' | 'error' | 'disabled'; latency?: number; error?: string };
  };
}

export async function registerHealthRoutes(fastify: FastifyInstance): Promise<void> {
  // Liveness probe - just checks if the service is running
  fastify.get('/health/live', async () => {
    return { status: 'ok', service: 'hopwhistle-api' };
  });

  // Readiness probe - checks if dependencies are available
  fastify.get('/health/ready', async (request, reply) => {
    const checks: HealthStatus['checks'] = {
      database: { status: 'error' },
      redis: { status: 'error' },
      clickhouse: { status: 'disabled' },
    };

    let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    // Check database
    try {
      const start = Date.now();
      const prisma = getPrismaClient();
      await prisma.$queryRaw`SELECT 1`;
      const latency = Date.now() - start;
      checks.database = { status: 'ok', latency };
    } catch (error) {
      checks.database = {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      overallStatus = 'unhealthy';
      logger.error({ msg: 'Database health check failed', err: error });
    }

    // Check Redis
    try {
      const start = Date.now();
      const redis = getRedisClient();
      await redis.ping();
      const latency = Date.now() - start;
      checks.redis = { status: 'ok', latency };
    } catch (error) {
      checks.redis = {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      // Redis failure is not critical, mark as degraded
      if (overallStatus === 'healthy') {
        overallStatus = 'degraded';
      }
      logger.warn({ msg: 'Redis health check failed', err: error });
    }

    // Check ClickHouse (optional)
    if (clickhouseService.isEnabled()) {
      try {
        const start = Date.now();
        await clickhouseService.query('SELECT 1');
        const latency = Date.now() - start;
        checks.clickhouse = { status: 'ok', latency };
      } catch (error) {
        checks.clickhouse = {
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error',
        };
        // ClickHouse failure is not critical, mark as degraded
        if (overallStatus === 'healthy') {
          overallStatus = 'degraded';
        }
        logger.warn({ msg: 'ClickHouse health check failed', err: error });
      }
    }

    const status: HealthStatus = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      checks,
    };

    const statusCode = overallStatus === 'healthy' ? 200 : overallStatus === 'degraded' ? 200 : 503;
    reply.code(statusCode);
    return status;
  });

  // Health endpoint (detailed)
  fastify.get('/health', async () => {
    return {
      status: 'ok',
      service: 'hopwhistle-api',
      version: process.env.npm_package_version || '1.0.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  });
}

