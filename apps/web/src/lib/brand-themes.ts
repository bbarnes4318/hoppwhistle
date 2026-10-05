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
  /** Icon only, square, no wordmark. Any collapsed or icon-sized slot. */
  mark: string;
  /** The icon, trimmed and small: the app-icon tile beside the wordmark. */
  markSmall: string;
  /**
   * The horizontal wordmark, transparent, in the artwork's own colours: for
   * white and light grounds.
   */
  wordmark: string;
  /**
   * The same wordmark, transparent, lettering reversed out for a dark ground:
   * the navy rail, the mobile drawer and the sign-in panel. Never set on a
   * plate.
   */
  wordmarkOnDark: string;
  /**
   * The wordmark files' intrinsic canvas. Omitted, the 900×154 every wordmark
   * shipped at first; a stacked wordmark gives its own so it fills the slot's
   * width instead of sitting small inside a borrowed canvas.
   */
  wordmarkSize?: { width: number; height: number };
  /**
   * The full lockup (wordmark and tagline), reversed out for a dark ground:
   * the sign-in panel, where there is room for the tagline to read. Omitted,
   * the panel shows `wordmarkOnDark`.
   */
  lockupOnDark?: { src: string; width: number; height: number };
  favicon: string;
  appleTouchIcon: string;
}

export const BRAND_THEMES: Record<BrandThemeKey, BrandTheme> = {
  'life-leads-plus': {
    name: 'Life Leads Plus',
    mark: '/brands/life-leads-plus/mark.png',
    markSmall: '/brands/life-leads-plus/mark-128.png',
    wordmark: '/brands/life-leads-plus/wordmark.png',
    wordmarkOnDark: '/brands/life-leads-plus/wordmark-on-dark.png',
    favicon: '/brands/life-leads-plus/favicon-32.png',
    appleTouchIcon: '/brands/life-leads-plus/apple-touch-icon.png',
  },
  'powerhouse-insurance': {
    name: 'Powerhouse Insurance',
    mark: '/brands/powerhouse-insurance/mark.png',
    markSmall: '/brands/powerhouse-insurance/mark-128.png',
    wordmark: '/brands/powerhouse-insurance/wordmark.png',
    wordmarkOnDark: '/brands/powerhouse-insurance/wordmark-on-dark.png',
    wordmarkSize: { width: 900, height: 233 },
    lockupOnDark: { src: '/brands/powerhouse-insurance/logo.png', width: 1087, height: 371 },
    favicon: '/brands/powerhouse-insurance/favicon-32.png',
    appleTouchIcon: '/brands/powerhouse-insurance/apple-touch-icon.png',
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
