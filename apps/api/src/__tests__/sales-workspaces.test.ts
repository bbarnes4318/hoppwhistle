/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { createHash } from 'crypto';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { RoleName } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { enterActingTenant, grantPlatformAdmin, setPreviewRole } from '../lib/platform-admin.js';
import { getPrismaClient } from '../lib/prisma.js';
import { salesCapabilityFor } from '../lib/sales-workspace.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { registerReadOnlyPreview } from '../middleware/read-only-preview.js';
import { registerStaffOnly } from '../middleware/staff-only.js';
import { sealConfig, sealRefFor } from '../services/agreements/pdf.js';
import { templateSetAssignable, templateSetFor } from '../services/agreements/template-sets.js';
import { nextStageForAgreementEvent } from '../services/sales/stage-policy.js';
import { chromeExecutable } from '../services/statements/statements.js';
import { resetAgreementsStorageService } from '../services/storage.js';

import { installFixtureTemplateSet } from './helpers/fixture-template-set.js';
import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * Sales workspaces: the B2B Sales CRM and each issuer's own agreement suite,
 * end to end against a real database. This is the security matrix of
 * docs/SALES_CRM.md: NetEnroll (PLATFORM), Life Leads Plus (a white-label
 * TENANT on its own domain), one of its child agencies, a second white-label
 * tenant and an ordinary agency. Every boundary is crossed on purpose -- by
 * id, by body, by header and by host -- and every crossing must fail closed.
 */

const sendMail = vi.fn<[message: any], Promise<{ accepted: string[] }>>();
vi.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail }),
  default: { createTransport: () => ({ sendMail }) },
}));

const gate = databaseGate();
announceSkip('Sales workspaces', gate);

const TEST_JWT_SECRET = 'sales-workspaces-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;
const HAS_CHROME = Boolean(chromeExecutable());

const MIGRATIONS = [
  '20261007000000_agreements',
  '20261008000000_agreements_party_details',
  '20261009000000_sales_workspaces',
].map(name => join(__dirname, `../../prisma/migrations/${name}/migration.sql`));

/**
 * What a reader sees: no styles, comments or tags. The engine's internal
 * identifiers (the signature font's family name, the <!--SIG:NETENROLL-->
 * marker the integrity check needs) are not presentation.
 */
function visibleText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ');
}

const LLP_SET = installFixtureTemplateSet('test-llp-fixture', 'life-leads-plus');
const GENERIC_SET = installFixtureTemplateSet('test-generic-fixture', null);

describe('Sales workspaces suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `sales workspaces suite cannot run: ${gate.reason}`).toBe(true);
  });
});

// ── Pure policy: no database ────────────────────────────────────────────────
describe('stage transition policy', () => {
  it('moves forward on agreement events and never backwards', () => {
    expect(nextStageForAgreementEvent('NEW', 'SENT')).toBe('AGREEMENT_SENT');
    expect(nextStageForAgreementEvent('PROPOSAL', 'VIEWED')).toBe('AGREEMENT_REVIEW');
    expect(nextStageForAgreementEvent('AGREEMENT_SENT', 'SIGNED')).toBe('AGREEMENT_SIGNED');
    expect(nextStageForAgreementEvent('AGREEMENT_REVIEW', 'COMPLETED')).toBe('AGREEMENT_SIGNED');
    // Already further along: unchanged.
    expect(nextStageForAgreementEvent('AGREEMENT_SIGNED', 'SENT')).toBeNull();
    expect(nextStageForAgreementEvent('AGREEMENT_REVIEW', 'SENT')).toBeNull();
  });

  it('never touches WON or LOST, and never marks WON by itself', () => {
    for (const event of [
      'SENT',
      'VIEWED',
      'SIGNED',
      'COMPLETED',
      'VOIDED',
      'EXPIRED',
      'CHANGES_REQUESTED',
    ] as const) {
      expect(nextStageForAgreementEvent('WON', event)).toBeNull();
      expect(nextStageForAgreementEvent('LOST', event)).toBeNull();
      expect(nextStageForAgreementEvent('NEW', event)).not.toBe('WON');
    }
  });

  it('changes no stage on void, expiry or a change request', () => {
    for (const event of ['VOIDED', 'EXPIRED', 'CHANGES_REQUESTED'] as const) {
      expect(nextStageForAgreementEvent('AGREEMENT_SENT', event)).toBeNull();
    }
  });
});

describe('template sets and seals', () => {
  it('ships Life Leads Plus with no contract text, so it is not configured', () => {
    const state = templateSetFor({
      scope: 'TENANT',
      templateSetKey: 'life-leads-plus',
      brandTheme: 'life-leads-plus',
    });
    expect(state.configured).toBe(false);
    if (!state.configured) expect(state.reason).toBe('Contract templates not configured');
  });

  it("never lets NetEnroll's legal text serve a white-label suite, or vice versa", () => {
    expect(
      templateSetAssignable('netenroll', { scope: 'TENANT', brandTheme: 'life-leads-plus' })
    ).toBe(false);
    expect(templateSetAssignable('life-leads-plus', { scope: 'PLATFORM', brandTheme: null })).toBe(
      false
    );
    expect(templateSetAssignable('life-leads-plus', { scope: 'TENANT', brandTheme: null })).toBe(
      false
    );
    // Even if a row names it, the engine refuses to render from it.
    expect(
      templateSetFor({ scope: 'TENANT', templateSetKey: 'netenroll', brandTheme: null }).configured
    ).toBe(false);
    expect(
      templateSetFor({ scope: 'PLATFORM', templateSetKey: 'netenroll', brandTheme: null })
        .configured
    ).toBe(true);
  });

  it("refuses NetEnroll's seal for any other issuer", () => {
    expect(sealRefFor('PLATFORM', 'DEFAULT')).toBe('DEFAULT');
    expect(sealRefFor('TENANT', 'DEFAULT')).toBeNull();
    expect(sealRefFor('TENANT', 'LIFE_LEADS_PLUS')).toBe('LIFE_LEADS_PLUS');
    const saved = { ...process.env };
    process.env.AGREEMENT_SEAL_P12_BASE64 = 'Zm9v';
    process.env.AGREEMENT_SEAL_P12_PASSPHRASE = 'x';
    expect(sealConfig(sealRefFor('TENANT', 'DEFAULT'))).toBeNull();
    expect(sealConfig(sealRefFor('TENANT', 'LIFE_LEADS_PLUS'))).toBeNull();
    expect(sealConfig(sealRefFor('PLATFORM', 'DEFAULT'))).not.toBeNull();
    process.env = saved;
  });
});

describe.skipIf(!gate.available)('Sales workspaces', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;
  let storageDir: string;
  const ids: Record<string, string> = {};
  let ipCounter = 0;
  const nextIp = () => `203.0.113.${(ipCounter++ % 250) + 1}`;
  const SAVED: Record<string, string | undefined> = {};
  const ENV = {
    SMTP_HOST: 'smtp.example.test',
    SMTP_USER: 'mailer',
    SMTP_PASSWORD: 'secret',
    SMTP_FROM: 'NetEnroll <noreply@netenroll.com>',
    APP_URL: 'https://agents.netenroll.com',
    S3_ACCESS_KEY: '',
    S3_SECRET_KEY: '',
    AGREEMENT_SEAL_P12_BASE64: '',
    AGREEMENT_SEAL_P12_PASSPHRASE: '',
  };

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);
    registerReadOnlyPreview(instance);
    registerStaffOnly(instance);
    await instance.register(import('@fastify/rate-limit'), { max: 100000, timeWindow: '1 minute' });
    const { registerAgreementRoutes } = await import('../routes/agreements.js');
    await instance.register(registerAgreementRoutes);
    const { registerSalesRoutes } = await import('../routes/sales.js');
    await instance.register(registerSalesRoutes);
    await instance.ready();
    return instance;
  }

  const as = (who: string, extra: Record<string, string> = {}) => {
    const userId = ids[who];
    const tenantId = ids[`${who}:tenant`] ?? null;
    return {
      authorization: `Bearer ${app.jwt.sign({ userId, tenantId, email: `${who}@test.local` })}`,
      ...extra,
    };
  };

  const call = (
    who: string,
    method: string,
    url: string,
    payload?: unknown,
    headers: Record<string, string> = {}
  ) =>
    app.inject({
      method: method as any,
      url,
      headers: as(who, headers),
      payload: payload as any,
      remoteAddress: nextIp(),
    });

  const pub = (
    method: 'GET' | 'POST',
    url: string,
    payload?: unknown,
    headers: Record<string, string> = {}
  ) =>
    app.inject({
      method,
      url: `/api/v1/public/agreements${url}`,
      payload: payload as any,
      headers,
      remoteAddress: nextIp(),
    });

  const TERMS = {
    effectiveDate: '2026-10-03',
    msaEffectiveDate: '2026-10-03',
    cpa: {
      verticals: {
        FE: { selected: true, rate: 160, dailyBlock: 5 },
        MEDICARE: { selected: false, rate: 160, dailyBlock: null },
        ACA: { selected: false, rate: 100, dailyBlock: null },
      },
      deliveryDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
      deliveryStart: '10:00',
      deliveryEnd: '19:00',
      firstDeliveryDay: null,
    },
  };

  function agreementBody(overrides: Record<string, any> = {}) {
    return {
      includesCpa: true,
      includesCpl: false,
      terms: TERMS,
      recipient: {
        name: 'Riley Agent',
        email: 'riley@abcagency.test',
        organization: 'ABC Insurance Agency',
      },
      ccEmails: [],
      issuerSignatory: { name: 'Pat Owner', title: 'President' },
      issuerAuthorityConfirmed: true,
      ...overrides,
    };
  }

  async function createProspect(who: string, payload: Record<string, any> = {}) {
    const response = await call(who, 'POST', '/api/v1/sales/prospects', {
      type: 'INSURANCE_AGENCY',
      companyName: 'ABC Insurance Agency',
      primaryContactName: 'Riley Agent',
      email: 'riley@abcagency.test',
      ...payload,
    });
    expect(response.statusCode, response.body).toBe(201);
    return response.json().data;
  }

  /** Configure a white-label suite the way its owner and NetEnroll would. */
  async function configureSuite(owner: string, templateSetKey: string, legal: string) {
    const settings = await call(owner, 'PUT', '/api/v1/sales/settings', {
      legalEntityName: legal,
      noticeAddress: '1 Issuer Way, Tampa, FL 33602',
      noticeEmail: `contracts@${owner}.test`,
      defaultSignatoryName: 'Pat Owner',
      defaultSignatoryTitle: 'President',
      internalCopyEmails: [`copies@${owner}.test`],
    });
    expect(settings.statusCode, settings.body).toBe(200);
    const workspace = await prisma.salesWorkspace.findUniqueOrThrow({
      where: { tenantId: ids[`${owner}:tenant`] },
      include: { suite: true },
    });
    const admin = await call(
      'operator',
      'PUT',
      `/api/v1/platform/agreement-suites/${workspace.suite!.id}`,
      {
        templateSetKey,
      }
    );
    expect(admin.statusCode, admin.body).toBe(200);
    return workspace.suite!.id;
  }

  function lastCode(subject: string): string {
    const otp = [...sendMail.mock.calls.map(c => c[0])].reverse().find(m => m.subject === subject);
    const match = /code is (\d{6})/.exec(otp?.text ?? '');
    if (!match) throw new Error(`no code was emailed with subject ${subject}`);
    return match[1];
  }

  async function activitiesOf(prospectId: string) {
    return prisma.salesProspectActivity.findMany({
      where: { prospectId },
      orderBy: { createdAt: 'asc' },
    });
  }

  beforeAll(async () => {
    for (const [key, value] of Object.entries(ENV)) {
      SAVED[key] = process.env[key];
      process.env[key] = value;
    }
    SAVED.LOCAL_STORAGE_DIR = process.env.LOCAL_STORAGE_DIR;
    storageDir = mkdtempSync(join(tmpdir(), 'sales-suite-'));
    process.env.LOCAL_STORAGE_DIR = storageDir;
    resetAgreementsStorageService();
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    for (const file of MIGRATIONS) await client.query(readFileSync(file, 'utf8'));
    await client.end();
    app = await buildApp();
  });

  afterAll(async () => {
    for (const [key, value] of Object.entries(SAVED)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetAgreementsStorageService();
    await app?.close();
    if (storageDir) rmSync(storageDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    sendMail.mockReset().mockResolvedValue({ accepted: ['x'] });
    prisma = getPrismaClient();
    for (const table of [
      'sales_prospect_activities',
      'agreement_envelopes',
      'sales_prospects',
      'sales_workspace_access',
      'agreement_suites',
      'sales_workspaces',
      'platform_acting_tenants',
      'platform_admins',
      'audit_logs',
      'roles',
      'tenants',
      'users',
    ]) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`);
    }
    await prisma.agreementSettings.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        netenrollNoticeAddress: '2800 N 6th Street, STE 796, Saint Augustine, FL 32084',
        netenrollNoticeEmail: 'support@pvnvoice.com',
        internalCopyEmails: ['support@pvnvoice.com'],
      },
      update: {
        netenrollNoticeAddress: '2800 N 6th Street, STE 796, Saint Augustine, FL 32084',
        netenrollNoticeEmail: 'support@pvnvoice.com',
        internalCopyEmails: ['support@pvnvoice.com'],
      },
    });
    const roles: Record<string, string> = {};
    for (const name of [RoleName.OWNER, RoleName.ADMIN, RoleName.AGENT]) {
      roles[name] = (
        await prisma.role.create({ data: { name, description: name, permissions: ['admin:*'] } })
      ).id;
    }
    const stamp = Math.random().toString(36).slice(2, 8);
    const tenant = async (key: string, data: Record<string, any>) => {
      ids[key] = (
        await prisma.tenant.create({
          data: { slug: `${key}-${stamp}`, status: 'ACTIVE', ...data } as any,
        })
      ).id;
    };
    await tenant('llp', {
      name: 'Life Leads Plus LLC',
      whiteLabel: true,
      brandTheme: 'life-leads-plus',
      domain: `agents-${stamp}.lifeleadsplus.com`,
    });
    ids.llpDomain = `agents-${stamp}.lifeleadsplus.com`;
    await tenant('child', { name: 'Downline Agency', parentTenantId: ids.llp });
    await tenant('wl2', { name: 'Other White Label', whiteLabel: true });
    await tenant('normal', { name: 'Ordinary Agency' });
    const user = async (key: string, tenantKey: string | null, role?: string) => {
      const created = await prisma.user.create({
        data: {
          email: `${key}-${stamp}@test.local`,
          tenantId: tenantKey ? ids[tenantKey] : null,
          status: 'ACTIVE',
          firstName: key,
          ...(role ? { roles: { create: { roleId: roles[role] } } } : {}),
        },
      });
      ids[key] = created.id;
      ids[`${key}:tenant`] = tenantKey ? ids[tenantKey] : (undefined as any);
      if (!tenantKey) delete ids[`${key}:tenant`];
    };
    await user('llpOwner', 'llp', RoleName.OWNER);
    await user('llpAdmin', 'llp', RoleName.ADMIN);
    await user('llpAgent', 'llp', RoleName.AGENT);
    await user('llpAgent2', 'llp', RoleName.AGENT);
    await user('childOwner', 'child', RoleName.OWNER);
    await user('wl2Owner', 'wl2', RoleName.OWNER);
    await user('normalOwner', 'normal', RoleName.OWNER);
    await user('operator', null);
    await grantPlatformAdmin(ids.operator, { note: 'sales suite' });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Who resolves to which workspace
  // ════════════════════════════════════════════════════════════════════════
  describe('resolution', () => {
    it('gives a platform admin NetEnroll’s PLATFORM workspace (1)', async () => {
      const response = await call('operator', 'GET', '/api/v1/sales/context');
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json().data.workspace).toEqual({ name: 'NetEnroll', scope: 'PLATFORM' });
      expect(response.json().data.access).toEqual({ level: 'MANAGER', via: 'PLATFORM_ADMIN' });
      expect(response.json().data.suite.legalName).toBe('PVN LLC d/b/a NetEnroll');
    });

    it('gives the Life Leads Plus OWNER its own workspace, in its own brand (4, 5)', async () => {
      const response = await call('llpOwner', 'GET', '/api/v1/sales/context');
      expect(response.statusCode, response.body).toBe(200);
      const data = response.json().data;
      expect(data.workspace).toEqual({ name: 'Life Leads Plus', scope: 'TENANT' });
      expect(data.access).toEqual({ level: 'MANAGER', via: 'OWNER' });
      expect(data.suite.brandTheme).toBe('life-leads-plus');
      expect(data.suite.legalName).not.toContain('NetEnroll');
      // No legal entity is assumed from the brand, and no contract text exists.
      expect(data.suite.missingSetting).toBe("Life Leads Plus's legal contracting entity");
      expect(data.suite.templatesConfigured).toBe(false);
      expect(data.suite.templatesMessage).toBe('Contract templates not configured');
      expect(data.can.sendAgreements).toBe(false);
    });

    it("refuses the LLP owner NetEnroll's platform agreement API", async () => {
      for (const [method, url] of [
        ['GET', '/api/v1/platform/agreements'],
        ['GET', '/api/v1/platform/agreements/settings'],
        ['PUT', '/api/v1/platform/agreements/settings'],
        ['GET', '/api/v1/platform/agreement-suites'],
      ]) {
        const response = await call('llpOwner', method, url, method === 'GET' ? undefined : {});
        expect(response.statusCode, `${method} ${url}`).toBe(403);
      }
    });

    it('refuses an ordinary AGENT and an ADMIN by default (6)', async () => {
      for (const who of ['llpAgent', 'llpAdmin']) {
        const response = await call(who, 'GET', '/api/v1/sales/context');
        expect(response.statusCode, who).toBe(403);
        expect(response.json().error.code).toBe('SALES_ACCESS_REQUIRED');
        const prospects = await call(who, 'GET', '/api/v1/sales/prospects');
        expect(prospects.statusCode).toBe(403);
      }
      expect(
        await salesCapabilityFor({ userId: ids.llpAgent, tenantId: ids.llp, roles: ['AGENT'] })
      ).toBeNull();
      expect(
        await salesCapabilityFor({ userId: ids.llpOwner, tenantId: ids.llp, roles: ['OWNER'] })
      ).toMatchObject({ scope: 'TENANT', level: 'MANAGER', via: 'OWNER' });
    });

    it('does not give a child agency OWNER its parent’s workspace (11)', async () => {
      const response = await call('childOwner', 'GET', '/api/v1/sales/context');
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe('SALES_WORKSPACE_UNAVAILABLE');
      expect(await prisma.salesWorkspace.count({ where: { tenantId: ids.child } })).toBe(0);
      const normal = await call('normalOwner', 'GET', '/api/v1/sales/context');
      expect(normal.statusCode).toBe(403);
    });

    it('lets platform support enter a tenant only through the acting-tenant row', async () => {
      await enterActingTenant(ids.operator, ids.llp);
      const inside = await call('operator', 'GET', '/api/v1/sales/context');
      expect(inside.statusCode, inside.body).toBe(200);
      expect(inside.json().data.workspace.scope).toBe('TENANT');
      expect(inside.json().data.access.via).toBe('PLATFORM_SUPPORT');
      // A role preview is judged as the previewed role.
      await setPreviewRole(ids.operator, 'AGENT');
      expect((await call('operator', 'GET', '/api/v1/sales/context')).statusCode).toBe(403);
    });

    it('refuses an API key', async () => {
      const key = 'sales-suite-api-key-0123456789abcdef';
      await prisma.apiKey.create({
        data: {
          tenantId: ids.llp,
          name: 'sales suite',
          keyHash: createHash('sha256').update(key).digest('hex'),
          prefix: key.slice(0, 8),
          status: 'ACTIVE',
          scopes: [],
        },
      });
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/sales/context',
        headers: { 'x-api-key': key },
      });
      expect([401, 403]).toContain(response.statusCode);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Access grants
  // ════════════════════════════════════════════════════════════════════════
  describe('access grants', () => {
    it('lets the owner grant and revoke one same-tenant user, without changing their role (7, 8, 9)', async () => {
      const granted = await call('llpOwner', 'PUT', `/api/v1/sales/access/${ids.llpAgent}`, {
        level: 'MEMBER',
      });
      expect(granted.statusCode, granted.body).toBe(200);
      const ctx = await call('llpAgent', 'GET', '/api/v1/sales/context');
      expect(ctx.statusCode).toBe(200);
      expect(ctx.json().data.access).toEqual({ level: 'MEMBER', via: 'GRANT' });
      expect(ctx.json().data.workspace.name).toBe('Life Leads Plus');
      // The other agent is still refused: no role inherits access.
      expect((await call('llpAgent2', 'GET', '/api/v1/sales/context')).statusCode).toBe(403);
      // Their global role is unchanged.
      const roles = await prisma.userRole.findMany({
        where: { userId: ids.llpAgent },
        include: { role: true },
      });
      expect(roles.map(r => r.role.name)).toEqual(['AGENT']);
      // A MEMBER cannot manage grants or settings.
      expect(
        (
          await call('llpAgent', 'PUT', `/api/v1/sales/access/${ids.llpAgent2}`, {
            level: 'MEMBER',
          })
        ).statusCode
      ).toBe(403);
      expect(
        (await call('llpAgent', 'PUT', '/api/v1/sales/settings', { dbaName: 'x' })).statusCode
      ).toBe(403);
      // But can work the pipeline, in LLP only.
      const prospect = await createProspect('llpAgent');
      expect(prospect.workspaceId).toBe(
        (await prisma.salesWorkspace.findUniqueOrThrow({ where: { tenantId: ids.llp } })).id
      );

      const revoked = await call('llpOwner', 'DELETE', `/api/v1/sales/access/${ids.llpAgent}`);
      expect(revoked.statusCode, revoked.body).toBe(200);
      expect((await call('llpAgent', 'GET', '/api/v1/sales/context')).statusCode).toBe(403);
      expect(
        (await call('llpAgent', 'GET', `/api/v1/sales/prospects/${prospect.id}`)).statusCode
      ).toBe(403);

      const audits = await prisma.auditLog.findMany({
        where: { action: { startsWith: 'sales.access.' } },
      });
      expect(audits.map(a => a.action).sort()).toEqual([
        'sales.access.granted',
        'sales.access.revoked',
      ]);
      expect(audits.every(a => a.tenantId === ids.llp)).toBe(true);
    });

    it('a READONLY grant reads but cannot write', async () => {
      await call('llpOwner', 'PUT', `/api/v1/sales/access/${ids.llpAgent}`, { level: 'READONLY' });
      expect((await call('llpAgent', 'GET', '/api/v1/sales/prospects')).statusCode).toBe(200);
      const write = await call('llpAgent', 'POST', '/api/v1/sales/prospects', {
        type: 'OTHER',
        companyName: 'X',
      });
      expect(write.statusCode).toBe(403);
    });

    it('refuses to grant a user of another tenant, and the database refuses it too (10)', async () => {
      for (const other of ['wl2Owner', 'childOwner', 'operator']) {
        const response = await call('llpOwner', 'PUT', `/api/v1/sales/access/${ids[other]}`, {
          level: 'MEMBER',
        });
        expect(response.statusCode, other).toBe(404);
      }
      const ws = await (async () => {
        await call('llpOwner', 'GET', '/api/v1/sales/context');
        return prisma.salesWorkspace.findUniqueOrThrow({ where: { tenantId: ids.llp } });
      })();
      await expect(
        prisma.salesWorkspaceAccess.create({
          data: { workspaceId: ws.id, userId: ids.wl2Owner, level: 'MEMBER' },
        })
      ).rejects.toThrow(/not in the tenant/);
    });

    it('cannot lock the owner out', async () => {
      const response = await call('llpOwner', 'DELETE', `/api/v1/sales/access/${ids.llpOwner}`);
      expect(response.statusCode).toBe(422);
      expect((await call('llpOwner', 'GET', '/api/v1/sales/context')).statusCode).toBe(200);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Cross-workspace isolation
  // ════════════════════════════════════════════════════════════════════════
  describe('isolation', () => {
    it("never shows one workspace another's prospects, by list or by guessed id (12, 13)", async () => {
      const llpProspect = await createProspect('llpOwner', { companyName: 'LLP Only Agency' });
      const netProspect = await createProspect('operator', {
        companyName: 'NetEnroll Only Agency',
      });
      const missing = '00000000-0000-4000-8000-000000000000';
      for (const [who, foreign] of [
        ['wl2Owner', llpProspect.id],
        ['operator', llpProspect.id],
        ['llpOwner', netProspect.id],
      ]) {
        for (const [method, url, payload] of [
          ['GET', `/api/v1/sales/prospects/${foreign}`],
          ['PATCH', `/api/v1/sales/prospects/${foreign}`, { summary: 'x' }],
          ['POST', `/api/v1/sales/prospects/${foreign}/stage`, { stage: 'WON' }],
          ['POST', `/api/v1/sales/prospects/${foreign}/activities`, { type: 'NOTE', body: 'x' }],
          ['POST', `/api/v1/sales/prospects/${foreign}/archive`],
        ] as Array<[string, string, unknown?]>) {
          const response = await call(who, method, url, payload ?? {});
          const nothing = await call(who, method, url.replace(foreign, missing), payload ?? {});
          expect(response.statusCode, `${who} ${method} ${url}`).toBe(404);
          // Indistinguishable from an id that does not exist.
          expect(response.json()).toEqual(nothing.json());
        }
      }
      const wl2List = await call('wl2Owner', 'GET', '/api/v1/sales/prospects');
      expect(wl2List.json().data.items).toEqual([]);
      const netList = await call('operator', 'GET', '/api/v1/sales/prospects');
      expect(netList.json().data.items.map((p: any) => p.companyName)).toEqual([
        'NetEnroll Only Agency',
      ]);
      // Untouched.
      expect(
        (await prisma.salesProspect.findUniqueOrThrow({ where: { id: llpProspect.id } })).stage
      ).toBe('NEW');
    });

    it('ignores workspace ids smuggled in bodies, queries and headers (28)', async () => {
      await call('operator', 'GET', '/api/v1/sales/context');
      const platform = await prisma.salesWorkspace.findFirstOrThrow({
        where: { scopeType: 'PLATFORM' },
      });
      const created = await call(
        'llpOwner',
        'POST',
        `/api/v1/sales/prospects?workspaceId=${platform.id}`,
        {
          type: 'LICENSED_AGENT',
          firstName: 'Sam',
          lastName: 'Smuggle',
          workspaceId: platform.id,
          salesWorkspaceId: platform.id,
        },
        { 'x-sales-workspace-id': platform.id, 'x-tenant-id': ids.wl2 }
      );
      expect(created.statusCode, created.body).toBe(201);
      const llp = await prisma.salesWorkspace.findUniqueOrThrow({ where: { tenantId: ids.llp } });
      expect(created.json().data.workspaceId).toBe(llp.id);
      const list = await call(
        'llpOwner',
        'GET',
        `/api/v1/sales/prospects?workspaceId=${platform.id}&tenantId=${ids.wl2}`
      );
      expect(list.json().data.items.map((p: any) => p.lastName)).toEqual(['Smuggle']);
    });

    it('ignores Host, Origin and X-Forwarded-Host (29)', async () => {
      const netHost = {
        host: 'agents.netenroll.com',
        origin: 'https://agents.netenroll.com',
        'x-forwarded-host': 'agents.netenroll.com',
      };
      const llpHost = {
        host: ids.llpDomain,
        origin: `https://${ids.llpDomain}`,
        'x-forwarded-host': ids.llpDomain,
      };
      const llp = await call('llpOwner', 'GET', '/api/v1/sales/context', undefined, netHost);
      expect(llp.json().data.workspace.name).toBe('Life Leads Plus');
      const wl2 = await call('wl2Owner', 'GET', '/api/v1/sales/context', undefined, llpHost);
      expect(wl2.json().data.workspace.name).toBe('Other White Label');
      const agent = await call('llpAgent', 'GET', '/api/v1/sales/context', undefined, llpHost);
      expect(agent.statusCode).toBe(403);
      const op = await call('operator', 'GET', '/api/v1/sales/context', undefined, llpHost);
      expect(op.json().data.workspace.scope).toBe('PLATFORM');
    });

    it("never lets one workspace read or change another's settings (27)", async () => {
      await call('operator', 'GET', '/api/v1/sales/context');
      const before = await prisma.agreementSuite.findFirstOrThrow({
        where: { workspace: { scopeType: 'PLATFORM' } },
      });
      const put = await call('llpOwner', 'PUT', '/api/v1/sales/settings', {
        legalEntityName: 'Life Leads Plus LLC',
        noticeEmail: 'legal@lifeleadsplus.test',
      });
      expect(put.statusCode, put.body).toBe(200);
      expect(put.json().data.legalEntityName).toBe('Life Leads Plus LLC');
      const after = await prisma.agreementSuite.findUniqueOrThrow({ where: { id: before.id } });
      expect(after.noticeEmail).toBe(before.noticeEmail);
      expect(after.legalEntityName).toBe('PVN LLC');
      const netView = await call('operator', 'GET', '/api/v1/sales/settings');
      expect(netView.json().data.legalName).toBe('PVN LLC d/b/a NetEnroll');
      const wl2View = await call('wl2Owner', 'GET', '/api/v1/sales/settings');
      expect(wl2View.json().data.legalEntityName).toBeNull();
      // Platform-only fields are not writable by the owner.
      await call('llpOwner', 'PUT', '/api/v1/sales/settings', {
        templateSetKey: 'netenroll',
        sealSecretRef: 'DEFAULT',
        linkOrigin: 'https://evil.test',
        brandTheme: null,
      });
      const suite = await prisma.agreementSuite.findFirstOrThrow({
        where: { workspace: { tenantId: ids.llp } },
      });
      expect(suite.templateSetKey).toBe('life-leads-plus');
      expect(suite.sealSecretRef).toBeNull();
      expect(suite.linkOrigin).toBeNull();
      expect(suite.brandTheme).toBe('life-leads-plus');
    });

    it("refuses NetEnroll's template set or seal for a white-label suite at the platform API", async () => {
      await call('llpOwner', 'GET', '/api/v1/sales/context');
      const suite = await prisma.agreementSuite.findFirstOrThrow({
        where: { workspace: { tenantId: ids.llp } },
      });
      const net = await call('operator', 'PUT', `/api/v1/platform/agreement-suites/${suite.id}`, {
        templateSetKey: 'netenroll',
      });
      expect(net.statusCode).toBe(422);
      const seal = await call('operator', 'PUT', `/api/v1/platform/agreement-suites/${suite.id}`, {
        sealSecretRef: 'DEFAULT',
      });
      expect(seal.statusCode).toBe(422);
      const audits = await prisma.auditLog.count({
        where: { action: { startsWith: 'agreement_suite.' } },
      });
      expect(audits).toBe(0);
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // Agreements: NetEnroll unchanged, Life Leads Plus its own
  // ════════════════════════════════════════════════════════════════════════
  describe('agreements', () => {
    it('refuses LLP previews and sends until approved templates are installed', async () => {
      await configureSuiteSettingsOnly();
      const prospect = await createProspect('llpOwner');
      for (const url of ['/api/v1/sales/agreements/preview', '/api/v1/sales/agreements']) {
        const response = await call(
          'llpOwner',
          'POST',
          url,
          agreementBody({ salesProspectId: prospect.id })
        );
        expect(response.statusCode, url).toBe(409);
        expect(response.json().error.code).toBe('TEMPLATES_NOT_CONFIGURED');
        expect(response.json().error.message).toContain('Contract templates not configured');
      }
      expect(await prisma.agreementEnvelope.count()).toBe(0);
    });

    async function configureSuiteSettingsOnly() {
      const r = await call('llpOwner', 'PUT', '/api/v1/sales/settings', {
        legalEntityName: 'Life Leads Plus LLC',
        noticeAddress: '1 Issuer Way, Tampa, FL 33602',
        noticeEmail: 'contracts@lifeleadsplus.test',
      });
      expect(r.statusCode, r.body).toBe(200);
    }

    it('lets NetEnroll send from its Sales CRM, linked to its prospect (1, 2, 17, 18)', async () => {
      const prospect = await createProspect('operator', { companyName: 'Summit Ridge' });
      const response = await call('operator', 'POST', '/api/v1/platform/agreements', {
        ...agreementBody({ salesProspectId: prospect.id }),
        issuerSignatory: undefined,
        issuerAuthorityConfirmed: undefined,
        netenrollSignatory: { name: 'James Kelly', title: 'Managing Partner' },
        netenrollAuthorityConfirmed: true,
      });
      expect(response.statusCode, response.body).toBe(201);
      const data = response.json().data;
      expect(data.envelope.reference).toMatch(/^NE-/);
      expect(data.signUrl).toMatch(/^https:\/\/agents\.netenroll\.com\/sign\//);
      const envelope = await prisma.agreementEnvelope.findUniqueOrThrow({
        where: { id: data.envelope.id },
      });
      expect(envelope.salesProspectId).toBe(prospect.id);
      expect(envelope.netenrollSignatoryName).toBe('James Kelly');
      const events = await prisma.agreementEvent.findMany({
        where: { envelopeId: envelope.id },
        orderBy: { seq: 'asc' },
      });
      expect(events.map(e => e.type).slice(0, 2)).toEqual(['CREATED', 'NETENROLL_SIGNED']);
      const p = await prisma.salesProspect.findUniqueOrThrow({ where: { id: prospect.id } });
      expect(p.stage).toBe('AGREEMENT_SENT');
      expect((await activitiesOf(prospect.id)).map(a => a.type)).toEqual([
        'AGREEMENT_SENT',
        'STAGE_CHANGE',
      ]);
      // The NetEnroll email is NetEnroll's, unchanged.
      const invite = sendMail.mock.calls[0][0];
      expect(invite.subject).toBe(
        'Agreements from NetEnroll ready for your signature: ABC Insurance Agency'
      );
      expect(invite.text).toContain('PVN LLC d/b/a NetEnroll has prepared');
    });

    it('resolves a historic-style envelope written with no issuer columns (3)', async () => {
      const created = await call('operator', 'POST', '/api/v1/platform/agreements', {
        ...agreementBody(),
        issuerSignatory: undefined,
        netenrollSignatory: { name: 'James Kelly', title: 'Managing Partner' },
        netenrollAuthorityConfirmed: true,
      });
      expect(created.statusCode, created.body).toBe(201);
      const source = created.json().data.envelope.id;
      const legacyId = '11111111-1111-4111-8111-111111111111';
      const token = 'legacy-style-signing-token';
      // As the old code wrote it: no issuer columns, no issuer in the terms,
      // NetEnroll's signature only. The insert trigger attaches it to NetEnroll.
      await prisma.$executeRawUnsafe(`
        INSERT INTO "agreement_envelopes" ("id","reference","tenantId","status","includesMsa","includesCpa","includesCpl",
          "terms","signerName","signerTitle","signerEmail","ccEmails","netenrollSignatoryName","netenrollSignatoryTitle",
          "netenrollSignedByUserId","netenrollSignedAt","sentByUserId","sentAt","expiresAt","signTokenHash","updatedAt")
        SELECT '${legacyId}','NE-LEGACY01',NULL,'SENT',true,true,false,"terms" - 'issuer',"signerName","signerTitle",
          "signerEmail","ccEmails","netenrollSignatoryName","netenrollSignatoryTitle","netenrollSignedByUserId",
          "netenrollSignedAt","sentByUserId","sentAt","expiresAt",'${createHash('sha256').update(token).digest('hex')}',now()
        FROM "agreement_envelopes" WHERE "id" = '${source}'`);
      const legacy = await prisma.agreementEnvelope.findUniqueOrThrow({ where: { id: legacyId } });
      const platform = await prisma.salesWorkspace.findFirstOrThrow({
        where: { scopeType: 'PLATFORM' },
      });
      expect(legacy.salesWorkspaceId).toBe(platform.id);
      expect(legacy.issuerSignatoryName).toBeNull();
      const detail = await call('operator', 'GET', `/api/v1/platform/agreements/${legacyId}`);
      expect(detail.statusCode, detail.body).toBe(200);
      expect(detail.json().data.netenrollSignatoryName).toBe('James Kelly');
      const opened = await pub('GET', `/sign/${token}`);
      expect(opened.statusCode, opened.body).toBe(200);
      expect(opened.json().data.issuer.legalName).toBe('PVN LLC d/b/a NetEnroll');
      // The issuer of an envelope can never be moved.
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE "agreement_envelopes" SET "salesWorkspaceId" = gen_random_uuid()::text WHERE "id" = '${legacyId}'`
        )
      ).rejects.toThrow();
    });

    it('sends, signs and completes a Life Leads Plus agreement in its own brand, reflected on its prospect (17-21, 23, 24, 26)', async () => {
      await configureSuite('llpOwner', LLP_SET, 'Life Leads Plus LLC');
      // NetEnroll's seal is configured; it must never touch this document.
      process.env.AGREEMENT_SEAL_P12_BASE64 = 'bm90LWEtcmVhbC1wMTI=';
      process.env.AGREEMENT_SEAL_P12_PASSPHRASE = 'not-a-real-passphrase';
      try {
        const prospect = await createProspect('llpOwner');
        const preview = await call(
          'llpOwner',
          'POST',
          '/api/v1/sales/agreements/preview',
          agreementBody({ salesProspectId: prospect.id })
        );
        expect(preview.statusCode, preview.body).toBe(200);
        const previewHtml = preview.json().data.documents[0].html;
        expect(visibleText(previewHtml)).not.toMatch(/NetEnroll/i);
        expect(previewHtml).toContain('LIFE LEADS PLUS LLC');

        const sent = await call(
          'llpOwner',
          'POST',
          '/api/v1/sales/agreements',
          agreementBody({ salesProspectId: prospect.id })
        );
        expect(sent.statusCode, sent.body).toBe(201);
        const data = sent.json().data;
        expect(data.envelope.reference).toMatch(/^LLP-/);
        expect(data.signUrl.startsWith(`https://${ids.llpDomain}/sign/`)).toBe(true);
        const envelope = await prisma.agreementEnvelope.findUniqueOrThrow({
          where: { id: data.envelope.id },
          include: { documents: true },
        });
        expect(envelope.salesProspectId).toBe(prospect.id);
        expect(envelope.tenantId).toBeNull();
        expect(envelope.netenrollSignatoryName).toBeNull();
        expect(envelope.issuerSignatoryName).toBe('Pat Owner');
        for (const doc of envelope.documents)
          expect(visibleText(doc.sentHtml)).not.toMatch(/NetEnroll/i);
        const events = await prisma.agreementEvent.findMany({
          where: { envelopeId: envelope.id },
          orderBy: { seq: 'asc' },
        });
        expect(events[1].type).toBe('ISSUER_SIGNED');
        expect((events[1].detail as any).issuerLegalName).toBe('Life Leads Plus LLC');
        expect(events.some(e => e.type === 'NETENROLL_SIGNED')).toBe(false);
        const invite = sendMail.mock.calls[0][0];
        expect(invite.from).toBe('Life Leads Plus <noreply@netenroll.com>');
        expect(invite.subject).toBe(
          'Agreements from Life Leads Plus ready for your signature: ABC Insurance Agency'
        );
        expect(invite.text).not.toMatch(/NetEnroll/);
        expect(invite.html).toContain(`https://${ids.llpDomain}/sign/`);
        expect(invite.replyTo).toBe('contracts@llpowner.test');

        let p = await prisma.salesProspect.findUniqueOrThrow({ where: { id: prospect.id } });
        expect(p.stage).toBe('AGREEMENT_SENT');

        // Opened on NetEnroll's host: still Life Leads Plus.
        const token = String(data.signUrl).split('/sign/')[1];
        const opened = await pub('GET', `/sign/${token}`, undefined, {
          host: 'agents.netenroll.com',
        });
        expect(opened.json().data.issuer).toEqual({
          scope: 'TENANT',
          displayName: 'Life Leads Plus',
          shortName: 'Life Leads Plus',
          legalName: 'Life Leads Plus LLC',
          brandTheme: 'life-leads-plus',
        });
        p = await prisma.salesProspect.findUniqueOrThrow({ where: { id: prospect.id } });
        expect(p.stage).toBe('AGREEMENT_REVIEW');

        // OTP and disclosure in the issuer's name.
        await pub('POST', `/sign/${token}/otp`);
        const verified = await pub('POST', `/sign/${token}/verify`, {
          code: lastCode('Your Life Leads Plus verification code'),
        });
        expect(verified.statusCode, verified.body).toBe(200);
        const headers = { 'x-signing-session': verified.json().data.sessionToken };
        const before = (await pub('GET', `/sign/${token}/documents`, undefined, headers)).json()
          .data;
        expect(before.disclosure.version).toBe('ESIGN-ISSUER-2026-10-09');
        expect(before.disclosure.text).toContain('Life Leads Plus LLC ("Life Leads Plus")');
        expect(before.disclosure.text).not.toMatch(/NetEnroll/);
        await pub(
          'POST',
          `/sign/${token}/consent`,
          { accepted: true, disclosureVersion: before.disclosure.version },
          headers
        );
        const saved = await pub(
          'POST',
          `/sign/${token}/details`,
          {
            kind: 'INDIVIDUAL',
            legalName: 'Riley Agent',
            stateOfResidence: 'Florida',
            noticeAddress: '12 Ocean Ave, St. Augustine, FL 32084',
            noticeEmail: 'riley@abcagency.test',
            noticePhone: '(904) 555-0142',
            billingEmail: 'riley@abcagency.test',
            billingPhone: '(904) 555-0142',
          },
          headers
        );
        expect(saved.statusCode, saved.body).toBe(200);
        const docs = (await pub('GET', `/sign/${token}/documents`, undefined, headers)).json().data;
        for (const doc of docs.documents)
          await pub('POST', `/sign/${token}/reviewed`, { documentId: doc.id }, headers);
        const signed = await pub(
          'POST',
          `/sign/${token}/sign`,
          {
            typedName: 'Riley Agent',
            title: 'n/a',
            initials: 'RA',
            method: 'TYPED',
            acceptances: Object.fromEntries(docs.documents.map((d: any) => [d.id, true])),
            intentAccepted: true,
          },
          headers
        );
        expect(signed.statusCode, signed.body).toBe(200);

        const final = await prisma.agreementEnvelope.findUniqueOrThrow({
          where: { id: envelope.id },
        });
        p = await prisma.salesProspect.findUniqueOrThrow({ where: { id: prospect.id } });
        expect(p.stage).toBe('AGREEMENT_SIGNED');
        const types = (await activitiesOf(prospect.id)).map(a => a.type);
        expect(types).toContain('AGREEMENT_SENT');
        expect(types).toContain('AGREEMENT_VIEWED');
        expect(types).toContain('AGREEMENT_SIGNED');
        if (HAS_CHROME) {
          expect(final.status).toBe('COMPLETED');
          // Completed unsealed: NetEnroll's (configured) seal was not applied.
          expect(final.sealed).toBe(false);
          expect(types).toContain('AGREEMENT_COMPLETED');
          const completed = sendMail.mock.calls
            .map(c => c[0])
            .find(m => m.subject?.startsWith('Executed agreements'));
          expect(completed.subject).toContain('and Life Leads Plus');
          expect(completed.text).toContain(`https://${ids.llpDomain}/agreements/`);
        }
        // Signed does not mean won.
        expect(p.stage).not.toBe('WON');

        // The prospect page shows the agreement.
        const detail = await call('llpOwner', 'GET', `/api/v1/sales/prospects/${prospect.id}`);
        expect(detail.json().data.agreements.map((a: any) => a.reference)).toEqual([
          final.reference,
        ]);

        // NetEnroll's screens do not show it; another workspace cannot find it (14).
        const netList = await call('operator', 'GET', '/api/v1/platform/agreements');
        expect(netList.json().data.items.map((i: any) => i.id)).not.toContain(envelope.id);
        for (const [who, url] of [
          ['operator', `/api/v1/platform/agreements/${envelope.id}`],
          ['operator', `/api/v1/sales/agreements/${envelope.id}`],
          ['wl2Owner', `/api/v1/sales/agreements/${envelope.id}`],
          [
            'wl2Owner',
            `/api/v1/sales/agreements/${envelope.id}/documents/${envelope.documents[0].id}/sent.html`,
          ],
        ]) {
          const response = await call(who, 'GET', url);
          expect(response.statusCode, `${who} ${url}`).toBe(404);
        }
        expect(
          (
            await call('wl2Owner', 'POST', `/api/v1/sales/agreements/${envelope.id}/void`, {
              reason: 'x',
            })
          ).statusCode
        ).toBe(404);
        expect(
          (await call('llpOwner', 'GET', `/api/v1/sales/agreements/${envelope.id}`)).statusCode
        ).toBe(200);
      } finally {
        process.env.AGREEMENT_SEAL_P12_BASE64 = '';
        process.env.AGREEMENT_SEAL_P12_PASSPHRASE = '';
      }
    }, 180_000);

    it('records void, expiry and change requests without moving the stage, and never reopens WON (21, 22)', async () => {
      await configureSuite('llpOwner', LLP_SET, 'Life Leads Plus LLC');
      const prospect = await createProspect('llpOwner');
      const send = async () => {
        const r = await call(
          'llpOwner',
          'POST',
          '/api/v1/sales/agreements',
          agreementBody({ salesProspectId: prospect.id })
        );
        expect(r.statusCode, r.body).toBe(201);
        return {
          id: r.json().data.envelope.id as string,
          token: String(r.json().data.signUrl).split('/sign/')[1],
        };
      };
      const a = await send();
      const voided = await call('llpOwner', 'POST', `/api/v1/sales/agreements/${a.id}/void`, {
        reason: 'Wrong rate',
      });
      expect(voided.statusCode, voided.body).toBe(200);
      const b = await send();
      await prisma.agreementEnvelope.update({
        where: { id: b.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await call('llpOwner', 'GET', '/api/v1/sales/agreements');
      const c = await send();
      await pub('POST', `/sign/${c.token}/otp`);
      const v = await pub('POST', `/sign/${c.token}/verify`, {
        code: lastCode('Your Life Leads Plus verification code'),
      });
      const changes = await pub(
        'POST',
        `/sign/${c.token}/request-changes`,
        { note: 'Raise the daily block' },
        {
          'x-signing-session': v.json().data.sessionToken,
        }
      );
      expect(changes.statusCode, changes.body).toBe(200);
      const types = (await activitiesOf(prospect.id)).map(x => x.type);
      expect(types).toEqual(
        expect.arrayContaining(['AGREEMENT_VOIDED', 'AGREEMENT_EXPIRED', 'CHANGES_REQUESTED'])
      );
      expect(
        (await prisma.salesProspect.findUniqueOrThrow({ where: { id: prospect.id } })).stage
      ).toBe('AGREEMENT_SENT');

      // Marked WON by a person; a late view of a new envelope does not reopen it.
      const won = await call('llpOwner', 'POST', `/api/v1/sales/prospects/${prospect.id}/stage`, {
        stage: 'WON',
      });
      expect(won.statusCode, won.body).toBe(200);
      const d = await send();
      await pub('GET', `/sign/${d.token}`);
      expect(
        (await prisma.salesProspect.findUniqueOrThrow({ where: { id: prospect.id } })).stage
      ).toBe('WON');
      const lost = await call('llpOwner', 'POST', `/api/v1/sales/prospects/${prospect.id}/stage`, {
        stage: 'LOST',
      });
      expect(lost.statusCode).toBe(422);
    });

    it('refuses an existing MSA from another workspace exactly as an unknown one (15, 16)', async () => {
      await configureSuite('llpOwner', LLP_SET, 'Life Leads Plus LLC');
      await configureSuite('wl2Owner', GENERIC_SET, 'Other White Label LLC');
      const complete = async (id: string) =>
        prisma.agreementEnvelope.update({
          where: { id },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
      // A completed NetEnroll MSA for the very same signer.
      const net = await call('operator', 'POST', '/api/v1/platform/agreements', {
        ...agreementBody(),
        issuerSignatory: undefined,
        netenrollSignatory: { name: 'James Kelly', title: 'Managing Partner' },
        netenrollAuthorityConfirmed: true,
      });
      await complete(net.json().data.envelope.id);
      // A completed WL2 MSA for the same signer.
      const wl2 = await call('wl2Owner', 'POST', '/api/v1/sales/agreements', agreementBody());
      expect(wl2.statusCode, wl2.body).toBe(201);
      await complete(wl2.json().data.envelope.id);

      const attempt = (existing: string) =>
        call(
          'llpOwner',
          'POST',
          '/api/v1/sales/agreements',
          agreementBody({ existingMsaEnvelopeId: existing })
        );
      const unknown = await attempt('00000000-0000-4000-8000-000000000000');
      for (const foreign of [net.json().data.envelope.id, wl2.json().data.envelope.id]) {
        const response = await attempt(foreign);
        expect(response.statusCode).toBe(422);
        expect(response.json()).toEqual(unknown.json());
        expect(response.json().error.code).toBe('EXISTING_MSA_INVALID');
      }
      // Its own completed MSA is accepted.
      const own = await call('llpOwner', 'POST', '/api/v1/sales/agreements', agreementBody());
      await complete(own.json().data.envelope.id);
      const ok = await attempt(own.json().data.envelope.id);
      expect(ok.statusCode, ok.body).toBe(201);
    });

    it('refuses a prospect, suite or recipient agency from outside the workspace (28)', async () => {
      await configureSuite('llpOwner', LLP_SET, 'Life Leads Plus LLC');
      const netProspect = await createProspect('operator');
      await call('operator', 'GET', '/api/v1/sales/context');
      const platform = await prisma.salesWorkspace.findFirstOrThrow({
        where: { scopeType: 'PLATFORM' },
        include: { suite: true },
      });
      const foreignProspect = await call(
        'llpOwner',
        'POST',
        '/api/v1/sales/agreements',
        agreementBody({ salesProspectId: netProspect.id })
      );
      expect(foreignProspect.statusCode).toBe(404);
      const foreignTenant = await call(
        'llpOwner',
        'POST',
        '/api/v1/sales/agreements',
        agreementBody({ tenantId: ids.normal })
      );
      expect(foreignTenant.statusCode).toBe(422);
      // A downline agency of its own is fine.
      const downline = await call(
        'llpOwner',
        'POST',
        '/api/v1/sales/agreements',
        agreementBody({ tenantId: ids.child })
      );
      expect(downline.statusCode, downline.body).toBe(201);
      // Smuggled issuer ids are ignored: the envelope is LLP's.
      const smuggled = await call('llpOwner', 'POST', '/api/v1/sales/agreements', {
        ...agreementBody(),
        salesWorkspaceId: platform.id,
        agreementSuiteId: platform.suite!.id,
      });
      expect(smuggled.statusCode, smuggled.body).toBe(201);
      const row = await prisma.agreementEnvelope.findUniqueOrThrow({
        where: { id: smuggled.json().data.envelope.id },
      });
      expect(row.salesWorkspaceId).not.toBe(platform.id);
      expect(row.reference).toMatch(/^LLP-/);
      // And the database refuses a prospect of another workspace outright.
      await expect(
        prisma.agreementEnvelope.update({
          where: { id: row.id },
          data: { salesProspectId: netProspect.id },
        })
      ).rejects.toThrow(/not in the issuing workspace/);
    });

    it('keeps the NetEnroll public signing page NetEnroll-branded (25)', async () => {
      const created = await call('operator', 'POST', '/api/v1/platform/agreements', {
        ...agreementBody(),
        issuerSignatory: undefined,
        netenrollSignatory: { name: 'James Kelly', title: 'Managing Partner' },
        netenrollAuthorityConfirmed: true,
      });
      const token = String(created.json().data.signUrl).split('/sign/')[1];
      const opened = await pub('GET', `/sign/${token}`, undefined, { host: ids.llpDomain });
      expect(opened.json().data.issuer.brandTheme).toBeNull();
      expect(opened.json().data.issuer.legalName).toBe('PVN LLC d/b/a NetEnroll');
      await pub('POST', `/sign/${token}/otp`);
      const verified = await pub('POST', `/sign/${token}/verify`, {
        code: lastCode('Your NetEnroll verification code'),
      });
      const docs = await pub('GET', `/sign/${token}/documents`, undefined, {
        'x-signing-session': verified.json().data.sessionToken,
      });
      expect(docs.json().data.disclosure.version).toBe('ESIGN-2026-10-03');
    });
  });

  // ════════════════════════════════════════════════════════════════════════
  // The pipeline itself
  // ════════════════════════════════════════════════════════════════════════
  describe('pipeline', () => {
    it('tracks notes, calls, follow-ups, metrics and filters', async () => {
      const a = await createProspect('llpOwner', { companyName: 'Alpha Agency' });
      await createProspect('llpOwner', { companyName: 'Beta IMO', type: 'IMO_FMO' });
      const past = new Date(Date.now() - 2 * 86_400_000).toISOString();
      const note = await call('llpOwner', 'POST', `/api/v1/sales/prospects/${a.id}/activities`, {
        type: 'CALL',
        body: 'Spoke with the principal.',
        nextFollowUpAt: past,
      });
      expect(note.statusCode, note.body).toBe(201);
      const prospect = await prisma.salesProspect.findUniqueOrThrow({ where: { id: a.id } });
      expect(prospect.lastContactedAt).not.toBeNull();
      const overdue = await call('llpOwner', 'GET', '/api/v1/sales/prospects?followUp=overdue');
      expect(overdue.json().data.items.map((p: any) => p.companyName)).toEqual(['Alpha Agency']);
      expect(overdue.json().data.items[0].followUpState).toBe('OVERDUE');
      const imo = await call('llpOwner', 'GET', '/api/v1/sales/prospects?type=IMO_FMO');
      expect(imo.json().data.items.map((p: any) => p.companyName)).toEqual(['Beta IMO']);
      const search = await call('llpOwner', 'GET', '/api/v1/sales/prospects?q=alph');
      expect(search.json().data.total).toBe(1);
      const metrics = await call('llpOwner', 'GET', '/api/v1/sales/metrics');
      expect(metrics.json().data).toMatchObject({ openProspects: 2, overdueFollowUps: 1, won: 0 });
      // A future call cannot be recorded as having happened.
      const future = await call('llpOwner', 'POST', `/api/v1/sales/prospects/${a.id}/activities`, {
        type: 'CALL',
        body: 'x',
        occurredAt: new Date(Date.now() + 86_400_000).toISOString(),
      });
      expect(future.statusCode).toBe(422);
      // Assigning a user outside the workspace is refused.
      const assign = await call('llpOwner', 'PATCH', `/api/v1/sales/prospects/${a.id}`, {
        assignedUserId: ids.llpAgent,
      });
      expect(assign.statusCode).toBe(422);
      await call('llpOwner', 'PUT', `/api/v1/sales/access/${ids.llpAgent}`, { level: 'MEMBER' });
      const assigned = await call('llpOwner', 'PATCH', `/api/v1/sales/prospects/${a.id}`, {
        assignedUserId: ids.llpAgent,
      });
      expect(assigned.statusCode, assigned.body).toBe(200);
      const mine = await call('llpAgent', 'GET', '/api/v1/sales/prospects?assignedUserId=me');
      expect(mine.json().data.items.map((p: any) => p.id)).toEqual([a.id]);
      // Archive keeps the record and audits it.
      const archived = await call('llpOwner', 'POST', `/api/v1/sales/prospects/${a.id}/archive`);
      expect(archived.statusCode).toBe(200);
      expect((await call('llpOwner', 'GET', '/api/v1/sales/prospects')).json().data.total).toBe(1);
      expect(
        await prisma.auditLog.count({
          where: { action: 'sales.prospect.archived', tenantId: ids.llp },
        })
      ).toBe(1);
    });
  });
});
