/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- assertions run over dynamically typed rows */
import { RoleName } from '@prisma/client';
import { hash } from 'bcryptjs';
import Fastify, { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { grantPlatformAdmin } from '../lib/platform-admin.js';
import { getPrismaClient } from '../lib/prisma.js';
import { auditLog } from '../services/audit.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * The audit trail either records the event or says it could not.
 *
 * ── What was wrong ───────────────────────────────────────────────────────────
 *
 * `audit_logs.tenantId` was NOT NULL with a foreign key to `tenants`. The events
 * that have no tenant -- a failed login for an address matching no account, an
 * invalid JWT, a CSRF failure on an unauthenticated request -- had nowhere to
 * put "none", so a dozen call sites passed the strings 'unknown' or 'default'.
 * Neither is a tenant id. Every one of those inserts violated the constraint,
 * and `auditLog()` ended in:
 *
 *     } catch (error) {
 *       // Don't throw - audit logging failures shouldn't break the request
 *       console.error('Failed to create audit log:', error);
 *     }
 *
 * So login and logout -- two of the events an audit trail exists for -- were
 * recorded nowhere, and the code read as though they were. A trail that reads as
 * present and records nothing is worse than no trail, because people rely on it.
 *
 * ── What this suite pins ─────────────────────────────────────────────────────
 *
 * 1. A write that fails RAISES. This is the assertion the whole change exists
 *    for: if a failure can be discarded, none of the rest is trustworthy.
 * 2. A tenant-less event is written as a real row with a null tenant, not
 *    discarded and not faked.
 * 3. The events that were previously lost are now actually in the table, driven
 *    over HTTP rather than by calling the service directly.
 * 4. The acting-tenant switch's rows -- the only record of which NetEnroll
 *    operator looked at which agency's data -- go through the same function and
 *    inherit the same guarantee.
 */

const gate = databaseGate();
announceSkip('Audit trail: records or raises', gate);

const TEST_JWT_SECRET = 'audit-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('Audit suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `audit suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('Audit trail: records or raises', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;
  let tenantId: string;
  let userId: string;
  let operatorId: string;

  const PASSWORD = 'Password123';

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });

    const { registerApiV1Auth } = await import('../middleware/api-v1-auth.js');
    registerApiV1Auth(instance);

    const { registerAuthRoutes } = await import('../routes/auth.js');
    const { registerPlatformRoutes } = await import('../routes/platform.js');
    await instance.register(registerAuthRoutes);
    await instance.register(registerPlatformRoutes);

    await instance.ready();
    return instance;
  }

  function tokenFor(id: string, tid: string | null): Record<string, string> {
    return {
      authorization: `Bearer ${app.jwt.sign({ userId: id, tenantId: tid, email: 'x@test.local' })}`,
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

    const role = await prisma.role.create({
      data: { name: RoleName.OWNER, description: 'OWNER', permissions: [] },
    });

    const tenant = await prisma.tenant.create({
      data: { name: 'Alpha Insurance', slug: `alpha-${Date.now()}`, status: 'ACTIVE' },
    });
    tenantId = tenant.id;

    const user = await prisma.user.create({
      data: {
        tenantId,
        email: 'principal@alpha.test',
        passwordHash: await hash(PASSWORD, 10),
        status: 'ACTIVE',
        roles: { create: { roleId: role.id } },
      },
    });
    userId = user.id;

    const operator = await prisma.user.create({
      data: { email: 'operator@netenroll.test', status: 'ACTIVE', tenantId: null },
    });
    operatorId = operator.id;
    await grantPlatformAdmin(operatorId);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 1. A failed write is surfaced, not discarded
  // ══════════════════════════════════════════════════════════════════════════
  describe('a write that cannot succeed raises', () => {
    it('rejects rather than resolving when the tenant does not exist', async () => {
      // The exact shape of the old bug: a tenantId that is not a real tenant.
      // It used to resolve successfully having written nothing. It must now
      // reject, because a caller that awaited it was entitled to believe the
      // event was recorded.
      await expect(
        auditLog({
          tenantId: '00000000-0000-0000-0000-000000000000',
          action: 'test.event',
          entityType: 'Test',
        })
      ).rejects.toThrow();

      expect(await prisma.auditLog.count()).toBe(0);
    });

    it('rejects on the literal placeholders the old call sites passed', async () => {
      for (const placeholder of ['unknown', 'default']) {
        await expect(
          auditLog({ tenantId: placeholder, action: 'test.event', entityType: 'Test' })
        ).rejects.toThrow();
      }

      expect(await prisma.auditLog.count()).toBe(0);
    });

    it('rejects when a named user does not exist', async () => {
      // Not only the tenant: any constraint failure has to surface. `userId` is
      // also a foreign key.
      await expect(
        auditLog({
          tenantId,
          userId: '00000000-0000-0000-0000-000000000000',
          action: 'test.event',
          entityType: 'Test',
        })
      ).rejects.toThrow();
    });

    it('propagates out of a caller that awaits it', async () => {
      // The property that matters in production: a handler awaiting auditLog
      // cannot carry on as though the event were recorded.
      const handler = async () => {
        await auditLog({ tenantId: 'nope', action: 'test.event', entityType: 'Test' });
        return 'reached';
      };

      await expect(handler()).rejects.toThrow();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2. A genuinely tenant-less event is recorded
  // ══════════════════════════════════════════════════════════════════════════
  describe('an event with no agency is recorded with no agency', () => {
    it('writes a row with a null tenant', async () => {
      await auditLog({
        tenantId: null,
        action: 'auth.login.failed',
        entityType: 'User',
        success: false,
        error: 'Invalid credentials',
      });

      const rows = await prisma.auditLog.findMany({ where: { action: 'auth.login.failed' } });
      expect(rows).toHaveLength(1);
      expect(rows[0].tenantId).toBeNull();
      expect(rows[0].success).toBe(false);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 3. The events that used to vanish, driven over HTTP
  // ══════════════════════════════════════════════════════════════════════════
  describe('login and logout are actually in the table', () => {
    it('records a failed login for an address matching no account', async () => {
      // This is the one that passed `tenantId: 'unknown'`: there is no user, so
      // there is no tenant. It used to be discarded in full.
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'nobody@nowhere.test', password: 'whatever' },
      });
      expect(response.statusCode).toBe(401);

      const rows = await prisma.auditLog.findMany({ where: { action: 'auth.login.failed' } });
      expect(rows, 'a failed login for an unknown address was not recorded').toHaveLength(1);
      expect(rows[0].tenantId).toBeNull();
    });

    it('records a failed login against the agency when the account is known', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'principal@alpha.test', password: 'WrongPassword1' },
      });
      expect(response.statusCode).toBe(401);

      const rows = await prisma.auditLog.findMany({ where: { action: 'auth.login.failed' } });
      expect(rows).toHaveLength(1);
      expect(rows[0].tenantId, 'a known account should attribute to its agency').toBe(tenantId);
    });

    it('records a successful login', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'principal@alpha.test', password: PASSWORD },
      });
      expect(response.statusCode).toBe(200);

      const rows = await prisma.auditLog.findMany({ where: { action: 'auth.login.success' } });
      expect(rows).toHaveLength(1);
      expect(rows[0].tenantId).toBe(tenantId);
      expect(rows[0].userId).toBe(userId);
    });

    it('records a logout by a user with no agency', async () => {
      // The platform operator has `User.tenantId = null`, so their logout is
      // exactly the case `|| 'default'` used to fake and lose.
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: tokenFor(operatorId, null),
      });
      expect(response.statusCode).toBe(200);

      const rows = await prisma.auditLog.findMany({ where: { action: 'auth.logout' } });
      expect(rows, 'a logout by a tenant-less user was not recorded').toHaveLength(1);
      expect(rows[0].tenantId).toBeNull();
      expect(rows[0].userId).toBe(operatorId);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 4. The switch inherits the guarantee
  // ══════════════════════════════════════════════════════════════════════════
  describe('the acting-tenant switch goes through the same function', () => {
    it('still writes its rows now that the bypass is gone', async () => {
      // `writePlatformAudit` used to call Prisma directly, precisely because
      // auditLog swallowed. That reason is gone and the bypass with it, so this
      // asserts the rows survived the move.
      const enter = await app.inject({
        method: 'POST',
        url: '/api/v1/platform/acting-tenant',
        headers: tokenFor(operatorId, null),
        payload: { tenantId },
      });
      expect(enter.statusCode).toBe(200);

      const leave = await app.inject({
        method: 'DELETE',
        url: '/api/v1/platform/acting-tenant',
        headers: tokenFor(operatorId, null),
      });
      expect(leave.statusCode).toBe(200);

      const entered = await prisma.auditLog.findMany({
        where: { action: 'platform.tenant.entered' },
      });
      const left = await prisma.auditLog.findMany({ where: { action: 'platform.tenant.left' } });

      expect(entered).toHaveLength(1);
      expect(entered[0].tenantId).toBe(tenantId);
      expect(entered[0].userId).toBe(operatorId);
      expect(left).toHaveLength(1);
      expect(left[0].tenantId).toBe(tenantId);
    });

    it('fails the entry rather than entering an agency unlogged', async () => {
      // The guarantee stated plainly, and the reason the whole change matters:
      // if the audit row cannot be written, the operator does not get in.
      //
      // Forced by dropping the audit table out from under the write, which is
      // the bluntest available stand-in for "the trail is unwritable". The
      // constraint is restored afterwards.
      const { enterActingTenant } = await import('../lib/platform-admin.js');

      await prisma.$executeRawUnsafe(`ALTER TABLE "audit_logs" RENAME TO "audit_logs_stashed"`);
      try {
        await expect(enterActingTenant(operatorId, tenantId)).rejects.toThrow();
      } finally {
        await prisma.$executeRawUnsafe(`ALTER TABLE "audit_logs_stashed" RENAME TO "audit_logs"`);
      }

      // And it works again once the trail is writable.
      await expect(enterActingTenant(operatorId, tenantId)).resolves.toMatchObject({ tenantId });
      expect(
        await prisma.auditLog.count({ where: { action: 'platform.tenant.entered' } })
      ).toBe(1);
    });
  });
});
