/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses and captured mail, which are dynamically typed */
import { RoleName } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { grantPlatformAdmin } from '../lib/platform-admin.js';
import { getPrismaClient } from '../lib/prisma.js';
import {
  brandForTenant,
  defaultPortalUrl,
  portalDomainForTenant,
  portalHost,
  portalUrlForTenant,
} from '../lib/tenant-brand.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { registerReadOnlyPreview } from '../middleware/read-only-preview.js';
import { registerStaffOnly } from '../middleware/staff-only.js';
import { clearPublicBrandCache } from '../routes/public-brand.js';
import { emailBrandForTenant } from '../services/email-brand.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * One application, two public hostnames.
 *
 *   agents.netenroll.com       NetEnroll's own agencies
 *   agents.lifeleadsplus.com   the Life Leads Plus white-label, and every child
 *                              agency it onboards
 *
 * ── What this pins ───────────────────────────────────────────────────────────
 *
 *   1. Which host a tenant's links name: its own `Tenant.domain`, else its
 *      parent's, else agents.netenroll.com (`portalDomainForTenant`).
 *   2. That invitation and password-reset links -- emailed, and returned for
 *      hand delivery -- use that host, for the recipient's tenant, whatever
 *      host the request that caused them arrived on.
 *   3. That the login page's brand follows the host, and nothing else does.
 *   4. That Host, Origin, Referer, X-Forwarded-Host and query parameters can
 *      NOT change the authenticated tenant: a child agency signed in on the
 *      parent's domain is the child, never the parent, and a NetEnroll agency
 *      on the Life Leads Plus domain is still itself.
 *   5. That staff set the domain through the audited branding route, and that
 *      it refuses the values that would break the model (the default host, a
 *      child agency, a host another agency owns).
 */

const sendMail = vi.fn<[message: any], Promise<{ accepted: string[] }>>();
vi.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail }),
  default: { createTransport: () => ({ sendMail }) },
}));

const NETENROLL_HOST = 'agents.netenroll.com';
const LLP_HOST = 'agents.lifeleadsplus.com';

// ════════════════════════════════════════════════════════════════════════════
// Pure helpers
// ════════════════════════════════════════════════════════════════════════════

describe('portalHost', () => {
  it('reduces a stored domain to a bare host', () => {
    expect(portalHost('agents.lifeleadsplus.com')).toBe(LLP_HOST);
    expect(portalHost('  Agents.LifeLeadsPlus.com.  ')).toBe(LLP_HOST);
    expect(portalHost('https://agents.lifeleadsplus.com/')).toBe(LLP_HOST);
    expect(portalHost('https://agents.lifeleadsplus.com:443/login?x=1')).toBe(LLP_HOST);
  });

  it('answers null for nothing usable', () => {
    expect(portalHost(null)).toBeNull();
    expect(portalHost(undefined)).toBeNull();
    expect(portalHost('')).toBeNull();
    expect(portalHost('not a host')).toBeNull();
  });
});

describe('defaultPortalUrl', () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.APP_URL;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = saved;
  });

  it('is agents.netenroll.com when APP_URL is unset or blank', () => {
    delete process.env.APP_URL;
    expect(defaultPortalUrl()).toBe(`https://${NETENROLL_HOST}`);
    process.env.APP_URL = '   ';
    expect(defaultPortalUrl()).toBe(`https://${NETENROLL_HOST}`);
  });

  it('is APP_URL, without a trailing slash, when set', () => {
    process.env.APP_URL = 'http://localhost:3000/';
    expect(defaultPortalUrl()).toBe('http://localhost:3000');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Against a real database
// ════════════════════════════════════════════════════════════════════════════

const gate = databaseGate();
announceSkip('White-label portal domain', gate);

const TEST_JWT_SECRET = 'white-label-domain-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('White-label domain suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `white-label domain suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('White-label portal domain', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;

  interface Agency {
    id: string;
    ownerId: string;
    ownerEmail: string;
  }
  /** A NetEnroll agency: no domain, no brand, no parent. */
  let netEnroll: Agency;
  /** The Life Leads Plus white-label parent, which owns agents.lifeleadsplus.com. */
  let llp: Agency;
  /** Two child agencies of Life Leads Plus. No domain of their own. */
  let agencyA: Agency & { agentId: string };
  let agencyB: Agency;
  /** A white-label agency with no domain and no relation to Life Leads Plus. */
  let unrelated: Agency;
  /** NetEnroll staff. */
  let operatorId: string;
  let stamp: string;

  const SMTP_KEYS = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM', 'APP_URL'] as const;
  const savedEnv: Record<string, string | undefined> = {};

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);
    registerReadOnlyPreview(instance);
    registerStaffOnly(instance);
    const { registerAuthRoutes } = await import('../routes/auth.js');
    const { registerNetworkRoutes } = await import('../routes/network.js');
    const { registerPlatformRoutes } = await import('../routes/platform.js');
    const { registerPublicBrandRoutes } = await import('../routes/public-brand.js');
    await instance.register(registerAuthRoutes);
    await instance.register(registerNetworkRoutes);
    await instance.register(registerPlatformRoutes);
    await instance.register(registerPublicBrandRoutes);
    await instance.ready();
    return instance;
  }

  const bearer = (userId: string, tenantId: string | null) => ({
    authorization: `Bearer ${app.jwt.sign({ userId, tenantId, email: `${userId}@t.local` })}`,
  });

  beforeAll(async () => {
    for (const key of SMTP_KEYS) savedEnv[key] = process.env[key];
    process.env.SMTP_HOST = 'smtp.example.test';
    process.env.SMTP_USER = 'mailer';
    process.env.SMTP_PASSWORD = 'secret';
    process.env.SMTP_FROM = 'noreply@netenroll.com';
    process.env.APP_URL = `https://${NETENROLL_HOST}`;
    app = await buildApp();
  });

  afterAll(async () => {
    for (const key of SMTP_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    await app?.close();
  });

  beforeEach(async () => {
    sendMail.mockReset().mockResolvedValue({ accepted: ['x'] });
    clearPublicBrandCache();
    prisma = getPrismaClient();
    for (const table of [
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

    const roles: Record<string, string> = {};
    for (const name of [RoleName.OWNER, RoleName.ADMIN, RoleName.AGENT]) {
      roles[name] = (
        await prisma.role.create({ data: { name, description: name, permissions: [] } })
      ).id;
    }
    stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const user = async (tenantId: string, role: RoleName, tag: string) => {
      const email = `${tag}-${stamp}@t.test`;
      const row = await prisma.user.create({
        data: { tenantId, email, status: 'ACTIVE', roles: { create: { roleId: roles[role] } } },
      });
      return { id: row.id, email };
    };
    const agency = async (tag: string, data: Record<string, unknown>): Promise<Agency> => {
      const tenant = await prisma.tenant.create({
        data: { name: tag, slug: `${tag}-${stamp}`, status: 'ACTIVE', ...data },
      });
      const owner = await user(tenant.id, RoleName.OWNER, `${tag}-owner`);
      return { id: tenant.id, ownerId: owner.id, ownerEmail: owner.email };
    };

    netEnroll = await agency('ridgeline', {});
    llp = await agency('llp', {
      domain: LLP_HOST,
      whiteLabel: true,
      brandTheme: 'life-leads-plus',
      brandName: 'Life Leads Plus',
    });
    const a = await agency('agency-a', { parentTenantId: llp.id });
    agencyA = { ...a, agentId: (await user(a.id, RoleName.AGENT, 'agency-a-agent')).id };
    agencyB = await agency('agency-b', { parentTenantId: llp.id });
    unrelated = await agency('elsewhere', { whiteLabel: true });

    const operator = await prisma.user.create({
      data: { email: `operator-${stamp}@netenroll.test`, status: 'ACTIVE', tenantId: null },
    });
    operatorId = operator.id;
    await grantPlatformAdmin(operatorId, { note: 'white-label domain suite fixture' });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 1. Which host a tenant's links name
  // ══════════════════════════════════════════════════════════════════════════
  describe('portalDomainForTenant', () => {
    it('is agents.netenroll.com for a NetEnroll agency', async () => {
      expect(await portalDomainForTenant(netEnroll.id)).toBe(NETENROLL_HOST);
      expect(await portalUrlForTenant(netEnroll.id)).toBe(`https://${NETENROLL_HOST}`);
    });

    it('is its own domain for the Life Leads Plus parent', async () => {
      expect(await portalDomainForTenant(llp.id)).toBe(LLP_HOST);
      expect(await portalUrlForTenant(llp.id)).toBe(`https://${LLP_HOST}`);
    });

    it("is the parent's domain for a Life Leads Plus child agency", async () => {
      for (const child of [agencyA, agencyB]) {
        expect(await portalDomainForTenant(child.id)).toBe(LLP_HOST);
        expect(await portalUrlForTenant(child.id)).toBe(`https://${LLP_HOST}`);
      }
      // Inherited, not copied: the child row still has no domain.
      const row = await prisma.tenant.findUniqueOrThrow({ where: { id: agencyA.id } });
      expect(row.domain).toBeNull();
    });

    it('is agents.netenroll.com for an unrelated tenant with no domain', async () => {
      expect(await portalDomainForTenant(unrelated.id)).toBe(NETENROLL_HOST);
    });

    it('is agents.netenroll.com for no tenant, and for one that does not exist', async () => {
      expect(await portalDomainForTenant(null)).toBe(NETENROLL_HOST);
      expect(await portalDomainForTenant('00000000-0000-0000-0000-000000000000')).toBe(
        NETENROLL_HOST
      );
    });

    it("follows the parent when the parent's domain changes", async () => {
      await prisma.tenant.update({
        where: { id: llp.id },
        data: { domain: 'portal.lifeleadsplus.test' },
      });
      expect(await portalDomainForTenant(agencyA.id)).toBe('portal.lifeleadsplus.test');
    });

    it("prefers a tenant's own domain to its parent's", async () => {
      await prisma.tenant.update({
        where: { id: agencyB.id },
        data: { domain: 'agency-b.example.test' },
      });
      expect(await portalDomainForTenant(agencyB.id)).toBe('agency-b.example.test');
      expect(await portalDomainForTenant(agencyA.id)).toBe(LLP_HOST);
    });

    it('reads a legacy URL-form domain as its host', async () => {
      await prisma.tenant.update({
        where: { id: llp.id },
        data: { domain: 'https://Agents.LifeLeadsPlus.com/' },
      });
      expect(await portalUrlForTenant(agencyA.id)).toBe(`https://${LLP_HOST}`);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2. Branding
  // ══════════════════════════════════════════════════════════════════════════
  describe('branding', () => {
    const LLP_BRAND = { theme: 'life-leads-plus', name: 'Life Leads Plus' };

    it('is Life Leads Plus for the parent, and inherited by each child', async () => {
      expect(await brandForTenant(llp.id)).toEqual(LLP_BRAND);
      expect(await brandForTenant(agencyA.id)).toEqual(LLP_BRAND);
      expect(await brandForTenant(agencyB.id)).toEqual(LLP_BRAND);
    });

    it('is NetEnroll (no brand) for a NetEnroll agency', async () => {
      expect(await brandForTenant(netEnroll.id)).toBeNull();
      expect(await brandForTenant(unrelated.id)).toBeNull();
    });

    it('puts the right product name and link host on email', async () => {
      const cases: [string, string, string][] = [
        [netEnroll.id, 'NetEnroll', `https://${NETENROLL_HOST}`],
        [llp.id, 'Life Leads Plus', `https://${LLP_HOST}`],
        [agencyA.id, 'Life Leads Plus', `https://${LLP_HOST}`],
        [unrelated.id, 'NetEnroll', `https://${NETENROLL_HOST}`],
      ];
      for (const [tenantId, productName, linkBase] of cases) {
        const brand = await emailBrandForTenant(tenantId);
        expect(brand.productName).toBe(productName);
        expect(brand.linkBase).toBe(linkBase);
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 3. Generated links: invitations and password resets
  // ══════════════════════════════════════════════════════════════════════════
  describe('invitation links', () => {
    /**
     * An owner invites an agent. The request arrives on the OTHER host each
     * time -- a hostile or merely confused proxy -- and the link must still
     * name the recipient tenant's portal.
     */
    const cases = () =>
      [
        ['a NetEnroll agency', netEnroll, NETENROLL_HOST, LLP_HOST],
        ['the Life Leads Plus parent', llp, LLP_HOST, NETENROLL_HOST],
        ['a Life Leads Plus child', agencyA, LLP_HOST, NETENROLL_HOST],
      ] as const;

    it.each([0, 1, 2])('uses the tenant portal for case %i', async index => {
      const [label, agency, expectedHost, wrongHost] = cases()[index];
      const invitee = `invitee-${index}-${stamp}@t.test`;
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/auth/activation-grants?tenantId=${llp.id}`,
        headers: {
          ...bearer(agency.ownerId, agency.id),
          host: wrongHost,
          origin: `https://${wrongHost}`,
          referer: `https://${wrongHost}/settings/team`,
          'x-forwarded-host': wrongHost,
        },
        payload: { email: invitee, role: 'AGENT' },
      });
      expect(response.statusCode, `${label}: ${response.body}`).toBe(201);

      const expected = `https://${expectedHost}/login?`;
      expect(response.json().activationLink.startsWith(expected), label).toBe(true);

      expect(sendMail).toHaveBeenCalledTimes(1);
      const message = sendMail.mock.calls[0][0];
      expect(message.text, label).toContain(expected);
      expect(message.html, label).toContain(expected);
      expect(message.text, label).not.toContain(`https://${wrongHost}/login`);

      // The grant is for the caller's tenant, never the one the query named.
      const grant = await prisma.tenantActivationGrant.findFirstOrThrow({
        where: { email: invitee },
      });
      expect(grant.tenantId).toBe(agency.id);
    });

    it("gives a white-label parent a child owner's link on the parent's domain", async () => {
      await prisma.agencyProfile.create({
        data: {
          tenantId: agencyB.id,
          legalName: 'Agency B LLC',
          state: 'TX',
          contactName: 'B Owner',
          contactEmail: 'b@t.test',
          contactPhone: '5125550100',
          licensedAgentCount: 3,
          deliveryDays: ['MON'],
          deliveryStartTime: '09:00',
          deliveryEndTime: '17:00',
        },
      });
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/network/agencies/${agencyB.id}/owner`,
        headers: { ...bearer(llp.ownerId, llp.id), host: NETENROLL_HOST },
        payload: { email: `b-new-owner-${stamp}@t.test` },
      });
      expect(response.statusCode, response.body).toBe(201);
      const data = response.json().data;
      expect(data.activationLink.startsWith(`https://${LLP_HOST}/login?`)).toBe(true);
      expect(sendMail.mock.calls[0][0].text).toContain(`https://${LLP_HOST}/login?`);
    });
  });

  describe('password reset links', () => {
    it.each([
      ['a NetEnroll agency', () => netEnroll, NETENROLL_HOST, LLP_HOST],
      ['the Life Leads Plus parent', () => llp, LLP_HOST, NETENROLL_HOST],
      ['a Life Leads Plus child', () => agencyA, LLP_HOST, NETENROLL_HOST],
    ] as const)(
      'emails %s a link on its own portal, whichever host asked',
      async (label, agency, expectedHost, wrongHost) => {
        const response = await app.inject({
          method: 'POST',
          url: '/api/auth/password-reset',
          headers: { host: wrongHost, origin: `https://${wrongHost}` },
          payload: { email: agency().ownerEmail },
        });
        expect(response.statusCode).toBe(202);
        expect(sendMail).toHaveBeenCalledTimes(1);
        const message = sendMail.mock.calls[0][0];
        expect(message.text, label).toContain(`https://${expectedHost}/reset-password?token=`);
        expect(message.text, label).not.toContain(wrongHost);
      }
    );
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 4. Public branding by host
  // ══════════════════════════════════════════════════════════════════════════
  describe('GET /api/v1/public/brand', () => {
    const brandOf = (host: string) =>
      app.inject({ method: 'GET', url: `/api/v1/public/brand?host=${encodeURIComponent(host)}` });

    it('is NetEnroll (null) on agents.netenroll.com', async () => {
      const response = await brandOf(NETENROLL_HOST);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ data: null });
    });

    it('is Life Leads Plus on agents.lifeleadsplus.com, however the host is spelled', async () => {
      for (const host of [LLP_HOST, 'Agents.LifeLeadsPlus.com:443', `${LLP_HOST}.`]) {
        const response = await brandOf(host);
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({
          data: { theme: 'life-leads-plus', name: 'Life Leads Plus' },
        });
      }
    });

    it('never names the tenant behind the domain', async () => {
      const body = (await brandOf(LLP_HOST)).body;
      expect(body).not.toContain(llp.id);
      expect(body).not.toContain(`llp-${stamp}`);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 5. The host never picks the authenticated tenant
  // ══════════════════════════════════════════════════════════════════════════
  describe('tenant isolation across hosts', () => {
    /** Every way the wire could try to name another tenant. */
    function hostile(target: Agency, host: string) {
      return [
        { headers: { host }, url: '/api/auth/me' },
        { headers: { host, origin: `https://${host}` }, url: '/api/auth/me' },
        { headers: { host, referer: `https://${host}/dashboard` }, url: '/api/auth/me' },
        { headers: { host, 'x-forwarded-host': host }, url: '/api/auth/me' },
        { headers: { host }, url: `/api/auth/me?tenantId=${target.id}` },
        { headers: { host, 'x-tenant-id': target.id }, url: '/api/auth/me' },
        {
          headers: { host, cookie: `tenantId=${target.id}` },
          url: `/api/auth/me?tenant=${target.id}&host=${host}`,
        },
      ];
    }

    it('keeps Agency A as Agency A on the Life Leads Plus domain, never the parent', async () => {
      for (const who of [agencyA.ownerId, agencyA.agentId]) {
        for (const attempt of hostile(llp, LLP_HOST)) {
          const response = await app.inject({
            method: 'GET',
            url: attempt.url,
            headers: { ...bearer(who, agencyA.id), ...attempt.headers },
          });
          expect(response.statusCode).toBe(200);
          const body = response.json();
          expect(body.tenantId, JSON.stringify(attempt)).toBe(agencyA.id);
          expect(body.tenantId).not.toBe(llp.id);
          // Presented as Life Leads Plus, because that is its inherited brand.
          expect(body.brand).toEqual({ theme: 'life-leads-plus', name: 'Life Leads Plus' });
        }
      }
    });

    it('keeps Agency A as Agency A when it names Agency B', async () => {
      for (const attempt of hostile(agencyB, LLP_HOST)) {
        const response = await app.inject({
          method: 'GET',
          url: attempt.url,
          headers: { ...bearer(agencyA.ownerId, agencyA.id), ...attempt.headers },
        });
        expect(response.json().tenantId).toBe(agencyA.id);
      }
    });

    it('keeps a NetEnroll agency itself on the Life Leads Plus domain', async () => {
      for (const attempt of hostile(llp, LLP_HOST)) {
        const response = await app.inject({
          method: 'GET',
          url: attempt.url,
          headers: { ...bearer(netEnroll.ownerId, netEnroll.id), ...attempt.headers },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().tenantId).toBe(netEnroll.id);
        // And it is not drawn in Life Leads Plus's brand, either.
        expect(response.json().brand).toBeNull();
      }
    });

    it('keeps a Life Leads Plus child itself on the NetEnroll domain', async () => {
      for (const attempt of hostile(netEnroll, NETENROLL_HOST)) {
        const response = await app.inject({
          method: 'GET',
          url: attempt.url,
          headers: { ...bearer(agencyA.ownerId, agencyA.id), ...attempt.headers },
        });
        expect(response.json().tenantId).toBe(agencyA.id);
        expect(response.json().brand?.theme).toBe('life-leads-plus');
      }
    });

    it("does not open the parent's network screens to a child on the parent's domain", async () => {
      // The parent's own operator reaches its downline...
      const parentView = await app.inject({
        method: 'GET',
        url: '/api/v1/network/agencies',
        headers: { ...bearer(llp.ownerId, llp.id), host: LLP_HOST },
      });
      expect(parentView.statusCode).toBe(200);

      // ...and Agency A's owner, on the same host naming the parent every way
      // it can, is refused: it is a normal agency, not the white-label.
      const childView = await app.inject({
        method: 'GET',
        url: `/api/v1/network/agencies?tenantId=${llp.id}`,
        headers: {
          ...bearer(agencyA.ownerId, agencyA.id),
          host: LLP_HOST,
          origin: `https://${LLP_HOST}`,
          referer: `https://${LLP_HOST}/network/agencies`,
          'x-tenant-id': llp.id,
        },
      });
      expect(childView.statusCode).toBe(403);
      expect(childView.body).not.toContain(agencyB.id);
    });

    it('refuses an unauthenticated request on either host, whatever it names', async () => {
      for (const host of [NETENROLL_HOST, LLP_HOST]) {
        const response = await app.inject({
          method: 'GET',
          url: `/api/auth/me?tenantId=${llp.id}`,
          headers: { host, origin: `https://${host}`, 'x-tenant-id': llp.id },
        });
        expect(response.statusCode).toBe(401);
      }
    });

    it('answers the same /api on both hosts', async () => {
      const answers = [];
      for (const host of [NETENROLL_HOST, LLP_HOST]) {
        const response = await app.inject({
          method: 'GET',
          url: '/api/auth/me',
          headers: { ...bearer(agencyB.ownerId, agencyB.id), host },
        });
        expect(response.statusCode).toBe(200);
        answers.push(response.json().tenantId);
      }
      expect(answers).toEqual([agencyB.id, agencyB.id]);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 6. Staff set the domain, through the audited branding route
  // ══════════════════════════════════════════════════════════════════════════
  describe('PATCH /api/v1/admin/tenants/:tenantId/branding { domain }', () => {
    const setDomain = (userId: string, tenantId: string | null, target: string, domain: unknown) =>
      app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/tenants/${target}/branding`,
        headers: bearer(userId, tenantId),
        payload: { domain } as Record<string, unknown>,
      });

    it('sets it as a bare host, audits it, and clears it', async () => {
      await prisma.tenant.update({ where: { id: llp.id }, data: { domain: null } });

      const set = await setDomain(operatorId, null, llp.id, 'HTTPS://Agents.LifeLeadsPlus.com/');
      expect(set.statusCode, set.body).toBe(200);
      expect(set.json().data.domain).toBe(LLP_HOST);
      expect(await portalDomainForTenant(agencyA.id)).toBe(LLP_HOST);

      const audit = await prisma.auditLog.findFirstOrThrow({
        where: { tenantId: llp.id, action: 'platform.tenant.brand_changed' },
      });
      expect(audit.changes).toMatchObject({
        before: { domain: null },
        after: { domain: LLP_HOST },
      });

      const cleared = await setDomain(operatorId, null, llp.id, null);
      expect(cleared.statusCode).toBe(200);
      expect(cleared.json().data.domain).toBeNull();
      expect(await portalDomainForTenant(agencyA.id)).toBe(NETENROLL_HOST);
    });

    it('takes effect on the public brand at once', async () => {
      await prisma.tenant.update({ where: { id: llp.id }, data: { domain: null } });
      const before = await app.inject({
        method: 'GET',
        url: `/api/v1/public/brand?host=${LLP_HOST}`,
      });
      expect(before.json().data).toBeNull();

      expect((await setDomain(operatorId, null, llp.id, LLP_HOST)).statusCode).toBe(200);
      const after = await app.inject({
        method: 'GET',
        url: `/api/v1/public/brand?host=${LLP_HOST}`,
      });
      expect(after.json().data?.theme).toBe('life-leads-plus');
    });

    it('refuses the default portal host', async () => {
      const response = await setDomain(operatorId, null, unrelated.id, NETENROLL_HOST);
      expect(response.statusCode).toBe(400);
    });

    it('refuses a domain on a child agency: it inherits its parent', async () => {
      const response = await setDomain(operatorId, null, agencyA.id, 'agency-a.example.test');
      expect(response.statusCode).toBe(400);
      const row = await prisma.tenant.findUniqueOrThrow({ where: { id: agencyA.id } });
      expect(row.domain).toBeNull();
    });

    it('refuses a host another agency already owns', async () => {
      const response = await setDomain(operatorId, null, unrelated.id, LLP_HOST);
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('DOMAIN_TAKEN');
    });

    it.each(['not a host', 'localhost', 'a..b', '-bad.example.com', 42])(
      'refuses %s',
      async value => {
        expect((await setDomain(operatorId, null, unrelated.id, value)).statusCode).toBe(400);
      }
    );

    it("refuses an agency's own OWNER, the white-label's included", async () => {
      for (const agency of [llp, agencyA, netEnroll]) {
        const response = await setDomain(agency.ownerId, agency.id, agency.id, 'evil.example.test');
        expect(response.statusCode).toBe(403);
      }
      const row = await prisma.tenant.findUniqueOrThrow({ where: { id: llp.id } });
      expect(row.domain).toBe(LLP_HOST);
    });
  });
});
