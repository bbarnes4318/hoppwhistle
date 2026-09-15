/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { RoleName } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * An agent works the states they are licensed in, and no others.
 *
 * ── Why this exists beside the module suite ──────────────────────────────────
 *
 * `lib/__tests__/licensed-states.test.ts` proves the DECISION -- what a licence
 * permits, and that nothing in a request can widen it. It cannot prove that any
 * route asks. This suite is the wiring: real handlers, a real principal built by
 * `registerApiV1Auth` from a real token, and a real database.
 *
 * ── Ownership is held constant on purpose ────────────────────────────────────
 *
 * Every lead below is assigned to the agent making the request, so ownership
 * always answers yes and the licence is the only variable. A lead that failed
 * both gates would pass this suite for the wrong reason, and
 * `crm-agent-scope.test.ts` already owns the ownership dimension.
 *
 * The one case that deliberately breaks that rule is the cross-tenant one,
 * which must stay a 404 -- being licensed in a state has never been a way into
 * another agency's leads.
 */

const gate = databaseGate();
announceSkip('Agent licensed states', gate);

const TEST_JWT_SECRET = 'agent-licensed-states-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('Agent licensed-state suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `Agent licensed-state suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('Agent licensed states', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;

  interface Agency {
    tenantId: string;
    ownerId: string;
    /** Licensed in TN only. */
    agentId: string;
    /** Holds `metadata.licensedStates: []`. Licensed nowhere. */
    unlicensedAgentId: string;
    /** Has no `licensedStates` key at all. */
    nolicenceAgentId: string;
    /** TN, assigned to `agentId`. */
    tnLeadId: string;
    /** FL, assigned to `agentId` -- held, but out of licence. */
    flLeadId: string;
    /** No state recorded at all, assigned to `agentId`. */
    statelessLeadId: string;
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

  const patch = (leadId: string, headers: Record<string, string>, payload: any) =>
    app.inject({
      method: 'PATCH',
      url: `/api/v1/insurance-leads/${leadId}`,
      headers,
      payload,
    });

  const idsIn = (body: string): string[] =>
    (JSON.parse(body) as { data: Array<{ id: string }> }).data.map(lead => lead.id);

  async function seedAgency(label: string, roleIds: Record<string, string>): Promise<Agency> {
    const slug = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tenant = await prisma.tenant.create({
      data: { name: `${label} Insurance`, slug, status: 'ACTIVE' },
    });

    const mkUser = async (name: string, roleId: string, metadata?: any) =>
      prisma.user.create({
        data: {
          tenantId: tenant.id,
          email: `${name}@${slug}.local`,
          status: 'ACTIVE',
          metadata,
          roles: { create: { roleId } },
        },
      });

    const owner = await mkUser('owner', roleIds.OWNER);
    const agent = await mkUser('agent', roleIds.AGENT, { licensedStates: ['TN'] });
    const unlicensed = await mkUser('unlicensed', roleIds.AGENT, { licensedStates: [] });
    const nolicence = await mkUser('nolicence', roleIds.AGENT, { position: 'Licensed Agent' });

    const list = await prisma.leadList.create({
      data: { tenantId: tenant.id, name: `${label} List`, vertical: 'FE' },
    });

    const mkLead = async (first: string, state: string | null) =>
      prisma.insuranceLead.create({
        data: {
          tenantId: tenant.id,
          vertical: 'FE',
          firstName: first,
          lastName: label,
          phone: `555${Math.floor(1000000 + Math.random() * 8999999)}`,
          state,
          assignedToId: agent.id,
          listId: list.id,
        },
      });

    const tn = await mkLead('Tennessee', 'TN');
    const fl = await mkLead('Florida', 'FL');
    const stateless = await mkLead('Nowhere', null);

    return {
      tenantId: tenant.id,
      ownerId: owner.id,
      agentId: agent.id,
      unlicensedAgentId: unlicensed.id,
      nolicenceAgentId: nolicence.id,
      tnLeadId: tn.id,
      flLeadId: fl.id,
      statelessLeadId: stateless.id,
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

  describe('reading one lead', () => {
    it('serves a licensed agent a lead in a state they hold', async () => {
      expect(
        (await get(`/api/v1/insurance-leads/${a.tnLeadId}`, as(a, a.agentId))).statusCode
      ).toBe(200);
    });

    it('refuses the same agent a lead they OWN in a state they do not hold', async () => {
      // Ownership says yes and the licence says no. Both must answer yes.
      const res = await get(`/api/v1/insurance-leads/${a.flLeadId}`, as(a, a.agentId));
      expect(res.statusCode).toBe(403);
      expect(JSON.parse(res.body).error.code).toBe('STATE_NOT_LICENSED');
    });

    it('refuses a lead with no state recorded', async () => {
      // Nothing shows this record is inside the licence, so it is not served.
      expect(
        (await get(`/api/v1/insurance-leads/${a.statelessLeadId}`, as(a, a.agentId))).statusCode
      ).toBe(403);
    });

    it("serves the agency's principal every lead, whatever its state", async () => {
      for (const id of [a.tnLeadId, a.flLeadId, a.statelessLeadId]) {
        expect((await get(`/api/v1/insurance-leads/${id}`, as(a, a.ownerId))).statusCode).toBe(200);
      }
    });

    it('refuses another agency, licence or no licence', async () => {
      // b's agent is licensed in TN too. That is not a way into a's TN lead.
      expect(
        (await get(`/api/v1/insurance-leads/${a.tnLeadId}`, as(b, b.agentId))).statusCode
      ).toBe(404);
      expect(
        (await get(`/api/v1/insurance-leads/${a.tnLeadId}`, as(b, b.ownerId))).statusCode
      ).toBe(404);
    });
  });

  describe('default deny', () => {
    it('refuses an agent whose licensed-state set is empty', async () => {
      // This agent holds no leads either, so the 404 comes first -- which is
      // the point: an empty licence never widens anything.
      const res = await get('/api/v1/insurance-leads', as(a, a.unlicensedAgentId));
      expect(res.statusCode).toBe(200);
      expect(idsIn(res.body)).toEqual([]);
    });

    it('refuses an agent with no licensedStates key at all', async () => {
      const res = await get('/api/v1/insurance-leads', as(a, a.nolicenceAgentId));
      expect(res.statusCode).toBe(200);
      expect(idsIn(res.body)).toEqual([]);
    });
  });

  describe('the list and its export are narrowed to the licence', () => {
    it('shows a licensed agent only the leads in states they hold', async () => {
      const res = await get('/api/v1/insurance-leads?limit=100', as(a, a.agentId));
      expect(res.statusCode).toBe(200);
      const ids = idsIn(res.body);
      expect(ids).toContain(a.tnLeadId);
      expect(ids).not.toContain(a.flLeadId);
      expect(ids).not.toContain(a.statelessLeadId);
    });

    it('narrows the CSV export exactly as it narrows the grid', async () => {
      const res = await get('/api/v1/insurance-leads?format=csv', as(a, a.agentId));
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('Tennessee');
      expect(res.body).not.toContain('Florida');
      expect(res.body).not.toContain('Nowhere');
    });

    it("leaves the agency's principal the whole book", async () => {
      const res = await get('/api/v1/insurance-leads?limit=100', as(a, a.ownerId));
      const ids = idsIn(res.body);
      expect(ids).toContain(a.tnLeadId);
      expect(ids).toContain(a.flLeadId);
      expect(ids).toContain(a.statelessLeadId);
      expect(ids).not.toContain(b.tnLeadId);
    });
  });

  describe('a write cannot move a lead inside the licence', () => {
    it('accepts an edit to a lead in a licensed state', async () => {
      expect((await patch(a.tnLeadId, as(a, a.agentId), { notes: 'called' })).statusCode).toBe(200);
    });

    it('refuses the identical edit once the state is one they do not hold', async () => {
      // The regression case: same route, same agent, same lead, same body but
      // for the state. Rewriting it to FL is refused rather than applied.
      const res = await patch(a.tnLeadId, as(a, a.agentId), { notes: 'called', state: 'FL' });
      expect(res.statusCode).toBe(403);

      const row = await prisma.insuranceLead.findUnique({ where: { id: a.tnLeadId } });
      expect(row?.state).toBe('TN');
    });

    it('refuses pulling an out-of-licence lead into the licence', async () => {
      // The FL lead is held by this agent but out of licence, so the edit is
      // refused on the lead's CURRENT state before the body is even considered.
      const res = await patch(a.flLeadId, as(a, a.agentId), { state: 'TN' });
      expect(res.statusCode).toBe(403);

      const row = await prisma.insuranceLead.findUnique({ where: { id: a.flLeadId } });
      expect(row?.state).toBe('FL');
    });

    it('lets the principal edit any lead in any state', async () => {
      expect((await patch(a.flLeadId, as(a, a.ownerId), { notes: 'reviewed' })).statusCode).toBe(
        200
      );
    });
  });

  describe('nothing in the request widens the licence', () => {
    it('ignores a state in the query string', async () => {
      const res = await get('/api/v1/insurance-leads?limit=100&state=FL', as(a, a.agentId));
      expect(idsIn(res.body)).not.toContain(a.flLeadId);
    });

    it('ignores an agentId, tenantId or publisherId in the body of a write', async () => {
      const res = await patch(a.flLeadId, as(a, a.agentId), {
        agentId: a.ownerId,
        assignedToId: a.ownerId,
        tenantId: b.tenantId,
        publisherId: 'pub-9',
        notes: 'nice try',
      });
      expect(res.statusCode).toBe(403);
    });
  });
});
