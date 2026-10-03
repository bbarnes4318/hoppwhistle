/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { RoleName } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * Prospect intakes have an owner, and an agent sees their own.
 *
 * ── What it had ──────────────────────────────────────────────────────────────
 *
 * Every route tenant-scoped and nothing more, and `ProspectIntake.agentId`
 * never written. Any agent could list a colleague's prospects, archive them,
 * or overwrite one -- name, date of birth, beneficiaries -- by submitting the
 * intake form with the same phone number.
 *
 * ── What must not change ─────────────────────────────────────────────────────
 *
 * The incoming-call screen pop. `GET /prospects/by-phone/:phone` serves any
 * agent in the agency, because whoever answers a call has to see who is
 * calling, and the agent who answered may save the intake for that caller.
 * Both have cases here, so a later tightening that broke the call floor fails
 * this suite rather than a live call.
 */

const gate = databaseGate();
announceSkip('Prospect intake agent scope', gate);

const TEST_JWT_SECRET = 'prospect-intake-agent-scope-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('prospect intake agent scope suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `Prospect intake suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('prospect intake agent scope', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;

  interface Agency {
    tenantId: string;
    ownerId: string;
    agentId: string;
    otherAgentId: string;
  }

  let a: Agency;
  let b: Agency;

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);
    const { registerProspectIntakeRoutes } = await import('../routes/prospect-intake.js');
    await instance.register(registerProspectIntakeRoutes);
    await instance.ready();
    return instance;
  }

  const as = (agency: Agency, userId: string) => ({
    authorization: `Bearer ${app.jwt.sign({ tenantId: agency.tenantId, userId, email: `${userId}@t.local` })}`,
  });

  const randomPhone = () => `615${Math.floor(1000000 + Math.random() * 8999999)}`;

  const submit = (agency: Agency, userId: string, payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/prospects/intake',
      headers: as(agency, userId),
      payload: { state: 'TN', source: 'intake_form_basic', ...payload },
    });

  const listIds = async (agency: Agency, userId: string): Promise<string[]> => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/prospects/intake',
      headers: as(agency, userId),
    });
    expect(res.statusCode).toBe(200);
    return (JSON.parse(res.body) as { prospects: Array<{ id: string }> }).prospects.map(p => p.id);
  };

  /** An intake taken by `userId`, through the route, so `agentId` is the route's doing. */
  async function intakeBy(agency: Agency, userId: string, firstName: string) {
    const phone = randomPhone();
    const res = await submit(agency, userId, { phone, firstName });
    expect(res.statusCode).toBe(200);
    return { id: JSON.parse(res.body).prospectId as string, phone };
  }

  async function seedAgency(label: string, roleIds: Record<string, string>): Promise<Agency> {
    const slug = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tenant = await prisma.tenant.create({
      data: { name: `${label} Insurance`, slug, status: 'ACTIVE' },
    });
    // Licensed in TN, and every intake here is TN: the licence is a separate
    // gate (`licensed-states.test.ts`), satisfied rather than exercised.
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
    return {
      tenantId: tenant.id,
      ownerId: owner.id,
      agentId: agent.id,
      otherAgentId: otherAgent.id,
    };
  }

  beforeAll(async () => {
    prisma = getPrismaClient();
    app = await buildApp();

    for (const table of [
      'prospect_intakes',
      'calls',
      'insurance_tasks',
      'insurance_activities',
      'insurance_lead_submissions',
      'insurance_leads',
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

  it('records who took the intake', async () => {
    const { id } = await intakeBy(a, a.agentId, 'Recorded');
    const row = await prisma.prospectIntake.findUnique({ where: { id } });
    expect(row?.agentId).toBe(a.agentId);
  });

  describe('the list is narrowed to the caller', () => {
    it("shows an agent their own intakes and not a colleague's", async () => {
      const own = await intakeBy(a, a.agentId, 'Own');
      const colleague = await intakeBy(a, a.otherAgentId, 'Colleague');

      const ids = await listIds(a, a.agentId);
      expect(ids).toContain(own.id);
      expect(ids).not.toContain(colleague.id);
    });

    it("shows the agency's owner every agent's intakes, and no other agency's", async () => {
      const own = await intakeBy(a, a.agentId, 'OwnerSees1');
      const colleague = await intakeBy(a, a.otherAgentId, 'OwnerSees2');
      const elsewhere = await intakeBy(b, b.agentId, 'OtherAgency');

      const ids = await listIds(a, a.ownerId);
      expect(ids).toContain(own.id);
      expect(ids).toContain(colleague.id);
      expect(ids).not.toContain(elsewhere.id);
    });
  });

  describe('archiving is narrowed to the caller', () => {
    it("refuses an agent a colleague's intake, and leaves it active", async () => {
      const colleague = await intakeBy(a, a.otherAgentId, 'NotYours');
      const res = await app.inject({
        method: 'DELETE',
        url: `/api/v1/prospects/intake/${colleague.id}`,
        headers: as(a, a.agentId),
      });
      expect(res.statusCode).toBe(404);
      const row = await prisma.prospectIntake.findUnique({ where: { id: colleague.id } });
      expect(row?.status).toBe('ACTIVE');
    });

    it('lets an agent archive their own, and the owner archive anyone’s', async () => {
      const own = await intakeBy(a, a.agentId, 'MineToArchive');
      const colleague = await intakeBy(a, a.otherAgentId, 'OwnerArchives');
      for (const [id, userId] of [
        [own.id, a.agentId],
        [colleague.id, a.ownerId],
      ]) {
        const res = await app.inject({
          method: 'DELETE',
          url: `/api/v1/prospects/intake/${id}`,
          headers: as(a, userId),
        });
        expect(res.statusCode).toBe(200);
      }
    });
  });

  describe("an agent cannot overwrite a colleague's intake", () => {
    it('refuses a re-submit of the same number, and writes nothing', async () => {
      const colleague = await intakeBy(a, a.otherAgentId, 'Original');
      const res = await submit(a, a.agentId, { phone: colleague.phone, firstName: 'Overwritten' });
      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.body).error.code).toBe('PROSPECT_HELD_ELSEWHERE');

      const row = await prisma.prospectIntake.findUnique({ where: { id: colleague.id } });
      expect(row?.firstName).toBe('Original');
      expect(row?.agentId).toBe(a.otherAgentId);
    });

    it('lets the agent who took it update it', async () => {
      const own = await intakeBy(a, a.agentId, 'Before');
      const res = await submit(a, a.agentId, { phone: own.phone, firstName: 'After' });
      expect(res.statusCode).toBe(200);
      const row = await prisma.prospectIntake.findUnique({ where: { id: own.id } });
      expect(row?.firstName).toBe('After');
    });

    it("lets the owner update an agent's intake without taking it over", async () => {
      const own = await intakeBy(a, a.agentId, 'AgentTook');
      const res = await submit(a, a.ownerId, { phone: own.phone, firstName: 'OwnerEdited' });
      expect(res.statusCode).toBe(200);
      const row = await prisma.prospectIntake.findUnique({ where: { id: own.id } });
      expect(row?.firstName).toBe('OwnerEdited');
      expect(row?.agentId).toBe(a.agentId);
    });
  });

  describe('the incoming-call screen pop is unchanged', () => {
    it("serves any agent in the agency a colleague's prospect by phone", async () => {
      const colleague = await intakeBy(a, a.otherAgentId, 'ScreenPop');
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/prospects/by-phone/${colleague.phone}`,
        headers: as(a, a.agentId),
      });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).prospect.firstName).toBe('ScreenPop');
    });

    it('still refuses another agency', async () => {
      const colleague = await intakeBy(a, a.otherAgentId, 'NotAcrossAgencies');
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/prospects/by-phone/${colleague.phone}`,
        headers: as(b, b.agentId),
      });
      expect(res.statusCode).toBe(404);
    });

    it("lets the agent who answered the caller save the intake for a colleague's prospect", async () => {
      const colleague = await intakeBy(a, a.otherAgentId, 'Caller');
      await prisma.call.create({
        data: {
          tenantId: a.tenantId,
          callSid: `sid-${Math.random().toString(36).slice(2)}`,
          status: 'COMPLETED',
          direction: 'INBOUND',
          toNumber: '+16155550000',
          callerId: `+1${colleague.phone}`,
          answeredByUserId: a.agentId,
        },
      });

      const res = await submit(a, a.agentId, {
        phone: colleague.phone,
        firstName: 'UpdatedOnCall',
      });
      expect(res.statusCode).toBe(200);
      const row = await prisma.prospectIntake.findUnique({ where: { id: colleague.id } });
      expect(row?.firstName).toBe('UpdatedOnCall');
      // Updating on the call does not take the prospect from the agent who has it.
      expect(row?.agentId).toBe(a.otherAgentId);
    });
  });

  describe('intakes from before ownership was recorded', () => {
    async function legacyIntake(firstName: string) {
      const phone = randomPhone();
      const row = await prisma.prospectIntake.create({
        data: { tenantId: a.tenantId, phone, firstName, state: 'TN' },
      });
      return { id: row.id, phone };
    }

    it('are hidden from agents and shown to the owner', async () => {
      const legacy = await legacyIntake('Legacy');
      expect(await listIds(a, a.agentId)).not.toContain(legacy.id);
      expect(await listIds(a, a.ownerId)).toContain(legacy.id);
    });

    it('go to the agent who answers the caller and saves the intake', async () => {
      const legacy = await legacyIntake('LegacyCaller');
      await prisma.call.create({
        data: {
          tenantId: a.tenantId,
          callSid: `sid-${Math.random().toString(36).slice(2)}`,
          status: 'COMPLETED',
          direction: 'INBOUND',
          toNumber: '+16155550000',
          callerId: `+1${legacy.phone}`,
          answeredByUserId: a.agentId,
        },
      });
      const res = await submit(a, a.agentId, { phone: legacy.phone, firstName: 'Claimed' });
      expect(res.statusCode).toBe(200);
      const row = await prisma.prospectIntake.findUnique({ where: { id: legacy.id } });
      expect(row?.agentId).toBe(a.agentId);
    });
  });

  describe('a manual CRM entry follows the CRM ownership rule', () => {
    it("assigns an agent's new CRM lead to them", async () => {
      const phone = randomPhone();
      const res = await submit(a, a.agentId, {
        phone,
        firstName: 'Manual',
        lastName: 'Entry',
        source: 'manual_crm_entry',
        sendToBuyer: false,
      });
      expect(res.statusCode).toBe(200);
      const lead = await prisma.insuranceLead.findFirst({ where: { tenantId: a.tenantId, phone } });
      expect(lead?.assignedToId).toBe(a.agentId);
    });

    it('refuses an agent a CRM lead a colleague holds, and writes no intake', async () => {
      const phone = randomPhone();
      await prisma.insuranceLead.create({
        data: {
          tenantId: a.tenantId,
          vertical: 'FE',
          firstName: 'Held',
          lastName: 'Elsewhere',
          phone,
          state: 'TN',
          assignedToId: a.otherAgentId,
        },
      });
      const res = await submit(a, a.agentId, {
        phone,
        firstName: 'Taken',
        source: 'manual_crm_entry',
        sendToBuyer: false,
      });
      expect(res.statusCode).toBe(409);
      expect(
        await prisma.prospectIntake.findFirst({ where: { tenantId: a.tenantId, phone } })
      ).toBeNull();
      const lead = await prisma.insuranceLead.findFirst({ where: { tenantId: a.tenantId, phone } });
      expect(lead?.firstName).toBe('Held');
    });
  });
});
