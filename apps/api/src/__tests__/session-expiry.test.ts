/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { RoleName } from '@prisma/client';
import { hash } from 'bcryptjs';
import Fastify, { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * A session ends, and renewing one cannot change who you are.
 *
 * ── What this replaces ───────────────────────────────────────────────────────
 *
 * `registerAuth()` registers @fastify/jwt with a secret and no `sign` options,
 * and none of the three sign sites passed `expiresIn`. Login tokens carried no
 * `exp` claim at all: a token that leaked authenticated forever, and revoking
 * one session meant changing JWT_SECRET for everybody. The web app's mirror
 * cookie already claimed a seven-day lifetime "matching the JWT the API
 * issues"; it did not match anything.
 *
 * ── Why a refresh rather than just a shorter token ───────────────────────────
 *
 * An expiry with no way to renew turns every long shift into a forced re-login.
 * The renewal deliberately uses the credential the caller already holds -- no
 * refresh token, no second secret, no new table -- so there is still exactly
 * one thing to steal and one thing to revoke.
 *
 * The cases below are about what renewal must NOT be able to do: resurrect a
 * dead session, outlive a suspended account, or move an account to another
 * tenant or another user by asking nicely in the request body.
 */

const gate = databaseGate();
announceSkip('Session expiry and refresh', gate);

const TEST_JWT_SECRET = 'session-expiry-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('Session expiry suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `session expiry suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('Session expiry and refresh', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;
  let tenantId: string;
  let otherTenantId: string;
  let agentId: string;
  let otherUserId: string;
  const PASSWORD = 'Password123';

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    const { registerAuthRoutes } = await import('../routes/auth.js');
    await instance.register(registerAuthRoutes);
    await instance.ready();
    return instance;
  }

  const refresh = (token: string, payload: unknown = {}) =>
    app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { authorization: `Bearer ${token}` },
      payload: payload as Record<string, unknown>,
    });

  const decode = (token: string): Record<string, any> =>
    JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));

  /**
   * A token that has already lapsed.
   *
   * The `exp` claim is set explicitly rather than through `expiresIn`, which
   * the signer rejects for a negative duration -- reasonably, since minting a
   * dead token is not something production code should be able to ask for.
   */
  const expiredToken = (): string =>
    app.jwt.sign({
      tenantId,
      userId: agentId,
      email: 'agent@expiry.local',
      exp: Math.floor(Date.now() / 1000) - 60,
    });

  beforeAll(async () => {
    prisma = getPrismaClient();
    app = await buildApp();

    for (const table of ['audit_logs', 'user_roles', 'users', 'roles', 'tenants']) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }

    const agentRole = await prisma.role.create({
      data: { name: RoleName.AGENT, permissions: [] },
    });
    const tenant = await prisma.tenant.create({
      data: { name: 'Expiry Agency', slug: `exp-${Date.now()}`, status: 'ACTIVE' },
    });
    const other = await prisma.tenant.create({
      data: { name: 'Other Agency', slug: `oth-${Date.now()}`, status: 'ACTIVE' },
    });
    tenantId = tenant.id;
    otherTenantId = other.id;

    const agent = await prisma.user.create({
      data: {
        tenantId,
        email: 'agent@expiry.local',
        passwordHash: await hash(PASSWORD, 10),
        status: 'ACTIVE',
        roles: { create: { roleId: agentRole.id } },
      },
    });
    agentId = agent.id;

    const other2 = await prisma.user.create({
      data: { tenantId: otherTenantId, email: 'other@expiry.local', status: 'ACTIVE' },
    });
    otherUserId = other2.id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  async function login(): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'agent@expiry.local', password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body).token;
  }

  describe('a login token expires', () => {
    it('carries an exp claim', async () => {
      const claims = decode(await login());
      expect(claims.exp, 'login token has no exp — it would authenticate forever').toBeTypeOf(
        'number'
      );
    });

    it('expires seven days out, matching the cookie the web app writes', async () => {
      const claims = decode(await login());
      const days = (claims.exp - claims.iat) / 86_400;
      expect(days).toBeCloseTo(7, 1);
    });

    it('reports its own expiry to the client', async () => {
      const token = await login();
      const me = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: `Bearer ${token}` },
      });
      const body = JSON.parse(me.body);
      // So the client renews before it lapses, rather than discovering it as a
      // 401 on some unrelated page.
      expect(Date.parse(body.sessionExpiresAt)).toBeGreaterThan(Date.now());
    });

    it('refuses an expired token', async () => {
      const expired = expiredToken();
      const me = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: { authorization: `Bearer ${expired}` },
      });
      expect(me.statusCode).toBe(401);
    });
  });

  describe('renewal slides the same session', () => {
    it('issues a token that expires later than the one presented', async () => {
      const before = await login();
      // One second, so `iat` genuinely differs: two tokens signed in the same
      // second are byte-identical and would make this assertion vacuous.
      await new Promise(resolve => setTimeout(resolve, 1100));

      const res = await refresh(before);
      expect(res.statusCode).toBe(200);
      const after = JSON.parse(res.body).token;

      expect(decode(after).exp).toBeGreaterThan(decode(before).exp);
      expect(decode(after).userId).toBe(agentId);
    });

    it('records the renewal', async () => {
      await refresh(await login());
      const row = await prisma.auditLog.findFirst({
        where: { userId: agentId, action: 'auth.token.refreshed' },
      });
      expect(row).not.toBeNull();
    });
  });

  describe('renewal cannot change who you are', () => {
    it('ignores a tenantId in the body', async () => {
      const res = await refresh(await login(), { tenantId: otherTenantId });
      expect(res.statusCode).toBe(200);
      expect(decode(JSON.parse(res.body).token).tenantId).toBe(tenantId);
    });

    it('ignores a userId in the body', async () => {
      const res = await refresh(await login(), { userId: otherUserId });
      expect(res.statusCode).toBe(200);
      expect(decode(JSON.parse(res.body).token).userId).toBe(agentId);
    });

    it('refuses an anonymous caller', async () => {
      const res = await app.inject({ method: 'POST', url: '/api/auth/refresh' });
      expect(res.statusCode).toBe(401);
    });

    it('refuses an expired token — renewal is not resurrection', async () => {
      const expired = expiredToken();
      expect((await refresh(expired)).statusCode).toBe(401);
    });

    it('refuses once the account is no longer active', async () => {
      const token = await login();
      await prisma.user.update({ where: { id: agentId }, data: { status: 'SUSPENDED' } });
      try {
        // A token inside its seven days says nothing about whether the account
        // behind it still exists. Suspending has to end the session now, not
        // when the token happens to lapse.
        expect((await refresh(token)).statusCode).toBe(403);
      } finally {
        await prisma.user.update({ where: { id: agentId }, data: { status: 'ACTIVE' } });
      }
    });
  });
});
