/**
 * Dialer V2 shadow — read-only supervisor API.
 *
 * Routes under `/api/v1/dialer-v2/shadow`. Every route is a GET. There is no
 * endpoint here that can start, stop, pause, or configure a dialer, and none
 * that can originate a call.
 *
 * Tenant scoping: the tenant is taken from the VERIFIED session only. Unlike
 * some existing routes in this codebase, this one deliberately does NOT honour
 * `x-demo-tenant-id` — `MULTITENANT_GAP_ANALYSIS.md` §1 records that idiom as
 * browser-trusted tenant impersonation, and a new route must not extend it.
 */

import { FastifyInstance, FastifyRequest } from 'fastify';

import { DialerV2ShadowClient } from '../services/dialer-v2-shadow-client.js';

interface AuthenticatedUser {
  tenantId?: string;
  userId?: string;
  scopes?: string[];
}

type AuthRequest = FastifyRequest & { user?: AuthenticatedUser };

/**
 * Verified tenant only. Returns null when the request is unauthenticated, which
 * the caller turns into a 401 — there is no fallback, demo, or default tenant.
 */
export function verifiedTenantId(request: FastifyRequest): string | null {
  const user = (request as AuthRequest).user;
  const tenantId = user?.tenantId;
  return typeof tenantId === 'string' && tenantId.length > 0 ? tenantId : null;
}

const DEFAULT_BASE_URL = process.env.DIALER_V2_URL || 'http://dialer-v2:9092';

// eslint-disable-next-line @typescript-eslint/require-await
export async function registerDialerV2ShadowRoutes(
  fastify: FastifyInstance,
  client: DialerV2ShadowClient = new DialerV2ShadowClient({ baseUrl: DEFAULT_BASE_URL })
) {
  /**
   * GET /api/v1/dialer-v2/shadow/status
   * Health of the shadow pipeline. Reports "unreachable" honestly rather than
   * inventing a healthy-looking response.
   */
  fastify.get('/api/v1/dialer-v2/shadow/status', async (request, reply) => {
    const tenantId = verifiedTenantId(request);
    if (!tenantId) {
      void reply.code(401);
      return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    }

    const status = await client.getStatus();
    return { data: status };
  });

  /**
   * GET /api/v1/dialer-v2/shadow/decisions
   * Recent hypothetical pacing decisions for the caller's own tenant.
   */
  fastify.get<{ Querystring: { campaignId?: string; limit?: string } }>(
    '/api/v1/dialer-v2/shadow/decisions',
    async (request, reply) => {
      const tenantId = verifiedTenantId(request);
      if (!tenantId) {
        void reply.code(401);
        return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
      }

      const rawLimit = Number.parseInt(request.query.limit ?? '', 10);
      const limit = Number.isFinite(rawLimit) ? Math.min(200, Math.max(1, rawLimit)) : 50;

      // campaignId is a filter within the caller's own tenant. It can never
      // widen scope, because tenantId is fixed from the session.
      const decisions = await client.getDecisions(tenantId, limit, request.query.campaignId);

      return {
        data: decisions,
        meta: {
          tenantId,
          count: decisions.length,
          // Stated on every response so no consumer can mistake shadow output
          // for evidence that the dialer is running.
          shadowMode: true,
          originated: false,
          note: 'Shadow mode records what the dialer would have done. No call was placed.',
        },
      };
    }
  );
}
