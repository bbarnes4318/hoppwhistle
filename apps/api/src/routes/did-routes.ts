/**
 * DID Routes — Inbound Call Routing Management + FreeSWITCH Lookup
 *
 * Endpoints:
 *   GET    /api/v1/did-routes              — List all DID→destination mappings
 *   POST   /api/v1/did-routes              — Create a new mapping
 *   PATCH  /api/v1/did-routes/:id          — Update destination / status
 *   DELETE /api/v1/did-routes/:id          — Remove mapping
 *
 *   GET    /api/v1/freeswitch/lookup       — FreeSWITCH Lua lookup (no auth)
 *   POST   /api/v1/freeswitch/cdr          — FreeSWITCH CDR webhook (no auth)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getPrismaClient } from '../lib/prisma.js';

export async function registerDidRouteRoutes(server: FastifyInstance) {
  const prisma = getPrismaClient();

  // ────────────────────────────────────────────────────────────────────────────
  // GET /api/v1/did-routes — List all DID routes
  // ────────────────────────────────────────────────────────────────────────────
  server.get('/api/v1/did-routes', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { tenantId?: string } | undefined;
    if (!user?.tenantId) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const routes = await prisma.didRoute.findMany({
      where: { tenantId: user.tenantId },
      include: {
        phoneNumber: { select: { number: true, provider: true, status: true } },
        buyer: { select: { id: true, name: true, code: true } },
        campaign: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return reply.send({ routes });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // POST /api/v1/did-routes — Create a new DID route
  // ────────────────────────────────────────────────────────────────────────────
  server.post('/api/v1/did-routes', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user as { tenantId?: string } | undefined;
    if (!user?.tenantId) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const body = request.body as {
      phoneNumberId: string;
      destination: string;
      buyerId?: string;
      campaignId?: string;
      label?: string;
      recordingEnabled?: boolean;
    };

    if (!body.phoneNumberId || !body.destination) {
      return reply.code(400).send({ error: 'phoneNumberId and destination are required' });
    }

    // Validate destination is E.164
    const destClean = body.destination.replace(/\D/g, '');
    if (destClean.length < 10 || destClean.length > 15) {
      return reply.code(400).send({ error: 'destination must be a valid phone number' });
    }
    const destination = destClean.startsWith('1') && destClean.length === 11
      ? `+${destClean}`
      : `+1${destClean}`;

    // Lookup the phone number to get the DID
    const phoneNumber = await prisma.phoneNumber.findUnique({
      where: { id: body.phoneNumberId },
    });
    if (!phoneNumber || phoneNumber.tenantId !== user.tenantId) {
      return reply.code(404).send({ error: 'Phone number not found' });
    }

    // Check for duplicate route
    const existing = await prisma.didRoute.findUnique({
      where: { tenantId_did: { tenantId: user.tenantId, did: phoneNumber.number } },
    });
    if (existing) {
      return reply.code(409).send({ error: 'A route already exists for this DID', existingId: existing.id });
    }

    const route = await prisma.didRoute.create({
      data: {
        tenantId: user.tenantId,
        phoneNumberId: body.phoneNumberId,
        did: phoneNumber.number,
        destination,
        buyerId: body.buyerId || null,
        campaignId: body.campaignId || null,
        label: body.label || null,
        recordingEnabled: body.recordingEnabled !== false,
      },
      include: {
        phoneNumber: { select: { number: true, provider: true } },
        buyer: { select: { id: true, name: true } },
      },
    });

    console.log(`[DID-ROUTE] Created: ${phoneNumber.number} → ${destination}${body.buyerId ? ` (buyer: ${body.buyerId})` : ''}`);

    return reply.code(201).send({ route });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // PATCH /api/v1/did-routes/:id — Update a DID route
  // ────────────────────────────────────────────────────────────────────────────
  server.patch<{ Params: { id: string } }>(
    '/api/v1/did-routes/:id',
    async (request, reply) => {
      const user = request.user as { tenantId?: string } | undefined;
      if (!user?.tenantId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const { id } = request.params;
      const body = request.body as {
        destination?: string;
        buyerId?: string | null;
        campaignId?: string | null;
        label?: string | null;
        recordingEnabled?: boolean;
        status?: 'ACTIVE' | 'PAUSED' | 'INACTIVE';
      };

      const existing = await prisma.didRoute.findUnique({ where: { id } });
      if (!existing || existing.tenantId !== user.tenantId) {
        return reply.code(404).send({ error: 'Route not found' });
      }

      // Normalize destination if provided
      let destination = existing.destination;
      if (body.destination) {
        const destClean = body.destination.replace(/\D/g, '');
        destination = destClean.startsWith('1') && destClean.length === 11
          ? `+${destClean}`
          : `+1${destClean}`;
      }

      const route = await prisma.didRoute.update({
        where: { id },
        data: {
          destination,
          buyerId: body.buyerId !== undefined ? body.buyerId : undefined,
          campaignId: body.campaignId !== undefined ? body.campaignId : undefined,
          label: body.label !== undefined ? body.label : undefined,
          recordingEnabled: body.recordingEnabled !== undefined ? body.recordingEnabled : undefined,
          status: body.status || undefined,
        },
        include: {
          phoneNumber: { select: { number: true, provider: true } },
          buyer: { select: { id: true, name: true } },
        },
      });

      console.log(`[DID-ROUTE] Updated: ${route.did} → ${destination}`);

      return reply.send({ route });
    }
  );

  // ────────────────────────────────────────────────────────────────────────────
  // DELETE /api/v1/did-routes/:id — Remove a DID route
  // ────────────────────────────────────────────────────────────────────────────
  server.delete<{ Params: { id: string } }>(
    '/api/v1/did-routes/:id',
    async (request, reply) => {
      const user = request.user as { tenantId?: string } | undefined;
      if (!user?.tenantId) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }

      const { id } = request.params;
      const existing = await prisma.didRoute.findUnique({ where: { id } });
      if (!existing || existing.tenantId !== user.tenantId) {
        return reply.code(404).send({ error: 'Route not found' });
      }

      await prisma.didRoute.delete({ where: { id } });
      console.log(`[DID-ROUTE] Deleted: ${existing.did}`);

      return reply.send({ deleted: true });
    }
  );

  // ════════════════════════════════════════════════════════════════════════════
  // FreeSWITCH Integration Endpoints (NO AUTH — internal network only)
  // ════════════════════════════════════════════════════════════════════════════

  // ────────────────────────────────────────────────────────────────────────────
  // GET /api/v1/freeswitch/lookup?did=+1XXXXXXXXXX — Dynamic route lookup
  //
  // Called by the FreeSWITCH Lua script on every inbound call.
  // Returns destination number + recording config. ~5ms p99 with index.
  // ────────────────────────────────────────────────────────────────────────────
  server.get('/api/v1/freeswitch/lookup', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as { did?: string };
    const did = query.did?.replace(/[^\d+]/g, '') || '';

    if (!did) {
      return reply.code(400).send({ error: 'did parameter required' });
    }

    // Normalize: ensure +1 prefix
    const normalizedDid = did.startsWith('+') ? did : `+${did}`;
    const variants = [
      normalizedDid,
      normalizedDid.startsWith('+1') ? normalizedDid.slice(2) : normalizedDid,
      normalizedDid.startsWith('+') ? normalizedDid.slice(1) : normalizedDid,
    ];

    const route = await prisma.didRoute.findFirst({
      where: {
        did: { in: variants },
        status: 'ACTIVE',
      },
      select: {
        id: true,
        did: true,
        destination: true,
        buyerId: true,
        campaignId: true,
        recordingEnabled: true,
        label: true,
        tenantId: true,
      },
    });

    if (!route) {
      console.log(`[FS-LOOKUP] No route for DID: ${normalizedDid}`);
      return reply.code(404).send({ error: 'no_route', did: normalizedDid });
    }

    console.log(`[FS-LOOKUP] ${route.did} → ${route.destination} (buyer: ${route.buyerId || 'none'})`);

    return reply.send({
      destination: route.destination,
      recordingEnabled: route.recordingEnabled,
      routeId: route.id,
      buyerId: route.buyerId || null,
      campaignId: route.campaignId || null,
      tenantId: route.tenantId,
      label: route.label || null,
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // POST /api/v1/freeswitch/cdr — Call Detail Record webhook
  //
  // Called by FreeSWITCH Lua script after each call ends.
  // Creates a Call record + optional Recording record.
  // ────────────────────────────────────────────────────────────────────────────
  server.post('/api/v1/freeswitch/cdr', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      callId: string;        // FreeSWITCH UUID
      routeId: string;       // DidRoute ID
      tenantId: string;
      callerNumber: string;  // ANI (who called)
      did: string;           // DNIS (tracking number)
      destination: string;   // Where we forwarded to
      buyerId?: string;
      campaignId?: string;
      duration: number;       // Total duration in seconds
      connectedDuration?: number;
      billDuration?: number;
      hangupCause: string;
      startedAt: string;      // ISO timestamp
      answeredAt?: string;
      endedAt: string;
      recordingPath?: string; // Local file path on FS
      recordingDuration?: number;
    };

    if (!body.callId || !body.routeId || !body.tenantId) {
      return reply.code(400).send({ error: 'callId, routeId, and tenantId are required' });
    }

    try {
      // Map hangup cause to CallStatus
      const statusMap: Record<string, string> = {
        NORMAL_CLEARING: 'COMPLETED',
        USER_BUSY: 'BUSY',
        NO_ANSWER: 'NO_ANSWER',
        CALL_REJECTED: 'FAILED',
        ORIGINATOR_CANCEL: 'CANCELLED',
      };
      const callStatus = statusMap[body.hangupCause] || 'COMPLETED';

      // Find the DID's phone number ID
      const route = await prisma.didRoute.findUnique({
        where: { id: body.routeId },
        select: {
          phoneNumberId: true,
          buyerId: true,
          campaignId: true,
          tenantId: true,
          label: true,
        },
      });

      if (!route) {
        return reply.code(404).send({ error: 'Route not found' });
      }

      // Create Call record
      const call = await prisma.call.create({
        data: {
          tenantId: body.tenantId,
          callSid: `fs-${body.callId}`,
          direction: 'INBOUND',
          status: callStatus as 'COMPLETED' | 'BUSY' | 'NO_ANSWER' | 'FAILED' | 'CANCELLED',
          fromNumberId: route.phoneNumberId,
          toNumber: body.destination,
          callerId: body.callerNumber,
          did: body.did,
          targetNumber: body.destination,
          duration: body.duration || 0,
          connectedDuration: body.connectedDuration || 0,
          campaignId: route.campaignId || null,
          buyerId: route.buyerId || null,
          publisherId: null,
          startedAt: body.startedAt ? new Date(body.startedAt) : new Date(),
          answeredAt: body.answeredAt ? new Date(body.answeredAt) : null,
          endedAt: body.endedAt ? new Date(body.endedAt) : new Date(),
          buyerName: route.label || null,
          recordingStatus: body.recordingPath ? 'PENDING' : null,
        },
      });

      // If there's a recording, create Recording record
      if (body.recordingPath) {
        await prisma.recording.create({
          data: {
            callId: call.id,
            url: body.recordingPath, // Will be updated when uploaded to S3
            duration: body.recordingDuration || body.duration || 0,
            format: 'wav',
            status: 'PROCESSING',
          },
        });
      }

      // Update DID route stats
      await prisma.didRoute.update({
        where: { id: body.routeId },
        data: {
          totalCalls: { increment: 1 },
          totalDuration: { increment: body.duration || 0 },
          lastCallAt: new Date(),
        },
      });

      console.log(`[FS-CDR] Call ${body.callId}: ${body.callerNumber} → ${body.did} → ${body.destination} | ${body.duration}s | ${body.hangupCause}`);

      return reply.code(201).send({
        callId: call.id,
        callSid: call.callSid,
        status: callStatus,
      });
    } catch (err) {
      console.error('[FS-CDR] Error persisting CDR:', err);
      return reply.code(500).send({ error: 'Failed to persist CDR' });
    }
  });

  // ────────────────────────────────────────────────────────────────────────────
  // POST /api/v1/freeswitch/recording-uploaded — Recording upload notification
  //
  // Called by upload-recording.sh after S3 upload completes.
  // ────────────────────────────────────────────────────────────────────────────
  server.post('/api/v1/freeswitch/recording-uploaded', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as {
      callId: string;
      url: string;
      format?: string;
      size?: number;
    };

    if (!body.callId || !body.url) {
      return reply.code(400).send({ error: 'callId and url are required' });
    }

    try {
      // Update recording with S3 URL
      const recording = await prisma.recording.findFirst({
        where: { callId: body.callId },
      });

      if (recording) {
        await prisma.recording.update({
          where: { id: recording.id },
          data: {
            url: body.url,
            status: 'COMPLETED',
            size: body.size ? BigInt(body.size) : null,
          },
        });
      }

      // Update call with recording URL and status
      await prisma.call.update({
        where: { id: body.callId },
        data: {
          recordingUrl: body.url,
          recordingStatus: 'READY',
          recordingCompletedAt: new Date(),
        },
      });

      console.log(`[FS-RECORDING] Updated call ${body.callId} with recording: ${body.url}`);
      return reply.send({ updated: true });
    } catch (err) {
      console.error('[FS-RECORDING] Error:', err);
      return reply.code(500).send({ error: 'Failed to update recording' });
    }
  });

  console.log('[API] DID Route management routes registered:');
  console.log('  GET/POST        /api/v1/did-routes');
  console.log('  PATCH/DELETE    /api/v1/did-routes/:id');
  console.log('  GET             /api/v1/freeswitch/lookup');
  console.log('  POST            /api/v1/freeswitch/cdr');
  console.log('  POST            /api/v1/freeswitch/recording-uploaded');
}
