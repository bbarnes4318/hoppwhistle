/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { RoleName } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { grantPlatformAdmin } from '../lib/platform-admin.js';
import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * An agency reading its own quota — from the session, and only from the session.
 *
 * ── What this suite is for ───────────────────────────────────────────────────
 *
 * `/settings/quotas` carried a hardcoded placeholder tenant id and asked three
 * platform routes about it, so it 404'd three times per load and never showed a
 * figure. The comment beside the placeholder said "from context or URL"; the
 * URL half is the thing this platform does not do, so the fix could not be to
 * read an id from the address bar. It is a session-scoped read:
 * `GET /api/v1/quota/summary`, which takes no tenant from anywhere.
 *
 * Four properties make that a fix rather than a different way to be wrong, and
 * they are what is asserted here:
 *
 *   1. It answers with the CALLER'S agency, with real figures, and never with
 *      another agency's — including when the request tries to name one.
 *   2. It carries neither the budget override token nor the Slack webhook URL.
 *      Both live on the row it reads; both are credentials.
 *   3. A platform operator with no agency entered gets 409 NO_ACTING_TENANT,
 *      not the 401 that sends the web client to the login page.
 *   4. An agency with no quota row gets 200 and nulls. "No ceiling" is a
 *      legitimate state and the common one; answering 404 for it is what made
 *      the placeholder page indistinguishable from a working one.
 *
 * It also pins the PATCH behaviour the settings form now depends on: an
 * explicit null CLEARS a ceiling. It used to coalesce to the stored value, so
 * emptying a field and saving reported success and changed nothing.
 */

const gate = databaseGate();
announceSkip("an agency's own quota reading", gate);

const TEST_JWT_SECRET = 'quota-summary-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('quota summary suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `quota summary suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)("an agency's own quota reading", () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;

  /** Agency A: the caller, with ceilings and a budget carrying both secrets. */
  let tenantA: { id: string; ownerId: string };
  /** Agency B: different numbers, so "its own" and "somebody's" stay apart. */
  let tenantB: { id: string; ownerId: string };
  /** NetEnroll staff, holding the capability and inside no agency. */
  let operatorId: string;

  const SUMMARY = '/api/v1/quota/summary';

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);

    const { registerQuotaRoutes } = await import('../routes/quotas.js');
    await instance.register(registerQuotaRoutes);

    await instance.ready();
    return instance;
  }

  function tokenFor(userId: string, tenantId: string | null): Record<string, string> {
    return {
      authorization: `Bearer ${app.jwt.sign({ userId, tenantId, email: `${userId}@test.local` })}`,
    };
  }

  async function cleanDatabase() {
    for (const table of [
      'platform_acting_tenants',
      'platform_admins',
      'audit_logs',
      'tenant_budgets',
      'tenant_quotas',
      'calls',
      'phone_numbers',
      'user_roles',
      'users',
      'roles',
      'tenants',
    ]) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }
  }

  async function seedAgency(
    label: string,
    ownerRoleId: string,
    ceilings: { concurrent: number; minutes: number; numbers: number; monthly: number }
  ) {
    const slug = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tenant = await prisma.tenant.create({
      data: { name: `${label} Insurance`, slug, status: 'ACTIVE' },
    });
    const owner = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `principal@${slug}.local`,
        status: 'ACTIVE',
        roles: { create: { roleId: ownerRoleId } },
      },
    });

    await prisma.tenantQuota.create({
      data: {
        tenantId: tenant.id,
        maxConcurrentCalls: ceilings.concurrent,
        maxMinutesPerDay: ceilings.minutes,
        maxPhoneNumbers: ceilings.numbers,
        enabled: true,
      },
    });

    await prisma.tenantBudget.create({
      data: {
        tenantId: tenant.id,
        monthlyBudget: ceilings.monthly,
        currentMonthSpend: 25,
        currentDaySpend: 5,
        alertEmails: [`finance@${slug}.local`],
        // Both of the things the reading must not carry back.
        alertSlackWebhook: `https://hooks.slack.com/services/${label}-secret`,
        overrideToken: `qot_${label}_secret_token`,
      },
    });

    return { id: tenant.id, ownerId: owner.id };
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

    const owner = await prisma.role.create({
      data: { name: RoleName.OWNER, description: 'OWNER role', permissions: ['admin:*'] },
    });

    tenantA = await seedAgency('Alpha', owner.id, {
      concurrent: 12,
      minutes: 480,
      numbers: 7,
      monthly: 900,
    });
    tenantB = await seedAgency('Bravo', owner.id, {
      concurrent: 99,
      minutes: 9999,
      numbers: 99,
      monthly: 99_999,
    });

    const operator = await prisma.user.create({
      data: { email: 'operator@netenroll.test', status: 'ACTIVE', tenantId: null },
    });
    operatorId = operator.id;
    await grantPlatformAdmin(operatorId, { note: 'suite fixture' });
  });

  // ════════════════════════════════════════════════════════════════════════
  // 1. Its own figures, and nobody else's
  // ════════════════════════════════════════════════════════════════════════
  it("answers with the caller's own ceilings and spend", async () => {
    const response = await app.inject({
      method: 'GET',
      url: SUMMARY,
      headers: tokenFor(tenantA.ownerId, tenantA.id),
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    // Enveloped, because `payload()` in the web client is what reads it.
    expect(Object.keys(body)).toEqual(['data']);

    const { quota, budget, status } = body.data;

    expect(quota.maxConcurrentCalls).toBe(12);
    expect(quota.maxMinutesPerDay).toBe(480);
    expect(quota.maxPhoneNumbers).toBe(7);
    expect(budget.monthlyBudget).toBe(900);

    // The figures the page renders, as numbers rather than as strings that
    // happen to print the same: `.toFixed()` on a Decimal-shaped string is how
    // a money column becomes "NaN".
    expect(typeof status.concurrentCalls.current).toBe('number');
    expect(status.concurrentCalls.limit).toBe(12);
    expect(status.budget.monthly.current).toBe(25);
    expect(status.budget.monthly.limit).toBe(900);
  });

  it("never answers with another agency's figures", async () => {
    const response = await app.inject({
      method: 'GET',
      url: SUMMARY,
      headers: tokenFor(tenantA.ownerId, tenantA.id),
    });

    const serialised = JSON.stringify(response.json());
    for (const bravo of ['99999', '9999', 'Bravo']) {
      expect(serialised, `Bravo's ${bravo} reached Alpha`).not.toContain(bravo);
    }
  });

  /**
   * The Phase 1 rule, applied to the route that replaced a page reading an id
   * out of thin air: nothing a caller can write into the request moves the
   * answer. Each of these named Bravo; each must still describe Alpha.
   */
  it.each([
    ['a query parameter', `${SUMMARY}?tenantId=`, {}],
    ['a header', SUMMARY, { 'x-tenant-id': '' }],
    ['the demo header', SUMMARY, { 'x-demo-tenant-id': '' }],
  ])('ignores %s naming another agency', async (_label, url, extra) => {
    const headers: Record<string, string> = { ...tokenFor(tenantA.ownerId, tenantA.id) };
    for (const key of Object.keys(extra)) headers[key] = tenantB.id;

    const response = await app.inject({
      method: 'GET',
      url: url.endsWith('=') ? `${url}${tenantB.id}` : url,
      headers,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.quota.maxConcurrentCalls).toBe(12);
  });

  // ════════════════════════════════════════════════════════════════════════
  // 2. Neither credential on the row comes back
  // ════════════════════════════════════════════════════════════════════════
  it('carries neither the override token nor the Slack webhook', async () => {
    const response = await app.inject({
      method: 'GET',
      url: SUMMARY,
      headers: tokenFor(tenantA.ownerId, tenantA.id),
    });

    const serialised = JSON.stringify(response.json());

    expect(serialised, 'the override token reached the agency it stops').not.toContain(
      'qot_Alpha_secret_token'
    );
    expect(serialised, 'the Slack webhook URL reached the browser').not.toContain(
      'hooks.slack.com'
    );

    // The screen still needs to be able to say whether one is set.
    expect(response.json().data.budget.alertSlackWebhookConfigured).toBe(true);
  });

  // ════════════════════════════════════════════════════════════════════════
  // 3. The cross-agency view is told to pick an agency, not to sign in again
  // ════════════════════════════════════════════════════════════════════════
  it('refuses a platform operator with no agency entered, with 409', async () => {
    const response = await app.inject({
      method: 'GET',
      url: SUMMARY,
      headers: tokenFor(operatorId, null),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('NO_ACTING_TENANT');
  });

  it('refuses an anonymous caller with 401', async () => {
    const response = await app.inject({ method: 'GET', url: SUMMARY });
    expect(response.statusCode).toBe(401);
  });

  // ════════════════════════════════════════════════════════════════════════
  // 4. No ceiling set is an answer, not a failure
  // ════════════════════════════════════════════════════════════════════════
  it('answers 200 with nulls for an agency that has no quota or budget row', async () => {
    await prisma.tenantQuota.delete({ where: { tenantId: tenantA.id } });
    await prisma.tenantBudget.delete({ where: { tenantId: tenantA.id } });

    const response = await app.inject({
      method: 'GET',
      url: SUMMARY,
      headers: tokenFor(tenantA.ownerId, tenantA.id),
    });

    expect(response.statusCode).toBe(200);

    const { quota, budget, status } = response.json().data;
    expect(quota).toBeNull();
    expect(budget).toBeNull();
    // Usage is still counted; it is the limits that are absent.
    expect(status.concurrentCalls.limit).toBeNull();
    expect(status.budget).toBeNull();
  });

  // ════════════════════════════════════════════════════════════════════════
  // 5. The write surface: still platform-only, and null now means "no ceiling"
  // ════════════════════════════════════════════════════════════════════════
  it('does not let an agency write its own ceilings through this surface', async () => {
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE'] as const) {
      const response = await app.inject({
        method,
        url: SUMMARY,
        headers: tokenFor(tenantA.ownerId, tenantA.id),
        payload: { maxConcurrentCalls: 5000 },
      });

      expect(response.statusCode, `${method} ${SUMMARY} was routed somewhere`).toBe(404);
    }

    const quota = await prisma.tenantQuota.findUnique({ where: { tenantId: tenantA.id } });
    expect(quota?.maxConcurrentCalls).toBe(12);
  });

  it('clears a ceiling when the operator sends an explicit null', async () => {
    /*
     * The form's "Unlimited" placeholder used to be a lie: the handler
     * coalesced null to the stored value, so emptying a field and saving
     * reported success and left the ceiling enforced.
     */
    const response = await app.inject({
      method: 'PATCH',
      url: `/admin/api/v1/tenants/${tenantA.id}/quota`,
      headers: tokenFor(operatorId, null),
      payload: { maxConcurrentCalls: null, enabled: true },
    });

    expect(response.statusCode).toBe(200);

    const quota = await prisma.tenantQuota.findUnique({ where: { tenantId: tenantA.id } });
    expect(quota?.maxConcurrentCalls).toBeNull();
    // An absent field is still "not part of this update".
    expect(quota?.maxMinutesPerDay).toBe(480);
  });
});
