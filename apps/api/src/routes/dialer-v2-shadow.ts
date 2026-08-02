/**
 * Dialer V2 shadow — read-only supervisor API.
 *
 * Routes under `/api/v1/dialer-v2`. Every data route is a GET. There is no
 * endpoint here that can start, stop, pause, or configure a dialer, and none
 * that can originate a call.
 *
 * ── Authentication ───────────────────────────────────────────────────────────
 *
 * These routes do NOT trust `request.user`. The global hook in
 * `apps/api/src/index.ts` populates it from `x-demo-tenant-id` / `?demoTenantId=`
 * with `roles: ['ADMIN','OWNER']`, before it ever tries the API key — so any
 * route trusting `request.user` accepts a browser-chosen tenant with admin
 * rights. Dialer V2 verifies independently via `verifyDialerV2Auth`, which reads
 * only `Authorization: Bearer` and `x-api-key`.
 */

import { createHash } from 'node:crypto';

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  AuthFailure,
  isAuthorizedForDialerV2,
  verifyDialerV2Auth,
  type ApiKeyRecord,
  type VerifiedAuthContext,
} from '../lib/dialer-v2-auth.js';
import { getPrismaClient } from '../lib/prisma.js';
import { DialerV2ShadowClient } from '../services/dialer-v2-shadow-client.js';

const DEFAULT_BASE_URL = process.env.DIALER_V2_URL || 'http://dialer-v2:9092';

export interface DialerV2RouteOptions {
  client?: DialerV2ShadowClient;
  /** Injected in tests so no server or database is needed. */
  verify?: (
    request: FastifyRequest
  ) => Promise<{ ok: true; context: VerifiedAuthContext } | { ok: false; failure: AuthFailure }>;
}

function defaultVerifier(fastify: FastifyInstance) {
  return async (request: FastifyRequest) => {
    return verifyDialerV2Auth(
      {
        // Only these two headers. Nothing else is consulted, ever.
        authorization: request.headers.authorization,
        'x-api-key': request.headers['x-api-key'] as string | undefined,
      },
      {
        verifyJwt: token => fastify.jwt.verify(token),
        hashApiKey: raw => createHash('sha256').update(raw).digest('hex'),
        now: () => new Date(),
        lookupApiKey: async (keyHash: string): Promise<ApiKeyRecord | null> => {
          const prisma = getPrismaClient();
          const key = await prisma.apiKey.findUnique({
            where: { keyHash },
            include: { tenant: true },
          });
          if (!key) return null;
          return {
            id: key.id,
            tenantId: key.tenantId,
            status: key.status,
            expiresAt: key.expiresAt,
            scopes: key.scopes,
            tenantStatus: key.tenant.status,
          };
        },
      }
    );
  };
}

/**
 * Resolve the caller, or send the correct error response.
 * Returns null when a response has already been sent.
 */
async function authorize(
  request: FastifyRequest,
  reply: FastifyReply,
  verify: NonNullable<DialerV2RouteOptions['verify']>
): Promise<VerifiedAuthContext | null> {
  const result = await verify(request);

  if (!result.ok) {
    void reply.code(401);
    // The failure reason is deliberately not echoed: it would tell a prober
    // whether a tenant or key exists.
    void reply.send({
      error: { code: 'UNAUTHORIZED', message: 'Verified authentication required' },
    });
    return null;
  }

  if (!isAuthorizedForDialerV2(result.context)) {
    void reply.code(403);
    void reply.send({
      error: { code: 'FORBIDDEN', message: 'Insufficient permissions for Dialer V2' },
    });
    return null;
  }

  return result.context;
}

// eslint-disable-next-line @typescript-eslint/require-await
export async function registerDialerV2ShadowRoutes(
  fastify: FastifyInstance,
  options: DialerV2RouteOptions = {}
) {
  const client =
    options.client ??
    new DialerV2ShadowClient({
      baseUrl: DEFAULT_BASE_URL,
      internalToken: process.env.DIALER_V2_INTERNAL_TOKEN,
    });
  const verify = options.verify ?? defaultVerifier(fastify);

  fastify.get('/api/v1/dialer-v2/shadow/status', async (request, reply) => {
    const auth = await authorize(request, reply, verify);
    if (!auth) return reply;

    const status = await client.getStatus();
    return {
      data: status,
      meta: { tenantId: auth.tenantId, authSource: auth.source },
    };
  });

  fastify.get<{ Querystring: { campaignId?: string; limit?: string } }>(
    '/api/v1/dialer-v2/shadow/decisions',
    async (request, reply) => {
      const auth = await authorize(request, reply, verify);
      if (!auth) return reply;

      const rawLimit = Number.parseInt(request.query.limit ?? '', 10);
      const limit = Number.isFinite(rawLimit) ? Math.min(200, Math.max(1, rawLimit)) : 50;

      // campaignId filters WITHIN the verified tenant. It is passed as a
      // separate parameter and can never replace or widen tenantId.
      const decisions = await client.getDecisions(auth.tenantId, limit, request.query.campaignId);

      return {
        data: decisions,
        meta: {
          tenantId: auth.tenantId,
          authSource: auth.source,
          count: decisions.length,
          // Stated on every response so nothing can mistake shadow output for
          // evidence that the dialer is running.
          shadowMode: true,
          originated: false,
          note: 'Shadow mode records what the dialer would have done. No call was placed.',
        },
      };
    }
  );

  fastify.get('/api/v1/dialer-v2/agents/state', async (request, reply) => {
    const auth = await authorize(request, reply, verify);
    if (!auth) return reply;

    const agents = await client.getAgents(auth.tenantId);
    return { data: agents, meta: { tenantId: auth.tenantId } };
  });

  fastify.get('/api/v1/dialer-v2/reconciliation/corrections', async (request, reply) => {
    const auth = await authorize(request, reply, verify);
    if (!auth) return reply;

    const corrections = await client.getCorrections(auth.tenantId, 50);
    return { data: corrections, meta: { tenantId: auth.tenantId } };
  });

  /**
   * POST /api/v1/dialer-v2/agents/heartbeat
   *
   * The single non-GET route. It records agent readiness signals; it cannot
   * originate, bridge, or control a call. Tenant and agent identity come from
   * verified authentication — the browser cannot select either.
   */
  fastify.post<{
    Body: {
      sessionId?: string;
      sequence?: number;
      uiState?: string;
      sipRegistered?: boolean;
      currentCallId?: string | null;
      currentChannelUuid?: string | null;
      campaignIds?: string[];
      queueIds?: string[];
      softphoneReady?: boolean;
    };
  }>('/api/v1/dialer-v2/agents/heartbeat', async (request, reply) => {
    const result = await verify(request);
    if (!result.ok) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Verified authentication required' } };
    }

    // Agents are not supervisors, so this route intentionally does NOT apply
    // the supervisor role gate — but it does require a real user identity,
    // which an API key does not carry.
    const auth = result.context;
    if (auth.source !== 'jwt' || !auth.userId) {
      void reply.code(403);
      return {
        error: { code: 'FORBIDDEN', message: 'Agent heartbeat requires an authenticated user' },
      };
    }

    const body = request.body ?? {};
    if (typeof body.sessionId !== 'string' || body.sessionId.length === 0) {
      void reply.code(400);
      return { error: { code: 'SESSION_REQUIRED', message: 'sessionId is required' } };
    }

    const accepted = await client.postHeartbeat({
      // Never from the body — always from the verified token.
      tenantId: auth.tenantId,
      agentId: auth.userId,
      userId: auth.userId,
      sessionId: body.sessionId,
      sequence: typeof body.sequence === 'number' ? body.sequence : 0,
      uiState: typeof body.uiState === 'string' ? body.uiState : null,
      sipRegistered: body.sipRegistered === true,
      currentCallId: body.currentCallId ?? null,
      currentChannelUuid: body.currentChannelUuid ?? null,
      campaignIds: Array.isArray(body.campaignIds) ? body.campaignIds : [],
      queueIds: Array.isArray(body.queueIds) ? body.queueIds : [],
      softphoneReady: body.softphoneReady === true,
    });

    if (!accepted.accepted) {
      void reply.code(accepted.status ?? 409);
      return { error: { code: accepted.reason ?? 'REJECTED', message: accepted.message ?? '' } };
    }

    return {
      data: {
        accepted: true,
        // Browser claims are signals, never truth. The agent counts as capacity
        // only after reconciliation against SIP and FreeSWITCH channel state.
        countedAsCapacity: accepted.countedAsCapacity === true,
        state: accepted.state ?? null,
      },
      meta: { tenantId: auth.tenantId, agentId: auth.userId },
    };
  });
}
