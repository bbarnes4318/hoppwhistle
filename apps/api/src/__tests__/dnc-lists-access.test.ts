/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { RoleName } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { registerReadOnlyPreview } from '../middleware/read-only-preview.js';
import { registerStaffOnly } from '../middleware/staff-only.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * DNC lists, as the white-label Settings page's DNC lists tab uses them.
 *
 *   GET    /api/v1/compliance/dnc-lists
 *   POST   /api/v1/compliance/dnc-lists
 *   DELETE /api/v1/compliance/dnc-lists/:listId
 *
 * These are not in STAFF_ONLY_AREAS: they are scoped to the acting tenant and
 * open to an agency OWNER whether or not the agency is white-label. This pins
 * that, through the same staff-only middleware the server runs, and pins that
 * one agency never sees or deletes another's list.
 */

const gate = databaseGate();
announceSkip('DNC lists access', gate);

const TEST_JWT_SECRET = 'dnc-lists-access-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('DNC lists access suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `DNC lists access suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('DNC lists access', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;
  let wl: { id: string; ownerId: string };
  let normal: { id: string; ownerId: string };

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);
    registerReadOnlyPreview(instance);
    registerStaffOnly(instance);
    const { registerComplianceRoutes } = await import('../routes/compliance.js');
    await instance.register(registerComplianceRoutes);
    await instance.ready();
    return instance;
  }

  function as(tenant: { id: string; ownerId: string }) {
    const headers = {
      authorization: `Bearer ${app.jwt.sign({
        userId: tenant.ownerId,
        tenantId: tenant.id,
        email: `${tenant.ownerId}@test.local`,
      })}`,
    };
    return {
      list: () => app.inject({ method: 'GET', url: '/api/v1/compliance/dnc-lists', headers }),
      create: (name: string) =>
        app.inject({
          method: 'POST',
          url: '/api/v1/compliance/dnc-lists',
          headers,
          payload: { name, type: 'CUSTOM' },
        }),
      remove: (id: string) =>
        app.inject({ method: 'DELETE', url: `/api/v1/compliance/dnc-lists/${id}`, headers }),
    };
  }

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
    const ownerRole = await prisma.role.create({
      data: { name: RoleName.OWNER, description: 'OWNER role', permissions: [] },
    });
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    async function agency(name: string, whiteLabel: boolean) {
      const tenant = await prisma.tenant.create({
        data: { name, slug: `${name.toLowerCase()}-${stamp}`, status: 'ACTIVE', whiteLabel },
      });
      const owner = await prisma.user.create({
        data: {
          tenantId: tenant.id,
          email: `${name.toLowerCase()}-owner-${stamp}@agency.local`,
          status: 'ACTIVE',
          roles: { create: { roleId: ownerRole.id } },
        },
      });
      return { id: tenant.id, ownerId: owner.id };
    }
    wl = await agency('Llp', true);
    normal = await agency('Ridge', false);
  });

  it.each([
    ['a white-label OWNER', () => wl],
    ['a normal agency OWNER', () => normal],
  ])('lets %s list, create and delete its own DNC lists', async (_label, tenantOf) => {
    const tenant = tenantOf();
    const client = as(tenant);

    const empty = await client.list();
    expect(empty.statusCode, empty.body).toBe(200);
    expect(empty.json().data).toEqual([]);

    const created = await client.create('Opt-outs');
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({ name: 'Opt-outs', type: 'CUSTOM', status: 'active' });

    const listed = (await client.list()).json().data;
    expect(listed.map((row: any) => row.name)).toEqual(['Opt-outs']);

    const removed = await client.remove(created.json().id);
    expect(removed.statusCode, removed.body).toBe(204);
    expect((await client.list()).json().data).toEqual([]);
    expect(await prisma.dncList.count({ where: { tenantId: tenant.id } })).toBe(0);
  });

  it("never shows or deletes another agency's list", async () => {
    const theirs = (await as(normal).create('Ridge opt-outs')).json();

    expect((await as(wl).list()).json().data).toEqual([]);
    expect((await as(wl).remove(theirs.id)).statusCode).toBe(404);
    expect(await prisma.dncList.count({ where: { id: theirs.id } })).toBe(1);
  });
});
