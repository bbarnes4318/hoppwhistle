/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { RoleName } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { grantPlatformAdmin } from '../lib/platform-admin.js';
import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { registerReadOnlyPreview } from '../middleware/read-only-preview.js';
import { registerStaffOnly } from '../middleware/staff-only.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * The upgrades catalog.
 *
 *   GET  /api/v1/upgrades                 price, on, requestOpen per key
 *   POST /api/v1/upgrades/:key/request    one OPEN request, emailed to whoever
 *                                         can turn it on: a child's parent's
 *                                         owners, otherwise the platform admins
 *   /api/v1/admin/upgrade-prices          set by a platform admin
 *   /api/v1/admin/upgrade-requests        listed and closed by one
 *   turning the upgrade on                marks the OPEN request DONE
 */

// The transport, stubbed: what was sent, to whom, is the assertion.
const sendMail = vi.fn<[message: any], Promise<{ accepted: string[] }>>();
vi.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail }),
  default: { createTransport: () => ({ sendMail }) },
}));

const gate = databaseGate();
announceSkip('Upgrade catalog', gate);

const TEST_JWT_SECRET = 'upgrade-catalog-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('Upgrade catalog suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `upgrade catalog suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('Upgrade catalog', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;
  let parent: { id: string; ownerId: string; ownerEmail: string };
  let child: { id: string; ownerId: string; agentId: string };
  let direct: { id: string; ownerId: string };
  let operator: { id: string; email: string };

  const SMTP_KEYS = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM', 'APP_URL'] as const;
  const savedEnv: Record<string, string | undefined> = {};

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);
    registerReadOnlyPreview(instance);
    registerStaffOnly(instance);
    const { registerUpgradeRoutes } = await import('../routes/upgrades.js');
    const { registerNetworkRoutes } = await import('../routes/network.js');
    const { registerPlatformRoutes } = await import('../routes/platform.js');
    await instance.register(registerUpgradeRoutes);
    await instance.register(registerNetworkRoutes);
    await instance.register(registerPlatformRoutes);
    await instance.ready();
    return instance;
  }

  const send = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    url: string,
    who: { userId: string; tenantId: string | null },
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
    for (const table of [
      'audit_logs',
      'roles',
      'tenants',
      'platform_admins',
      'upgrade_prices',
      'upgrade_requests',
    ]) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }
    const roles: Record<string, string> = {};
    for (const name of [RoleName.OWNER, RoleName.ADMIN, RoleName.AGENT]) {
      roles[name] = (
        await prisma.role.create({ data: { name, description: name, permissions: [] } })
      ).id;
    }
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const user = async (tenantId: string, role: string, tag: string) =>
      prisma.user.create({
        data: {
          tenantId,
          email: `${tag}-${stamp}@t.test`,
          firstName: 'Pat',
          lastName: tag,
          status: 'ACTIVE',
          roles: { create: { roleId: roles[role] } },
        },
      });

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
    const parentOwner = await user(parentId, 'OWNER', 'parent-owner');
    parent = { id: parentId, ownerId: parentOwner.id, ownerEmail: parentOwner.email };

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
      ownerId: (await user(childId, 'OWNER', 'child-owner')).id,
      agentId: (await user(childId, 'AGENT', 'child-agent')).id,
    };

    const directId = (
      await prisma.tenant.create({
        data: { name: 'Direct Agency', slug: `direct-${stamp}`, status: 'ACTIVE' },
      })
    ).id;
    direct = { id: directId, ownerId: (await user(directId, 'OWNER', 'direct-owner')).id };

    const op = await prisma.user.create({
      data: { email: `operator-${stamp}@netenroll.test`, status: 'ACTIVE', tenantId: null },
    });
    await grantPlatformAdmin(op.id, { note: 'upgrade catalog suite' });
    operator = { id: op.id, email: op.email };
  });

  const childOwner = () => ({ userId: child.ownerId, tenantId: child.id });
  const directOwner = () => ({ userId: direct.ownerId, tenantId: direct.id });
  const staff = () => ({ userId: operator.id, tenantId: null });

  it('lists every upgrade, unpriced and off, for a new agency', async () => {
    const res = await send('GET', '/api/v1/upgrades', directOwner());
    expect(res.statusCode, res.body).toBe(200);
    const data = res.json().data;
    expect(data.map((row: any) => row.key)).toEqual([
      'POWER_DIALER',
      'PREDICTIVE_DIALER',
      'CARRIER_ROUTING',
      'VOICE_AGENTS',
      'VOICE_STUDIO',
      'PAYROLL_ADMIN',
    ]);
    for (const row of data) {
      expect(row).toEqual({
        key: row.key,
        monthlyCents: null,
        setupCents: null,
        on: false,
        requestOpen: false,
      });
    }
  });

  it('opens one request, idempotently, and emails the platform admins for a direct agency', async () => {
    const first = await send('POST', '/api/v1/upgrades/PREDICTIVE_DIALER/request', directOwner());
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json().data).toMatchObject({
      upgradeKey: 'PREDICTIVE_DIALER',
      status: 'OPEN',
      created: true,
      emailed: 1,
    });

    expect(sendMail).toHaveBeenCalledTimes(1);
    const message = sendMail.mock.calls[0][0];
    expect(message.to).toBe(operator.email);
    expect(message.subject).toBe('Upgrade requested: Predictive Dialer — Direct Agency');
    expect(message.text).toContain('Direct Agency');
    expect(message.text).toContain('Pat direct-owner');
    expect(message.text).toContain('https://agents.netenroll.com/admin/agencies');

    const again = await send('POST', '/api/v1/upgrades/PREDICTIVE_DIALER/request', directOwner());
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json().data).toMatchObject({ id: first.json().data.id, created: false });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(await prisma.upgradeRequest.count({ where: { tenantId: direct.id } })).toBe(1);

    const catalog = await send('GET', '/api/v1/upgrades', directOwner());
    const predictive = catalog.json().data.find((row: any) => row.key === 'PREDICTIVE_DIALER');
    expect(predictive).toMatchObject({ on: false, requestOpen: true });
  });

  it("emails a child's request to its parent's owners, with the price and the child's page", async () => {
    await prisma.upgradePrice.create({
      data: { key: 'POWER_DIALER', monthlyCents: 9900, setupCents: 25000 },
    });

    const res = await send('POST', '/api/v1/upgrades/POWER_DIALER/request', childOwner());
    expect(res.statusCode, res.body).toBe(201);

    expect(sendMail).toHaveBeenCalledTimes(1);
    const message = sendMail.mock.calls[0][0];
    expect(message.to).toBe(parent.ownerEmail);
    expect(message.to).not.toContain(operator.email);
    expect(message.subject).toBe('Upgrade requested: Power Dialer — Downline');
    expect(message.text).toContain('$99.00/month and $250.00 setup');
    expect(message.text).toContain(`/network/agencies/${child.id}`);
    expect(message.from).toContain('Life Leads Plus');
  });

  it('still records the request when the email fails', async () => {
    sendMail.mockReset().mockRejectedValue(new Error('SMTP down'));
    const res = await send('POST', '/api/v1/upgrades/VOICE_STUDIO/request', directOwner());
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().data.emailed).toBe(0);
    expect(
      await prisma.upgradeRequest.count({ where: { tenantId: direct.id, status: 'OPEN' } })
    ).toBe(1);
  });

  it('refuses an upgrade already on (409), an unknown key (400), and an agent (403)', async () => {
    await prisma.tenant.update({
      where: { id: direct.id },
      data: { metadata: { upgrades: ['VOICE_AGENTS'] } },
    });
    const on = await send('POST', '/api/v1/upgrades/VOICE_AGENTS/request', directOwner());
    expect(on.statusCode, on.body).toBe(409);

    const unknown = await send('POST', '/api/v1/upgrades/CRM/request', directOwner());
    expect(unknown.statusCode, unknown.body).toBe(400);

    const agent = await send('POST', '/api/v1/upgrades/VOICE_STUDIO/request', {
      userId: child.agentId,
      tenantId: child.id,
    });
    expect(agent.statusCode, agent.body).toBe(403);

    expect(await prisma.upgradeRequest.count()).toBe(0);
    expect(sendMail).not.toHaveBeenCalled();

    const catalog = await send('GET', '/api/v1/upgrades', directOwner());
    expect(catalog.json().data.find((row: any) => row.key === 'VOICE_AGENTS').on).toBe(true);
  });

  it('lets a platform admin set prices, and nobody else', async () => {
    const refused = await send('PUT', '/api/v1/admin/upgrade-prices', directOwner(), {
      prices: [{ key: 'POWER_DIALER', monthlyCents: 1, setupCents: null }],
    });
    expect(refused.statusCode).toBe(403);

    const bad = await send('PUT', '/api/v1/admin/upgrade-prices', staff(), {
      prices: [
        { key: 'POWER_DIALER', monthlyCents: -1, setupCents: null },
        { key: 'NOPE', monthlyCents: 1, setupCents: 1 },
        { key: 'VOICE_STUDIO', monthlyCents: 1.5, setupCents: null },
      ],
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.problems).toHaveLength(3);

    const set = await send('PUT', '/api/v1/admin/upgrade-prices', staff(), {
      prices: [
        { key: 'POWER_DIALER', monthlyCents: 9900, setupCents: 25000 },
        { key: 'PREDICTIVE_DIALER', monthlyCents: 14900, setupCents: null },
      ],
    });
    expect(set.statusCode, set.body).toBe(200);
    expect(set.json().data).toHaveLength(6);
    expect(
      await prisma.auditLog.count({ where: { action: 'platform.upgrade_prices_changed' } })
    ).toBe(1);

    const read = await send('GET', '/api/v1/admin/upgrade-prices', staff());
    expect(read.json().data.slice(0, 3)).toEqual([
      { key: 'POWER_DIALER', monthlyCents: 9900, setupCents: 25000 },
      { key: 'PREDICTIVE_DIALER', monthlyCents: 14900, setupCents: null },
      { key: 'CARRIER_ROUTING', monthlyCents: null, setupCents: null },
    ]);

    // Clearing one leaves the other as it was.
    await send('PUT', '/api/v1/admin/upgrade-prices', staff(), {
      prices: [{ key: 'POWER_DIALER', monthlyCents: null, setupCents: null }],
    });
    const catalog = await send('GET', '/api/v1/upgrades', directOwner());
    expect(catalog.json().data.slice(0, 2)).toMatchObject([
      { key: 'POWER_DIALER', monthlyCents: null, setupCents: null },
      { key: 'PREDICTIVE_DIALER', monthlyCents: 14900, setupCents: null },
    ]);
  });

  it('lists requests OPEN first, newest first, and lets a platform admin close one', async () => {
    const older = await prisma.upgradeRequest.create({
      data: {
        tenantId: direct.id,
        upgradeKey: 'VOICE_STUDIO',
        status: 'DONE',
        createdAt: new Date(Date.now() - 60_000),
        decidedAt: new Date(),
      },
    });
    const a = await prisma.upgradeRequest.create({
      data: {
        tenantId: direct.id,
        upgradeKey: 'POWER_DIALER',
        createdAt: new Date(Date.now() - 30_000),
      },
    });
    const b = await prisma.upgradeRequest.create({
      data: { tenantId: child.id, upgradeKey: 'PAYROLL_ADMIN' },
    });

    const refused = await send('GET', '/api/v1/admin/upgrade-requests', directOwner());
    expect(refused.statusCode).toBe(403);

    const list = await send('GET', '/api/v1/admin/upgrade-requests', staff());
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json().data.map((row: any) => row.id)).toEqual([b.id, a.id, older.id]);
    expect(list.json().data[0]).toMatchObject({
      tenantName: 'Downline',
      upgradeName: 'Payroll Admin',
      status: 'OPEN',
    });

    const bad = await send('PATCH', `/api/v1/admin/upgrade-requests/${a.id}`, staff(), {
      status: 'OPEN',
    });
    expect(bad.statusCode).toBe(400);

    const missing = await send('PATCH', '/api/v1/admin/upgrade-requests/not-a-uuid', staff(), {
      status: 'DONE',
    });
    expect(missing.statusCode).toBe(404);

    const declined = await send('PATCH', `/api/v1/admin/upgrade-requests/${a.id}`, staff(), {
      status: 'DECLINED',
    });
    expect(declined.statusCode, declined.body).toBe(200);
    const row = await prisma.upgradeRequest.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.status).toBe('DECLINED');
    expect(row.decidedAt).not.toBeNull();

    // Declined, so the agency may ask again.
    const again = await send('POST', '/api/v1/upgrades/POWER_DIALER/request', directOwner());
    expect(again.statusCode, again.body).toBe(201);
  });

  it('marks the OPEN request DONE when a platform admin turns the upgrade on', async () => {
    await send('POST', '/api/v1/upgrades/CARRIER_ROUTING/request', directOwner());
    await send('POST', '/api/v1/upgrades/VOICE_STUDIO/request', directOwner());

    const put = await send('PUT', `/api/v1/admin/tenants/${direct.id}/upgrades`, staff(), {
      upgrades: ['CARRIER_ROUTING'],
    });
    expect(put.statusCode, put.body).toBe(200);

    const rows = await prisma.upgradeRequest.findMany({ where: { tenantId: direct.id } });
    const byKey = Object.fromEntries(rows.map(r => [r.upgradeKey, r]));
    expect(byKey.CARRIER_ROUTING.status).toBe('DONE');
    expect(byKey.CARRIER_ROUTING.decidedAt).not.toBeNull();
    expect(byKey.VOICE_STUDIO.status).toBe('OPEN');
  });

  it("marks the child's OPEN request DONE when its parent turns the upgrade on", async () => {
    await send('POST', '/api/v1/upgrades/PREDICTIVE_DIALER/request', childOwner());

    const detail = await send('GET', `/api/v1/network/agencies/${child.id}`, {
      userId: parent.ownerId,
      tenantId: parent.id,
    });
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json().data.openUpgradeRequests).toMatchObject([
      { upgradeKey: 'PREDICTIVE_DIALER', upgradeName: 'Predictive Dialer', status: 'OPEN' },
    ]);

    const put = await send(
      'PUT',
      `/api/v1/network/agencies/${child.id}/settings`,
      { userId: parent.ownerId, tenantId: parent.id },
      { upgrades: ['PREDICTIVE_DIALER'] }
    );
    expect(put.statusCode, put.body).toBe(200);
    expect(put.json().data.upgrades).toEqual(['PREDICTIVE_DIALER']);

    const row = await prisma.upgradeRequest.findFirstOrThrow({ where: { tenantId: child.id } });
    expect(row.status).toBe('DONE');

    const after = await send('GET', `/api/v1/network/agencies/${child.id}`, {
      userId: parent.ownerId,
      tenantId: parent.id,
    });
    expect(after.json().data.openUpgradeRequests).toEqual([]);

    const catalog = await send('GET', '/api/v1/upgrades', childOwner());
    expect(catalog.json().data.find((r: any) => r.key === 'PREDICTIVE_DIALER')).toMatchObject({
      on: true,
      requestOpen: false,
    });
  });

  it('allows only one OPEN request per agency per upgrade in the database', async () => {
    await prisma.upgradeRequest.create({
      data: { tenantId: direct.id, upgradeKey: 'VOICE_AGENTS' },
    });
    await expect(
      prisma.upgradeRequest.create({ data: { tenantId: direct.id, upgradeKey: 'VOICE_AGENTS' } })
    ).rejects.toThrow();
    await expect(
      prisma.upgradeRequest.create({
        data: { tenantId: direct.id, upgradeKey: 'VOICE_AGENTS', status: 'MAYBE' },
      })
    ).rejects.toThrow();
  });
});
