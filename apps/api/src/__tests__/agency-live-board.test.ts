/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { RoleName } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { registerStaffOnly } from '../middleware/staff-only.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * The agency's own Live Board, and the campaigns an agency principal now reads.
 *
 * Both screens were NetEnroll's until this change: `/admin/live` is the
 * cross-agency board and `/campaigns` was staff-only. An agency principal now
 * reaches a board of its own and a read-only campaigns list, so the property
 * that matters is the one the tenant-isolation suite asserts everywhere else:
 * seed the same shape in two agencies, ask as one, and find none of the other.
 *
 * And the board's columns sum to its totals -- including the Unattributed row
 * that catches calls with no buyer and applications with no linked call --
 * because a board whose rows do not add up to its header is a board nobody
 * believes.
 */

const gate = databaseGate();
announceSkip('Agency live board and campaigns', gate);

const TEST_JWT_SECRET = 'agency-live-board-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('Agency live board suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `agency live board suite cannot run: ${gate.reason}`).toBe(true);
  });
});

interface Agency {
  tenantId: string;
  name: string;
  ownerId: string;
  agentId: string;
  buyerUserId: string;
  publisherUserId: string;
  buyerIds: string[];
  campaignId: string;
}

describe.skipIf(!gate.available)('Agency live board and campaigns', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;
  let a: Agency;
  let b: Agency;
  let roleIds: Record<string, string>;
  let seq = 0;

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);
    // In the order src/index.ts registers it: after authentication.
    registerStaffOnly(instance);

    const { registerDeliveryBillingRoutes } = await import('../routes/delivery-billing.js');
    const { registerCampaignRoutes } = await import('../routes/index.js');
    await instance.register(registerDeliveryBillingRoutes);
    await instance.register(registerCampaignRoutes);

    await instance.ready();
    return instance;
  }

  function tokenFor(userId: string, tenantId: string): Record<string, string> {
    return {
      authorization: `Bearer ${app.jwt.sign({ userId, tenantId, email: `${userId}@test.local` })}`,
    };
  }

  async function cleanDatabase() {
    for (const table of [
      'insurance_carrier_applications',
      'calls',
      'campaigns',
      'buyers',
      'publishers',
      'audit_logs',
      'user_roles',
      'users',
      'roles',
      'tenants',
    ]) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }
  }

  async function user(tenantId: string, role: RoleName, slug: string): Promise<string> {
    const row = await prisma.user.create({
      data: {
        tenantId,
        email: `${role.toLowerCase()}@${slug}.local`,
        status: 'ACTIVE',
        roles: { create: { roleId: roleIds[role] } },
      },
    });
    return row.id;
  }

  async function seedAgency(label: string, buyerNames: string[]): Promise<Agency> {
    const slug = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tenant = await prisma.tenant.create({
      data: { name: `${label} Insurance`, slug, status: 'ACTIVE' },
    });

    const publisher = await prisma.publisher.create({
      data: { tenantId: tenant.id, name: `${label} Source`, code: `${label}PUB` },
    });
    const buyerIds: string[] = [];
    for (const [i, name] of buyerNames.entries()) {
      const buyer = await prisma.buyer.create({
        data: { tenantId: tenant.id, name, code: `${label}BUY${i}` },
      });
      buyerIds.push(buyer.id);
    }
    const campaign = await prisma.campaign.create({
      data: { tenantId: tenant.id, publisherId: publisher.id, name: `${label} Final Expense` },
    });

    return {
      tenantId: tenant.id,
      name: tenant.name,
      ownerId: await user(tenant.id, RoleName.OWNER, slug),
      agentId: await user(tenant.id, RoleName.AGENT, slug),
      buyerUserId: await user(tenant.id, RoleName.BUYER, slug),
      publisherUserId: await user(tenant.id, RoleName.PUBLISHER, slug),
      buyerIds,
      campaignId: campaign.id,
    };
  }

  /** A delivered call today: inbound, not blocked, answered a minute ago. */
  async function deliveredCall(tenantId: string, buyerId: string | null): Promise<string> {
    const call = await prisma.call.create({
      data: {
        tenantId,
        callSid: `sid-delivered-${++seq}`,
        toNumber: '+15550000000',
        status: 'COMPLETED',
        direction: 'INBOUND',
        blocked: false,
        buyerId,
        answeredAt: new Date(Date.now() - 60_000),
        endedAt: new Date(),
      },
    });
    return call.id;
  }

  /** A call up this second: answered, no end time, started a minute ago. */
  async function inFlightCall(tenantId: string, buyerId: string | null): Promise<void> {
    await prisma.call.create({
      data: {
        tenantId,
        callSid: `sid-live-${++seq}`,
        toNumber: '+15550000000',
        status: 'ANSWERED',
        direction: 'INBOUND',
        buyerId,
        endedAt: null,
      },
    });
  }

  async function application(tenantId: string, callId: string | null): Promise<void> {
    await prisma.insuranceCarrierApplication.create({
      data: {
        tenantId,
        firstName: 'Test',
        lastName: `Applicant ${++seq}`,
        callId,
        submittedAt: new Date(Date.now() - 30_000),
      },
    });
  }

  async function board(agency: Agency) {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/delivery/live-board',
      headers: tokenFor(agency.ownerId, agency.tenantId),
    });
    expect(response.statusCode).toBe(200);
    return response.json().data;
  }

  function expectColumnsSumToTotals(data: any) {
    for (const column of ['callsInFlight', 'deliveredToday', 'applicationsToday'] as const) {
      const sum = data.rows.reduce((total: number, row: any) => total + row[column], 0);
      expect(sum, column).toBe(data.totals[column]);
    }
  }

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    prisma = getPrismaClient();
    await cleanDatabase();

    roleIds = {};
    for (const name of [RoleName.OWNER, RoleName.AGENT, RoleName.BUYER, RoleName.PUBLISHER]) {
      const role = await prisma.role.create({
        data: { name, description: `${name} role`, permissions: [] },
      });
      roleIds[name] = role.id;
    }

    a = await seedAgency('Alpha', ['Alpha Overflow', 'Alpha Primary']);
    b = await seedAgency('Bravo', ['Bravo Primary']);

    // Alpha: two buyers, plus a call with no buyer and an application with no call.
    const [overflow, primary] = a.buyerIds;
    const p1 = await deliveredCall(a.tenantId, primary);
    const p2 = await deliveredCall(a.tenantId, primary);
    await deliveredCall(a.tenantId, primary);
    const o1 = await deliveredCall(a.tenantId, overflow);
    const orphanCall = await deliveredCall(a.tenantId, null);
    await inFlightCall(a.tenantId, primary);
    await inFlightCall(a.tenantId, null);
    await application(a.tenantId, p1);
    await application(a.tenantId, p2);
    await application(a.tenantId, o1);
    await application(a.tenantId, orphanCall);
    await application(a.tenantId, null);

    // Bravo: enough traffic that any leak into Alpha's numbers would show.
    const bCall = await deliveredCall(b.tenantId, b.buyerIds[0]);
    for (let i = 0; i < 6; i++) await deliveredCall(b.tenantId, b.buyerIds[0]);
    await inFlightCall(b.tenantId, b.buyerIds[0]);
    await application(b.tenantId, bCall);
  });

  describe('GET /api/v1/delivery/live-board', () => {
    it("shows tenant A's owner only A's buyers and A's totals", async () => {
      const data = await board(a);

      expect(data.totals).toEqual({
        callsInFlight: 2,
        deliveredToday: 5,
        applicationsToday: 5,
        closingPct: 100,
      });

      const names = data.rows.map((row: any) => row.name);
      expect(names).toEqual(['Alpha Overflow', 'Alpha Primary', 'Unattributed']);
      expect(names.join(' ')).not.toMatch(/Bravo/);
      expect(JSON.stringify(data)).not.toContain(b.tenantId);
      for (const id of b.buyerIds) expect(JSON.stringify(data)).not.toContain(id);

      const byName = Object.fromEntries(data.rows.map((row: any) => [row.name, row]));
      expect(byName['Alpha Primary']).toMatchObject({
        callsInFlight: 1,
        deliveredToday: 3,
        applicationsToday: 2,
      });
      expect(byName['Alpha Overflow']).toMatchObject({
        callsInFlight: 0,
        deliveredToday: 1,
        applicationsToday: 1,
      });
      // The null-buyer call, its application, and the application with no call.
      expect(byName.Unattributed).toMatchObject({
        callsInFlight: 1,
        deliveredToday: 1,
        applicationsToday: 2,
      });
    });

    it("shows tenant B's owner only B's board", async () => {
      const data = await board(b);

      expect(data.totals).toMatchObject({
        callsInFlight: 1,
        deliveredToday: 7,
        applicationsToday: 1,
      });
      expect(data.rows.map((row: any) => row.name)).toEqual(['Bravo Primary']);
      for (const id of a.buyerIds) expect(JSON.stringify(data)).not.toContain(id);
    });

    it('has columns that sum to the totals, Unattributed row included', async () => {
      expectColumnsSumToTotals(await board(a));
      expectColumnsSumToTotals(await board(b));
    });

    it('gives an agency with no buyers one row for itself, carrying the totals', async () => {
      await prisma.call.updateMany({ where: { tenantId: a.tenantId }, data: { buyerId: null } });
      await prisma.buyer.deleteMany({ where: { tenantId: a.tenantId } });

      const data = await board(a);
      expect(data.rows).toHaveLength(1);
      expect(data.rows[0]).toMatchObject({
        name: a.name,
        kind: 'agency',
        callsInFlight: data.totals.callsInFlight,
        deliveredToday: data.totals.deliveredToday,
        applicationsToday: data.totals.applicationsToday,
      });
    });

    it('answers null, not 0%, when nothing has been delivered', async () => {
      await prisma.insuranceCarrierApplication.deleteMany({ where: { tenantId: b.tenantId } });
      await prisma.call.deleteMany({ where: { tenantId: b.tenantId } });

      const data = await board(b);
      expect(data.totals.closingPct).toBeNull();
      expect(data.rows[0].closingPct).toBeNull();
    });

    it('refuses an AGENT token', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/delivery/live-board',
        headers: tokenFor(a.agentId, a.tenantId),
      });
      expect(response.statusCode).toBe(403);
    });

    it('refuses a buyer token and a publisher token', async () => {
      for (const userId of [a.buyerUserId, a.publisherUserId]) {
        const response = await app.inject({
          method: 'GET',
          url: '/api/v1/delivery/live-board',
          headers: tokenFor(userId, a.tenantId),
        });
        expect(response.statusCode).toBe(403);
      }
    });

    it('refuses an anonymous request', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/delivery/live-board' });
      expect(response.statusCode).toBe(401);
    });
  });

  describe('campaigns, read by an agency owner', () => {
    it("lists only the owner's own agency's campaigns", async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/campaigns',
        headers: tokenFor(a.ownerId, a.tenantId),
      });
      expect(response.statusCode).toBe(200);
      const body = JSON.stringify(response.json());
      expect(body).toContain(a.campaignId);
      expect(body).not.toContain(b.campaignId);
    });

    it("answers 404 for another agency's campaign by id", async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/campaigns/${b.campaignId}`,
        headers: tokenFor(a.ownerId, a.tenantId),
      });
      expect(response.statusCode).toBe(404);
    });

    it('still refuses every campaign write to an agency owner', async () => {
      const headers = tokenFor(a.ownerId, a.tenantId);
      const writes = [
        { method: 'POST' as const, url: '/api/v1/campaigns', payload: { name: 'x' } },
        { method: 'PATCH' as const, url: `/api/v1/campaigns/${a.campaignId}`, payload: {} },
        { method: 'DELETE' as const, url: `/api/v1/campaigns/${a.campaignId}` },
      ];
      for (const write of writes) {
        const response = await app.inject({ ...write, headers });
        expect(response.statusCode, `${write.method} ${write.url}`).toBe(403);
      }
    });
  });
});
