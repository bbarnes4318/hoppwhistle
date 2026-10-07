/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { randomUUID } from 'crypto';

import { RoleName } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { registerReadOnlyPreview } from '../middleware/read-only-preview.js';
import { quoteActivityText } from '../routes/fex.js';
import { openJson } from '../services/fex/payload.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * Quotes run for a CRM customer.
 *
 * What it must hold:
 *
 *   - a quote saved from the customer's workspace (`source: CRM`) is filed on
 *     that customer, under the customer's own name, and on their timeline
 *   - an agent can never file a quote on a customer they may not open -- a
 *     colleague's, an unassigned one, another agency's, or one outside their
 *     license -- and the save is refused rather than silently unlinked
 *   - a customer's quotes are listed from the server, filtered by customer,
 *     and reachable by whoever may open that customer
 *   - a requote is a new record; the original is never rewritten
 *   - an application written from the CRM keeps a quote run for that customer
 */

const gate = databaseGate();
announceSkip('FEX customer quotes', gate);

const TEST_JWT_SECRET = 'fex-customer-quotes-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

const BASE = {
  state: 'TX',
  sex: 'F',
  tobacco: false,
  age: 67,
  face: 10000,
  mode: 'monthly',
  conditions: [],
  meds: [],
};

describe('quoteActivityText', () => {
  it('names the plan used, its coverage and price', () => {
    expect(
      quoteActivityText({
        eligibleCount: 7,
        lowestPremium: 41.18,
        faceAmount: 10000,
        budget: null,
        paymentMode: 'monthly',
        selectedCarrier: 'Mutual of Omaha',
        selectedProduct: 'Living Promise',
        selectedClass: 'Level',
        selectedFace: 10000,
        selectedPremium: 54.27,
      })
    ).toEqual({
      title: 'Quote selected',
      description: 'Mutual of Omaha Living Promise · Level · $10,000 · $54.27/mo',
    });
  });

  it('summarises a quote saved without a choice', () => {
    expect(
      quoteActivityText({
        eligibleCount: 1,
        lowestPremium: null,
        faceAmount: null,
        budget: 50,
        paymentMode: 'monthly',
        selectedCarrier: null,
        selectedProduct: null,
        selectedClass: null,
        selectedFace: null,
        selectedPremium: null,
      })
    ).toEqual({ title: 'Quote saved', description: '1 plan qualified · $50.00/mo budget' });
  });
});

describe.skipIf(!gate.available)('FEX customer quotes', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;

  interface Agency {
    tenantId: string;
    ownerId: string;
    agentId: string;
    otherAgentId: string;
    restrictedId: string;
    /** Assigned to `agentId`, in TX. */
    janeId: string;
    /** Assigned to `otherAgentId`. */
    bobId: string;
    /** Nobody's. */
    unassignedId: string;
    /** Assigned to `restrictedId`, in FL -- outside their TX license. */
    floridaId: string;
  }
  let a: Agency;
  let b: Agency;

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);
    registerReadOnlyPreview(instance);
    const { registerFexRoutes } = await import('../routes/fex.js');
    const { registerInsuranceLeadRoutes } = await import('../routes/insurance-leads.js');
    await instance.register(registerFexRoutes);
    await instance.register(registerInsuranceLeadRoutes);
    await instance.ready();
    return instance;
  }

  const as = (tenantId: string | null, userId: string) => ({
    authorization: `Bearer ${app.jwt.sign({ tenantId, userId, email: `${userId}@t.local` })}`,
  });

  const save = (headers: Record<string, string>, payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/fex/quotes',
      headers,
      payload: { applicant: BASE, source: 'CRM', ...payload },
    });

  const customerQuotes = (headers: Record<string, string>, leadId: string, query = '') =>
    app.inject({
      method: 'GET',
      url: `/api/v1/insurance-leads/${leadId}/quotes${query}`,
      headers,
    });

  async function seedAgency(label: string, roleIds: Record<string, string>): Promise<Agency> {
    const slug = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tenant = await prisma.tenant.create({
      data: { name: `${label} Insurance`, slug, status: 'ACTIVE' },
    });
    const mkUser = async (name: string, roleId: string, licensed?: string[]) =>
      prisma.user.create({
        data: {
          tenantId: tenant.id,
          email: `${name}@${slug}.local`,
          firstName: name,
          lastName: 'Tester',
          status: 'ACTIVE',
          ...(licensed ? { metadata: { licensedStates: licensed } } : {}),
          roles: { create: { roleId } },
        },
      });
    const owner = await mkUser('owner', roleIds.OWNER);
    const agent = await mkUser('agent', roleIds.AGENT, ['TX', 'FL', 'TN']);
    const other = await mkUser('other', roleIds.AGENT, ['TX', 'FL', 'TN']);
    const restricted = await mkUser('restricted', roleIds.AGENT, ['TX']);
    const mkLead = (patch: Record<string, unknown>) =>
      prisma.insuranceLead.create({
        data: {
          tenantId: tenant.id,
          vertical: 'FE',
          phone: `615555${String(Math.floor(Math.random() * 9000) + 1000)}`,
          state: 'TX',
          ...patch,
        },
      });
    const jane = await mkLead({ firstName: 'Jane', lastName: 'Smith', assignedToId: agent.id });
    const bob = await mkLead({ firstName: 'Bob', lastName: 'Jones', assignedToId: other.id });
    const unassigned = await mkLead({ firstName: 'Nobody', lastName: 'Yet' });
    const florida = await mkLead({
      firstName: 'Flo',
      lastName: 'Rida',
      state: 'FL',
      assignedToId: restricted.id,
    });
    return {
      tenantId: tenant.id,
      ownerId: owner.id,
      agentId: agent.id,
      otherAgentId: other.id,
      restrictedId: restricted.id,
      janeId: jane.id,
      bobId: bob.id,
      unassignedId: unassigned.id,
      floridaId: florida.id,
    };
  }

  beforeAll(async () => {
    prisma = getPrismaClient();
    app = await buildApp();

    for (const table of [
      'fex_quotes',
      'fex_tenant_settings',
      'insurance_activities',
      'insurance_carrier_applications',
      'insurance_leads',
      'calls',
      'audit_logs',
      'user_roles',
      'users',
      'roles',
      'tenants',
    ]) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }

    const roleIds: Record<string, string> = {};
    for (const name of [RoleName.OWNER, RoleName.AGENT]) {
      const role = await prisma.role.create({ data: { name, permissions: [] } });
      roleIds[name] = role.id;
    }
    a = await seedAgency('alpha', roleIds);
    b = await seedAgency('beta', roleIds);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  // ── Binding a quote to a customer ──────────────────────────────────────────

  describe('saving from the customer workspace', () => {
    it("files the quote on the agent's own customer, under the customer's name", async () => {
      const res = await save(as(a.tenantId, a.agentId), {
        insuranceLeadId: a.janeId,
        // The browser's name is not the record's: the record wins.
        prospectName: 'Somebody Else',
        selectedProductId: 'sons_of_norway_legacysure',
      });
      expect(res.statusCode).toBe(201);
      const row = await prisma.fexQuote.findUniqueOrThrow({ where: { id: res.json().data.id } });
      expect(row.insuranceLeadId).toBe(a.janeId);
      expect(row.source).toBe('CRM');
      expect(row.prospectName).toBe('Jane Smith');
      expect(row.createdById).toBe(a.agentId);
      expect(row.tenantId).toBe(a.tenantId);
    });

    it("puts the quote on the customer's timeline, with no health data", async () => {
      const res = await save(as(a.tenantId, a.agentId), {
        insuranceLeadId: a.janeId,
        applicant: {
          ...BASE,
          conditions: [{ code: 'DIABETES', diagnosedMonthsAgo: 90, treatedMonthsAgo: 0 }],
        },
      });
      expect(res.statusCode).toBe(201);
      const activity = await prisma.insuranceActivity.findFirstOrThrow({
        where: {
          insuranceLeadId: a.janeId,
          type: 'QUOTE',
          metadata: { path: ['fexQuoteId'], equals: res.json().data.id },
        },
      });
      expect(activity.tenantId).toBe(a.tenantId);
      expect(activity.createdById).toBe(a.agentId);
      expect(activity.title).toBe('Quote saved');
      expect(JSON.stringify(activity)).not.toMatch(/diabetes/i);
    });

    it("refuses a colleague's customer and saves nothing", async () => {
      const before = await prisma.fexQuote.count({ where: { tenantId: a.tenantId } });
      const res = await save(as(a.tenantId, a.agentId), { insuranceLeadId: a.bobId });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe('CUSTOMER_NOT_FOUND');
      expect(await prisma.fexQuote.count({ where: { tenantId: a.tenantId } })).toBe(before);
    });

    it('refuses an unassigned customer to an agent, and allows it to the owner', async () => {
      const refused = await save(as(a.tenantId, a.agentId), { insuranceLeadId: a.unassignedId });
      expect(refused.statusCode).toBe(404);
      const owner = await save(as(a.tenantId, a.ownerId), { insuranceLeadId: a.unassignedId });
      expect(owner.statusCode).toBe(201);
    });

    it("refuses another agency's customer, even to that agency's owner id", async () => {
      const res = await save(as(b.tenantId, b.ownerId), { insuranceLeadId: a.janeId });
      expect(res.statusCode).toBe(404);
      expect(
        await prisma.fexQuote.count({ where: { insuranceLeadId: a.janeId, tenantId: b.tenantId } })
      ).toBe(0);
    });

    it("refuses a customer outside the agent's license with a 403", async () => {
      const res = await save(as(a.tenantId, a.restrictedId), { insuranceLeadId: a.floridaId });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('STATE_NOT_LICENSED');
    });

    it('refuses a customer quote with no customer', async () => {
      const res = await save(as(a.tenantId, a.agentId), {});
      expect(res.statusCode).toBe(400);
    });

    it('keeps the softphone behaviour: an unreachable lead is dropped, the quote saved', async () => {
      const res = await save(as(a.tenantId, a.agentId), {
        source: 'SOFTPHONE',
        insuranceLeadId: a.bobId,
      });
      expect(res.statusCode).toBe(201);
      const row = await prisma.fexQuote.findUniqueOrThrow({ where: { id: res.json().data.id } });
      expect(row.insuranceLeadId).toBeNull();
    });
  });

  // ── A customer's quotes ────────────────────────────────────────────────────

  describe("listing a customer's quotes", () => {
    let colleagues: string;

    beforeAll(async () => {
      // Bob's quote, run by his own agent; then Bob is reassigned to `agentId`.
      colleagues = (await save(as(a.tenantId, a.otherAgentId), { insuranceLeadId: a.bobId })).json()
        .data.id;
      await prisma.insuranceLead.update({
        where: { id: a.bobId },
        data: { assignedToId: a.agentId },
      });
    });

    afterAll(async () => {
      await prisma.insuranceLead.update({
        where: { id: a.bobId },
        data: { assignedToId: a.otherAgentId },
      });
    });

    it("returns only that customer's quotes, newest first, with a total", async () => {
      const res = await customerQuotes(as(a.tenantId, a.agentId), a.janeId);
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.length).toBeGreaterThanOrEqual(2);
      expect(body.total).toBe(body.data.length);
      for (const q of body.data) expect(q.insuranceLeadId).toBe(a.janeId);
      const times = body.data.map((q: any) => Date.parse(q.createdAt));
      expect([...times].sort((x, y) => y - x)).toEqual(times);
      // Summary columns only: no applicant, no results.
      expect(body.data[0].applicant).toBeUndefined();
      expect(body.data[0].results).toBeUndefined();
      expect(res.body).not.toContain('Encrypted');
    });

    it("includes a colleague's earlier quote for a customer now the agent's", async () => {
      const res = await customerQuotes(as(a.tenantId, a.agentId), a.bobId);
      expect(res.statusCode).toBe(200);
      expect(res.json().data.map((q: any) => q.id)).toContain(colleagues);
      const read = await app.inject({
        method: 'GET',
        url: `/api/v1/fex/quotes/${colleagues}`,
        headers: as(a.tenantId, a.agentId),
      });
      expect(read.statusCode).toBe(200);
      expect(read.json().data.applicant.state).toBe('TX');
    });

    it("hides a customer the agent does not hold, and their quotes' detail", async () => {
      const res = await customerQuotes(as(a.tenantId, a.otherAgentId), a.janeId);
      expect(res.statusCode).toBe(404);
      const janes = (await customerQuotes(as(a.tenantId, a.ownerId), a.janeId)).json().data;
      const read = await app.inject({
        method: 'GET',
        url: `/api/v1/fex/quotes/${janes[0].id}`,
        headers: as(a.tenantId, a.otherAgentId),
      });
      expect(read.statusCode).toBe(404);
    });

    it("never serves one agency's customer to another", async () => {
      const res = await customerQuotes(as(b.tenantId, b.ownerId), a.janeId);
      expect(res.statusCode).toBe(404);
    });

    it("refuses a customer outside the agent's license", async () => {
      const res = await customerQuotes(as(a.tenantId, a.restrictedId), a.floridaId);
      expect(res.statusCode).toBe(403);
    });

    it('pages with a cursor', async () => {
      const first = (await customerQuotes(as(a.tenantId, a.ownerId), a.janeId, '?limit=1')).json();
      expect(first.data).toHaveLength(1);
      expect(first.nextCursor).toBe(first.data[0].id);
      const second = (
        await customerQuotes(
          as(a.tenantId, a.ownerId),
          a.janeId,
          `?limit=1&cursor=${first.nextCursor}`
        )
      ).json();
      expect(second.data[0].id).not.toBe(first.data[0].id);
    });
  });

  // ── History stays history ──────────────────────────────────────────────────

  describe('requoting', () => {
    it('creates a new record and leaves the original untouched', async () => {
      const original = (
        await save(as(a.tenantId, a.agentId), {
          insuranceLeadId: a.janeId,
          selectedProductId: 'sons_of_norway_legacysure',
        })
      ).json().data;
      const before = await prisma.fexQuote.findUniqueOrThrow({ where: { id: original.id } });

      const requote = await save(as(a.tenantId, a.agentId), {
        insuranceLeadId: a.janeId,
        applicant: { ...BASE, face: 15000 },
      });
      expect(requote.statusCode).toBe(201);
      expect(requote.json().data.id).not.toBe(original.id);

      const after = await prisma.fexQuote.findUniqueOrThrow({ where: { id: original.id } });
      expect(after).toEqual(before);
      expect(openJson<any>(after.applicantEncrypted).face).toBe(10000);

      // The stored snapshot, not a recalculation, is what reading it returns.
      const read = await app.inject({
        method: 'GET',
        url: `/api/v1/fex/quotes/${original.id}`,
        headers: as(a.tenantId, a.agentId),
      });
      const data = read.json().data;
      expect(data.applicant.face).toBe(10000);
      expect(data.selectedPremium).toBe(Number(before.selectedPremium));
      expect(data.selectedApplication).toMatchObject({ product: before.selectedProduct });
    });
  });

  // ── Into an application ────────────────────────────────────────────────────

  describe('writing the application from the customer', () => {
    it("keeps a colleague's quote run for this same customer, and records the link", async () => {
      const quoteId = (
        await save(as(a.tenantId, a.otherAgentId), { insuranceLeadId: a.bobId })
      ).json().data.id;
      await prisma.insuranceLead.update({
        where: { id: a.bobId },
        data: { assignedToId: a.agentId },
      });
      try {
        const res = await app.inject({
          method: 'POST',
          url: `/api/v1/insurance-leads/${a.bobId}/application`,
          headers: as(a.tenantId, a.agentId),
          payload: {
            clientRequestId: randomUUID(),
            carrier: 'Sons of Norway',
            faceAmount: 10000,
            modalPremium: 588.12,
            paymentMode: 'ANNUAL',
            firstName: 'Bob',
            lastName: 'Jones',
            fexQuoteId: quoteId,
          },
        });
        expect(res.statusCode).toBe(201);
        const application = await prisma.insuranceCarrierApplication.findFirstOrThrow({
          where: { tenantId: a.tenantId, insuranceLeadId: a.bobId },
        });
        expect(application.fexQuoteId).toBe(quoteId);

        const listed = (await customerQuotes(as(a.tenantId, a.agentId), a.bobId)).json().data;
        expect(listed.find((q: any) => q.id === quoteId).applicationId).toBe(application.id);

        const activity = await prisma.insuranceActivity.findFirst({
          where: { insuranceLeadId: a.bobId, title: 'Application written from quote' },
        });
        expect(activity).not.toBeNull();
      } finally {
        await prisma.insuranceLead.update({
          where: { id: a.bobId },
          data: { assignedToId: a.otherAgentId },
        });
      }
    });
  });
});
