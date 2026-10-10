/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { createHash } from 'crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

import { RoleName } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { grantPlatformAdmin } from '../lib/platform-admin.js';
import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { registerReadOnlyPreview } from '../middleware/read-only-preview.js';
import { registerStaffOnly } from '../middleware/staff-only.js';
import { recordEvent, verifyEventChain } from '../services/agreements/events.js';
import { chromeExecutable } from '../services/statements/statements.js';
import { resetAgreementsStorageService } from '../services/storage.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';
import { testPng } from './helpers/png.js';

/**
 * Electronic agreements, end to end against a real database.
 *
 *   access         every admin route refuses everybody but a platform admin
 *   create         the refusals: settings, campaign, existing MSA, terms
 *   immutability   the triggers refuse edits to the evidence rows
 *   chain          the event chain verifies, and names a tampered row
 *   signer flow    open → code → lockout → verify → consent → review → sign
 *   token states   voided / expired / changes requested / completed / twice
 *   download       hash check on every served PDF; the public verify lookup
 *
 * Completion needs headless Chrome. Where none is installed the signer flow
 * asserts the SIGNED + COMPLETION_FAILED path instead of COMPLETED.
 */

const sendMail = vi.fn<[message: any], Promise<{ accepted: string[] }>>();
vi.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail }),
  default: { createTransport: () => ({ sendMail }) },
}));

const gate = databaseGate();
announceSkip('Electronic agreements', gate);

const TEST_JWT_SECRET = 'agreements-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

const HAS_CHROME = Boolean(chromeExecutable());
/** Applied in order: tables, triggers and settings, then the agency-details columns. */
const MIGRATIONS = [
  '20261007000000_agreements',
  '20261008000000_agreements_party_details',
  '20261009000000_sales_workspaces',
].map(name => join(__dirname, `../../prisma/migrations/${name}/migration.sql`));

describe('Agreements suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `agreements suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('Electronic agreements', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;
  let storageDir: string;
  let operatorId: string;
  let ownerId: string;
  let agentId: string;
  let wlOwnerId: string;
  let tenantId: string;
  let wlTenantId: string;
  const API_KEY = 'agreements-suite-api-key-0123456789';
  let ipCounter = 0;
  /** A distinct public address per request, so per-IP limits do not cross tests. */
  const nextIp = () => `198.51.100.${(ipCounter++ % 250) + 1}`;

  const SAVED: Record<string, string | undefined> = {};
  const ENV = {
    SMTP_HOST: 'smtp.example.test',
    SMTP_USER: 'mailer',
    SMTP_PASSWORD: 'secret',
    SMTP_FROM: 'noreply@netenroll.com',
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
    await instance.ready();
    return instance;
  }

  const bearer = (userId: string, tid: string | null) => ({
    authorization: `Bearer ${app.jwt.sign({ userId, tenantId: tid, email: `${userId}@test.local` })}`,
  });
  const asAdmin = () => bearer(operatorId, null);

  function body(overrides: Record<string, any> = {}) {
    return {
      tenantId: tenantId,
      includesCpa: true,
      includesCpl: false,
      terms: {
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
      },
      recipient: {
        name: 'Dana Whitfield',
        email: 'Dana@SummitRidge.test',
        organization: 'Summit Ridge Insurance Group LLC',
      },
      ccEmails: ['ops@summitridge.test'],
      netenrollSignatory: { name: 'James Kelly', title: 'Managing Partner' },
      netenrollAuthorityConfirmed: true,
      ...overrides,
    };
  }

  async function create(overrides: Record<string, any> = {}) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/platform/agreements',
      headers: asAdmin(),
      payload: body(overrides),
    });
    expect(response.statusCode, response.body).toBe(201);
    const data = response.json().data;
    const token = String(data.signUrl).split('/sign/')[1];
    return { id: data.envelope.id as string, token, data };
  }

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

  function lastCode(): string {
    const messages = sendMail.mock.calls.map(c => c[0]);
    const otp = [...messages].reverse().find(m => m.subject === 'Your NetEnroll verification code');
    const match = /code is (\d{6})/.exec(otp?.text ?? '');
    if (!match) throw new Error('no code was emailed');
    return match[1];
  }

  async function verify(token: string): Promise<string> {
    const sent = await pub('POST', `/sign/${token}/otp`);
    expect(sent.statusCode, sent.body).toBe(200);
    const ok = await pub('POST', `/sign/${token}/verify`, { code: lastCode() });
    expect(ok.statusCode, ok.body).toBe(200);
    return ok.json().data.sessionToken;
  }

  /** What a business enters on the signing page. */
  const BUSINESS_PARTY = {
    kind: 'BUSINESS',
    legalName: 'Summit Ridge Insurance Group LLC',
    stateOfFormation: 'Colorado',
    entityType: 'Limited Liability Company',
    noticeAddress: '100 Main Street, Denver, CO 80202',
    principalName: 'Morgan Ridge',
    principalTitle: 'Managing Member',
    noticeEmail: 'dana@summitridge.test',
    noticePhone: '(303) 555-0142',
    billingEmail: 'billing@summitridge.test',
    billingPhone: '(303) 555-0199',
    signerName: 'Dana Whitfield',
    signerTitle: 'Operations Director',
  };

  /** What an individual licensed agent enters. */
  const INDIVIDUAL_PARTY = {
    kind: 'INDIVIDUAL',
    legalName: 'Dana Whitfield',
    dbaName: 'Whitfield Senior Benefits',
    stateOfResidence: 'Florida',
    noticeAddress: '12 Ocean Ave, St. Augustine, FL 32084',
    noticeEmail: 'dana@summitridge.test',
    noticePhone: '(904) 555-0142',
    billingEmail: 'dana@summitridge.test',
    billingPhone: '(904) 555-0142',
  };

  async function readyToSign(token: string, party: Record<string, unknown> = BUSINESS_PARTY) {
    const session = await verify(token);
    const headers = { 'x-signing-session': session };
    const before = (await pub('GET', `/sign/${token}/documents`, undefined, headers)).json().data;
    await pub(
      'POST',
      `/sign/${token}/consent`,
      { accepted: true, disclosureVersion: before.disclosure.version },
      headers
    );
    const saved = await pub('POST', `/sign/${token}/details`, party, headers);
    expect(saved.statusCode, saved.body).toBe(200);
    const docs = (await pub('GET', `/sign/${token}/documents`, undefined, headers)).json().data;
    for (const doc of docs.documents) {
      await pub('POST', `/sign/${token}/reviewed`, { documentId: doc.id }, headers);
    }
    return { headers, docs };
  }

  function signBody(docs: any, overrides: Record<string, any> = {}) {
    return {
      typedName: 'dana  whitfield',
      title: 'Managing Member',
      initials: 'dw',
      method: 'TYPED',
      acceptances: Object.fromEntries(docs.documents.map((d: any) => [d.id, true])),
      intentAccepted: true,
      ...overrides,
    };
  }

  async function events(envelopeId: string) {
    return prisma.agreementEvent.findMany({ where: { envelopeId }, orderBy: { seq: 'asc' } });
  }

  /** A COMPLETED envelope with a stored (fake) executed PDF, without Chrome. */
  async function fabricateCompleted(): Promise<{
    id: string;
    docId: string;
    downloadToken: string;
    sha: string;
    key: string;
  }> {
    const { id } = await create();
    const doc = await prisma.agreementDocument.findFirstOrThrow({
      where: { envelopeId: id, kind: 'CPA' },
    });
    const bytes = Buffer.from(`%PDF-1.7\n% fabricated executed copy ${id}\n%%EOF\n`);
    const sha = createHash('sha256').update(bytes).digest('hex');
    const docs = await prisma.agreementDocument.findMany({ where: { envelopeId: id } });
    for (const d of docs) {
      const content = d.id === doc.id ? bytes : Buffer.from(`%PDF-1.7\n% ${d.id}\n%%EOF\n`);
      const key = `agreements/${id}/${d.id}-executed.pdf`;
      mkdirSync(dirname(join(storageDir, key)), { recursive: true });
      writeFileSync(join(storageDir, key), content);
      await prisma.agreementDocument.update({
        where: { id: d.id },
        data: {
          executedPdfKey: key,
          executedPdfSha256: createHash('sha256').update(content).digest('hex'),
          executedPdfBytes: content.length,
        },
      });
    }
    const downloadToken = `download-${id}`;
    await prisma.agreementEnvelope.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        downloadTokenHash: createHash('sha256').update(downloadToken).digest('hex'),
        downloadTokenExpiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    return {
      id,
      docId: doc.id,
      downloadToken,
      sha,
      key: `agreements/${id}/${doc.id}-executed.pdf`,
    };
  }

  beforeAll(async () => {
    for (const [key, value] of Object.entries(ENV)) {
      SAVED[key] = process.env[key];
      process.env[key] = value;
    }
    SAVED.LOCAL_STORAGE_DIR = process.env.LOCAL_STORAGE_DIR;
    storageDir = mkdtempSync(join(tmpdir(), 'agreements-suite-'));
    process.env.LOCAL_STORAGE_DIR = storageDir;
    resetAgreementsStorageService();

    // The migration installs the triggers and seeds the settings; idempotent.
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
      'agreement_envelopes',
      'platform_admins',
      'audit_logs',
      'roles',
      'tenants',
      'users',
    ]) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`);
    }
    await prisma.agreementSettings.update({
      where: { id: 'default' },
      data: {
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
    const tenant = await prisma.tenant.create({
      data: { name: 'Summit Ridge', slug: `summit-${stamp}`, status: 'ACTIVE' },
    });
    tenantId = tenant.id;
    await prisma.agencyProfile.create({
      data: {
        tenantId,
        legalName: 'Summit Ridge Insurance Group LLC',
        state: 'CO',
        contactName: 'Dana Whitfield',
        contactEmail: 'dana@summitridge.test',
        contactPhone: '3035550142',
        licensedAgentCount: 4,
        deliveryDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
        deliveryStartTime: '10:00',
        deliveryEndTime: '19:00',
      },
    });
    const wl = await prisma.tenant.create({
      data: { name: 'Life Leads Plus', slug: `llp-${stamp}`, status: 'ACTIVE', whiteLabel: true },
    });
    wlTenantId = wl.id;
    const user = (email: string, tid: string | null, role?: string) =>
      prisma.user.create({
        data: {
          email,
          tenantId: tid,
          status: 'ACTIVE',
          ...(role ? { roles: { create: { roleId: roles[role] } } } : {}),
        },
      });
    ownerId = (await user(`owner-${stamp}@summit.test`, tenantId, RoleName.OWNER)).id;
    agentId = (await user(`agent-${stamp}@summit.test`, tenantId, RoleName.AGENT)).id;
    wlOwnerId = (await user(`owner-${stamp}@llp.test`, wlTenantId, RoleName.OWNER)).id;
    operatorId = (await user(`jimmy-${stamp}@netenroll.test`, null)).id;
    await grantPlatformAdmin(operatorId, { note: 'agreements suite' });
    await prisma.apiKey.create({
      data: {
        tenantId,
        name: 'agreements suite',
        keyHash: createHash('sha256').update(API_KEY).digest('hex'),
        prefix: API_KEY.slice(0, 8),
        status: 'ACTIVE',
        scopes: [],
      },
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 1. Access
  // ══════════════════════════════════════════════════════════════════════════
  describe('access: platform admins only', () => {
    const ID = '00000000-0000-4000-8000-000000000000';
    const ROUTES: Array<[string, string]> = [
      ['GET', '/api/v1/platform/agreements/settings'],
      ['PUT', '/api/v1/platform/agreements/settings'],
      ['GET', '/api/v1/platform/agreements/agencies'],
      ['POST', '/api/v1/platform/agreements/preview'],
      ['POST', '/api/v1/platform/agreements'],
      ['GET', '/api/v1/platform/agreements'],
      ['GET', `/api/v1/platform/agreements/${ID}`],
      ['GET', `/api/v1/platform/agreements/${ID}/documents/${ID}/sent.html`],
      ['GET', `/api/v1/platform/agreements/${ID}/documents/${ID}.pdf`],
      ['POST', `/api/v1/platform/agreements/${ID}/resend`],
      ['POST', `/api/v1/platform/agreements/${ID}/void`],
      ['POST', `/api/v1/platform/agreements/${ID}/send-copies`],
      ['POST', `/api/v1/platform/agreements/${ID}/complete`],
    ];

    it.each(ROUTES)('%s %s refuses everybody but a platform admin', async (method, url) => {
      const callers: Array<[string, Record<string, string>, number]> = [
        ['anonymous', {}, 401],
        ['agency OWNER', bearer(ownerId, tenantId), 403],
        ['white-label OWNER', bearer(wlOwnerId, wlTenantId), 403],
        ['AGENT', bearer(agentId, tenantId), 403],
        ['API key', { 'x-api-key': API_KEY }, 403],
      ];
      for (const [who, headers, expected] of callers) {
        const response = await app.inject({
          method: method as any,
          url,
          headers,
          payload: method === 'GET' ? undefined : {},
        });
        expect(response.statusCode, `${who} on ${method} ${url}: ${response.body}`).toBe(expected);
      }
      const admin = await app.inject({
        method: method as any,
        url,
        headers: asAdmin(),
        payload: method === 'GET' ? undefined : {},
      });
      expect([401, 403]).not.toContain(admin.statusCode);
    });

    it('serves a platform admin 200 on the collection routes', async () => {
      for (const url of [
        '/api/v1/platform/agreements/settings',
        '/api/v1/platform/agreements/agencies',
        '/api/v1/platform/agreements',
      ]) {
        const response = await app.inject({ method: 'GET', url, headers: asAdmin() });
        expect(response.statusCode, url).toBe(200);
      }
      const preview = await app.inject({
        method: 'POST',
        url: '/api/v1/platform/agreements/preview',
        headers: asAdmin(),
        payload: body(),
      });
      expect(preview.statusCode, preview.body).toBe(200);
      const docs = preview.json().data.documents;
      expect(docs.map((d: any) => d.kind)).toEqual(['MSA', 'CPA']);
      expect(docs[0].html).toContain('Applied at send');
    });

    it('prefills from the agency profile', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/platform/agreements/agencies?q=summit',
        headers: asAdmin(),
      });
      const [agency] = response.json().data;
      expect(agency).toMatchObject({
        id: tenantId,
        legalName: 'Summit Ridge Insurance Group LLC',
        executedMsa: null,
      });
    });

    it('lets an anonymous POST reach the public routes: no CSRF, no session cookie', async () => {
      for (const url of [
        '/sign/not-a-token/otp',
        '/sign/not-a-token/verify',
        '/sign/not-a-token/sign',
      ]) {
        const response = await pub('POST', url, { code: '123456' });
        expect(response.statusCode, url).toBe(404);
        expect(response.json().error.message).toBe('This signing link is not valid.');
      }
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 3. Create
  // ══════════════════════════════════════════════════════════════════════════
  describe('create: what is refused', () => {
    const post = (payload: unknown) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/platform/agreements',
        headers: asAdmin(),
        payload: payload as any,
      });

    it('refuses while a settings field is empty, naming it', async () => {
      await prisma.agreementSettings.update({
        where: { id: 'default' },
        data: { netenrollNoticeEmail: null },
      });
      const response = await post(body());
      expect(response.statusCode).toBe(422);
      expect(response.json().error.message).toContain("NetEnroll's notice email");
    });

    it('refuses with no campaign agreement', async () => {
      const response = await post(body({ includesCpa: false, includesCpl: false }));
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe('NO_CAMPAIGN_AGREEMENT');
    });

    it('refuses without the authority confirmation', async () => {
      const response = await post(body({ netenrollAuthorityConfirmed: false }));
      expect(response.statusCode).toBe(422);
    });

    it('refuses a CPL buffer outside 1–3600 seconds', async () => {
      const cpl = {
        verticals: {
          FE: { selected: true, rate: 45, bufferSeconds: 3601, dailyBlock: 10 },
          MEDICARE: { selected: false },
          ACA: { selected: false },
        },
        deliveryDays: ['MON'],
        deliveryStart: '10:00',
        deliveryEnd: '19:00',
        firstDeliveryDay: null,
      };
      const b = body({ includesCpl: true });
      const response = await post({ ...b, terms: { ...b.terms, cpl } });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.message).toContain('Buffer Duration');
    });

    it('refuses an existing MSA that is not completed, or belongs to another agency', async () => {
      const { id } = await create();
      const notDone = await post(body({ existingMsaEnvelopeId: id }));
      expect(notDone.statusCode).toBe(422);
      expect(notDone.json().error.code).toBe('EXISTING_MSA_INVALID');

      const done = await fabricateCompleted();
      const mismatch = await post(
        body({
          existingMsaEnvelopeId: done.id,
          tenantId: null,
          recipient: { name: 'Someone Else', email: 'someone@another.test' },
        })
      );
      expect(mismatch.statusCode).toBe(422);
      expect(mismatch.json().error.code).toBe('EXISTING_MSA_MISMATCH');
    });

    it('sends campaign agreements only, citing the existing MSA date, when the MSA exists', async () => {
      const done = await fabricateCompleted();
      const b = body({ existingMsaEnvelopeId: done.id });
      const response = await post({ ...b, terms: { ...b.terms, effectiveDate: '2026-11-01' } });
      expect(response.statusCode, response.body).toBe(201);
      const envelope = await prisma.agreementEnvelope.findUniqueOrThrow({
        where: { id: response.json().data.envelope.id },
        include: { documents: true },
      });
      expect(envelope.includesMsa).toBe(false);
      expect(envelope.documents.map(d => d.kind)).toEqual(['CPA']);
      expect((envelope.terms as any).msaEffectiveDate).toBe('2026-10-03');
    });

    it('creates, signs for NetEnroll, emails the link and audits it', async () => {
      const { id, data } = await create();
      expect(data.emailSent).toBe(true);
      const invite = sendMail.mock.calls[0][0];
      expect(invite.subject).toBe(
        'Agreements from NetEnroll ready for your signature: Summit Ridge Insurance Group LLC'
      );
      expect(invite.replyTo).toBe('support@pvnvoice.com');
      expect(invite.html).toContain(data.signUrl);
      const envelope = await prisma.agreementEnvelope.findUniqueOrThrow({
        where: { id },
        include: { documents: true },
      });
      expect(envelope.reference).toMatch(/^NE-[A-HJ-NP-Z2-9]{8}$/);
      expect(envelope.signerEmail).toBe('dana@summitridge.test');
      expect(envelope.signTokenEnc).toMatch(/^enc:v1:/);
      for (const doc of envelope.documents) {
        expect(doc.sentHtmlSha256).toBe(createHash('sha256').update(doc.sentHtml).digest('hex'));
      }
      expect((await events(id)).map(e => e.type)).toEqual(['CREATED', 'NETENROLL_SIGNED', 'SENT']);
      expect(await prisma.auditLog.count({ where: { action: 'agreements.sent', tenantId } })).toBe(
        1
      );
    });

    it('records EMAIL_NOT_SENT and still returns the link when SMTP is down', async () => {
      sendMail.mockRejectedValue(new Error('smtp down'));
      const { id, data } = await create();
      expect(data.emailSent).toBe(false);
      expect(data.signUrl).toMatch(/^https:\/\/agents\.netenroll\.com\/sign\//);
      expect((await events(id)).map(e => e.type)).toContain('EMAIL_NOT_SENT');
    });

    it('resends the same link, never a new one', async () => {
      const { id, data } = await create();
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/platform/agreements/${id}/resend`,
        headers: asAdmin(),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().data.signUrl).toBe(data.signUrl);
      expect((await events(id)).map(e => e.type)).toContain('RESENT');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 4–5. Immutability and the chain
  // ══════════════════════════════════════════════════════════════════════════
  describe('immutability triggers', () => {
    it('refuses UPDATE and DELETE on agreement_events', async () => {
      const { id } = await create();
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE "agreement_events" SET "ipAddress" = '1.1.1.1' WHERE "envelopeId" = '${id}'`
        )
      ).rejects.toThrow(/append-only/);
      await expect(
        prisma.$executeRawUnsafe(`DELETE FROM "agreement_events" WHERE "envelopeId" = '${id}'`)
      ).rejects.toThrow(/append-only/);
    });

    it('refuses an UPDATE of the as-sent document', async () => {
      const { id } = await create();
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE "agreement_documents" SET "sentHtml" = 'x' WHERE "envelopeId" = '${id}'`
        )
      ).rejects.toThrow(/cannot be changed/);
    });

    it('refuses changing an executed PDF key once set', async () => {
      const { id } = await create();
      await prisma.$executeRawUnsafe(
        `UPDATE "agreement_documents" SET "executedPdfKey" = 'k1' WHERE "envelopeId" = '${id}'`
      );
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE "agreement_documents" SET "executedPdfKey" = 'k2' WHERE "envelopeId" = '${id}'`
        )
      ).rejects.toThrow(/cannot be changed/);
    });

    it('refuses an UPDATE of terms, signer email or sign token hash', async () => {
      const { id } = await create();
      for (const set of [
        `"terms" = '{}'::jsonb`,
        `"signerEmail" = 'x@y.z'`,
        `"signTokenHash" = 'x'`,
      ]) {
        await expect(
          prisma.$executeRawUnsafe(`UPDATE "agreement_envelopes" SET ${set} WHERE "id" = '${id}'`)
        ).rejects.toThrow(/agreement_envelopes/);
      }
    });
  });

  describe('the event chain', () => {
    it('verifies ten appended events, and names the seq of a tampered row', async () => {
      const { id } = await create();
      for (let i = 0; i < 10; i += 1) {
        await recordEvent(id, {
          type: 'LINK_OPENED',
          actorType: 'SIGNER',
          ipAddress: '203.0.113.9',
          detail: { i },
        });
      }
      const ok = await verifyEventChain(id);
      expect(ok).toMatchObject({ ok: true, count: 13 });

      await prisma.$executeRawUnsafe(
        `ALTER TABLE "agreement_events" DISABLE TRIGGER "agreement_events_append_only"`
      );
      try {
        await prisma.$executeRawUnsafe(
          `UPDATE "agreement_events" SET "ipAddress" = '198.51.100.66' WHERE "envelopeId" = '${id}' AND "seq" = 7`
        );
      } finally {
        await prisma.$executeRawUnsafe(
          `ALTER TABLE "agreement_events" ENABLE TRIGGER "agreement_events_append_only"`
        );
      }
      expect(await verifyEventChain(id)).toMatchObject({ ok: false, brokenSeq: 7 });

      const detail = await app.inject({
        method: 'GET',
        url: `/api/v1/platform/agreements/${id}`,
        headers: asAdmin(),
      });
      expect(detail.json().data).toMatchObject({ chainValid: false, chainBrokenAt: 7 });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 6. The signer
  // ══════════════════════════════════════════════════════════════════════════
  describe('the signer flow', () => {
    it('sends an offer with the agency fields to be completed, and completes it with what the agency enters', async () => {
      const { id, token } = await create();
      const offer = await prisma.agreementDocument.findMany({
        where: { envelopeId: id },
        orderBy: { sortOrder: 'asc' },
      });
      for (const doc of offer) {
        expect(doc.sentHtml).toContain('To be completed by Agency');
        expect(doc.sentHtml).not.toContain('Morgan Ridge');
        expect(doc.presentedHtml).toBeNull();
      }
      await readyToSign(token, BUSINESS_PARTY);
      const envelope = await prisma.agreementEnvelope.findUniqueOrThrow({
        where: { id },
        include: { documents: { orderBy: { sortOrder: 'asc' } } },
      });
      expect(envelope.signerName).toBe('Dana Whitfield');
      expect(envelope.signerTitle).toBe('Operations Director');
      expect(envelope.partySubmittedAt).not.toBeNull();
      for (const [i, doc] of envelope.documents.entries()) {
        // The offer is untouched; the completed version is what is reviewed.
        expect(doc.sentHtml).toBe(offer[i].sentHtml);
        expect(doc.presentedHtml).not.toContain('To be completed by Agency');
        expect(doc.presentedHtml).toContain('Summit Ridge Insurance Group LLC');
        expect(doc.presentedHtml).toContain('Colorado / Limited Liability Company');
        expect(doc.presentedHtml).toContain('Morgan Ridge, Managing Member');
        expect(doc.presentedHtmlSha256).toBe(
          createHash('sha256').update(doc.presentedHtml!).digest('hex')
        );
      }
      expect(envelope.documents[0].presentedHtml).toContain('100 Main Street, Denver, CO 80202');
      expect(envelope.documents[1].presentedHtml).toContain(
        'billing@summitridge.test · (303) 555-0199'
      );
      const submitted = (await events(id)).find(e => e.type === 'PARTY_DETAILS_SUBMITTED')!;
      expect((submitted.detail as any).party.legalName).toBe('Summit Ridge Insurance Group LLC');
      expect((submitted.detail as any).documents.map((d: any) => d.presentedHtmlSha256)).toEqual(
        envelope.documents.map(d => d.presentedHtmlSha256)
      );
      expect(await verifyEventChain(id)).toMatchObject({ ok: true });

      // Once only, and the database holds it there.
      const session = await verify(token);
      const again = await pub('POST', `/sign/${token}/details`, INDIVIDUAL_PARTY, {
        'x-signing-session': session,
      });
      expect(again.statusCode).toBe(409);
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE "agreement_envelopes" SET "partyDetails" = '{}'::jsonb WHERE "id" = '${id}'`
        )
      ).rejects.toThrow(/agency details/);
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE "agreement_documents" SET "presentedHtml" = 'x' WHERE "envelopeId" = '${id}'`
        )
      ).rejects.toThrow(/as-presented/);
    });

    it('asks an individual agent for no entity or principal, and has them sign individually', async () => {
      const { id, token } = await create();
      const { headers, docs } = await readyToSign(token, INDIVIDUAL_PARTY);
      expect(docs.individual).toBe(true);
      expect(docs.intentStatement).toBe(
        'By selecting Sign Agreements, I, Dana Whitfield, adopt the signature and initials shown above as my electronic signature and initials, intend to sign and be legally bound by the Master Services Agreement and the CPA Agreement, and confirm that I am signing on my own behalf as an individual.'
      );
      for (const doc of docs.documents) {
        expect(doc.html).toContain('Dana Whitfield d/b/a Whitfield Senior Benefits');
        expect(doc.html).toContain('Florida / Individual (sole proprietor)');
        expect(doc.html).not.toContain('PRINCIPAL NAME &amp; TITLE');
      }
      const envelope = await prisma.agreementEnvelope.findUniqueOrThrow({ where: { id } });
      expect(envelope.signerTitle).toBe('Individually');
      // Whatever title is sent, an individual signs "Individually".
      await pub('POST', `/sign/${token}/sign`, signBody(docs, { title: 'CEO' }), headers);
      const signed = (await events(id)).find(e => e.type === 'SIGNED')!;
      expect((signed.detail as any).title).toBe('Individually');
      expect((signed.detail as any).documentHashes).toEqual(
        Object.fromEntries(
          (await prisma.agreementDocument.findMany({ where: { envelopeId: id } })).map(d => [
            d.id,
            d.presentedHtmlSha256,
          ])
        )
      );
    }, 120_000);

    it('shows nothing but the summary before verification', async () => {
      const { token } = await create();
      const response = await pub('GET', `/sign/${token}`);
      expect(response.statusCode).toBe(200);
      const data = response.json().data;
      expect(Object.keys(data).sort()).toEqual([
        'agencyLegalName',
        'documents',
        'expiresAt',
        // The issuer's public names and brand, so the summary page is drawn in
        // the issuer's brand whatever host it is opened on. Nothing else.
        'issuer',
        'signerEmailMasked',
        'status',
      ]);
      expect(data.issuer).toEqual({
        scope: 'PLATFORM',
        displayName: 'NetEnroll',
        shortName: 'NetEnroll',
        legalName: 'PVN LLC d/b/a NetEnroll',
        brandTheme: null,
      });
      expect(data.signerEmailMasked).toBe('d***@summitridge.test');
      expect(data.documents).toEqual([
        { title: 'Master Services Agreement' },
        { title: 'CPA Agreement' },
      ]);
      const docs = await pub('GET', `/sign/${token}/documents`);
      expect(docs.statusCode).toBe(401);
    });

    it('locks a code after five wrong attempts, then verifies a new one', async () => {
      const { id, token } = await create();
      await pub('GET', `/sign/${token}`);
      await pub('POST', `/sign/${token}/otp`);
      const code = lastCode();
      const wrong = code === '000000' ? '111111' : '000000';
      const statuses: number[] = [];
      for (let i = 0; i < 5; i += 1)
        statuses.push((await pub('POST', `/sign/${token}/verify`, { code: wrong })).statusCode);
      expect(statuses).toEqual([400, 400, 400, 400, 423]);
      // The right code no longer works once locked.
      expect((await pub('POST', `/sign/${token}/verify`, { code })).statusCode).toBe(423);
      const types = (await events(id)).map(e => e.type);
      expect(types.filter(t => t === 'OTP_FAILED')).toHaveLength(5);
      expect(types).toContain('OTP_LOCKED');
      // Codes are never logged.
      for (const e of await events(id)) expect(JSON.stringify(e.detail)).not.toContain(code);

      const session = await verify(token);
      expect(session).toBeTruthy();
      expect((await events(id)).map(e => e.type)).toContain('OTP_VERIFIED');
    });

    it('allows five codes an hour', async () => {
      const { token } = await create();
      const statuses: number[] = [];
      for (let i = 0; i < 6; i += 1)
        statuses.push((await pub('POST', `/sign/${token}/otp`)).statusCode);
      expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    });

    it('refuses to sign without consent, without every review, or under another name', async () => {
      const { token } = await create();
      const session = await verify(token);
      const headers = { 'x-signing-session': session };
      const pending = (await pub('GET', `/sign/${token}/documents`, undefined, headers)).json()
        .data;
      // Nothing to review until the agency has entered its details.
      expect(pending.partyRequired).toBe(true);
      expect(pending.documents).toEqual([]);

      let response = await pub('POST', `/sign/${token}/sign`, signBody(pending), headers);
      expect(response.statusCode).toBe(422);
      expect(response.json().error.message).toContain('disclosure');
      // Details come after consent.
      response = await pub('POST', `/sign/${token}/details`, BUSINESS_PARTY, headers);
      expect(response.statusCode).toBe(422);

      await pub(
        'POST',
        `/sign/${token}/consent`,
        { accepted: true, disclosureVersion: 'ESIGN-2026-10-03' },
        headers
      );
      response = await pub('POST', `/sign/${token}/sign`, signBody(pending), headers);
      expect(response.statusCode).toBe(422);
      expect(response.json().error.message).toContain('Enter your details');
      expect(
        (await pub('POST', `/sign/${token}/details`, { kind: 'BUSINESS' }, headers)).statusCode
      ).toBe(422);
      expect(
        (await pub('POST', `/sign/${token}/details`, BUSINESS_PARTY, headers)).statusCode
      ).toBe(200);

      const docs = (await pub('GET', `/sign/${token}/documents`, undefined, headers)).json().data;
      expect(docs.partyRequired).toBe(false);
      expect(docs.documents[0].html).toContain('Master Services Agreement');
      expect(docs.intentStatement).toBe(
        'By selecting Sign Agreements, I, Dana Whitfield, adopt the signature and initials shown above as my electronic signature and initials, intend to sign and be legally bound by the Master Services Agreement and the CPA Agreement, and confirm that I am authorized to sign on behalf of Summit Ridge Insurance Group LLC.'
      );

      await pub('POST', `/sign/${token}/reviewed`, { documentId: docs.documents[0].id }, headers);
      response = await pub('POST', `/sign/${token}/sign`, signBody(docs), headers);
      expect(response.statusCode).toBe(422);
      expect(response.json().error.message).toContain('CPA Agreement');

      await pub('POST', `/sign/${token}/reviewed`, { documentId: docs.documents[1].id }, headers);
      response = await pub(
        'POST',
        `/sign/${token}/sign`,
        signBody(docs, { typedName: 'Somebody Else' }),
        headers
      );
      expect(response.statusCode).toBe(422);
      expect(response.json().error.message).toContain('Dana Whitfield');

      response = await pub(
        'POST',
        `/sign/${token}/sign`,
        signBody(docs, { acceptances: {} }),
        headers
      );
      expect(response.statusCode).toBe(422);
      response = await pub(
        'POST',
        `/sign/${token}/sign`,
        signBody(docs, { initials: 'D1' }),
        headers
      );
      expect(response.statusCode).toBe(422);
      response = await pub(
        'POST',
        `/sign/${token}/sign`,
        signBody(docs, { method: 'DRAWN', drawnPng: testPng(1300, 100).toString('base64') }),
        headers
      );
      expect(response.statusCode).toBe(422);
    });

    it('signs, and completes (or records COMPLETION_FAILED and completes on retry)', async () => {
      const { id, token } = await create();
      const { headers, docs } = await readyToSign(token);
      const documents = await prisma.agreementDocument.findMany({
        where: { envelopeId: id },
        orderBy: { sortOrder: 'asc' },
      });

      // Block completion: an object already sits where the first executed PDF
      // would be written, and objects are never overwritten.
      const blocker = join(storageDir, `agreements/${id}/${documents[0].id}-executed.pdf`);
      mkdirSync(dirname(blocker), { recursive: true });
      writeFileSync(blocker, 'in the way');

      const signed = await pub(
        'POST',
        `/sign/${token}/sign`,
        signBody(docs, { method: 'DRAWN', drawnPng: testPng(600, 200).toString('base64') }),
        headers
      );
      expect(signed.statusCode, signed.body).toBe(200);
      expect(signed.json().data).toMatchObject({
        status: 'SIGNED',
        message: 'Your signature is recorded. Your executed copies will be emailed to you shortly.',
      });
      let envelope = await prisma.agreementEnvelope.findUniqueOrThrow({ where: { id } });
      expect(envelope.status).toBe('SIGNED');
      expect(envelope.signerInitials).toBe('DW');
      expect(envelope.signatureMethod).toBe('DRAWN');
      expect(existsSync(join(storageDir, `agreements/${id}/signature.png`))).toBe(true);
      const types = (await events(id)).map(e => e.type);
      expect(types).toContain('SIGNED');
      expect(types).toContain('COMPLETION_FAILED');
      const signedEvent = (await events(id)).find(e => e.type === 'SIGNED')!;
      expect((signedEvent.detail as any).documentHashes).toEqual(
        Object.fromEntries(documents.map(d => [d.id, d.presentedHtmlSha256]))
      );
      expect((signedEvent.detail as any).acceptanceStatements[documents[1].id]).toBe(
        'I have read and agree to the CPA Agreement.'
      );
      expect(
        sendMail.mock.calls.some(c => String(c[0].subject).startsWith('Completion failed'))
      ).toBe(true);

      // The token cannot sign a second time.
      const again = await pub('POST', `/sign/${token}/sign`, signBody(docs), headers);
      expect(again.json().data).toEqual({ status: 'SIGNED' });
      expect((await events(id)).filter(e => e.type === 'SIGNED')).toHaveLength(1);

      rmSync(blocker);
      const retry = await app.inject({
        method: 'POST',
        url: `/api/v1/platform/agreements/${id}/complete`,
        headers: asAdmin(),
      });
      envelope = await prisma.agreementEnvelope.findUniqueOrThrow({ where: { id } });
      if (!HAS_CHROME) {
        expect(retry.statusCode).toBe(500);
        expect(envelope.status).toBe('SIGNED');
        return;
      }
      expect(retry.statusCode, retry.body).toBe(200);
      expect(envelope.status).toBe('COMPLETED');
      expect(envelope.sealed).toBe(false);
      const finalDocs = await prisma.agreementDocument.findMany({
        where: { envelopeId: id },
        orderBy: { sortOrder: 'asc' },
      });
      for (const doc of finalDocs) {
        const bytes = readFileSync(join(storageDir, doc.executedPdfKey!));
        expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(doc.executedPdfSha256);
        expect(doc.pageCount).toBeGreaterThan(0);
      }
      const completedEvent = (await events(id)).find(e => e.type === 'COMPLETED')!;
      expect((completedEvent.detail as any).documents.map((d: any) => d.executedPdfSha256)).toEqual(
        finalDocs.map(d => d.executedPdfSha256)
      );
      const completedMail = sendMail.mock.calls
        .map(c => c[0])
        .find(m => String(m.subject).startsWith('Executed agreements'));
      expect(completedMail.attachments).toHaveLength(2);
      expect(completedMail.cc).toEqual(['ops@summitridge.test']);
      expect(await verifyEventChain(id)).toMatchObject({ ok: true });

      // Idempotent.
      const twice = await app.inject({
        method: 'POST',
        url: `/api/v1/platform/agreements/${id}/complete`,
        headers: asAdmin(),
      });
      expect(twice.json().data).toMatchObject({ status: 'COMPLETED', alreadyCompleted: true });

      // The public verify page finds it by hash.
      const match = await pub('GET', `/verify?sha256=${finalDocs[0].executedPdfSha256}`);
      expect(match.json().data).toMatchObject({
        match: true,
        documentTitle: 'Master Services Agreement',
        sealed: false,
      });
    }, 120_000);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 7. Token states
  // ══════════════════════════════════════════════════════════════════════════
  describe('token states', () => {
    it('answers 410 for a voided link, with the notice email', async () => {
      const { id, token } = await create();
      const voided = await app.inject({
        method: 'POST',
        url: `/api/v1/platform/agreements/${id}/void`,
        headers: asAdmin(),
        payload: { reason: 'Wrong rate' },
      });
      expect(voided.statusCode).toBe(200);
      const notice = sendMail.mock.calls
        .map(c => c[0])
        .find(m => String(m.subject).startsWith('Agreements withdrawn'));
      expect(notice.text).not.toContain('Wrong rate');
      const response = await pub('GET', `/sign/${token}`);
      expect(response.statusCode).toBe(410);
      expect(response.json().error).toMatchObject({
        status: 'VOIDED',
        noticeEmail: 'support@pvnvoice.com',
      });
    });

    it('expires a link past its date, with an EXPIRED event', async () => {
      const { id, token } = await create();
      await prisma.agreementEnvelope.update({
        where: { id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const response = await pub('POST', `/sign/${token}/otp`);
      expect(response.statusCode).toBe(410);
      expect(response.json().error.status).toBe('EXPIRED');
      expect((await events(id)).map(e => e.type)).toContain('EXPIRED');
    });

    it('stops the link once changes are requested, and tells NetEnroll', async () => {
      const { token } = await create();
      const session = await verify(token);
      const response = await pub(
        'POST',
        `/sign/${token}/request-changes`,
        { note: 'Medicare rate should be $150' },
        { 'x-signing-session': session }
      );
      expect(response.statusCode).toBe(200);
      const alert = sendMail.mock.calls
        .map(c => c[0])
        .find(m => String(m.subject).startsWith('Changes requested'));
      expect(alert.text).toContain('Medicare rate should be $150');
      expect((await pub('GET', `/sign/${token}`)).statusCode).toBe(410);
    });

    it('answers a completed envelope with its status and nothing else', async () => {
      const done = await fabricateCompleted();
      const envelope = await prisma.agreementEnvelope.findUniqueOrThrow({ where: { id: done.id } });
      const { decryptField } = await import('../lib/field-encryption.js');
      const token = decryptField(envelope.signTokenEnc)!;
      const response = await pub('GET', `/sign/${token}`);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ data: { status: 'COMPLETED' } });
    });

    it('refuses to void a completed agreement', async () => {
      const done = await fabricateCompleted();
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/platform/agreements/${done.id}/void`,
        headers: asAdmin(),
        payload: { reason: 'x' },
      });
      expect(response.statusCode).toBe(409);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 9. Download and verify
  // ══════════════════════════════════════════════════════════════════════════
  describe('downloads', () => {
    it('streams an executed PDF whose hash matches, to the admin and to the client', async () => {
      const done = await fabricateCompleted();
      const admin = await app.inject({
        method: 'GET',
        url: `/api/v1/platform/agreements/${done.id}/documents/${done.docId}.pdf`,
        headers: asAdmin(),
      });
      expect(admin.statusCode).toBe(200);
      expect(admin.headers['content-disposition']).toMatch(
        /^attachment; filename="summit-ridge-insurance-group-llc-cpa-executed-NE-[A-Z0-9]{8}\.pdf"$/
      );
      const list = await pub('GET', `/download/${done.downloadToken}`);
      expect(list.statusCode).toBe(200);
      expect(list.json().data.documents.find((d: any) => d.id === done.docId).sha256).toBe(
        done.sha
      );
      const file = await pub('GET', `/download/${done.downloadToken}/${done.docId}.pdf`);
      expect(file.statusCode).toBe(200);
      expect(createHash('sha256').update(file.rawPayload).digest('hex')).toBe(done.sha);
      expect((await events(done.id)).map(e => e.type)).toContain('DOWNLOADED');
    });

    it('refuses with 500 and no bytes when the stored object no longer matches', async () => {
      const done = await fabricateCompleted();
      writeFileSync(join(storageDir, done.key), '%PDF-1.7 altered');
      const admin = await app.inject({
        method: 'GET',
        url: `/api/v1/platform/agreements/${done.id}/documents/${done.docId}.pdf`,
        headers: asAdmin(),
      });
      expect(admin.statusCode).toBe(500);
      expect(admin.headers['content-type']).toMatch(/json/);
      expect(admin.body).not.toContain('%PDF');
      expect(
        await prisma.auditLog.count({ where: { action: 'agreements.document.integrity_failed' } })
      ).toBe(1);
      const file = await pub('GET', `/download/${done.downloadToken}/${done.docId}.pdf`);
      expect(file.statusCode).toBe(500);
    });

    it('answers an unknown or expired download link with the notice email', async () => {
      const response = await pub('GET', '/download/nope');
      expect(response.statusCode).toBe(410);
      expect(response.json().error.message).toBe(
        'This link has expired. Contact support@pvnvoice.com for a new copy.'
      );
    });

    it('verifies by hash, and only by hash', async () => {
      const done = await fabricateCompleted();
      const yes = await pub('GET', `/verify?sha256=${done.sha}`);
      expect(yes.json().data).toMatchObject({
        match: true,
        documentTitle: 'CPA Agreement',
        agencyLegalName: 'Summit Ridge Insurance Group LLC',
      });
      const no = await pub('GET', `/verify?sha256=${'a'.repeat(64)}`);
      expect(no.json().data).toEqual({ match: false });
      expect((await pub('GET', '/verify?sha256=xyz')).statusCode).toBe(422);
    });

    it('mints a new download link when copies are sent again', async () => {
      const done = await fabricateCompleted();
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/platform/agreements/${done.id}/send-copies`,
        headers: asAdmin(),
      });
      expect(response.statusCode, response.body).toBe(200);
      expect((await pub('GET', `/download/${done.downloadToken}`)).statusCode).toBe(410);
      const fresh = String(response.json().data.downloadUrl).split('/agreements/')[1];
      expect((await pub('GET', `/download/${fresh}`)).statusCode).toBe(200);
      expect((await events(done.id)).map(e => e.type)).toContain('COPIES_SENT');
    });
  });
});
