/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { RoleName } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { registerStaffOnly } from '../middleware/staff-only.js';
import { billMonth } from '../services/numbers/number-charges.js';
import { provisioningService } from '../services/provisioning/provisioning-service.js';
import type { ProvisionedNumber } from '../services/provisioning/types.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * An agency buying, routing and releasing its own numbers, against a real
 * database, with the carrier replaced by a spy.
 *
 * A NORMAL agency's OWNER (not white-label, not staff) is the principal
 * throughout: numbers are every agency's now.
 */

const gate = databaseGate();
announceSkip('Agency numbers', gate);

const TEST_JWT_SECRET = 'agency-numbers-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('Agency numbers suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `agency numbers suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('Agency numbers', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;
  let tenantId: string;
  let ownerId: string;
  let agentId: string;
  let campaignId: string;
  let parentId: string;
  let childId: string;
  let childOwnerId: string;
  let nextDid = 0;

  let purchaseAtCarrier: ReturnType<typeof vi.spyOn>;
  let releaseAtCarrier: ReturnType<typeof vi.spyOn>;

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);
    registerStaffOnly(instance);
    const { registerNumberRoutes } = await import('../routes/index.js');
    const { registerFractelProcurementRoutes } = await import('../routes/fractel-procurement.js');
    const { registerBulkvsProcurementRoutes } = await import('../routes/bulkvs-procurement.js');
    const { registerAnveoProcurementRoutes } = await import('../routes/anveo-procurement.js');
    await instance.register(registerNumberRoutes);
    await instance.register(registerFractelProcurementRoutes);
    await instance.register(registerBulkvsProcurementRoutes);
    await instance.register(registerAnveoProcurementRoutes);
    await instance.ready();
    return instance;
  }

  const as = (userId: string, tenant: string) => ({
    authorization: `Bearer ${app.jwt.sign({ userId, tenantId: tenant, email: `${userId}@t.local` })}`,
  });

  function buy(payload: Record<string, unknown>, user = ownerId, tenant = tenantId) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/fractel/purchase',
      headers: as(user, tenant),
      payload,
    });
  }

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    purchaseAtCarrier = vi
      .spyOn(provisioningService, 'purchaseAtCarrier')
      .mockImplementation((provider, request) => {
        nextDid += 1;
        const number =
          request.number ?? `+1${request.areaCode ?? '608'}555${String(nextDid).padStart(4, '0')}`;
        return Promise.resolve({
          id: '',
          number,
          provider,
          status: 'active',
          providerId: `carrier-${number}`,
          features: { voice: true },
          purchasedAt: new Date(),
        } as ProvisionedNumber);
      });
    releaseAtCarrier = vi
      .spyOn(provisioningService, 'releaseAtCarrier')
      .mockResolvedValue(undefined);

    prisma = getPrismaClient();
    for (const table of ['audit_logs', 'roles', 'tenants']) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }
    const roles: Record<string, string> = {};
    for (const name of [RoleName.OWNER, RoleName.AGENT]) {
      roles[name] = (
        await prisma.role.create({ data: { name, description: name, permissions: [] } })
      ).id;
    }

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    tenantId = (
      await prisma.tenant.create({
        data: { name: 'Ridgeline', slug: `ridge-${stamp}`, status: 'ACTIVE' },
      })
    ).id;
    ownerId = (
      await prisma.user.create({
        data: {
          tenantId,
          email: `owner-${stamp}@ridge.test`,
          status: 'ACTIVE',
          roles: { create: { roleId: roles.OWNER } },
        },
      })
    ).id;
    agentId = (
      await prisma.user.create({
        data: {
          tenantId,
          email: `agent-${stamp}@ridge.test`,
          status: 'ACTIVE',
          roles: { create: { roleId: roles.AGENT } },
        },
      })
    ).id;
    const publisher = await prisma.publisher.create({
      data: { tenantId, name: 'House', code: `p-${stamp}` },
    });
    campaignId = (
      await prisma.campaign.create({
        data: { tenantId, name: 'Final Expense', publisherId: publisher.id },
      })
    ).id;

    parentId = (
      await prisma.tenant.create({
        data: {
          name: 'Life Leads Plus',
          slug: `llp-${stamp}`,
          status: 'ACTIVE',
          whiteLabel: true,
          metadata: { numberPricing: { setup: 5, monthly: 3 } },
        },
      })
    ).id;
    childId = (
      await prisma.tenant.create({
        data: {
          name: 'Downline',
          slug: `down-${stamp}`,
          status: 'ACTIVE',
          parentTenantId: parentId,
        },
      })
    ).id;
    childOwnerId = (
      await prisma.user.create({
        data: {
          tenantId: childId,
          email: `child-owner-${stamp}@down.test`,
          status: 'ACTIVE',
          roles: { create: { roleId: roles.OWNER } },
        },
      })
    ).id;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lets a normal agency OWNER buy a number, charged and unattached by default', async () => {
    const response = await buy({ areaCode: '608' });
    expect(response.statusCode, response.body).toBe(201);
    const id = response.json().data.phoneNumber.id;

    const row = await prisma.phoneNumber.findUniqueOrThrow({ where: { id } });
    // The agency's number, not the purchaser's.
    expect(row).toMatchObject({ tenantId, userId: null, campaignId: null, status: 'ACTIVE' });

    const charges = await prisma.numberCharge.findMany({
      where: { phoneNumberId: id },
      orderBy: { kind: 'asc' },
    });
    expect(charges.map(c => c.kind)).toEqual(['MONTHLY', 'SETUP']);
    expect(charges.every(c => c.tenantId === tenantId)).toBe(true);
    expect(Number(charges[1].amount)).toBe(2.49);
    expect(Number(charges[0].amount)).toBeGreaterThan(0);
    expect(Number(charges[0].amount)).toBeLessThanOrEqual(1.49);

    // The first purchase gave the agency its default quota.
    const quota = await prisma.tenantQuota.findUniqueOrThrow({ where: { tenantId } });
    expect(quota.maxPhoneNumbers).toBe(25);
    expect(await prisma.didRoute.count({ where: { phoneNumberId: id } })).toBe(0);
  });

  it('attaches a purchased number to a campaign of its own, and not to anybody else’s', async () => {
    const response = await buy({ areaCode: '608', campaignId });
    expect(response.statusCode, response.body).toBe(201);
    const id = response.json().data.phoneNumber.id;
    expect(await prisma.phoneNumber.findUniqueOrThrow({ where: { id } })).toMatchObject({
      campaignId,
    });
    const route = await prisma.didRoute.findFirstOrThrow({ where: { phoneNumberId: id } });
    expect(route).toMatchObject({ campaignId, destination: 'Campaign', tenantId });

    const foreignPublisher = await prisma.publisher.create({
      data: { tenantId: parentId, name: 'Theirs', code: `fp-${Date.now()}` },
    });
    const foreign = await prisma.campaign.create({
      data: { tenantId: parentId, name: 'Theirs', publisherId: foreignPublisher.id },
    });
    const refused = await buy({ areaCode: '608', campaignId: foreign.id });
    expect(refused.statusCode).toBe(400);
    // Refused before the carrier was asked.
    expect(purchaseAtCarrier).toHaveBeenCalledTimes(1);
  });

  it('enforces the quota under concurrent purchases', async () => {
    await prisma.tenantQuota.create({ data: { tenantId, maxPhoneNumbers: 2 } });
    const results = await Promise.all(Array.from({ length: 6 }, () => buy({ areaCode: '608' })));
    const codes = results.map(r => r.statusCode).sort();
    expect(codes.filter(c => c === 201)).toHaveLength(2);
    expect(codes.filter(c => c === 403)).toHaveLength(4);
    expect(results.find(r => r.statusCode === 403)!.json().error.code).toBe('QUOTA_EXCEEDED');
    expect(await prisma.phoneNumber.count({ where: { tenantId } })).toBe(2);
    // The carrier was only ever asked for the two that fit.
    expect(purchaseAtCarrier).toHaveBeenCalledTimes(2);
  });

  it('counts an INACTIVE number the carrier still holds against the quota', async () => {
    await prisma.tenantQuota.create({ data: { tenantId, maxPhoneNumbers: 1 } });
    await prisma.phoneNumber.create({
      data: { tenantId, number: '+16085550000', status: 'INACTIVE', provider: 'fractel' },
    });
    expect((await buy({ areaCode: '608' })).statusCode).toBe(403);
  });

  it('releases the number at the carrier if recording it fails', async () => {
    // The carrier sells a number this agency already holds: the insert must
    // fail, and the carrier purchase must be undone.
    await prisma.phoneNumber.create({
      data: { tenantId, number: '+16085559999', status: 'ACTIVE', provider: 'fractel' },
    });
    const response = await buy({ number: '+16085559999' });
    expect(response.statusCode).toBe(409);
    expect(releaseAtCarrier).toHaveBeenCalledWith('fractel', 'carrier-+16085559999');
    expect(await prisma.numberCharge.count()).toBe(0);
  });

  it('releases a number: carrier adapter, routes removed, RELEASED, charge ended', async () => {
    const bought = await buy({ areaCode: '608', campaignId });
    const id = bought.json().data.phoneNumber.id;
    expect(await prisma.didRoute.count({ where: { phoneNumberId: id } })).toBe(1);

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/numbers/${id}`,
      headers: as(ownerId, tenantId),
    });
    expect(response.statusCode, response.body).toBe(200);
    const row = await prisma.phoneNumber.findUniqueOrThrow({ where: { id } });
    expect(releaseAtCarrier).toHaveBeenCalledWith('fractel', `carrier-${row.number}`);
    expect(row.status).toBe('RELEASED');
    expect(row.releasedAt).not.toBeNull();
    expect(await prisma.didRoute.count({ where: { phoneNumberId: id } })).toBe(0);

    const monthly = await prisma.numberCharge.findFirstOrThrow({
      where: { phoneNumberId: id, kind: 'MONTHLY' },
    });
    expect(monthly.periodEnd.getTime()).toBeLessThanOrEqual(Date.now());
    expect(
      await prisma.auditLog.count({ where: { action: 'number.released', entityId: id } })
    ).toBe(1);

    // Gone from the list, and it no longer counts against the quota.
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/numbers',
      headers: as(ownerId, tenantId),
    });
    expect(list.json().data).toHaveLength(0);
    expect(list.json().meta).toMatchObject({ numbersUsed: 0, numbersLimit: 25 });
  });

  it('leaves everything as it was when the carrier refuses the release', async () => {
    const id = (await buy({ areaCode: '608' })).json().data.phoneNumber.id;
    releaseAtCarrier.mockRejectedValueOnce(new Error('carrier said no'));
    const response = await app.inject({
      method: 'DELETE',
      url: `/api/v1/numbers/${id}`,
      headers: as(ownerId, tenantId),
    });
    expect(response.statusCode).toBe(502);
    expect((await prisma.phoneNumber.findUniqueOrThrow({ where: { id } })).status).toBe('ACTIVE');
  });

  it('does not let PATCH set a number INACTIVE', async () => {
    const id = (await buy({ areaCode: '608' })).json().data.phoneNumber.id;
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/v1/numbers/${id}`,
      headers: as(ownerId, tenantId),
      payload: { status: 'INACTIVE' },
    });
    expect(response.statusCode).toBe(400);
  });

  it('looks a number up inside the tenant only', async () => {
    const id = (await buy({ areaCode: '608' })).json().data.phoneNumber.id;
    const mine = await app.inject({
      method: 'GET',
      url: `/api/v1/numbers/${id}`,
      headers: as(ownerId, tenantId),
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.json()).toMatchObject({ id, tenantId });
    expect(mine.json().number).not.toBe('+15551234567');

    const theirs = await app.inject({
      method: 'GET',
      url: `/api/v1/numbers/${id}`,
      headers: as(childOwnerId, childId),
    });
    expect(theirs.statusCode).toBe(404);
    const release = await app.inject({
      method: 'DELETE',
      url: `/api/v1/numbers/${id}`,
      headers: as(childOwnerId, childId),
    });
    expect(release.statusCode).toBe(404);
  });

  it("shows an agency OWNER their agents' numbers and their own purchases, not platform inventory", async () => {
    // Platform inventory filed under the agency's tenant: an Anveo sync run while
    // staff were acting as it. Nobody's agent, nothing the agency paid for.
    const platform = await prisma.phoneNumber.create({
      data: { tenantId, number: '+18005550100', provider: 'anveo', importSource: 'anveo-sync' },
    });
    const agents = await prisma.phoneNumber.create({
      data: { tenantId, number: '+18005550101', provider: 'anveo', userId: agentId },
    });
    const bought = (await buy({ areaCode: '608' })).json().data.phoneNumber.id;

    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/numbers?limit=500',
      headers: as(ownerId, tenantId),
    });
    expect(list.statusCode, list.body).toBe(200);
    expect(
      list
        .json()
        .data.map((n: any) => n.id)
        .sort()
    ).toEqual([agents.id, bought].sort());

    for (const method of ['GET', 'PATCH', 'DELETE'] as const) {
      const response = await app.inject({
        method,
        url: `/api/v1/numbers/${platform.id}`,
        headers: as(ownerId, tenantId),
        ...(method === 'PATCH' ? { payload: { campaignId } } : {}),
      });
      expect(response.statusCode, `${method} ${response.body}`).toBe(404);
    }
    expect(releaseAtCarrier).not.toHaveBeenCalled();
    expect(
      await prisma.phoneNumber.findUniqueOrThrow({ where: { id: platform.id } })
    ).toMatchObject({ status: 'ACTIVE', campaignId: null });
  });

  it('keeps /numbers/existing and /anveo staff-only for an agency OWNER', async () => {
    for (const [method, url] of [
      ['POST', '/api/v1/numbers/existing'],
      ['GET', '/api/v1/anveo/countries'],
      ['POST', '/api/v1/anveo/purchase'],
      ['POST', '/api/v1/anveo/sync'],
    ] as const) {
      const response = await app.inject({
        method,
        url,
        headers: as(ownerId, tenantId),
        payload: method === 'POST' ? {} : undefined,
      });
      expect(response.statusCode, `${method} ${url}`).toBe(403);
    }
  });

  it('refuses an AGENT the purchase', async () => {
    expect((await buy({ areaCode: '608' }, agentId)).statusCode).toBe(403);
  });

  it("writes a child agency's charges to its white-label parent, at the parent's price", async () => {
    const response = await buy({ areaCode: '512' }, childOwnerId, childId);
    expect(response.statusCode, response.body).toBe(201);
    const id = response.json().data.phoneNumber.id;

    expect((await prisma.phoneNumber.findUniqueOrThrow({ where: { id } })).tenantId).toBe(childId);
    const charges = await prisma.numberCharge.findMany({ where: { phoneNumberId: id } });
    expect(charges).toHaveLength(2);
    for (const charge of charges) {
      expect(charge.tenantId).toBe(parentId);
      expect((charge.metadata as any).childTenantId).toBe(childId);
    }
    expect(Number(charges.find(c => c.kind === 'SETUP')!.amount)).toBe(5);
  });

  it('shows the price before purchase', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/numbers/pricing',
      headers: as(ownerId, tenantId),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ setup: 2.49, monthly: 1.49, numbersUsed: 0 });
  });

  it('bills the month idempotently from the monthly command', async () => {
    const next = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1));
    const a = (await buy({ areaCode: '608' })).json().data.phoneNumber.id;
    const b = (await buy({ areaCode: '512' }, childOwnerId, childId)).json().data.phoneNumber.id;

    // This month: both numbers already have their prorated row.
    expect((await billMonth(prisma)).written).toBe(0);

    const first = await billMonth(prisma, next);
    expect(first.written).toBe(2);
    const second = await billMonth(prisma, next);
    expect(second.written).toBe(0);

    const rows = await prisma.numberCharge.findMany({
      where: { kind: 'MONTHLY', periodStart: next },
    });
    expect(rows).toHaveLength(2);
    expect(Number(rows.find(r => r.phoneNumberId === a)!.amount)).toBe(1.49);
    const childRow = rows.find(r => r.phoneNumberId === b)!;
    expect(childRow.tenantId).toBe(parentId);
    expect(Number(childRow.amount)).toBe(3);
    expect((childRow.metadata as any).childTenantId).toBe(childId);
  });
});
