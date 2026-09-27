/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { CallDirection, CallStatus, Prisma, RoleName } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { resolvePeriod } from '../services/leaderboard/period.js';
import { getCallSalesSummary } from '../services/reporting/call-sales.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * GET /api/v1/publishers/:publisherId/stats -- the owner's "View stats" drawer
 * and the publisher portal's dashboard.
 *
 *   The counts and payout are the publisher's Sales row for the same period,
 *   billable split into to-buyers and answered-by-your-agents.
 *   Revenue and profit reach the agency's owner and never a publisher.
 *   The portal's legacy `startDate`/`endDate` still reads a range.
 */

const gate = databaseGate();
announceSkip('Publisher stats', gate);

const TEST_JWT_SECRET = 'publisher-stats-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

/** A closed, fixed period well before DST starts on 2026-03-08: New York is UTC-5. */
const FROM = '2026-03-01';
const TO = '2026-03-05';
const PERIOD = `period=CUSTOM&from=${FROM}&to=${TO}`;

describe('Publisher stats suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `publisher stats suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('Publisher stats', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;

  let tenantId: string;
  let otherTenantId: string;
  let publisherId: string;
  let ownerId: string;
  let agentId: string;
  let publisherUserId: string;
  let otherOwnerId: string;
  let seq = 0;

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

  function get(url: string, userId: string, tenant = tenantId) {
    return app.inject({
      method: 'GET',
      url,
      headers: {
        authorization: `Bearer ${app.jwt.sign({ userId, tenantId: tenant, email: 'x@t.local' })}`,
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
    for (const name of [RoleName.OWNER, RoleName.AGENT, RoleName.PUBLISHER]) {
      roleIds[name] = (
        await prisma.role.create({ data: { name, description: `${name} role`, permissions: [] } })
      ).id;
    }

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    tenantId = (
      await prisma.tenant.create({
        data: { name: 'Alpha', slug: `alpha-${stamp}`, status: 'ACTIVE', whiteLabel: true },
      })
    ).id;
    otherTenantId = (
      await prisma.tenant.create({
        data: { name: 'Bravo', slug: `bravo-${stamp}`, status: 'ACTIVE', whiteLabel: true },
      })
    ).id;

    publisherId = (
      await prisma.publisher.create({ data: { tenantId, name: 'Own', code: `OWN-${stamp}` } })
    ).id;
    const siblingPublisherId = (
      await prisma.publisher.create({ data: { tenantId, name: 'Sibling', code: `SIB-${stamp}` } })
    ).id;
    const buyerId = (
      await prisma.buyer.create({ data: { tenantId, name: 'Buyer', code: `B-${stamp}` } })
    ).id;

    const user = async (
      label: string,
      role: RoleName,
      publisher: string | null = null,
      tenant = tenantId
    ) =>
      prisma.user.create({
        data: {
          tenantId: tenant,
          email: `${label}-${stamp}@test.local`,
          status: 'ACTIVE',
          publisherId: publisher,
          roles: { create: { roleId: roleIds[role] } },
        },
      });
    ownerId = (await user('owner', RoleName.OWNER)).id;
    agentId = (await user('agent', RoleName.AGENT)).id;
    publisherUserId = (await user('publisher', RoleName.PUBLISHER, publisherId)).id;
    otherOwnerId = (await user('other-owner', RoleName.OWNER, null, otherTenantId)).id;

    const call = async (at: string, data: Partial<Prisma.CallUncheckedCreateInput> = {}) =>
      prisma.call.create({
        data: {
          tenantId,
          publisherId,
          toNumber: '+15550000000',
          callSid: `pub-stats-${++seq}-${stamp}`,
          status: CallStatus.COMPLETED,
          direction: CallDirection.INBOUND,
          createdAt: new Date(at),
          ...data,
        },
      });

    // Sold to a buyer: revenue, payout and a cost.
    const sold = await call('2026-03-02T15:00:00Z', {
      buyerId,
      billable: true,
      buyerBillableAmount: new Prisma.Decimal('40.00'),
      publisherPayoutAmount: new Prisma.Decimal('12.50'),
      cost: new Prisma.Decimal('0.30'),
      connectedDuration: 300,
    });
    // Answered by one of the agency's agents: billable, paid, no revenue.
    await call('2026-03-03T15:00:00Z', {
      answeredByUserId: agentId,
      billable: true,
      buyerBillableAmount: new Prisma.Decimal('0'),
      publisherPayoutAmount: new Prisma.Decimal('8.00'),
      connectedDuration: 100,
    });
    // Not billable.
    await call('2026-03-04T15:00:00Z', { billable: false, connectedDuration: 10 });
    // Outbound: never a sold call, so in no figure.
    await call('2026-03-02T16:00:00Z', {
      direction: CallDirection.OUTBOUND,
      billable: true,
      publisherPayoutAmount: new Prisma.Decimal('99'),
    });
    // After the period.
    await call('2026-03-07T15:00:00Z', {
      billable: true,
      publisherPayoutAmount: new Prisma.Decimal('50'),
    });
    // Another publisher, same period.
    await call('2026-03-02T17:00:00Z', {
      publisherId: siblingPublisherId,
      billable: true,
      publisherPayoutAmount: new Prisma.Decimal('70'),
    });

    const account = await prisma.billingAccount.create({ data: { tenantId, name: 'Alpha' } });
    await prisma.accrualLedger.create({
      data: {
        tenantId,
        billingAccountId: account.id,
        callId: sold.id,
        type: 'RECORDING_FEE',
        amount: new Prisma.Decimal('0.05'),
        description: 'fixture',
        periodDate: new Date('2026-03-02T15:00:00Z'),
        idempotencyKey: `pub-stats-${sold.id}`,
      },
    });
  });

  it("gives the owner the Sales screen's publisher row, revenue and profit included", async () => {
    const res = await get(`/api/v1/publishers/${publisherId}/stats?${PERIOD}`, ownerId);
    expect(res.statusCode).toBe(200);
    const body = res.json();

    const summary = await getCallSalesSummary(
      tenantId,
      resolvePeriod('CUSTOM', { from: FROM, to: TO }),
      { prisma }
    );
    const row = summary.byPublisher.find(r => r.publisherId === publisherId)!;

    expect(body.period).toMatchObject({ key: 'CUSTOM', from: FROM, to: TO, days: 5 });
    expect(body.totalCalls).toBe(row.calls);
    expect(body.billableCalls).toBe(row.billable);
    expect(body.billableToBuyers).toBe(row.billableToBuyers);
    expect(body.billableAgentAnswered).toBe(row.billableAgentAnswered);
    expect(body.payout).toBe(row.payout);
    expect(body.revenue).toBe(row.revenue);
    expect(body.profit).toBe(row.profit);

    // And the row is what the fixture says.
    expect(body).toMatchObject({
      totalCalls: 3,
      billableCalls: 2,
      billableToBuyers: 1,
      billableAgentAnswered: 1,
      nonBillableCalls: 1,
      payout: 20.5,
      revenue: 40,
      // 40 - 20.50 payout - 0.30 cost - 0.05 recording fee
      profit: 19.15,
      averageConnectedDuration: 137,
    });
    expect(body.recentCalls).toHaveLength(3);
    expect(body.topCampaigns[0].callsCount).toBe(3);
  });

  it('never sends revenue or profit to the publisher, with the same counts', async () => {
    const owner = (await get(`/api/v1/publishers/${publisherId}/stats?${PERIOD}`, ownerId)).json();
    const res = await get(`/api/v1/publishers/${publisherId}/stats?${PERIOD}`, publisherUserId);
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body).not.toHaveProperty('revenue');
    expect(body).not.toHaveProperty('profit');
    expect(body.totalCalls).toBe(owner.totalCalls);
    expect(body.billableCalls).toBe(owner.billableCalls);
    expect(body.payout).toBe(owner.payout);
  });

  it("reads the portal dashboard's startDate/endDate as the same range", async () => {
    const res = await get(
      `/api/v1/publishers/${publisherId}/stats?startDate=${FROM}&endDate=${TO}`,
      publisherUserId
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      period: { from: FROM, to: TO },
      totalCalls: 3,
      billableCalls: 2,
      payout: 20.5,
    });
  });

  it("refuses another publisher's user and another tenant's owner", async () => {
    const otherPublisher = await prisma.publisher.findFirstOrThrow({
      where: { tenantId, NOT: { id: publisherId } },
    });
    expect(
      (await get(`/api/v1/publishers/${otherPublisher.id}/stats?${PERIOD}`, publisherUserId))
        .statusCode
    ).toBe(403);
    expect(
      (await get(`/api/v1/publishers/${publisherId}/stats?${PERIOD}`, otherOwnerId, otherTenantId))
        .statusCode
    ).toBe(404);
  });
});
