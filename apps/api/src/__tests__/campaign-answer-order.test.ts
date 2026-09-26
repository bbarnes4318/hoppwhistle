/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { RoleName } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { registerStaffOnly } from '../middleware/staff-only.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * "Who answers first" against a real database: the PUT writes the priorities,
 * the mode and an audit row together, and the two routes that add a row to a
 * campaign place it by the stored mode.
 */

const gate = databaseGate();
announceSkip('Campaign answer order', gate);

const TEST_JWT_SECRET = 'answer-order-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('Campaign answer order suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `answer order suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('PUT /api/v1/campaigns/:campaignId/answer-order', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;
  let tenantId: string;
  let ownerId: string;
  let agentIds: string[];
  let newAgentId: string;
  let buyerIds: string[];
  let campaignId: string;
  let publisherId: string;
  let foreignCampaignId: string;
  let normalOwner: { id: string; tenantId: string };

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);
    registerStaffOnly(instance);
    const { registerCampaignRoutes } = await import('../routes/index.js');
    const { registerAgentRosterRoutes } = await import('../routes/agent-roster.js');
    await instance.register(registerCampaignRoutes);
    await instance.register(registerAgentRosterRoutes);
    await instance.ready();
    return instance;
  }

  function send(
    method: 'PUT' | 'POST',
    url: string,
    payload: unknown,
    as = ownerId,
    tenant = tenantId
  ) {
    return app.inject({
      method,
      url,
      headers: {
        authorization: `Bearer ${app.jwt.sign({ userId: as, tenantId: tenant, email: 'x@t.local' })}`,
      },
      payload: payload as Record<string, unknown>,
    });
  }

  const setOrder = (answerOrder: unknown, id = campaignId) =>
    send('PUT', `/api/v1/campaigns/${id}/answer-order`, { answerOrder });

  async function priorities() {
    const [agents, buyers] = await Promise.all([
      prisma.campaignAgent.findMany({
        where: { campaignId },
        select: { userId: true, priority: true },
      }),
      prisma.campaignBuyer.findMany({
        where: { campaignId },
        select: { buyerId: true, priority: true },
      }),
    ]);
    return {
      agents: Object.fromEntries(agents.map(a => [a.userId, a.priority])),
      buyers: Object.fromEntries(buyers.map(b => [b.buyerId, b.priority])),
    };
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
    for (const name of [RoleName.OWNER, RoleName.AGENT]) {
      roleIds[name] = (
        await prisma.role.create({ data: { name, description: `${name} role`, permissions: [] } })
      ).id;
    }
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = async (tenant: string, role: RoleName, label: string) =>
      (
        await prisma.user.create({
          data: {
            tenantId: tenant,
            email: `${label}-${stamp}@agency.local`,
            status: 'ACTIVE',
            roles: { create: { roleId: roleIds[role] } },
          },
        })
      ).id;

    const tenant = await prisma.tenant.create({
      data: { name: 'Life Leads Plus', slug: `llp-${stamp}`, status: 'ACTIVE', whiteLabel: true },
    });
    tenantId = tenant.id;
    ownerId = await user(tenantId, RoleName.OWNER, 'owner');
    agentIds = [
      await user(tenantId, RoleName.AGENT, 'agent-1'),
      await user(tenantId, RoleName.AGENT, 'agent-2'),
    ];
    newAgentId = await user(tenantId, RoleName.AGENT, 'agent-new');

    publisherId = (
      await prisma.publisher.create({ data: { tenantId, name: 'Alpha', code: `p-${stamp}` } })
    ).id;
    campaignId = (
      await prisma.campaign.create({
        data: { tenantId, publisherId, name: 'Final Expense', metadata: { keep: 'me' } },
      })
    ).id;

    buyerIds = [];
    // A 50/50 split between two buyers at 5, and an overflow buyer at 9.
    for (const [i, priority] of [5, 5, 9].entries()) {
      const buyer = await prisma.buyer.create({
        data: { tenantId, name: `Buyer ${i}`, code: `b${i}-${stamp}` },
      });
      buyerIds.push(buyer.id);
      await prisma.campaignBuyer.create({
        data: {
          tenantId,
          campaignId,
          buyerId: buyer.id,
          destinationNumber: `+1512555010${i}`,
          priority,
        },
      });
    }
    for (const userId of agentIds) {
      await prisma.campaignAgent.create({ data: { tenantId, campaignId, userId, priority: 3 } });
    }

    const other = await prisma.tenant.create({
      data: { name: 'Ridgeline', slug: `ridge-${stamp}`, status: 'ACTIVE', whiteLabel: true },
    });
    const otherPublisher = await prisma.publisher.create({
      data: { tenantId: other.id, name: 'Theirs', code: `op-${stamp}` },
    });
    foreignCampaignId = (
      await prisma.campaign.create({
        data: { tenantId: other.id, publisherId: otherPublisher.id, name: 'Theirs' },
      })
    ).id;
    const plain = await prisma.tenant.create({
      data: { name: 'Plain', slug: `plain-${stamp}`, status: 'ACTIVE' },
    });
    normalOwner = { id: await user(plain.id, RoleName.OWNER, 'plain-owner'), tenantId: plain.id };
  });

  it('AGENTS_FIRST writes the priorities, stores the mode and audits it, in one go', async () => {
    const response = await setOrder('AGENTS_FIRST');
    expect(response.statusCode, response.body).toBe(200);

    const [b0, b1, b2] = buyerIds;
    expect(await priorities()).toEqual({
      agents: { [agentIds[0]]: 0, [agentIds[1]]: 0 },
      buyers: { [b0]: 10, [b1]: 10, [b2]: 14 },
    });

    const data = response.json().data;
    expect(data.answerOrder).toBe('AGENTS_FIRST');
    expect(data.agents).toHaveLength(2);
    expect(data.agents).toEqual(
      expect.arrayContaining([
        { userId: agentIds[0], priority: 0 },
        { userId: agentIds[1], priority: 0 },
      ])
    );
    expect(data.buyers).toEqual(
      expect.arrayContaining([
        { buyerId: b0, priority: 10 },
        { buyerId: b1, priority: 10 },
        { buyerId: b2, priority: 14 },
      ])
    );

    const campaign = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    expect(campaign.metadata).toEqual({ keep: 'me', answerOrder: 'AGENTS_FIRST' });

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'campaign.answer_order.set' },
    });
    expect(audit).toMatchObject({
      tenantId,
      userId: ownerId,
      entityType: 'Campaign',
      entityId: campaignId,
    });
    expect(audit.changes).toMatchObject({
      before: { answerOrder: null },
      after: { answerOrder: 'AGENTS_FIRST' },
    });
  });

  it('BUYERS_FIRST then TOGETHER re-rank from the buyers own order', async () => {
    const [b0, b1, b2] = buyerIds;
    expect((await setOrder('BUYERS_FIRST')).statusCode).toBe(200);
    expect(await priorities()).toEqual({
      agents: { [agentIds[0]]: 1000, [agentIds[1]]: 1000 },
      buyers: { [b0]: 0, [b1]: 0, [b2]: 4 },
    });

    expect((await setOrder('TOGETHER')).statusCode).toBe(200);
    expect(await priorities()).toEqual({
      agents: { [agentIds[0]]: 0, [agentIds[1]]: 0 },
      buyers: { [b0]: 0, [b1]: 0, [b2]: 4 },
    });
  });

  it("refuses a bad value with 400, and another tenant's campaign with 404", async () => {
    expect((await setOrder('SOMETIMES')).statusCode).toBe(400);
    expect((await setOrder(undefined)).statusCode).toBe(400);
    expect((await setOrder('TOGETHER', foreignCampaignId)).statusCode).toBe(404);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('is a campaign write: a normal agency owner is refused', async () => {
    const response = await send(
      'PUT',
      `/api/v1/campaigns/${campaignId}/answer-order`,
      { answerOrder: 'TOGETHER' },
      normalOwner.id,
      normalOwner.tenantId
    );
    expect(response.statusCode).toBe(403);
  });

  it('puts a newly assigned agent at 0 on an AGENTS_FIRST campaign', async () => {
    expect((await setOrder('AGENTS_FIRST')).statusCode).toBe(200);

    const response = await send('PUT', `/api/v1/agent-roster/${newAgentId}/campaigns`, {
      campaignIds: [campaignId],
    });
    expect(response.statusCode, response.body).toBe(200);
    expect((await priorities()).agents[newAgentId]).toBe(0);
  });

  it('puts a newly assigned agent at 1000 on a BUYERS_FIRST campaign, and leaves one with no mode alone', async () => {
    const response = await send('PUT', `/api/v1/agent-roster/${newAgentId}/campaigns`, {
      campaignIds: [campaignId],
    });
    expect(response.statusCode).toBe(200);
    expect((await priorities()).agents[newAgentId]).toBeNull();

    await prisma.campaignAgent.deleteMany({ where: { userId: newAgentId } });
    expect((await setOrder('BUYERS_FIRST')).statusCode).toBe(200);
    await send('PUT', `/api/v1/agent-roster/${newAgentId}/campaigns`, {
      campaignIds: [campaignId],
    });
    expect((await priorities()).agents[newAgentId]).toBe(1000);
  });

  it('re-ranks the whole campaign when a buyer is added to one with a mode', async () => {
    expect((await setOrder('AGENTS_FIRST')).statusCode).toBe(200);
    const extra = await prisma.buyer.create({
      data: { tenantId, name: 'Late buyer', code: `late-${Date.now()}` },
    });

    const response = await send('POST', `/api/v1/campaigns/${campaignId}/buyers`, {
      buyerId: extra.id,
      destinationNumber: '5125550199',
      priority: 2,
    });
    expect(response.statusCode, response.body).toBe(201);

    // Existing buyers sat at 10, 10, 14; the new one arrives at 2, below them
    // all, so it becomes the minimum and everybody is re-ranked from it.
    const [b0, b1, b2] = buyerIds;
    expect((await priorities()).buyers).toEqual({ [b0]: 18, [b1]: 18, [b2]: 22, [extra.id]: 10 });
    expect(response.json().data).toMatchObject({ buyerId: extra.id, priority: 10 });
  });
});
