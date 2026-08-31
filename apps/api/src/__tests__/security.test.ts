/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- assertions run over parsed JSON responses and vi.fn mock call records, which are dynamically typed */
import { RoleName } from '@prisma/client';
import { hash } from 'bcryptjs';
import Fastify, { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * Privilege escalation, tested against the endpoints that had it.
 *
 * ── What this replaces ───────────────────────────────────────────────────────
 *
 * The previous version of this file was named for exactly the holes that were
 * later found in production code, and tested none of them. Its cases called
 * `prisma.user.create(...)` directly and asserted `.rejects.toThrow()` -- that
 * is, they expected the ORM to enforce authorization. Prisma has no such
 * concept, so two of them had been failing continuously and unnoticed, because
 * `pnpm test` is advisory in CI. Three others asserted nothing at all; one read
 * `expect(auditLogs.length).toBeGreaterThanOrEqual(0)`, which is true of every
 * array, and two carried the comment "in a real test, we would make an HTTP
 * request".
 *
 * A suite like that is worse than an empty file. An empty file does not appear
 * in a review as evidence that this class of bug is covered.
 *
 * ── What it does now ─────────────────────────────────────────────────────────
 *
 * Every case drives a real Fastify instance over HTTP with `app.inject()`,
 * registering the actual production plugins -- `registerApiV1Auth` (the hook
 * guarding every /api/v1 route), `registerUserRoutes` and
 * `registerAutomationRoutes` -- against a real database. Nothing here
 * reimplements the thing it is testing.
 *
 * The four cases below are the four holes that were live in this codebase:
 *
 *   1. X-Demo-Tenant-Id was accepted as ADMIN and OWNER with no credential at
 *      all, on the whole v1 API.
 *   2. The automation routes carried a second, independent copy of that
 *      fallback, on aliases registered outside the hook -- so gating the hook
 *      left them serving. Reaching them meant driving a carrier RPA submission
 *      carrying somebody's SSN and bank details.
 *   3. POST /api/v1/users/invite granted whatever role the body asked for,
 *      to any authenticated caller.
 *   4. PATCH /api/v1/users/:userId let any authenticated caller approve a
 *      PENDING signup, suspend an administrator, or attach itself to another
 *      tenant's buyer.
 *
 * Each is asserted from the perspective of an attacker who has, at most, the
 * lowest-privilege account the platform will hand out.
 */

const mockRunAutomation = vi.fn();
vi.mock('../services/carrier-rpa/american-amicable.js', () => ({
  runAmericanAmicableAutomation: (...args: unknown[]) => mockRunAutomation(...args),
}));

const gate = databaseGate();
announceSkip('Security: privilege escalation', gate);

const TEST_JWT_SECRET = 'security-suite-secret-not-used-anywhere-else';
const DEMO_HEADER = { 'x-demo-tenant-id': 'some-tenant-id' };

/**
 * A signup payload complete enough to reach the RPA if authorization let it
 * through. The point of the values is that they are the kind of thing that must
 * never be submitted on an anonymous request.
 */
const CARRIER_PAYLOAD = {
  firstName: 'John',
  lastName: 'Doe',
  dob: '1960-01-15',
  gender: 'M',
  tobacco: 'no',
  state: 'IL',
  address: '123 Main St',
  city: 'Chicago',
  zip: '60601',
  phone: '(312) 555-0100',
  weight: 180,
  height: '5\'9"',
  selectedCoverage: 15000,
  selectedPlanType: 'Level',
  beneficiaryName: 'Jane Doe',
  beneficiaryRelation: 'Spouse',
  bankName: 'Chase',
  bankCityState: 'Chicago, IL',
  routingNumber: '071000013',
  accountNumber: '123456789',
  ssn: '123-45-6789',
  draftDay: '15',
};

/**
 * The suite must not be able to pass by not running.
 *
 * It is in the blocking CI job, and a skipped suite in a blocking job is a
 * green tick that means nothing -- the same failure mode as the file it
 * replaces. So in CI a missing test database is a failure, not a skip.
 */
describe('Security suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `security suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('Security: privilege escalation', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let tenantId: string;
  let roleIds: Record<string, string>;
  let userIds: Record<string, string>;

  /**
   * A server carrying the real auth hook and the real route plugins.
   *
   * Built per test rather than once, because `registerApiV1Auth` reads the
   * demo-tenant switch when it registers. Building per test is what lets a case
   * assert the switch in both positions.
   */
  async function buildApp(): Promise<FastifyInstance> {
    const app = Fastify();
    await app.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(app);

    const { registerUserRoutes } = await import('../routes/index.js');
    const { registerAutomationRoutes } = await import('../routes/automation.js');
    await app.register(registerUserRoutes);
    await app.register(registerAutomationRoutes);

    await app.ready();
    return app;
  }

  /** A real signed token for one of the seeded users, as login would issue. */
  function tokenFor(app: FastifyInstance, who: string): string {
    return app.jwt.sign({ tenantId, userId: userIds[who], email: `${who}@test.local` });
  }

  function authed(app: FastifyInstance, who: string): Record<string, string> {
    return { authorization: `Bearer ${tokenFor(app, who)}` };
  }

  async function cleanDatabase() {
    for (const table of ['audit_logs', 'api_keys', 'user_roles', 'users', 'roles', 'tenants']) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }
  }

  beforeEach(async () => {
    delete process.env.ALLOW_DEMO_TENANT_AUTH;
    vi.clearAllMocks();
    mockRunAutomation.mockResolvedValue({ success: true, applicationNumber: 'M001234567' });

    prisma = getPrismaClient();
    await cleanDatabase();

    const tenant = await prisma.tenant.create({
      data: { name: 'Test Tenant', slug: `test-${Date.now()}`, status: 'ACTIVE' },
    });
    tenantId = tenant.id;

    roleIds = {};
    for (const name of [
      RoleName.OWNER,
      RoleName.ADMIN,
      RoleName.ANALYST,
      RoleName.AGENT,
      RoleName.READONLY,
      RoleName.BUYER,
    ]) {
      const role = await prisma.role.create({
        data: { name, description: `${name} role`, permissions: [] },
      });
      roleIds[name] = role.id;
    }

    const passwordHash = await hash('password123', 10);
    userIds = {};
    const people: Array<[string, RoleName | null, 'ACTIVE' | 'PENDING']> = [
      ['owner', RoleName.OWNER, 'ACTIVE'],
      ['admin', RoleName.ADMIN, 'ACTIVE'],
      ['agent', RoleName.AGENT, 'ACTIVE'],
      ['readonly', RoleName.READONLY, 'ACTIVE'],
      // What a self-serve signup looks like after registering: least privilege,
      // and waiting on somebody.
      ['applicant', RoleName.READONLY, 'PENDING'],
    ];

    for (const [who, role, status] of people) {
      const user = await prisma.user.create({
        data: {
          tenantId,
          email: `${who}@test.local`,
          passwordHash,
          status,
          ...(role ? { roles: { create: { roleId: roleIds[role] } } } : {}),
        },
      });
      userIds[who] = user.id;
    }
  });

  afterEach(() => {
    delete process.env.ALLOW_DEMO_TENANT_AUTH;
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 1. The demo-tenant header was a credential-free ADMIN grant on all of v1
  // ══════════════════════════════════════════════════════════════════════════
  describe('X-Demo-Tenant-Id does not authenticate anyone', () => {
    it('refuses a request carrying only the demo header', async () => {
      const app = await buildApp();
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/users',
        headers: { 'x-demo-tenant-id': tenantId },
      });

      expect(response.statusCode).toBe(401);
      await app.close();
    });

    it('refuses the same thing passed as a query parameter', async () => {
      const app = await buildApp();
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/users?demoTenantId=${tenantId}`,
      });

      expect(response.statusCode).toBe(401);
      await app.close();
    });

    it('ignores the header on an authenticated request naming another tenant', async () => {
      // The handlers read `demoTenantId || user.tenantId` in ~200 places, so a
      // caller who authenticated legitimately as one tenant must not be able to
      // name a different one and be served its data.
      const other = await prisma.tenant.create({
        data: { name: 'Other Tenant', slug: `other-${Date.now()}`, status: 'ACTIVE' },
      });
      await prisma.user.create({
        data: {
          tenantId: other.id,
          email: 'stranger@other.local',
          passwordHash: await hash('password123', 10),
          status: 'ACTIVE',
        },
      });

      const app = await buildApp();
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/users',
        headers: { ...authed(app, 'admin'), 'x-demo-tenant-id': other.id },
      });

      expect(response.statusCode).toBe(200);
      const emails = JSON.parse(response.body).data.map((u: { email: string }) => u.email);
      expect(emails).not.toContain('stranger@other.local');
      expect(emails).toContain('admin@test.local');
      await app.close();
    });

    it('accepts the header only where an environment has opted in', async () => {
      process.env.ALLOW_DEMO_TENANT_AUTH = 'true';
      const app = await buildApp();
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/users',
        headers: { 'x-demo-tenant-id': tenantId },
      });

      expect(response.statusCode).toBe(200);
      await app.close();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2. The automation aliases had their own copy of that fallback
  // ══════════════════════════════════════════════════════════════════════════
  describe('the automation routes do not authenticate on the demo header either', () => {
    it('will not start a carrier RPA run for a caller carrying only the header', async () => {
      const app = await buildApp();
      const response = await app.inject({
        method: 'POST',
        url: '/api/automation/run-carrier-app',
        headers: DEMO_HEADER,
        payload: CARRIER_PAYLOAD,
      });

      expect(response.statusCode).toBe(401);
      // The assertion that matters: no application carrying an SSN and bank
      // details was submitted to a third party on an anonymous request.
      expect(mockRunAutomation).not.toHaveBeenCalled();
      await app.close();
    });

    it('will not return job results for a caller carrying only the header', async () => {
      const app = await buildApp();
      for (const url of [
        '/api/automation/result/job_whatever',
        '/api/automation/status/job_whatever',
        '/api/automation/stream/job_whatever',
      ]) {
        const response = await app.inject({ method: 'GET', url, headers: DEMO_HEADER });
        expect(response.statusCode, `${url} should refuse an unauthenticated caller`).toBe(401);
      }
      await app.close();
    });

    it('refuses the canonical v1 automation route the same way', async () => {
      const app = await buildApp();
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/automation/jobs/job_whatever',
        headers: DEMO_HEADER,
      });

      expect(response.statusCode).toBe(401);
      await app.close();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 3. Invite granted whatever role was asked for, to whoever asked
  // ══════════════════════════════════════════════════════════════════════════
  describe('POST /api/v1/users/invite does not mint privilege', () => {
    it.each([
      ['readonly', 'a self-serve signup holding the lowest role'],
      ['agent', 'an agent'],
    ])('refuses %s (%s) inviting an ADMIN', async who => {
      const app = await buildApp();
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/users/invite',
        headers: authed(app, who),
        payload: { email: `escalated-${who}@test.local`, role: 'ADMIN' },
      });

      expect(response.statusCode).toBe(403);

      const created = await prisma.user.findUnique({
        where: { email: `escalated-${who}@test.local` },
      });
      expect(created, 'no account should have been created').toBeNull();
      await app.close();
    });

    it('refuses an ADMIN granting OWNER', async () => {
      const app = await buildApp();
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/users/invite',
        headers: authed(app, 'admin'),
        payload: { email: 'new-owner@test.local', role: 'OWNER' },
      });

      expect(response.statusCode).toBe(403);
      expect(await prisma.user.findUnique({ where: { email: 'new-owner@test.local' } })).toBeNull();
      await app.close();
    });

    it('lets an OWNER grant OWNER', async () => {
      const app = await buildApp();
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/users/invite',
        headers: authed(app, 'owner'),
        payload: { email: 'second-owner@test.local', role: 'OWNER' },
      });

      expect(response.statusCode).toBe(201);
      await app.close();
    });

    it('still lets an ADMIN invite an ordinary user', async () => {
      // The gate has to keep the endpoint usable: with signups held at PENDING,
      // invitation is how people legitimately get accounts.
      const app = await buildApp();
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/users/invite',
        headers: authed(app, 'admin'),
        payload: { email: 'analyst@test.local', firstName: 'An', role: 'ANALYST' },
      });

      expect(response.statusCode).toBe(201);
      const created = await prisma.user.findUnique({
        where: { email: 'analyst@test.local' },
        include: { roles: { include: { role: true } } },
      });
      expect(created?.roles.map(r => r.role.name)).toEqual([RoleName.ANALYST]);
      await app.close();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 4. Update let anyone approve themselves, suspend an admin, or re-scope
  // ══════════════════════════════════════════════════════════════════════════
  describe('PATCH /api/v1/users/:userId is administrative', () => {
    it('refuses a READONLY account approving a pending signup', async () => {
      // This is the whole of the approval gate that self-serve registration
      // depends on: if any account can flip PENDING to ACTIVE, requiring
      // approval means nothing.
      const app = await buildApp();
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/users/${userIds.applicant}`,
        headers: authed(app, 'readonly'),
        payload: { status: 'ACTIVE' },
      });

      expect(response.statusCode).toBe(403);
      const applicant = await prisma.user.findUnique({ where: { id: userIds.applicant } });
      expect(applicant?.status).toBe('PENDING');
      await app.close();
    });

    it('refuses a READONLY account suspending an administrator', async () => {
      // The account that would notice an incident is the one worth disabling.
      const app = await buildApp();
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/users/${userIds.admin}`,
        headers: authed(app, 'readonly'),
        payload: { status: 'SUSPENDED' },
      });

      expect(response.statusCode).toBe(403);
      const admin = await prisma.user.findUnique({ where: { id: userIds.admin } });
      expect(admin?.status).toBe('ACTIVE');
      await app.close();
    });

    it('refuses a READONLY account attaching itself to a buyer', async () => {
      const buyer = await prisma.buyer.create({
        data: { tenantId, name: 'Someone Elses Buyer', code: `B-${Date.now()}`, status: 'ACTIVE' },
      });

      const app = await buildApp();
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/users/${userIds.readonly}`,
        headers: authed(app, 'readonly'),
        payload: { buyerId: buyer.id },
      });

      expect(response.statusCode).toBe(403);
      const self = await prisma.user.findUnique({ where: { id: userIds.readonly } });
      expect(self?.buyerId, 'must not have gained that buyer scope').toBeNull();
      await app.close();
    });

    it('lets an administrator approve a pending signup', async () => {
      const app = await buildApp();
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/users/${userIds.applicant}`,
        headers: authed(app, 'admin'),
        payload: { status: 'ACTIVE' },
      });

      expect(response.statusCode).toBe(200);
      const applicant = await prisma.user.findUnique({ where: { id: userIds.applicant } });
      expect(applicant?.status).toBe('ACTIVE');
      await app.close();
    });
  });
});
