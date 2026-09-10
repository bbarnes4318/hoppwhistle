/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { randomUUID } from 'crypto';

import Fastify, { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { grantPlatformAdmin } from '../lib/platform-admin.js';
import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { calendarDayBounds, calendarDayOf } from '../services/rating/calendar-day.js';
import { countSubmittedApplications } from '../services/rating/measurement.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * Agent-entered applications: the carrier-agnostic path into the numerator.
 *
 * ── What this suite is for ───────────────────────────────────────────────────
 *
 * The agency's price comes off its closing percentage, and the numerator of
 * that fraction was, until this feature, only ever written by the American
 * Amicable RPA. Business written with the other ten carriers on the quote panel
 * was never counted, which understated the closing percentage and RAISED the
 * price. This suite is the set of properties that has to hold for the second
 * path to be safe to price from:
 *
 *   1. AN AGENT-ENTERED APPLICATION COUNTS. Same measurement, no branch on
 *      `source`.
 *   2. A RETRIED SUBMIT IS ONE APPLICATION, and one credit. Asserted against
 *      the real unique index, not against a flag the code sets.
 *   3. ONE CALL CAN PRODUCE TWO APPLICATIONS. A couple insuring together is
 *      two, and a per-call key would silently drop the second.
 *   4. AN UNENROLLED AGENCY IS NOT METERED AND IS STILL MEASURED.
 *   5. A VOIDED APPLICATION LEAVES THE NUMERATOR AND ITS CREDIT STAYS SPENT.
 *   6. AN AGENT SEES ONLY THEIR OWN ROWS, whatever they put on the query
 *      string.
 *   7. AN AGENT CANNOT VOID. The numerator is what the agency's price is
 *      measured from.
 *
 * Database-backed, following `settlement.test.ts`: these are properties of
 * indexes, predicates and role checks, and a mock would agree with the code by
 * construction.
 */

const gate = databaseGate();
announceSkip('Agent-entered applications', gate);

const TEST_JWT_SECRET = 'agent-entry-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('Agent-entry suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `agent-entry suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('Agent-entered applications', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;

  let tenantId: string;
  let ownerId: string;
  let agentId: string;
  let otherAgentId: string;
  let operatorId: string;

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

  function tokenFor(userId: string, tenant: string | null): Record<string, string> {
    return {
      authorization: `Bearer ${app.jwt.sign({ userId, tenantId: tenant, email: `${userId}@test.local` })}`,
    };
  }

  async function cleanDatabase() {
    for (const table of [
      'application_credit_ledger',
      'daily_settlements',
      'agency_billing_profiles',
      'agency_rating_states',
      'insurance_carrier_applications',
      'calls',
      'platform_acting_tenants',
      'platform_admins',
      'audit_logs',
      'user_roles',
      'users',
      'roles',
      'tenants',
    ]) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }
  }

  /** The body the agent's client posts. One `clientRequestId` per form instance. */
  function applicationBody(overrides: Record<string, unknown> = {}) {
    return {
      clientRequestId: randomUUID(),
      carrier: 'Mutual of Omaha',
      planType: 'LEVEL',
      faceAmount: 10000,
      modalPremium: 52.4,
      paymentMode: 'MONTHLY',
      firstName: 'Dolores',
      lastName: 'Reyes',
      ...overrides,
    };
  }

  /** Everything submitted for a tenant today, by the Phase 2 definition. */
  async function countToday(tenant: string): Promise<number> {
    const day = calendarDayOf(new Date());
    return countSubmittedApplications(
      { calls: prisma.call, applications: prisma.insuranceCarrierApplication },
      tenant,
      calendarDayBounds(day)
    );
  }

  /** Turn on billing for the agency, which is what makes it metered at all. */
  async function enrol(tenant: string) {
    return prisma.agencyBillingProfile.upsert({
      where: { tenantId: tenant },
      create: {
        tenantId: tenant,
        dailyBlockApplications: 45,
        maxDailyDebit: 8978,
        ceilingPctBelowThreshold: 50,
        stripeCustomerId: 'cus_fake',
        achPaymentMethodId: 'pm_fake',
        achMandateStatus: 'ACTIVE',
        achMandateVerifiedAt: new Date(),
        billingEnrolledAt: new Date(),
        chargesEnabled: true,
      },
      update: { billingEnrolledAt: new Date() },
    });
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
      prisma.role.create({
        data: { name: 'AGENT', description: 'AGENT role', permissions: [] },
      }),
    ]);

    const tenant = await prisma.tenant.create({
      data: {
        name: 'Ridgeline Insurance',
        slug: `ridgeline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        status: 'ACTIVE',
      },
    });
    tenantId = tenant.id;

    const [owner, agent, otherAgent] = await Promise.all([
      prisma.user.create({
        data: {
          tenantId,
          email: `principal-${Math.random().toString(36).slice(2, 8)}@ridgeline.local`,
          status: 'ACTIVE',
          firstName: 'Pat',
          lastName: 'Ridgeline',
          roles: { create: { roleId: ownerRole.id } },
        },
      }),
      prisma.user.create({
        data: {
          tenantId,
          email: `agent-${Math.random().toString(36).slice(2, 8)}@ridgeline.local`,
          status: 'ACTIVE',
          firstName: 'Marisol',
          lastName: 'Vance',
          roles: { create: { roleId: agentRole.id } },
        },
      }),
      prisma.user.create({
        data: {
          tenantId,
          email: `agent2-${Math.random().toString(36).slice(2, 8)}@ridgeline.local`,
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

    const operator = await prisma.user.create({
      data: {
        email: `operator-${Math.random().toString(36).slice(2, 8)}@netenroll.test`,
        status: 'ACTIVE',
        tenantId: null,
      },
    });
    operatorId = operator.id;
    await grantPlatformAdmin(operatorId, { note: 'agent-entry suite fixture' });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 1. It counts
  //
  // The whole point. An application an agent logged on a carrier the RPA does
  // not drive has to reach the same numerator, or the agency keeps being
  // priced as though it never wrote the business.
  // ══════════════════════════════════════════════════════════════════════════
  it('counts an agent-entered application in the closing percentage numerator', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/applications',
      headers: tokenFor(agentId, tenantId),
      payload: applicationBody({ carrier: 'Aflac', modalPremium: 60, paymentMode: 'QUARTERLY' }),
    });

    expect(response.statusCode).toBe(201);
    const created = response.json().data;
    expect(created.source).toBe('AGENT_ENTRY');
    expect(created.status).toBe('SUBMITTED');
    expect(created.submittedAt).not.toBeNull();
    // Attribution: the per-agent breakdown reads this column.
    expect(created.createdById).toBe(agentId);

    // Annualised on write, and `monthlyPremium` written too so every existing
    // reader of that column keeps working.
    expect(Number(created.annualizedPremium)).toBe(240);
    expect(Number(created.monthlyPremium)).toBe(20);

    // No regulated data was collected on this path.
    expect(created.ssn).toBeNull();
    expect(created.routingNumber).toBeNull();
    expect(created.accountNumber).toBeNull();

    expect(await countToday(tenantId)).toBe(1);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2. A retried submit is one application
  //
  // The agent's client generates one key per form instance and reuses it on
  // every retry. The guarantee is the unique index, so the test exercises the
  // index: two real posts with the same key.
  // ══════════════════════════════════════════════════════════════════════════
  it('records one application and one credit for two posts with the same clientRequestId', async () => {
    await enrol(tenantId);

    const body = applicationBody();

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/applications',
      headers: tokenFor(agentId, tenantId),
      payload: body,
    });
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/applications',
      headers: tokenFor(agentId, tenantId),
      payload: body,
    });

    expect(first.statusCode).toBe(201);
    // The retry is answered with the row that landed, not an error the agent
    // reads as "it did not save".
    expect(second.statusCode).toBe(201);
    expect(second.json().data.id).toBe(first.json().data.id);

    expect(await prisma.insuranceCarrierApplication.count({ where: { tenantId } })).toBe(1);
    expect(await countToday(tenantId)).toBe(1);

    // One credit, however many times the submit was retried. The unique index
    // on `application_credit_ledger("applicationId")` is what makes that true.
    expect(await prisma.applicationCreditLedgerEntry.count({ where: { tenantId } })).toBe(1);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 3. One call, two applications
  //
  // A couple insuring together. Keying idempotency on the call rather than on
  // the form instance would silently drop the second one, and the agency would
  // be measured on half the business it wrote.
  // ══════════════════════════════════════════════════════════════════════════
  it('counts two applications written on one call', async () => {
    const call = await prisma.call.create({
      data: {
        tenantId,
        callSid: `sid-${randomUUID()}`,
        toNumber: '+15550000000',
        status: 'COMPLETED',
        direction: 'INBOUND',
        answeredAt: new Date(),
        answeredByUserId: agentId,
        connectedDuration: 600,
        blocked: false,
      },
    });

    const husband = await app.inject({
      method: 'POST',
      url: '/api/v1/applications',
      headers: tokenFor(agentId, tenantId),
      payload: applicationBody({ callId: call.id, firstName: 'Ray', lastName: 'Whitlock' }),
    });
    const wife = await app.inject({
      method: 'POST',
      url: '/api/v1/applications',
      headers: tokenFor(agentId, tenantId),
      payload: applicationBody({ callId: call.id, firstName: 'Ada', lastName: 'Whitlock' }),
    });

    expect(husband.statusCode).toBe(201);
    expect(wife.statusCode).toBe(201);
    expect(wife.json().data.id).not.toBe(husband.json().data.id);

    expect(await countToday(tenantId)).toBe(2);

    // A call from another agency is refused rather than attributed across the
    // tenant boundary.
    const other = await prisma.tenant.create({
      data: { name: 'Fairhaven', slug: `fairhaven-${randomUUID()}`, status: 'ACTIVE' },
    });
    const foreignCall = await prisma.call.create({
      data: {
        tenantId: other.id,
        callSid: `sid-${randomUUID()}`,
        toNumber: '+15550000001',
        status: 'COMPLETED',
        direction: 'INBOUND',
        blocked: false,
      },
    });
    const refused = await app.inject({
      method: 'POST',
      url: '/api/v1/applications',
      headers: tokenFor(agentId, tenantId),
      payload: applicationBody({ callId: foreignCall.id }),
    });
    expect(refused.statusCode).toBe(404);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 4. An unenrolled agency is measured, not metered
  //
  // Billing is opt-in and off by default. An agency that has not been enrolled
  // writes no ledger row at all -- not a consumption, not an overrun -- and its
  // applications still count, because the closing percentage is a measurement
  // rather than a billing artefact.
  // ══════════════════════════════════════════════════════════════════════════
  it('writes no ledger row for an unenrolled agency and still counts the application', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/applications',
      headers: tokenFor(agentId, tenantId),
      payload: applicationBody(),
    });
    expect(response.statusCode).toBe(201);

    expect(await countToday(tenantId)).toBe(1);
    expect(await prisma.applicationCreditLedgerEntry.count({ where: { tenantId } })).toBe(0);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 5. Voiding
  //
  // Out of the numerator, and the credit stays spent. There is no reversal
  // entry type by design and the ledger refuses UPDATE and DELETE by trigger,
  // so this asserts the ledger row is byte-for-byte what it was.
  // ══════════════════════════════════════════════════════════════════════════
  it('excludes a voided application from the numerator and leaves its ledger row alone', async () => {
    await enrol(tenantId);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/applications',
      headers: tokenFor(agentId, tenantId),
      payload: applicationBody(),
    });
    const applicationId = created.json().data.id;

    expect(await countToday(tenantId)).toBe(1);

    const ledgerBefore = await prisma.applicationCreditLedgerEntry.findFirst({
      where: { applicationId },
    });
    expect(ledgerBefore).not.toBeNull();

    const voided = await app.inject({
      method: 'POST',
      url: `/api/v1/applications/${applicationId}/void`,
      headers: tokenFor(operatorId, null),
      payload: { reason: 'Duplicate of the paper application on the same policy.' },
    });
    expect(voided.statusCode).toBe(200);
    expect(voided.json().data.voidedAt).not.toBeNull();
    expect(voided.json().data.voidedById).toBe(operatorId);

    // Out of the numerator.
    expect(await countToday(tenantId)).toBe(0);

    // The credit is not refunded. Voiding corrects what the agency is measured
    // on; it is not a reversal path, and there is no entry type for one.
    const ledgerAfter = await prisma.applicationCreditLedgerEntry.findFirst({
      where: { applicationId },
    });
    expect(ledgerAfter).toEqual(ledgerBefore);
    expect(await prisma.applicationCreditLedgerEntry.count({ where: { tenantId } })).toBe(1);

    // Audited, so a disputed measurement can be traced to who changed it.
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'application.voided', entityId: applicationId },
    });
    expect(audit).not.toBeNull();
    expect(audit?.userId).toBe(operatorId);

    // Voiding twice is a conflict, not a second void with a second reason.
    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/applications/${applicationId}/void`,
      headers: tokenFor(operatorId, null),
      payload: { reason: 'Trying the same thing again.' },
    });
    expect(again.statusCode).toBe(409);

    // The row stays visible to the agency, struck through rather than gone.
    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/applications',
      headers: tokenFor(ownerId, tenantId),
    });
    const rows = listed.json().data.applications;
    expect(rows).toHaveLength(1);
    expect(rows[0].voidedAt).not.toBeNull();
    expect(rows[0].voidReason).toMatch(/Duplicate/);

    // And it is out of the totals, which is what makes them reconcile.
    const summary = await app.inject({
      method: 'GET',
      url: '/api/v1/applications/summary',
      headers: tokenFor(ownerId, tenantId),
    });
    expect(summary.json().data.count).toBe(0);
    expect(summary.json().data.averageAnnualizedPremium).toBeNull();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 6. An agent sees their own rows
  //
  // The narrowing is an overwrite, not a check, so there is no value an agent
  // can put on the query string that widens what comes back.
  // ══════════════════════════════════════════════════════════════════════════
  it('serves an agent only their own rows, whatever agentId they ask for', async () => {
    const mine = await app.inject({
      method: 'POST',
      url: '/api/v1/applications',
      headers: tokenFor(agentId, tenantId),
      payload: applicationBody({ carrier: 'Gerber', lastName: 'Halloran' }),
    });
    const theirs = await app.inject({
      method: 'POST',
      url: '/api/v1/applications',
      headers: tokenFor(otherAgentId, tenantId),
      payload: applicationBody({ carrier: 'GTL', lastName: 'Ibarra' }),
    });
    expect(mine.statusCode).toBe(201);
    expect(theirs.statusCode).toBe(201);

    const asked = await app.inject({
      method: 'GET',
      url: `/api/v1/applications?agentId=${otherAgentId}`,
      headers: tokenFor(agentId, tenantId),
    });
    expect(asked.statusCode).toBe(200);

    const rows = asked.json().data.applications;
    expect(rows).toHaveLength(1);
    expect(rows[0].agentId).toBe(agentId);
    expect(rows[0].carrier).toBe('Gerber');

    // The summary is narrowed the same way, or an agent could read the
    // agency's production off the totals instead of off the rows.
    const summary = await app.inject({
      method: 'GET',
      url: '/api/v1/applications/summary',
      headers: tokenFor(agentId, tenantId),
    });
    expect(summary.json().data.count).toBe(1);

    // The principal sees both.
    const owner = await app.inject({
      method: 'GET',
      url: '/api/v1/applications',
      headers: tokenFor(ownerId, tenantId),
    });
    expect(owner.json().data.applications).toHaveLength(2);

    // And only the applicant's last initial leaves the server, on either
    // reading.
    expect(rows[0].applicant).toBe('Dolores H.');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 7. An agent cannot void
  //
  // The numerator is what the agency's price is measured from. An agency that
  // could remove rows from it could set its own rate.
  // ══════════════════════════════════════════════════════════════════════════
  it('refuses an agent who tries to void an application', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/applications',
      headers: tokenFor(agentId, tenantId),
      payload: applicationBody(),
    });
    const applicationId = created.json().data.id;

    for (const userId of [agentId, ownerId]) {
      const refused = await app.inject({
        method: 'POST',
        url: `/api/v1/applications/${applicationId}/void`,
        headers: tokenFor(userId, tenantId),
        payload: { reason: 'I would rather this one did not count.' },
      });
      expect(refused.statusCode).toBe(403);
    }

    // Still counted, and still not voided.
    expect(await countToday(tenantId)).toBe(1);
    const row = await prisma.insuranceCarrierApplication.findUnique({
      where: { id: applicationId },
    });
    expect(row?.voidedAt).toBeNull();
  });
});
