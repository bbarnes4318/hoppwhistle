/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { CallDirection, CallStatus, Prisma, RoleName } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { registerReadOnlyPreview } from '../middleware/read-only-preview.js';
import { registerStaffOnly } from '../middleware/staff-only.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * Buyers -> Buyer balances, against a real database.
 *
 *   GET /api/v1/buyers/balances
 *
 * An agency with a prepaid (UPFRONT) buyer and a TERMS buyer, and another
 * agency beside it with a buyer of its own. Each row carries the one figure
 * that fits its billing type -- the wallet, or this month's billable calls --
 * its status and pause reason, and its last top-up, which a return's refund is
 * not. Only the agency's OWNER or ADMIN may read it, and only its own buyers.
 */

const gate = databaseGate();
announceSkip('Buyer balances', gate);

const TEST_JWT_SECRET = 'buyer-balances-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('Buyer balances suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `buyer balances suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('GET /api/v1/buyers/balances', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;
  let seq = 0;

  let agency: {
    id: string;
    ownerId: string;
    adminId: string;
    agentId: string;
    upfrontId: string;
    termsId: string;
    pausedId: string;
  };
  let other: { id: string; ownerId: string; buyerId: string };

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);
    registerReadOnlyPreview(instance);
    registerStaffOnly(instance);
    const { registerBuyerBalanceRoutes } = await import('../routes/buyer-balances.js');
    await instance.register(registerBuyerBalanceRoutes);
    await instance.ready();
    return instance;
  }

  function get(userId: string, tenantId: string) {
    const token = app.jwt.sign({ userId, tenantId, email: `${userId}@test.local` });
    return app.inject({
      method: 'GET',
      url: '/api/v1/buyers/balances',
      headers: { authorization: `Bearer ${token}` },
    });
  }

  async function call(
    tenantId: string,
    data: Partial<Prisma.CallUncheckedCreateInput> & { createdAt: Date }
  ) {
    await prisma.call.create({
      data: {
        tenantId,
        toNumber: '+15550000000',
        callSid: `balances-call-${++seq}-${Date.now()}`,
        status: CallStatus.COMPLETED,
        direction: CallDirection.INBOUND,
        ...data,
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

    const roleIds: Record<string, string> = {};
    for (const name of [RoleName.OWNER, RoleName.ADMIN, RoleName.AGENT]) {
      roleIds[name] = (
        await prisma.role.create({ data: { name, description: `${name} role`, permissions: [] } })
      ).id;
    }

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    async function user(tenantId: string, role: RoleName, label: string) {
      return (
        await prisma.user.create({
          data: {
            tenantId,
            email: `${label}-${stamp}@agency.local`,
            status: 'ACTIVE',
            roles: { create: { roleId: roleIds[role] } },
          },
        })
      ).id;
    }
    async function buyer(tenantId: string, data: Partial<Prisma.BuyerUncheckedCreateInput>) {
      return (
        await prisma.buyer.create({
          data: { tenantId, name: 'Buyer', code: `buy-${++seq}`, ...data },
        })
      ).id;
    }

    const tenant = await prisma.tenant.create({
      data: { name: 'Life Leads Plus', slug: `llp-${stamp}`, status: 'ACTIVE', whiteLabel: true },
    });
    const upfrontId = await buyer(tenant.id, {
      name: 'Acme Senior',
      billingType: 'UPFRONT',
      walletBalance: new Prisma.Decimal('125.50'),
    });
    const termsId = await buyer(tenant.id, { name: 'Zen Health', billingType: 'TERMS' });
    const pausedId = await buyer(tenant.id, {
      name: 'Bolt Final Expense',
      billingType: 'UPFRONT',
      walletBalance: new Prisma.Decimal('0'),
      status: 'PAUSED',
      metadata: { pauseReason: 'WALLET_EMPTY' },
    });
    agency = {
      id: tenant.id,
      ownerId: await user(tenant.id, RoleName.OWNER, 'owner'),
      adminId: await user(tenant.id, RoleName.ADMIN, 'admin'),
      agentId: await user(tenant.id, RoleName.AGENT, 'agent'),
      upfrontId,
      termsId,
      pausedId,
    };

    const ridge = await prisma.tenant.create({
      data: { name: 'Ridgeline', slug: `ridge-${stamp}`, status: 'ACTIVE' },
    });
    other = {
      id: ridge.id,
      ownerId: await user(ridge.id, RoleName.OWNER, 'ridge-owner'),
      buyerId: await buyer(ridge.id, { name: 'Foreign Buyer', billingType: 'TERMS' }),
    };

    const now = new Date();
    const lastMonth = new Date(now.getTime() - 45 * 86_400_000);

    // The TERMS buyer: $50 + $30 billable this month. Not counted: a call that
    // was not billable, one from last month, and another agency's.
    await call(agency.id, {
      createdAt: now,
      buyerId: termsId,
      billable: true,
      buyerBillableAmount: new Prisma.Decimal('50'),
    });
    await call(agency.id, {
      createdAt: now,
      buyerId: termsId,
      billable: true,
      buyerBillableAmount: new Prisma.Decimal('30'),
    });
    await call(agency.id, {
      createdAt: now,
      buyerId: termsId,
      billable: false,
      buyerBillableAmount: new Prisma.Decimal('999'),
    });
    await call(agency.id, {
      createdAt: lastMonth,
      buyerId: termsId,
      billable: true,
      buyerBillableAmount: new Prisma.Decimal('700'),
    });
    await call(other.id, {
      createdAt: now,
      buyerId: other.buyerId,
      billable: true,
      buyerBillableAmount: new Prisma.Decimal('40'),
    });

    // The UPFRONT buyer's top-ups: $200 then $100, and a later return refund
    // that is not a top-up.
    const tx = (amount: string, description: string, createdAt: Date) =>
      prisma.buyerTransaction.create({
        data: {
          buyerId: upfrontId,
          amount: new Prisma.Decimal(amount),
          type: 'CREDIT',
          description,
          createdAt,
        },
      });
    await tx('200', 'Admin added $200.00', new Date(now.getTime() - 3 * 86_400_000));
    await tx('100', 'Admin added $100.00', new Date(now.getTime() - 2 * 86_400_000));
    await tx('40', 'Return accepted for call abc', new Date(now.getTime() - 86_400_000));
  });

  it('lists every buyer, UPFRONT and TERMS, with the figure that fits each', async () => {
    const response = await get(agency.ownerId, agency.id);
    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.data.map((row: any) => row.name)).toEqual([
      'Acme Senior',
      'Bolt Final Expense',
      'Zen Health',
    ]);
    const byId = new Map(body.data.map((row: any) => [row.id, row]));

    expect(byId.get(agency.upfrontId)).toMatchObject({
      billingType: 'UPFRONT',
      walletBalance: 125.5,
      billedThisMonth: null,
      status: 'ACTIVE',
      pauseReason: null,
      lastTopUp: { amount: 100 },
    });
    expect(byId.get(agency.termsId)).toEqual({
      id: agency.termsId,
      name: 'Zen Health',
      code: expect.any(String),
      billingType: 'TERMS',
      walletBalance: null,
      billedThisMonth: 80,
      status: 'ACTIVE',
      pauseReason: null,
      lastTopUp: null,
    });
    expect(byId.get(agency.pausedId)).toMatchObject({
      walletBalance: 0,
      status: 'PAUSED',
      pauseReason: 'WALLET_EMPTY',
    });
    expect(body.meta.total).toBe(3);
  });

  it("is the acting tenant's buyers only", async () => {
    const mine = await get(agency.ownerId, agency.id);
    expect(mine.body).not.toContain(other.buyerId);

    const theirs = (await get(other.ownerId, other.id)).json();
    expect(theirs.data.map((row: any) => row.id)).toEqual([other.buyerId]);
    expect(theirs.data[0].billedThisMonth).toBe(40);
  });

  it('is for the OWNER and ADMIN only', async () => {
    expect((await get(agency.adminId, agency.id)).statusCode).toBe(200);
    expect((await get(agency.agentId, agency.id)).statusCode).toBe(403);
    const anonymous = await app.inject({ method: 'GET', url: '/api/v1/buyers/balances' });
    expect(anonymous.statusCode).toBe(401);
  });
});
