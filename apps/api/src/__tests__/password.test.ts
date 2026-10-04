/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { RoleName } from '@prisma/client';
// eslint-disable-next-line import/default
import bcrypt from 'bcryptjs';
// eslint-disable-next-line import/no-named-as-default-member
const { hash: bcryptHash } = bcrypt;
import Fastify, { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { registerStaffOnly } from '../middleware/staff-only.js';
import { hashResetToken } from '../services/password-reset.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * Changing and resetting a password.
 *
 *   PATCH /api/auth/me/password           needs the current password; signs out
 *                                         every other session (tokenVersion)
 *   POST  /api/auth/password-reset        202 whether or not the address exists
 *   POST  /api/auth/password-reset/confirm  single-use, 60 minutes
 */

const sendMail = vi.fn<[message: any], Promise<{ accepted: string[] }>>();
vi.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail }),
  default: { createTransport: () => ({ sendMail }) },
}));

const gate = databaseGate();
announceSkip('Password change and reset', gate);

const TEST_JWT_SECRET = 'password-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('Password suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `password suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('Password change and reset', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;
  let tenantId: string;
  let userId: string;
  let userEmail: string;
  const ORIGINAL = 'Original-Password-1';

  const SMTP_KEYS = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM', 'APP_URL'] as const;
  const savedEnv: Record<string, string | undefined> = {};

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);
    registerStaffOnly(instance);
    const { registerAuthRoutes } = await import('../routes/auth.js');
    const { registerUserRoutes } = await import('../routes/index.js');
    await instance.register(registerAuthRoutes);
    await instance.register(registerUserRoutes);
    await instance.ready();
    return instance;
  }

  async function login(password: string) {
    return app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: userEmail, password },
    });
  }

  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    for (const key of SMTP_KEYS) savedEnv[key] = process.env[key];
    process.env.SMTP_HOST = 'smtp.example.test';
    process.env.SMTP_USER = 'mailer';
    process.env.SMTP_PASSWORD = 'secret';
    process.env.SMTP_FROM = 'noreply@netenroll.com';
    process.env.APP_URL = 'https://agents.netenroll.com';
    app = await buildApp();
  });

  afterAll(async () => {
    for (const key of SMTP_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    await app?.close();
  });

  beforeEach(async () => {
    sendMail.mockReset().mockResolvedValue({ accepted: ['x'] });
    prisma = getPrismaClient();
    for (const table of ['audit_logs', 'roles', 'tenants']) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }
    const buyerRole = await prisma.role.create({
      data: { name: RoleName.BUYER, description: 'buyer', permissions: [] },
    });
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tenant = await prisma.tenant.create({
      data: {
        name: 'Ridgeline',
        slug: `ridge-${stamp}`,
        status: 'ACTIVE',
        brandTheme: 'life-leads-plus',
        brandName: 'Life Leads Plus',
      },
    });
    tenantId = tenant.id;
    const buyer = await prisma.buyer.create({
      data: { tenantId, name: 'Acme', code: `b-${stamp}` },
    });
    userEmail = `buyer-${stamp}@portal.test`;
    // A buyer: every role has a password to change, portal logins included.
    userId = (
      await prisma.user.create({
        data: {
          tenantId,
          email: userEmail,
          passwordHash: await bcryptHash(ORIGINAL, 4),
          status: 'ACTIVE',
          buyerId: buyer.id,
          roles: { create: { roleId: buyerRole.id } },
        },
      })
    ).id;
  });

  describe('PATCH /api/auth/me/password', () => {
    it('refuses a wrong current password and changes nothing', async () => {
      const { token } = (await login(ORIGINAL)).json();
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/auth/me/password',
        headers: bearer(token),
        payload: { currentPassword: 'not-it-at-all', newPassword: 'A-Whole-New-One-2' },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('INVALID_CURRENT_PASSWORD');
      expect((await login(ORIGINAL)).statusCode).toBe(200);
    });

    it('refuses a new password under ten characters', async () => {
      const { token } = (await login(ORIGINAL)).json();
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/auth/me/password',
        headers: bearer(token),
        payload: { currentPassword: ORIGINAL, newPassword: 'Short-1' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('requires authentication', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/auth/me/password',
        payload: { currentPassword: ORIGINAL, newPassword: 'A-Whole-New-One-2' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('changes it, bumps tokenVersion, signs out other sessions and keeps this one', async () => {
      const other = (await login(ORIGINAL)).json().token;
      const mine = (await login(ORIGINAL)).json().token;

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/auth/me/password',
        headers: bearer(mine),
        payload: { currentPassword: ORIGINAL, newPassword: 'A-Whole-New-One-2' },
      });
      expect(response.statusCode, response.body).toBe(200);
      const fresh = response.json().token;
      expect(fresh).toEqual(expect.any(String));

      const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect((row.metadata as any).tokenVersion).toBe(1);
      // bcrypt cost 12.
      expect(row.passwordHash).toMatch(/^\$2[aby]\$12\$/);

      // The old sessions are refused on both authenticators.
      const meOld = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: bearer(other),
      });
      expect(meOld.statusCode).toBe(401);
      const v1Old = await app.inject({
        method: 'GET',
        url: '/api/v1/users',
        headers: bearer(other),
      });
      expect(v1Old.statusCode).toBe(401);
      expect(v1Old.json().error.code).toBe('SESSION_REVOKED');

      // The token handed back works.
      const meNew = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: bearer(fresh),
      });
      expect(meNew.statusCode).toBe(200);

      expect((await login(ORIGINAL)).statusCode).toBe(401);
      expect((await login('A-Whole-New-One-2')).statusCode).toBe(200);

      const audit = await prisma.auditLog.findFirst({ where: { action: 'auth.password.changed' } });
      expect(audit).toMatchObject({ userId, tenantId, success: true });
    });
  });

  describe('POST /api/auth/me/sessions/revoke', () => {
    it('requires authentication', async () => {
      const response = await app.inject({ method: 'POST', url: '/api/auth/me/sessions/revoke' });
      expect(response.statusCode).toBe(401);
    });

    it('signs out every other session, keeps this one, and leaves the password alone', async () => {
      const other = (await login(ORIGINAL)).json().token;
      const mine = (await login(ORIGINAL)).json().token;

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/me/sessions/revoke',
        headers: bearer(mine),
      });
      expect(response.statusCode, response.body).toBe(200);
      const fresh = response.json().token;
      expect(fresh).toEqual(expect.any(String));

      const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect((row.metadata as any).tokenVersion).toBe(1);

      const meOld = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: bearer(other),
      });
      expect(meOld.statusCode).toBe(401);
      expect(meOld.json().error.code).toBe('SESSION_REVOKED');
      const meMine = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: bearer(mine),
      });
      expect(meMine.statusCode).toBe(401);

      const meNew = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: bearer(fresh),
      });
      expect(meNew.statusCode).toBe(200);

      // The password is unchanged.
      expect((await login(ORIGINAL)).statusCode).toBe(200);

      const audit = await prisma.auditLog.findFirst({ where: { action: 'auth.sessions.revoked' } });
      expect(audit).toMatchObject({ userId, tenantId, success: true });
    });
  });

  describe('GET /api/auth/me, for the Account page', () => {
    it('says how the login signs in and when it was made, and never sends the hash', async () => {
      const { token } = (await login(ORIGINAL)).json();
      const response = await app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: bearer(token),
      });
      expect(response.statusCode, response.body).toBe(200);
      const body = response.json();
      expect(body.authMethod).toBe('EMAIL');
      expect(body.hasPassword).toBe(true);
      // A buyer portal login belongs to its buyer company.
      expect(body.organizationName).toBe('Acme');
      expect(Number.isFinite(Date.parse(body.createdAt))).toBe(true);
      expect(body).not.toHaveProperty('passwordHash');
    });
  });

  describe('POST /api/auth/password-reset', () => {
    it('answers 202 for an unknown address and sends nothing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/password-reset',
        payload: { email: 'nobody-here@portal.test' },
      });
      expect(response.statusCode).toBe(202);
      expect(sendMail).not.toHaveBeenCalled();
      expect(await prisma.passwordResetToken.count()).toBe(0);
    });

    it('answers 202 for a known address, identically, and emails a branded link', async () => {
      const unknown = await app.inject({
        method: 'POST',
        url: '/api/auth/password-reset',
        payload: { email: 'nobody-here@portal.test' },
      });
      const known = await app.inject({
        method: 'POST',
        url: '/api/auth/password-reset',
        payload: { email: userEmail.toUpperCase() },
      });
      expect(known.statusCode).toBe(202);
      expect(known.body).toBe(unknown.body);

      expect(sendMail).toHaveBeenCalledTimes(1);
      const message = sendMail.mock.calls[0][0];
      expect(message.to).toBe(userEmail);
      expect(message.from).toBe('Life Leads Plus <noreply@netenroll.com>');
      expect(message.text).toMatch(/https:\/\/agents\.netenroll\.com\/reset-password\?token=/);
      expect(message.text).not.toMatch(/NetEnroll/);

      const row = await prisma.passwordResetToken.findFirstOrThrow({ where: { userId } });
      const expiresIn = row.expiresAt.getTime() - Date.now();
      expect(expiresIn).toBeGreaterThan(59 * 60 * 1000);
      expect(expiresIn).toBeLessThanOrEqual(60 * 60 * 1000);
    });
  });

  describe('POST /api/auth/password-reset/confirm', () => {
    async function requestToken(): Promise<string> {
      await app.inject({
        method: 'POST',
        url: '/api/auth/password-reset',
        payload: { email: userEmail },
      });
      const text: string = sendMail.mock.calls.at(-1)![0].text;
      const match = /reset-password\?token=([A-Za-z0-9_-]+)/.exec(text);
      expect(match).not.toBeNull();
      return match![1];
    }

    const confirm = (token: string, newPassword: string) =>
      app.inject({
        method: 'POST',
        url: '/api/auth/password-reset/confirm',
        payload: { token, newPassword },
      });

    it('sets the password, once, and signs out every session', async () => {
      const session = (await login(ORIGINAL)).json().token;
      const token = await requestToken();

      const first = await confirm(token, 'Reset-Password-99');
      expect(first.statusCode, first.body).toBe(200);
      expect((await login('Reset-Password-99')).statusCode).toBe(200);
      expect((await login(ORIGINAL)).statusCode).toBe(401);

      // Single-use.
      const again = await confirm(token, 'Another-Password-77');
      expect(again.statusCode).toBe(400);
      expect(again.json().error.code).toBe('INVALID_RESET_TOKEN');
      expect((await login('Reset-Password-99')).statusCode).toBe(200);

      const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(session) });
      expect(me.statusCode).toBe(401);
    });

    it('refuses an expired token', async () => {
      const token = await requestToken();
      await prisma.passwordResetToken.update({
        where: { tokenHash: hashResetToken(token) },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const response = await confirm(token, 'Reset-Password-99');
      expect(response.statusCode).toBe(400);
      expect((await login(ORIGINAL)).statusCode).toBe(200);
    });

    it('refuses a token that was never issued', async () => {
      expect((await confirm('made-up-token', 'Reset-Password-99')).statusCode).toBe(400);
    });

    it('does not burn the link on a too-short password', async () => {
      const token = await requestToken();
      expect((await confirm(token, 'short')).statusCode).toBe(400);
      expect((await confirm(token, 'Long-Enough-Now-1')).statusCode).toBe(200);
    });
  });
});
