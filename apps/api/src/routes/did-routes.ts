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

import { Prisma } from '@prisma/client';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import { getPrismaClient } from '../lib/prisma.js';
import { numberPoolService } from '../services/number-pool-service.js';
import { getRedisClient } from '../services/redis.js';
import { tcpaValidationService } from '../services/tcpa-validation-service.js';

interface RtbMetadata {
  pingId?: string | null;
  transferNumber?: string | null;
  bidAmount?: number | null;
  buyerBidId?: string | null;
  publisherRequestId?: string | null;
  postAcceptedAt?: string | null;
  routeType?: string | null;
}

// eslint-disable-next-line @typescript-eslint/require-await
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

    if (!body.phoneNumberId || (!body.destination && !body.campaignId)) {
      return reply
        .code(400)
        .send({ error: 'phoneNumberId and destination (or campaignId) are required' });
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
    let destination = (body.destination || '').trim();
    if (body.campaignId) {
      destination = 'Campaign';
    } else {
      if (!destination) {
        return reply.code(400).send({ error: 'destination is required' });
      }
      if (
        !destination.includes(',') &&
        !destination.includes('|') &&
        destination.replace(/\D/g, '').length >= 10
      ) {
        const destClean = destination.replace(/\D/g, '');
        destination =
          destClean.startsWith('1') && destClean.length === 11 ? `+${destClean}` : `+1${destClean}`;
      }
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
      return reply
        .code(409)
        .send({ error: 'A route already exists for this DID', existingId: existing.id });
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

    console.log(
      `[DID-ROUTE] Created: ${phoneNumber.number} → ${destination}${body.buyerId ? ` (buyer: ${body.buyerId})` : ''}`
    );

    return reply.code(201).send({ route });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // PATCH /api/v1/did-routes/:id — Update a DID route
  // ────────────────────────────────────────────────────────────────────────────
  server.patch<{ Params: { id: string } }>('/api/v1/did-routes/:id', async (request, reply) => {
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
    const newCampaignId = body.campaignId !== undefined ? body.campaignId : existing.campaignId;

    if (newCampaignId) {
      destination = 'Campaign';
    } else {
      if (body.destination) {
        destination = body.destination.trim();
        if (
          !destination.includes(',') &&
          !destination.includes('|') &&
          destination.replace(/\D/g, '').length >= 10
        ) {
          const destClean = destination.replace(/\D/g, '');
          destination =
            destClean.startsWith('1') && destClean.length === 11
              ? `+${destClean}`
              : `+1${destClean}`;
        }
      }
      if (destination === 'Campaign') {
        return reply.code(400).send({
          error: 'A valid destination phone number is required when campaign routing is removed',
        });
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
  });

  // ────────────────────────────────────────────────────────────────────────────
  // DELETE /api/v1/did-routes/:id — Remove a DID route
  // ────────────────────────────────────────────────────────────────────────────
  server.delete<{ Params: { id: string } }>('/api/v1/did-routes/:id', async (request, reply) => {
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
  });

  // ════════════════════════════════════════════════════════════════════════════
  // FreeSWITCH Integration Endpoints (NO AUTH — internal network only)
  // ════════════════════════════════════════════════════════════════════════════

  // ────────────────────────────────────────────────────────────────────────────
  // POST /api/v1/freeswitch/directory — Dynamic FreeSWITCH User Directory lookup
  // ────────────────────────────────────────────────────────────────────────────
  server.post(
    '/api/v1/freeswitch/directory',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body as Record<string, string>) || {};
      const query = (request.query as Record<string, string>) || {};

      const user = body.user || query.user;
      const domain = body.domain || query.domain || 'freeswitch';

      const apiKey =
        (request.headers['x-directory-internal-api-key'] as string | undefined) ||
        (request.headers['x-internal-api-key'] as string | undefined);

      const { renderDirectoryXmlForExtension } = await import('../services/caller-id-service.js');
      const xml = await renderDirectoryXmlForExtension({
        user,
        domain,
        apiKey,
      });

      return reply.type('application/xml').send(xml);
    }
  );

  server.get(
    '/api/v1/freeswitch/directory',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = (request.query as Record<string, string>) || {};
      const apiKey =
        (request.headers['x-directory-internal-api-key'] as string | undefined) ||
        (request.headers['x-internal-api-key'] as string | undefined);

      const { renderDirectoryXmlForExtension } = await import('../services/caller-id-service.js');
      const xml = await renderDirectoryXmlForExtension({
        user: query.user,
        domain: query.domain || 'freeswitch',
        apiKey,
      });

      return reply.type('application/xml').send(xml);
    }
  );

  // ────────────────────────────────────────────────────────────────────────────
  // GET /api/v1/freeswitch/validate-caller-id — Caller ID validation for outbound calls
  // ────────────────────────────────────────────────────────────────────────────
  server.get(
    '/api/v1/freeswitch/validate-caller-id',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as {
        callId?: string;
        signedContext?: string;
        destination?: string;
        sipUser?: string;
        channelUuid?: string;
      };

      const internalApiKey =
        (request.headers['x-internal-api-key'] as string | undefined) ||
        (request.headers['x-api-key'] as string | undefined);

      const { resolveCallerIdForInternalCall } = await import('../services/caller-id-service.js');
      const result = await resolveCallerIdForInternalCall({
        callId: query.callId,
        destination: query.destination,
        sipUser: query.sipUser,
        channelUuid: query.channelUuid,
        internalApiKey,
        signedContext: query.signedContext,
      });

      if (!result.valid) {
        const statusCode = result.reason === 'UNAUTHORIZED_INTERNAL_REQUEST' ? 401 : 403;
        return reply.code(statusCode).send(result);
      }

      return reply.send(result);
    }
  );

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
          console.log(
            `[TCPA-BLOCK][FS-LOOKUP] Blocking litigator ${caller} on DID ${did} (cached=${tcpaResult.cached})`
          );

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

    // Try to get Redis RTB leased route first
    let routeInfo = null;
    let foundDid = normalizedDid;
    for (const variant of variants) {
      routeInfo = await numberPoolService.getRouteInfo(variant);
      if (routeInfo) {
        foundDid = variant;
        break;
      }
    }

    if (routeInfo) {
      // Resolve recordingEnabled unless disabled by campaign/tenant
      let recordingEnabled = true;
      if (routeInfo.campaign_id) {
        try {
          const campaign = await prisma.campaign.findUnique({
            where: { id: routeInfo.campaign_id },
            select: { recordingEnabled: true },
          });
          if (campaign && campaign.recordingEnabled === false) {
            recordingEnabled = false;
          }
        } catch (err) {
          console.error('[FS-LOOKUP] Error fetching campaign recording status:', err);
        }
      }

      console.log(
        `[FS-LOOKUP] Redis RTB route: did=${foundDid} → buyer=${routeInfo.buyer_id} destination=${routeInfo.buyer_destination}`
      );

      return reply.send({
        destination: routeInfo.buyer_destination,
        recordingEnabled: recordingEnabled,
        routeId: `rtb-${routeInfo.ping_id}`, // Format routeId so CDR can recognise it's an RTB route
        buyerId: routeInfo.buyer_id,
        targetId: routeInfo.buyer_endpoint_id,
        buyerEndpointId: routeInfo.buyer_endpoint_id,
        pingId: routeInfo.ping_id,
        campaignId: routeInfo.campaign_id || null,
        publisherId: routeInfo.publisher_id || null,
        tenantId: routeInfo.tenant_id || 'default',
        vertical: routeInfo.vertical || null,
        transferNumber: routeInfo.transfer_number || foundDid,
        routeType: 'RTB',
      });
    }

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

    let destination = route.destination;
    let buyerId = route.buyerId || null;
    let targetId: string | null = null;

    if (route.campaignId) {
      try {
        const { routingService } = await import('../services/routing.js');
        const bestBuyer = await routingService.selectBestBuyer(route.tenantId, route.campaignId, {
          callerId: caller,
        });

        if (bestBuyer) {
          destination = bestBuyer.endpoint;
          buyerId = bestBuyer.buyerId;
          targetId = bestBuyer.targetId || null;
          console.log(
            `[FS-LOOKUP] Dynamic route: campaign=${route.campaignId} caller=${caller} → buyer=${buyerId} endpoint=${destination} targetId=${targetId}`
          );
        } else {
          const allCampaignBuyers = await prisma.campaignBuyer.findMany({
            where: { campaignId: route.campaignId, status: 'ACTIVE', tenantId: route.tenantId },
            select: { destinationNumber: true, buyerId: true },
          });

          if (allCampaignBuyers.length > 0) {
            const destList = allCampaignBuyers.map((b) => b.destinationNumber.trim()).filter(Boolean);
            destination = destList.join(',');
            buyerId = allCampaignBuyers[0]?.buyerId || null;
            console.log(
              `[FS-LOOKUP] Dynamic route campaign=${route.campaignId} caller=${caller} fallback → ringing all campaign extensions: ${destination}`
            );
          } else {
            console.log(
              `[FS-LOOKUP] Dynamic route campaign=${route.campaignId} caller=${caller} returned no active buyers. Falling back to static route: ${destination}`
            );
          }
        }
      } catch (routingErr) {
        console.error(
          `[FS-LOOKUP] Dynamic routing error for campaign ${route.campaignId} caller ${caller} (fail-open):`,
          routingErr
        );
      }
    } else {
      console.log(
        `[FS-LOOKUP] Static route: ${route.did} → ${destination} (buyer: ${buyerId || 'none'})`
      );
    }

    return reply.send({
      destination: destination,
      recordingEnabled: route.recordingEnabled,
      routeId: route.id,
      buyerId: buyerId,
      targetId: targetId,
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
      callId: string; // FreeSWITCH UUID
      routeId: string; // DidRoute ID
      tenantId: string;
      callerNumber: string; // ANI (who called)
      did: string; // DNIS (tracking number)
      destination: string; // Where we forwarded to
      buyerId?: string;
      campaignId?: string;
      targetId?: string;
      buyerEndpointId?: string;
      pingId?: string;
      routeType?: string;
      rtbRoute?: boolean;
      transferNumber?: string;
      carrierCost?: number;
      costSource?: string;
      duration: number; // Total duration in seconds
      connectedDuration?: number;
      billDuration?: number;
      hangupCause: string;
      startedAt: string; // ISO timestamp
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

      // Sanitize FK fields — Lua sends "null" / "" for missing IDs which would
      // violate foreign-key constraints if passed through.
      const sanitizeFk = (v: string | null | undefined): string | null =>
        v && v !== '' && v !== 'null' && v !== 'undefined' ? v : null;

      let phoneNumberId: string | null = null;
      let buyerId: string | null = null;
      let targetId: string | null = null;
      let campaignId: string | null = null;
      let publisherId: string | null = null;
      let tenantId: string = body.tenantId;
      let buyerName: string | null = null;
      let rtbMetadata: RtbMetadata | null = null;
      let callSource = 'PAY_PER_CALL';

      const isRtbRouteId =
        body.routeId.startsWith('rtb-') || body.routeType === 'RTB' || body.rtbRoute;

      if (isRtbRouteId) {
        // Resolve RTB route
        const pingId =
          body.pingId || (body.routeId.startsWith('rtb-') ? body.routeId.substring(4) : null);
        let rtbRouteInfo = null;
        if (body.did) {
          rtbRouteInfo = await numberPoolService.getRouteInfo(body.did);
        }

        if (!rtbRouteInfo && pingId) {
          console.log(
            `[FS-CDR] Redis route for DID ${body.did} expired, falling back to DB for pingId ${pingId}`
          );
          const pingReq = await prisma.pingRequest.findUnique({
            where: { id: pingId },
            include: {
              publisher: true,
              bids: {
                where: { status: 'WON' },
                include: {
                  buyerEndpoint: true,
                },
              },
            },
          });
          if (pingReq && pingReq.bids.length > 0) {
            const wBid = pingReq.bids[0];
            const campaign = await prisma.campaign.findFirst({
              where: {
                publisherId: pingReq.publisherId,
                status: 'ACTIVE',
                buyers: {
                  some: {
                    buyerId: wBid.buyerId,
                    status: 'ACTIVE',
                  },
                },
              },
            });
            rtbRouteInfo = {
              tenant_id: pingReq.publisher.tenantId,
              ping_id: pingReq.id,
              buyer_id: wBid.buyerId,
              buyer_endpoint_id: wBid.buyerEndpointId,
              publisher_id: pingReq.publisherId,
              campaign_id: (campaign?.id || null) as string | null,
              buyer_destination: wBid.buyerEndpoint.destination,
              transfer_number: body.did,
              caller_number: pingReq.callerNumber || body.callerNumber || null,
              rtb_bid_amount: Number(wBid.amount),
              buyer_bid_id: wBid.id,
              post_accepted_at: pingReq.postedAt
                ? pingReq.postedAt.toISOString()
                : new Date().toISOString(),
              publisher_request_id: pingReq.requestId || null,
              vertical: pingReq.vertical || null,
              expires_at: pingReq.expiresAt ? pingReq.expiresAt.toISOString() : null,
              leased_at: pingReq.createdAt
                ? pingReq.createdAt.toISOString()
                : new Date().toISOString(),
            };
          }
        }

        if (rtbRouteInfo) {
          buyerId = rtbRouteInfo.buyer_id;
          targetId = rtbRouteInfo.buyer_endpoint_id;
          campaignId = rtbRouteInfo.campaign_id;
          publisherId = rtbRouteInfo.publisher_id;
          tenantId = rtbRouteInfo.tenant_id || tenantId;
          callSource = 'INBOUND_RTB';

          // Look up phoneNumberId for the transfer number/did in the DB
          if (rtbRouteInfo.transfer_number) {
            const phone = await prisma.phoneNumber.findFirst({
              where: { number: rtbRouteInfo.transfer_number },
              select: { id: true },
            });
            if (phone) {
              phoneNumberId = phone.id;
            }
          }

          rtbMetadata = {
            pingId: rtbRouteInfo.ping_id,
            transferNumber: rtbRouteInfo.transfer_number,
            bidAmount: rtbRouteInfo.rtb_bid_amount,
            buyerBidId: rtbRouteInfo.buyer_bid_id,
            publisherRequestId: rtbRouteInfo.publisher_request_id,
            postAcceptedAt: rtbRouteInfo.post_accepted_at,
            routeType: 'RTB',
          };
        }
      }

      // If not RTB or if RTB route lookup failed, look up DidRoute record
      if (!rtbMetadata) {
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

        phoneNumberId = route.phoneNumberId;
        buyerId = sanitizeFk(body.buyerId) || sanitizeFk(route.buyerId) || null;
        targetId = sanitizeFk(body.targetId) || null;
        campaignId = route.campaignId || null;
        publisherId = route.publisherId || null;
        tenantId = route.tenantId;
        buyerName = route.label || null;
      }

      // Resolve buyer name from buyer record if we have a buyerId
      if (buyerId && !buyerName) {
        try {
          const buyer = await prisma.buyer.findUnique({
            where: { id: buyerId },
            select: { name: true },
          });
          if (buyer) {
            buyerName = buyer.name;
          }
        } catch (dbErr) {
          console.error('[FS-CDR] Failed to resolve buyer name:', dbErr);
        }
      }

      // Create Call record
      const call = await prisma.call.create({
        data: {
          tenantId: tenantId,
          callSid: `fs-${body.callId}`,
          direction: 'INBOUND',
          status: callStatus as 'COMPLETED' | 'BUSY' | 'NO_ANSWER' | 'FAILED' | 'CANCELLED',
          fromNumberId: phoneNumberId,
          toNumber: body.destination,
          callerId: body.callerNumber,
          did: body.did || (rtbMetadata ? rtbMetadata.transferNumber : null),
          targetNumber: body.destination,
          duration: body.duration || 0,
          connectedDuration: body.connectedDuration || 0,
          campaignId: campaignId,
          buyerId: buyerId,
          targetId: targetId,
          publisherId: publisherId,
          startedAt: body.startedAt ? new Date(body.startedAt) : new Date(),
          answeredAt: body.answeredAt ? new Date(body.answeredAt) : null,
          endedAt: body.endedAt ? new Date(body.endedAt) : new Date(),
          buyerName: buyerName,
          recordingStatus: body.recordingPath ? 'PENDING' : null,
          callSource: callSource,
          cost:
            body.carrierCost !== undefined && body.carrierCost !== null
              ? new Prisma.Decimal(body.carrierCost)
              : null,
          metadata: rtbMetadata ? ({ rtb: rtbMetadata } as unknown as Prisma.InputJsonValue) : undefined,
        },
      });

      // Calculate call billing
      try {
        const { billingService } = await import('../services/billing-service.js');
        await billingService.calculateCallBilling(call.id);

        // Fetch updated call details with buyer info
        const updatedCall = await prisma.call.findUnique({
          where: { id: call.id },
          include: { buyer: true },
        });

        if (updatedCall) {
          // If billable and buyer is upfront, process deduction immediately
          if (updatedCall.billable && updatedCall.buyer?.billingType === 'UPFRONT') {
            const { buyerBillingService } = await import('../services/buyer-billing-service.js');
            await buyerBillingService.processCallBilling(updatedCall.id);
          }

          // Publish events to event bus
          const { eventBus } = await import('../services/event-bus.js');

          // Publish call.completed (for billing-worker rating)
          await eventBus.publish('call.*', {
            event: 'call.completed',
            tenantId: tenantId,
            data: {
              callId: updatedCall.id,
              direction: updatedCall.direction,
              duration: updatedCall.duration || 0,
              answered: callStatus === 'COMPLETED' || callStatus === 'ANSWERED',
              publisherId: updatedCall.publisherId || undefined,
              buyerId: updatedCall.buyerId || undefined,
              campaignId: updatedCall.campaignId || undefined,
              hasRecording: !!body.recordingPath,
              recordingDuration: body.recordingDuration || body.duration || 0,
            },
          });

          // Publish call.ended (for real-time dashboards)
          await eventBus.publish('call.*', {
            event: 'call.ended',
            tenantId: tenantId,
            data: {
              callId: updatedCall.id,
              direction: updatedCall.direction,
              duration: updatedCall.duration || 0,
              status: updatedCall.status,
              endedAt: updatedCall.endedAt?.toISOString() || new Date().toISOString(),
            },
          });
        }
      } catch (billingErr) {
        console.error(
          '[FS-CDR] Failed to calculate billing and publish events for call:',
          call.id,
          billingErr
        );
      }

      // If there's a recording, trigger background upload.
      if (body.recordingPath) {
        const recordingPath = body.recordingPath;
        const callId = call.id;
        const duration = body.recordingDuration || body.duration || 0;

        // Mark call as PROCESSING while we upload
        await prisma.call.update({
          where: { id: callId },
          data: { recordingStatus: 'PROCESSING' },
        });

        setTimeout(() => {
          (async () => {
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

                console.log(
                  `[FS-CDR] Background upload complete for call ${callId}. Recording ID: ${uploadResult.id}`
                );
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
          })().catch(err => {
            console.error('[FS-CDR] Background IIFE error:', err);
          });
        }, 1000); // 1-second delay
      }

      // Update DID route stats if not an RTB route
      if (!body.routeId.startsWith('rtb-')) {
        await prisma.didRoute.update({
          where: { id: body.routeId },
          data: {
            totalCalls: { increment: 1 },
            totalDuration: { increment: body.duration || 0 },
            lastCallAt: new Date(),
          },
        });
      }

      // Release leased number if it was an RTB call
      if (rtbMetadata && rtbMetadata.transferNumber) {
        // Change Redis key TTL to 120 seconds
        try {
          const redis = getRedisClient();
          await redis.expire(`route:did:${rtbMetadata.transferNumber}`, 120);
        } catch (redisErr) {
          console.error('[FS-CDR] Failed to set Redis TTL for transfer number:', redisErr);
        }

        // Release the number in database immediately back to pool
        try {
          await prisma.phoneNumber.updateMany({
            where: { number: rtbMetadata.transferNumber },
            data: {
              poolStatus: 'AVAILABLE',
              lastAssignedAt: null,
            },
          });
          console.log(
            `[FS-CDR] Released transfer number ${rtbMetadata.transferNumber} back to pool`
          );
        } catch (dbErr) {
          console.error('[FS-CDR] Failed to release number in DB:', dbErr);
        }
      }

      console.log(
        `[FS-CDR] Call ${body.callId}: ${body.callerNumber} → ${body.did} → ${body.destination} | ${body.duration}s | ${body.hangupCause}`
      );

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
  server.post(
    '/api/v1/freeswitch/recording-uploaded',
    async (request: FastifyRequest, reply: FastifyReply) => {
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

        console.log(
          `[FS-RECORDING] Processed recording for call ${body.callId}. Recording ID: ${result.id}, storageKey: ${result.storageKey}`
        );
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
    }
  );

  console.log('[API] DID Route management routes registered:');
  console.log('  GET/POST        /api/v1/did-routes');
  console.log('  PATCH/DELETE    /api/v1/did-routes/:id');
  console.log('  GET             /api/v1/freeswitch/lookup');
  console.log('  POST            /api/v1/freeswitch/cdr');
  console.log('  POST            /api/v1/freeswitch/recording-uploaded');
}
