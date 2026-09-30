/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- assertions run over parsed JSON responses */
import { RoleName } from '@prisma/client';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * Who may manage webhooks.
 *
 * Where a webhook points is where the agency's call and application events are
 * sent. The RBAC table has always taken `webhooks:write` from an agent, but the
 * routes never asked, and an agent could create one (201) and list the agency's.
 * An owner and an administrator can; an agent cannot.
 */

const gate = databaseGate();
announceSkip('Webhook access', gate);

const TEST_JWT_SECRET = 'webhook-access-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('Webhook access suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `webhook access suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('managing webhooks', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;
  let tenantId: string;
  let people: { owner: string; admin: string; agent: string };
  let existing: string;

  const as = (userId: string) => ({
    authorization: `Bearer ${app.jwt.sign({ userId, tenantId, email: `${userId}@agency.local` })}`,
  });
  const create = (userId: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/webhooks',
      headers: as(userId),
      payload: { url: 'https://hooks.example.test/events', events: ['call.completed'] },
    });

  beforeAll(async () => {
    app = Fastify();
    await app.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await app.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(app);
    const { registerWebhookRoutes } = await import('../routes/index.js');
    await app.register(registerWebhookRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    prisma = getPrismaClient();
    for (const table of ['audit_logs', 'roles', 'tenants']) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }
    const roleIds: Record<string, string> = {};
    for (const name of [RoleName.OWNER, RoleName.ADMIN, RoleName.AGENT]) {
      roleIds[name] = (await prisma.role.create({ data: { name, permissions: [] } })).id;
    }
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tenant = await prisma.tenant.create({
      data: { name: 'Webhook Agency', slug: `hooks-${stamp}`, status: 'ACTIVE' },
    });
    tenantId = tenant.id;
    const user = async (role: RoleName) =>
      (
        await prisma.user.create({
          data: {
            tenantId,
            email: `${role.toLowerCase()}-${stamp}@agency.local`,
            status: 'ACTIVE',
            roles: { create: { roleId: roleIds[role] } },
          },
        })
      ).id;
    people = {
      owner: await user(RoleName.OWNER),
      admin: await user(RoleName.ADMIN),
      agent: await user(RoleName.AGENT),
    };
    existing = (
      await prisma.webhook.create({
        data: {
          tenantId,
          url: 'https://hooks.example.test/already-there',
          events: ['call.completed'],
          status: 'ACTIVE',
          secret: 'whsec-test-fixture',
        },
      })
    ).id;
  });

  it('refuses an agent every one of them, and writes nothing', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/webhooks',
      headers: as(people.agent),
    });
    const one = await app.inject({
      method: 'GET',
      url: `/api/v1/webhooks/${existing}`,
      headers: as(people.agent),
    });
    const post = await create(people.agent);
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/v1/webhooks/${existing}`,
      headers: as(people.agent),
      payload: { url: 'https://attacker.example.test/collect' },
    });
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/webhooks/${existing}`,
      headers: as(people.agent),
    });

    expect([list, one, post, patch, del].map(r => r.statusCode)).toEqual([403, 403, 403, 403, 403]);

    // Nothing was created, repointed or removed.
    const rows = await prisma.webhook.findMany({ where: { tenantId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.url).toBe('https://hooks.example.test/already-there');
  });

  it('lets an owner and an administrator create, list, change and remove them', async () => {
    for (const person of [people.owner, people.admin]) {
      const created = await create(person);
      expect(created.statusCode).toBe(201);
      const id = created.json().id as string;

      const list = await app.inject({
        method: 'GET',
        url: '/api/v1/webhooks',
        headers: as(person),
      });
      expect(list.statusCode).toBe(200);
      expect(JSON.stringify(list.json())).toContain(id);

      const patched = await app.inject({
        method: 'PATCH',
        url: `/api/v1/webhooks/${id}`,
        headers: as(person),
        payload: { status: 'INACTIVE' },
      });
      expect(patched.statusCode).toBe(200);

      const removed = await app.inject({
        method: 'DELETE',
        url: `/api/v1/webhooks/${id}`,
        headers: as(person),
      });
      expect(removed.statusCode).toBeLessThan(300);
    }
  });
});
