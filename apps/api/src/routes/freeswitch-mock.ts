import { FastifyInstance } from 'fastify';

/**
 * Mock endpoints for FreeSWITCH to call during testing
 * These endpoints simulate the API calls FreeSWITCH makes
 */
export async function registerFreeSWITCHMockRoutes(fastify: FastifyInstance) {
  // Trunk authentication endpoint
  fastify.post('/api/v1/trunks/auth', async (request, reply) => {
    const { from, to, source_ip } = request.body as {
      from?: string;
      to?: string;
      source_ip?: string;
    };

    fastify.log.info({
      event: 'trunk.auth',
      from,
      to,
      source_ip,
    }, 'Trunk authentication request');

    // Mock: Always authenticate (in production, check against database)
    reply.code(200);
    return {
      status: 'authenticated',
      trunkId: 'trunk-123',
      tenantId: '00000000-0000-0000-0000-000000000000',
    };
  });

  // DID lookup endpoint
  fastify.post('/api/v1/numbers/lookup', async (request, reply) => {
    const { number } = request.body as { number?: string };

    fastify.log.info({
      event: 'did.lookup',
      number,
    }, 'DID lookup request');

    // Mock: Return flow ID for the number
    reply.code(200);
    return {
      tenantId: '00000000-0000-0000-0000-000000000000',
      flowId: 'simple-direct-route',
      record: true,
      number,
    };
  });

  // Recording uploaded notification (callback from FreeSWITCH upload script)
  fastify.post('/api/v1/recordings/uploaded', async (request, reply) => {
    const { callId, url, format, size } = request.body as {
      callId?: string;
      url?: string;
      format?: string;
      size?: number;
    };

    fastify.log.info({
      event: 'recording.uploaded',
      callId,
      url,
      format,
      size,
    }, 'Recording uploaded notification received');

    // Download and re-upload to S3 if URL provided
    if (url && callId) {
      try {
        const { RecordingService } = await import('../services/recording-service.js');
        const recordingService = new RecordingService();
        
        const response = await fetch(url);
        if (response.ok) {
          const buffer = Buffer.from(await response.arrayBuffer());
          await recordingService.uploadRecording({
            callId,
            format: format || 'wav',
            file: buffer,
          });
        }
      } catch (error) {
        fastify.log.error({ error, callId, url }, 'Failed to process recording upload');
      }
    }

    reply.code(200);
    return {
      success: true,
      callId,
      url,
    };
  });

  // Health check for FreeSWITCH
  fastify.get('/health', async () => {
    return { status: 'ok', service: 'hopwhistle-api' };
  });
}

