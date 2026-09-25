import { isBrandThemeKey, type BrandThemeKey } from '@hopwhistle/shared';

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
 */
export async function brandForTenant(
  tenantId: string | null | undefined
): Promise<TenantBrand | null> {
  if (!tenantId) return null;

  const tenant = await getPrismaClient().tenant.findUnique({
    where: { id: tenantId },
    select: { brandTheme: true, brandName: true },
  });

  if (!tenant || !isBrandThemeKey(tenant.brandTheme)) return null;
  return { theme: tenant.brandTheme, name: tenant.brandName ?? null };
}
