/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { RoleName } from '@prisma/client';
import { hash } from 'bcryptjs';
import Fastify, { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * Two agencies, one host, one database. Neither may see the other.
 *
 * ── What this suite is for ──────────────────────────────────────────────────
 *
 * NetEnroll sells inbound final-expense calls to licensed agencies, and two of
 * them go live on this application at the same time, on the same hostname, with
 * their own agents, their own calls, their own submitted applications and their
 * own settlement. The boundary between them is not a feature of the product; it
 * IS the product. If agency A can see agency B's callers or B's numbers, there
 * is nothing left to sell.
 *
 * Before the change this suite accompanies, that boundary leaked in several
 * independent ways, all of which are asserted against here:
 *
 *   - `auth.ts getDefaultTenantId()` picked a tenant from the `Host`, `Referer`
 *     and `Origin` headers and, failing those, from row order -- ending at "the
 *     oldest ACTIVE tenant in the table". Registration therefore put strangers
 *     inside whichever agency was created first.
 *   - Handlers read `X-Demo-Tenant-Id || user.tenantId` in about sixty places,
 *     so an authenticated caller could name a tenant that was not theirs.
 *   - Several routes fell back to the literal string `'default'`, and several
 *     more addressed rows by primary key with no tenant filter at all.
 *
 * ── How it tests ─────────────────────────────────────────────────────────────
 *
 * Every case drives a real Fastify instance over HTTP with `app.inject()`,
 * registering the production auth hook and the production route plugins against
 * a real database. Nothing here reimplements the thing it is testing.
 *
 * The shape of every assertion is the same, and it is deliberately the strict
 * one: seed the SAME kind of row in both agencies, ask as agency A, and require
 * that the response contains agency A's row and ZERO of agency B's. A weaker
 * "does not 500" or "returns something" would have passed against every bug
 * listed above.
 */

const gate = databaseGate();
announceSkip('Tenant isolation: two agencies', gate);

const TEST_JWT_SECRET = 'tenant-isolation-suite-secret-not-used-anywhere-else';

// `middleware/session.ts` reads JWT_SECRET through `secrets.getRequired` to
// sign session cookies and derive CSRF tokens. Set before the routes import it.
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

/** Everything seeded for one agency, so a case can name either side. */
interface Agency {
  tenantId: string;
  slug: string;
  ownerId: string;
  ownerEmail: string;
  publisherId: string;
  buyerId: string;
  campaignId: string;
  phoneNumberId: string;
  phoneNumber: string;
  callId: string;
  recordingId: string;
  insuranceLeadId: string;
  applicationId: string;
  billingAccountId: string;
  rateCardId: string;
}

describe('Tenant isolation suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `tenant isolation suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('Tenant isolation: two agencies', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;
  let a: Agency;
  let b: Agency;

  /**
   * A server carrying the real auth hook and the real route plugins.
   *
   * The set registered here is every surface the brief names -- calls,
   * recordings, leads, insurance applications, campaigns, phone numbers,
   * reports and billing -- plus the auth routes, because registration is where
   * the tenant used to be guessed from the request.
   */
  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    // The cookie plugin, because a successful registration now issues a
    // session as well as a token -- an activation grant IS the approval, so
    // there is no second manual step to wait on.
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);

    const {
      registerCallRoutes,
      registerCampaignRoutes,
      registerNumberRoutes,
      registerPublisherRoutes,
      registerReportingRoutes,
      registerUserRoutes,
    } = await import('../routes/index.js');
    const { registerRecordingManagementRoutes } = await import('../routes/recordings.js');
    const { registerInsuranceLeadRoutes } = await import('../routes/insurance-leads.js');
    const { registerBuyerBillingRoutes } = await import('../routes/buyer-billing.js');
    const { registerAdminBillingRoutes } = await import('../routes/admin-billing.js');
    const { registerAuthRoutes } = await import('../routes/auth.js');

    await instance.register(registerCallRoutes);
    await instance.register(registerCampaignRoutes);
    await instance.register(registerNumberRoutes);
    await instance.register(registerPublisherRoutes);
    await instance.register(registerReportingRoutes);
    await instance.register(registerUserRoutes);
    await instance.register(registerRecordingManagementRoutes);
    await instance.register(registerInsuranceLeadRoutes);
    await instance.register(registerBuyerBillingRoutes);
    await instance.register(registerAdminBillingRoutes);
    await instance.register(registerAuthRoutes);

    await instance.ready();
    return instance;
  }

  /** A real signed token for an agency's owner, as login would issue. */
  function asOwner(agency: Agency): Record<string, string> {
    const token = app.jwt.sign({
      tenantId: agency.tenantId,
      userId: agency.ownerId,
      email: agency.ownerEmail,
    });
    return { authorization: `Bearer ${token}` };
  }

  async function cleanDatabase() {
    for (const table of [
      'audit_logs',
      'tenant_activation_grants',
      'api_keys',
      'user_roles',
      'users',
      'roles',
      'tenants',
    ]) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }
  }

  /**
   * One complete agency: a paying customer with staff, numbers, traffic,
   * submitted applications and a settlement account.
   *
   * Both agencies get the same shape so that "A's list contains only A's row"
   * is a claim about scoping rather than about one of them being empty.
   */
  async function seedAgency(label: string, ownerRoleId: string): Promise<Agency> {
    const slug = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const tenant = await prisma.tenant.create({
      data: { name: `${label} Insurance`, slug, status: 'ACTIVE' },
    });

    const owner = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `principal@${slug}.local`,
        passwordHash: await hash('password123', 10),
        status: 'ACTIVE',
        roles: { create: { roleId: ownerRoleId } },
      },
    });

    const publisher = await prisma.publisher.create({
      data: { tenantId: tenant.id, name: `${label} Source`, code: `${label}PUB01` },
    });

    const buyer = await prisma.buyer.create({
      data: {
        tenantId: tenant.id,
        name: `${label} Buyer`,
        code: `${label}BUY01`,
        publisherId: publisher.id,
      },
    });

    const campaign = await prisma.campaign.create({
      data: { tenantId: tenant.id, publisherId: publisher.id, name: `${label} Final Expense` },
    });

    const phoneNumber = await prisma.phoneNumber.create({
      data: { tenantId: tenant.id, number: `+1555${label.length}${Date.now() % 1000000}` },
    });

    const call = await prisma.call.create({
      data: {
        tenantId: tenant.id,
        callSid: `sid-${slug}`,
        toNumber: '+15550000000',
        status: 'COMPLETED',
        direction: 'INBOUND',
        campaignId: campaign.id,
        publisherId: publisher.id,
        buyerId: buyer.id,
      },
    });

    const recording = await prisma.recording.create({
      data: { callId: call.id, url: `https://example.invalid/${slug}.wav`, status: 'COMPLETED' },
    });

    const insuranceLead = await prisma.insuranceLead.create({
      data: { tenantId: tenant.id, vertical: 'FE', phone: `555000${label.length}111` },
    });

    const application = await prisma.insuranceCarrierApplication.create({
      data: { tenantId: tenant.id, firstName: label, lastName: 'Applicant' },
    });

    const billingAccount = await prisma.billingAccount.create({
      data: { tenantId: tenant.id, name: `${label} Settlement` },
    });

    const rateCard = await prisma.rateCard.create({
      data: {
        billingAccountId: billingAccount.id,
        name: `${label} Daily Rate`,
        effectiveFrom: new Date(),
        rates: { cpa: { amount: 134 } },
      },
    });

    return {
      tenantId: tenant.id,
      slug,
      ownerId: owner.id,
      ownerEmail: owner.email,
      publisherId: publisher.id,
      buyerId: buyer.id,
      campaignId: campaign.id,
      phoneNumberId: phoneNumber.id,
      phoneNumber: phoneNumber.number,
      callId: call.id,
      recordingId: recording.id,
      insuranceLeadId: insuranceLead.id,
      applicationId: application.id,
      billingAccountId: billingAccount.id,
      rateCardId: rateCard.id,
    };
  }

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    delete process.env.ALLOW_DEMO_TENANT_AUTH;

    prisma = getPrismaClient();
    await cleanDatabase();

    const roleIds: Record<string, string> = {};
    for (const name of [RoleName.OWNER, RoleName.ADMIN, RoleName.AGENT, RoleName.READONLY]) {
      const role = await prisma.role.create({
        data: { name, description: `${name} role`, permissions: [] },
      });
      roleIds[name] = role.id;
    }

    a = await seedAgency('Alpha', roleIds[RoleName.OWNER]);
    b = await seedAgency('Bravo', roleIds[RoleName.OWNER]);
  });

  /**
   * Pull every id out of a response body, whatever shape it came in.
   *
   * The list endpoints in this codebase disagree about their envelope --
   * `{ data }`, `{ calls }`, `{ numbers }`, `{ leads }`, a bare array -- and a
   * case that guessed wrong would read an empty list and pass. Walking the body
   * for id-like strings makes the assertion independent of the envelope: if the
   * other agency's row is anywhere in the response, this finds it.
   */
  function idsIn(body: unknown): string[] {
    const found: string[] = [];
    const walk = (node: unknown) => {
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (node && typeof node === 'object') {
        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
          if (typeof value === 'string' && (key === 'id' || key.endsWith('Id'))) {
            found.push(value);
          } else {
            walk(value);
          }
        }
      }
    };
    walk(body);
    return found;
  }

  /**
   * The assertion every case in this file makes.
   *
   * Asking as A must produce a 2xx that contains A's row and none of B's. Both
   * halves matter: without the "contains mine" half, a route that returned
   * nothing at all would pass and look like isolation.
   */
  async function expectScopedTo(
    url: string,
    mine: { id: string; label: string },
    theirs: { id: string; label: string }
  ) {
    const response = await app.inject({ method: 'GET', url, headers: asOwner(a) });

    expect(response.statusCode, `${url} should answer agency A`).toBeLessThan(400);

    const ids = idsIn(response.json());
    expect(ids, `${url} should return A's own ${mine.label}`).toContain(mine.id);
    expect(ids, `${url} leaked agency B's ${theirs.label}`).not.toContain(theirs.id);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // 1. The eight surfaces the two agencies actually use
  // ══════════════════════════════════════════════════════════════════════════
  describe('a session for agency A receives zero rows belonging to agency B', () => {
    it('calls', async () => {
      await expectScopedTo(
        '/api/v1/calls',
        { id: a.callId, label: 'call' },
        { id: b.callId, label: 'call' }
      );
    });

    it('recordings', async () => {
      await expectScopedTo(
        '/api/v1/recordings',
        { id: a.recordingId, label: 'recording' },
        { id: b.recordingId, label: 'recording' }
      );
    });

    it('insurance leads', async () => {
      await expectScopedTo(
        '/api/v1/insurance-leads',
        { id: a.insuranceLeadId, label: 'insurance lead' },
        { id: b.insuranceLeadId, label: 'insurance lead' }
      );
    });

    it('campaigns', async () => {
      await expectScopedTo(
        '/api/v1/campaigns',
        { id: a.campaignId, label: 'campaign' },
        { id: b.campaignId, label: 'campaign' }
      );
    });

    it('phone numbers', async () => {
      await expectScopedTo(
        '/api/v1/numbers',
        { id: a.phoneNumberId, label: 'phone number' },
        { id: b.phoneNumberId, label: 'phone number' }
      );
    });

    it('publishers', async () => {
      await expectScopedTo(
        '/api/v1/publishers',
        { id: a.publisherId, label: 'publisher' },
        { id: b.publisherId, label: 'publisher' }
      );
    });

    it('billing: buyers and their balances', async () => {
      await expectScopedTo(
        '/api/v1/buyers',
        { id: a.buyerId, label: 'buyer' },
        { id: b.buyerId, label: 'buyer' }
      );
    });

    it('billing: rate cards, which decide what an agency pays per application', async () => {
      // This one had no tenant filter at all. `GET .../rate-cards` with no
      // billingAccountId returned every rate card on the platform, and the
      // preHandler only asked whether the caller was *an* administrator --
      // ADMIN and OWNER being per-tenant roles, that is not the same as being
      // this account's administrator.
      await expectScopedTo(
        '/api/v1/admin/billing/rate-cards',
        { id: a.rateCardId, label: 'rate card' },
        { id: b.rateCardId, label: 'rate card' }
      );
    });

    it('users', async () => {
      await expectScopedTo(
        '/api/v1/users',
        { id: a.ownerId, label: 'user' },
        { id: b.ownerId, label: 'user' }
      );
    });

    it('reports do not aggregate across agencies', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/reporting/metrics',
        headers: asOwner(a),
      });

      expect(response.statusCode).toBeLessThan(400);
      const ids = idsIn(response.json());
      expect(ids).not.toContain(b.callId);
      expect(ids).not.toContain(b.campaignId);
      expect(ids).not.toContain(b.buyerId);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2. Addressing B's row by its id directly
  // ══════════════════════════════════════════════════════════════════════════
  describe("naming agency B's row by id does not reach it", () => {
    /**
     * A list endpoint can be scoped while the detail endpoint beside it is not,
     * because the detail one usually addresses the row by primary key. That was
     * the case here on several routes. The rule is the same either way: not
     * yours means not found.
     */
    async function expectNotReachable(url: string, method: 'GET' | 'POST' | 'PATCH' = 'GET') {
      const response = await app.inject({ method, url, headers: asOwner(a), payload: {} });
      expect(
        [403, 404],
        `${method} ${url} answered ${response.statusCode} for another agency's row`
      ).toContain(response.statusCode);
    }

    it("agency B's call detail", async () => {
      await expectNotReachable(`/api/v1/calls/${b.callId}`);
    });

    it("agency B's recording detail", async () => {
      await expectNotReachable(`/api/v1/recordings/${b.recordingId}`);
    });

    it("agency B's campaign detail", async () => {
      await expectNotReachable(`/api/v1/campaigns/${b.campaignId}`);
    });

    it("agency B's insurance lead detail", async () => {
      await expectNotReachable(`/api/v1/insurance-leads/${b.insuranceLeadId}`);
    });

    it("agency B's publisher credentials", async () => {
      // `requirePublisherAccess()` returns true for ANY publisherId once the
      // caller holds ADMIN or OWNER, and never compares tenants -- so the tenant
      // has to be on the query. Without it this handed back another agency's
      // publisher code.
      await expectNotReachable(`/api/v1/publishers/${b.publisherId}/rtb-credentials`);
    });

    it("agency B's call recording-debug view", async () => {
      // This route had no tenant concept whatsoever: it took a callId, read the
      // row by primary key and returned its metadata and recordings.
      await expectNotReachable(`/api/v1/calls/${b.callId}/recording-debug`);
    });

    it("agency B's rate cards, asked for by billing account", async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/billing/rate-cards?billingAccountId=${b.billingAccountId}`,
        headers: asOwner(a),
      });

      expect(response.statusCode).toBeLessThan(500);
      expect(idsIn(response.json())).not.toContain(b.rateCardId);
    });

    it("agency B's billing period cannot be closed by agency A", async () => {
      // The money surface. Unscoped, this generated an invoice from another
      // agency's accruals, and the payouts route beside it sent a Stripe
      // Connect transfer against their account.
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/billing/close-period',
        headers: asOwner(a),
        payload: {
          billingAccountId: b.billingAccountId,
          periodDate: new Date().toISOString(),
          dueDate: new Date(Date.now() + 86400000).toISOString(),
        },
      });

      expect([403, 404]).toContain(response.statusCode);

      const invoices = await prisma.invoice.count({
        where: { billingAccountId: b.billingAccountId },
      });
      expect(invoices, "agency A generated an invoice on agency B's account").toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 3. Writes, which are worse than reads
  // ══════════════════════════════════════════════════════════════════════════
  describe("agency A cannot write to agency B's rows", () => {
    it("does not update agency B's call recording status", async () => {
      const before = await prisma.call.findUnique({ where: { id: b.callId } });

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/calls/${b.callId}/recording-status`,
        headers: asOwner(a),
        payload: { status: 'error', error: 'written by the wrong agency' },
      });

      expect([403, 404]).toContain(response.statusCode);

      const after = await prisma.call.findUnique({ where: { id: b.callId } });
      expect(after?.recordingStatus).toBe(before?.recordingStatus ?? null);
    });

    it("does not update agency B's campaign", async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/campaigns/${b.campaignId}`,
        headers: asOwner(a),
        payload: { name: 'Renamed by another agency' },
      });

      expect([403, 404]).toContain(response.statusCode);

      const campaign = await prisma.campaign.findUnique({ where: { id: b.campaignId } });
      expect(campaign?.name).toBe('Bravo Final Expense');
    });

    it("does not update agency B's phone number", async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/numbers/${b.phoneNumberId}`,
        headers: asOwner(a),
        payload: { status: 'INACTIVE' },
      });

      expect([403, 404]).toContain(response.statusCode);

      const number = await prisma.phoneNumber.findUnique({ where: { id: b.phoneNumberId } });
      expect(number?.status).toBe('ACTIVE');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 4. The tenant cannot be named from the wire
  // ══════════════════════════════════════════════════════════════════════════
  describe('the acting tenant comes from the session and nowhere else', () => {
    it('ignores X-Demo-Tenant-Id on an authenticated request', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/calls',
        headers: { ...asOwner(a), 'x-demo-tenant-id': b.tenantId },
      });

      expect(response.statusCode).toBeLessThan(400);
      const ids = idsIn(response.json());
      expect(ids).toContain(a.callId);
      expect(ids).not.toContain(b.callId);
    });

    it('ignores ?demoTenantId= on an authenticated request', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/calls?demoTenantId=${b.tenantId}`,
        headers: asOwner(a),
      });

      expect(response.statusCode).toBeLessThan(400);
      expect(idsIn(response.json())).not.toContain(b.callId);
    });

    it('refuses an unauthenticated request rather than choosing a tenant for it', async () => {
      // Several of these routes used to fall back to `user?.tenantId ||
      // 'default'` and run the query anyway. A 401 is the only correct answer:
      // the alternative is a report about a tenant nobody asked for.
      for (const url of [
        '/api/v1/calls',
        '/api/v1/campaigns',
        '/api/v1/numbers',
        '/api/v1/recordings',
        '/api/v1/insurance-leads',
        '/api/v1/buyers',
        '/api/v1/reporting/metrics',
        '/api/v1/reporting/calls',
        '/api/v1/dashboard/stats',
      ]) {
        const response = await app.inject({ method: 'GET', url });
        expect(response.statusCode, `${url} answered an anonymous request`).toBe(401);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 5. Registration, which is where the tenant used to be guessed
  // ══════════════════════════════════════════════════════════════════════════
  describe('registration does not adopt a tenant from the request', () => {
    const NEW_ACCOUNT = {
      email: 'stranger@example.invalid',
      password: 'Password123',
      firstName: 'Stranger',
    };

    it('refuses a signup with no activation token', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: NEW_ACCOUNT,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('ACTIVATION_TOKEN_REQUIRED');

      const created = await prisma.user.findUnique({ where: { email: NEW_ACCOUNT.email } });
      expect(created, 'a user was created without an activation grant').toBeNull();
    });

    it('does not pick a tenant from Host, Referer or Origin', async () => {
      // The nine-step guess: Host matched against tenants.domain, then Referer,
      // then Origin, then the first host label against tenants.slug, then the
      // slugs 'test-org' and 'default', then the oldest ACTIVE tenant row --
      // which on this fixture is agency Alpha.
      for (const headers of [
        { host: `${a.slug}.netenroll.com` },
        { referer: `https://${a.slug}.netenroll.com/signup` },
        { origin: `https://${a.slug}.netenroll.com` },
      ]) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/auth/register',
          headers,
          payload: NEW_ACCOUNT,
        });

        expect(response.statusCode).toBe(400);
        expect(
          await prisma.user.findUnique({ where: { email: NEW_ACCOUNT.email } }),
          'a request header placed a new account inside an existing agency'
        ).toBeNull();
      }
    });

    it('never creates a tenant of its own', async () => {
      const before = await prisma.tenant.count();

      await app.inject({ method: 'POST', url: '/api/auth/register', payload: NEW_ACCOUNT });

      expect(await prisma.tenant.count()).toBe(before);
    });

    it('places the account in the tenant the activation grant names', async () => {
      const { issueActivationGrant } = await import('../services/tenant-activation.js');
      const grant = await issueActivationGrant({
        tenantId: b.tenantId,
        email: NEW_ACCOUNT.email,
        roleName: RoleName.AGENT,
        source: 'ADMIN_INVITE',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        // The host names agency A. The grant names agency B. The grant wins,
        // because the host is not consulted at all.
        headers: { host: `${a.slug}.netenroll.com` },
        payload: { ...NEW_ACCOUNT, activationToken: grant.token },
      });

      expect(response.statusCode).toBe(201);

      const created = await prisma.user.findUnique({ where: { email: NEW_ACCOUNT.email } });
      expect(created?.tenantId).toBe(b.tenantId);
      expect(created?.status).toBe('ACTIVE');
    });

    it('refuses a grant presented with a different email address', async () => {
      const { issueActivationGrant } = await import('../services/tenant-activation.js');
      const grant = await issueActivationGrant({
        tenantId: b.tenantId,
        email: 'invited@example.invalid',
        source: 'ADMIN_INVITE',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { ...NEW_ACCOUNT, activationToken: grant.token },
      });

      expect(response.statusCode).toBe(400);
      expect(await prisma.user.findUnique({ where: { email: NEW_ACCOUNT.email } })).toBeNull();
    });

    it('spends a grant exactly once', async () => {
      const { issueActivationGrant } = await import('../services/tenant-activation.js');
      const grant = await issueActivationGrant({
        tenantId: b.tenantId,
        email: NEW_ACCOUNT.email,
        source: 'ADMIN_INVITE',
      });

      const first = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { ...NEW_ACCOUNT, activationToken: grant.token },
      });
      expect(first.statusCode).toBe(201);

      const second = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          ...NEW_ACCOUNT,
          email: 'second@example.invalid',
          activationToken: grant.token,
        },
      });
      expect(second.statusCode).toBe(400);
      expect(await prisma.user.findUnique({ where: { email: 'second@example.invalid' } })).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 6. Issuing an invitation cannot cross the boundary either
  // ══════════════════════════════════════════════════════════════════════════
  describe('an agency owner can only invite into their own agency', () => {
    it('issues a grant for the caller\'s own tenant, with no way to name another', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/activation-grants',
        headers: asOwner(a),
        // A tenantId in the body is not part of the contract. Sending one must
        // change nothing -- this is the assertion that there is no field to
        // find.
        payload: { email: 'newagent@example.invalid', role: 'AGENT', tenantId: b.tenantId },
      });

      expect(response.statusCode).toBe(201);

      const grants = await prisma.tenantActivationGrant.findMany({
        where: { email: 'newagent@example.invalid' },
      });
      expect(grants).toHaveLength(1);
      expect(grants[0].tenantId).toBe(a.tenantId);
    });
  });
});
