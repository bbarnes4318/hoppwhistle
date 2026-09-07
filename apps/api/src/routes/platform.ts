/**
 * NetEnroll platform operations: who you are, and which agency you are inside.
 *
 * ── The switch, and why it looks like this ───────────────────────────────────
 *
 * Phase 1 removed every wire input from tenant resolution: no header, no query
 * parameter, no body field, no hostname, no path. A platform operator still
 * needs a way to say "put me inside Ridgeline for the next hour", and the way
 * that does NOT reopen Phase 1 is this:
 *
 *   POST   /api/v1/platform/acting-tenant   names an agency and writes a row
 *   DELETE /api/v1/platform/acting-tenant   deletes the row
 *   GET    /api/v1/platform/context         reports where the operator is
 *
 * The body of the POST names the agency being ENTERED. That is not the same as
 * resolving the acting tenant of the request carrying it: this request is
 * authorised by the capability, and the tenant it names becomes server-side
 * state for LATER requests. The request that enters an agency does not itself
 * act inside it -- the authentication middleware has already run by the time
 * the row is written -- which is the property the tests pin.
 *
 * Everything after that is unchanged from Phase 1: the middleware copies the
 * row onto `request.user.tenantId`, `lib/tenant-context.ts` reads
 * `request.user` and nothing else, and every tenant-scoped query in the
 * codebase scopes correctly without knowing any of this happened.
 */

import { FastifyInstance } from 'fastify';

import {
  enterActingTenant,
  leaveActingTenant,
  PlatformSwitchError,
} from '../lib/platform-admin.js';
import { isPlatformAdminRequest, requirePlatformAdmin } from '../lib/platform-context.js';
import { getPrismaClient } from '../lib/prisma.js';
import { getActingUserId } from '../lib/tenant-context.js';
import { authenticate } from '../middleware/auth.js';

// eslint-disable-next-line @typescript-eslint/require-await -- plugin signature
export async function registerPlatformRoutes(fastify: FastifyInstance): Promise<void> {
  const prisma = getPrismaClient();

  /**
   * GET /api/v1/platform/context
   *
   * What the UI needs to render the banner: am I NetEnroll staff, and if so,
   * which agency am I currently inside?
   *
   * Authenticated but NOT gated on the capability, because the web app asks
   * this on every page load for every user. An agency user gets
   * `{ isPlatformAdmin: false, actingTenant: null }` and renders nothing.
   */
  fastify.get(
    '/api/v1/platform/context',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const isPlatform = isPlatformAdminRequest(request);
      const principal = request.user as {
        actingTenantId?: string | null;
        actingTenantName?: string | null;
      };

      return reply.send({
        isPlatformAdmin: isPlatform,
        actingTenant:
          isPlatform && principal.actingTenantId
            ? { id: principal.actingTenantId, name: principal.actingTenantName ?? null }
            : null,
      });
    }
  );

  /**
   * GET /api/v1/platform/tenants
   *
   * The agency picker. Platform staff only, and deliberately narrow: id, name,
   * slug and status, so the list that lets an operator choose an agency is not
   * also a cross-agency data export.
   */
  fastify.get(
    '/api/v1/platform/tenants',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (_request, reply) => {
      const tenants = await prisma.tenant.findMany({
        select: { id: true, name: true, slug: true, status: true },
        orderBy: { name: 'asc' },
      });

      return reply.send({ data: tenants });
    }
  );

  /**
   * POST /api/v1/platform/acting-tenant
   *
   * Enter an agency. Writes the selection row and one AuditLog entry naming the
   * operator, the agency and the time.
   *
   * Takes effect on the NEXT request, not this one: the middleware that builds
   * `request.user` has already run. That is deliberate and is what keeps the
   * body from being a tenant input in the Phase 1 sense -- nothing in this
   * request is served according to the agency it names.
   */
  fastify.post(
    '/api/v1/platform/acting-tenant',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const userId = getActingUserId(request);
      if (!userId) {
        return reply
          .code(401)
          .send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      }

      const { tenantId } = (request.body ?? {}) as { tenantId?: string };
      if (!tenantId || typeof tenantId !== 'string') {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'tenantId is required' },
        });
      }

      try {
        const entered = await enterActingTenant(userId, tenantId, {
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
          requestId: request.id,
        });

        return reply.send({
          actingTenant: { id: entered.tenantId, name: entered.tenantName },
          enteredAt: entered.enteredAt.toISOString(),
          // Said plainly because it is surprising: this response is not served
          // from inside the agency just entered.
          appliesFrom: 'next-request',
        });
      } catch (err) {
        if (err instanceof PlatformSwitchError) {
          return reply
            .code(err.statusCode)
            .send({ error: { code: err.code, message: err.message } });
        }
        throw err;
      }
    }
  );

  /**
   * DELETE /api/v1/platform/acting-tenant
   *
   * Leave the agency and return to the cross-agency view. Writes one AuditLog
   * entry, and only if there was an agency to leave -- a "left" with no
   * matching "entered" would be a lie about what happened.
   */
  fastify.delete(
    '/api/v1/platform/acting-tenant',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const userId = getActingUserId(request);
      if (!userId) {
        return reply
          .code(401)
          .send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      }

      const { leftTenantId } = await leaveActingTenant(userId, {
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
        requestId: request.id,
      });

      return reply.send({
        actingTenant: null,
        leftTenantId,
        appliesFrom: 'next-request',
      });
    }
  );
}
