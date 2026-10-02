import { isBrandThemeKey, type BrandThemeKey } from '@hopwhistle/shared';

import { logger } from './logger.js';
import { getPrismaClient } from './prisma.js';

/**
 * An agency's white-label brand, as `/api/auth/me` reports it.
 *
 * `theme` is a key from BRAND_THEME_KEYS; the web app draws the logo and the
 * palette from it. `name` is what the portal should call itself, or null to use
 * the theme's own name.
 */
export interface TenantBrand {
  theme: BrandThemeKey;
  name: string | null;
}

/**
 * The brand of ONE tenant, named by the caller.
 *
 * ── Which tenant is the caller's decision, and it must come from the principal
 *
 * This reads whatever tenant it is given. Deciding which tenant that is --
 * the user's own agency, or the one a platform admin has entered -- belongs to
 * the authenticated principal alone. Nothing on the wire (a header, a query
 * parameter, a cookie) may name it, or one agency's session could be drawn in
 * another's brand.
 *
 * Null when there is no tenant (a platform admin in the cross-agency view), the
 * tenant has no theme, or the stored key is not one this build knows: a value
 * that fails validation is rendered as the default, never passed through.
 *
 * ── A child agency is drawn in its parent's brand ────────────────────────────
 *
 * A downline agency is sold under the white-label that onboarded it, so where
 * the child's own theme or name is null the PARENT's is used -- read on every
 * call, never copied onto the child, so a parent that changes its brand
 * changes every child's with it.
 */
export async function brandForTenant(
  tenantId: string | null | undefined
): Promise<TenantBrand | null> {
  if (!tenantId) return null;

  const tenant = await getPrismaClient().tenant.findUnique({
    where: { id: tenantId },
    select: {
      brandTheme: true,
      brandName: true,
      parent: { select: { brandTheme: true, brandName: true } },
    },
  });
  if (!tenant) return null;

  const theme = tenant.brandTheme ?? tenant.parent?.brandTheme ?? null;
  const name = tenant.brandName ?? tenant.parent?.brandName ?? null;

  if (!isBrandThemeKey(theme)) return null;
  return { theme, name };
}

// ════════════════════════════════════════════════════════════════════════════
// The portal a tenant's people are sent to
// ════════════════════════════════════════════════════════════════════════════
//
// One application, one database, several public hostnames. NetEnroll's own
// agencies sign in at agents.netenroll.com; a white-label agency that has its
// own domain (`Tenant.domain`, set by NetEnroll staff only) signs in there, and
// so do the child agencies it onboards. Every link a person is sent -- an
// invitation, a password reset, a "view this call" -- is built from the answer
// below, so that a white-label agency's people are never pointed at NetEnroll.
//
// ── Presentation only. Never authentication. ─────────────────────────────────
//
// This answers "which host should a link to tenant X use". It never answers
// the reverse, "which tenant is this host" -- that question has no place in
// authentication. The acting tenant is `request.user.tenantId`
// (`lib/tenant-context.ts`) and a host header changes nothing about it. The
// one reverse lookup that exists, `routes/public-brand.ts`, picks a login
// page's logo and nothing else.

/** NetEnroll's own portal: the address when neither a tenant nor its parent has one. */
export const NETENROLL_PORTAL_URL = 'https://agents.netenroll.com';

/**
 * The default portal: `APP_URL`, else agents.netenroll.com. No trailing slash.
 *
 * This is the address for every tenant with no domain of its own (and no
 * white-label parent with one), and for mail that belongs to no tenant. It is
 * NOT where a white-label agency's links go: pointing APP_URL at a
 * white-label domain would send every NetEnroll agency there.
 */
export function defaultPortalUrl(): string {
  const configured = process.env.APP_URL?.trim();
  return (configured || NETENROLL_PORTAL_URL).replace(/\/+$/, '');
}

/**
 * The bare host: lower-cased, port and trailing dot stripped. Null for
 * anything that is not a plausible host name.
 */
export function normaliseHost(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let host = raw.trim().toLowerCase();
  if (!host || host.length > 253) return null;
  // `[::1]:3000` -- an IPv6 literal is never a tenant domain.
  if (host.startsWith('[')) return null;
  host = host.replace(/:\d*$/, '').replace(/\.$/, '');
  return /^[a-z0-9.-]+$/.test(host) ? host : null;
}

/**
 * A stored `Tenant.domain` as a bare host. Tolerates a value written as a URL
 * (`https://agents.example.com/`), which older rows may hold; the scheme and
 * any path are dropped. Null for nothing usable.
 */
export function portalHost(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const bare = raw
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .replace(/[/?#].*$/, '');
  return normaliseHost(bare);
}

/** The host of the default portal, for callers that want a domain rather than a URL. */
export function defaultPortalHost(): string {
  try {
    return new URL(defaultPortalUrl()).host;
  } catch {
    return new URL(NETENROLL_PORTAL_URL).host;
  }
}

/**
 * The tenant's own portal domain, else its parent's, else null.
 *
 * Read on every call and never copied onto the child, exactly like the brand
 * above: a child agency has no domain of its own, and a parent that moves
 * domain moves every child's links with it.
 *
 * Never throws. A read that fails is logged and answers null (the default
 * portal): a link must not be lost over which host it names.
 */
export async function configuredPortalDomain(
  tenantId: string | null | undefined
): Promise<string | null> {
  if (!tenantId) return null;
  try {
    const tenant = await getPrismaClient().tenant.findUnique({
      where: { id: tenantId },
      select: { domain: true, parent: { select: { domain: true } } },
    });
    return portalHost(tenant?.domain) ?? portalHost(tenant?.parent?.domain) ?? null;
  } catch (error) {
    logger.warn({
      msg: 'portal domain: could not read the tenant; using the default portal',
      tenantId,
      error,
    });
    return null;
  }
}

/**
 * The host a tenant's people use: `tenant.domain`, else `parent.domain`, else
 * the default portal's host (agents.netenroll.com).
 *
 *   NetEnroll agency                → agents.netenroll.com
 *   white-label parent with domain  → its domain
 *   that parent's child agency      → the parent's domain
 *   no tenant                       → agents.netenroll.com
 */
export async function portalDomainForTenant(tenantId: string | null | undefined): Promise<string> {
  return (await configuredPortalDomain(tenantId)) ?? defaultPortalHost();
}

/**
 * `portalDomainForTenant` as a link base: `https://<domain>`, or the default
 * portal URL as configured (which keeps `http://localhost:3000` working in
 * development). No trailing slash. Build every tenant-facing link from this.
 */
export async function portalUrlForTenant(tenantId: string | null | undefined): Promise<string> {
  const domain = await configuredPortalDomain(tenantId);
  return domain ? `https://${domain}` : defaultPortalUrl();
}
