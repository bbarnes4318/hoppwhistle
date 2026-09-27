/**
 * The upgrades catalog: prices, and an agency asking for one.
 *
 *   GET   /api/v1/upgrades                        the acting agency's catalog
 *   POST  /api/v1/upgrades/:key/request           ask for one (OWNER/ADMIN)
 *
 *   GET   /api/v1/admin/upgrade-prices            NetEnroll's price per upgrade
 *   PUT   /api/v1/admin/upgrade-prices            { prices: [{ key, monthlyCents, setupCents }] }
 *   GET   /api/v1/admin/upgrade-requests          every agency's requests, OPEN first
 *   PATCH /api/v1/admin/upgrade-requests/:id      { status: 'DONE' | 'DECLINED' }
 *
 * ── What a request is ────────────────────────────────────────────────────────
 *
 * A note that the agency wants it, and an email to whoever can turn it on
 * (`services/upgrade-request-email.ts`): a downline agency's parent, or
 * NetEnroll's platform admins. It turns nothing on. There is at most one OPEN
 * request per agency per upgrade (a partial unique index), so pressing the
 * button twice returns the same one. Turning the upgrade on -- Admin ->
 * Agencies, or a parent's settings for its child -- marks it DONE
 * (`markUpgradeRequestsDone`).
 *
 * ── Prices ───────────────────────────────────────────────────────────────────
 *
 * In cents, monthly and setup, either of them null for "Ask for pricing". One
 * catalog for every agency: a white-label parent sells its children upgrades
 * at whatever it agrees with them, which is not recorded here.
 */

import { Prisma, RoleName } from '@prisma/client';
import type { FastifyInstance } from 'fastify';

import { requirePlatformAdmin } from '../lib/platform-context.js';
import { getPrismaClient } from '../lib/prisma.js';
import { getActingUserId, resolveTenant } from '../lib/tenant-context.js';
import {
  isTenantUpgrade,
  TENANT_UPGRADES,
  tenantUpgrades,
  UPGRADE_NAMES,
} from '../lib/tenant-upgrades.js';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { auditLog } from '../services/audit.js';
import { sendUpgradeRequestEmail } from '../services/upgrade-request-email.js';

export const UPGRADE_REQUEST_STATUSES = ['OPEN', 'DONE', 'DECLINED'] as const;

/** The most a price may be, in cents: $1,000,000. Anything more is a typo. */
const MAX_CENTS = 100_000_000;

function isCents(value: unknown): value is number | null {
  return (
    value === null ||
    (Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_CENTS)
  );
}

/** Every key with its price, null where none is set. */
async function priceTable(): Promise<
  Array<{ key: string; monthlyCents: number | null; setupCents: number | null }>
> {
  const rows = await getPrismaClient().upgradePrice.findMany();
  const byKey = new Map(rows.map(row => [row.key, row]));
  return TENANT_UPGRADES.map(key => ({
    key,
    monthlyCents: byKey.get(key)?.monthlyCents ?? null,
    setupCents: byKey.get(key)?.setupCents ?? null,
  }));
}

/**
 * One tenant's OPEN requests, oldest first. The parent's agency page shows
 * these beside the switches that close them.
 */
export async function openUpgradeRequests(tenantId: string) {
  const rows = await getPrismaClient().upgradeRequest.findMany({
    where: { tenantId, status: 'OPEN' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, upgradeKey: true, status: true, createdAt: true, userId: true },
  });
  return rows.map(row => ({
    id: row.id,
    upgradeKey: row.upgradeKey,
    upgradeName: isTenantUpgrade(row.upgradeKey) ? UPGRADE_NAMES[row.upgradeKey] : row.upgradeKey,
    status: row.status,
    userId: row.userId,
    createdAt: row.createdAt.toISOString(),
  }));
}

function notFound() {
  return { error: { code: 'NOT_FOUND', message: 'Upgrade not found' } };
}

// eslint-disable-next-line @typescript-eslint/require-await -- plugin signature
export async function registerUpgradeRoutes(fastify: FastifyInstance): Promise<void> {
  const prisma = getPrismaClient();

  /**
   * GET /api/v1/upgrades
   *
   * Every upgrade, in catalog order, with its price, whether the acting agency
   * has it on, and whether it has asked for it.
   */
  fastify.get('/api/v1/upgrades', { preHandler: [authenticate] }, async (request, reply) => {
    const tenantId = resolveTenant(request, reply);
    if (!tenantId) return;

    const [tenant, prices, open] = await Promise.all([
      prisma.tenant.findUnique({ where: { id: tenantId }, select: { metadata: true } }),
      priceTable(),
      prisma.upgradeRequest.findMany({
        where: { tenantId, status: 'OPEN' },
        select: { upgradeKey: true },
      }),
    ]);
    const on = new Set<string>(tenantUpgrades(tenant?.metadata));
    const requested = new Set(open.map(row => row.upgradeKey));

    return reply.send({
      data: prices.map(price => ({
        ...price,
        on: on.has(price.key),
        requestOpen: !on.has(price.key) && requested.has(price.key),
      })),
    });
  });

  /**
   * POST /api/v1/upgrades/:key/request
   *
   * 201 with the new OPEN request, or 200 with the one already open. 409 when
   * the upgrade is already on, 400 for a key that is not an upgrade. The email
   * is best-effort: `emailed` is how many people it reached, and zero does not
   * fail the request.
   */
  fastify.post<{ Params: { key: string } }>(
    '/api/v1/upgrades/:key/request',
    { preHandler: [authenticate, requireRole(RoleName.OWNER, RoleName.ADMIN)] },
    async (request, reply) => {
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;

      const key = request.params.key;
      if (!isTenantUpgrade(key)) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: `key must be one of: ${TENANT_UPGRADES.join(', ')}`,
          },
        });
      }

      const tenant = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, name: true, parentTenantId: true, metadata: true },
      });
      if (!tenant) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Agency not found' } });
      }
      if (tenantUpgrades(tenant.metadata).includes(key)) {
        return reply.code(409).send({
          error: { code: 'ALREADY_ON', message: `${UPGRADE_NAMES[key]} is already turned on.` },
        });
      }

      const existing = await prisma.upgradeRequest.findFirst({
        where: { tenantId, upgradeKey: key, status: 'OPEN' },
      });
      if (existing) {
        return reply.send({ data: { ...requestView(existing), created: false, emailed: 0 } });
      }

      const userId = getActingUserId(request);
      let created;
      try {
        created = await prisma.upgradeRequest.create({
          data: { tenantId, upgradeKey: key, userId },
        });
      } catch (error) {
        // Two presses at once: the partial unique index lets one through, and
        // the other returns the request that won.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const winner = await prisma.upgradeRequest.findFirst({
            where: { tenantId, upgradeKey: key, status: 'OPEN' },
          });
          if (winner) {
            return reply.send({ data: { ...requestView(winner), created: false, emailed: 0 } });
          }
        }
        throw error;
      }

      await auditLog({
        tenantId,
        userId: userId ?? undefined,
        action: 'upgrade.requested',
        entityType: 'upgrade_request',
        entityId: created.id,
        changes: { upgradeKey: key },
      });

      const [requester, price] = await Promise.all([
        userId
          ? prisma.user.findUnique({
              where: { id: userId },
              select: { email: true, firstName: true, lastName: true },
            })
          : null,
        prisma.upgradePrice.findUnique({ where: { key } }),
      ]);
      const requesterName = requester
        ? [[requester.firstName, requester.lastName].filter(Boolean).join(' '), requester.email]
            .filter(Boolean)
            .join(', ')
        : null;

      const emailed = await sendUpgradeRequestEmail({
        tenantId,
        tenantName: tenant.name,
        parentTenantId: tenant.parentTenantId,
        upgradeKey: key,
        upgradeName: UPGRADE_NAMES[key],
        requestedBy: requesterName,
        monthlyCents: price?.monthlyCents ?? null,
        setupCents: price?.setupCents ?? null,
      });

      return reply.code(201).send({ data: { ...requestView(created), created: true, emailed } });
    }
  );

  /** GET /api/v1/admin/upgrade-prices -- every key, null where unpriced. */
  fastify.get(
    '/api/v1/admin/upgrade-prices',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (_request, reply) => {
      return reply.send({ data: await priceTable() });
    }
  );

  /**
   * PUT /api/v1/admin/upgrade-prices
   *   { prices: [{ key, monthlyCents: number | null, setupCents: number | null }] }
   *
   * Sets the keys it names and leaves the others as they are. Whole cents from
   * 0 to $1,000,000, or null to clear. Answers the whole table.
   */
  fastify.put<{ Body: { prices?: unknown } }>(
    '/api/v1/admin/upgrade-prices',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const prices = (request.body ?? {}).prices;
      const problems: string[] = [];
      if (!Array.isArray(prices) || prices.length === 0) {
        problems.push('prices must be a non-empty array');
      } else {
        for (const entry of prices as Array<Record<string, unknown>>) {
          const key = entry && typeof entry === 'object' ? entry.key : undefined;
          if (!isTenantUpgrade(key)) {
            problems.push(`key must be one of: ${TENANT_UPGRADES.join(', ')}`);
            continue;
          }
          if (!isCents(entry.monthlyCents)) {
            problems.push(`${key}: monthlyCents must be whole cents, 0 or more, or null`);
          }
          if (!isCents(entry.setupCents)) {
            problems.push(`${key}: setupCents must be whole cents, 0 or more, or null`);
          }
        }
      }
      if (problems.length > 0) {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: problems.join('; '), problems },
        });
      }

      const userId = getActingUserId(request);
      const before = await priceTable();
      const rows = prices as Array<{
        key: string;
        monthlyCents: number | null;
        setupCents: number | null;
      }>;
      await prisma.$transaction(
        rows.map(row =>
          prisma.upgradePrice.upsert({
            where: { key: row.key },
            create: {
              key: row.key,
              monthlyCents: row.monthlyCents,
              setupCents: row.setupCents,
              updatedByUserId: userId,
            },
            update: {
              monthlyCents: row.monthlyCents,
              setupCents: row.setupCents,
              updatedByUserId: userId,
            },
          })
        )
      );
      const after = await priceTable();

      await auditLog({
        tenantId: null,
        userId: userId ?? undefined,
        action: 'platform.upgrade_prices_changed',
        entityType: 'upgrade_price',
        changes: { before, after },
      });

      return reply.send({ data: after });
    }
  );

  /**
   * GET /api/v1/admin/upgrade-requests
   *
   * Every agency's requests: all the OPEN ones, then the 200 most recently
   * decided-on, newest first within each, with the agency's name.
   */
  fastify.get(
    '/api/v1/admin/upgrade-requests',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (_request, reply) => {
      const include = { tenant: { select: { name: true, parentTenantId: true } } } as const;
      const [open, closed] = await Promise.all([
        prisma.upgradeRequest.findMany({
          where: { status: 'OPEN' },
          orderBy: { createdAt: 'desc' },
          include,
        }),
        prisma.upgradeRequest.findMany({
          where: { status: { not: 'OPEN' } },
          orderBy: { createdAt: 'desc' },
          take: 200,
          include,
        }),
      ]);
      const ordered = [...open, ...closed];
      return reply.send({
        data: ordered.map(row => ({
          ...requestView(row),
          tenantId: row.tenantId,
          tenantName: row.tenant.name,
          parentTenantId: row.tenant.parentTenantId,
        })),
      });
    }
  );

  /** PATCH /api/v1/admin/upgrade-requests/:id   { status: 'DONE' | 'DECLINED' } */
  fastify.patch<{ Params: { id: string }; Body: { status?: unknown } }>(
    '/api/v1/admin/upgrade-requests/:id',
    { preHandler: [authenticate, requirePlatformAdmin] },
    async (request, reply) => {
      const status = (request.body ?? {}).status;
      if (status !== 'DONE' && status !== 'DECLINED') {
        return reply.code(400).send({
          error: { code: 'VALIDATION_ERROR', message: "status must be 'DONE' or 'DECLINED'" },
        });
      }

      // The id column is a uuid; anything else is simply not a request.
      const id = request.params.id;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        return reply.code(404).send(notFound());
      }
      const existing = await prisma.upgradeRequest.findUnique({ where: { id } });
      if (!existing) return reply.code(404).send(notFound());

      const updated = await prisma.upgradeRequest.update({
        where: { id },
        data: { status, decidedAt: new Date() },
      });

      await auditLog({
        tenantId: existing.tenantId,
        userId: getActingUserId(request) ?? undefined,
        action: 'platform.upgrade_request_decided',
        entityType: 'upgrade_request',
        entityId: id,
        changes: {
          upgradeKey: existing.upgradeKey,
          before: { status: existing.status },
          after: { status },
        },
      });

      return reply.send({ data: requestView(updated) });
    }
  );
}

function requestView(row: {
  id: string;
  tenantId: string;
  upgradeKey: string;
  status: string;
  userId: string | null;
  createdAt: Date;
  decidedAt: Date | null;
}) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    upgradeKey: row.upgradeKey,
    upgradeName: isTenantUpgrade(row.upgradeKey) ? UPGRADE_NAMES[row.upgradeKey] : row.upgradeKey,
    status: row.status,
    userId: row.userId,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
  };
}
