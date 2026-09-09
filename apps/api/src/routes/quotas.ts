import { createHash, randomBytes } from 'crypto';

import { FastifyInstance } from 'fastify';

import { requirePlatformAdmin } from '../lib/platform-context.js';
import { getPrismaClient } from '../lib/prisma.js';
import { resolveTenant } from '../lib/tenant-context.js';
import { authenticate } from '../middleware/auth.js';
import { auditCreate, auditUpdate } from '../services/audit.js';
import { quotaService } from '../services/quota-service.js';

/**
 * Quota Management Routes.
 *
 * ── Why these are platform routes, and why the tenant is in the path ─────────
 *
 * Every route here is `/admin/api/v1/tenants/:tenantId/...`: they set another
 * agency's call ceilings, spend caps and budget override tokens. Nothing here
 * reads the caller's own tenant, and nothing should -- an agency does not raise
 * its own quota.
 *
 * They were gated on `requirePermission('admin:full')`. Two problems with that.
 * `'admin:full'` is not in the `Permission` union at all, and `permissionMatches`
 * treats a user's `admin:*` as matching anything, so the effective gate was
 * "holds admin:* in SOME tenant" -- which every agency OWNER will. And the
 * tenant in the path was never checked against the caller's, so it was also
 * "...and may then administer ANY tenant's quota".
 *
 * Now: `requirePlatformAdmin`, a capability that exists outside the tenant
 * dimension. The `:tenantId` in the path stays, and is not a Phase 1 violation:
 * it names the OBJECT being administered, not the acting tenant of the caller.
 * The caller's authority comes from the capability; the path says which agency
 * they are pointing it at. Those are different things, and conflating them is
 * what the old gate did.
 *
 * ── The agency's own reading, which had nowhere to come from ─────────────────
 *
 * An agency does not SET its quota, and it does very much need to READ it: the
 * question "how close am I to my ceiling, and how much have I spent" is asked
 * by the agency running into the ceiling, not by the operator who set it.
 * Before `GET /api/v1/quota/summary` existed there was no answer to it that did
 * not go through a platform-only route with a tenant in the path, so the
 * settings page asked one anyway -- about the all-zeros tenant, because it had
 * no id and made one up. Three 404s per load, and the page never showed a
 * figure.
 *
 * So the read is its own surface, and it is scoped the way everything
 * agency-scoped in this API is scoped: `resolveTenant`, from the authenticated
 * principal, with no id anywhere in the path, the query or a header. It is
 * READ-ONLY. Nothing below it writes, and the write routes stay exactly as
 * platform-gated as they were -- an agency still cannot raise its own ceiling,
 * which is the whole reason quotas mean anything.
 *
 * Two things it deliberately does not answer with:
 *
 *   - The budget override token. It exists to BYPASS the hard stop, so handing
 *     it to the agency the stop is protecting the platform from would make the
 *     stop decorative. It is minted and read on the platform routes only.
 *   - The Slack webhook URL, which is a posting credential. The agency is told
 *     whether one is configured, which is what the screen needs to say.
 *
 * A missing quota or budget row is 200 with `null`, not 404. No row means no
 * ceiling has been set for this agency, which is a legitimate state and the
 * common one -- answering "not found" for it is how the placeholder page came
 * to look identical to a page asking about a tenant that does not exist.
 *
 * `platform-admin.test.ts` pins that an agency OWNER is refused 403 on
 * `GET /admin/api/v1/tenants/<their own id>/quota`, "because quotas are not
 * theirs to see". That stays true of the platform surface and is what the
 * assertion is about: an agency may not reach the routes that administer
 * ceilings, its own included, and may not mint the token that bypasses them.
 * Being told the ceiling it is already being enforced against is a different
 * question, and refusing to answer it did not keep anything secret -- the
 * agency learns the number the moment a call is refused for concurrency or a
 * hard stop lands. It only meant the agency had to find out by being cut off.
 */
export async function registerQuotaRoutes(fastify: FastifyInstance) {
  // ==========================================================================
  // Agency-scoped, read-only
  // ==========================================================================

  /**
   * GET /api/v1/quota/summary
   *
   * This agency's ceilings, its spend, and how close it is to both.
   *
   * The tenant comes from `resolveTenant` and from nowhere else: there is no id
   * to pass, so there is nothing for a caller to change to ask about somebody
   * else. A platform operator who has entered no agency gets the same
   * `409 NO_ACTING_TENANT` every agency-scoped route answers them with, and the
   * settings page does not ask in that state at all.
   *
   * Everyone authenticated inside the agency may read it. It is the same
   * information the agency runs into anyway -- a call refused for concurrency,
   * a hard stop at the monthly cap -- and being told the number before hitting
   * it is the point of the screen.
   */
  fastify.get('/api/v1/quota/summary', { preHandler: [authenticate] }, async (request, reply) => {
    const tenantId = resolveTenant(request, reply);
    if (!tenantId) return;

    const reading = await readQuotaAndUsage(tenantId);

    /*
     * A tenant the principal is authenticated against, which does not exist.
     * Not reachable through the front door; answered rather than thrown so the
     * page shows "nothing configured" instead of an error boundary.
     */
    if (!reading) {
      return reply.send({ data: { quota: null, budget: null, status: null } });
    }

    const { quota, budget, status } = reading;

    return reply.send({
      data: {
        quota: quota
          ? {
              maxConcurrentCalls: quota.maxConcurrentCalls,
              maxMinutesPerDay: quota.maxMinutesPerDay,
              maxRecordingRetentionDays: quota.maxRecordingRetentionDays,
              maxPhoneNumbers: quota.maxPhoneNumbers,
              maxStorageGB: quota.maxStorageGB === null ? null : Number(quota.maxStorageGB),
              enabled: quota.enabled,
            }
          : null,
        /*
         * Named field by field rather than spread, and that is the security
         * property rather than a style: `overrideToken` and `alertSlackWebhook`
         * are both on this row, and spreading a Prisma row is how a credential
         * reaches a browser. Adding a field here is a decision; spreading one
         * in is an accident.
         */
        budget: budget
          ? {
              monthlyBudget: budget.monthlyBudget === null ? null : Number(budget.monthlyBudget),
              dailyBudget: budget.dailyBudget === null ? null : Number(budget.dailyBudget),
              alertThreshold: Number(budget.alertThreshold),
              alertEmails: budget.alertEmails,
              alertSlackWebhookConfigured: Boolean(budget.alertSlackWebhook),
              hardStopEnabled: budget.hardStopEnabled,
              enabled: budget.enabled,
            }
          : null,
        status,
      },
    });
  });

  // ==========================================================================
  // Platform-scoped: administering a named agency's quota
  // ==========================================================================

  // Get tenant quota
  fastify.get(
    '/admin/api/v1/tenants/:tenantId/quota',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const prisma = getPrismaClient();
      const { tenantId } = request.params as { tenantId: string };

      const quota = await prisma.tenantQuota.findUnique({
        where: { tenantId },
      });

      if (!quota) {
        reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Quota not found' } };
      }

      return quota;
    }
  );

  // Update tenant quota
  fastify.patch(
    '/admin/api/v1/tenants/:tenantId/quota',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const prisma = getPrismaClient();
      const { tenantId } = request.params as { tenantId: string };
      const body = request.body as any;
      const user = (request as any).user;

      const before = await prisma.tenantQuota.findUnique({
        where: { tenantId },
      });

      if (!before) {
        // Create quota if it doesn't exist
        const quota = await prisma.tenantQuota.create({
          data: {
            tenantId,
            maxConcurrentCalls: body.maxConcurrentCalls,
            maxMinutesPerDay: body.maxMinutesPerDay,
            maxRecordingRetentionDays: body.maxRecordingRetentionDays,
            maxPhoneNumbers: body.maxPhoneNumbers,
            maxStorageGB: body.maxStorageGB,
            enabled: body.enabled ?? true,
          },
        });

        await auditCreate(
          tenantId,
          'TenantQuota',
          quota.id,
          quota,
          {
            userId: user?.userId,
            ipAddress: request.ip,
            requestId: (request as any).id,
          }
        );

        return quota;
      }

      /*
       * `keep()` and not `??`, and the difference is the whole feature.
       *
       * Every one of these ceilings is nullable, and null MEANS something: no
       * limit. With `??` a null coalesced to the stored value, so clearing a
       * ceiling was silently a no-op -- the form's "Unlimited" placeholder was
       * a lie, and an operator who emptied a field and saved was told it had
       * saved while the old ceiling stayed enforced. An absent field still
       * leaves the stored value alone, which is what a partial PATCH means.
       */
      const after = await prisma.tenantQuota.update({
        where: { tenantId },
        data: {
          maxConcurrentCalls: keep(body.maxConcurrentCalls, before.maxConcurrentCalls),
          maxMinutesPerDay: keep(body.maxMinutesPerDay, before.maxMinutesPerDay),
          maxRecordingRetentionDays: keep(
            body.maxRecordingRetentionDays,
            before.maxRecordingRetentionDays
          ),
          maxPhoneNumbers: keep(body.maxPhoneNumbers, before.maxPhoneNumbers),
          maxStorageGB: keep(body.maxStorageGB, before.maxStorageGB),
          enabled: body.enabled ?? before.enabled,
        },
      });

      await auditUpdate(
        tenantId,
        'TenantQuota',
        after.id,
        before,
        after,
        {
          userId: user?.userId,
          ipAddress: request.ip,
          requestId: (request as any).id,
        }
      );

      return after;
    }
  );

  // Get tenant budget
  fastify.get(
    '/admin/api/v1/tenants/:tenantId/budget',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const prisma = getPrismaClient();
      const { tenantId } = request.params as { tenantId: string };

      const budget = await prisma.tenantBudget.findUnique({
        where: { tenantId },
        include: {
          alerts: {
            orderBy: { sentAt: 'desc' },
            take: 10,
          },
        },
      });

      if (!budget) {
        reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Budget not found' } };
      }

      return budget;
    }
  );

  // Update tenant budget
  fastify.patch(
    '/admin/api/v1/tenants/:tenantId/budget',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const prisma = getPrismaClient();
      const { tenantId } = request.params as { tenantId: string };
      const body = request.body as any;
      const user = (request as any).user;

      const before = await prisma.tenantBudget.findUnique({
        where: { tenantId },
      });

      if (!before) {
        const budget = await prisma.tenantBudget.create({
          data: {
            tenantId,
            monthlyBudget: body.monthlyBudget,
            dailyBudget: body.dailyBudget,
            alertThreshold: body.alertThreshold ?? 80,
            alertEmails: body.alertEmails ?? [],
            alertSlackWebhook: body.alertSlackWebhook,
            hardStopEnabled: body.hardStopEnabled ?? true,
            enabled: body.enabled ?? true,
          },
        });

        await auditCreate(
          tenantId,
          'TenantBudget',
          budget.id,
          budget,
          {
            userId: user?.userId,
            ipAddress: request.ip,
            requestId: (request as any).id,
          }
        );

        return budget;
      }

      const after = await prisma.tenantBudget.update({
        where: { tenantId },
        data: {
          // Nullable and meaningful when null, as above: an emptied cap is an
          // uncapped agency, not an unchanged one.
          monthlyBudget: keep(body.monthlyBudget, before.monthlyBudget),
          dailyBudget: keep(body.dailyBudget, before.dailyBudget),
          alertThreshold: body.alertThreshold ?? before.alertThreshold,
          alertEmails: body.alertEmails ?? before.alertEmails,
          /*
           * The one field a caller cannot clear by sending null, deliberately:
           * the settings page never displays the webhook back (it is a posting
           * credential), so a form that submits its own blank field must not
           * take that as "delete it".
           */
          alertSlackWebhook: body.alertSlackWebhook ?? before.alertSlackWebhook,
          hardStopEnabled: body.hardStopEnabled ?? before.hardStopEnabled,
          enabled: body.enabled ?? before.enabled,
        },
      });

      await auditUpdate(
        tenantId,
        'TenantBudget',
        after.id,
        before,
        after,
        {
          userId: user?.userId,
          ipAddress: request.ip,
          requestId: (request as any).id,
        }
      );

      return after;
    }
  );

  // Generate override token
  fastify.post(
    '/admin/api/v1/tenants/:tenantId/budget/override-token',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const prisma = getPrismaClient();
      const { tenantId } = request.params as { tenantId: string };
      const body = request.body as { expiresInHours?: number };
      const user = (request as any).user;

      const budget = await prisma.tenantBudget.findUnique({
        where: { tenantId },
      });

      if (!budget) {
        reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Budget not found' } };
      }

      // Generate secure token
      const token = `qot_${randomBytes(32).toString('hex')}`;
      const expiresInHours = body.expiresInHours ?? 24;
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + expiresInHours);

      await prisma.tenantBudget.update({
        where: { tenantId },
        data: {
          overrideToken: token,
          overrideTokenExpiresAt: expiresAt,
        },
      });

      await auditCreate(
        tenantId,
        'BudgetOverrideToken',
        budget.id,
        {
          tokenGenerated: true,
          expiresAt: expiresAt.toISOString(),
        },
        {
          userId: user?.userId,
          ipAddress: request.ip,
          requestId: (request as any).id,
        }
      );

      return {
        token,
        expiresAt: expiresAt.toISOString(),
        expiresInHours,
      };
    }
  );

  // Revoke override token
  fastify.delete(
    '/admin/api/v1/tenants/:tenantId/budget/override-token',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const prisma = getPrismaClient();
      const { tenantId } = request.params as { tenantId: string };
      const user = (request as any).user;

      await prisma.tenantBudget.update({
        where: { tenantId },
        data: {
          overrideToken: null,
          overrideTokenExpiresAt: null,
        },
      });

      await auditCreate(
        tenantId,
        'BudgetOverrideToken',
        tenantId,
        {
          tokenRevoked: true,
        },
        {
          userId: user?.userId,
          ipAddress: request.ip,
          requestId: (request as any).id,
        }
      );

      return { success: true };
    }
  );

  // Get quota status (current usage)
  fastify.get(
    '/admin/api/v1/tenants/:tenantId/quota/status',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const { tenantId } = request.params as { tenantId: string };

      const reading = await readQuotaAndUsage(tenantId);

      if (!reading) {
        reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Tenant not found' } };
      }

      return reading.status;
    }
  );

  // Create quota override
  fastify.post(
    '/admin/api/v1/tenants/:tenantId/quota/overrides',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const prisma = getPrismaClient();
      const { tenantId } = request.params as { tenantId: string };
      const body = request.body as {
        quotaType: string;
        overrideValue?: number;
        reason: string;
        expiresInHours?: number;
      };
      const user = (request as any).user;

      const expiresAt = body.expiresInHours
        ? new Date(Date.now() + body.expiresInHours * 60 * 60 * 1000)
        : null;

      const override = await prisma.quotaOverride.create({
        data: {
          tenantId,
          quotaType: body.quotaType,
          overrideValue: body.overrideValue,
          reason: body.reason,
          expiresAt,
          createdBy: user?.userId,
        },
      });

      await auditCreate(
        tenantId,
        'QuotaOverride',
        override.id,
        override,
        {
          userId: user?.userId,
          ipAddress: request.ip,
          requestId: (request as any).id,
        }
      );

      reply.code(201);
      return override;
    }
  );

  // List quota overrides
  fastify.get(
    '/admin/api/v1/tenants/:tenantId/quota/overrides',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const prisma = getPrismaClient();
      const { tenantId } = request.params as { tenantId: string };

      const overrides = await prisma.quotaOverride.findMany({
        where: {
          tenantId,
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } },
          ],
        },
        orderBy: { createdAt: 'desc' },
      });

      return { data: overrides };
    }
  );

  // Delete quota override
  fastify.delete(
    '/admin/api/v1/tenants/:tenantId/quota/overrides/:overrideId',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const prisma = getPrismaClient();
      const { tenantId, overrideId } = request.params as { tenantId: string; overrideId: string };
      const user = (request as any).user;

      // Scoped to the tenant named in the path. Deleting by override id alone
      // let a mismatched path delete another tenant's override while writing
      // an audit row that named this one.
      const deleted = await prisma.quotaOverride.deleteMany({
        where: { id: overrideId, tenantId },
      });

      if (deleted.count === 0) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'Quota override not found' },
        });
      }

      await auditCreate(
        tenantId,
        'QuotaOverride',
        overrideId,
        { deleted: true },
        {
          userId: user?.userId,
          ipAddress: request.ip,
          requestId: (request as any).id,
        }
      );

      return { success: true };
    }
  );
}

/**
 * The value to write for a nullable field in a PATCH body.
 *
 * Absent means "not part of this update", so the stored value stands. Present
 * and null means "no limit", and is written. `??` cannot tell the two apart,
 * which is why clearing a ceiling used to do nothing at all.
 */
function keep<T>(incoming: T | null | undefined, stored: T | null): T | null {
  return incoming === undefined ? stored : incoming;
}

/**
 * One agency's ceilings and its usage against them.
 *
 * Both surfaces in this file read through here, so the figure an agency is
 * shown and the figure an operator is shown are computed once. `null` when
 * there is no such tenant.
 *
 * It takes a tenant id and asks no questions about where that id came from:
 * the platform route passes the object named in its path, the agency route
 * passes what `resolveTenant` derived from the session. Deciding which is
 * legitimate is the caller's job and neither delegates it here.
 */
async function readQuotaAndUsage(tenantId: string) {
  const prisma = getPrismaClient();

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: {
      quota: true,
      budget: true,
    },
  });

  if (!tenant) return null;

  // Get current concurrent calls
  const concurrentCalls = await prisma.call.count({
    where: {
      tenantId,
      status: {
        in: ['INITIATED', 'RINGING', 'ANSWERED'],
      },
    },
  });

  // Get today's minutes
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const todayCalls = await prisma.call.findMany({
    where: {
      tenantId,
      createdAt: {
        gte: todayStart,
        lte: todayEnd,
      },
      duration: { not: null },
    },
    select: { duration: true },
  });

  const todayMinutes = Math.ceil(
    todayCalls.reduce((sum, call) => sum + (call.duration || 0), 0) / 60
  );

  // Get current phone numbers
  const phoneNumbers = await prisma.phoneNumber.count({
    where: {
      tenantId,
      status: 'ACTIVE',
    },
  });

  const status = {
    concurrentCalls: {
      current: concurrentCalls,
      limit: tenant.quota?.maxConcurrentCalls ?? null,
      remaining: tenant.quota?.maxConcurrentCalls
        ? Math.max(0, tenant.quota.maxConcurrentCalls - concurrentCalls)
        : null,
    },
    dailyMinutes: {
      current: todayMinutes,
      limit: tenant.quota?.maxMinutesPerDay ?? null,
      remaining: tenant.quota?.maxMinutesPerDay
        ? Math.max(0, tenant.quota.maxMinutesPerDay - todayMinutes)
        : null,
    },
    phoneNumbers: {
      current: phoneNumbers,
      limit: tenant.quota?.maxPhoneNumbers ?? null,
      remaining: tenant.quota?.maxPhoneNumbers
        ? Math.max(0, tenant.quota.maxPhoneNumbers - phoneNumbers)
        : null,
    },
    budget: tenant.budget
      ? {
          daily: {
            current: Number(tenant.budget.currentDaySpend),
            limit: tenant.budget.dailyBudget ? Number(tenant.budget.dailyBudget) : null,
            percentage: tenant.budget.dailyBudget
              ? (Number(tenant.budget.currentDaySpend) / Number(tenant.budget.dailyBudget)) * 100
              : null,
          },
          monthly: {
            current: Number(tenant.budget.currentMonthSpend),
            limit: tenant.budget.monthlyBudget ? Number(tenant.budget.monthlyBudget) : null,
            percentage: tenant.budget.monthlyBudget
              ? (Number(tenant.budget.currentMonthSpend) / Number(tenant.budget.monthlyBudget)) *
                100
              : null,
          },
        }
      : null,
  };

  return { quota: tenant.quota, budget: tenant.budget, status };
}
