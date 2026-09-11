/**
 * NetEnroll platform operations: who you are, and which agency you are inside.
 *
 * ── Every route here answers `{ data: ... }` ─────────────────────────────────
 *
 * Three of these four used to answer with a bare object while `/tenants`
 * answered with an envelope, and the switcher read `/tenants` as though it were
 * bare. It got an object where it expected an array, called `.map` on it, threw
 * inside the dashboard layout, and locked every platform admin out of the whole
 * portal with "Application error: a client-side exception has occurred".
 *
 * One shape across the surface removes the question. `/api/v1/platform/*`,
 * `/api/v1/delivery/*` and `/api/v1/rating/*` are now uniformly enveloped, and
 * `api-response-contract.test.ts` drives the real web client against these
 * routes so a caller reading the wrong key fails a test rather than a page.
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
 * ── And the role preview, on the same row ────────────────────────────────────
 *
 *   POST   /api/v1/platform/acting-tenant/preview   previews as OWNER or AGENT
 *
 * Acting inside an agency gives the operator ADMIN and OWNER, which is right for
 * support work and useless for answering "what does an agent actually see?" --
 * their own administrator roles stay on the principal and the product looks
 * exactly as it did. A preview narrows the principal to EXACTLY the previewed
 * role and makes every non-GET request a 403, enforced globally in
 * `middleware/read-only-preview.ts` rather than route by route.
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
  isPreviewRole,
  leaveActingTenant,
  PlatformSwitchError,
  PREVIEW_ROLES,
  setPreviewRole,
} from '../lib/platform-admin.js';
import {
  getPreviewRole,
  isPlatformAdminRequest,
  isReadOnlyPreviewRequest,
  requirePlatformAdmin,
} from '../lib/platform-context.js';
import { getPrismaClient } from '../lib/prisma.js';
import { getActingUserId } from '../lib/tenant-context.js';
import { authenticate } from '../middleware/auth.js';
import { auditLog } from '../services/audit.js';

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
   *
   * It also reports the role preview, because the strip warning an operator
   * that everything on screen is read-only is rendered from this response and
   * has to appear on the first page load, not after the first refused write.
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
        data: {
          isPlatformAdmin: isPlatform,
          actingTenant:
            isPlatform && principal.actingTenantId
              ? { id: principal.actingTenantId, name: principal.actingTenantName ?? null }
              : null,
          /*
           * The preview, for the strip the web app renders under the top bar.
           *
           * `readOnly` is deliberately reported separately from `previewRole`
           * rather than left for the client to derive. The server decides what
           * a preview costs; a client that computed it would be a second answer
           * to "can I write", and the one that disagreed would be the one
           * drawing the enabled Save button.
           */
          previewRole: getPreviewRole(request),
          readOnly: isReadOnlyPreviewRequest(request),
        },
      });
    }
  );

  /**
   * GET /api/v1/platform/tenants
   *
   * The agency picker. Platform staff only, and deliberately narrow: id, name,
   * slug, status and whether the tenant is marked non-production, so the list
   * that lets an operator choose an agency is not also a cross-agency data
   * export.
   *
   * `isNonProduction` is here because the switcher shows it beside the name: an
   * operator entering "Demo Organization" should be able to see from the list
   * that it is a fixture. It does not filter the list -- a fixture is still
   * somewhere staff sometimes need to be.
   */
  fastify.get(
    '/api/v1/platform/tenants',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (_request, reply) => {
      const tenants = await prisma.tenant.findMany({
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          isNonProduction: true,
        },
        orderBy: { name: 'asc' },
      });

      return reply.send({ data: tenants });
    }
  );

  /**
   * GET /api/v1/platform/tenants/volume
   *
   * Every tenant with its call and application volume, so the owner can decide
   * which are real agencies and which are fixtures.
   *
   * ── Why this exists and why it does not decide anything ──────────────────
   *
   * Production has five tenants -- Demo Organization, Test Organization, Test
   * Tenant, and two personal workspaces -- and none of them is a real agency.
   * The platform-wide screens are about to be read every day and would be full
   * of them.
   *
   * Nothing in this codebase guesses which is which. A name that looks like a
   * fixture is not evidence, and a tenant quietly dropped from the numbers
   * because of its name is a worse failure than a cluttered table -- one of
   * those five could be carrying live client traffic tomorrow. So this reports
   * the volume and a person marks them. The same query is in
   * `prisma/sql/tenant-volume.sql` for anybody working from psql.
   */
  fastify.get(
    '/api/v1/platform/tenants/volume',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (_request, reply) => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const tenants = await prisma.tenant.findMany({
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          createdAt: true,
          isNonProduction: true,
          nonProductionNote: true,
          billingProfile: { select: { billingEnrolledAt: true } },
        },
        orderBy: { name: 'asc' },
      });

      const rows = await Promise.all(
        tenants.map(async tenant => {
          const [callsTotal, callsAnswered, calls30d, applicationsTotal, applicationsSubmitted, lastCall] =
            await Promise.all([
              prisma.call.count({ where: { tenantId: tenant.id } }),
              prisma.call.count({ where: { tenantId: tenant.id, answeredAt: { not: null } } }),
              prisma.call.count({
                where: { tenantId: tenant.id, createdAt: { gte: thirtyDaysAgo } },
              }),
              prisma.insuranceCarrierApplication.count({ where: { tenantId: tenant.id } }),
              prisma.insuranceCarrierApplication.count({
                where: { tenantId: tenant.id, submittedAt: { not: null } },
              }),
              prisma.call.findFirst({
                where: { tenantId: tenant.id },
                orderBy: { createdAt: 'desc' },
                select: { createdAt: true },
              }),
            ]);

          return {
            tenantId: tenant.id,
            name: tenant.name,
            slug: tenant.slug,
            status: tenant.status,
            createdAt: tenant.createdAt,
            isNonProduction: tenant.isNonProduction,
            nonProductionNote: tenant.nonProductionNote,
            enrolledInBilling: tenant.billingProfile?.billingEnrolledAt != null,
            callsTotal,
            callsAnswered,
            calls30d,
            applicationsTotal,
            applicationsSubmitted,
            lastCallAt: lastCall?.createdAt ?? null,
          };
        })
      );

      return reply.send({ data: rows });
    }
  );

  /**
   * PUT /api/v1/platform/tenants/:tenantId/non-production
   *
   * Mark a tenant as not a real agency, or unmark it.
   *
   * ── What it does, and the three things it does not ───────────────────────
   *
   * It excludes the tenant from the platform totals and hides its row behind a
   * toggle on the platform-wide screens. That is all.
   *
   * It does NOT delete anything, suspend delivery, or un-enrol the tenant from
   * billing. A marked tenant that is somehow taking calls keeps taking them and
   * keeps being settled; this is a decision about what an operator reads on a
   * screen, not about what the platform does. Nothing about it is destructive
   * and the same call reverses it.
   *
   * `:tenantId` names the tenant being administered, not the caller's acting
   * tenant -- the same reading as every other platform route. Authority comes
   * from the capability.
   */
  fastify.put<{
    Params: { tenantId: string };
    Body: { isNonProduction?: boolean; note?: string };
  }>(
    '/api/v1/platform/tenants/:tenantId/non-production',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const { tenantId } = request.params;
      const isNonProduction = request.body?.isNonProduction;

      if (typeof isNonProduction !== 'boolean') {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: 'isNonProduction must be true or false' },
        });
      }

      const existing = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true },
      });
      if (!existing) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Tenant not found' } });
      }

      const tenant = await prisma.tenant.update({
        where: { id: tenantId },
        data: {
          isNonProduction,
          nonProductionNote: isNonProduction ? request.body?.note ?? null : null,
          nonProductionMarkedAt: isNonProduction ? new Date() : null,
          nonProductionMarkedByUserId: isNonProduction ? getActingUserId(request) : null,
        },
        select: {
          id: true,
          name: true,
          isNonProduction: true,
          nonProductionNote: true,
          nonProductionMarkedAt: true,
        },
      });

      await auditLog({
        tenantId,
        userId: getActingUserId(request) ?? undefined,
        action: isNonProduction
          ? 'platform.tenant.marked_non_production'
          : 'platform.tenant.unmarked_non_production',
        entityType: 'tenant',
        entityId: tenantId,
        changes: { isNonProduction, note: request.body?.note ?? null },
      });

      return reply.send({
        data: {
          tenantId: tenant.id,
          name: tenant.name,
          isNonProduction: tenant.isNonProduction,
          nonProductionNote: tenant.nonProductionNote,
          nonProductionMarkedAt: tenant.nonProductionMarkedAt,
          /*
           * Said explicitly, because it is what somebody pressing this might
           * fear: nothing was deleted, suspended or un-enrolled.
           */
          deliveryUnchanged: true,
          billingUnchanged: true,
        },
      });
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
          data: {
            actingTenant: { id: entered.tenantId, name: entered.tenantName },
            enteredAt: entered.enteredAt.toISOString(),
            // Said plainly because it is surprising: this response is not
            // served from inside the agency just entered.
            appliesFrom: 'next-request',
          },
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
   *
   * This also clears any active role preview, because deleting the selection row
   * deletes the `previewRole` on it. That is required rather than incidental: an
   * operator left previewing an agent while inside no agency would be read-only
   * across the whole platform view, and the control that ends a preview is only
   * rendered inside an agency -- there would be nothing on screen to fix it with.
   *
   * Exempt from the read-only hook for the same reason. It is one of the three
   * ways out. See middleware/read-only-preview.ts.
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
        data: {
          actingTenant: null,
          leftTenantId,
          // Said explicitly because the operator may have been previewing: the
          // row carrying the preview is gone with the selection.
          previewRole: null,
          readOnly: false,
          appliesFrom: 'next-request',
        },
      });
    }
  );

  /**
   * POST /api/v1/platform/acting-tenant/preview
   *
   * Preview the entered agency as one of its own roles, or stop previewing.
   *
   * Body: `{ previewRole: 'OWNER' | 'AGENT' | null }`.
   *
   * ── What it changes ─────────────────────────────────────────────────────────
   *
   * While a preview is set the principal carries EXACTLY the previewed role --
   * the operator's own ADMIN and OWNER are replaced, not supplemented -- and
   * every non-GET request is refused 403 PREVIEW_READ_ONLY by the global hook.
   * The replacement is the feature: a merge leaves every role check passing and
   * shows the operator the screen they already had.
   *
   * Refused 409 with no agency selected. Previewing a role outside an agency is
   * meaningless: there is no nav to narrow, no data to narrow it to, and no row
   * to hang the preview on.
   *
   * Takes effect on the NEXT request, exactly as the acting-tenant switch does --
   * the principal for THIS request was built before the row changed -- which is
   * why the response says so and the client reloads.
   *
   * Exempt from the read-only hook: changing or clearing the preview is how an
   * operator gets out of one.
   */
  fastify.post<{ Body: { previewRole?: string | null } }>(
    '/api/v1/platform/acting-tenant/preview',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const userId = getActingUserId(request);
      if (!userId) {
        return reply
          .code(401)
          .send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } });
      }

      const raw = (request.body ?? {}).previewRole ?? null;

      // Null clears the preview. Anything that is neither null nor one of the
      // two previewable roles is refused rather than coerced -- a typo must not
      // quietly leave the operator acting normally when they asked to preview.
      if (raw !== null && !isPreviewRole(raw)) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: `previewRole must be null or one of ${PREVIEW_ROLES.join(', ')}`,
          },
        });
      }

      try {
        const result = await setPreviewRole(userId, raw, {
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
          requestId: request.id,
        });

        return reply.send({
          data: {
            previewRole: result.previewRole,
            readOnly: result.previewRole !== null,
            actingTenant: { id: result.tenantId, name: result.tenantName },
            // Said plainly because it is surprising: this response is not served
            // under the preview it just set.
            appliesFrom: 'next-request',
          },
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
}
