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

import fastifyCookie from '@fastify/cookie';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  AuthFailure,
  isAuthorizedForDialerV2,
  verifyDialerV2Auth,
  type VerifiedAuthContext,
} from '../lib/dialer-v2-auth.js';
import {
  CSRF_COOKIE,
  SESSION_COOKIE,
  SESSION_HASH_COOKIE,
  clearSessionCookies,
  csrfCookieOptions,
  mintCsrfToken,
  readSessionFromCookies,
  sessionCookieOptions,
} from '../lib/dialer-v2-session-cookie.js';
import { buildDialerV2VerifyDeps } from '../lib/dialer-v2-verify-deps.js';
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
  const deps = buildDialerV2VerifyDeps(fastify);
  return async (request: FastifyRequest) => {
    return verifyDialerV2Auth(
      {
        // Only these two headers. Nothing else is consulted, ever.
        authorization: request.headers.authorization,
        'x-api-key': request.headers['x-api-key'] as string | undefined,
      },
      deps
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
  // Registered here rather than globally: these are the only routes that use
  // cookies, and the session cookie is scoped to their path.
  //
  // Deliberately NOT awaited. Awaiting would make this function's routes
  // register asynchronously, and callers that do not await it — including the
  // route tests — would then have Fastify reach `ready()` with no routes bound.
  if (!fastify.hasRequestDecorator('cookies')) {
    void fastify.register(fastifyCookie);
  }

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
  /**
   * POST /api/v1/dialer-v2/agents/session
   *
   * Mints a server-issued session for the authenticated agent. The browser
   * cannot choose its own session id, which is what makes duplicate-session
   * detection and replay protection meaningful.
   */
  fastify.post('/api/v1/dialer-v2/agents/session', async (request, reply) => {
    const result = await verify(request);
    if (!result.ok) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Verified authentication required' } };
    }
    const auth = result.context;
    if (auth.source !== 'jwt' || !auth.userId) {
      void reply.code(403);
      return {
        error: { code: 'FORBIDDEN', message: 'Agent session requires an authenticated user' },
      };
    }

    const grant = await client.issueSession(auth.tenantId, auth.userId, auth.userId);
    if (!grant) {
      void reply.code(503);
      return { error: { code: 'UNAVAILABLE', message: 'Dialer V2 service is unavailable' } };
    }

    const now = Date.now();
    const csrfToken = mintCsrfToken();

    // The token goes into the cookie and NOWHERE else. It is not in the
    // response body, so page JavaScript never holds it and an XSS cannot
    // exfiltrate a credential that outlives the page.
    void reply.setCookie(
      SESSION_COOKIE,
      grant.sessionToken,
      sessionCookieOptions(grant.expiresAtMs, now)
    );
    // The hash rides along so logout can revoke without reading the token back.
    void reply.setCookie(
      SESSION_HASH_COOKIE,
      grant.sessionTokenHash,
      sessionCookieOptions(grant.expiresAtMs, now)
    );
    // Readable by script on purpose: it must be echoed in a header, and it is
    // not a credential — it proves only same-origin, which is what a
    // cross-origin attacker cannot fake.
    void reply.setCookie(CSRF_COOKIE, csrfToken, csrfCookieOptions(grant.expiresAtMs, now));

    return {
      data: {
        // No token, no hash. Only what the page legitimately needs to schedule
        // its next heartbeat and to know when to re-authenticate.
        expiresAtMs: grant.expiresAtMs,
        issuedAtMs: grant.issuedAtMs,
        csrfToken,
      },
      meta: { tenantId: auth.tenantId, agentId: auth.userId },
    };
  });

  /**
   * POST /api/v1/dialer-v2/agents/logout
   *
   * Revokes the Redis session and clears every cookie. Revoking rather than
   * merely clearing matters: a cleared cookie leaves the session valid to
   * anyone who captured the token, and the whole point of a server-side session
   * is that the server can end it.
   */
  fastify.post('/api/v1/dialer-v2/agents/logout', async (request, reply) => {
    const result = await verify(request);
    if (!result.ok) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Verified authentication required' } };
    }
    const auth = result.context;
    if (auth.source !== 'jwt' || !auth.userId) {
      void reply.code(403);
      return { error: { code: 'FORBIDDEN', message: 'Logout requires an authenticated user' } };
    }

    const cookie = readSessionFromCookies(request);
    let revoked = false;
    if (cookie.ok && cookie.sessionTokenHash) {
      revoked = await client.revokeSession(auth.tenantId, cookie.sessionTokenHash);
    }

    // Cookies are cleared whether or not revocation succeeded. Leaving them in
    // place after a failed revoke would keep presenting a credential the user
    // has asked to give up.
    clearSessionCookies(reply);
    return { data: { revoked }, meta: { tenantId: auth.tenantId, agentId: auth.userId } };
  });

  fastify.post<{
    Body: {
      sequence?: number;
      uiState?: string;
      preferredCampaignIds?: string[];
      browserClaimsSipRegistered?: boolean;
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

    // The session token comes from the HttpOnly cookie, read here on the
    // server. It is not in the request body and cannot be: the body arrives
    // from page JavaScript, which by construction cannot read the cookie.
    const cookie = readSessionFromCookies(request);
    if (!cookie.ok || !cookie.token) {
      void reply.code(401);
      return {
        error: {
          code: cookie.rejection ?? 'SESSION_REQUIRED',
          message: 'A valid agent session cookie and CSRF header are required',
        },
      };
    }

    const body = request.body ?? {};

    const accepted = await client.postHeartbeat({
      // Never from the body — always from the verified token.
      tenantId: auth.tenantId,
      agentId: auth.userId,
      userId: auth.userId,
      sessionToken: cookie.token,
      sequence: typeof body.sequence === 'number' ? body.sequence : 0,
      uiState: typeof body.uiState === 'string' ? body.uiState : null,
      // A preference only. SIP state, call ids, channel UUIDs, and campaign
      // membership are all derived server-side and are not accepted here.
      preferredCampaignIds: Array.isArray(body.preferredCampaignIds)
        ? body.preferredCampaignIds
        : undefined,
      browserClaimsSipRegistered: body.browserClaimsSipRegistered === true,
    });

    if (!accepted.accepted) {
      void reply.code(accepted.status ?? 409);
      return { error: { code: accepted.reason ?? 'REJECTED', message: accepted.message ?? '' } };
    }

    return {
      data: {
        accepted: true,
        // Browser claims are signals, never truth. The agent counts as capacity
        // only when FreeSWITCH confirms SIP registration.
        countedAsCapacity: accepted.countedAsCapacity === true,
        state: accepted.state ?? null,
        sipRegistered: accepted.sipRegistered === true,
        campaignIds: accepted.campaignIds ?? [],
      },
      meta: { tenantId: auth.tenantId, agentId: auth.userId },
    };
  });
}
