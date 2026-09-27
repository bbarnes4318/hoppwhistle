/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { RoleName } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { registerReadOnlyPreview } from '../middleware/read-only-preview.js';
import { registerStaffOnly } from '../middleware/staff-only.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * A downline agency can take calls.
 *
 *   /api/auth/me             isChild, and the parent's name for "Contact ..."
 *   POST /api/v1/campaigns   a child's OWNER creates one, with no publisher
 *   agent roster, numbers    and attaches its own agent and number to it
 *   brand                    the parent's, live, including after it changes
 *   settings                 the parent sets the child's number limit; nobody
 *                            else can
 */

const gate = databaseGate();
announceSkip('Child agencies', gate);

const TEST_JWT_SECRET = 'child-agency-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('Child agency suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `child agency suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('Child agencies', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;
  let parent: { id: string; ownerId: string };
  let child: { id: string; ownerId: string; agentId: string };
  let other: { id: string; ownerId: string };

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);
    registerReadOnlyPreview(instance);
    registerStaffOnly(instance);
    const { registerAuthRoutes } = await import('../routes/auth.js');
    const { registerNetworkRoutes } = await import('../routes/network.js');
    const { registerAgentRosterRoutes } = await import('../routes/agent-roster.js');
    const { registerCampaignRoutes, registerNumberRoutes } = await import('../routes/index.js');
    await instance.register(registerAuthRoutes);
    await instance.register(registerNetworkRoutes);
    await instance.register(registerAgentRosterRoutes);
    await instance.register(registerCampaignRoutes);
    await instance.register(registerNumberRoutes);
    await instance.ready();
    return instance;
  }

  const as = (userId: string, tenantId: string) => ({
    authorization: `Bearer ${app.jwt.sign({ userId, tenantId, email: `${userId}@t.local` })}`,
  });

  const send = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    url: string,
    who: { userId: string; tenantId: string },
    payload?: Record<string, unknown>
  ) => app.inject({ method, url, headers: as(who.userId, who.tenantId), payload });

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
    const roles: Record<string, string> = {};
    for (const name of [RoleName.OWNER, RoleName.AGENT]) {
      roles[name] = (
        await prisma.role.create({ data: { name, description: name, permissions: [] } })
      ).id;
    }
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const user = async (tenantId: string, role: string, tag: string) =>
      (
        await prisma.user.create({
          data: {
            tenantId,
            email: `${tag}-${stamp}@t.test`,
            status: 'ACTIVE',
            roles: { create: { roleId: roles[role] } },
          },
        })
      ).id;

    const parentId = (
      await prisma.tenant.create({
        data: {
          name: 'Life Leads Plus LLC',
          slug: `llp-${stamp}`,
          status: 'ACTIVE',
          whiteLabel: true,
          brandTheme: 'life-leads-plus',
          brandName: 'Life Leads Plus',
        },
      })
    ).id;
    parent = { id: parentId, ownerId: await user(parentId, 'OWNER', 'parent-owner') };

    const childId = (
      await prisma.tenant.create({
        data: {
          name: 'Downline',
          slug: `down-${stamp}`,
          status: 'ACTIVE',
          parentTenantId: parentId,
        },
      })
    ).id;
    child = {
      id: childId,
      ownerId: await user(childId, 'OWNER', 'child-owner'),
      agentId: await user(childId, 'AGENT', 'child-agent'),
    };

    const otherId = (
      await prisma.tenant.create({
        data: { name: 'Elsewhere', slug: `else-${stamp}`, status: 'ACTIVE', whiteLabel: true },
      })
    ).id;
    other = { id: otherId, ownerId: await user(otherId, 'OWNER', 'other-owner') };
  });

  const childOwner = () => ({ userId: child.ownerId, tenantId: child.id });
  const parentOwner = () => ({ userId: parent.ownerId, tenantId: parent.id });

  it("says it is a child, and names the parent's brand", async () => {
    const me = await send('GET', '/api/auth/me', childOwner());
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ isChild: true, parentBrandName: 'Life Leads Plus' });

    const parentMe = await send('GET', '/api/auth/me', parentOwner());
    expect(parentMe.json()).toMatchObject({ isChild: false, parentBrandName: null });
  });

  it('creates a campaign and attaches its own agent and number', async () => {
    const created = await send('POST', '/api/v1/campaigns', childOwner(), {
      name: 'Final Expense',
    });
    expect(created.statusCode, created.body).toBe(201);
    const campaignId = created.json().id;
    const campaign = await prisma.campaign.findUniqueOrThrow({
      where: { id: campaignId },
      include: { publisher: true },
    });
    expect(campaign.tenantId).toBe(child.id);
    // Its own direct publisher, not the parent's.
    expect(campaign.publisher.tenantId).toBe(child.id);

    const edited = await send('PATCH', `/api/v1/campaigns/${campaignId}`, childOwner(), {
      name: 'Final Expense (TX)',
    });
    expect(edited.statusCode, edited.body).toBe(200);

    const assigned = await send(
      'PUT',
      `/api/v1/agent-roster/${child.agentId}/campaigns`,
      childOwner(),
      { campaignIds: [campaignId] }
    );
    expect(assigned.statusCode, assigned.body).toBe(200);
    expect(await prisma.campaignAgent.count({ where: { campaignId, userId: child.agentId } })).toBe(
      1
    );

    const number = await prisma.phoneNumber.create({
      data: { tenantId: child.id, number: '+15125550100', status: 'ACTIVE', provider: 'fractel' },
    });
    const attached = await send('PATCH', `/api/v1/numbers/${number.id}`, childOwner(), {
      campaignId,
    });
    expect(attached.statusCode, attached.body).toBe(200);
    expect(await prisma.didRoute.count({ where: { phoneNumberId: number.id, campaignId } })).toBe(
      1
    );
  });

  it('keeps publishers and buyers closed to a child', async () => {
    const { isChildAgencyAllowed } = await import('../lib/staff-only-endpoints.js');
    expect(isChildAgencyAllowed('POST', '/api/v1/publishers')).toBe(false);
    expect(isChildAgencyAllowed('POST', '/api/v1/buyers')).toBe(false);
  });

  it("is drawn in the parent's brand, and follows it when the parent rebrands", async () => {
    const before = await send('GET', '/api/auth/me', childOwner());
    expect(before.json().brand).toEqual({ theme: 'life-leads-plus', name: 'Life Leads Plus' });

    await prisma.tenant.update({ where: { id: parent.id }, data: { brandName: 'LLP Direct' } });
    const after = await send('GET', '/api/auth/me', childOwner());
    expect(after.json().brand).toEqual({ theme: 'life-leads-plus', name: 'LLP Direct' });
    expect(after.json().parentBrandName).toBe('LLP Direct');
  });

  it("lets the parent set its child's number limit, and nobody else", async () => {
    const set = await send('PUT', `/api/v1/network/agencies/${child.id}/settings`, parentOwner(), {
      maxPhoneNumbers: 40,
      upgrades: [],
    });
    expect(set.statusCode, set.body).toBe(200);
    expect(
      (await prisma.tenantQuota.findUniqueOrThrow({ where: { tenantId: child.id } }))
        .maxPhoneNumbers
    ).toBe(40);
    expect(
      await prisma.auditLog.count({ where: { action: { startsWith: 'network.agency.settings' } } })
    ).toBe(2);

    const list = await send('GET', '/api/v1/network/agencies', parentOwner());
    expect(list.json().data.agencies[0]).toMatchObject({ tenantId: child.id, numbersLimit: 40 });

    // Another white-label agency: not its child, so not found.
    const foreign = await send(
      'PUT',
      `/api/v1/network/agencies/${child.id}/settings`,
      {
        userId: other.ownerId,
        tenantId: other.id,
      },
      { maxPhoneNumbers: 999 }
    );
    expect(foreign.statusCode).toBe(404);

    // The child itself cannot raise its own limit.
    const self = await send('PUT', `/api/v1/network/agencies/${child.id}/settings`, childOwner(), {
      maxPhoneNumbers: 999,
    });
    expect(self.statusCode).toBe(403);

    expect(
      (await prisma.tenantQuota.findUniqueOrThrow({ where: { tenantId: child.id } }))
        .maxPhoneNumbers
    ).toBe(40);
  });
});
