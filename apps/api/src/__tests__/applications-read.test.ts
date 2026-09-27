/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import Fastify, { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * The applications page's reads: the summary strip and the table.
 *
 *   1. THE TILES MATCH THE TABLE. The summary takes the table's `carrier` and
 *      `agentId`, so a filtered table is never shown under the agency's
 *      unfiltered totals.
 *   2. AN AGENT'S `agentId` IS OVERWRITTEN, in the summary exactly as in the
 *      list. A filter the client can set is a filter the client can unset.
 *   3. THE TABLE PAGES. `nextCursor` is set when a page is full, and the next
 *      page picks up after it with nothing repeated and nothing skipped.
 *
 * Database-backed, following `agent-entry.test.ts`.
 */

const gate = databaseGate();
announceSkip('Applications reads', gate);

const TEST_JWT_SECRET = 'applications-read-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('Applications reads suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `applications reads suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('Applications reads', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;

  let tenantId: string;
  let ownerId: string;
  let agentId: string;
  let otherAgentId: string;

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);

    const { registerApplicationRoutes } = await import('../routes/applications.js');
    await instance.register(registerApplicationRoutes);

    await instance.ready();
    return instance;
  }

  function tokenFor(userId: string): Record<string, string> {
    return {
      authorization: `Bearer ${app.jwt.sign({ userId, tenantId, email: `${userId}@test.local` })}`,
    };
  }

  async function cleanDatabase() {
    for (const table of [
      'application_credit_ledger',
      'insurance_carrier_applications',
      'audit_logs',
      'user_roles',
      'users',
      'roles',
      'tenants',
    ]) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }
  }

  /** A submitted application, written straight to the table. */
  let sequence = 0;
  async function seed(overrides: {
    createdById: string;
    carrier: string;
    annualizedPremium: number;
    voided?: boolean;
  }) {
    sequence += 1;
    return prisma.insuranceCarrierApplication.create({
      data: {
        tenantId,
        createdById: overrides.createdById,
        carrier: overrides.carrier,
        firstName: `Applicant${sequence}`,
        lastName: 'Reyes',
        source: 'AGENT_ENTRY',
        status: 'SUBMITTED',
        // Distinct instants, a minute apart, so the table's order is fixed.
        submittedAt: new Date(Date.now() - sequence * 60_000),
        annualizedPremium: overrides.annualizedPremium,
        voidedAt: overrides.voided ? new Date() : null,
      },
    });
  }

  async function summary(userId: string, query: Record<string, string> = {}) {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/applications/summary?${new URLSearchParams(query).toString()}`,
      headers: tokenFor(userId),
    });
    expect(response.statusCode).toBe(200);
    return response.json().data;
  }

  async function list(userId: string, query: Record<string, string> = {}) {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/applications?${new URLSearchParams(query).toString()}`,
      headers: tokenFor(userId),
    });
    expect(response.statusCode).toBe(200);
    return response.json().data;
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

    const [ownerRole, agentRole] = await Promise.all([
      prisma.role.create({
        data: { name: 'OWNER', description: 'OWNER role', permissions: ['admin:*'] },
      }),
      prisma.role.create({ data: { name: 'AGENT', description: 'AGENT role', permissions: [] } }),
    ]);

    const tenant = await prisma.tenant.create({
      data: {
        name: 'Ridgeline Insurance',
        slug: `ridgeline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        status: 'ACTIVE',
      },
    });
    tenantId = tenant.id;

    const suffix = () => Math.random().toString(36).slice(2, 8);
    const [owner, agent, otherAgent] = await Promise.all([
      prisma.user.create({
        data: {
          tenantId,
          email: `principal-${suffix()}@ridgeline.local`,
          status: 'ACTIVE',
          roles: { create: { roleId: ownerRole.id } },
        },
      }),
      prisma.user.create({
        data: {
          tenantId,
          email: `agent-${suffix()}@ridgeline.local`,
          status: 'ACTIVE',
          firstName: 'Marisol',
          lastName: 'Vance',
          roles: { create: { roleId: agentRole.id } },
        },
      }),
      prisma.user.create({
        data: {
          tenantId,
          email: `agent2-${suffix()}@ridgeline.local`,
          status: 'ACTIVE',
          firstName: 'Devin',
          lastName: 'Okafor',
          roles: { create: { roleId: agentRole.id } },
        },
      }),
    ]);
    ownerId = owner.id;
    agentId = agent.id;
    otherAgentId = otherAgent.id;

    // Marisol: two Aflac and one Mutual of Omaha. Devin: one Aflac, and one
    // voided Aflac that no total may count.
    await seed({ createdById: agentId, carrier: 'Aflac', annualizedPremium: 600 });
    await seed({ createdById: agentId, carrier: 'Aflac', annualizedPremium: 400 });
    await seed({ createdById: agentId, carrier: 'Mutual of Omaha', annualizedPremium: 1000 });
    await seed({ createdById: otherAgentId, carrier: 'Aflac', annualizedPremium: 300 });
    await seed({
      createdById: otherAgentId,
      carrier: 'Aflac',
      annualizedPremium: 9999,
      voided: true,
    });
  });

  it('gives an owner the whole agency when unfiltered', async () => {
    const totals = await summary(ownerId);
    expect(totals.count).toBe(4);
    expect(totals.totalAnnualizedPremium).toBe(2300);
  });

  it('narrows the summary to a carrier, as the table is', async () => {
    const totals = await summary(ownerId, { carrier: 'Aflac' });
    expect(totals.count).toBe(3);
    expect(totals.totalAnnualizedPremium).toBe(1300);
    expect(totals.byCarrier.map((row: any) => row.carrier)).toEqual(['Aflac']);

    // The same filter on the table: the tiles add up to its non-voided rows.
    const table = await list(ownerId, { carrier: 'Aflac' });
    const counted = table.applications.filter((row: any) => row.voidedAt === null);
    expect(counted).toHaveLength(totals.count);
  });

  it('narrows the summary to an agent for an owner', async () => {
    const totals = await summary(ownerId, { agentId });
    expect(totals.count).toBe(3);
    expect(totals.totalAnnualizedPremium).toBe(2000);
    expect(totals.byAgent.map((row: any) => row.agentId)).toEqual([agentId]);

    const both = await summary(ownerId, { agentId, carrier: 'Aflac' });
    expect(both.count).toBe(2);
    expect(both.totalAnnualizedPremium).toBe(1000);
  });

  it("ignores an agent's agentId and gives them their own rows", async () => {
    // Marisol asks for Devin's. She gets her own, whatever she sent.
    const totals = await summary(agentId, { agentId: otherAgentId });
    expect(totals.count).toBe(3);
    expect(totals.byAgent.map((row: any) => row.agentId)).toEqual([agentId]);

    // And the carrier filter still applies within her own rows.
    const aflac = await summary(agentId, { agentId: otherAgentId, carrier: 'Aflac' });
    expect(aflac.count).toBe(2);
  });

  it('pages the table with nextCursor, and the next page carries on', async () => {
    const first = await list(ownerId, { limit: '2' });
    expect(first.applications).toHaveLength(2);
    expect(first.nextCursor).toBe(first.applications[1].id);

    const second = await list(ownerId, { limit: '2', cursor: first.nextCursor });
    expect(second.applications).toHaveLength(2);
    expect(second.nextCursor).toBe(second.applications[1].id);

    const third = await list(ownerId, { limit: '2', cursor: second.nextCursor });
    expect(third.applications).toHaveLength(1);
    // The page was not full: there is nothing after it.
    expect(third.nextCursor).toBeNull();

    const ids = [...first.applications, ...second.applications, ...third.applications].map(
      (row: any) => row.id
    );
    expect(new Set(ids).size).toBe(5);

    // Newest first, and the pages join up in that order.
    const whole = await list(ownerId);
    expect(whole.applications.map((row: any) => row.id)).toEqual(ids);
    expect(whole.nextCursor).toBeNull();
  });
});
