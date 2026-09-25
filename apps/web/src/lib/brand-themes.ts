import { BRAND_THEME_KEYS, isBrandThemeKey, type BrandThemeKey } from '@hopwhistle/shared';

/**
 * Per-agency brand themes: what each one looks like.
 *
 * ── What a theme is ──────────────────────────────────────────────────────────
 *
 * The same portal, re-skinned by tenant. A theme is a logo, a mark, a favicon
 * and a palette; the palette is a `[data-brand='<key>']` block in
 * `app/globals.css` that overrides the brand tokens and nothing else. Which
 * theme applies is decided by the server: `/api/auth/me` resolves it from the
 * authenticated principal (the user's own agency, or the agency a platform
 * admin has entered) and the client only renders what it is told. Nothing here
 * reads a URL, a cookie or localStorage, so one agency's session can never be
 * shown another's brand.
 *
 * The keys are `BRAND_THEME_KEYS` from `@hopwhistle/shared`, the same list the
 * API validates against. Adding a client is one entry here, one block in
 * globals.css, one key there and one folder under `public/brands/`.
 */

export interface BrandTheme {
  /** The agency's name, as the product should say it. */
  name: string;
  /** The full lockup, transparent. The sidebar and the mobile nav. */
  logo: string;
  /** Icon only, square, no wordmark. Any collapsed or icon-sized slot. */
  mark: string;
  favicon: string;
  appleTouchIcon: string;
}

export const BRAND_THEMES: Record<BrandThemeKey, BrandTheme> = {
  'life-leads-plus': {
    name: 'Life Leads Plus',
    logo: '/brands/life-leads-plus/logo.png',
    mark: '/brands/life-leads-plus/mark.png',
    favicon: '/brands/life-leads-plus/favicon-32.png',
    appleTouchIcon: '/brands/life-leads-plus/apple-touch-icon.png',
  },
};

/** The brand as `/api/auth/me` sends it. */
export interface ServerBrand {
  theme: string;
  name: string | null;
}

/** A resolved, renderable brand: the registry entry plus the key it came from. */
export interface ActiveBrand extends BrandTheme {
  key: BrandThemeKey;
}

/**
 * The server's brand, resolved against this build's registry.
 *
 * A key this build does not know -- a theme added on the API before the web
 * deploy that carries its assets -- renders as the default rather than as a
 * half-branded page with a broken logo.
 */
export function resolveBrand(brand: ServerBrand | null | undefined): ActiveBrand | null {
  if (!brand || !isBrandThemeKey(brand.theme)) return null;
  const theme = BRAND_THEMES[brand.theme];
  return { ...theme, key: brand.theme, name: brand.name?.trim() || theme.name };
}

/** The options the platform-admin control offers, default first. */
export const BRAND_THEME_OPTIONS: { value: BrandThemeKey | null; label: string }[] = [
  { value: null, label: 'NetEnroll (default)' },
  ...BRAND_THEME_KEYS.map(key => ({ value: key, label: BRAND_THEMES[key].name })),
];
