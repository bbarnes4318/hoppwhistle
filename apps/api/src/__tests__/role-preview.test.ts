/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { RoleName } from '@prisma/client';
import { hash } from 'bcryptjs';
import Fastify, { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { grantPlatformAdmin, loadPlatformContext } from '../lib/platform-admin.js';
import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { registerReadOnlyPreview } from '../middleware/read-only-preview.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * Read-only role preview: seeing the product as an agency owner or as an agent.
 *
 * ── What the feature is, and the one way it can be built wrong ───────────────
 *
 * A NetEnroll operator entering an agency carries that agency's ADMIN and OWNER
 * (`ACTING_TENANT_ROLES`). That is right for support work and useless for the
 * question "what does an agent actually see?", because the operator's own
 * administrator roles stay on the principal and the product looks exactly as it
 * did.
 *
 * So a preview REPLACES the principal's roles with exactly the previewed one. A
 * merge — the obvious implementation, and the one three separate call sites
 * already use for the acting-tenant roles — leaves ADMIN and OWNER in place,
 * every role check still passes, and the preview shows the operator the screen
 * they already had. That replacement is asserted here in both the places the
 * frontend can observe it: on the principal, and in `/api/auth/me`, which is
 * what the sidebar, the command palette and every RoleGuard are built from.
 *
 * ── And the read-only guarantee ─────────────────────────────────────────────
 *
 * Every non-GET request is refused 403 PREVIEW_READ_ONLY by a GLOBAL hook, not
 * by per-route guards: this surface has several hundred handlers and gains more
 * every phase, so a guard each would be a promise about the ones somebody
 * remembered. Three endpoints are exempt, because they are the ways out of a
 * preview and refusing them would trap the operator inside one.
 */

const gate = databaseGate();
announceSkip('Role preview: read-only, and the roles actually replaced', gate);

const TEST_JWT_SECRET = 'role-preview-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('Role preview suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `role preview suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('Role preview: read-only, and the roles actually replaced', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;

  /** The agency being previewed, with an owner, an agent and a call. */
  let agency: { id: string; ownerId: string; agentId: string; callId: string };
  /** A NetEnroll operator, with no home tenant and no role rows of their own. */
  let operatorId: string;

  /**
   * The application under test, assembled the way the real server assembles it.
   *
   * `registerReadOnlyPreview` is registered immediately after
   * `registerApiV1Auth`, exactly as `buildServer()` does it, because the ORDER
   * is part of what is being tested: the hook reads a principal the /api/v1 auth
   * hook built in the same lifecycle phase, and registered the other way round
   * it would see nothing and refuse nothing.
   */
  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);
    registerReadOnlyPreview(instance);

    const { registerPlatformRoutes } = await import('../routes/platform.js');
    const { registerApplicationRoutes } = await import('../routes/applications.js');
    const { registerDeliveryBillingRoutes } = await import('../routes/delivery-billing.js');
    const { registerRatingRoutes } = await import('../routes/rating.js');
    const { registerCallRoutes } = await import('../routes/index.js');
    const { registerAuthRoutes } = await import('../routes/auth.js');

    await instance.register(registerPlatformRoutes);
    await instance.register(registerApplicationRoutes);
    await instance.register(registerDeliveryBillingRoutes);
    await instance.register(registerRatingRoutes);
    await instance.register(registerCallRoutes);
    await instance.register(registerAuthRoutes);

    await instance.ready();
    return instance;
  }

  /** A token as login would issue it: who is asking, and nothing more. */
  function tokenFor(userId: string, tenantId: string | null): Record<string, string> {
    return {
      authorization: `Bearer ${app.jwt.sign({ userId, tenantId, email: `${userId}@test.local` })}`,
    };
  }

  async function cleanDatabase() {
    for (const table of [
      'platform_acting_tenants',
      'platform_admins',
      'audit_logs',
      'insurance_carrier_applications',
      'calls',
      'api_keys',
      'user_roles',
      'users',
      'roles',
      'tenants',
    ]) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }
  }

  /** Enter the agency, as the real switcher does: through the endpoint. */
  async function enterAgency() {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/platform/acting-tenant',
      headers: tokenFor(operatorId, null),
      payload: { tenantId: agency.id },
    });
    expect(response.statusCode, 'the operator could not enter the agency').toBe(200);
  }

  /** Set or clear the preview, through the endpoint. Returns the raw response. */
  async function preview(previewRole: string | null) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/platform/acting-tenant/preview',
      headers: tokenFor(operatorId, null),
      payload: { previewRole },
    });
  }

  async function auditRows(action: string) {
    return prisma.auditLog.findMany({ where: { action }, orderBy: { createdAt: 'asc' } });
  }

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    delete process.env.ALLOW_DEMO_TENANT_AUTH;
    prisma = getPrismaClient();
    await cleanDatabase();

    const roleIds: Record<string, string> = {};
    for (const name of [RoleName.OWNER, RoleName.ADMIN, RoleName.AGENT]) {
      const role = await prisma.role.create({
        data: { name, description: `${name} role`, permissions: ['admin:*'] },
      });
      roleIds[name] = role.id;
    }

    const slug = `preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tenant = await prisma.tenant.create({
      data: { name: 'Ridgeline Insurance', slug, status: 'ACTIVE' },
    });
    const owner = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `principal@${slug}.local`,
        passwordHash: await hash('password123', 10),
        status: 'ACTIVE',
        roles: { create: { roleId: roleIds[RoleName.OWNER] } },
      },
    });
    const agent = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `agent@${slug}.local`,
        passwordHash: await hash('password123', 10),
        status: 'ACTIVE',
        roles: { create: { roleId: roleIds[RoleName.AGENT] } },
      },
    });
    const call = await prisma.call.create({
      data: {
        tenantId: tenant.id,
        callSid: `sid-${slug}`,
        toNumber: '+15550000000',
        status: 'COMPLETED',
        direction: 'INBOUND',
      },
    });
    agency = { id: tenant.id, ownerId: owner.id, agentId: agent.id, callId: call.id };

    // NetEnroll staff: no tenant of their own and no role rows. The capability is
    // the only thing they hold, which is what makes the replacement observable —
    // if the preview merged, the roles would come back as the agency's ADMIN and
    // OWNER from ACTING_TENANT_ROLES.
    const operator = await prisma.user.create({
      data: { email: `operator-${slug}@netenroll.test`, status: 'ACTIVE', tenantId: null },
    });
    operatorId = operator.id;
    await grantPlatformAdmin(operatorId, { note: 'role preview suite fixture' });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 1. The replacement. This is the feature; a merge here is the whole bug.
  // ══════════════════════════════════════════════════════════════════════════
  describe('previewing OWNER narrows the principal to exactly ["OWNER"]', () => {
    it('on the principal the middleware builds', async () => {
      await enterAgency();
      expect((await preview('OWNER')).statusCode).toBe(200);

      const context = await loadPlatformContext(operatorId);

      expect(context.previewRole).toBe('OWNER');
      // Exactly one role. Not "includes OWNER" -- the bug being pinned is ADMIN
      // surviving alongside it.
      expect(context.actingRoles).toEqual(['OWNER']);
      expect(context.actingTenantId).toBe(agency.id);
    });

    it('and in /api/auth/me, which is what the frontend nav is built from', async () => {
      await enterAgency();
      await preview('OWNER');

      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: tokenFor(operatorId, null),
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();

      /*
       * The reason this assertion exists separately from the one above.
       *
       * /api/auth/me used to read `roles` and `tenantId` straight off the
       * database row and ignore `request.user` entirely. A preview that only
       * changed the principal therefore changed nothing the operator could see:
       * the sidebar, the palette and every RoleGuard are built from THIS
       * response, so the preview became visible only when a write was refused.
       */
      expect(body.roles).toEqual(['OWNER']);
      expect(body.previewRole).toBe('OWNER');
      expect(body.isReadOnlyPreview).toBe(true);
      expect(body.isPlatformAdmin).toBe(true);
      // The same endpoint's other defect: it answered with the operator's own
      // tenant (null) rather than the agency they had entered.
      expect(body.tenantId).toBe(agency.id);
      expect(body.actingTenantId).toBe(agency.id);
    });

    it('previewing AGENT narrows it to exactly ["AGENT"]', async () => {
      await enterAgency();
      await preview('AGENT');

      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: tokenFor(operatorId, null),
      });

      expect(response.json().roles).toEqual(['AGENT']);
    });

    it('and with no preview the operator still carries the agency’s ADMIN and OWNER', async () => {
      await enterAgency();

      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: tokenFor(operatorId, null),
      });

      // The control case. Without it, a preview that simply broke the
      // acting-tenant roles would pass every assertion above.
      expect(response.json().roles.sort()).toEqual(['ADMIN', 'OWNER']);
      expect(response.json().isReadOnlyPreview).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2. Read-only, by default, on routes that never opted in
  // ══════════════════════════════════════════════════════════════════════════
  describe('a preview refuses every write', () => {
    /**
     * Three writes on three different plugins, none of which knows the preview
     * exists. That is the point: the guarantee is a global hook, so a route's
     * author does not have to remember it.
     */
    const WRITES: Array<[string, Record<string, unknown>]> = [
      ['/api/v1/applications', { carrier: 'AMERIQUOTE', applicantFirstName: 'Dana' }],
      ['/api/v1/calls/disposition', { callSid: 'sid-anything', disposition: 'VERIFIED' }],
      ['/api/v1/delivery/mandate/setup-intent', {}],
    ];

    it.each(WRITES)('POST %s is refused 403 PREVIEW_READ_ONLY', async (url, payload) => {
      await enterAgency();
      await preview('AGENT');

      const response = await app.inject({
        method: 'POST',
        url,
        headers: tokenFor(operatorId, null),
        payload,
      });

      expect(response.statusCode, `${url} was not refused`).toBe(403);
      expect(response.json().error.code).toBe('PREVIEW_READ_ONLY');
    });

    it('but a GET is served', async () => {
      await enterAgency();
      await preview('AGENT');

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/platform/context',
        headers: tokenFor(operatorId, null),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.previewRole).toBe('AGENT');
      expect(response.json().data.readOnly).toBe(true);
    });

    it('and the same writes succeed or fail on their own merits without a preview', async () => {
      await enterAgency();

      // Not asserting 200 -- these need bodies, Stripe and a billing profile the
      // fixture has none of. Asserting only that the refusal is NOT the preview
      // hook, which would pass vacuously if the hook refused everyone.
      for (const [url, payload] of WRITES) {
        const response = await app.inject({
          method: 'POST',
          url,
          headers: tokenFor(operatorId, null),
          payload,
        });
        expect(response.json()?.error?.code, `${url} was refused as a preview`).not.toBe(
          'PREVIEW_READ_ONLY'
        );
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2b. The agency money routes are the principal's, and a preview proves it
  // ══════════════════════════════════════════════════════════════════════════
  describe("an agent cannot read the agency's money", () => {
    /**
     * These are GETs, so the read-only hook has nothing to say about them. What
     * refuses them is `requireAgencyPrincipal`, and previewing as AGENT is the
     * cleanest way to assert it: the caller is the same person, in the same
     * agency, on the same token, with only their role narrowed.
     *
     * Every one of these was `preHandler: [authenticate]` and nothing else —
     * readable by any AGENT holding a token in the tenant.
     */
    const PRINCIPAL_ONLY = [
      '/api/v1/delivery/today',
      '/api/v1/delivery/settlements',
      '/api/v1/delivery/ledger',
      '/api/v1/delivery/mandate',
      '/api/v1/rating/summary',
      '/api/v1/rating/curve',
      '/api/v1/rating/history',
    ];

    it.each(PRINCIPAL_ONLY)('GET %s is refused 403 while previewing as AGENT', async url => {
      await enterAgency();
      await preview('AGENT');

      const response = await app.inject({
        method: 'GET',
        url,
        headers: tokenFor(operatorId, null),
      });

      expect(response.statusCode, `${url} served an agent the agency's money`).toBe(403);
    });

    it.each(PRINCIPAL_ONLY)('GET %s is refused 403 for a real agency AGENT too', async url => {
      // The preview is a convenience for asserting this, not the mechanism. An
      // actual agent of the agency, with an actual AGENT role row, is refused
      // identically — which is the defect being closed.
      const response = await app.inject({
        method: 'GET',
        url,
        headers: tokenFor(agency.agentId, agency.id),
      });

      expect(response.statusCode, `${url} served a real agent the agency's money`).toBe(403);
    });

    it("but GET /api/v1/delivery/me is the agent's own and stays open", async () => {
      // The one money-shaped route an agent has. It loads no rate, balance,
      // overrun or charge, and gating it would take away the only view of their
      // own closing percentage they have.
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/delivery/me',
        headers: tokenFor(agency.agentId, agency.id),
      });

      expect(response.statusCode, '/delivery/me was refused to an agent').toBe(200);
    });

    it('and the agency OWNER still reads all of them', async () => {
      for (const url of PRINCIPAL_ONLY) {
        const response = await app.inject({
          method: 'GET',
          url,
          headers: tokenFor(agency.ownerId, agency.id),
        });
        expect(response.statusCode, `${url} refused the agency OWNER`).not.toBe(403);
      }
    });

    it('and a platform operator with no agency still gets 409, not 403', async () => {
      /*
       * The refusal a client can act on. An operator who has simply not picked
       * an agency holds no roles at all in the cross-agency view, so a plain
       * role check would answer 403 "this is the principal's view" — a dead end.
       * 409 NO_ACTING_TENANT is what the web app reads to offer the picker.
       */
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/delivery/today',
        headers: tokenFor(operatorId, null),
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('NO_ACTING_TENANT');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 3. The ways out. A preview the operator cannot leave is a lockout.
  // ══════════════════════════════════════════════════════════════════════════
  describe('the operator can always get out', () => {
    it('DELETE /api/v1/platform/acting-tenant still works while previewing', async () => {
      await enterAgency();
      await preview('AGENT');

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/platform/acting-tenant',
        headers: tokenFor(operatorId, null),
      });

      expect(response.statusCode, 'the operator was trapped inside the preview').toBe(200);
      expect(response.json().data.actingTenant).toBeNull();
    });

    it('and leaving the agency clears previewRole', async () => {
      await enterAgency();
      await preview('AGENT');

      await app.inject({
        method: 'DELETE',
        url: '/api/v1/platform/acting-tenant',
        headers: tokenFor(operatorId, null),
      });

      /*
       * Both halves matter. The row is gone, so there is nothing left carrying
       * the preview -- and the principal is no longer read-only, which is the
       * consequence: an operator left previewing an agent while inside no agency
       * would be refused every write across the platform view, with no control
       * on screen to undo it (the preview switcher renders only inside an
       * agency).
       */
      expect(await prisma.platformActingTenant.findUnique({ where: { userId: operatorId } })).toBe(
        null
      );

      const context = await loadPlatformContext(operatorId);
      expect(context.previewRole).toBeNull();
      expect(context.actingTenantId).toBeNull();
    });

    it('POST to the preview endpoint itself still works while previewing', async () => {
      await enterAgency();
      await preview('AGENT');

      // Clearing the preview is a POST, and the hook refuses POSTs. Without the
      // exemption the only way out would be to leave the agency entirely.
      const response = await preview(null);

      expect(response.statusCode).toBe(200);
      expect(response.json().data.previewRole).toBeNull();
      expect(response.json().data.readOnly).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 4. The endpoint's own refusals
  // ══════════════════════════════════════════════════════════════════════════
  describe('POST /api/v1/platform/acting-tenant/preview', () => {
    it('is refused 409 with no agency selected', async () => {
      // Deliberately no enterAgency(). Previewing a role outside an agency has
      // no nav to narrow, no data to narrow it to, and no row to live on.
      const response = await preview('OWNER');

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('NO_ACTING_TENANT');
      expect(response.json().error.message).toMatch(/enter an agency/i);
    });

    it('is refused 403 for a user who is not platform staff', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/platform/acting-tenant/preview',
        headers: tokenFor(agency.ownerId, agency.id),
        payload: { previewRole: 'AGENT' },
      });

      // An agency OWNER holds the roles a preview hands out. The capability is
      // what is being checked, not the roles.
      expect(response.statusCode).toBe(403);
    });

    it('is refused 401 for an anonymous caller', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/platform/acting-tenant/preview',
        payload: { previewRole: 'AGENT' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('refuses a role that is not previewable rather than coercing it', async () => {
      await enterAgency();

      const response = await preview('PUBLISHER');

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');

      // And nothing was written: a typo must not quietly leave the operator
      // acting normally when they asked to preview.
      expect((await loadPlatformContext(operatorId)).previewRole).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 5. The audit trail. Cross-agency access that leaves no trace is a breach.
  // ══════════════════════════════════════════════════════════════════════════
  describe('entering and leaving a preview are each recorded once', () => {
    it('writes one platform.preview.entered row and one platform.preview.left row', async () => {
      await enterAgency();

      await preview('AGENT');
      const entered = await auditRows('platform.preview.entered');
      expect(entered).toHaveLength(1);
      expect(entered[0].userId).toBe(operatorId);
      expect(entered[0].tenantId).toBe(agency.id);
      expect((entered[0].changes as any)?.previewRole).toBe('AGENT');

      await preview(null);
      const left = await auditRows('platform.preview.left');
      expect(left).toHaveLength(1);
      expect(left[0].userId).toBe(operatorId);
      expect(left[0].tenantId).toBe(agency.id);

      // And the entered row was not written twice by the leave.
      expect(await auditRows('platform.preview.entered')).toHaveLength(1);
    });
  });
});
