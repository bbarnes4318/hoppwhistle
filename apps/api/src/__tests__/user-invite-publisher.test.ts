/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { RoleName } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { registerStaffOnly } from '../middleware/staff-only.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * Inviting a publisher's own login: `POST /api/v1/users/invite` with the
 * PUBLISHER role, and `GET /api/v1/users` reading the link back.
 *
 * The publisher id is client-supplied, so the property that matters is the
 * tenant line: a publisher of ANOTHER agency must be refused, or its calls and
 * payouts would be one invite away.
 */

const gate = databaseGate();
announceSkip('Publisher invites', gate);

const TEST_JWT_SECRET = 'invite-publisher-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('Publisher invite suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `publisher invite suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('POST /api/v1/users/invite with PUBLISHER', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;
  let tenantId: string;
  let ownerId: string;
  let publisherId: string;
  let buyerId: string;
  let foreignPublisherId: string;
  let seq = 0;

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);
    registerStaffOnly(instance);
    const { registerUserRoutes } = await import('../routes/index.js');
    await instance.register(registerUserRoutes);
    await instance.ready();
    return instance;
  }

  function invite(payload: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/users/invite',
      headers: {
        authorization: `Bearer ${app.jwt.sign({ userId: ownerId, tenantId, email: 'o@t.local' })}`,
      },
      payload,
    });
  }

  const email = () => `invitee-${++seq}-${Date.now()}@publisher.test`;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    prisma = getPrismaClient();
    for (const table of ['audit_logs', 'roles', 'tenants']) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }
    const roleIds: Record<string, string> = {};
    for (const name of [RoleName.OWNER, RoleName.ADMIN, RoleName.PUBLISHER, RoleName.BUYER]) {
      roleIds[name] = (
        await prisma.role.create({ data: { name, description: `${name} role`, permissions: [] } })
      ).id;
    }

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tenant = await prisma.tenant.create({
      data: { name: 'Life Leads Plus', slug: `llp-${stamp}`, status: 'ACTIVE', whiteLabel: true },
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
  });

  it("invites a PUBLISHER linked to this tenant's publisher, with a one-time password", async () => {
    const address = email();
    const response = await invite({ email: address, role: 'PUBLISHER', publisherId });
    expect(response.statusCode, response.body).toBe(201);
    expect(response.json()).toMatchObject({
      roles: ['publisher'],
      publisherId,
      publisherName: 'Alpha Media',
      buyerId: null,
    });
    expect(response.json().tempPassword).toEqual(expect.any(String));

    const created = await prisma.user.findUniqueOrThrow({ where: { email: address } });
    expect(created).toMatchObject({ tenantId, publisherId, buyerId: null });
  });

  it("refuses another tenant's publisher with 400, and creates nobody", async () => {
    const address = email();
    const response = await invite({
      email: address,
      role: 'PUBLISHER',
      publisherId: foreignPublisherId,
    });
    expect(response.statusCode).toBe(400);
    expect(await prisma.user.count({ where: { email: address } })).toBe(0);
  });

  it('requires a publisherId for PUBLISHER', async () => {
    expect((await invite({ email: email(), role: 'PUBLISHER' })).statusCode).toBe(400);
  });

  it('refuses OWNER or ADMIN carrying a publisherId', async () => {
    for (const role of ['OWNER', 'ADMIN']) {
      const response = await invite({ email: email(), role, publisherId });
      expect(response.statusCode, role).toBe(400);
    }
  });

  it('refuses a BUYER with a publisherId and a PUBLISHER with a buyerId', async () => {
    expect((await invite({ email: email(), role: 'BUYER', buyerId, publisherId })).statusCode).toBe(
      400
    );
    expect(
      (await invite({ email: email(), role: 'PUBLISHER', publisherId, buyerId })).statusCode
    ).toBe(400);
  });

  it('GET /api/v1/users returns publisherId beside buyerId', async () => {
    const address = email();
    expect((await invite({ email: address, role: 'PUBLISHER', publisherId })).statusCode).toBe(201);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: {
        authorization: `Bearer ${app.jwt.sign({ userId: ownerId, tenantId, email: 'o@t.local' })}`,
      },
    });
    expect(response.statusCode).toBe(200);
    const row = response.json().data.find((u: any) => u.email === address);
    expect(row).toMatchObject({ publisherId, buyerId: null });
    const owner = response.json().data.find((u: any) => u.id === ownerId);
    expect(owner).toHaveProperty('publisherId', null);
  });
});
