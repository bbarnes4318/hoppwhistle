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
 * A white-label parent's page for one of its own agencies.
 *
 *   GET   /api/v1/network/agencies/:tenantId   record, owner, stats, settings
 *   PATCH /api/v1/network/agencies/:tenantId   the record, validated like
 *                                              onboarding, audited on both sides
 *
 * Only for a child of the acting tenant: anybody else's agency is 404.
 */

const gate = databaseGate();
announceSkip('Network agency detail', gate);

const TEST_JWT_SECRET = 'network-agency-detail-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('Network agency detail suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `network agency detail suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('Network agency detail', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;
  let parent: { id: string; ownerId: string };
  let child: { id: string; ownerId: string };
  let bare: { id: string };
  let other: { id: string; ownerId: string; childId: string };

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);
    registerReadOnlyPreview(instance);
    registerStaffOnly(instance);
    const { registerNetworkRoutes } = await import('../routes/network.js');
    await instance.register(registerNetworkRoutes);
    await instance.ready();
    return instance;
  }

  const send = (
    method: 'GET' | 'PATCH',
    url: string,
    who: { userId: string; tenantId: string },
    payload?: Record<string, unknown>
  ) =>
    app.inject({
      method,
      url,
      headers: {
        authorization: `Bearer ${app.jwt.sign({ userId: who.userId, tenantId: who.tenantId, email: `${who.userId}@t.local` })}`,
      },
      payload,
    });

  const PROFILE = {
    legalName: 'Downline Insurance LLC',
    state: 'TX',
    contactName: 'Dana Down',
    contactEmail: 'dana@downline.test',
    contactPhone: '+15125550100',
    licensedAgentCount: 4,
    deliveryDays: ['MON', 'TUE', 'WED'],
    deliveryStartTime: '09:00',
    deliveryEndTime: '17:00',
    deliveryTimeZone: 'America/Chicago',
  };

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    prisma = getPrismaClient();
    for (const table of ['audit_logs', 'roles', 'tenants', 'upgrade_requests']) {
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
    const tenant = async (name: string, data: Record<string, unknown> = {}) =>
      (
        await prisma.tenant.create({
          data: {
            name,
            slug: `${name.toLowerCase().replace(/\W+/g, '-')}-${stamp}`,
            status: 'ACTIVE',
            ...data,
          },
        })
      ).id;

    const parentId = await tenant('Life Leads Plus', { whiteLabel: true });
    parent = { id: parentId, ownerId: await user(parentId, 'OWNER', 'parent-owner') };

    const childId = await tenant('Downline', { parentTenantId: parentId });
    await prisma.agencyProfile.create({ data: { tenantId: childId, ...PROFILE } });
    child = { id: childId, ownerId: await user(childId, 'OWNER', 'child-owner') };
    await user(childId, 'AGENT', 'child-agent');

    bare = { id: await tenant('No Profile Yet', { parentTenantId: parentId }) };

    const otherId = await tenant('Elsewhere', { whiteLabel: true });
    other = {
      id: otherId,
      ownerId: await user(otherId, 'OWNER', 'other-owner'),
      childId: await tenant('Their Child', { parentTenantId: otherId }),
    };
  });

  const parentOwner = () => ({ userId: parent.ownerId, tenantId: parent.id });

  it('answers the child: record, owner, stats, settings and open requests', async () => {
    await prisma.upgradeRequest.create({
      data: { tenantId: child.id, upgradeKey: 'VOICE_STUDIO' },
    });

    const res = await send(
      'GET',
      `/api/v1/network/agencies/${child.id}?period=THIS_MONTH`,
      parentOwner()
    );
    expect(res.statusCode, res.body).toBe(200);
    const data = res.json().data;
    expect(data).toMatchObject({
      tenantId: child.id,
      name: 'Downline',
      status: 'ACTIVE',
      profile: PROFILE,
      owner: { status: 'ACCEPTED' },
      settings: { tenantId: child.id, upgrades: [] },
      period: { key: 'THIS_MONTH' },
      stats: {
        agents: 1,
        inboundCalls: 0,
        answeredByAgents: 0,
        applications: 0,
        closingPct: null,
      },
      openUpgradeRequests: [{ upgradeKey: 'VOICE_STUDIO', status: 'OPEN' }],
    });
    expect(typeof data.settings.numbersLimit).toBe('number');
  });

  it('answers a child with no profile yet with profile null', async () => {
    const res = await send('GET', `/api/v1/network/agencies/${bare.id}`, parentOwner());
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data.profile).toBeNull();
    expect(res.json().data.owner.status).toBe('NOT_INVITED');
  });

  it("is 404 for another agency's child, for an unrelated agency, and refuses the child itself", async () => {
    for (const id of [other.childId, other.id, 'no-such-tenant']) {
      const get = await send('GET', `/api/v1/network/agencies/${id}`, parentOwner());
      expect(get.statusCode, id).toBe(404);
      const patch = await send('PATCH', `/api/v1/network/agencies/${id}`, parentOwner(), {
        name: 'Hijacked',
      });
      expect(patch.statusCode, id).toBe(404);
    }
    expect(await prisma.tenant.count({ where: { name: 'Hijacked' } })).toBe(0);

    const self = await send(
      'PATCH',
      `/api/v1/network/agencies/${child.id}`,
      {
        userId: child.ownerId,
        tenantId: child.id,
      },
      { name: 'Self-renamed' }
    );
    expect(self.statusCode).toBe(403);
  });

  it('edits the name and the fields sent, keeps the rest, and audits both sides', async () => {
    const res = await send('PATCH', `/api/v1/network/agencies/${child.id}`, parentOwner(), {
      name: 'Downline Direct',
      contactEmail: 'NEW@Downline.test',
      licensedAgentCount: 9,
      deliveryDays: ['fri', 'MON'],
      deliveryEndTime: '18:30',
      status: 'SUSPENDED',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().data).toMatchObject({
      name: 'Downline Direct',
      profile: {
        ...PROFILE,
        contactEmail: 'new@downline.test',
        licensedAgentCount: 9,
        deliveryDays: ['MON', 'FRI'],
        deliveryEndTime: '18:30',
      },
    });

    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: child.id } });
    expect(tenant.name).toBe('Downline Direct');
    // Status is not the parent's to change.
    expect(tenant.status).toBe('ACTIVE');

    const audits = await prisma.auditLog.findMany({
      where: { action: { startsWith: 'network.agency.details_changed' } },
      orderBy: { action: 'asc' },
    });
    expect(audits.map(a => [a.action, a.tenantId])).toEqual([
      ['network.agency.details_changed', parent.id],
      ['network.agency.details_changed_by_parent', child.id],
    ]);
    expect((audits[0].changes as any).before.name).toBe('Downline');
    expect((audits[0].changes as any).after.profile.licensedAgentCount).toBe(9);
  });

  it('refuses a record onboarding would refuse, every problem at once, and changes nothing', async () => {
    const res = await send('PATCH', `/api/v1/network/agencies/${child.id}`, parentOwner(), {
      name: '  ',
      state: 'Texas',
      contactEmail: 'not-an-email',
      licensedAgentCount: 0,
      deliveryDays: ['MON', 'FUNDAY'],
      deliveryStartTime: '17:00',
      deliveryEndTime: '09:00',
      deliveryTimeZone: 'Mars/Olympus_Mons',
    });
    expect(res.statusCode).toBe(400);
    const problems: string[] = res.json().error.problems;
    expect(problems).toEqual(
      expect.arrayContaining([
        'name is required',
        'state must be a two-letter US state code',
        'contactEmail must be an email address',
        'licensedAgentCount must be a whole number of agents, one or more',
        'deliveryDays must be drawn from MON, TUE, WED, THU, FRI, SAT, SUN',
        'deliveryEndTime must be after deliveryStartTime',
        'deliveryTimeZone must be an IANA time zone',
      ])
    );

    const bad24 = await send('PATCH', `/api/v1/network/agencies/${child.id}`, parentOwner(), {
      deliveryStartTime: '9am',
    });
    expect(bad24.json().error.problems).toContain('deliveryStartTime must be HH:MM, 24-hour');

    const profile = await prisma.agencyProfile.findUniqueOrThrow({ where: { tenantId: child.id } });
    expect(profile.state).toBe('TX');
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('creates the profile for a child that has none, which then needs every field', async () => {
    const partial = await send('PATCH', `/api/v1/network/agencies/${bare.id}`, parentOwner(), {
      contactName: 'Only This',
    });
    expect(partial.statusCode).toBe(400);
    expect(partial.json().error.problems).toContain('legalName is required');

    // A name alone does not need a profile.
    const renamed = await send('PATCH', `/api/v1/network/agencies/${bare.id}`, parentOwner(), {
      name: 'Has A Name',
    });
    expect(renamed.statusCode, renamed.body).toBe(200);
    expect(renamed.json().data.profile).toBeNull();

    const full = await send('PATCH', `/api/v1/network/agencies/${bare.id}`, parentOwner(), PROFILE);
    expect(full.statusCode, full.body).toBe(200);
    const created = await prisma.agencyProfile.findUniqueOrThrow({ where: { tenantId: bare.id } });
    expect(created).toMatchObject({ ...PROFILE, createdByUserId: parent.ownerId });
  });
});
