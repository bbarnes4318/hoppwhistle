/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { RoleName } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { backfillApplicationCustomers } from '../services/applications/customer-link.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * An application opens its customer record.
 *
 * `POST /api/v1/applications/:id/customer` links (or creates) the
 * `InsuranceLead` an application belongs to, in the order
 * `services/applications/customer-link.ts` sets out: already linked, the
 * agent's own customer on that phone, the agency's unassigned one, a new one.
 * An agent reaches only the applications they wrote.
 */

const gate = databaseGate();
announceSkip('Application customer link', gate);

const TEST_JWT_SECRET = 'application-customer-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('Application customer link suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `application customer suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('Application customer link', () => {
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

  const as = (userId: string) => ({
    authorization: `Bearer ${app.jwt.sign({ userId, tenantId, email: `${userId}@test.local` })}`,
  });

  const open = (applicationId: string, userId: string) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/applications/${applicationId}/customer`,
      headers: as(userId),
    });

  async function seedApplication(overrides: Record<string, unknown> = {}) {
    return prisma.insuranceCarrierApplication.create({
      data: {
        tenantId,
        createdById: agentId,
        carrier: 'Aflac',
        product: 'Final Expense',
        firstName: 'Rosa',
        lastName: 'Delgado',
        phone: '(615) 555-0142',
        email: 'rosa@example.com',
        city: 'Nashville',
        state: 'Tennessee',
        zip: '37201',
        dob: '04/02/1951',
        age: 75,
        gender: 'Female',
        faceAmount: 15000,
        monthlyPremium: 62.5,
        source: 'AGENT_ENTRY',
        status: 'SUBMITTED',
        submittedAt: new Date(),
        ...overrides,
      },
    });
  }

  beforeAll(async () => {
    prisma = getPrismaClient();
    app = await buildApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    for (const table of [
      'insurance_carrier_applications',
      'insurance_leads',
      'user_roles',
      'users',
      'roles',
      'tenants',
    ]) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }
    const [ownerRole, agentRole] = await Promise.all([
      prisma.role.create({ data: { name: RoleName.OWNER, permissions: [] } }),
      prisma.role.create({ data: { name: RoleName.AGENT, permissions: [] } }),
    ]);
    const tenant = await prisma.tenant.create({
      data: { name: 'Ridgeline', slug: `ridgeline-${Date.now()}`, status: 'ACTIVE' },
    });
    tenantId = tenant.id;
    const mk = (email: string, roleId: string) =>
      prisma.user.create({
        data: { tenantId, email, status: 'ACTIVE', roles: { create: { roleId } } },
      });
    ownerId = (await mk(`owner-${tenantId}@t.local`, ownerRole.id)).id;
    agentId = (await mk(`agent-${tenantId}@t.local`, agentRole.id)).id;
    otherAgentId = (await mk(`other-${tenantId}@t.local`, agentRole.id)).id;
  });

  it('returns the customer an application is already linked to', async () => {
    const lead = await prisma.insuranceLead.create({
      data: { tenantId, vertical: 'FE', phone: '6155550142', assignedToId: agentId },
    });
    const application = await seedApplication({ insuranceLeadId: lead.id });

    const res = await open(application.id, agentId);
    expect(res.statusCode).toBe(200);
    expect(res.json().data.customerId).toBe(lead.id);
  });

  it("links the agent's own customer on that phone", async () => {
    // A colleague's customer on the same phone is not the agent's.
    await prisma.insuranceLead.create({
      data: { tenantId, vertical: 'FE', phone: '6155550142', assignedToId: otherAgentId },
    });
    const own = await prisma.insuranceLead.create({
      data: { tenantId, vertical: 'FE', phone: '6155550142', assignedToId: agentId },
    });
    const application = await seedApplication();

    const res = await open(application.id, agentId);
    expect(res.json().data.customerId).toBe(own.id);
    const row = await prisma.insuranceCarrierApplication.findUnique({
      where: { id: application.id },
    });
    expect(row?.insuranceLeadId).toBe(own.id);
  });

  it("hands the agency's unassigned customer on that phone to the agent", async () => {
    const unassigned = await prisma.insuranceLead.create({
      data: { tenantId, vertical: 'FE', phone: '6155550142' },
    });
    const application = await seedApplication();

    const res = await open(application.id, ownerId);
    expect(res.json().data.customerId).toBe(unassigned.id);
    const lead = await prisma.insuranceLead.findUnique({ where: { id: unassigned.id } });
    expect(lead?.assignedToId).toBe(agentId);
    expect(lead?.assignedAt).not.toBeNull();
  });

  it('creates a sold customer on the agent when there is none', async () => {
    const application = await seedApplication();

    const res = await open(application.id, agentId);
    expect(res.statusCode).toBe(200);
    const lead = await prisma.insuranceLead.findUnique({
      where: { id: res.json().data.customerId },
    });
    expect(lead).toMatchObject({
      tenantId,
      vertical: 'FE',
      firstName: 'Rosa',
      lastName: 'Delgado',
      fullName: 'Rosa Delgado',
      phone: '6155550142',
      state: 'TN',
      zipCode: '37201',
      birthDate: '04/02/1951',
      carrier: 'Aflac',
      faceAmount: '15000',
      monthlyPremium: '62.5',
      status: 'CONVERTED',
      source: 'application',
      assignedToId: agentId,
    });

    // A second open is the same customer, not a second one.
    const again = await open(application.id, agentId);
    expect(again.json().data.customerId).toBe(lead?.id);
    expect(await prisma.insuranceLead.count({ where: { tenantId } })).toBe(1);
  });

  it('refuses an application with no phone with 409 NO_PHONE', async () => {
    const application = await seedApplication({ phone: null });
    const res = await open(application.id, agentId);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('NO_PHONE');
    expect(await prisma.insuranceLead.count({ where: { tenantId } })).toBe(0);
  });

  it("refuses an agent a colleague's application", async () => {
    const application = await seedApplication({ createdById: otherAgentId });
    expect((await open(application.id, agentId)).statusCode).toBe(404);
    expect((await open(application.id, ownerId)).statusCode).toBe(200);
  });

  it('returns customerId on the list', async () => {
    const lead = await prisma.insuranceLead.create({
      data: { tenantId, vertical: 'FE', phone: '6155550142', assignedToId: agentId },
    });
    await seedApplication({ insuranceLeadId: lead.id });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/applications',
      headers: as(ownerId),
    });
    expect(res.json().data.applications[0].customerId).toBe(lead.id);
  });

  it('backfills every unlinked application once', async () => {
    await seedApplication();
    await seedApplication({ firstName: 'Ana', phone: '6155550199' });
    await seedApplication({ firstName: 'Nophone', phone: null });

    const first = await backfillApplicationCustomers(prisma, { tenantId });
    expect(first).toMatchObject({ created: 2, skippedNoPhone: 1 });

    const second = await backfillApplicationCustomers(prisma, { tenantId });
    expect(second).toMatchObject({ created: 0, linked: 0, skippedNoPhone: 1 });
  });

  it('links every application across pages, not one short per page', async () => {
    // Seven applications, three per page: the pages end on rows the loop has
    // just linked. Paging with Prisma's cursor + skip: 1 dropped the first
    // unlinked row after each one -- in production, one application per 200.
    for (let i = 0; i < 7; i++) {
      await seedApplication({ firstName: `Page${i}`, phone: `615555020${i}` });
    }

    const counts = await backfillApplicationCustomers(prisma, { tenantId, batchSize: 3 });
    expect(counts.created).toBe(7);
    expect(
      await prisma.insuranceCarrierApplication.count({
        where: { tenantId, insuranceLeadId: null },
      })
    ).toBe(0);
  });
});
