/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { RoleName } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * A buyer need not have a publisher (`Buyer.publisherId` is nullable), and
 * every Life Leads Plus buyer has none.
 *
 *   POST  /api/v1/buyers            creates one without a publisher
 *   PATCH /api/v1/buyers/:buyerId   saves one with publisher null, and clears it
 *
 * A publisher that is named must still be the acting tenant's.
 */

const gate = databaseGate();
announceSkip('Buyer publisher optional', gate);

const TEST_JWT_SECRET = 'buyer-publisher-optional-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('Buyer publisher optional suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `buyer publisher suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('Buyer publisher optional', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;

  let tenantId: string;
  let ownerId: string;
  let publisherId: string;
  let foreignPublisherId: string;

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);
    const { registerBuyerBillingRoutes } = await import('../routes/buyer-billing.js');
    await instance.register(registerBuyerBillingRoutes);
    await instance.ready();
    return instance;
  }

  function send(method: 'POST' | 'PATCH', url: string, payload: Record<string, unknown>) {
    return app.inject({
      method,
      url,
      payload,
      headers: {
        authorization: `Bearer ${app.jwt.sign({ userId: ownerId, tenantId, email: 'o@t.local' })}`,
      },
    });
  }

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

    const role = await prisma.role.create({
      data: { name: RoleName.OWNER, description: 'OWNER role', permissions: [] },
    });
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    tenantId = (
      await prisma.tenant.create({
        data: { name: 'Life Leads Plus', slug: `llp-${stamp}`, status: 'ACTIVE', whiteLabel: true },
      })
    ).id;
    const otherTenantId = (
      await prisma.tenant.create({
        data: { name: 'Other', slug: `other-${stamp}`, status: 'ACTIVE' },
      })
    ).id;
    ownerId = (
      await prisma.user.create({
        data: {
          tenantId,
          email: `owner-${stamp}@test.local`,
          status: 'ACTIVE',
          roles: { create: { roleId: role.id } },
        },
      })
    ).id;
    publisherId = (
      await prisma.publisher.create({ data: { tenantId, name: 'Own', code: `OWN-${stamp}` } })
    ).id;
    foreignPublisherId = (
      await prisma.publisher.create({
        data: { tenantId: otherTenantId, name: 'Foreign', code: `FOR-${stamp}` },
      })
    ).id;
  });

  it('creates a buyer without a publisher', async () => {
    const res = await send('POST', '/api/v1/buyers', { name: 'Acme', code: 'ACME' });
    expect(res.statusCode).toBe(201);
    expect(res.json().publisher).toBeNull();

    const row = await prisma.buyer.findFirstOrThrow({ where: { tenantId, code: 'ACME' } });
    expect(row.publisherId).toBeNull();
  });

  it('treats an empty publisherId on create as none', async () => {
    const res = await send('POST', '/api/v1/buyers', {
      name: 'Acme',
      code: 'ACME',
      publisherId: '',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().publisher).toBeNull();
  });

  it('still attaches a publisher of its own tenant', async () => {
    const res = await send('POST', '/api/v1/buyers', { name: 'Acme', code: 'ACME', publisherId });
    expect(res.statusCode).toBe(201);
    expect(res.json().publisher).toEqual({ id: publisherId, name: 'Own' });
  });

  it("refuses another tenant's publisher on create and on update", async () => {
    const created = await send('POST', '/api/v1/buyers', {
      name: 'Acme',
      code: 'ACME',
      publisherId: foreignPublisherId,
    });
    expect(created.statusCode).toBe(404);
    expect(await prisma.buyer.count({ where: { tenantId } })).toBe(0);

    const buyer = await prisma.buyer.create({ data: { tenantId, name: 'B', code: 'B' } });
    const updated = await send('PATCH', `/api/v1/buyers/${buyer.id}`, {
      publisherId: foreignPublisherId,
    });
    expect(updated.statusCode).toBe(404);
    expect((await prisma.buyer.findUniqueOrThrow({ where: { id: buyer.id } })).publisherId).toBe(
      null
    );
  });

  it('saves a buyer whose publisher is null, as the edit form sends it', async () => {
    const buyer = await prisma.buyer.create({ data: { tenantId, name: 'B', code: 'B' } });
    const res = await send('PATCH', `/api/v1/buyers/${buyer.id}`, {
      name: 'Renamed',
      code: 'B',
      subId: '',
      publisherId: null,
      billingType: 'TERMS',
      billableDuration: 90,
      canPauseTargets: false,
      canSetCaps: false,
      canDisputeConversions: false,
      status: 'ACTIVE',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'Renamed', billableDuration: 90, publisher: null });
  });

  it('sets and then clears a publisher on update', async () => {
    const buyer = await prisma.buyer.create({ data: { tenantId, name: 'B', code: 'B' } });

    const set = await send('PATCH', `/api/v1/buyers/${buyer.id}`, { publisherId });
    expect(set.statusCode).toBe(200);
    expect(set.json().publisher).toEqual({ id: publisherId, name: 'Own' });

    const cleared = await send('PATCH', `/api/v1/buyers/${buyer.id}`, { publisherId: '' });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().publisher).toBeNull();
  });
});
