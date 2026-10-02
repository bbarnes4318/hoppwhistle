/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { RoleName } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { registerStaffOnly } from '../middleware/staff-only.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * Inviting people into an agency: every invitation is an activation grant.
 *
 * `POST /api/v1/users/invite` used to create the user on the spot with a
 * temporary password it returned in the response and emailed to nobody. It is
 * 410 now, and `POST /api/v1/auth/activation-grants` carries every role an
 * agency may invite -- AGENT, ADMIN, ANALYST, and the portal logins of its own
 * BUYERs and PUBLISHERs -- with the buyer or publisher on the grant, checked
 * against the tenant when it is issued and again when it is redeemed.
 *
 * The buyer and publisher ids are client-supplied, so the property that
 * matters is the tenant line: another agency's party is refused, or its calls
 * and money would be one invitation away.
 *
 * And the email: a branded agency's invitation is the agency's, with its brand
 * name, a link on its own domain, the brand as the From name, and no
 * "NetEnroll" anywhere in it.
 */

const sendMail = vi.fn<[message: any], Promise<{ accepted: string[] }>>();
vi.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail }),
  default: { createTransport: () => ({ sendMail }) },
}));

const gate = databaseGate();
announceSkip('Activation-grant invitations', gate);

const TEST_JWT_SECRET = 'invite-publisher-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('Activation-grant invitation suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `invitation suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('Inviting into an agency with activation grants', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;
  let tenantId: string;
  let ownerId: string;
  let publisherId: string;
  let buyerId: string;
  let foreignPublisherId: string;
  let foreignBuyerId: string;
  let seq = 0;

  const SMTP_KEYS = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM', 'APP_URL'] as const;
  const savedEnv: Record<string, string | undefined> = {};

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);
    registerStaffOnly(instance);
    const { registerUserRoutes } = await import('../routes/index.js');
    const { registerAuthRoutes } = await import('../routes/auth.js');
    await instance.register(registerUserRoutes);
    await instance.register(registerAuthRoutes);
    await instance.ready();
    return instance;
  }

  const ownerHeaders = () => ({
    authorization: `Bearer ${app.jwt.sign({ userId: ownerId, tenantId, email: 'o@t.local' })}`,
  });

  function invite(payload: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/auth/activation-grants',
      headers: ownerHeaders(),
      payload,
    });
  }

  function register(email: string, activationToken: string) {
    return app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, password: 'Portal-Password-1', activationToken },
    });
  }

  const email = () => `invitee-${++seq}-${Date.now()}@portal.test`;

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
    const roleIds: Record<string, string> = {};
    for (const name of [
      RoleName.OWNER,
      RoleName.ADMIN,
      RoleName.ANALYST,
      RoleName.AGENT,
      RoleName.PUBLISHER,
      RoleName.BUYER,
    ]) {
      roleIds[name] = (
        await prisma.role.create({ data: { name, description: `${name} role`, permissions: [] } })
      ).id;
    }

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tenant = await prisma.tenant.create({
      data: {
        name: 'Life Leads Plus',
        slug: `llp-${stamp}`,
        status: 'ACTIVE',
        whiteLabel: true,
        brandTheme: 'life-leads-plus',
        brandName: 'Life Leads Plus',
        domain: `portal-${stamp}.lifeleadsplus.test`,
      },
    });
    tenantId = tenant.id;
    ownerId = (
      await prisma.user.create({
        data: {
          tenantId,
          email: `owner-${stamp}@agency.local`,
          status: 'ACTIVE',
          roles: { create: { roleId: roleIds.OWNER } },
        },
      })
    ).id;
    publisherId = (
      await prisma.publisher.create({ data: { tenantId, name: 'Alpha Media', code: `p-${stamp}` } })
    ).id;
    buyerId = (await prisma.buyer.create({ data: { tenantId, name: 'Acme', code: `b-${stamp}` } }))
      .id;

    const other = await prisma.tenant.create({
      data: { name: 'Elsewhere', slug: `else-${stamp}`, status: 'ACTIVE' },
    });
    foreignPublisherId = (
      await prisma.publisher.create({
        data: { tenantId: other.id, name: 'Not yours', code: `fp-${stamp}` },
      })
    ).id;
    foreignBuyerId = (
      await prisma.buyer.create({
        data: { tenantId: other.id, name: 'Not yours either', code: `fb-${stamp}` },
      })
    ).id;
  });

  it('POST /api/v1/users/invite is gone, and says where to go instead', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/users/invite',
      headers: ownerHeaders(),
      payload: { email: email(), role: 'PUBLISHER', publisherId },
    });
    expect(response.statusCode).toBe(410);
    expect(response.json().error.message).toContain('/api/v1/auth/activation-grants');
    expect(response.body).not.toContain('tempPassword');
  });

  it("a PUBLISHER grant creates a login linked to this tenant's publisher", async () => {
    const address = email();
    const issued = await invite({ email: address, role: 'PUBLISHER', publisherId });
    expect(issued.statusCode, issued.body).toBe(201);
    expect(issued.json()).toMatchObject({ role: 'PUBLISHER', publisherId, buyerId: null });
    expect(issued.body).not.toContain('tempPassword');

    // Nobody exists until the link is used.
    expect(await prisma.user.count({ where: { email: address } })).toBe(0);

    const redeemed = await register(address, issued.json().activationToken);
    expect(redeemed.statusCode, redeemed.body).toBe(201);
    expect(redeemed.json().user.roles).toEqual(['PUBLISHER']);

    const created = await prisma.user.findUniqueOrThrow({
      where: { email: address },
      include: { roles: { include: { role: true } } },
    });
    expect(created).toMatchObject({ tenantId, publisherId, buyerId: null });
    expect(created.roles.map(r => r.role.name)).toEqual(['PUBLISHER']);
  });

  it("a BUYER grant creates a login linked to this tenant's buyer", async () => {
    const address = email();
    const issued = await invite({ email: address, role: 'BUYER', buyerId });
    expect(issued.statusCode, issued.body).toBe(201);

    const redeemed = await register(address, issued.json().activationToken);
    expect(redeemed.statusCode, redeemed.body).toBe(201);

    const created = await prisma.user.findUniqueOrThrow({
      where: { email: address },
      include: { roles: { include: { role: true } } },
    });
    expect(created).toMatchObject({ tenantId, buyerId, publisherId: null });
    expect(created.roles.map(r => r.role.name)).toEqual(['BUYER']);
  });

  it("refuses another tenant's buyer or publisher with 400, and issues nothing", async () => {
    const a = email();
    const b = email();
    expect((await invite({ email: a, role: 'BUYER', buyerId: foreignBuyerId })).statusCode).toBe(
      400
    );
    expect(
      (await invite({ email: b, role: 'PUBLISHER', publisherId: foreignPublisherId })).statusCode
    ).toBe(400);
    expect(await prisma.tenantActivationGrant.count({ where: { email: { in: [a, b] } } })).toBe(0);
  });

  it('requires the party for BUYER and PUBLISHER, and refuses the wrong kind', async () => {
    expect((await invite({ email: email(), role: 'PUBLISHER' })).statusCode).toBe(400);
    expect((await invite({ email: email(), role: 'BUYER' })).statusCode).toBe(400);
    expect((await invite({ email: email(), role: 'BUYER', buyerId, publisherId })).statusCode).toBe(
      400
    );
    expect(
      (await invite({ email: email(), role: 'PUBLISHER', publisherId, buyerId })).statusCode
    ).toBe(400);
  });

  it('refuses an internal role carrying a buyer or publisher', async () => {
    for (const role of ['ADMIN', 'ANALYST', 'AGENT']) {
      expect((await invite({ email: email(), role, publisherId })).statusCode, role).toBe(400);
      expect((await invite({ email: email(), role, buyerId })).statusCode, role).toBe(400);
    }
  });

  it('issues ADMIN and ANALYST, and still refuses OWNER', async () => {
    for (const role of ['ADMIN', 'ANALYST']) {
      const address = email();
      const issued = await invite({ email: address, role });
      expect(issued.statusCode, role).toBe(201);
      const redeemed = await register(address, issued.json().activationToken);
      expect(redeemed.json().user.roles, role).toEqual([role]);
    }
    expect((await invite({ email: email(), role: 'OWNER' })).statusCode).toBe(403);
  });

  it('sends the invitation branded as the agency, with no NetEnroll in it', async () => {
    const address = email();
    const issued = await invite({ email: address, role: 'BUYER', buyerId });
    expect(issued.statusCode).toBe(201);
    expect(issued.json().emailed).toBe(true);

    expect(sendMail).toHaveBeenCalledTimes(1);
    const message = sendMail.mock.calls[0][0];
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

    expect(message.to).toBe(address);
    expect(message.from).toBe('Life Leads Plus <noreply@netenroll.com>');
    expect(message.text).toContain(`https://${tenant.domain}/login?`);
    expect(message.html).toContain(`https://${tenant.domain}/login?`);
    expect(message.text).toContain(
      "You've been given access to see the calls you receive, what you're billed, and to request returns."
    );
    expect(message.text).toContain('The Life Leads Plus team');
    expect(message.html).toContain('https://agents.netenroll.com/brands/life-leads-plus/logo.png');
    for (const part of [message.subject, message.text, message.html, message.from]) {
      // The logo URL is on the platform host by design; the words are the point.
      expect(String(part).replace(/agents\.netenroll\.com|netenroll\.com/g, '')).not.toMatch(
        /NetEnroll/i
      );
    }

    // The response carries the same link, for when the email does not arrive.
    expect(issued.json().activationLink).toContain(`https://${tenant.domain}/login?`);
  });

  it('writes publisher copy for a PUBLISHER and agency-portal copy for an ADMIN', async () => {
    await invite({ email: email(), role: 'PUBLISHER', publisherId });
    expect(sendMail.mock.calls[0][0].text).toContain(
      "You've been given access to see the calls you send, what you've earned, and your payments."
    );
    await invite({ email: email(), role: 'ADMIN' });
    expect(sendMail.mock.calls[1][0].text).toContain("You've been added to the agency portal");
  });

  it('reports a failed send and still returns the link to copy', async () => {
    sendMail.mockRejectedValueOnce(new Error('SMTP down'));
    const issued = await invite({ email: email(), role: 'AGENT', licensedStates: ['TN'] });
    expect(issued.statusCode).toBe(201);
    expect(issued.json()).toMatchObject({ emailed: false, emailFailureReason: 'send_failed' });
    expect(issued.json().activationLink).toContain('/login?activation=');
  });

  it('GET /api/v1/users returns publisherId beside buyerId', async () => {
    const address = email();
    const issued = await invite({ email: address, role: 'PUBLISHER', publisherId });
    expect((await register(address, issued.json().activationToken)).statusCode).toBe(201);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: ownerHeaders(),
    });
    expect(response.statusCode).toBe(200);
    const row = response.json().data.find((u: any) => u.email === address);
    expect(row).toMatchObject({ publisherId, buyerId: null });
    const owner = response.json().data.find((u: any) => u.id === ownerId);
    expect(owner).toHaveProperty('publisherId', null);
  });
});
