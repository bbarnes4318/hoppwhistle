import 'dotenv-flow/config';
import { join } from 'path';

import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';

import { logger } from './lib/logger.js';
import { register } from './lib/metrics.js';
import { closePrismaClient } from './lib/prisma.js';
import { initTracing, shutdownTracing } from './lib/tracing.js';
import { registerAuth } from './middleware/auth.js';
import { registerLoggingMiddleware } from './middleware/logging.js';
import { registerAdminBillingRoutes } from './routes/admin-billing.js';
import { registerDemoEventRoutes } from './routes/demo-events.js';
import { registerHealthRoutes } from './routes/health.js';
import {
  registerNumberRoutes,
  registerCampaignRoutes,
  registerCallRoutes,
  registerWebhookRoutes,
  registerReportingRoutes,
  registerBillingRoutes,
  registerAdminTenantRoutes,
  registerAdminNumberRoutes,
  registerAdminCarrierRoutes,
  registerAdminTrunkRoutes,
  registerAdminRateCardRoutes,
} from './routes/index.js';
import { registerQuotaRoutes } from './routes/quotas.js';
import { registerTranscriptRoutes } from './routes/transcripts.js';
import { registerWebSocketRoutes } from './routes/websocket.js';
import { closeRedisClient } from './services/redis.js';

async function buildServer() {
  // Initialize tracing
  initTracing('hopwhistle-api');

  const server = Fastify({
    logger: false, // We use pino instead
    requestIdLogLabel: 'requestId',
    genReqId: () => {
      return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    },
  });

  // Register CORS (must be before other middleware)
  await server.register(import('@fastify/cors'), {
    origin: true, // Allow all origins in development
    credentials: true,
  });

  // Register logging middleware (must be first)
  await registerLoggingMiddleware(server);

  // Register session management (for CSRF protection)
  const { registerSession } = await import('./middleware/session.js');
  await registerSession(server);

  // Register authentication
  await registerAuth(server);

  // Register rate limiting globally
  await server.register(import('@fastify/rate-limit'), {
    max: 100, // Default: 100 requests per minute
    timeWindow: '1 minute',
    keyGenerator: request => {
      // Use API key ID if available, otherwise use IP
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access
      return (request.user as any)?.apiKeyId || request.ip || 'unknown';
    },
    errorResponseBuilder: (_request, context) => {
      return {
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Rate limit exceeded',
          retryAfter: Math.ceil(context.ttl / 1000),
        },
      };
    },
  });

  // Metrics endpoint
  server.get('/metrics', async (_request, reply) => {
    return reply.type('text/plain').send(await register.metrics());
  });

  // Load OpenAPI spec path
  const isProduction = process.env.NODE_ENV === 'production';
  const specPath = isProduction
    ? join(process.cwd(), 'docs', 'openapi.yaml')
    : join(process.cwd(), '../../docs', 'openapi.yaml');
  const baseDir = isProduction ? join(process.cwd(), 'docs') : join(process.cwd(), '../../docs');

  // Register Swagger - use static mode to load from external spec file
  await server.register(swagger, {
    mode: 'static',
    specification: {
      path: specPath,
      baseDir: baseDir,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      postProcessor: (spec: any) => {
        // Ensure version is correct for compatibility
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        spec.openapi = '3.0.3';
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return spec;
      },
    },
  });

  // Register Swagger UI
  await server.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: false,
    },
    staticCSP: true,
    transformStaticCSP: header => header,
  });

  // Health endpoints
  await server.register(registerHealthRoutes);

  // Register all routes
  await server.register(registerNumberRoutes);
  await server.register(registerCampaignRoutes);
  const { registerPublisherRoutes } = await import('./routes/index.js');
  await server.register(registerPublisherRoutes);
  await server.register(registerCallRoutes);

  // Register flow management routes (DSL flows)
  const { registerFlowManagementRoutes } = await import('./routes/flows.js');
  await server.register(registerFlowManagementRoutes);
  // await server.register(registerRecordingRoutes); // Legacy routes removed to avoid duplication with registerRecordingManagementRoutes
  await server.register(registerWebhookRoutes);
  const { registerUserRoutes } = await import('./routes/index.js');
  await server.register(registerUserRoutes);
  await server.register(registerReportingRoutes);
  await server.register(registerBillingRoutes);
  await server.register(registerAdminTenantRoutes);
  await server.register(registerAdminNumberRoutes);
  await server.register(registerAdminCarrierRoutes);
  await server.register(registerAdminTrunkRoutes);
  await server.register(registerAdminRateCardRoutes);
  await server.register(registerQuotaRoutes);

  // Register WebSocket and demo event routes
  await server.register(registerWebSocketRoutes);
  await server.register(registerDemoEventRoutes);

  // Register FreeSWITCH mock routes for testing
  const { registerFreeSWITCHMockRoutes } = await import('./routes/freeswitch-mock.js');
  await server.register(registerFreeSWITCHMockRoutes);

  // Register recording management routes
  const { registerRecordingManagementRoutes } = await import('./routes/recordings.js');
  await server.register(registerRecordingManagementRoutes);

  // Register transcript routes
  await server.register(registerTranscriptRoutes);

  // Register admin billing routes
  await server.register(registerAdminBillingRoutes);

  // Register auth routes
  const { registerAuthRoutes } = await import('./routes/auth.js');
  await server.register(registerAuthRoutes);

  // Register demo routes
  const { registerDemoRoutes } = await import('./routes/demo.js');
  await server.register(registerDemoRoutes);

  // Register compliance routes
  const { registerComplianceRoutes } = await import('./routes/compliance.js');
  await server.register(registerComplianceRoutes);

  // Register STIR/SHAKEN routes
  const { registerStirShakenRoutes } = await import('./routes/stir-shaken.js');
  await server.register(registerStirShakenRoutes);

  // Register Recording Analysis routes (Recording Analyzer tool)
  const { registerRecordingAnalysisRoutes } = await import('./routes/recording-analysis.js');
  await server.register(registerRecordingAnalysisRoutes);
  const { registerRecordingAnalysisUploadRoutes } = await import(
    './routes/recording-analysis-upload.js'
  );
  await server.register(registerRecordingAnalysisUploadRoutes);

  // Register Agent Phone routes (VOIP softphone for agents)
  const { registerAgentPhoneRoutes } = await import('./routes/agent-phone.js');
  await server.register(registerAgentPhoneRoutes);

  // Start Fronter Bot socket server (handles outbound call socket connections)
  const { fronterBotService } = await import('./services/fronter-bot.js');
  await fronterBotService.start();
  console.log('[API] Fronter Bot socket server started');

  // Error handler
  server.setErrorHandler((error, request, reply) => {
    server.log.error(error);
    void reply.status(error.statusCode || 500).send({
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: error.message || 'Internal server error',
        requestId: request.id,
      },
    });
  });

  // Register multipart for file uploads
  await server.register(import('@fastify/multipart'));

  // Graceful shutdown
  server.addHook('onClose', async () => {
    await shutdownTracing();
    await closeRedisClient();
    await closePrismaClient();
  });

  return server;
}

const start = async () => {
  try {
    const server = await buildServer();
    const port = Number(process.env.PORT) || 3001;
    const host = process.env.HOST || '0.0.0.0';
    await server.listen({ port, host });
    logger.info({
      msg: 'API server started',
      host,
      port,
      docs: `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/docs`,
      metrics: `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/metrics`,
      health: `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/health`,
    });
  } catch (err) {
    logger.error({ msg: 'Failed to start server', err });
    process.exit(1);
  }
};

void start();
