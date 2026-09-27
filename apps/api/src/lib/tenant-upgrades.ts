/**
 * The paid upgrades an agency has turned on.
 *
 * ── Where they live ──────────────────────────────────────────────────────────
 *
 * `Tenant.metadata.upgrades`, a JSON array of upgrade keys. There is no column
 * for it on purpose: the set is small, changes rarely, and is only ever read
 * whole, for one tenant, at `/api/auth/me`.
 *
 * ── Read defensively ─────────────────────────────────────────────────────────
 *
 * `metadata` is a JSON blob anybody with database access can have written, so
 * the parser keeps only the known keys and answers `[]` for anything else --
 * absent, not an array, an array of numbers. An upgrade only ever OPENS a
 * screen, so the safe reading of "could not tell" is none, the same posture as
 * `loadTenantWhiteLabel`.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';

import { logger } from './logger.js';
import { getPrismaClient } from './prisma.js';

export const TENANT_UPGRADES = [
  'POWER_DIALER',
  'CARRIER_ROUTING',
  'VOICE_AGENTS',
  'VOICE_STUDIO',
  'PAYROLL_ADMIN',
] as const;

export type TenantUpgrade = (typeof TENANT_UPGRADES)[number];

const KNOWN: ReadonlySet<string> = new Set(TENANT_UPGRADES);

/**
 * The known upgrade keys in a tenant's metadata, de-duplicated, in the order
 * they were stored. Anything that is not a JSON object with an `upgrades`
 * array of strings answers [].
 */
export function tenantUpgrades(metadata: unknown): TenantUpgrade[] {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return [];
  const raw = (metadata as { upgrades?: unknown }).upgrades;
  if (!Array.isArray(raw)) return [];

  const out: TenantUpgrade[] = [];
  for (const value of raw) {
    if (typeof value !== 'string' || !KNOWN.has(value)) continue;
    if (!out.includes(value as TenantUpgrade)) out.push(value as TenantUpgrade);
  }
  return out;
}

/**
 * One tenant's upgrades. No tenant, an unknown tenant, or a read that throws
 * all answer [] -- fail closed, like the white-label flag.
 */
export async function loadTenantUpgrades(
  tenantId: string | null | undefined
): Promise<TenantUpgrade[]> {
  if (!tenantId) return [];
  try {
    const tenant = await getPrismaClient().tenant.findUnique({
      where: { id: tenantId },
      select: { metadata: true },
    });
    return tenantUpgrades(tenant?.metadata);
  } catch (error) {
    logger.warn({
      msg: 'tenant-upgrades: could not read the tenant metadata; treating as none',
      tenantId,
      error,
    });
    return [];
  }
}

export const UPGRADE_REQUIRED = 'UPGRADE_REQUIRED';

/**
 * preHandler for the routes behind one upgrade: 403 UPGRADE_REQUIRED unless
 * the acting tenant has it turned on.
 *
 * Registered with `fastify.addHook('preHandler', requireUpgrade(...))` inside a
 * route plugin, so it covers every route that plugin registers and nothing
 * else (the plugins are registered without `fastify-plugin`, so the hook stays
 * encapsulated). By preHandler time the global /api/v1 authentication has
 * built the principal.
 *
 *   - A platform admin passes: staff operate every agency, upgrade or not.
 *   - No principal, or no acting tenant, passes through to the handler, which
 *     already answers that caller with its own refusal -- the same posture as
 *     `middleware/staff-only.ts`, which only turns away someone it can
 *     identify.
 *   - Otherwise the tenant's upgrades are read (`loadTenantUpgrades`, which
 *     fails closed) and a tenant without this one is refused.
 *
 * `skip` exempts routes that are not a screen of the upgrade -- API-key lead
 * ingestion from a partner, for instance, whose leads should not be dropped
 * because the agency has not turned the dialer on.
 */
export function requireUpgrade(
  upgrade: TenantUpgrade,
  options: { skip?: (request: FastifyRequest) => boolean } = {}
) {
  return async function upgradeGuard(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<FastifyReply | undefined> {
    if (options.skip?.(request)) return undefined;

    const principal = request.user as
      | { tenantId?: string | null; isPlatformAdmin?: boolean }
      | undefined;
    if (!principal) return undefined;
    if (principal.isPlatformAdmin === true) return undefined;

    const tenantId = typeof principal.tenantId === 'string' ? principal.tenantId.trim() : '';
    if (!tenantId) return undefined;

    const upgrades = await loadTenantUpgrades(tenantId);
    if (upgrades.includes(upgrade)) return undefined;

    return reply.code(403).send({
      error: {
        code: UPGRADE_REQUIRED,
        message: 'This is part of an upgrade your agency does not have turned on.',
        upgrade,
      },
    });
  };
}
