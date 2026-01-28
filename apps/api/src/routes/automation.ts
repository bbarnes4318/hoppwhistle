/**
 * Automation Routes
 *
 * Provides endpoints for triggering carrier application automation
 * and streaming status updates via SSE.
 *
 * Ported from: fe-rickie/server/routes/automation.js
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { runAmericanAmicableAutomation, CarrierAppData } from '../services/american-amicable';
import {
  automationEvents,
  generateJobId,
  getJobStatus,
  type StatusUpdate,
} from '../services/automation-status';

interface RunCarrierAppBody {
  state: string;
  firstName: string;
  lastName: string;
  dob: string;
  age?: number;
  gender: string;
  tobacco: boolean;
  selectedCoverage: number;
  selectedPlanType: string;
  [key: string]: unknown;
}

export default async function automationRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/automation/run-carrier-app
   * Triggers the American Amicable application automation
   */
  fastify.post<{ Body: RunCarrierAppBody }>(
    '/run-carrier-app',
    async (request: FastifyRequest<{ Body: RunCarrierAppBody }>, reply: FastifyReply) => {
      const ts = new Date().toISOString();

      console.log('═══════════════════════════════════════════════════════════════');
      console.log(`[AUTOMATION] ${ts} ▶▶▶ REQUEST RECEIVED ◀◀◀`);
      console.log(`[AUTOMATION] ${ts} Request Body:`, JSON.stringify(request.body));
      console.log('═══════════════════════════════════════════════════════════════');

      const { state } = request.body;

      if (!state) {
        console.warn(`[AUTOMATION] ${ts} ⚠️ MISSING STATE IN REQUEST`);
        return reply.status(400).send({ success: false, error: 'State is required' });
      }

      // Generate job ID for tracking
      const jobId = generateJobId();
      console.log(
        `[AUTOMATION] ${ts} ✓ State: "${state}" - JobId: ${jobId} - Starting automation...`
      );

      try {
        // Run the automation
        const result = await runAmericanAmicableAutomation(request.body as CarrierAppData, jobId);

        console.log(
          `[AUTOMATION] ${new Date().toISOString()} Automation completed:`,
          JSON.stringify(result)
        );

        if (result.success) {
          console.log(`[AUTOMATION] ${new Date().toISOString()} ✅ SUCCESS`);
          return reply.send({ ...result, jobId });
        } else {
          console.log(`[AUTOMATION] ${new Date().toISOString()} ❌ FAILED - ${result.error}`);
          return reply.status(500).send({ ...result, jobId });
        }
      } catch (error) {
        const err = error as Error;
        console.error(`[AUTOMATION] ${new Date().toISOString()} 💥 EXCEPTION:`, err.message);
        console.error(`[AUTOMATION] Stack:`, err.stack);
        return reply.status(500).send({ success: false, error: err.message, jobId });
      }
    }
  );

  /**
   * GET /api/automation/status/:jobId
   * Get current status of an automation job
   */
  fastify.get<{ Params: { jobId: string } }>('/status/:jobId', async (request, reply) => {
    const { jobId } = request.params;
    const status = getJobStatus(jobId);

    if (!status) {
      return reply.status(404).send({ error: 'Job not found' });
    }

    return reply.send(status);
  });

  /**
   * GET /api/automation/stream/:jobId
   * SSE endpoint for real-time status updates
   */
  fastify.get<{ Params: { jobId: string } }>('/stream/:jobId', async (request, reply) => {
    const { jobId } = request.params;

    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Send initial status
    const initialStatus = getJobStatus(jobId);
    if (initialStatus) {
      reply.raw.write(`data: ${JSON.stringify(initialStatus.lastUpdate)}\n\n`);
    }

    // Listen for status updates
    const onStatus = (update: StatusUpdate) => {
      if (update.jobId === jobId) {
        reply.raw.write(`data: ${JSON.stringify(update)}\n\n`);

        // Close connection if job is complete or failed
        if (update.status === 'completed' || update.status === 'failed') {
          reply.raw.end();
        }
      }
    };

    automationEvents.on('status', onStatus);

    // Cleanup on disconnect
    request.raw.on('close', () => {
      automationEvents.off('status', onStatus);
    });
  });

  /**
   * GET /api/automation/test
   * Health check endpoint
   */
  fastify.get('/test', async (_request, reply) => {
    console.log(`[AUTOMATION] ${new Date().toISOString()} TEST ENDPOINT HIT`);
    return reply.send({
      status: 'Automation route is working',
      timestamp: new Date().toISOString(),
    });
  });
}
