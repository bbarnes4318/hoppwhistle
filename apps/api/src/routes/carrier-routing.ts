/**
 * Carrier waterfall routing — HTTP surface.
 *
 * Two audiences, deliberately separated:
 *
 *   /api/v1/carrier-routing/*   admin CRUD behind RBAC, backing the settings UI
 *   /api/v1/freeswitch/carrier-*  unauthenticated, internal-network only, the
 *                                 same trust model as the existing
 *                                 /api/v1/freeswitch/lookup and /cdr endpoints
 *                                 that FreeSWITCH already calls with mod_curl
 *
 * The FreeSWITCH endpoints answer in plain text and are written never to fail:
 * on any error they return the legacy FracTEL chain rather than an error
 * status, because the dialplan's only reasonable interpretation of a 500 is to
 * drop the call.
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  CALL_ROUTE_LABELS,
  CALL_ROUTE_TYPES,
  buildBridgeString,
  isCallRouteType,
  resolveChain,
  type CallRouteType,
} from '@hopwhistle/shared';

import { getPrismaClient } from '../lib/prisma.js';
import { requireAnyPermission } from '../middleware/rbac.js';
import {
  getCarrierChain,
  invalidateCarrierRoutingCache,
  listCarrierRoutes,
  recordGatewayOutcome,
  resolveTenantForCallerId,
} from '../services/carrier-routing.js';

interface RouteTypeParams {
  callType: string;
}

interface UpdateRouteBody {
  enabled?: boolean;
  legTimeoutSeconds?: number;
  /** Full replacement of the waterfall, in order. Index 0 is the primary carrier. */
  carriers?: Array<{ carrierId: string; enabled?: boolean }>;
}

interface UpdateGatewayBody {
  enabled?: boolean;
  priority?: number;
  numberFormat?: 'E164' | 'NANP11' | 'NANP10';
  /**
   * Digits dialed ahead of the destination to identify this trunk to the
   * carrier. Empty string clears it; omitting the field leaves it alone.
   */
  techPrefix?: string | null;
}

// An OWNER carries `admin:*`. An ADMIN reaches these two different ways —
// `numbers:*` from the ROLE_PERMISSIONS map in rbac.ts and `settings:*` from
// the permissions JSON on the ADMIN row in the `roles` table — and the two
// sources do not agree, so both are accepted. Changing where a tenant's calls
// are routed is an administrative act; no lesser role gets it.
const canRead = requireAnyPermission('admin:*', 'settings:read', 'numbers:read');
const canWrite = requireAnyPermission('admin:*', 'settings:write', 'numbers:write');

/**
 * The tenant this request may act as.
 *
 * Reads only `request.user.tenantId`, which the onRequest hook populates for
 * every way a request can be identified — JWT, API key, and demo mode. It
 * deliberately does not consult `x-demo-tenant-id` itself: a header that
 * outranks an authenticated user's own tenant is a cross-tenant read, and this
 * route can reconfigure where a tenant's calls are sent.
 */
function tenantOf(request: FastifyRequest): string | null {
  const user = (request as FastifyRequest & { user?: { tenantId?: string } }).user;
  return user?.tenantId ?? null;
}

export async function registerCarrierRoutingRoutes(server: FastifyInstance) {
  await Promise.resolve();

  // ══════════════════════════════════════════════════════════════════════════
  // Admin
  // ══════════════════════════════════════════════════════════════════════════

  /** Everything the settings page renders: carriers, gateways, all six waterfalls. */
  server.get(
    '/api/v1/carrier-routing/overview',
    { preHandler: [canRead] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = tenantOf(request);
      if (!tenantId) {
        return reply.code(401).send({
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        });
      }

      const prisma = getPrismaClient();
      const [routes, carriers] = await Promise.all([
        listCarrierRoutes(tenantId),
        prisma.carrier.findMany({
          where: { tenantId },
          select: { id: true, code: true, name: true, status: true },
          orderBy: { name: 'asc' },
        }),
      ]);

      return {
        routes,
        carriers,
        callTypes: CALL_ROUTE_TYPES.map(t => ({ value: t, label: CALL_ROUTE_LABELS[t] })),
      };
    }
  );

  /**
   * Replace one call type's waterfall.
   *
   * The carrier list is a full replacement rather than a patch: reordering is
   * the primary operation here, and expressing a reorder as a set of positional
   * patches is how two admins editing during an outage end up with two carriers
   * claiming position 0.
   */
  server.put<{ Params: RouteTypeParams; Body: UpdateRouteBody }>(
    '/api/v1/carrier-routing/routes/:callType',
    { preHandler: [canWrite] },
    async (request, reply) => {
      const tenantId = tenantOf(request);
      if (!tenantId) {
        return reply.code(401).send({
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        });
      }

      const { callType } = request.params;
      if (!isCallRouteType(callType)) {
        return reply.code(400).send({
          error: {
            code: 'INVALID_CALL_TYPE',
            message: `callType must be one of: ${CALL_ROUTE_TYPES.join(', ')}`,
          },
        });
      }

      const { enabled, legTimeoutSeconds, carriers } = request.body ?? {};

      if (legTimeoutSeconds !== undefined) {
        if (!Number.isInteger(legTimeoutSeconds) || legTimeoutSeconds < 5 || legTimeoutSeconds > 120) {
          return reply.code(400).send({
            error: {
              code: 'INVALID_TIMEOUT',
              message: 'legTimeoutSeconds must be an integer between 5 and 120',
            },
          });
        }
      }

      const prisma = getPrismaClient();

      // Reject unknown or cross-tenant carrier ids before writing anything. A
      // step pointing at another tenant's carrier would resolve to gateways
      // this tenant does not own.
      if (carriers) {
        const ids = carriers.map(c => c.carrierId);
        if (new Set(ids).size !== ids.length) {
          return reply.code(400).send({
            error: {
              code: 'DUPLICATE_CARRIER',
              message: 'A carrier may appear at most once in a waterfall',
            },
          });
        }
        const owned = await prisma.carrier.findMany({
          where: { tenantId, id: { in: ids } },
          select: { id: true },
        });
        if (owned.length !== ids.length) {
          return reply.code(400).send({
            error: {
              code: 'UNKNOWN_CARRIER',
              message: 'One or more carrierIds do not belong to this tenant',
            },
          });
        }
      }

      const route = await prisma.$transaction(async tx => {
        const existing = await tx.carrierRoute.upsert({
          where: { tenantId_callType: { tenantId, callType } },
          create: {
            tenantId,
            callType,
            enabled: enabled ?? true,
            ...(legTimeoutSeconds !== undefined ? { legTimeoutSeconds } : {}),
          },
          update: {
            ...(enabled !== undefined ? { enabled } : {}),
            ...(legTimeoutSeconds !== undefined ? { legTimeoutSeconds } : {}),
          },
        });

        if (carriers) {
          await tx.carrierRouteStep.deleteMany({ where: { routeId: existing.id } });
          if (carriers.length > 0) {
            await tx.carrierRouteStep.createMany({
              data: carriers.map((c, index) => ({
                routeId: existing.id,
                carrierId: c.carrierId,
                position: index,
                enabled: c.enabled ?? true,
              })),
            });
          }
        }

        return existing;
      });

      invalidateCarrierRoutingCache(tenantId);

      const chain = await getCarrierChain(tenantId, callType);
      request.log.warn({
        msg: '[carrier-routing] waterfall updated',
        tenantId,
        callType,
        effectiveChain: chain.gateways.map(g => g.gateway),
        carrierOrder: chain.carrierOrder,
      });

      return {
        routeId: route.id,
        callType,
        effectiveChain: chain.gateways.map(g => g.gateway),
        carrierOrder: chain.carrierOrder,
        source: chain.source,
      };
    }
  );

  /** Enable/disable one gateway, or correct its dial format or order. */
  server.patch<{ Params: { gatewayId: string }; Body: UpdateGatewayBody }>(
    '/api/v1/carrier-routing/gateways/:gatewayId',
    { preHandler: [canWrite] },
    async (request, reply) => {
      const tenantId = tenantOf(request);
      if (!tenantId) {
        return reply.code(401).send({
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        });
      }

      const prisma = getPrismaClient();
      const gateway = await prisma.carrierGateway.findFirst({
        where: { id: request.params.gatewayId, tenantId },
      });
      if (!gateway) {
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Gateway not found' } });
      }

      const { enabled, priority, numberFormat, techPrefix } = request.body ?? {};

      // The prefix is interpolated into a SIP URI user part, so anything that is
      // not a digit is rejected rather than silently stripped — a prefix that
      // was accepted but altered would fail every call on this trunk and look
      // like a carrier problem.
      let normalizedPrefix: string | null | undefined;
      if (techPrefix !== undefined) {
        const raw = (techPrefix ?? '').trim();
        if (raw !== '' && !/^\d{1,20}$/.test(raw)) {
          return reply.code(400).send({
            error: {
              code: 'INVALID_TECH_PREFIX',
              message: 'techPrefix must be 1-20 digits, or empty to clear it',
            },
          });
        }
        normalizedPrefix = raw === '' ? null : raw;
      }

      const updated = await prisma.carrierGateway.update({
        where: { id: gateway.id },
        data: {
          ...(enabled !== undefined ? { enabled } : {}),
          ...(priority !== undefined ? { priority } : {}),
          ...(numberFormat !== undefined ? { numberFormat } : {}),
          ...(normalizedPrefix !== undefined ? { techPrefix: normalizedPrefix } : {}),
        },
      });

      invalidateCarrierRoutingCache(tenantId);
      return {
        id: updated.id,
        name: updated.name,
        enabled: updated.enabled,
        priority: updated.priority,
        numberFormat: updated.numberFormat,
        techPrefix: updated.techPrefix,
      };
    }
  );

  /**
   * Clear a gateway's demotion.
   *
   * Needed because the circuit is opened by evidence and closed by a timer: an
   * admin who has just fixed the carrier should not have to wait out the window.
   */
  server.post<{ Params: { gatewayId: string } }>(
    '/api/v1/carrier-routing/gateways/:gatewayId/reset-health',
    { preHandler: [canWrite] },
    async (request, reply) => {
      const tenantId = tenantOf(request);
      if (!tenantId) {
        return reply.code(401).send({
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        });
      }

      const prisma = getPrismaClient();
      const result = await prisma.carrierGateway.updateMany({
        where: { id: request.params.gatewayId, tenantId },
        data: { consecutiveFailures: 0, circuitOpenUntil: null, lastFailureCause: null },
      });
      if (result.count === 0) {
        return reply
          .code(404)
          .send({ error: { code: 'NOT_FOUND', message: 'Gateway not found' } });
      }

      invalidateCarrierRoutingCache(tenantId);
      return { reset: true };
    }
  );

  /**
   * What would be dialed, without dialing it.
   *
   * The point of a waterfall is that it is hard to be sure about by reading
   * config, so being able to see the literal bridge string for a real number is
   * how an admin confirms a change before traffic depends on it.
   */
  server.get<{ Params: RouteTypeParams; Querystring: { destination?: string } }>(
    '/api/v1/carrier-routing/routes/:callType/preview',
    { preHandler: [canRead] },
    async (request, reply) => {
      const tenantId = tenantOf(request);
      if (!tenantId) {
        return reply.code(401).send({
          error: { code: 'UNAUTHORIZED', message: 'Authentication required' },
        });
      }

      const { callType } = request.params;
      if (!isCallRouteType(callType)) {
        return reply
          .code(400)
          .send({ error: { code: 'INVALID_CALL_TYPE', message: 'Unknown call type' } });
      }

      const destination = request.query.destination || '8005551212';
      const chain = await getCarrierChain(tenantId, callType);
      const bridge = buildBridgeString(chain, destination, {
        channelVariables: { origination_caller_id_number: '19138999080' },
      });

      return {
        callType,
        destination,
        source: chain.source,
        fallbackReason: chain.fallbackReason ?? null,
        carrierOrder: chain.carrierOrder,
        gateways: chain.gateways,
        bridge,
      };
    }
  );

  // ══════════════════════════════════════════════════════════════════════════
  // FreeSWITCH (no auth — internal network only, same as /freeswitch/lookup)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * GET /api/v1/freeswitch/carrier-route
   *
   * Called from the dialplan with mod_curl on every outbound call. Returns the
   * bare bridge string as text/plain so the dialplan can use the response
   * directly as the `bridge` argument.
   *
   * This endpoint answers 200 with the legacy chain for every failure mode it
   * can encounter. A non-200 or an empty body means, to the dialplan, that the
   * call has nowhere to go.
   */
  server.get(
    '/api/v1/freeswitch/carrier-route',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as {
        type?: string;
        dest?: string;
        cid?: string;
        cid_name?: string;
        tenant?: string;
      };

      const callType: CallRouteType = isCallRouteType(query.type)
        ? query.type
        : 'SOFTPHONE_MANUAL';
      const destination = query.dest ?? '';

      const legacy = resolveChain(null, callType);

      try {
        const tenantId = query.tenant || (await resolveTenantForCallerId(query.cid));
        // The caller ID already on the channel is passed in, not just stamped
        // on: a carrier that issued that number keeps it — which is what makes
        // an agent's manual call still present that agent's own DID — and only
        // a carrier that cannot attest to it substitutes one of its own.
        const chain = await getCarrierChain(tenantId, callType, query.cid);

        const bridge = buildBridgeString(chain, destination, {
          channelVariables: {
            sip_cid_type: 'pid',
            origination_caller_id_number: query.cid,
            sip_from_user: query.cid,
            origination_caller_id_name: query.cid_name,
            hopwhistle_route_type: callType,
            hopwhistle_carrier: chain.gateways[0]?.carrierCode,
          },
        });

        if (!bridge) {
          request.log.warn({
            msg: '[carrier-routing] non-routable destination from dialplan',
            callType,
            destination,
          });
          return reply.type('text/plain').send('');
        }

        return reply.type('text/plain').send(bridge);
      } catch (error) {
        request.log.error({
          msg: '[carrier-routing] resolve failed; serving legacy chain',
          callType,
          err: (error as Error).message,
        });
        const bridge = buildBridgeString(legacy, destination, {
          channelVariables: {
            sip_cid_type: 'pid',
            origination_caller_id_number: query.cid,
            sip_from_user: query.cid,
          },
        });
        return reply.type('text/plain').send(bridge ?? '');
      }
    }
  );

  /**
   * POST /api/v1/freeswitch/carrier-result
   *
   * Outcome feedback from the dialplan's hangup hook. Fire-and-forget: always
   * 200, never blocks a call, never explains a failure back to FreeSWITCH
   * because there is nothing FreeSWITCH could do about it.
   */
  server.post(
    '/api/v1/freeswitch/carrier-result',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as {
        gateway?: string;
        chain?: string;
        cause?: string;
        answered?: boolean | string;
        tenantId?: string;
      };
      const query = request.query as {
        gateway?: string;
        chain?: string;
        cause?: string;
        answered?: string;
      };

      const cause = body.cause || query.cause || '';
      const answeredRaw = body.answered ?? query.answered;
      const ok =
        answeredRaw === true ||
        answeredRaw === 'true' ||
        cause.toUpperCase() === 'NORMAL_CLEARING';

      // Two shapes. `gateway` is one named gateway. `chain` is a whole bridge
      // string, sent by the dialplan when every leg of a waterfall failed —
      // with sequential `|` failover that is a statement about all of them, so
      // each one is credited with the failure.
      const gateways = new Set<string>();
      const single = body.gateway || query.gateway;
      if (single) gateways.add(single.trim());

      const chain = body.chain || query.chain;
      if (chain) {
        for (const match of chain.matchAll(/sofia\/gateway\/([^/]+)\//g)) {
          gateways.add(match[1]);
        }
      }

      for (const gateway of gateways) {
        if (gateway) await recordGatewayOutcome(gateway, { ok, cause }, body.tenantId ?? null);
      }

      return reply.type('text/plain').send('ok');
    }
  );

  console.log('  GET             /api/v1/carrier-routing/overview');
  console.log('  PUT             /api/v1/carrier-routing/routes/:callType');
  console.log('  GET             /api/v1/carrier-routing/routes/:callType/preview');
  console.log('  PATCH           /api/v1/carrier-routing/gateways/:gatewayId');
  console.log('  POST            /api/v1/carrier-routing/gateways/:gatewayId/reset-health');
  console.log('  GET             /api/v1/freeswitch/carrier-route');
  console.log('  POST            /api/v1/freeswitch/carrier-result');
}
