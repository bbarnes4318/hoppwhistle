/**
 * Per-agency brand themes: the only values `Tenant.brandTheme` may hold.
 *
 * One list, read by both sides. The API validates a platform admin's choice
 * against it and the web app keys its logo/colour registry
 * (`apps/web/src/lib/brand-themes.ts`) by it, so a theme cannot exist on one
 * side and not the other.
 *
 * Adding a client: append its key here, add its palette block to
 * `apps/web/src/app/globals.css`, its entry to the web registry, and its
 * assets under `apps/web/public/brands/<key>/`.
 */
export const BRAND_THEME_KEYS = ['life-leads-plus'] as const;

export type BrandThemeKey = (typeof BRAND_THEME_KEYS)[number];

export function isBrandThemeKey(value: unknown): value is BrandThemeKey {
  return typeof value === 'string' && (BRAND_THEME_KEYS as readonly string[]).includes(value);
}
