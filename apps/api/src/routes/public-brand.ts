/**
 * The brand a host is drawn in, before anybody has signed in.
 *
 *   GET /api/v1/public/brand?host=agents.lifeleadsplus.com
 *     → { data: { theme, name } }   the tenant whose `Tenant.domain` is that host
 *     → { data: null }              any other host, NetEnroll's own included
 *
 * ── Why a public route ───────────────────────────────────────────────────────
 *
 * Everywhere else the brand comes from the signed-in principal
 * (`brandForTenant`, via `/api/auth/me`). The sign-in page has no principal,
 * and a white-label agency's people arriving at their own domain should still
 * see their agency's logo, name and favicon there rather than NetEnroll's. The
 * domain is the one thing known before sign-in, and `Tenant.domain` is set by
 * NetEnroll staff only, so the host names the brand and nothing else does.
 *
 * ── What it may say ──────────────────────────────────────────────────────────
 *
 * The theme key and the brand name: exactly what `/api/auth/me` sends as
 * `brand`, and both already public on that domain's own login page. Never the
 * tenant's id, name, slug or status -- a public endpoint that confirmed which
 * agency owns a domain, or handed out an id, would be a lookup table for
 * anybody who asked. A host with no tenant and a tenant with no theme answer
 * the same `{ data: null }`, so the answer does not even say which one it was.
 *
 * ── Cheap to ask ─────────────────────────────────────────────────────────────
 *
 * Every login page render asks, so the answer is cached briefly in process and
 * marked cacheable for a few minutes: a brand changes when staff change it,
 * which is rare, and a few minutes of the old logo on a login page is harmless.
 */

import type { FastifyInstance } from 'fastify';

import { getPrismaClient } from '../lib/prisma.js';
import { brandForTenant, normaliseHost, type TenantBrand } from '../lib/tenant-brand.js';

/** Seconds a browser or proxy may reuse the answer. */
export const PUBLIC_BRAND_MAX_AGE_SECONDS = 300;

/** How long this process reuses a lookup. */
const CACHE_TTL_MS = 60_000;
/** Bounds the cache: hosts are caller-supplied, so it must not grow without end. */
const CACHE_MAX_ENTRIES = 500;

const cache = new Map<string, { brand: TenantBrand | null; expiresAt: number }>();

/** Test hook: forget every cached lookup. */
export function clearPublicBrandCache(): void {
  cache.clear();
}

/**
 * The bare host: lower-cased, port and trailing dot stripped. Null for
 * anything that is not a plausible host name, which is answered as "no brand"
 * without a query. Shared with the portal-domain resolver, so the host a
 * login page is looked up by and the host a link is built from are normalised
 * the same way.
 */
export { normaliseHost };

async function lookup(host: string): Promise<TenantBrand | null> {
  const now = Date.now();
  const hit = cache.get(host);
  if (hit && hit.expiresAt > now) return hit.brand;

  const tenant = await getPrismaClient().tenant.findFirst({
    where: { domain: { equals: host, mode: 'insensitive' } },
    select: { id: true },
  });
  const brand = tenant ? await brandForTenant(tenant.id) : null;

  if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
  cache.set(host, { brand, expiresAt: now + CACHE_TTL_MS });
  return brand;
}

export async function registerPublicBrandRoutes(fastify: FastifyInstance): Promise<void> {
  await Promise.resolve();

  fastify.get<{ Querystring: { host?: string } }>(
    '/api/v1/public/brand',
    async (request, reply) => {
      const host = normaliseHost(request.query.host);
      const brand = host ? await lookup(host) : null;

      void reply.header(
        'Cache-Control',
        `public, max-age=${PUBLIC_BRAND_MAX_AGE_SECONDS}, stale-while-revalidate=60`
      );
      return reply.send({ data: brand ? { theme: brand.theme, name: brand.name } : null });
    }
  );
}
