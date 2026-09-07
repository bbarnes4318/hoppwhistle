/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { RoleName } from '@prisma/client';
import { hash } from 'bcryptjs';
import Fastify, { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { grantPlatformAdmin } from '../lib/platform-admin.js';
import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * NetEnroll platform staff, and the agency they are currently inside.
 *
 * ── What this suite is for ──────────────────────────────────────────────────
 *
 * Phase 1 established that the acting tenant comes from `request.user` and
 * nothing else. That is right for agency users and leaves NetEnroll's own staff
 * with nowhere to stand: they need to see across every agency, and the roles
 * available (OWNER, ADMIN) are granted per-tenant. Gating a platform-wide route
 * on OWNER admits the principal of every agency on the platform -- not yet
 * exploitable only because the only OWNER accounts today are NetEnroll's own.
 *
 * So there is now a capability outside the tenant dimension, and an explicit,
 * audited switch for entering one agency. The four properties that make that
 * safe rather than merely convenient are the four things asserted here:
 *
 *   1. An agency OWNER cannot reach a re-gated platform route. This is the one
 *      that stops being hypothetical in Phase 5.
 *   2. A platform admin with no agency selected cannot read agency-scoped data.
 *      "No tenant" is not a wildcard; it is a refusal.
 *   3. Entering and leaving each write exactly one AuditLog row, naming the
 *      operator and the agency. Cross-agency access that leaves no trace is
 *      indistinguishable from a breach.
 *   4. The selection cannot be made or changed from a header, query parameter
 *      or request body. This is the Phase 1 rule, applied to the accounts with
 *      the most access rather than exempting them from it.
 */

const gate = databaseGate();
announceSkip('Platform admin: capability and acting-tenant switch', gate);

const TEST_JWT_SECRET = 'platform-admin-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('Platform admin suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `platform admin suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('Platform admin: capability and acting-tenant switch', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;

  /** Agency A, a paying customer with an OWNER and some data. */
  let tenantA: { id: string; ownerId: string; callId: string };
  /** Agency B, so "sees everything" and "sees A" stay distinguishable. */
  let tenantB: { id: string; ownerId: string; callId: string };
  /** A NetEnroll operator, with no home tenant at all. */
  let operatorId: string;
  /** An ordinary user who is not staff, for the negative capability case. */
  let plainUserId: string;

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);

    const { registerCallRoutes, registerAdminTenantRoutes } = await import('../routes/index.js');
    const { registerPlatformRoutes } = await import('../routes/platform.js');
    const { registerQuotaRoutes } = await import('../routes/quotas.js');
    const { registerBotRoutes } = await import('../routes/bot.js');

    await instance.register(registerCallRoutes);
    await instance.register(registerPlatformRoutes);
    await instance.register(registerQuotaRoutes);
    await instance.register(registerBotRoutes);
    await instance.register(registerAdminTenantRoutes);

    await instance.ready();
    return instance;
  }

  /**
   * A token as login would issue it.
   *
   * `tenantId` is whatever the user's own row says -- for the operator, null.
   * That matters: the switch must not be reachable by minting a token that
   * names an agency, so the tests hand the operator exactly the token the real
   * login flow would.
   */
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
      'tenant_activation_grants',
      'api_keys',
      'user_roles',
      'users',
      'roles',
      'tenants',
    ]) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }
  }

  async function seedAgency(label: string, ownerRoleId: string) {
    const slug = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tenant = await prisma.tenant.create({
      data: { name: `${label} Insurance`, slug, status: 'ACTIVE' },
    });
    const owner = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `principal@${slug}.local`,
        passwordHash: await hash('password123', 10),
        status: 'ACTIVE',
        roles: { create: { roleId: ownerRoleId } },
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
    return { id: tenant.id, ownerId: owner.id, callId: call.id };
  }

  /** Every id-shaped string anywhere in a response body. */
  function idsIn(body: unknown): string[] {
    const found: string[] = [];
    const walk = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
          if (typeof value === 'string' && (key === 'id' || key.endsWith('Id'))) found.push(value);
          else walk(value);
        }
      }
    };
    walk(body);
    return found;
  }

  async function switchAuditRows(action: string) {
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
    for (const name of [RoleName.OWNER, RoleName.ADMIN, RoleName.AGENT, RoleName.READONLY]) {
      const role = await prisma.role.create({
        data: { name, description: `${name} role`, permissions: ['admin:*'] },
      });
      roleIds[name] = role.id;
    }

    tenantA = await seedAgency('Alpha', roleIds[RoleName.OWNER]);
    tenantB = await seedAgency('Bravo', roleIds[RoleName.OWNER]);

    // NetEnroll staff: no tenant of their own, and no role rows. The capability
    // is the only thing they hold.
    const operator = await prisma.user.create({
      data: { email: 'operator@netenroll.test', status: 'ACTIVE', tenantId: null },
    });
    operatorId = operator.id;
    await grantPlatformAdmin(operatorId, { note: 'suite fixture' });

    // An ordinary agency user who is NOT staff, to prove the capability is what
    // is being checked rather than merely "is authenticated".
    const plain = await prisma.user.create({
      data: {
        tenantId: tenantA.id,
        email: 'agent@alpha.test',
        status: 'ACTIVE',
        roles: { create: { roleId: roleIds[RoleName.AGENT] } },
      },
    });
    plainUserId = plain.id;
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 1. An agency OWNER cannot reach a platform route
  // ══════════════════════════════════════════════════════════════════════════
  describe('an agency OWNER is refused every re-gated platform route', () => {
    /**
     * The routes moved onto the capability in this phase. Each was previously
     * reachable by any ADMIN/OWNER, or in three cases by anyone at all.
     */
    const PLATFORM_ROUTES: Array<[string, string]> = [
      // The shared dialer: one process, one lead file, one recordings directory,
      // no tenant dimension anywhere in it.
      ['GET', '/api/bot/status'],
      ['GET', '/api/bot/leads'],
      ['GET', '/api/bot/settings'],
      // Another agency's quota and spend ceilings.
      ['GET', '/api/v1/platform/tenants'],
    ];

    it.each(PLATFORM_ROUTES)('%s %s', async (method, url) => {
      const response = await app.inject({
        method: method as 'GET',
        url,
        headers: tokenFor(tenantA.ownerId, tenantA.id),
      });

      expect(
        response.statusCode,
        `${method} ${url} let an agency OWNER through`
      ).toBe(403);
    });

    it("refuses an agency OWNER another agency's quota", async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/admin/api/v1/tenants/${tenantB.id}/quota`,
        headers: tokenFor(tenantA.ownerId, tenantA.id),
      });

      expect(response.statusCode).toBe(403);
    });

    it("refuses an agency OWNER their OWN agency's quota, because quotas are not theirs to see", async () => {
      // Worth pinning separately: the point is not "wrong tenant" but "not a
      // platform operation". An agency does not administer its own ceilings.
      const response = await app.inject({
        method: 'GET',
        url: `/admin/api/v1/tenants/${tenantA.id}/quota`,
        headers: tokenFor(tenantA.ownerId, tenantA.id),
      });

      expect(response.statusCode).toBe(403);
    });

    it('refuses an ordinary agency user', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/bot/status',
        headers: tokenFor(plainUserId, tenantA.id),
      });
      expect(response.statusCode).toBe(403);
    });

    it('refuses an anonymous caller with 401 rather than 403', async () => {
      // The two failures stay distinguishable: 401 means "say who you are",
      // 403 means "you are not NetEnroll".
      const response = await app.inject({ method: 'GET', url: '/api/bot/status' });
      expect(response.statusCode).toBe(401);
    });

    it('admits the platform operator', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/platform/tenants',
        headers: tokenFor(operatorId, null),
      });

      expect(response.statusCode).toBe(200);
      const ids = idsIn(response.json());
      expect(ids).toContain(tenantA.id);
      expect(ids).toContain(tenantB.id);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2. No acting tenant is a refusal, not a wildcard
  // ══════════════════════════════════════════════════════════════════════════
  describe('a platform admin with no agency selected reads no agency data', () => {
    it('is refused an agency-scoped route', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/calls',
        headers: tokenFor(operatorId, null),
      });

      expect(
        response.statusCode,
        'the cross-agency view was treated as a wildcard over agency data'
      ).toBe(401);
    });

    it('cannot smuggle a tenant in through the token it was issued', async () => {
      // The token is the one input a client fully controls the contents of, via
      // whatever it was issued at login. For staff the PlatformActingTenant row
      // replaces it outright, so a token naming agency A gets nothing.
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/calls',
        headers: tokenFor(operatorId, tenantA.id),
      });

      expect(response.statusCode).toBe(401);
    });

    it('reports itself as staff with no agency', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/platform/context',
        headers: tokenFor(operatorId, null),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ isPlatformAdmin: true, actingTenant: null });
    });

    it('reads exactly one agency once it has entered one', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/v1/platform/acting-tenant',
        headers: tokenFor(operatorId, null),
        payload: { tenantId: tenantA.id },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/calls',
        headers: tokenFor(operatorId, null),
      });

      expect(response.statusCode).toBe(200);
      const ids = idsIn(response.json());
      expect(ids, "the entered agency's calls should be visible").toContain(tenantA.callId);
      expect(ids, 'entering one agency must not reveal another').not.toContain(tenantB.callId);
    });

    it('stops reading that agency once it leaves', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/v1/platform/acting-tenant',
        headers: tokenFor(operatorId, null),
        payload: { tenantId: tenantA.id },
      });
      await app.inject({
        method: 'DELETE',
        url: '/api/v1/platform/acting-tenant',
        headers: tokenFor(operatorId, null),
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/calls',
        headers: tokenFor(operatorId, null),
      });

      expect(response.statusCode).toBe(401);
    });

    it('surfaces the entered agency in the context the UI banner reads', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/v1/platform/acting-tenant',
        headers: tokenFor(operatorId, null),
        payload: { tenantId: tenantA.id },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/platform/context',
        headers: tokenFor(operatorId, null),
      });

      // Name as well as id: the banner has to be readable by a person who is
      // about to mistake one agency's numbers for the platform's.
      expect(response.json()).toMatchObject({
        isPlatformAdmin: true,
        actingTenant: { id: tenantA.id, name: 'Alpha Insurance' },
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 3. Entering and leaving are each recorded exactly once
  // ══════════════════════════════════════════════════════════════════════════
  describe('the switch writes exactly one audit row each way', () => {
    it('records entering, with the operator and the agency', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/platform/acting-tenant',
        headers: tokenFor(operatorId, null),
        payload: { tenantId: tenantA.id },
      });
      expect(response.statusCode).toBe(200);

      const entered = await switchAuditRows('platform.tenant.entered');
      expect(entered).toHaveLength(1);
      expect(entered[0].userId).toBe(operatorId);
      expect(entered[0].tenantId).toBe(tenantA.id);
      expect(entered[0].entityId).toBe(tenantA.id);
      expect(entered[0].createdAt).toBeInstanceOf(Date);
    });

    it('records leaving', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/v1/platform/acting-tenant',
        headers: tokenFor(operatorId, null),
        payload: { tenantId: tenantA.id },
      });
      await app.inject({
        method: 'DELETE',
        url: '/api/v1/platform/acting-tenant',
        headers: tokenFor(operatorId, null),
      });

      const left = await switchAuditRows('platform.tenant.left');
      expect(left).toHaveLength(1);
      expect(left[0].userId).toBe(operatorId);
      expect(left[0].tenantId).toBe(tenantA.id);
    });

    it('does not record a second leaving when there was nothing to leave', async () => {
      // A "left" with no matching "entered" is a lie about what happened, and
      // an audit trail that contains lies is worse than one that is sparse.
      await app.inject({
        method: 'DELETE',
        url: '/api/v1/platform/acting-tenant',
        headers: tokenFor(operatorId, null),
      });

      expect(await switchAuditRows('platform.tenant.left')).toHaveLength(0);
    });

    it('records a move between agencies as a leave and an enter', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/v1/platform/acting-tenant',
        headers: tokenFor(operatorId, null),
        payload: { tenantId: tenantA.id },
      });
      await app.inject({
        method: 'POST',
        url: '/api/v1/platform/acting-tenant',
        headers: tokenFor(operatorId, null),
        payload: { tenantId: tenantB.id },
      });

      const entered = await switchAuditRows('platform.tenant.entered');
      const left = await switchAuditRows('platform.tenant.left');

      expect(entered.map(r => r.tenantId)).toEqual([tenantA.id, tenantB.id]);
      expect(left.map(r => r.tenantId)).toEqual([tenantA.id]);

      // And the operator is in exactly one agency, not two.
      const selections = await prisma.platformActingTenant.findMany({
        where: { userId: operatorId },
      });
      expect(selections).toHaveLength(1);
      expect(selections[0].tenantId).toBe(tenantB.id);
    });

    it('writes no audit row when a non-operator attempts the switch', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/platform/acting-tenant',
        headers: tokenFor(tenantA.ownerId, tenantA.id),
        payload: { tenantId: tenantB.id },
      });

      expect(response.statusCode).toBe(403);
      expect(await switchAuditRows('platform.tenant.entered')).toHaveLength(0);
      expect(
        await prisma.platformActingTenant.findMany({ where: { userId: tenantA.ownerId } })
      ).toHaveLength(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 4. The selection is server-side state, and only that
  // ══════════════════════════════════════════════════════════════════════════
  describe('the acting tenant cannot be set from the wire', () => {
    /**
     * The Phase 1 rule, applied to the accounts with the most access.
     *
     * Each case sends a request that names agency A by some wire mechanism and
     * asserts it is not served as agency A. The operator has no agency selected
     * throughout, so "not served as A" reads as a 401 -- the cross-agency view
     * refusing an agency-scoped route.
     */
    it('ignores an X-Demo-Tenant-Id header', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/calls',
        headers: { ...tokenFor(operatorId, null), 'x-demo-tenant-id': tenantA.id },
      });
      expect(response.statusCode).toBe(401);
    });

    it('ignores an X-Acting-Tenant-Id header, in case one is ever invented', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/calls',
        headers: {
          ...tokenFor(operatorId, null),
          'x-acting-tenant-id': tenantA.id,
          'x-tenant-id': tenantA.id,
        },
      });
      expect(response.statusCode).toBe(401);
    });

    it('ignores a query parameter', async () => {
      for (const qs of [
        `?tenantId=${tenantA.id}`,
        `?actingTenantId=${tenantA.id}`,
        `?demoTenantId=${tenantA.id}`,
      ]) {
        const response = await app.inject({
          method: 'GET',
          url: `/api/v1/calls${qs}`,
          headers: tokenFor(operatorId, null),
        });
        expect(response.statusCode, `${qs} selected an agency`).toBe(401);
      }
    });

    it('ignores a request body', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/calls',
        headers: tokenFor(operatorId, null),
        payload: { tenantId: tenantA.id, actingTenantId: tenantA.id },
      });
      expect([400, 401]).toContain(response.statusCode);

      // Whatever the route made of that body, it did not become a selection.
      expect(
        await prisma.platformActingTenant.findMany({ where: { userId: operatorId } })
      ).toHaveLength(0);
    });

    it('does not act inside the agency on the very request that enters it', async () => {
      // The switch writes server-side state for LATER requests. The middleware
      // that builds `request.user` has already run by the time the row exists,
      // so the body of this POST is not a tenant input in the Phase 1 sense --
      // nothing in this response is served according to the agency it names.
      const enter = await app.inject({
        method: 'POST',
        url: '/api/v1/platform/acting-tenant',
        headers: tokenFor(operatorId, null),
        payload: { tenantId: tenantA.id },
      });

      expect(enter.statusCode).toBe(200);
      expect(enter.json().appliesFrom).toBe('next-request');
    });

    it('refuses to enter an agency that does not exist', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/platform/acting-tenant',
        headers: tokenFor(operatorId, null),
        payload: { tenantId: '00000000-0000-0000-0000-000000000000' },
      });

      expect(response.statusCode).toBe(404);
      expect(await switchAuditRows('platform.tenant.entered')).toHaveLength(0);
    });

    it('drops a selection into an agency that is later suspended', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/v1/platform/acting-tenant',
        headers: tokenFor(operatorId, null),
        payload: { tenantId: tenantA.id },
      });

      await prisma.tenant.update({
        where: { id: tenantA.id },
        data: { status: 'SUSPENDED' },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/platform/context',
        headers: tokenFor(operatorId, null),
      });

      expect(response.json()).toMatchObject({ isPlatformAdmin: true, actingTenant: null });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 5. The capability itself
  // ══════════════════════════════════════════════════════════════════════════
  describe('the capability lives outside the tenant dimension', () => {
    it('is not conferred by any role, including OWNER', async () => {
      // The agency owners in this fixture hold OWNER with `admin:*` permissions
      // in their own tenant. Neither makes them NetEnroll.
      for (const agency of [tenantA, tenantB]) {
        const response = await app.inject({
          method: 'GET',
          url: '/api/v1/platform/context',
          headers: tokenFor(agency.ownerId, agency.id),
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().isPlatformAdmin).toBe(false);
      }
    });

    it('survives the operator having no tenant at all', async () => {
      const operator = await prisma.user.findUnique({ where: { id: operatorId } });
      expect(operator?.tenantId).toBeNull();

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/platform/tenants',
        headers: tokenFor(operatorId, null),
      });
      expect(response.statusCode).toBe(200);
    });

    it('is revoked by deleting the row, dropping any agency they were inside', async () => {
      await app.inject({
        method: 'POST',
        url: '/api/v1/platform/acting-tenant',
        headers: tokenFor(operatorId, null),
        payload: { tenantId: tenantA.id },
      });

      const { revokePlatformAdmin } = await import('../lib/platform-admin.js');
      await revokePlatformAdmin(operatorId);

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/platform/tenants',
        headers: tokenFor(operatorId, null),
      });
      expect(response.statusCode).toBe(403);

      expect(
        await prisma.platformActingTenant.findMany({ where: { userId: operatorId } })
      ).toHaveLength(0);
    });

    it('granting twice does not create a second grant', async () => {
      const again = await grantPlatformAdmin(operatorId);
      expect(again.created).toBe(false);
      expect(await prisma.platformAdmin.count({ where: { userId: operatorId } })).toBe(1);
    });
  });
});
