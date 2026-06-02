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
import { tcpaValidationService } from '../services/tcpa-validation-service.js';

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
        publisher: { select: { id: true, name: true, code: true } },
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
      publisherId?: string;
      label?: string;
      recordingEnabled?: boolean;
    };

    if (!body.phoneNumberId || !body.destination) {
      return reply.code(400).send({ error: 'phoneNumberId and destination are required' });
    }

    // Validate tenant ownership of buyer/campaign/publisher if provided
    if (body.buyerId) {
      const buyer = await prisma.buyer.findUnique({ where: { id: body.buyerId } });
      if (!buyer || buyer.tenantId !== user.tenantId) {
        return reply.code(400).send({ error: 'Buyer not found' });
      }
    }
    if (body.campaignId) {
      const campaign = await prisma.campaign.findUnique({ where: { id: body.campaignId } });
      if (!campaign || campaign.tenantId !== user.tenantId) {
        return reply.code(400).send({ error: 'Campaign not found' });
      }
    }
    if (body.publisherId) {
      const publisher = await prisma.publisher.findUnique({ where: { id: body.publisherId } });
      if (!publisher || publisher.tenantId !== user.tenantId) {
        return reply.code(400).send({ error: 'Publisher not found' });
      }
    }

    // Validate destination is E.164 unless it contains commas or pipes or is a short extension
    let destination = body.destination.trim();
    if (!destination.includes(',') && !destination.includes('|') && destination.replace(/\D/g, '').length >= 10) {
      const destClean = destination.replace(/\D/g, '');
      destination = destClean.startsWith('1') && destClean.length === 11
        ? `+${destClean}`
        : `+1${destClean}`;
    } else if (!destination) {
      return reply.code(400).send({ error: 'destination is required' });
    }

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
        publisherId: body.publisherId || null,
        label: body.label || null,
        recordingEnabled: body.recordingEnabled !== false,
      },
      include: {
        phoneNumber: { select: { number: true, provider: true } },
        buyer: { select: { id: true, name: true } },
        publisher: { select: { id: true, name: true } },
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
        publisherId?: string | null;
        label?: string | null;
        recordingEnabled?: boolean;
        status?: 'ACTIVE' | 'PAUSED' | 'INACTIVE';
      };

      const existing = await prisma.didRoute.findUnique({ where: { id } });
      if (!existing || existing.tenantId !== user.tenantId) {
        return reply.code(404).send({ error: 'Route not found' });
      }

      // Validate tenant ownership of buyer/campaign/publisher if provided
      if (body.buyerId) {
        const buyer = await prisma.buyer.findUnique({ where: { id: body.buyerId } });
        if (!buyer || buyer.tenantId !== user.tenantId) {
          return reply.code(400).send({ error: 'Buyer not found' });
        }
      }
      if (body.campaignId) {
        const campaign = await prisma.campaign.findUnique({ where: { id: body.campaignId } });
        if (!campaign || campaign.tenantId !== user.tenantId) {
          return reply.code(400).send({ error: 'Campaign not found' });
        }
      }
      if (body.publisherId) {
        const publisher = await prisma.publisher.findUnique({ where: { id: body.publisherId } });
        if (!publisher || publisher.tenantId !== user.tenantId) {
          return reply.code(400).send({ error: 'Publisher not found' });
        }
      }

      // Normalize destination if provided
      let destination = existing.destination;
      if (body.destination) {
        destination = body.destination.trim();
        if (!destination.includes(',') && !destination.includes('|') && destination.replace(/\D/g, '').length >= 10) {
          const destClean = destination.replace(/\D/g, '');
          destination = destClean.startsWith('1') && destClean.length === 11
            ? `+${destClean}`
            : `+1${destClean}`;
        }
      }

      const route = await prisma.didRoute.update({
        where: { id },
        data: {
          destination,
          buyerId: body.buyerId !== undefined ? body.buyerId : undefined,
          campaignId: body.campaignId !== undefined ? body.campaignId : undefined,
          publisherId: body.publisherId !== undefined ? body.publisherId : undefined,
          label: body.label !== undefined ? body.label : undefined,
          recordingEnabled: body.recordingEnabled !== undefined ? body.recordingEnabled : undefined,
          status: body.status || undefined,
        },
        include: {
          phoneNumber: { select: { number: true, provider: true } },
          buyer: { select: { id: true, name: true } },
          publisher: { select: { id: true, name: true } },
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
    const query = request.query as { did?: string; caller?: string };
    const did = query.did?.replace(/[^\d+]/g, '') || '';
    const caller = query.caller?.replace(/[^\d+]/g, '') || '';

    if (!did) {
      return reply.code(400).send({ error: 'did parameter required' });
    }

    // ── TCPA Litigator Check (before any routing) ──────────────────────
    if (caller) {
      try {
        const tcpaResult = await tcpaValidationService.validateNumber(caller);
        if (tcpaResult.isLitigator) {
          console.log(`[TCPA-BLOCK][FS-LOOKUP] Blocking litigator ${caller} on DID ${did} (cached=${tcpaResult.cached})`);

          // Create blocked call record for audit trail
          try {
            await prisma.call.create({
              data: {
                tenantId: 'default',
                callSid: `fs_blocked_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                toNumber: did,
                callerId: caller,
                direction: 'INBOUND',
                status: 'FAILED',
                blocked: true,
                blockReason: 'TCPA_LITIGATOR',
                startedAt: new Date(),
                endedAt: new Date(),
                metadata: { tcpaResult, source: 'freeswitch' } as Record<string, unknown>,
              },
            });
          } catch (dbErr) {
            console.error('[TCPA-BLOCK] Failed to create blocked call record:', dbErr);
          }

          return reply.send({
            reject: true,
            reason: 'TCPA_LITIGATOR',
            message: 'Caller is a known TCPA litigator',
          });
        }
      } catch (err) {
        console.error('[TCPA] FreeSWITCH lookup validation error (fail-open):', err);
      }
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
        publisherId: true,
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
      publisherId: route.publisherId || null,
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
          publisherId: true,
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
          publisherId: route.publisherId || null,
          startedAt: body.startedAt ? new Date(body.startedAt) : new Date(),
          answeredAt: body.answeredAt ? new Date(body.answeredAt) : null,
          endedAt: body.endedAt ? new Date(body.endedAt) : new Date(),
          buyerName: route.label || null,
          recordingStatus: body.recordingPath ? 'PENDING' : null,
        },
      });

      // Calculate call billing
      try {
        const { billingService } = await import('../services/billing-service.js');
        await billingService.calculateCallBilling(call.id);
      } catch (billingErr) {
        console.error('[FS-CDR] Failed to calculate billing for call:', call.id, billingErr);
      }

      // If there's a recording, trigger background upload.
      // Do NOT create a placeholder Recording row here — RecordingService.uploadRecording()
      // handles row creation with the correct storageKey and primaryRecordingId linkage.
      if (body.recordingPath) {
        const recordingPath = body.recordingPath;
        const callId = call.id;
        const duration = body.recordingDuration || body.duration || 0;

        // Mark call as PROCESSING while we upload
        await prisma.call.update({
          where: { id: callId },
          data: { recordingStatus: 'PROCESSING' },
        });

        setTimeout(async () => {
          try {
            const fs = await import('fs');
            if (fs.existsSync(recordingPath)) {
              console.log(`[FS-CDR] Background upload started for file: ${recordingPath}`);
              const fileBuffer = fs.readFileSync(recordingPath);
              const { RecordingService } = await import('../services/recording-service.js');
              const recordingService = new RecordingService();
              
              const uploadResult = await recordingService.uploadRecording({
                callId: callId,
                format: 'wav',
                file: fileBuffer,
                duration: duration,
              });
              
              console.log(`[FS-CDR] Background upload complete for call ${callId}. Recording ID: ${uploadResult.id}`);
            } else {
              console.error(`[FS-CDR] Recording file not found at local path: ${recordingPath}`);
              const { RecordingService } = await import('../services/recording-service.js');
              const recordingService = new RecordingService();
              await recordingService.markRecordingFailed(
                callId,
                `Recording file not found at local path: ${recordingPath}`
              );
            }
          } catch (uploadErr) {
            console.error(`[FS-CDR] Failed to upload recording in background:`, uploadErr);
            try {
              const { RecordingService } = await import('../services/recording-service.js');
              const recordingService = new RecordingService();
              await recordingService.markRecordingFailed(
                callId,
                uploadErr instanceof Error ? uploadErr.message : 'S3 upload failed'
              );
            } catch (err) {
              console.error(`[FS-CDR] Failed to mark recording as failed:`, err);
            }
          }
        }, 1000); // 1-second delay to ensure FreeSWITCH has finished writing/flushing the file
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
      duration?: number;
    };

    if (!body.callId || !body.url) {
      return reply.code(400).send({ error: 'callId and url are required' });
    }

    try {
      // Download the recording from the provided URL and upload via the canonical
      // RecordingService pipeline so storageKey, primaryRecordingId, and Call row
      // are all set correctly.
      const { RecordingService } = await import('../services/recording-service.js');
      const recordingService = new RecordingService();

      const response = await fetch(body.url);
      if (!response.ok) {
        throw new Error(`Failed to download recording from ${body.url}: ${response.status}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0) {
        throw new Error('Downloaded recording file is empty');
      }

      const result = await recordingService.uploadRecording({
        callId: body.callId,
        format: body.format || 'wav',
        file: buffer,
        duration: body.duration,
      });

      console.log(`[FS-RECORDING] Processed recording for call ${body.callId}. Recording ID: ${result.id}, storageKey: ${result.storageKey}`);
      return reply.send({ updated: true, recordingId: result.id, storageKey: result.storageKey });
    } catch (err) {
      console.error('[FS-RECORDING] Error:', err);

      // Mark as failed so UI shows correct state
      try {
        const { RecordingService } = await import('../services/recording-service.js');
        const recordingService = new RecordingService();
        await recordingService.markRecordingFailed(
          body.callId,
          err instanceof Error ? err.message : 'Recording upload processing failed'
        );
      } catch (markErr) {
        console.error('[FS-RECORDING] Failed to mark recording as failed:', markErr);
      }

      return reply.code(500).send({ error: 'Failed to process recording' });
    }
  });

  console.log('[API] DID Route management routes registered:');
  console.log('  GET/POST        /api/v1/did-routes');
  console.log('  PATCH/DELETE    /api/v1/did-routes/:id');
  console.log('  GET             /api/v1/freeswitch/lookup');
  console.log('  POST            /api/v1/freeswitch/cdr');
  console.log('  POST            /api/v1/freeswitch/recording-uploaded');
}
