/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return -- assertions run over parsed JSON responses, which are dynamically typed */
import { RoleName } from '@prisma/client';
// eslint-disable-next-line import/default
import bcrypt from 'bcryptjs';
// eslint-disable-next-line import/no-named-as-default-member
const { hash: bcryptHash } = bcrypt;
import Fastify, { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { registerStaffOnly } from '../middleware/staff-only.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * An agent keeps their own licensed states, from Account.
 *
 *   PUT /api/auth/me/licensed-states   { licensedStates: string[] }
 *
 * Replaces the list (the first-login screen and Account both use it), never
 * empties it, refuses anyone who is not a state-restricted agent, and audits
 * every change with the list before and after.
 */

const gate = databaseGate();
announceSkip('Agent self-service licensed states', gate);

const TEST_JWT_SECRET = 'me-licensed-states-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('Agent licensed-states suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `licensed-states suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('PUT /api/auth/me/licensed-states', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;
  let tenantId: string;
  let agentId: string;
  let agentEmail: string;
  let ownerEmail: string;
  const PASSWORD = 'Agent-Password-1';

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);
    registerStaffOnly(instance);
    const { registerAuthRoutes } = await import('../routes/auth.js');
    await instance.register(registerAuthRoutes);
    await instance.ready();
    return instance;
  }

  async function tokenFor(email: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: PASSWORD },
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().token;
  }

  const put = (token: string, licensedStates: unknown) =>
    app.inject({
      method: 'PUT',
      url: '/api/auth/me/licensed-states',
      headers: { authorization: `Bearer ${token}` },
      payload: { licensedStates },
    });

  const storedStates = async () =>
    ((await prisma.user.findUniqueOrThrow({ where: { id: agentId } })).metadata as any)
      ?.licensedStates;

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    prisma = getPrismaClient();
    for (const table of ['audit_logs', 'roles', 'tenants']) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }
    const agentRole = await prisma.role.create({
      data: { name: RoleName.AGENT, description: 'agent', permissions: [] },
    });
    const ownerRole = await prisma.role.create({
      data: { name: RoleName.OWNER, description: 'owner', permissions: [] },
    });
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    tenantId = (
      await prisma.tenant.create({
        data: { name: 'Ridgeline', slug: `ridge-${stamp}`, status: 'ACTIVE' },
      })
    ).id;
    const passwordHash = await bcryptHash(PASSWORD, 4);
    agentEmail = `agent-${stamp}@agency.test`;
    agentId = (
      await prisma.user.create({
        data: {
          tenantId,
          email: agentEmail,
          passwordHash,
          status: 'ACTIVE',
          metadata: { licensedStates: ['TN', 'FL'] },
          roles: { create: { roleId: agentRole.id } },
        },
      })
    ).id;
    ownerEmail = `owner-${stamp}@agency.test`;
    await prisma.user.create({
      data: {
        tenantId,
        email: ownerEmail,
        passwordHash,
        status: 'ACTIVE',
        roles: { create: { roleId: ownerRole.id } },
      },
    });
  });

  it('lets an agent with states on file add and remove states', async () => {
    const token = await tokenFor(agentEmail);
    const response = await put(token, ['ga', 'TN', 'TX']);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().licensedStates).toEqual(['GA', 'TN', 'TX']);
    expect(await storedStates()).toEqual(['GA', 'TN', 'TX']);

    // /me reports the new list, which is what routing and the CRM read too.
    const me = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.json().licensedStates).toEqual(['GA', 'TN', 'TX']);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'auth.licensed_states.updated' },
    });
    expect(audit).toMatchObject({ userId: agentId, tenantId, success: true });
    expect(audit.changes).toEqual({ from: ['FL', 'TN'], to: ['GA', 'TN', 'TX'] });
  });

  it('records a first list as recorded, not updated', async () => {
    await prisma.user.update({ where: { id: agentId }, data: { metadata: {} } });
    const token = await tokenFor(agentEmail);
    expect((await put(token, ['TN'])).statusCode).toBe(200);
    expect(
      await prisma.auditLog.count({ where: { action: 'auth.licensed_states.recorded' } })
    ).toBe(1);
  });

  it('never empties the list', async () => {
    const token = await tokenFor(agentEmail);
    const response = await put(token, []);
    expect(response.statusCode).toBe(400);
    expect(await storedStates()).toEqual(['TN', 'FL']);
  });

  it('refuses an unknown state and changes nothing', async () => {
    const token = await tokenFor(agentEmail);
    const response = await put(token, ['TN', 'ZZ']);
    expect(response.statusCode).toBe(400);
    expect(await storedStates()).toEqual(['TN', 'FL']);
  });

  it('refuses somebody who is not an agent', async () => {
    const token = await tokenFor(ownerEmail);
    expect((await put(token, ['TN'])).statusCode).toBe(403);
  });

  it('requires authentication', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/auth/me/licensed-states',
      payload: { licensedStates: ['TN'] },
    });
    expect(response.statusCode).toBe(401);
  });
});
