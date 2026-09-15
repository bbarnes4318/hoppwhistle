/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { RoleName } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { ROLE_PERMISSIONS } from '../middleware/rbac.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * `/api/auth/me` tells the client what the server will actually allow.
 *
 * ── The drift this closes ────────────────────────────────────────────────────
 *
 * The web app carried its own permission table and rebuilt it in the browser
 * from the role list (`getPermissions` in `hooks/use-auth.tsx`). It had drifted
 * from the server's: AGENT got nine capabilities on the server and exactly one
 * -- `calls:read` -- in the browser. `/reports` is guarded on `reports:read`,
 * which the server grants an agent and the browser did not, so the page turned
 * agents away from something the API would have served. A third model in
 * `hooks/useUserRoles.ts` had a `RoleName` union with no AGENT in it at all.
 *
 * The fix is that the server answers the question. These cases assert the
 * answer is the server's own, not a copy that can drift again: every list this
 * endpoint sends is compared against `ROLE_PERMISSIONS`, which is what
 * `checkPermission()` gates on.
 *
 * This is navigation state, never enforcement -- the API still authorises each
 * request by itself. `agent-capabilities.test.ts` holds the matrix; this holds
 * the wire.
 */

const gate = databaseGate();
announceSkip('/api/auth/me capabilities', gate);

const TEST_JWT_SECRET = 'me-capabilities-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('/api/auth/me capabilities suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `me-capabilities suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('/api/auth/me capabilities', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;
  let tenantId: string;
  const userIds: Partial<Record<RoleName, string>> = {};
  let rolelessUserId: string;

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    const { registerAuthRoutes } = await import('../routes/auth.js');
    await instance.register(registerAuthRoutes);
    await instance.ready();
    return instance;
  }

  const meAs = (userId: string) =>
    app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: {
        authorization: `Bearer ${app.jwt.sign({ tenantId, userId, email: `${userId}@t.local` })}`,
      },
    });

  beforeAll(async () => {
    prisma = getPrismaClient();
    app = await buildApp();

    for (const table of ['user_roles', 'users', 'roles', 'tenants']) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }

    const tenant = await prisma.tenant.create({
      data: { name: 'Capability Agency', slug: `cap-${Date.now()}`, status: 'ACTIVE' },
    });
    tenantId = tenant.id;

    for (const name of Object.values(RoleName)) {
      const role = await prisma.role.create({ data: { name, permissions: [] } });
      const user = await prisma.user.create({
        data: {
          tenantId,
          email: `${name.toLowerCase()}@cap.local`,
          status: 'ACTIVE',
          roles: { create: { roleId: role.id } },
        },
      });
      userIds[name] = user.id;
    }

    const roleless = await prisma.user.create({
      data: { tenantId, email: 'noroles@cap.local', status: 'ACTIVE' },
    });
    rolelessUserId = roleless.id;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it.each(Object.values(RoleName))('sends %s exactly the capabilities the server gates on', async role => {
    const res = await meAs(userIds[role]!);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);

    expect(body.roles).toEqual([role]);
    expect([...body.permissions].sort()).toEqual([...ROLE_PERMISSIONS[role]].sort());
  });

  it('gives an AGENT reports:read, which the browser copy withheld', async () => {
    const body = JSON.parse((await meAs(userIds[RoleName.AGENT]!)).body);
    expect(body.permissions).toContain('reports:read');
    // The whole of what the browser used to derive for an agent.
    expect(body.permissions).toContain('calls:read');
    expect(body.permissions.length).toBeGreaterThan(1);
  });

  it('never sends an AGENT a capability the matrix forbids', async () => {
    const body = JSON.parse((await meAs(userIds[RoleName.AGENT]!)).body);
    for (const forbidden of [
      'admin:*',
      'users:write',
      'billing:write',
      'payroll:write',
      'numbers:write',
      'settings:write',
      'calls:delete',
    ]) {
      expect(body.permissions, forbidden).not.toContain(forbidden);
    }
  });

  it('sends an account with no role an empty list, not a missing field', async () => {
    // The difference matters to the client: `[]` is "resolved, and you may do
    // nothing", which is a state it can render honestly. `undefined` is
    // indistinguishable from "not resolved yet", which is what produced a
    // Dashboard-only screen that looked like a broken session.
    const body = JSON.parse((await meAs(rolelessUserId)).body);
    expect(body.roles).toEqual([]);
    expect(body.permissions).toEqual([]);
  });

  it('honours a legitimate addition on a role row', async () => {
    await prisma.role.update({
      where: { name: RoleName.ADMIN },
      data: { permissions: ['settings:read', 'settings:write'] },
    });
    const body = JSON.parse((await meAs(userIds[RoleName.ADMIN]!)).body);
    expect(body.permissions).toContain('settings:write');
  });

  it('ignores a row that tries to widen AGENT', async () => {
    // The exact value the quarantined bulk-grant SQL wrote.
    await prisma.role.update({
      where: { name: RoleName.AGENT },
      data: { permissions: ['calls:*', 'contacts:*', 'billing:write'] },
    });
    const body = JSON.parse((await meAs(userIds[RoleName.AGENT]!)).body);
    expect(body.permissions).not.toContain('calls:*');
    expect(body.permissions).not.toContain('contacts:*');
    expect(body.permissions).not.toContain('billing:write');
    expect(body.permissions).not.toContain('calls:delete');
  });
});
