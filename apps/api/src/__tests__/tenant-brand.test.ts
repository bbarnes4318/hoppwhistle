/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { RoleName } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { grantPlatformAdmin } from '../lib/platform-admin.js';
import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { registerReadOnlyPreview } from '../middleware/read-only-preview.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * White-label brand: who is told which brand, and who may set one.
 *
 * ── What this pins ───────────────────────────────────────────────────────────
 *
 * A brand is the most visible thing a portal shows. The failure that matters
 * is one agency's people being shown another agency's logo, so the brand is
 * resolved on the server from the authenticated principal -- never from
 * anything the browser sends -- and these cases drive `/api/auth/me` as each
 * kind of principal to prove it:
 *
 *   an agency user           their own tenant's brand
 *   an operator inside X     X's brand
 *   an operator, no agency   none
 *   a user of A              never B's, whatever they put on the wire
 *
 * And the write side: only NetEnroll staff may set a brand, an agency's own
 * OWNER and ADMIN are refused, an unknown theme is refused rather than stored,
 * and every change leaves an audit row.
 */

const gate = databaseGate();
announceSkip('Tenant brand theme', gate);

const TEST_JWT_SECRET = 'tenant-brand-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('Tenant brand suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `tenant brand suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('Tenant brand theme', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;

  /** Branded as Life Leads Plus. */
  let agencyA: { id: string; ownerId: string; adminId: string; agentId: string };
  /** Not branded. */
  let agencyB: { id: string; ownerId: string };
  /** NetEnroll staff, with no home tenant. */
  let operatorId: string;

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);
    registerReadOnlyPreview(instance);

    const { registerPlatformRoutes } = await import('../routes/platform.js');
    const { registerAuthRoutes } = await import('../routes/auth.js');
    await instance.register(registerPlatformRoutes);
    await instance.register(registerAuthRoutes);

    await instance.ready();
    return instance;
  }

  function tokenFor(userId: string, tenantId: string | null): Record<string, string> {
    return {
      authorization: `Bearer ${app.jwt.sign({ userId, tenantId, email: `${userId}@test.local` })}`,
    };
  }

  function me(userId: string, tenantId: string | null, url = '/api/auth/me') {
    return app.inject({ method: 'GET', url, headers: tokenFor(userId, tenantId) });
  }

  function setBrand(userId: string, tenantId: string | null, target: string, payload: unknown) {
    return app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/tenants/${target}/branding`,
      headers: tokenFor(userId, tenantId),
      payload: payload as Record<string, unknown>,
    });
  }

  async function enter(tenantId: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/platform/acting-tenant',
      headers: tokenFor(operatorId, null),
      payload: { tenantId },
    });
    expect(response.statusCode, 'the operator could not enter the agency').toBe(200);
  }

  async function cleanDatabase() {
    for (const table of [
      'platform_acting_tenants',
      'platform_admins',
      'audit_logs',
      'user_roles',
      'users',
      'roles',
      'tenants',
    ]) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }
  }

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    prisma = getPrismaClient();
    await cleanDatabase();

    const roleIds: Record<string, string> = {};
    for (const name of [RoleName.OWNER, RoleName.ADMIN, RoleName.AGENT]) {
      const role = await prisma.role.create({
        data: { name, description: `${name} role`, permissions: [] },
      });
      roleIds[name] = role.id;
    }

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    async function user(tenantId: string, role: RoleName, label: string) {
      const row = await prisma.user.create({
        data: {
          tenantId,
          email: `${label}-${stamp}@agency.local`,
          status: 'ACTIVE',
          roles: { create: { roleId: roleIds[role] } },
        },
      });
      return row.id;
    }

    const a = await prisma.tenant.create({
      data: {
        name: 'Life Leads Plus LLC',
        slug: `llp-${stamp}`,
        status: 'ACTIVE',
        brandTheme: 'life-leads-plus',
        brandName: 'Life Leads Plus',
      },
    });
    agencyA = {
      id: a.id,
      ownerId: await user(a.id, RoleName.OWNER, 'a-owner'),
      adminId: await user(a.id, RoleName.ADMIN, 'a-admin'),
      agentId: await user(a.id, RoleName.AGENT, 'a-agent'),
    };

    const b = await prisma.tenant.create({
      data: { name: 'Ridgeline Insurance', slug: `ridge-${stamp}`, status: 'ACTIVE' },
    });
    agencyB = { id: b.id, ownerId: await user(b.id, RoleName.OWNER, 'b-owner') };

    const operator = await prisma.user.create({
      data: { email: `operator-${stamp}@netenroll.test`, status: 'ACTIVE', tenantId: null },
    });
    operatorId = operator.id;
    await grantPlatformAdmin(operatorId, { note: 'tenant brand suite fixture' });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // /api/auth/me
  // ══════════════════════════════════════════════════════════════════════════
  describe('/api/auth/me', () => {
    it.each(['ownerId', 'adminId', 'agentId'] as const)(
      "gives an agency user (%s) their own tenant's brand",
      async who => {
        const response = await me(agencyA[who], agencyA.id);
        expect(response.statusCode).toBe(200);
        expect(response.json().brand).toEqual({
          theme: 'life-leads-plus',
          name: 'Life Leads Plus',
        });
      }
    );

    it('gives an unbranded agency no brand', async () => {
      const response = await me(agencyB.ownerId, agencyB.id);
      expect(response.statusCode).toBe(200);
      expect(response.json().brand).toBeNull();
    });

    it("gives a platform admin inside an agency that agency's brand", async () => {
      await enter(agencyA.id);
      const response = await me(operatorId, null);
      expect(response.statusCode).toBe(200);
      expect(response.json().brand).toEqual({
        theme: 'life-leads-plus',
        name: 'Life Leads Plus',
      });
    });

    it('keeps it in the read-only role preview', async () => {
      await enter(agencyA.id);
      const previewed = await app.inject({
        method: 'POST',
        url: '/api/v1/platform/acting-tenant/preview',
        headers: tokenFor(operatorId, null),
        payload: { previewRole: 'AGENT' },
      });
      expect(previewed.statusCode).toBe(200);

      expect((await me(operatorId, null)).json().brand?.theme).toBe('life-leads-plus');
    });

    it('follows the operator to an unbranded agency, and back out to none', async () => {
      await enter(agencyA.id);
      expect((await me(operatorId, null)).json().brand?.theme).toBe('life-leads-plus');

      await enter(agencyB.id);
      expect((await me(operatorId, null)).json().brand).toBeNull();

      await enter(agencyA.id);
      const left = await app.inject({
        method: 'DELETE',
        url: '/api/v1/platform/acting-tenant',
        headers: tokenFor(operatorId, null),
      });
      expect(left.statusCode).toBe(200);
      expect((await me(operatorId, null)).json().brand).toBeNull();
    });

    it('gives a platform admin with no acting tenant no brand', async () => {
      const response = await me(operatorId, null);
      expect(response.statusCode).toBe(200);
      expect(response.json().brand).toBeNull();
    });

    it("never gives a user of one agency another agency's brand", async () => {
      // B's owner, asking every way the wire could plausibly name A.
      const attempts = [
        me(agencyB.ownerId, agencyB.id),
        me(agencyB.ownerId, agencyB.id, `/api/auth/me?tenantId=${agencyA.id}`),
        me(agencyB.ownerId, agencyB.id, `/api/auth/me?brand=life-leads-plus`),
        app.inject({
          method: 'GET',
          url: '/api/auth/me',
          headers: {
            ...tokenFor(agencyB.ownerId, agencyB.id),
            'x-tenant-id': agencyA.id,
            cookie: `tenantId=${agencyA.id}; brand=life-leads-plus`,
          },
        }),
      ];
      for (const response of await Promise.all(attempts)) {
        expect(response.statusCode).toBe(200);
        expect(response.json().brand).toBeNull();
      }

      // And the other way round: A's agent is never shown B's (absent) brand
      // swapped in, or anything but A's.
      const a = await me(agencyA.agentId, agencyA.id, `/api/auth/me?tenantId=${agencyB.id}`);
      expect(a.json().brand?.theme).toBe('life-leads-plus');
    });

    it('a token naming another tenant is refused, not served that tenant', async () => {
      // B's owner presenting a token that claims tenant A: the middleware checks
      // the claim against the user row, so this never reaches the handler.
      const response = await me(agencyB.ownerId, agencyA.id);
      expect(response.statusCode).toBe(401);
    });

    it('renders a stored key this build does not know as no brand', async () => {
      await prisma.tenant.update({
        where: { id: agencyB.id },
        data: { brandTheme: 'not-a-theme' },
      });
      expect((await me(agencyB.ownerId, agencyB.id)).json().brand).toBeNull();
    });

    it('sends a null name when the tenant has a theme but no brand name', async () => {
      await prisma.tenant.update({ where: { id: agencyA.id }, data: { brandName: null } });
      expect((await me(agencyA.ownerId, agencyA.id)).json().brand).toEqual({
        theme: 'life-leads-plus',
        name: null,
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // PATCH /api/v1/admin/tenants/:id/branding
  // ══════════════════════════════════════════════════════════════════════════
  describe('setting the brand', () => {
    it('lets a platform admin set and clear it', async () => {
      const set = await setBrand(operatorId, null, agencyB.id, {
        brandTheme: 'life-leads-plus',
        brandName: '  Ridgeline  ',
      });
      expect(set.statusCode).toBe(200);
      expect(set.json().data).toEqual({
        tenantId: agencyB.id,
        brandTheme: 'life-leads-plus',
        brandName: 'Ridgeline',
        whiteLabel: false,
      });
      expect((await me(agencyB.ownerId, agencyB.id)).json().brand).toEqual({
        theme: 'life-leads-plus',
        name: 'Ridgeline',
      });

      const cleared = await setBrand(operatorId, null, agencyB.id, { brandTheme: null });
      expect(cleared.statusCode).toBe(200);
      expect(cleared.json().data.brandTheme).toBeNull();
      expect((await me(agencyB.ownerId, agencyB.id)).json().brand).toBeNull();
    });

    it('lets a platform admin read it', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/tenants/${agencyA.id}/branding`,
        headers: tokenFor(operatorId, null),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual({
        tenantId: agencyA.id,
        brandTheme: 'life-leads-plus',
        brandName: 'Life Leads Plus',
        whiteLabel: false,
      });
    });

    it.each([
      ['OWNER', () => agencyB.ownerId, () => agencyB.id],
      ['OWNER', () => agencyA.ownerId, () => agencyA.id],
      ['ADMIN', () => agencyA.adminId, () => agencyA.id],
      ['AGENT', () => agencyA.agentId, () => agencyA.id],
    ])('refuses an agency %s 403, their own agency included', async (_role, userId, tenantId) => {
      const target = tenantId();
      const before = await prisma.tenant.findUnique({
        where: { id: target },
        select: { brandTheme: true },
      });

      const response = await setBrand(userId(), target, target, { brandTheme: null });
      expect(response.statusCode).toBe(403);

      const read = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/tenants/${target}/branding`,
        headers: tokenFor(userId(), target),
      });
      expect(read.statusCode).toBe(403);

      const after = await prisma.tenant.findUnique({
        where: { id: target },
        select: { brandTheme: true },
      });
      expect(after).toEqual(before);
      expect(
        await prisma.auditLog.count({ where: { action: 'platform.tenant.brand_changed' } })
      ).toBe(0);
    });

    it.each([['acme-corp'], ['LIFE-LEADS-PLUS'], [''], [42], [{ theme: 'life-leads-plus' }]])(
      'refuses an unknown theme key 400: %j',
      async brandTheme => {
        const response = await setBrand(operatorId, null, agencyB.id, { brandTheme });
        expect(response.statusCode).toBe(400);
        expect(response.json().error.code).toBe('VALIDATION_ERROR');
        const row = await prisma.tenant.findUnique({
          where: { id: agencyB.id },
          select: { brandTheme: true },
        });
        expect(row?.brandTheme).toBeNull();
      }
    );

    it('refuses an empty body 400 and an unknown tenant 404', async () => {
      expect((await setBrand(operatorId, null, agencyB.id, {})).statusCode).toBe(400);
      expect(
        (
          await setBrand(operatorId, null, '00000000-0000-0000-0000-000000000000', {
            brandTheme: null,
          })
        ).statusCode
      ).toBe(404);
    });

    it('writes an audit row for every change, with the before and after', async () => {
      await setBrand(operatorId, null, agencyB.id, { brandTheme: 'life-leads-plus' });
      await setBrand(operatorId, null, agencyB.id, { brandTheme: null });

      const rows = await prisma.auditLog.findMany({
        where: { action: 'platform.tenant.brand_changed' },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.tenantId).toBe(agencyB.id);
        expect(row.userId).toBe(operatorId);
        expect(row.entityType).toBe('tenant');
        expect(row.entityId).toBe(agencyB.id);
      }
      expect(rows[0].changes).toEqual({
        before: { brandTheme: null, brandName: null },
        after: { brandTheme: 'life-leads-plus', brandName: null },
      });
      expect(rows[1].changes).toEqual({
        before: { brandTheme: 'life-leads-plus', brandName: null },
        after: { brandTheme: null, brandName: null },
      });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Upgrades: PUT /api/v1/admin/tenants/:tenantId/upgrades
  // ══════════════════════════════════════════════════════════════════════════
  describe('setting the upgrades', () => {
    function setUpgrades(userId: string, tenantId: string | null, target: string, body: unknown) {
      return app.inject({
        method: 'PUT',
        url: `/api/v1/admin/tenants/${target}/upgrades`,
        headers: tokenFor(userId, tenantId),
        payload: body as Record<string, unknown>,
      });
    }

    it('lets a platform admin turn Power Dialer on, and the agency is told', async () => {
      await prisma.tenant.update({
        where: { id: agencyB.id },
        data: { metadata: { keep: 'this', upgrades: ['NOT_A_THING'] } },
      });

      const response = await setUpgrades(operatorId, null, agencyB.id, {
        upgrades: ['VOICE_STUDIO', 'POWER_DIALER', 'POWER_DIALER'],
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual({
        tenantId: agencyB.id,
        upgrades: ['POWER_DIALER', 'VOICE_STUDIO'],
      });

      // The rest of the metadata is untouched.
      const row = await prisma.tenant.findUnique({
        where: { id: agencyB.id },
        select: { metadata: true },
      });
      expect(row?.metadata).toEqual({ keep: 'this', upgrades: ['POWER_DIALER', 'VOICE_STUDIO'] });

      expect((await me(agencyB.ownerId, agencyB.id)).json().upgrades).toEqual([
        'POWER_DIALER',
        'VOICE_STUDIO',
      ]);

      const read = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/tenants/${agencyB.id}/upgrades`,
        headers: tokenFor(operatorId, null),
      });
      expect(read.statusCode).toBe(200);
      expect(read.json().data.upgrades).toEqual(['POWER_DIALER', 'VOICE_STUDIO']);
    });

    it('turns them all off with an empty list', async () => {
      await setUpgrades(operatorId, null, agencyB.id, { upgrades: ['POWER_DIALER'] });
      const off = await setUpgrades(operatorId, null, agencyB.id, { upgrades: [] });
      expect(off.statusCode).toBe(200);
      expect((await me(agencyB.ownerId, agencyB.id)).json().upgrades).toEqual([]);
    });

    it.each([
      [{}],
      [{ upgrades: 'POWER_DIALER' }],
      [{ upgrades: ['POWER_DIALER', 'CRM'] }],
      [{ upgrades: [1] }],
    ])('refuses a bad body 400: %j', async body => {
      const response = await setUpgrades(operatorId, null, agencyB.id, body);
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('answers 404 for an unknown tenant', async () => {
      const response = await setUpgrades(operatorId, null, '00000000-0000-0000-0000-000000000000', {
        upgrades: [],
      });
      expect(response.statusCode).toBe(404);
    });

    it.each([
      ['OWNER', () => agencyA.ownerId],
      ['ADMIN', () => agencyA.adminId],
      ['AGENT', () => agencyA.agentId],
    ])('refuses an agency %s 403, on their own agency', async (_role, userId) => {
      const response = await setUpgrades(userId(), agencyA.id, agencyA.id, {
        upgrades: ['POWER_DIALER'],
      });
      expect(response.statusCode).toBe(403);
      const read = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/tenants/${agencyA.id}/upgrades`,
        headers: tokenFor(userId(), agencyA.id),
      });
      expect(read.statusCode).toBe(403);
      expect((await me(agencyA.ownerId, agencyA.id)).json().upgrades).toEqual([]);
    });

    it('writes an audit row with the before and after', async () => {
      await setUpgrades(operatorId, null, agencyB.id, { upgrades: ['POWER_DIALER'] });
      await setUpgrades(operatorId, null, agencyB.id, { upgrades: [] });
      const rows = await prisma.auditLog.findMany({
        where: { action: 'platform.tenant.upgrades_changed' },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows).toHaveLength(2);
      expect(rows[0].userId).toBe(operatorId);
      expect(rows[0].entityId).toBe(agencyB.id);
      expect(rows[0].changes).toEqual({
        before: { upgrades: [] },
        after: { upgrades: ['POWER_DIALER'] },
      });
      expect(rows[1].changes).toEqual({
        before: { upgrades: ['POWER_DIALER'] },
        after: { upgrades: [] },
      });
    });
  });
});
