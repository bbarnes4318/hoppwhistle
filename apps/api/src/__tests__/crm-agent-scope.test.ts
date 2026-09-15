/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { RoleName } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * The CRM has an owner, and an agent sees their own book.
 *
 * ── What it had ──────────────────────────────────────────────────────────────
 *
 * Eighteen routes, every one tenant-scoped and nothing more. Every agent in an
 * agency could read every lead in it: names, dates of birth, phone numbers,
 * requested coverage. `InsuranceLead.assignedToId` has existed in the schema
 * the whole time -- the CRM simply never filtered on it, so the ownership the
 * product already modelled was not enforced anywhere.
 *
 * ── The two dimensions, which are not the same thing ─────────────────────────
 *
 * Tenant scope is a wall between customers: absolute, on every query, never
 * decided by a role. Agent scope is a narrowing inside one agency: decided by
 * role, applied only to rows that have an owner, and always on top of a tenant
 * filter. The cases below exercise both, because a fix that got one right and
 * the other wrong would still be a breach.
 *
 * ── Why the unassigned lead has its own case ─────────────────────────────────
 *
 * A lead nobody has picked up belongs to the agency, not to nobody. Treating
 * `assignedToId IS NULL` as "unowned, so anyone may read it" would hand every
 * agent the whole unworked pile, which on a fresh import is the entire book --
 * a fix that looks like scoping and leaks almost everything.
 */

const gate = databaseGate();
announceSkip('CRM agent scope', gate);

const TEST_JWT_SECRET = 'crm-agent-scope-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('CRM agent scope suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `CRM agent scope suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('CRM agent scope', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;

  interface Agency {
    tenantId: string;
    ownerId: string;
    agentId: string;
    otherAgentId: string;
    /** Assigned to `agentId`. */
    ownLeadId: string;
    /** Assigned to `otherAgentId`. */
    colleagueLeadId: string;
    /** Assigned to nobody. The agency's, not anyone's. */
    unassignedLeadId: string;
    listId: string;
  }

  let a: Agency;
  let b: Agency;

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);
    const { registerInsuranceLeadRoutes } = await import('../routes/insurance-leads.js');
    await instance.register(registerInsuranceLeadRoutes);
    await instance.ready();
    return instance;
  }

  const as = (agency: Agency, userId: string) => ({
    authorization: `Bearer ${app.jwt.sign({ tenantId: agency.tenantId, userId, email: `${userId}@t.local` })}`,
  });

  const get = (url: string, headers: Record<string, string>) =>
    app.inject({ method: 'GET', url, headers });

  /** The lead ids in a list response. */
  const idsIn = (body: string): string[] =>
    (JSON.parse(body) as { data: Array<{ id: string }> }).data.map(lead => lead.id);

  async function seedAgency(label: string, roleIds: Record<string, string>): Promise<Agency> {
    const slug = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tenant = await prisma.tenant.create({
      data: { name: `${label} Insurance`, slug, status: 'ACTIVE' },
    });

    /*
     * The agents are licensed in TN, and the leads below are TN leads.
     *
     * Ownership and licensed state are separate gates and this suite is about
     * the first one, so the second is satisfied for every case here rather than
     * exercised: an agent with no licence is refused every lead in the agency,
     * which would make each assertion below pass for the wrong reason.
     * `lib/__tests__/licensed-states.test.ts` is where the licence itself is
     * tested. No assertion in this file was changed to accommodate it -- the
     * refusals it checks are still ownership refusals, and still 404.
     */
    const mkUser = async (name: string, roleId: string, licensedStates?: string[]) =>
      prisma.user.create({
        data: {
          tenantId: tenant.id,
          email: `${name}@${slug}.local`,
          status: 'ACTIVE',
          metadata: licensedStates ? { licensedStates } : undefined,
          roles: { create: { roleId } },
        },
      });

    const owner = await mkUser('owner', roleIds.OWNER);
    const agent = await mkUser('agent', roleIds.AGENT, ['TN']);
    const otherAgent = await mkUser('other', roleIds.AGENT, ['TN']);

    const list = await prisma.leadList.create({
      data: { tenantId: tenant.id, name: `${label} List`, vertical: 'FE' },
    });

    const mkLead = async (who: string | null, first: string) =>
      prisma.insuranceLead.create({
        data: {
          tenantId: tenant.id,
          vertical: 'FE',
          firstName: first,
          lastName: label,
          phone: `555${Math.floor(1000000 + Math.random() * 8999999)}`,
          state: 'TN',
          assignedToId: who,
          listId: list.id,
        },
      });

    const own = await mkLead(agent.id, 'Own');
    const colleague = await mkLead(otherAgent.id, 'Colleague');
    const unassigned = await mkLead(null, 'Unassigned');

    return {
      tenantId: tenant.id,
      ownerId: owner.id,
      agentId: agent.id,
      otherAgentId: otherAgent.id,
      ownLeadId: own.id,
      colleagueLeadId: colleague.id,
      unassignedLeadId: unassigned.id,
      listId: list.id,
    };
  }

  beforeAll(async () => {
    prisma = getPrismaClient();
    app = await buildApp();

    for (const table of [
      'insurance_tasks',
      'insurance_activities',
      'insurance_lead_submissions',
      'insurance_leads',
      'lead_lists',
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

  describe('the list is narrowed to the caller', () => {
    it('shows an agent only the leads they hold', async () => {
      const res = await get('/api/v1/insurance-leads?limit=100', as(a, a.agentId));
      expect(res.statusCode).toBe(200);
      const ids = idsIn(res.body);

      expect(ids).toContain(a.ownLeadId);
      expect(ids).not.toContain(a.colleagueLeadId);
      expect(ids).not.toContain(a.unassignedLeadId);
      expect(ids).not.toContain(b.ownLeadId);
    });

    it("shows the agency's principal the whole book", async () => {
      const res = await get('/api/v1/insurance-leads?limit=100', as(a, a.ownerId));
      const ids = idsIn(res.body);

      // The change must not have narrowed the people it was not about.
      expect(ids).toContain(a.ownLeadId);
      expect(ids).toContain(a.colleagueLeadId);
      expect(ids).toContain(a.unassignedLeadId);
      // ...and still nothing of the other agency's.
      expect(ids).not.toContain(b.ownLeadId);
    });

    it('narrows the CSV export exactly as it narrows the grid', async () => {
      // An export that ignored the narrowing would be the agency's whole book
      // in a file, reached from a page that showed one row.
      const res = await get('/api/v1/insurance-leads?format=csv', as(a, a.agentId));
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('Own');
      expect(res.body).not.toContain('Colleague');
      expect(res.body).not.toContain('Unassigned');
    });
  });

  describe('a lead is fetched by id only by someone who holds it', () => {
    it('serves an agent their own lead', async () => {
      expect(
        (await get(`/api/v1/insurance-leads/${a.ownLeadId}`, as(a, a.agentId))).statusCode
      ).toBe(200);
    });

    it("refuses an agent a colleague's lead", async () => {
      expect(
        (await get(`/api/v1/insurance-leads/${a.colleagueLeadId}`, as(a, a.agentId))).statusCode
      ).toBe(404);
    });

    it("refuses an agent an unassigned lead — it is the agency's", async () => {
      expect(
        (await get(`/api/v1/insurance-leads/${a.unassignedLeadId}`, as(a, a.agentId))).statusCode
      ).toBe(404);
    });

    it("refuses another tenant's agent, and another tenant's owner", async () => {
      expect(
        (await get(`/api/v1/insurance-leads/${a.ownLeadId}`, as(b, b.agentId))).statusCode
      ).toBe(404);
      expect(
        (await get(`/api/v1/insurance-leads/${a.ownLeadId}`, as(b, b.ownerId))).statusCode
      ).toBe(404);
    });

    it('serves the principal any lead in their agency', async () => {
      for (const id of [a.ownLeadId, a.colleagueLeadId, a.unassignedLeadId]) {
        expect((await get(`/api/v1/insurance-leads/${id}`, as(a, a.ownerId))).statusCode).toBe(200);
      }
    });
  });

  describe('writes respect the same ownership', () => {
    const patch = (id: string, headers: Record<string, string>) =>
      app.inject({
        method: 'PATCH',
        url: `/api/v1/insurance-leads/${id}`,
        headers,
        payload: { notes: 'touched' },
      });

    it("refuses an agent editing a colleague's lead", async () => {
      expect((await patch(a.colleagueLeadId, as(a, a.agentId))).statusCode).toBe(404);
      const row = await prisma.insuranceLead.findUnique({ where: { id: a.colleagueLeadId } });
      expect(row?.notes ?? null).toBeNull();
    });

    it('lets an agent edit their own', async () => {
      expect((await patch(a.ownLeadId, as(a, a.agentId))).statusCode).toBe(200);
    });

    it("refuses an agent listing tasks on a colleague's lead", async () => {
      const res = await get(`/api/v1/insurance-leads/${a.colleagueLeadId}/tasks`, as(a, a.agentId));
      expect(res.statusCode).toBe(404);
    });
  });

  describe("the counts are the caller's counts", () => {
    it('counts one lead for an agent and three for the principal', async () => {
      const agent = JSON.parse((await get('/api/v1/insurance-leads/stats', as(a, a.agentId))).body);
      const owner = JSON.parse((await get('/api/v1/insurance-leads/stats', as(a, a.ownerId))).body);

      expect(agent.totalLeads).toBe(1);
      expect(owner.totalLeads).toBe(3);
    });
  });

  describe('a lead list id from the request cannot cross a tenant', () => {
    it("refuses an import naming another agency's list", async () => {
      // `targetListId` flows into every lead the import creates, so a list id
      // that resolved cross-tenant filed a batch into another customer's list.
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/insurance-leads/import',
        headers: as(a, a.ownerId),
        payload: {
          listId: b.listId,
          vertical: 'FE',
          leads: [{ firstName: 'X', phone: '5551112222' }],
        },
      });

      expect(res.statusCode).toBe(400);
      const filed = await prisma.insuranceLead.count({
        where: { listId: b.listId, tenantId: a.tenantId },
      });
      expect(filed).toBe(0);
    });
  });
});
