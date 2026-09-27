/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses */
import { randomUUID } from 'node:crypto';

import { RoleName } from '@prisma/client';
import { hash } from 'bcryptjs';
import Fastify, { type FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import type { JwtPayload } from '../types/fastify.js';

import { internalKeyHeaders, useTestInternalKey } from './helpers/internal-key.js';
import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * A softphone call is ONE call row, credited to the agent who took it.
 *
 * The softphone never reported an inbound answer, and its disposition named
 * the call by the browser leg's SIP Call-ID, which no row carries. So
 * `POST /api/v1/calls/disposition` found nothing and created a second INBOUND
 * row beside the one the FreeSWITCH CDR writes.
 *
 * Now FreeSWITCH sends the call's own id to the softphone (`X-Call-Id:
 * fs-<uuid>`, the callSid the CDR uses), and the disposition names the call by
 * it:
 *
 *   1. After the CDR: the disposition lands on the CDR's row. No second row.
 *   2. Before the CDR: it waits, and the CDR merges it into the row it writes.
 *      Still one row, and an application riding along is recorded then.
 */

const gate = databaseGate();
announceSkip('Softphone dispositions', gate);

const TEST_JWT_SECRET = 'softphone-disposition-suite-secret-not-used-elsewhere';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('Softphone-disposition suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('Softphone dispositions', () => {
  useTestInternalKey();

  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;
  let tenantId: string;
  let agentId: string;
  let agentEmail: string;
  let routeId: string;

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);

    const { registerCallRoutes } = await import('../routes/index.js');
    await instance.register(registerCallRoutes);
    const { registerDidRouteRoutes } = await import('../routes/did-routes.js');
    await instance.register(registerDidRouteRoutes);

    await instance.ready();
    return instance;
  }

  const asAgent = () => ({
    authorization: `Bearer ${app.jwt.sign({
      tenantId,
      userId: agentId,
      email: agentEmail,
      roles: ['AGENT'],
    } as JwtPayload)}`,
  });

  function saveDisposition(body: Record<string, unknown>) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/calls/disposition',
      headers: asAgent(),
      payload: body,
    });
  }

  /** The CDR inbound_route.lua posts for a call the agent's softphone answered. */
  function postCdr(uuid: string) {
    return app.inject({
      method: 'POST',
      url: '/api/v1/freeswitch/cdr',
      headers: internalKeyHeaders,
      payload: {
        callId: uuid,
        routeId,
        tenantId,
        callerNumber: '+14235551212',
        did: '+18885550123',
        destination: '1000',
        buyerId: '',
        targetId: '',
        campaignId: '',
        duration: 95,
        connectedDuration: 80,
        hangupCause: 'NORMAL_CLEARING',
        sipHangupDisposition: 'recv_bye',
        startedAt: '2026-09-24T15:00:00Z',
        answeredAt: '2026-09-24T15:00:15Z',
        endedAt: '2026-09-24T15:01:35Z',
        recordingPath: '',
        recordingDuration: 0,
        bridgeChannelName: 'sofia/internal/sip:1000@10.0.0.5:5060',
        answeredParty: `agent:${agentId}`,
        answeredNumber: '1000',
        answeredTarget: '',
      },
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
    for (const table of [
      'pending_call_dispositions',
      'insurance_carrier_applications',
      'calls',
      'did_routes',
      'phone_numbers',
      'audit_logs',
      'user_roles',
      'users',
      'roles',
      'tenants',
    ]) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }

    const agentRole = await prisma.role.create({
      data: { name: RoleName.AGENT, description: 'AGENT role', permissions: [] },
    });
    const slug = `softphone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tenant = await prisma.tenant.create({
      data: { name: 'Softphone Insurance', slug, status: 'ACTIVE' },
    });
    tenantId = tenant.id;
    const agent = await prisma.user.create({
      data: {
        tenantId,
        email: `dana@${slug}.local`,
        firstName: 'Dana',
        lastName: 'Reed',
        passwordHash: await hash('password123', 10),
        status: 'ACTIVE',
        roles: { create: { roleId: agentRole.id } },
      },
    });
    agentId = agent.id;
    agentEmail = agent.email;

    const number = await prisma.phoneNumber.create({
      data: { tenantId, number: '+18885550123' },
    });
    const route = await prisma.didRoute.create({
      data: {
        tenantId,
        phoneNumberId: number.id,
        did: '+18885550123',
        destination: '1000',
      },
    });
    routeId = route.id;
  });

  it('after the CDR, updates the CDR row and creates no second row', async () => {
    const uuid = randomUUID();
    expect((await postCdr(uuid)).statusCode).toBe(201);

    const response = await saveDisposition({
      callId: `fs-${uuid}`,
      disposition: 'NOT_INTERESTED',
      notes: 'Only wanted a quote',
      callerNumber: '+14235551212',
      direction: 'INBOUND',
      callSource: 'SOFTPHONE',
      duration: 999,
    });

    expect(response.statusCode).toBe(200);
    const calls = await prisma.call.findMany({ where: { tenantId } });
    expect(calls).toHaveLength(1);
    expect(response.json().id).toBe(calls[0].id);
    expect(calls[0]).toMatchObject({
      callSid: `fs-${uuid}`,
      direction: 'INBOUND',
      disposition: 'NOT_INTERESTED',
      dispositionNotes: 'Only wanted a quote',
      answeredByUserId: agentId,
      // What the switch measured, not the browser's clock.
      duration: 95,
      connectedDuration: 80,
    });
  });

  it('before the CDR, waits, and is merged when the CDR lands', async () => {
    const uuid = randomUUID();

    const response = await saveDisposition({
      callId: `fs-${uuid}`,
      disposition: 'FOLLOW_UP',
      notes: 'Call back after lunch',
      callerNumber: '+14235551212',
      direction: 'INBOUND',
      callSource: 'SOFTPHONE',
      followUpAt: '2026-09-25T17:00:00.000Z',
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ pending: true, callSid: `fs-${uuid}` });
    expect(await prisma.call.count({ where: { tenantId } })).toBe(0);

    expect((await postCdr(uuid)).statusCode).toBe(201);

    const calls = await prisma.call.findMany({ where: { tenantId } });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      callSid: `fs-${uuid}`,
      disposition: 'FOLLOW_UP',
      dispositionNotes: 'Call back after lunch',
      callSource: 'SOFTPHONE',
      followUpStatus: 'PENDING',
      answeredByUserId: agentId,
    });
    expect(calls[0].followUpAt?.toISOString()).toBe('2026-09-25T17:00:00.000Z');
    expect(await prisma.pendingCallDisposition.count({ where: { tenantId } })).toBe(0);
  });

  it('records an application saved before the CDR against the call the CDR writes', async () => {
    const uuid = randomUUID();

    const response = await saveDisposition({
      callId: `fs-${uuid}`,
      disposition: 'APPLICATION_SUBMITTED',
      callerNumber: '+14235551212',
      direction: 'INBOUND',
      callSource: 'SOFTPHONE',
      application: {
        clientRequestId: randomUUID(),
        carrier: 'Aflac',
        faceAmount: 15000,
        modalPremium: 62.5,
        paymentMode: 'MONTHLY',
        firstName: 'Marta',
        lastName: 'Quintero',
      },
    });
    expect(response.statusCode).toBe(202);
    expect(await prisma.insuranceCarrierApplication.count({ where: { tenantId } })).toBe(0);

    expect((await postCdr(uuid)).statusCode).toBe(201);

    const call = await prisma.call.findFirstOrThrow({ where: { tenantId } });
    expect(call.disposition).toBe('APPLICATION_SUBMITTED');
    const application = await prisma.insuranceCarrierApplication.findFirst({
      where: { tenantId },
    });
    expect(application?.callId).toBe(call.id);
    expect(await prisma.call.count({ where: { tenantId } })).toBe(1);
  });
});
