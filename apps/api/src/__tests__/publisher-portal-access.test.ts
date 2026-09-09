/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { RoleName } from '@prisma/client';
import { hash } from 'bcryptjs';
import Fastify, { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import {
  buildPublisherScopedWhere,
  isPublisherUser,
  requirePublisherAccess,
} from '../middleware/rbac.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * A publisher can reach their own publisher's data, and nobody else's.
 *
 * ── The defect ───────────────────────────────────────────────────────────────
 *
 * `requirePublisherAccess()` reads `user.roles` and `user.publisherId`, and
 * `request.user` on a /api/v1 route was the JWT payload verbatim. All three
 * `reply.jwtSign(...)` sites in `routes/auth.ts` mint `{ tenantId, userId,
 * email }` and nothing else, so `user.roles` was `[]` on every request ever
 * made: every branch of the function fell through and it returned false for
 * every caller. The publisher portal -- dashboard, earnings, API keys,
 * integration docs -- answered 403 to every publisher, always. Not an edge
 * case; the whole portal, for everyone.
 *
 * The cause was one disagreement between two pieces, so the fix is one:
 * `lib/principal.ts` resolves roles and the publisher link from `UserRole` and
 * `User.publisherId` on each authenticated request, and the /api/v1 auth hook
 * applies it before any handler runs. Nothing was patched at a call site.
 *
 * ── What this asserts ────────────────────────────────────────────────────────
 *
 * The four portal endpoints over real HTTP, as a real signed-in publisher, plus
 * the two ways the fix could have gone wrong in the other direction: a
 * publisher reaching a publisher that is not theirs, and a role that should
 * have gained nothing gaining something. A test that only asserted "no longer
 * 403" would pass just as well against `return true`.
 */

const gate = databaseGate();
announceSkip('Publisher portal access', gate);

const TEST_JWT_SECRET = 'publisher-access-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

// ─── The helpers themselves, with no database in the way ─────────────────────

describe('requirePublisherAccess', () => {
  /**
   * The exact principal the login token produces before it is resolved. This is
   * the input the function was receiving in production, and it must keep
   * denying: the contract is that an unhydrated principal fails CLOSED, so an
   * auth path that forgets to resolve shows up as a 403 and not as a grant.
   */
  const rawJwtPayload = { tenantId: 't1', userId: 'u1', email: 'pub@test.local' };

  it('denies a principal that carries no roles', () => {
    expect(requirePublisherAccess(rawJwtPayload as any, 'pub-1')).toBe(false);
    expect(buildPublisherScopedWhere(rawJwtPayload as any)).toEqual({ publisherId: 'none' });
    expect(isPublisherUser(rawJwtPayload as any)).toBe(false);
  });

  it('lets a resolved publisher reach their own publisher', () => {
    const user = { roles: ['PUBLISHER'], publisherId: 'pub-1' };
    expect(requirePublisherAccess(user, 'pub-1')).toBe(true);
    expect(buildPublisherScopedWhere(user)).toEqual({ publisherId: 'pub-1' });
    expect(isPublisherUser(user)).toBe(true);
  });

  it('denies a resolved publisher any other publisher', () => {
    const user = { roles: ['PUBLISHER'], publisherId: 'pub-1' };
    expect(requirePublisherAccess(user, 'pub-2')).toBe(false);
  });

  it('does not match an unlinked publisher against an empty parameter', () => {
    // `undefined === undefined` and `'' === ''` are both true, and either would
    // have handed a PUBLISHER with no link whatever the route was asked for.
    expect(requirePublisherAccess({ roles: ['PUBLISHER'] }, '')).toBe(false);
    expect(requirePublisherAccess({ roles: ['PUBLISHER'], publisherId: null }, '')).toBe(false);
  });

  it.each(['AGENT', 'READONLY', 'BUYER', 'ANALYST'])('grants %s nothing', role => {
    const user = { roles: [role], publisherId: 'pub-1' };
    expect(requirePublisherAccess(user, 'pub-1')).toBe(false);
    expect(buildPublisherScopedWhere(user)).toEqual({ publisherId: 'none' });
  });

  it.each(['ADMIN', 'OWNER'])('keeps the broader access %s already had', role => {
    expect(requirePublisherAccess({ roles: [role] }, 'pub-1')).toBe(true);
    expect(requirePublisherAccess({ roles: [role] }, 'pub-2')).toBe(true);
    expect(buildPublisherScopedWhere({ roles: [role] })).toEqual({});
  });
});

describe('Publisher portal suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `publisher portal suite cannot run: ${gate.reason}`).toBe(true);
  });
});

// ─── The portal, over real HTTP ──────────────────────────────────────────────

describe.skipIf(!gate.available)('Publisher portal access', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;

  let tenantId: string;
  let otherTenantId: string;
  let roleIds: Record<string, string>;

  /** The publisher this suite's caller is linked to. */
  let ownPublisherId: string;
  /** Another publisher in the SAME agency. Not theirs. */
  let siblingPublisherId: string;
  /** A publisher in a different agency entirely. */
  let foreignPublisherId: string;

  let publisherUserId: string;
  let adminUserId: string;
  let agentUserId: string;
  let unlinkedPublisherUserId: string;

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);

    const { registerPublisherRoutes } = await import('../routes/index.js');
    await instance.register(registerPublisherRoutes);

    await instance.ready();
    return instance;
  }

  /**
   * A token exactly as `routes/auth.ts` signs one: tenant, user, email. No
   * roles claim, because there is no roles claim -- that is the whole point.
   */
  function tokenFor(userId: string, tenant = tenantId, extra: Record<string, unknown> = {}) {
    return app.jwt.sign({ tenantId: tenant, userId, email: `${userId}@test.local`, ...extra });
  }

  function authed(userId: string, tenant = tenantId): Record<string, string> {
    return { authorization: `Bearer ${tokenFor(userId, tenant)}` };
  }

  /** The four portal pages, by the request each one makes on load. */
  const PORTAL_ENDPOINTS = [
    { page: '/publisher/dashboard', url: (id: string) => `/api/v1/publishers/${id}/stats` },
    {
      page: '/publisher/earnings',
      url: (id: string) => `/api/v1/publishers/${id}/stats?startDate=2026-01-01&endDate=2026-02-01`,
    },
    { page: '/publisher/api-setup', url: (id: string) => `/api/v1/publishers/${id}/keys` },
    { page: '/publisher/docs', url: (id: string) => `/api/v1/publishers/${id}/docs` },
  ];

  async function cleanDatabase() {
    for (const table of ['audit_logs', 'api_keys', 'user_roles', 'users', 'roles', 'tenants']) {
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
    delete process.env.ALLOW_DEMO_TENANT_AUTH;

    prisma = getPrismaClient();
    await cleanDatabase();

    roleIds = {};
    for (const name of [
      RoleName.OWNER,
      RoleName.ADMIN,
      RoleName.PUBLISHER,
      RoleName.AGENT,
      RoleName.READONLY,
    ]) {
      const role = await prisma.role.create({
        data: { name, description: `${name} role`, permissions: [] },
      });
      roleIds[name] = role.id;
    }

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const tenant = await prisma.tenant.create({
      data: { name: 'Alpha Insurance', slug: `alpha-${stamp}`, status: 'ACTIVE' },
    });
    tenantId = tenant.id;

    const otherTenant = await prisma.tenant.create({
      data: { name: 'Bravo Insurance', slug: `bravo-${stamp}`, status: 'ACTIVE' },
    });
    otherTenantId = otherTenant.id;

    ownPublisherId = (
      await prisma.publisher.create({
        data: { tenantId, name: 'Own Source', code: `OWN-${stamp}` },
      })
    ).id;

    siblingPublisherId = (
      await prisma.publisher.create({
        data: { tenantId, name: 'Sibling Source', code: `SIB-${stamp}` },
      })
    ).id;

    foreignPublisherId = (
      await prisma.publisher.create({
        data: { tenantId: otherTenantId, name: 'Foreign Source', code: `FOR-${stamp}` },
      })
    ).id;

    const passwordHash = await hash('password123', 10);

    async function makeUser(
      label: string,
      role: RoleName,
      publisherId: string | null,
      tenant = tenantId
    ) {
      const user = await prisma.user.create({
        data: {
          tenantId: tenant,
          email: `${label}-${stamp}@test.local`,
          passwordHash,
          status: 'ACTIVE',
          publisherId,
          roles: { create: { roleId: roleIds[role] } },
        },
      });
      return user.id;
    }

    publisherUserId = await makeUser('publisher', RoleName.PUBLISHER, ownPublisherId);
    adminUserId = await makeUser('admin', RoleName.ADMIN, null);
    agentUserId = await makeUser('agent', RoleName.AGENT, ownPublisherId);
    unlinkedPublisherUserId = await makeUser('unlinked', RoleName.PUBLISHER, null);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 1. The defect: a publisher could not reach their own data
  // ══════════════════════════════════════════════════════════════════════════
  describe('a publisher reaches their own publisher', () => {
    it.each(PORTAL_ENDPOINTS)('$page loads', async ({ url }) => {
      const response = await app.inject({
        method: 'GET',
        url: url(ownPublisherId),
        headers: authed(publisherUserId),
      });

      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).not.toHaveProperty('error');
    });

    it('the token itself still carries no roles', () => {
      // Guards the suite: if a sign site ever starts embedding roles, these
      // cases would pass without the resolution they exist to cover.
      const claims = app.jwt.verify(tokenFor(publisherUserId)) as Record<string, unknown>;
      expect(claims).not.toHaveProperty('roles');
      expect(claims).not.toHaveProperty('publisherId');
    });

    it('reads their own publisher, not whichever row came first', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/publishers/${ownPublisherId}/docs`,
        headers: authed(publisherUserId),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().publisherId).toBe(ownPublisherId);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2. And still cannot reach anybody else's
  // ══════════════════════════════════════════════════════════════════════════
  describe('a publisher reaches nothing else', () => {
    it.each(PORTAL_ENDPOINTS)('$page for another publisher is refused', async ({ url }) => {
      const response = await app.inject({
        method: 'GET',
        url: url(siblingPublisherId),
        headers: authed(publisherUserId),
      });

      expect(response.statusCode, response.body).toBe(403);
    });

    it("another agency's publisher is refused", async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/publishers/${foreignPublisherId}/docs`,
        headers: authed(publisherUserId),
      });

      expect(response.statusCode).toBe(403);
    });

    it('cannot mint an API key against another publisher', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/publishers/${siblingPublisherId}/keys`,
        headers: authed(publisherUserId),
        payload: { name: 'borrowed' },
      });

      expect(response.statusCode).toBe(403);
      expect(await prisma.apiKey.count({ where: { publisherId: siblingPublisherId } })).toBe(0);
    });

    it('a publisher user with no publisher link reaches nothing', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/publishers/${ownPublisherId}/stats`,
        headers: authed(unlinkedPublisherUserId),
      });

      expect(response.statusCode).toBe(403);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 3. Nobody else gained anything
  // ══════════════════════════════════════════════════════════════════════════
  describe('resolving roles widens nothing', () => {
    it('an AGENT linked to a publisher is still refused', async () => {
      // The link is on the user row, so an implementation that read
      // `publisherId` without also requiring the role would let this through.
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/publishers/${ownPublisherId}/stats`,
        headers: authed(agentUserId),
      });

      expect(response.statusCode).toBe(403);
    });

    it('an unauthenticated request is refused', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/publishers/${ownPublisherId}/stats`,
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('an ADMIN keeps the access they already had', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/publishers/${siblingPublisherId}/docs`,
        headers: authed(adminUserId),
      });

      expect(response.statusCode, response.body).toBe(200);
    });

    it("an ADMIN of one agency still cannot read another agency's publisher", async () => {
      // `requirePublisherAccess` grants ADMIN any publisherId and never compares
      // tenants, so the tenant has to stay on the handler's query. Resolving
      // roles is what finally makes that ADMIN branch reachable, which is what
      // makes this worth asserting rather than assuming.
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/publishers/${foreignPublisherId}/docs`,
        headers: authed(adminUserId),
      });

      expect([403, 404]).toContain(response.statusCode);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 4. The token says who is asking; the database says what they may do
  // ══════════════════════════════════════════════════════════════════════════
  describe('the database is the authority, not the token', () => {
    it('a roles claim forged into a token grants nothing', async () => {
      const forged = app.jwt.sign({
        tenantId,
        userId: agentUserId,
        email: 'agent@test.local',
        roles: ['ADMIN', 'OWNER'],
        publisherId: siblingPublisherId,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/publishers/${siblingPublisherId}/docs`,
        headers: { authorization: `Bearer ${forged}` },
      });

      expect(response.statusCode).toBe(403);
    });

    it('revoking the role takes effect on the very next request', async () => {
      const headers = authed(publisherUserId);

      const before = await app.inject({
        method: 'GET',
        url: `/api/v1/publishers/${ownPublisherId}/docs`,
        headers,
      });
      expect(before.statusCode).toBe(200);

      await prisma.userRole.deleteMany({ where: { userId: publisherUserId } });

      const after = await app.inject({
        method: 'GET',
        url: `/api/v1/publishers/${ownPublisherId}/docs`,
        headers,
      });
      expect(after.statusCode, 'the same token still worked after the role was revoked').toBe(403);
    });

    it('moving the user to another publisher moves their access with them', async () => {
      const headers = authed(publisherUserId);

      await prisma.user.update({
        where: { id: publisherUserId },
        data: { publisherId: siblingPublisherId },
      });

      const own = await app.inject({
        method: 'GET',
        url: `/api/v1/publishers/${ownPublisherId}/docs`,
        headers,
      });
      const sibling = await app.inject({
        method: 'GET',
        url: `/api/v1/publishers/${siblingPublisherId}/docs`,
        headers,
      });

      expect(own.statusCode).toBe(403);
      expect(sibling.statusCode).toBe(200);
    });
  });
});
