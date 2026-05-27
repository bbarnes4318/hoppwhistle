import { FastifyInstance } from 'fastify';

/**
 * FreeSWITCH integration endpoints.
 *
 * These endpoints are called by FreeSWITCH lua/shell scripts during call processing.
 * They are NOT mock endpoints in production — they are the real callback surface.
 *
 * Key Endpoints:
 *   POST /api/v1/trunks/auth           — Trunk authentication for inbound SIP
 *   POST /api/v1/numbers/lookup        — DID lookup for call routing
 *   POST /api/v1/recordings/uploaded   — Recording completion callback (canonical path)
 *   POST /api/v1/calls/:callId/recording-status — Recording state transitions
 */
export async function registerFreeSWITCHMockRoutes(fastify: FastifyInstance): Promise<void> {
  await Promise.resolve();
  // Trunk authentication endpoint
  fastify.post('/api/v1/trunks/auth', async (request, reply) => {
    const { from, to, source_ip } = request.body as {
      from?: string;
      to?: string;
      source_ip?: string;
    };

    fastify.log.info(
      {
        event: 'trunk.auth',
        from,
        to,
        source_ip,
      },
      'Trunk authentication request'
    );

    // Mock: Always authenticate (in production, check against database)
    void reply.code(200);
    return {
      status: 'authenticated',
      trunkId: 'trunk-123',
      tenantId: '00000000-0000-0000-0000-000000000000',
    };
  });

  // DID lookup endpoint
  fastify.post('/api/v1/numbers/lookup', async (request, reply) => {
    const { number } = request.body as { number?: string };

    fastify.log.info(
      {
        event: 'did.lookup',
        number,
      },
      'DID lookup request'
    );

    // Mock: Return flow ID for the number
    void reply.code(200);
    return {
      tenantId: '00000000-0000-0000-0000-000000000000',
      flowId: 'simple-direct-route',
      record: true,
      number,
    };
  });

  // ============================================================================
  // CANONICAL RECORDING UPLOAD CALLBACK
  // ============================================================================
  // This is the primary endpoint FreeSWITCH calls when a recording file is ready.
  // Flow: FreeSWITCH hangup hook → upload script → POST /api/v1/recordings/uploaded
  // Result: Recording row created, Call row updated, UI can play recording.
  // ============================================================================
  fastify.post('/api/v1/recordings/uploaded', async (request, reply) => {
    const { callId, url, format, size, duration } = request.body as {
      callId?: string;
      url?: string;
      format?: string;
      size?: number;
      duration?: number;
    };

    fastify.log.info(
      {
        event: 'recording.uploaded',
        callId,
        url,
        format,
        size,
        duration,
      },
      'Recording uploaded notification received'
    );

    if (!callId) {
      void reply.code(400);
      return {
        error: { code: 'MISSING_CALL_ID', message: 'callId is required' },
      };
    }

    // Download and upload to S3 via the canonical RecordingService pipeline
    if (url) {
      try {
        const { RecordingService } = await import('../services/recording-service.js');
        const recordingService = new RecordingService();

        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to download recording from ${url}: ${response.status}`);
        }

        const buffer = Buffer.from(await response.arrayBuffer());
        const result = await recordingService.uploadRecording({
          callId,
          format: format || 'wav',
          file: buffer,
          duration,
        });

        fastify.log.info(
          {
            event: 'recording.processed',
            callId,
            recordingId: result.id,
            storageKey: result.storageKey,
          },
          'Recording processed and Call row updated'
        );

        void reply.code(200);
        return {
          success: true,
          callId,
          recordingId: result.id,
          storageKey: result.storageKey,
        };
      } catch (error) {
        fastify.log.error({ error, callId, url }, 'Failed to process recording upload');

        // Mark the call's recording as failed
        try {
          const { RecordingService } = await import('../services/recording-service.js');
          const recordingService = new RecordingService();
          await recordingService.markRecordingFailed(
            callId,
            error instanceof Error ? error.message : 'Recording upload failed'
          );
        } catch (markErr) {
          fastify.log.error({ error: markErr, callId }, 'Failed to mark recording as failed');
        }

        void reply.code(500);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to process recording',
        };
      }
    }

    // No URL provided — just a notification without the file
    void reply.code(200);
    return {
      success: true,
      callId,
      message: 'Notification received (no URL to process)',
    };
  });
}
