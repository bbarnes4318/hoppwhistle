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

import {
  CALL_ROUTE_LABELS,
  CALL_ROUTE_TYPES,
  buildBridgeString,
  isCallRouteType,
  resolveChain,
  type CallRouteType,
} from '@hopwhistle/shared';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { requireInternalKey } from '../lib/internal-auth.js';
import { getPrismaClient } from '../lib/prisma.js';
import { getActingTenantId, replyTenantRefusal } from '../lib/tenant-context.js';
import { requireAnyPermission } from '../middleware/rbac.js';
import {
  getCarrierChain,
  invalidateCarrierRoutingCache,
  legOutcomeReportingEnabled,
  listCarrierRoutes,
  recordLegOutcome,
  resolveTenantForCallId,
  resolveTenantForCallerId,
  scheduleChainOutcome,
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

interface UpdateCarrierBody {
  status?: 'ACTIVE' | 'INACTIVE';
  callerIdStrategy?: 'PRESERVE' | 'POOL' | 'FIXED';
  /** Required when the strategy is FIXED; must be one of this tenant's ACTIVE numbers. */
  callerIdNumber?: string | null;
  /** `P-Attestation-Indicator` to claim on this carrier's legs, or null for none. */
  attestation?: 'A' | 'B' | 'C' | null;
}

const CALLER_ID_STRATEGIES = new Set(['PRESERVE', 'POOL', 'FIXED']);
const ATTESTATIONS = new Set(['A', 'B', 'C']);

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

/*
 * Changing where a tenant's calls are routed is an administrative act.
 *
 * ── Why `numbers:*` is no longer accepted here ───────────────────────────────
 *
 * These gates used to include `numbers:read` and `numbers:write`, on the
 * reasoning that an ADMIN reaches them that way when the `settings:*` entries
 * on the ADMIN row are missing. The cost was that the gate stopped meaning
 * "administrator": AGENT, ANALYST and READONLY all hold `numbers:read` because
 * they all have a Numbers page, and AGENT held `numbers:write` -- so every
 * agent on the platform could rewrite their agency's carrier routing, past a
 * comment saying no lesser role gets it. `platform-admin.test.ts` records
 * noticing the read half and testing around it.
 *
 * One permission cannot gate two unrelated resources. The Numbers page keeps
 * `numbers:*`; this keeps `settings:*`, which ADMIN now holds from
 * ROLE_PERMISSIONS itself rather than from a JSON column that may or may not
 * have been populated. An OWNER carries `admin:*` and reaches both.
 */
const canRead = requireAnyPermission('admin:*', 'settings:read');
const canWrite = requireAnyPermission('admin:*', 'settings:write');

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
  return getActingTenantId(request);
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
        return replyTenantRefusal(request, reply);
      }

      const prisma = getPrismaClient();
      const [routes, carriers, numberCounts] = await Promise.all([
        listCarrierRoutes(tenantId),
        prisma.carrier.findMany({
          where: { tenantId },
          select: {
            id: true,
            code: true,
            name: true,
            status: true,
            callerIdStrategy: true,
            callerIdNumber: true,
            numberProvider: true,
            attestation: true,
          },
          orderBy: { name: 'asc' },
        }),
        prisma.phoneNumber.groupBy({
          by: ['provider'],
          where: { tenantId, status: 'ACTIVE', callerIdEligible: true },
          _count: { _all: true },
        }),
      ]);

      // How many of THIS tenant's numbers each carrier could present. Shown
      // per carrier, not only per waterfall step, so an operator sees that
      // Vonage has no caller ID of its own before switching it on anywhere.
      const eligibleByProvider = new Map(
        numberCounts.filter(n => n.provider).map(n => [n.provider as string, n._count._all])
      );

      return {
        routes,
        carriers: carriers.map(c => ({
          ...c,
          eligibleCallerIdCount: c.numberProvider
            ? (eligibleByProvider.get(c.numberProvider) ?? 0)
            : 0,
        })),
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
        return replyTenantRefusal(request, reply);
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
        if (
          !Number.isInteger(legTimeoutSeconds) ||
          legTimeoutSeconds < 5 ||
          legTimeoutSeconds > 120
        ) {
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

  /**
   * Change how one carrier presents caller ID and attestation, or retire it.
   *
   * These are properties of the carrier, not of a waterfall, so one change
   * applies to every call type the carrier is on. They used to be editable
   * only in the database, which made "Vonage signs its own calls, stop sending
   * it an attestation header" a support ticket rather than a setting.
   */
  server.patch<{ Params: { carrierId: string }; Body: UpdateCarrierBody }>(
    '/api/v1/carrier-routing/carriers/:carrierId',
    { preHandler: [canWrite] },
    async (request, reply) => {
      const tenantId = tenantOf(request);
      if (!tenantId) {
        return replyTenantRefusal(request, reply);
      }

      const prisma = getPrismaClient();
      const carrier = await prisma.carrier.findFirst({
        where: { id: request.params.carrierId, tenantId },
      });
      if (!carrier) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Carrier not found' } });
      }

      const { status, callerIdStrategy, callerIdNumber, attestation } = request.body ?? {};

      if (status !== undefined && status !== 'ACTIVE' && status !== 'INACTIVE') {
        return reply.code(400).send({
          error: { code: 'INVALID_STATUS', message: 'status must be ACTIVE or INACTIVE' },
        });
      }
      if (callerIdStrategy !== undefined && !CALLER_ID_STRATEGIES.has(callerIdStrategy)) {
        return reply.code(400).send({
          error: {
            code: 'INVALID_CALLER_ID_STRATEGY',
            message: 'callerIdStrategy must be PRESERVE, POOL or FIXED',
          },
        });
      }
      if (attestation !== undefined && attestation !== null && !ATTESTATIONS.has(attestation)) {
        return reply.code(400).send({
          error: { code: 'INVALID_ATTESTATION', message: 'attestation must be A, B, C or null' },
        });
      }

      // A FIXED caller ID must be one of THIS tenant's own active numbers. It
      // is presented on every leg the carrier places, so accepting an arbitrary
      // string would let one agency present another agency's DID.
      let fixedNumber: string | null | undefined;
      if (callerIdNumber !== undefined) {
        const digits = (callerIdNumber ?? '').replace(/\D/g, '');
        if (digits === '') {
          fixedNumber = null;
        } else {
          const last10 = digits.slice(-10);
          const owned =
            last10.length === 10
              ? await prisma.phoneNumber.findFirst({
                  where: { tenantId, status: 'ACTIVE', number: { endsWith: last10 } },
                  select: { number: true },
                })
              : null;
          if (!owned) {
            return reply.code(400).send({
              error: {
                code: 'UNKNOWN_CALLER_ID',
                message: "callerIdNumber must be one of this account's active phone numbers",
              },
            });
          }
          fixedNumber = owned.number;
        }
      }

      const nextStrategy = callerIdStrategy ?? carrier.callerIdStrategy;
      const nextNumber = fixedNumber !== undefined ? fixedNumber : carrier.callerIdNumber;
      if (nextStrategy === 'FIXED' && !nextNumber) {
        return reply.code(400).send({
          error: {
            code: 'CALLER_ID_REQUIRED',
            message: 'A FIXED caller ID strategy needs a callerIdNumber',
          },
        });
      }

      const updated = await prisma.carrier.update({
        where: { id: carrier.id },
        data: {
          ...(status !== undefined ? { status } : {}),
          ...(callerIdStrategy !== undefined ? { callerIdStrategy } : {}),
          ...(fixedNumber !== undefined ? { callerIdNumber: fixedNumber } : {}),
          ...(attestation !== undefined ? { attestation } : {}),
        },
        select: {
          id: true,
          code: true,
          name: true,
          status: true,
          callerIdStrategy: true,
          callerIdNumber: true,
          numberProvider: true,
          attestation: true,
        },
      });

      invalidateCarrierRoutingCache(tenantId);
      request.log.warn({ msg: '[carrier-routing] carrier updated', tenantId, carrier: updated });
      return updated;
    }
  );

  /** Enable/disable one gateway, or correct its dial format or order. */
  server.patch<{ Params: { gatewayId: string }; Body: UpdateGatewayBody }>(
    '/api/v1/carrier-routing/gateways/:gatewayId',
    { preHandler: [canWrite] },
    async (request, reply) => {
      const tenantId = tenantOf(request);
      if (!tenantId) {
        return replyTenantRefusal(request, reply);
      }

      const prisma = getPrismaClient();
      const gateway = await prisma.carrierGateway.findFirst({
        where: { id: request.params.gatewayId, tenantId },
      });
      if (!gateway) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Gateway not found' } });
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
        return replyTenantRefusal(request, reply);
      }

      const prisma = getPrismaClient();
      const result = await prisma.carrierGateway.updateMany({
        where: { id: request.params.gatewayId, tenantId },
        data: { consecutiveFailures: 0, circuitOpenUntil: null, lastFailureCause: null },
      });
      if (result.count === 0) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Gateway not found' } });
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
        return replyTenantRefusal(request, reply);
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
  // FreeSWITCH — gated on the internal shared secret, same as /freeswitch/lookup
  //
  // These were "no auth — internal network only", which was a deployment
  // assumption rather than an enforced one. `carrier-result` in particular took
  // a `tenantId` from its own body and query with nothing at all in front of
  // it: an unauthenticated cross-agency write onto another agency's gateway
  // health. See `lib/internal-auth.ts`.
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
    { preHandler: [requireInternalKey] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = request.query as {
        type?: string;
        dest?: string;
        cid?: string;
        cid_name?: string;
        tenant?: string;
        /** `hopwhistle_call_id` — the API-created call this INVITE belongs to. */
        call_id?: string;
        /** The calling leg's uuid, correlating per-leg reports with the chain's. */
        corr?: string;
      };

      const callType: CallRouteType = isCallRouteType(query.type) ? query.type : 'SOFTPHONE_MANUAL';
      const destination = query.dest ?? '';

      const legacy = resolveChain(null, callType);

      try {
        // Strongest evidence first. A call row created by an authenticated
        // agent session names its tenant outright; the caller-ID DID is only a
        // guess from a number, used when the call carries no such row (the
        // Dograh BYOC path) — and the default-tenant heuristic behind it only
        // when even the number is unknown.
        const callTenant = await resolveTenantForCallId(query.call_id);
        const tenantId = callTenant || query.tenant || (await resolveTenantForCallerId(query.cid));
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
            // Carried onto every leg so each one can report its own outcome
            // against the right tenant and the right call.
            hopwhistle_tenant_id: tenantId,
            hopwhistle_call_id: callTenant ? query.call_id : undefined,
            hopwhistle_corr: query.corr,
          },
          legOutcomeReporting: legOutcomeReportingEnabled(),
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
   * GET|POST /api/v1/freeswitch/carrier-result
   *
   * Outcome feedback from the dialplan and from each carrier leg. Fire-and-
   * forget: always 200, never blocks a call, never explains a failure back to
   * FreeSWITCH because there is nothing FreeSWITCH could do about it.
   *
   * GET is the one that matters. Every FreeSWITCH caller reaches this through
   * mod_curl — `${curl(url)}` in the dialplan, `curl <url>` from Lua — and
   * both issue a GET. This was registered for POST only, so the dialplan's
   * whole-waterfall failure report was answered 404 and never reached the
   * health counters at all.
   */
  const carrierResult = async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as {
      gateway?: string;
      chain?: string;
      cause?: string;
      answered?: boolean | string;
      tenantId?: string;
    };
    const query = request.query as {
      mode?: string;
      gateway?: string;
      chain?: string;
      cause?: string;
      answered?: string;
      carrier?: string;
      route_type?: string;
      tenant?: string;
      call_id?: string;
      corr?: string;
      sip_status?: string;
    };

    const cause = body.cause || query.cause || '';
    const answeredRaw = body.answered ?? query.answered;
    const answered = answeredRaw === true || answeredRaw === 'true';
    const ok = answered || cause.toUpperCase() === 'NORMAL_CLEARING';
    const tenantHint = body.tenantId || query.tenant || null;

    // Three shapes.
    //
    // `mode=leg` — one leg reporting for itself from carrier_leg_result.lua.
    // Its answer state is exact: early media is not an answer, so a carrier
    // is only credited with a call it actually connected.
    const single = (body.gateway || query.gateway || '').trim();
    if (query.mode === 'leg' && single) {
      await recordLegOutcome({
        gateway: single,
        answered,
        cause,
        carrierCode: query.carrier || null,
        routeType: query.route_type || null,
        tenantId: tenantHint,
        callId: query.call_id || null,
        corr: query.corr || null,
        sipStatus: query.sip_status || null,
      });
      return reply.type('text/plain').send('ok');
    }

    // `gateway` — one named gateway, from an older caller.
    // `chain` — a whole bridge string, sent by the dialplan when every leg of
    // a waterfall failed. With sequential `|` failover that is a statement
    // about all of them; legs that already reported their own cause are
    // skipped so nothing is counted twice.
    const gateways = new Set<string>();
    if (single) gateways.add(single);

    const chain = body.chain || query.chain;
    if (chain) {
      for (const match of chain.matchAll(/sofia\/gateway\/([^/]+)\//g)) {
        gateways.add(match[1]);
      }
    }

    // Not awaited: the chain report waits for the last leg's own report,
    // and the dialplan that sent this is holding a call while it waits.
    void scheduleChainOutcome(
      [...gateways],
      { ok, cause },
      {
        tenantId: tenantHint,
        callId: query.call_id || null,
        corr: query.corr || null,
      }
    );

    return reply.type('text/plain').send('ok');
  };

  server.get(
    '/api/v1/freeswitch/carrier-result',
    { preHandler: [requireInternalKey] },
    carrierResult
  );
  server.post(
    '/api/v1/freeswitch/carrier-result',
    { preHandler: [requireInternalKey] },
    carrierResult
  );

  console.log('  GET             /api/v1/carrier-routing/overview');
  console.log('  PUT             /api/v1/carrier-routing/routes/:callType');
  console.log('  GET             /api/v1/carrier-routing/routes/:callType/preview');
  console.log('  PATCH           /api/v1/carrier-routing/carriers/:carrierId');
  console.log('  PATCH           /api/v1/carrier-routing/gateways/:gatewayId');
  console.log('  POST            /api/v1/carrier-routing/gateways/:gatewayId/reset-health');
  console.log('  GET             /api/v1/freeswitch/carrier-route');
  console.log('  GET|POST        /api/v1/freeswitch/carrier-result');
}
