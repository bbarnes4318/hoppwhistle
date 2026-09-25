/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses */
import { randomUUID } from 'node:crypto';

import { RoleName } from '@prisma/client';
import { hash } from 'bcryptjs';
import Fastify, { type FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import type { JwtPayload } from '../types/fastify.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * "Application submitted" is a claim about money, and it now has to carry one.
 *
 * ── What was wrong ───────────────────────────────────────────────────────────
 *
 * `APPLICATION_SUBMITTED` is not a note on a call. It is the numerator of the
 * closing percentage that prices the agency, and it spends a credit off the
 * balance the agency bought. Until this change it was saved in two requests:
 * the disposition first -- because the browser holds a session id, not a `Call`
 * row, and that endpoint is what resolves one -- then the application with the
 * id that came back.
 *
 * Anything between them left a call LABELLED as a sale with no sale behind it:
 * the agent saw "saved", the numerator never moved, no credit was spent, and
 * the agency's measured closing percentage sat below its real one. On the rate
 * curve a lower closing percentage is a HIGHER price per application, so the
 * failure quietly charged the agency more for business it had actually
 * written.
 *
 * The screens guarded against it. Only the screens: the API accepted
 * `APPLICATION_SUBMITTED` from anything -- a script, an integration, the next
 * screen somebody builds -- with nothing attached.
 *
 * ── The properties asserted here ─────────────────────────────────────────────
 *
 *   1. The disposition is REFUSED without an application, and the refusal
 *      names the fields.
 *   2. A complete one records the application, counts it, and spends a credit.
 *   3. A REFUSED application leaves the call unlabelled -- never a sale with
 *      nothing behind it.
 *   4. Saving twice is one application and one credit.
 *   5. The after-the-fact edit cannot invent a sale either.
 */

const gate = databaseGate();
announceSkip('Application-submitted dispositions', gate);

const TEST_JWT_SECRET = 'application-disposition-suite-secret-not-used-elsewhere';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

interface Seeded {
  tenantId: string;
  agentId: string;
  agentEmail: string;
}

/** A complete application, as the form sends it. */
function applicationBody(overrides: Record<string, unknown> = {}) {
  return {
    clientRequestId: randomUUID(),
    carrier: 'Aflac',
    faceAmount: 15000,
    modalPremium: 62.5,
    paymentMode: 'MONTHLY',
    firstName: 'Marta',
    lastName: 'Quintero',
    ...overrides,
  };
}

describe('Application-disposition suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('Application-submitted dispositions', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;
  let agency: Seeded;
  let roleIds: Record<string, string>;

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);

    const { registerCallRoutes } = await import('../routes/index.js');
    await instance.register(registerCallRoutes);

    await instance.ready();
    return instance;
  }

  const asAgent = (s: Seeded) => ({
    authorization: `Bearer ${app.jwt.sign({
      tenantId: s.tenantId,
      userId: s.agentId,
      email: s.agentEmail,
      roles: ['AGENT'],
    } as JwtPayload)}`,
  });

  async function cleanDatabase() {
    for (const table of [
      'insurance_carrier_applications',
      'calls',
      'audit_logs',
      'user_roles',
      'users',
      'roles',
      'tenants',
    ]) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }
  }

  async function seedAgency(label: string): Promise<Seeded> {
    const slug = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tenant = await prisma.tenant.create({
      data: { name: `${label} Insurance`, slug, status: 'ACTIVE' },
    });
    const agent = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `dana@${slug}.local`,
        firstName: 'Dana',
        lastName: 'Reed',
        passwordHash: await hash('password123', 10),
        status: 'ACTIVE',
        roles: { create: { roleId: roleIds[RoleName.AGENT] } },
      },
    });
    return { tenantId: tenant.id, agentId: agent.id, agentEmail: agent.email };
  }

  /** A call this agent answered, as the softphone would have left it. */
  async function seedAnsweredCall(s: Seeded): Promise<string> {
    const call = await prisma.call.create({
      data: {
        tenantId: s.tenantId,
        callSid: `sid-${Math.random().toString(36).slice(2, 12)}`,
        toNumber: '+15550000000',
        status: 'ANSWERED',
        direction: 'INBOUND',
        answeredAt: new Date(),
        answeredByUserId: s.agentId,
      },
    });
    return call.id;
  }

  function saveDisposition(body: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/calls/disposition',
      headers: asAgent(agency),
      payload: body,
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

    roleIds = {};
    for (const name of [RoleName.OWNER, RoleName.AGENT]) {
      const role = await prisma.role.create({
        data: { name, description: `${name} role`, permissions: [] },
      });
      roleIds[name] = role.id;
    }
    agency = await seedAgency('Alpha');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 1. It cannot be saved on its own
  // ══════════════════════════════════════════════════════════════════════════
  describe('the disposition requires the application', () => {
    it('refuses APPLICATION_SUBMITTED with nothing attached', async () => {
      const callId = await seedAnsweredCall(agency);

      const response = await saveDisposition({ callId, disposition: 'APPLICATION_SUBMITTED' });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('APPLICATION_REQUIRED');
    });

    it('leaves the call unmarked when it refuses', async () => {
      const callId = await seedAnsweredCall(agency);

      await saveDisposition({ callId, disposition: 'APPLICATION_SUBMITTED' });

      const call = await prisma.call.findUnique({ where: { id: callId } });
      /*
       * The whole point. A call reading "application submitted" that the
       * closing percentage never counted is worse than an unwritten call: the
       * agent believes it is recorded and nobody goes back for it.
       */
      expect(call?.disposition).toBeNull();
    });

    it.each([
      ['no first name', { firstName: '   ' }],
      ['no last name', { lastName: '' }],
      ['no carrier', { carrier: ' ' }],
      ['no premium', { modalPremium: 0 }],
    ])('refuses an application with %s', async (_label, patch) => {
      const callId = await seedAnsweredCall(agency);

      const response = await saveDisposition({
        callId,
        disposition: 'APPLICATION_SUBMITTED',
        application: applicationBody(patch),
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('VALIDATION_ERROR');

      const call = await prisma.call.findUnique({ where: { id: callId } });
      expect(call?.disposition).toBeNull();
    });

    it('refuses an application on a disposition that is not a sale', async () => {
      const callId = await seedAnsweredCall(agency);

      const response = await saveDisposition({
        callId,
        disposition: 'NOT_INTERESTED',
        application: applicationBody(),
      });

      // Dropping it silently loses business the agent believed they recorded;
      // recording it puts a sale against a call marked "not interested".
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('APPLICATION_NOT_EXPECTED');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2. A complete one counts
  // ══════════════════════════════════════════════════════════════════════════
  describe('a complete application', () => {
    it('records the application, submitted, against that call', async () => {
      const callId = await seedAnsweredCall(agency);

      const response = await saveDisposition({
        callId,
        disposition: 'APPLICATION_SUBMITTED',
        application: applicationBody(),
      });

      expect(response.statusCode).toBe(200);

      const written = await prisma.insuranceCarrierApplication.findFirst({
        where: { tenantId: agency.tenantId },
      });

      expect(written).not.toBeNull();
      expect(written?.submittedAt).not.toBeNull(); // the numerator reads this
      expect(written?.voidedAt).toBeNull();
      expect(written?.callId).toBe(callId);
      expect(written?.createdById).toBe(agency.agentId);
      expect(written?.carrier).toBe('Aflac');
      expect(written?.firstName).toBe('Marta');
      expect(written?.lastName).toBe('Quintero');
      expect(Number(written?.faceAmount)).toBe(15000);
      expect(Number(written?.annualizedPremium)).toBeCloseTo(750, 2); // 62.50 × 12
    });

    it('marks the call as the sale it now has behind it', async () => {
      const callId = await seedAnsweredCall(agency);

      await saveDisposition({
        callId,
        disposition: 'APPLICATION_SUBMITTED',
        application: applicationBody(),
      });

      const call = await prisma.call.findUnique({ where: { id: callId } });
      expect(call?.disposition).toBe('APPLICATION_SUBMITTED');
    });

    it('trims the name rather than storing the spaces around it', async () => {
      const callId = await seedAnsweredCall(agency);

      await saveDisposition({
        callId,
        disposition: 'APPLICATION_SUBMITTED',
        application: applicationBody({ firstName: '  Marta ', lastName: ' Quintero  ' }),
      });

      const written = await prisma.insuranceCarrierApplication.findFirst({
        where: { tenantId: agency.tenantId },
      });
      expect(written?.firstName).toBe('Marta');
      expect(written?.lastName).toBe('Quintero');
    });

    it('is one application when the agent saves twice', async () => {
      const callId = await seedAnsweredCall(agency);
      const body = applicationBody();

      // The same form instance, submitted twice: a double-click, or a retry
      // after a response that never arrived.
      await saveDisposition({ callId, disposition: 'APPLICATION_SUBMITTED', application: body });
      const second = await saveDisposition({
        callId,
        disposition: 'APPLICATION_SUBMITTED',
        application: body,
      });

      expect(second.statusCode).toBe(200);
      const count = await prisma.insuranceCarrierApplication.count({
        where: { tenantId: agency.tenantId },
      });
      // Two rows would be two credits off the agency's balance for one sale.
      expect(count).toBe(1);
    });

    it('creates the call when none was tracked, and still records the sale', async () => {
      const response = await saveDisposition({
        callSid: `untracked-${Date.now()}`,
        disposition: 'APPLICATION_SUBMITTED',
        direction: 'INBOUND',
        callerNumber: '+15557654321',
        application: applicationBody(),
      });

      expect(response.statusCode).toBe(201);
      const createdId = response.json().id;

      const call = await prisma.call.findUnique({ where: { id: createdId } });
      expect(call?.disposition).toBe('APPLICATION_SUBMITTED');

      const written = await prisma.insuranceCarrierApplication.findFirst({
        where: { tenantId: agency.tenantId },
      });
      expect(written?.callId).toBe(createdId);
    });

    it('does not stamp answeredAt on a call it creates', async () => {
      const response = await saveDisposition({
        callSid: `untracked-${Date.now()}`,
        disposition: 'APPLICATION_SUBMITTED',
        direction: 'INBOUND',
        application: applicationBody(),
      });

      const call = await prisma.call.findUnique({ where: { id: response.json().id } });

      /*
       * `answeredAt` is what makes a call DELIVERED, and delivered calls are the
       * denominator that sets the agency's price. Writing up a sale must not
       * also manufacture the call it came off.
       */
      expect(call?.answeredAt).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 3. Another agent's call
  // ══════════════════════════════════════════════════════════════════════════
  describe('a call the agent cannot claim', () => {
    it('refuses the sale and leaves the call unmarked', async () => {
      const colleague = await prisma.user.create({
        data: {
          tenantId: agency.tenantId,
          email: `ruben-${Date.now()}@alpha.local`,
          passwordHash: await hash('password123', 10),
          status: 'ACTIVE',
          roles: { create: { roleId: roleIds[RoleName.AGENT] } },
        },
      });

      const theirCall = await prisma.call.create({
        data: {
          tenantId: agency.tenantId,
          callSid: `sid-${Math.random().toString(36).slice(2, 12)}`,
          toNumber: '+15550000000',
          status: 'ANSWERED',
          direction: 'INBOUND',
          answeredAt: new Date(),
          answeredByUserId: colleague.id,
        },
      });

      const response = await saveDisposition({
        callId: theirCall.id,
        disposition: 'APPLICATION_SUBMITTED',
        application: applicationBody(),
      });

      // `attributeCall` refuses a claim it cannot verify rather than storing a
      // wrong link on the figure that sets the agency's price.
      expect(response.statusCode).toBe(409);
      const call = await prisma.call.findUnique({ where: { id: theirCall.id } });
      expect(call?.disposition).toBeNull();

      const count = await prisma.insuranceCarrierApplication.count({
        where: { tenantId: agency.tenantId },
      });
      expect(count).toBe(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 4. The after-the-fact edit
  // ══════════════════════════════════════════════════════════════════════════
  describe('the follow-up: writing the call up days later', () => {
    function patchDisposition(callId: string, payload: Record<string, unknown>) {
      return app.inject({
        method: 'PATCH',
        url: `/api/v1/calls/${callId}/disposition`,
        headers: asAgent(agency),
        payload,
      });
    }

    it('records the sale when the customer signs on a later call', async () => {
      // Monday: the agent talks to somebody and sets a callback.
      const callId = await seedAnsweredCall(agency);
      await saveDisposition({ callId, disposition: 'SET_CALLBACK' });

      // Thursday: they sign. The agent opens the call log and writes it up.
      const response = await patchDisposition(callId, {
        disposition: 'APPLICATION_SUBMITTED',
        application: applicationBody(),
      });

      expect(response.statusCode).toBe(200);

      const written = await prisma.insuranceCarrierApplication.findFirst({
        where: { tenantId: agency.tenantId, callId },
      });
      /*
       * The whole point of this path. Most final-expense business does not
       * close on the call that produced it, and this route used to REFUSE the
       * disposition outright -- so that business was never counted, which
       * understates the closing percentage and raises the agency's price.
       */
      expect(written).not.toBeNull();
      expect(written?.submittedAt).not.toBeNull();
      expect(written?.createdById).toBe(agency.agentId);
      expect(Number(written?.annualizedPremium)).toBeCloseTo(750, 2);

      const call = await prisma.call.findUnique({ where: { id: callId } });
      expect(call?.disposition).toBe('APPLICATION_SUBMITTED');
    });

    it('refuses the disposition with no application, and leaves the call alone', async () => {
      const callId = await seedAnsweredCall(agency);
      await saveDisposition({ callId, disposition: 'SET_CALLBACK' });

      const response = await patchDisposition(callId, { disposition: 'APPLICATION_SUBMITTED' });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('APPLICATION_REQUIRED');

      const call = await prisma.call.findUnique({ where: { id: callId } });
      // Not relabelled. A call reading as a sale the numerator never saw is the
      // failure this whole area exists to remove.
      expect(call?.disposition).toBe('SET_CALLBACK');
    });

    it.each([
      ['no first name', { firstName: ' ' }],
      ['no carrier', { carrier: '' }],
      ['no coverage amount', { faceAmount: 0 }],
    ])('refuses an application with %s', async (_label, patch) => {
      const callId = await seedAnsweredCall(agency);

      const response = await patchDisposition(callId, {
        disposition: 'APPLICATION_SUBMITTED',
        application: applicationBody(patch),
      });

      expect(response.statusCode).toBe(400);
      const call = await prisma.call.findUnique({ where: { id: callId } });
      expect(call?.disposition).toBeNull();
    });

    it('does not ask again, or charge again, when the call already has one', async () => {
      const callId = await seedAnsweredCall(agency);
      await saveDisposition({
        callId,
        disposition: 'APPLICATION_SUBMITTED',
        application: applicationBody(),
      });

      // The genuine correction case: dispositioned wrong, fixed, put back.
      await patchDisposition(callId, { disposition: 'NOT_INTERESTED' });
      const response = await patchDisposition(callId, { disposition: 'APPLICATION_SUBMITTED' });

      expect(response.statusCode).toBe(200);
      const count = await prisma.insuranceCarrierApplication.count({
        where: { tenantId: agency.tenantId, callId },
      });
      // One piece of business, one application, one credit.
      expect(count).toBe(1);
    });

    it('refuses a second application for a call that already has one', async () => {
      const callId = await seedAnsweredCall(agency);
      await saveDisposition({
        callId,
        disposition: 'APPLICATION_SUBMITTED',
        application: applicationBody(),
      });

      const response = await patchDisposition(callId, {
        disposition: 'APPLICATION_SUBMITTED',
        application: applicationBody(),
      });

      // Silently writing it would spend a second credit the agent did not
      // intend. A couple insuring together is two applications and belongs on
      // the live path, each with its own form instance.
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('APPLICATION_ALREADY_RECORDED');
    });

    it('treats a voided application as no application at all', async () => {
      const callId = await seedAnsweredCall(agency);
      await saveDisposition({
        callId,
        disposition: 'APPLICATION_SUBMITTED',
        application: applicationBody(),
      });
      await prisma.insuranceCarrierApplication.updateMany({
        where: { tenantId: agency.tenantId, callId },
        data: { voidedAt: new Date() },
      });

      // A voided application is not a submitted one -- the measurement drops it
      // from the numerator, and this has to agree with the measurement. So the
      // call needs a real one again.
      const refused = await patchDisposition(callId, { disposition: 'APPLICATION_SUBMITTED' });
      expect(refused.statusCode).toBe(400);

      const accepted = await patchDisposition(callId, {
        disposition: 'APPLICATION_SUBMITTED',
        application: applicationBody(),
      });
      expect(accepted.statusCode).toBe(200);
    });

    it('leaves every other correction alone', async () => {
      const callId = await seedAnsweredCall(agency);

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/calls/${callId}/disposition`,
        headers: asAgent(agency),
        payload: { disposition: 'NOT_QUALIFIED', notes: 'Declined for health' },
      });

      expect(response.statusCode).toBe(200);
      const call = await prisma.call.findUnique({ where: { id: callId } });
      expect(call?.disposition).toBe('NOT_QUALIFIED');
    });
  });
});
