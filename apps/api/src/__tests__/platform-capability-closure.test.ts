/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

import { hash } from 'bcryptjs';
import Fastify, { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { grantPlatformAdmin } from '../lib/platform-admin.js';
import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * Platform admin is not self-serve.
 *
 * ── Why this suite exists ───────────────────────────────────────────────────
 *
 * Phase 2 widened per-tenant permission checks so that a platform operator
 * inside an agency passes every one of them. That is the right policy and it
 * raises the stakes on one question: can anything reachable over HTTP put a row
 * in `platform_admins`?
 *
 * If it can, then the capability is bounded by whatever route grants it, and
 * "platform admins have full access everywhere" becomes "whoever can reach that
 * route has full access everywhere". So the answer has to be no, and it has to
 * be asserted rather than believed.
 *
 * Two checks, because either alone is weak:
 *
 *   1. A static sweep of every route file for a write to the model. Catches a
 *      route added later that this suite does not know to drive.
 *   2. Real requests, as an agency OWNER and as an operator, against every
 *      shape a grant could plausibly take -- a dedicated endpoint, a user
 *      create, a profile update, a role assignment -- asserting the row count
 *      never moves.
 */

const gate = databaseGate();
announceSkip('Platform capability: not self-serve', gate);

const TEST_JWT_SECRET = 'platform-closure-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

/**
 * Files that call `issueActivationGrant` with no tenant.
 *
 * Looks at the call site -- the ~400 characters after the call opens -- rather
 * than at the file, because `tenantId: null` is legitimate elsewhere (audit
 * rows for tenant-less events) and a file-wide match would flag those and have
 * to be suppressed. A suppressed check finds nothing.
 */
function tenantlessGrantCallSites(dir: string): string[] {
  const found = new Set<string>();

  for (const file of sourceFiles(dir)) {
    if (file.endsWith(join('services', 'tenant-activation.ts'))) continue; // the definition
    const source = readFileSync(file, 'utf8');

    for (const match of source.matchAll(/issueActivationGrant\(([\s\S]{0,400})/g)) {
      const args = match[1];
      if (/tenantId:\s*null/.test(args) || /PLATFORM_INVITE/.test(args)) {
        found.add(file.replace(process.cwd() + '/', ''));
      }
    }
  }

  return [...found].sort();
}

/** Every `.ts` file under a directory, recursively, tests excluded. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === '__tests__') continue;
      out.push(...sourceFiles(path));
    } else if (entry.endsWith('.ts')) {
      out.push(path);
    }
  }
  return out;
}

describe('Platform capability: no route grants it', () => {
  /**
   * The static half. Runs with no database, so it is never skipped: a route
   * that grants the capability must fail the build on every machine, not only
   * on one with Postgres.
   */
  it('no route file writes to platform_admins', () => {
    const routesDir = join(process.cwd(), 'src', 'routes');
    const offenders: string[] = [];

    for (const file of sourceFiles(routesDir)) {
      const source = readFileSync(file, 'utf8');

      // Prisma writes to the model, by either spelling.
      const prismaWrite =
        /\bplatformAdmin\s*\.\s*(create|createMany|upsert|update|updateMany)\b/.test(source);
      // Raw SQL against the table.
      const rawWrite = /insert\s+into\s+"?platform_admins"?/i.test(source);
      // The service function that grants it.
      const serviceCall = /\bgrantPlatformAdmin\s*\(/.test(source);

      if (prismaWrite || rawWrite || serviceCall) offenders.push(file);
    }

    expect(
      offenders,
      'a route grants the platform capability. It is granted by the provisioning ' +
        'command only -- see src/cli/platform-admins.ts and docs/PLATFORM_ADMIN.md.'
    ).toEqual([]);
  });

  it('the provisioning command is the only caller of grantPlatformAdmin', () => {
    const srcDir = join(process.cwd(), 'src');
    const callers = sourceFiles(srcDir).filter(file => {
      if (file.endsWith(join('lib', 'platform-admin.ts'))) return false; // the definition
      return /\bgrantPlatformAdmin\s*\(/.test(readFileSync(file, 'utf8'));
    });

    expect(callers.map(f => f.replace(process.cwd() + '/', ''))).toEqual([
      'src/cli/platform-admins.ts',
    ]);
  });
});

describe.skipIf(!gate.available)('Platform capability: not self-serve', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;

  let tenantId: string;
  let ownerId: string;
  let plainUserId: string;
  let operatorId: string;

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);

    // Every plugin that touches users, roles or the platform surface. If a
    // grant were reachable, it would be through one of these.
    const routes = await import('../routes/index.js');
    const { registerPlatformRoutes } = await import('../routes/platform.js');
    const { registerAuthRoutes } = await import('../routes/auth.js');
    const { registerRatingRoutes } = await import('../routes/rating.js');

    await instance.register(routes.registerUserRoutes);
    await instance.register(routes.registerAdminTenantRoutes);
    await instance.register(registerPlatformRoutes);
    await instance.register(registerAuthRoutes);
    await instance.register(registerRatingRoutes);

    await instance.ready();
    return instance;
  }

  function tokenFor(userId: string, tenant: string | null): Record<string, string> {
    return {
      authorization: `Bearer ${app.jwt.sign({ userId, tenantId: tenant, email: `${userId}@t.local` })}`,
    };
  }

  async function cleanDatabase() {
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

    const ownerRole = await prisma.role.create({
      data: { name: 'OWNER', description: 'OWNER role', permissions: ['admin:*'] },
    });

    const tenant = await prisma.tenant.create({
      data: { name: 'Ridgeline', slug: `ridge-${Date.now()}`, status: 'ACTIVE' },
    });
    tenantId = tenant.id;

    const owner = await prisma.user.create({
      data: {
        tenantId,
        email: 'owner@ridge.test',
        passwordHash: await hash('password123', 10),
        status: 'ACTIVE',
        roles: { create: { roleId: ownerRole.id } },
      },
    });
    ownerId = owner.id;

    const plain = await prisma.user.create({
      data: { tenantId, email: 'agent@ridge.test', status: 'ACTIVE' },
    });
    plainUserId = plain.id;

    const operator = await prisma.user.create({
      data: { email: 'operator@netenroll.test', status: 'ACTIVE', tenantId: null },
    });
    operatorId = operator.id;
    await grantPlatformAdmin(operatorId, { note: 'closure suite fixture' });
  });

  /**
   * Every shape a grant could plausibly take over HTTP, driven as the two
   * principals with the most reach. The assertion is on the row count, not on
   * the status code: a 404 and a 200 that quietly ignored the field are equally
   * fine, and a 200 that created a row is the failure.
   */
  const ATTEMPTS: Array<{ method: 'POST' | 'PUT' | 'PATCH'; url: string; payload: unknown }> = [
    { method: 'POST', url: '/api/v1/platform/admins', payload: {} },
    { method: 'POST', url: '/api/v1/platform/platform-admins', payload: {} },
    { method: 'POST', url: '/api/v1/admin/platform-admins', payload: {} },
    {
      method: 'POST',
      url: '/api/v1/users',
      payload: {
        email: 'sneaky@ridge.test',
        firstName: 'S',
        lastName: 'N',
        isPlatformAdmin: true,
        platformAdmin: true,
        roles: ['OWNER'],
      },
    },
    {
      method: 'PATCH',
      url: '/api/auth/me/settings',
      payload: { isPlatformAdmin: true, platformAdmin: true, position: 'x' },
    },
  ];

  for (const principal of ['owner', 'operator'] as const) {
    it(`no request as a${principal === 'owner' ? 'n agency owner' : ' platform operator'} creates a platform_admins row`, async () => {
      const before = await prisma.platformAdmin.count();

      for (const attempt of ATTEMPTS) {
        const headers =
          principal === 'owner' ? tokenFor(ownerId, tenantId) : tokenFor(operatorId, null);

        await app.inject({
          method: attempt.method,
          url: attempt.url,
          headers,
          payload: attempt.payload as Record<string, unknown>,
        });
      }

      const after = await prisma.platformAdmin.count();
      expect(after, 'an authenticated request created a platform capability').toBe(before);

      // And specifically: neither principal granted it to the ordinary user.
      expect(
        await prisma.platformAdmin.findUnique({ where: { userId: plainUserId } })
      ).toBeNull();
      expect(await prisma.platformAdmin.findUnique({ where: { userId: ownerId } })).toBeNull();
    });
  }

  it('an anonymous request creates no platform_admins row either', async () => {
    const before = await prisma.platformAdmin.count();

    for (const attempt of ATTEMPTS) {
      await app.inject({
        method: attempt.method,
        url: attempt.url,
        payload: attempt.payload as Record<string, unknown>,
      });
    }

    expect(await prisma.platformAdmin.count()).toBe(before);
  });

  describe('the one path that does create a platform admin', () => {
    /**
     * The provisioning path, end to end, because a documented path that has
     * never been run is a guess.
     *
     * Production has exactly one platform admin: joel.vasquez@outlook.com has
     * no account, so `--sync` reported him missing and granted nothing. A
     * launch set of one is a single point of failure — lose that account and
     * the dialer console, the quota routes and the /admin/api/v1 console are
     * unreachable for everybody, with no second operator to restore them.
     *
     * Self-serve signup requires an invitation, and every invitation the API
     * can issue carries a tenant. Inviting NetEnroll staff through one would
     * create a NetEnroll employee inside a customer's agency. So the grant has
     * to be able to carry no tenant, and this asserts what that produces.
     */
    it('invites with no agency, and the account it creates can do nothing yet', async () => {
      const { issueActivationGrant } = await import('../services/tenant-activation.js');

      const grant = await issueActivationGrant({
        tenantId: null,
        email: 'second.operator@netenroll.test',
        source: 'PLATFORM_INVITE',
      });

      const registered = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'second.operator@netenroll.test',
          password: 'Passw0rdPassw0rd',
          firstName: 'Second',
          lastName: 'Operator',
          activationToken: grant.token,
        },
      });

      expect(registered.statusCode).toBe(201);
      // No roles: a role is a grant inside a tenant and there is no tenant.
      expect(registered.json().user.roles).toEqual([]);

      const created = await prisma.user.findUnique({
        where: { email: 'second.operator@netenroll.test' },
        include: { roles: true, platformAdmin: true },
      });

      expect(created).not.toBeNull();
      // Belongs to no agency, exactly as docs/PLATFORM_ADMIN.md §1 requires.
      expect(created!.tenantId).toBeNull();
      expect(created!.roles).toEqual([]);
      // And is NOT staff yet. The invitation and the capability are two
      // deliberate acts; if this were non-null the invitation would itself be a
      // way to become a platform admin.
      expect(created!.platformAdmin).toBeNull();
      expect(created!.status).toBe('ACTIVE');
    });

    it('becomes staff only when the provisioning command grants it', async () => {
      const { issueActivationGrant } = await import('../services/tenant-activation.js');
      const grant = await issueActivationGrant({
        tenantId: null,
        email: 'third.operator@netenroll.test',
        source: 'PLATFORM_INVITE',
      });

      await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'third.operator@netenroll.test',
          password: 'Passw0rdPassw0rd',
          activationToken: grant.token,
        },
      });

      const created = await prisma.user.findUniqueOrThrow({
        where: { email: 'third.operator@netenroll.test' },
      });

      // The second act. This is `platform:admins -- --grant`.
      await grantPlatformAdmin(created.id, { note: 'test' });

      expect(
        await prisma.platformAdmin.findUnique({ where: { userId: created.id } })
      ).not.toBeNull();
    });

    it('spends a platform invitation exactly once', async () => {
      const { issueActivationGrant } = await import('../services/tenant-activation.js');
      const grant = await issueActivationGrant({
        tenantId: null,
        email: 'fourth.operator@netenroll.test',
        source: 'PLATFORM_INVITE',
      });

      const first = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'fourth.operator@netenroll.test',
          password: 'Passw0rdPassw0rd',
          activationToken: grant.token,
        },
      });
      expect(first.statusCode).toBe(201);

      const second = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'someone.else@netenroll.test',
          password: 'Passw0rdPassw0rd',
          activationToken: grant.token,
        },
      });
      expect(second.statusCode).toBe(400);
    });

    it('refuses a platform invitation presented with a different address', async () => {
      // The same binding an agency invitation has. Without it, intercepting the
      // link creates a tenant-less account under the interceptor's own address
      // — one `--grant` away from every agency on the platform.
      const { issueActivationGrant } = await import('../services/tenant-activation.js');
      const grant = await issueActivationGrant({
        tenantId: null,
        email: 'intended@netenroll.test',
        source: 'PLATFORM_INVITE',
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: {
          email: 'attacker@example.com',
          password: 'Passw0rdPassw0rd',
          activationToken: grant.token,
        },
      });

      expect(response.statusCode).toBe(400);
      expect(await prisma.user.findUnique({ where: { email: 'attacker@example.com' } })).toBeNull();
    });

    it('is not reachable over HTTP: no route mints a tenant-less grant', () => {
      // `POST /api/v1/auth/activation-grants` invites into the caller's OWN
      // agency and has no tenantId field. Nothing on the HTTP surface mints a
      // PLATFORM_INVITE; only the provisioning command does, which needs shell
      // access to the host.
      //
      // Matched at the CALL SITE rather than anywhere in the file: `auth.ts`
      // legitimately contains `tenantId: null` (audit rows for events with no
      // tenant) and the words PLATFORM_INVITE (in a comment explaining why it
      // skips role assignment for one). A file-wide grep flagged both and would
      // have had to be silenced, which is how a real finding gets silenced too.
      expect(
        tenantlessGrantCallSites(join(process.cwd(), 'src', 'routes')),
        'a route mints a tenant-less activation grant. Only ' +
          'src/cli/platform-admins.ts may, and only from the host.'
      ).toEqual([]);
    });

    it('the provisioning command is the only caller that mints one', () => {
      expect(tenantlessGrantCallSites(join(process.cwd(), 'src'))).toEqual([
        'src/cli/platform-admins.ts',
      ]);
    });
  });

  it('a user created through the API is never staff', async () => {
    // The one grant path that would be easy to add by accident: a create
    // endpoint that copies unknown body fields onto the row.
    await app.inject({
      method: 'POST',
      url: '/api/v1/users',
      headers: tokenFor(ownerId, tenantId),
      payload: {
        email: 'new@ridge.test',
        firstName: 'New',
        lastName: 'User',
        password: 'password123',
        isPlatformAdmin: true,
      },
    });

    const created = await prisma.user.findUnique({
      where: { email: 'new@ridge.test' },
      include: { platformAdmin: true },
    });

    if (created) expect(created.platformAdmin).toBeNull();
  });
});
