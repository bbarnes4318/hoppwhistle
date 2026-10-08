/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { randomUUID } from 'crypto';

import { RoleName } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { grantPlatformAdmin } from '../lib/platform-admin.js';
import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { registerReadOnlyPreview } from '../middleware/read-only-preview.js';
import { openJson } from '../services/fex/payload.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * The final expense quoter's API.
 *
 * What it must hold:
 *
 *   - a quote request is validated against the loaded carrier data, and the
 *     quote date is the server's, never the client's
 *   - nobody but NetEnroll staff sees research provenance (`reason.note`,
 *     `facts.staff`, death-benefit text)
 *   - a save re-runs the engine and stores the health answers encrypted
 *   - a saved quote is its author's (or the agency principal's), and no other
 *     agency's
 *   - the compute endpoint works inside a read-only role preview; saving does not
 *   - an application keeps a quote link only when it may reach the quote
 */

const gate = databaseGate();
announceSkip('FEX quote engine API', gate);

const TEST_JWT_SECRET = 'fex-quote-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('FEX quote suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `FEX quote suite cannot run: ${gate.reason}`).toBe(true);
  });
});

/** TX, female, 60, non-tobacco, $10,000 monthly: the golden sanity case. */
const BASE = {
  state: 'TX',
  sex: 'F',
  tobacco: false,
  age: 60,
  face: 10000,
  mode: 'monthly',
  conditions: [],
  meds: [],
};

describe.skipIf(!gate.available)('FEX quote engine API', () => {
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
  let staffId: string;
  let previewerId: string;

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);
    registerReadOnlyPreview(instance);
    const { registerFexRoutes } = await import('../routes/fex.js');
    const { registerApplicationRoutes } = await import('../routes/applications.js');
    await instance.register(registerFexRoutes);
    await instance.register(registerApplicationRoutes);
    await instance.ready();
    return instance;
  }

  const as = (tenantId: string | null, userId: string) => ({
    authorization: `Bearer ${app.jwt.sign({ tenantId, userId, email: `${userId}@t.local` })}`,
  });

  const quote = (headers: Record<string, string>, applicant: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/v1/fex/quote', headers, payload: { applicant } });

  const save = (headers: Record<string, string>, payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/fex/quotes',
      headers,
      payload: { applicant: BASE, source: 'PAGE', ...payload },
    });

  async function seedAgency(label: string, roleIds: Record<string, string>): Promise<Agency> {
    const slug = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tenant = await prisma.tenant.create({
      data: { name: `${label} Insurance`, slug, status: 'ACTIVE' },
    });
    const mkUser = async (name: string, roleId: string) =>
      prisma.user.create({
        data: {
          tenantId: tenant.id,
          email: `${name}@${slug}.local`,
          firstName: name,
          status: 'ACTIVE',
          roles: { create: { roleId } },
        },
      });
    const owner = await mkUser('owner', roleIds.OWNER);
    const agent = await mkUser('agent', roleIds.AGENT);
    const other = await mkUser('other', roleIds.AGENT);
    return { tenantId: tenant.id, ownerId: owner.id, agentId: agent.id, otherAgentId: other.id };
  }

  async function operator(name: string, tenantId: string, previewRole: string | null) {
    const user = await prisma.user.create({
      data: { email: `${name}-${Date.now()}@netenroll.local`, status: 'ACTIVE' },
    });
    await grantPlatformAdmin(user.id);
    await prisma.platformActingTenant.create({
      data: { userId: user.id, tenantId, previewRole },
    });
    return user.id;
  }

  beforeAll(async () => {
    prisma = getPrismaClient();
    app = await buildApp();

    for (const table of [
      'fex_quotes',
      'fex_tenant_settings',
      'insurance_carrier_applications',
      'insurance_leads',
      'calls',
      'audit_logs',
      'platform_acting_tenants',
      'platform_admins',
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
    staffId = await operator('staff', a.tenantId, null);
    previewerId = await operator('previewer', a.tenantId, 'AGENT');
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  // ── Validation ─────────────────────────────────────────────────────────────

  describe('validation', () => {
    const expect400 = async (applicant: Record<string, unknown>, field: string) => {
      const res = await quote(as(a.tenantId, a.agentId), applicant);
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.message).toContain(field);
      expect(body.error.message).not.toContain('\n');
    };

    it('refuses both age and dob, and neither', async () => {
      await expect400({ ...BASE, dob: '1965-01-01' }, 'age');
      const { age: _age, ...noAge } = BASE;
      void _age;
      await expect400(noAge, 'age');
    });

    it('refuses a state that is not one', async () => {
      await expect400({ ...BASE, state: 'ZZ' }, 'state');
    });

    it('refuses a condition code the carrier data does not have', async () => {
      await expect400({ ...BASE, conditions: [{ code: 'NOT_A_CONDITION' }] }, 'conditions.0.code');
    });

    it('refuses a medication id the carrier data does not have', async () => {
      await expect400({ ...BASE, meds: [{ drugId: 'not-a-drug' }] }, 'meds.0.drugId');
    });

    it('refuses face and budget together, and height without weight', async () => {
      await expect400({ ...BASE, budget: 50 }, 'face');
      await expect400({ ...BASE, heightIn: 64 }, 'weightLb');
    });

    it('ignores a quote date from the client', async () => {
      const res = await quote(as(a.tenantId, a.agentId), { ...BASE, quoteDate: '1990-01-01' });
      expect(res.statusCode).toBe(200);
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
        new Date()
      );
      expect(res.json().data.quoteDate).toBe(today);
    });
  });

  // ── Results ────────────────────────────────────────────────────────────────

  describe('results', () => {
    it('reproduces the published Sons of Norway premiums (golden sanity)', async () => {
      const female = await quote(as(a.tenantId, a.agentId), BASE);
      expect(female.statusCode).toBe(200);
      const f = female
        .json()
        .data.results.find((r: any) => r.productId === 'sons_of_norway_legacysure');
      expect(f.best.premium).toBe(49.01);

      const male = await quote(as(a.tenantId, a.agentId), { ...BASE, sex: 'M' });
      const m = male
        .json()
        .data.results.find((r: any) => r.productId === 'sons_of_norway_legacysure');
      expect(m.best.premium).toBe(58.55);
    });

    it('gives agents no research provenance', async () => {
      const res = await quote(as(a.tenantId, a.agentId), {
        ...BASE,
        conditions: [{ code: 'DIABETES', diagnosedMonthsAgo: 90, treatedMonthsAgo: 0 }],
      });
      const text = res.body;
      const results = res.json().data.results;
      expect(results.length).toBeGreaterThan(5);
      for (const r of results) {
        expect(r.facts.staff).toBeUndefined();
        for (const reason of r.reasons) expect('note' in reason).toBe(false);
        expect(r.best?.db ?? null).toBeNull();
      }
      expect(text).not.toMatch(/WebFetch/i);
      // No rate tables, rule records or Rx lists in a quote.
      expect(text).not.toContain('"tables"');
      expect(text).not.toContain('"rx"');
    });

    it('gives NetEnroll staff the source notes', async () => {
      const res = await quote(as(null, staffId), BASE);
      expect(res.statusCode).toBe(200);
      const r = res.json().data.results[0];
      expect(r.facts.staff).toBeDefined();
      expect(Array.isArray(r.facts.staff.notes)).toBe(true);
    });

    it('marks products appointed per the agency settings', async () => {
      const save = await app.inject({
        method: 'PUT',
        url: '/api/v1/fex/settings',
        headers: as(a.tenantId, a.ownerId),
        payload: {
          appointedOnly: true,
          appointedProductIds: ['sons_of_norway_legacysure'],
          defaultFace: 10000,
          defaultMode: 'monthly',
          showPriceOnly: true,
          autoOpenOnCall: true,
        },
      });
      expect(save.statusCode).toBe(200);
      const results = (await quote(as(a.tenantId, a.agentId), BASE)).json().data.results;
      for (const r of results) {
        expect(r.appointed).toBe(r.productId === 'sons_of_norway_legacysure');
      }
      // Another agency is untouched.
      const other = (await quote(as(b.tenantId, b.agentId), BASE)).json().data.results;
      expect(other.every((r: any) => r.appointed)).toBe(true);
    });

    it('drops price-only products when the agency hides them', async () => {
      await prisma.fexTenantSettings.update({
        where: { tenantId: a.tenantId },
        data: { showPriceOnly: false, appointedOnly: false },
      });
      const results = (await quote(as(a.tenantId, a.agentId), BASE)).json().data.results;
      expect(results.some((r: any) => r.uwLoaded === false)).toBe(false);
      await prisma.fexTenantSettings.update({
        where: { tenantId: a.tenantId },
        data: { showPriceOnly: true },
      });
      const all = (await quote(as(a.tenantId, a.agentId), BASE)).json().data.results;
      expect(all.some((r: any) => r.uwLoaded === false)).toBe(true);
    });

    it('serves the catalog without rate or rule data', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/fex/catalog',
        headers: as(a.tenantId, a.agentId),
      });
      expect(res.statusCode).toBe(200);
      const data = res.json().data;
      // 35 in the bundle, less Prosperity, which the agency no longer quotes.
      expect(data.products.length).toBe(34);
      expect(data.products.some((p: any) => /prosperity/i.test(p.family))).toBe(false);
      expect(data.products.some((p: any) => !p.quotable)).toBe(true);
      expect(data.conditions.length).toBeGreaterThan(100);
      expect(res.body).not.toContain('"tables"');
      expect(res.body).not.toContain('"rules":[');
    });

    it('looks medications up', async () => {
      const search = await app.inject({
        method: 'GET',
        url: '/api/v1/fex/drugs?q=metf',
        headers: as(a.tenantId, a.agentId),
      });
      const hit = search.json().data[0];
      expect(hit.generic.toLowerCase()).toContain('metformin');
      const one = await app.inject({
        method: 'GET',
        url: `/api/v1/fex/drugs/${hit.id}`,
        headers: as(a.tenantId, a.agentId),
      });
      expect(one.statusCode).toBe(200);
      expect(one.json().data.rules.every((r: any) => !('note' in r))).toBe(true);
      const missing = await app.inject({
        method: 'GET',
        url: '/api/v1/fex/drugs/not-a-drug',
        headers: as(a.tenantId, a.agentId),
      });
      expect(missing.statusCode).toBe(404);
    });
  });

  // ── Save ───────────────────────────────────────────────────────────────────

  describe('save', () => {
    it('re-quotes on the server and stores the health answers encrypted', async () => {
      const res = await save(as(a.tenantId, a.agentId), {
        applicant: {
          ...BASE,
          conditions: [{ code: 'HYPERTENSION', diagnosedMonthsAgo: 150, treatedMonthsAgo: 0 }],
        },
        selectedProductId: 'sons_of_norway_legacysure',
        // Results from the client are not read.
        results: [{ productId: 'sons_of_norway_legacysure', best: { premium: 1 } }],
      });
      expect(res.statusCode).toBe(201);
      const data = res.json().data;
      expect(data.selected.premium).toBe(49.01);
      expect(data.selected.application.annualizedPremium).toBe(588.12);

      const row = await prisma.fexQuote.findUniqueOrThrow({ where: { id: data.id } });
      expect(row.createdById).toBe(a.agentId);
      expect(row.applicantEncrypted.startsWith('enc:v1:')).toBe(true);
      expect(row.resultsEncrypted.startsWith('enc:v1:')).toBe(true);
      expect(row.applicantEncrypted).not.toContain('HYPERTENSION');
      expect(openJson<any>(row.applicantEncrypted).conditions[0].code).toBe('HYPERTENSION');
      expect(Number(row.selectedPremium)).toBe(49.01);

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'fex.quote.saved', entityId: data.id },
      });
      expect(JSON.stringify(audit?.changes)).not.toContain('HYPERTENSION');
    });

    it('refuses a selection that does not qualify', async () => {
      const res = await save(as(a.tenantId, a.agentId), {
        applicant: { ...BASE, state: 'TN' }, // LegacySure is not sold in TN
        selectedProductId: 'sons_of_norway_legacysure',
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('NOT_ELIGIBLE');
    });

    it("stores another agency's call and lead as null", async () => {
      const call = await prisma.call.create({
        data: {
          tenantId: b.tenantId,
          callSid: `sid-${randomUUID()}`,
          toNumber: '+15550000000',
          status: 'ANSWERED',
          direction: 'INBOUND',
          answeredByUserId: b.agentId,
        },
      });
      const lead = await prisma.insuranceLead.create({
        data: {
          tenantId: b.tenantId,
          vertical: 'FE',
          phone: '5550001111',
          assignedToId: b.agentId,
        },
      });
      const res = await save(as(a.tenantId, a.agentId), {
        callId: call.id,
        insuranceLeadId: lead.id,
      });
      expect(res.statusCode).toBe(201);
      const row = await prisma.fexQuote.findUniqueOrThrow({ where: { id: res.json().data.id } });
      expect(row.callId).toBeNull();
      expect(row.insuranceLeadId).toBeNull();
    });

    it('keeps a call the agent answered', async () => {
      const call = await prisma.call.create({
        data: {
          tenantId: a.tenantId,
          callSid: `sid-${randomUUID()}`,
          toNumber: '+15550000000',
          status: 'ANSWERED',
          direction: 'INBOUND',
          answeredByUserId: a.agentId,
        },
      });
      const res = await save(as(a.tenantId, a.agentId), { callId: call.id, source: 'SOFTPHONE' });
      const row = await prisma.fexQuote.findUniqueOrThrow({ where: { id: res.json().data.id } });
      expect(row.callId).toBe(call.id);
    });
  });

  // ── Scope ──────────────────────────────────────────────────────────────────

  describe('scope', () => {
    let mine: string;
    let theirs: string;

    beforeAll(async () => {
      mine = (await save(as(a.tenantId, a.agentId), { prospectName: 'Mine' })).json().data.id;
      theirs = (await save(as(a.tenantId, a.otherAgentId), { prospectName: 'Theirs' })).json().data
        .id;
    });

    const list = async (tenantId: string, userId: string, query = '') => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/fex/quotes${query}`,
        headers: as(tenantId, userId),
      });
      expect(res.statusCode).toBe(200);
      return res.json().data.map((r: any) => r.id) as string[];
    };
    const read = (tenantId: string, userId: string, id: string) =>
      app.inject({ method: 'GET', url: `/api/v1/fex/quotes/${id}`, headers: as(tenantId, userId) });

    it("an agent lists and reads their own quotes and not a colleague's", async () => {
      const ids = await list(a.tenantId, a.agentId, `?agentId=${a.otherAgentId}`);
      expect(ids).toContain(mine);
      expect(ids).not.toContain(theirs);
      expect((await read(a.tenantId, a.agentId, mine)).statusCode).toBe(200);
      expect((await read(a.tenantId, a.agentId, theirs)).statusCode).toBe(404);
    });

    it('the owner sees both, decrypted', async () => {
      const ids = await list(a.tenantId, a.ownerId);
      expect(ids).toEqual(expect.arrayContaining([mine, theirs]));
      const res = await read(a.tenantId, a.ownerId, theirs);
      expect(res.statusCode).toBe(200);
      expect(res.json().data.applicant.state).toBe('TX');
      expect(res.json().data.results.length).toBeGreaterThan(0);
      const filtered = await list(a.tenantId, a.ownerId, `?agentId=${a.otherAgentId}`);
      expect(filtered).toContain(theirs);
      expect(filtered).not.toContain(mine);
    });

    it('another agency sees neither', async () => {
      const ids = await list(b.tenantId, b.ownerId);
      expect(ids).not.toContain(mine);
      expect(ids).not.toContain(theirs);
      expect((await read(b.tenantId, b.ownerId, mine)).statusCode).toBe(404);
    });

    it('insights and agency settings are the principal’s', async () => {
      const insights = await app.inject({
        method: 'GET',
        url: '/api/v1/fex/insights',
        headers: as(a.tenantId, a.agentId),
      });
      expect(insights.statusCode).toBe(403);
      const put = await app.inject({
        method: 'PUT',
        url: '/api/v1/fex/settings',
        headers: as(a.tenantId, a.agentId),
        payload: {
          appointedOnly: false,
          appointedProductIds: [],
          defaultFace: 10000,
          defaultMode: 'monthly',
          showPriceOnly: true,
          autoOpenOnCall: true,
        },
      });
      expect(put.statusCode).toBe(403);

      const owner = await app.inject({
        method: 'GET',
        url: '/api/v1/fex/insights',
        headers: as(a.tenantId, a.ownerId),
      });
      expect(owner.statusCode).toBe(200);
      expect(owner.json().data.quotes).toBeGreaterThanOrEqual(2);
    });

    it('an agent keeps their own open-on-connect choice', async () => {
      const put = await app.inject({
        method: 'PUT',
        url: '/api/v1/fex/settings/me',
        headers: as(a.tenantId, a.agentId),
        payload: { autoOpenOnCall: false },
      });
      expect(put.statusCode).toBe(200);
      const get = await app.inject({
        method: 'GET',
        url: '/api/v1/fex/settings',
        headers: as(a.tenantId, a.agentId),
      });
      expect(get.json().data.me.autoOpenOnCall).toBe(false);
    });

    it("an agent's carriers narrow their quotes, and nobody else's", async () => {
      const mine = (payload: Record<string, unknown>) =>
        app.inject({
          method: 'PUT',
          url: '/api/v1/fex/settings/me',
          headers: as(a.tenantId, a.otherAgentId),
          payload,
        });

      const everyone = await quote(as(a.tenantId, a.otherAgentId), BASE);
      expect(everyone.json().data.carriers).toBeNull();
      const families = [
        ...new Set(everyone.json().data.results.map((r: any) => r.family as string)),
      ] as string[];
      expect(families.length).toBeGreaterThan(2);
      const picked = families.slice(0, 2);

      expect((await mine({ carriers: ['Not A Carrier'] })).statusCode).toBe(400);
      expect((await mine({ carriers: [] })).statusCode).toBe(400);
      expect((await mine({})).statusCode).toBe(400);

      const put = await mine({ carriers: picked });
      expect(put.statusCode).toBe(200);
      expect(put.json().data.me.carriers).toEqual([...picked].sort((x, y) => x.localeCompare(y)));
      // The other choice is untouched by a carriers-only write.
      expect(put.json().data.me.autoOpenOnCall).toBeNull();

      const narrowed = await quote(as(a.tenantId, a.otherAgentId), BASE);
      const seen = new Set(narrowed.json().data.results.map((r: any) => r.family as string));
      expect([...seen].sort()).toEqual([...picked].sort());
      expect(narrowed.json().data.carriers.selected).toBe(2);

      // A colleague's quotes are not narrowed by this agent's pick.
      const colleague = await quote(as(a.tenantId, a.ownerId), BASE);
      expect(colleague.json().data.carriers).toBeNull();

      // Every carrier picked is stored as "every carrier".
      const catalog = await app.inject({
        method: 'GET',
        url: '/api/v1/fex/catalog',
        headers: as(a.tenantId, a.otherAgentId),
      });
      const all = [
        ...new Set(
          catalog
            .json()
            .data.products.filter((p: any) => p.quotable)
            .map((p: any) => p.family as string)
        ),
      ];
      const reset = await mine({ carriers: all });
      expect(reset.json().data.me.carriers).toBeNull();
      expect((await quote(as(a.tenantId, a.otherAgentId), BASE)).json().data.carriers).toBeNull();
    });
  });

  // ── Read-only preview ──────────────────────────────────────────────────────

  describe('read-only role preview', () => {
    it('lets a previewing operator quote', async () => {
      const res = await quote(as(null, previewerId), BASE);
      expect(res.statusCode).toBe(200);
    });

    it('does not let a previewing operator save', async () => {
      const res = await save(as(null, previewerId), {});
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('PREVIEW_READ_ONLY');
    });
  });

  // ── Applications ───────────────────────────────────────────────────────────

  describe('applications carry the quote they were written from', () => {
    const submit = (tenantId: string, userId: string, fexQuoteId: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/applications',
        headers: as(tenantId, userId),
        payload: {
          clientRequestId: randomUUID(),
          carrier: 'Sons of Norway',
          faceAmount: 10000,
          modalPremium: 49.01,
          firstName: 'Ada',
          lastName: 'Quote',
          fexQuoteId,
        },
      });

    it('stores a quote from the same agency', async () => {
      const id = (await save(as(a.tenantId, a.agentId), {})).json().data.id;
      const res = await submit(a.tenantId, a.agentId, id);
      expect(res.statusCode).toBeLessThan(300);
      const row = await prisma.insuranceCarrierApplication.findFirstOrThrow({
        where: { tenantId: a.tenantId, fexQuoteId: id },
      });
      expect(row.fexQuoteId).toBe(id);

      const listed = await app.inject({
        method: 'GET',
        url: '/api/v1/fex/quotes',
        headers: as(a.tenantId, a.agentId),
      });
      expect(listed.json().data.find((q: any) => q.id === id).applicationId).toBe(row.id);
    });

    it("stores another agency's quote as null and still saves", async () => {
      const foreign = (await save(as(b.tenantId, b.agentId), {})).json().data.id;
      const res = await submit(a.tenantId, a.agentId, foreign);
      expect(res.statusCode).toBeLessThan(300);
      const rows = await prisma.insuranceCarrierApplication.findMany({
        where: { tenantId: a.tenantId, lastName: 'Quote', fexQuoteId: null },
      });
      expect(rows.length).toBeGreaterThanOrEqual(1);
      const linked = await prisma.insuranceCarrierApplication.count({
        where: { fexQuoteId: foreign },
      });
      expect(linked).toBe(0);
    });

    it("stores a colleague's quote as null for an agent", async () => {
      const colleagues = (await save(as(a.tenantId, a.otherAgentId), {})).json().data.id;
      const res = await submit(a.tenantId, a.agentId, colleagues);
      expect(res.statusCode).toBeLessThan(300);
      expect(
        await prisma.insuranceCarrierApplication.count({ where: { fexQuoteId: colleagues } })
      ).toBe(0);
    });
  });
});
