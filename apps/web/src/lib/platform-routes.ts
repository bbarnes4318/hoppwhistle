/**
 * Which pages a NetEnroll operator can use without having entered an agency.
 *
 * ── Why this is a module and not two lines in a layout ───────────────────────
 *
 * It used to be a list inside `(dashboard)/layout.tsx`, and each of the three
 * platform-wide pages separately branched on `platform.needsAgency` to pick
 * which view to render. Two decisions about the same question, in two files,
 * with nothing holding them together: the layout could swap the page for
 * "Choose an agency" while the page itself was ready to render every agency's
 * rows. That is precisely the shape of the defect that reached production.
 *
 * So the question has one answer, here, and both the layout and the smoke test
 * that loads these routes in a browser read it from the same place. A route
 * added to the platform-wide set is added once.
 *
 * ── What belongs in each set ─────────────────────────────────────────────────
 *
 * PLATFORM_WIDE is for a page that has a genuine reading across every agency:
 * staff run the whole platform and drilling into one agency is the exception,
 * so the switcher is a filter, not a gate.
 *
 * Everything else keeps the prompt, because there is no cross-agency reading of
 * it. `docs/PLATFORM_ADMIN.md` §2f names each one and why.
 */

/**
 * Prefixes. A page under one of these works platform-wide, and so does
 * anything nested beneath it.
 */
const PLATFORM_WIDE_PREFIXES = ['/settings', '/admin', '/rating', '/delivery/settlements'] as const;

/**
 * Exact paths. `/delivery` is platform-wide; `/delivery/me` is one agent's own
 * numbers and has no cross-agency meaning at all, so it keeps the prompt. A
 * prefix here would have quietly included it.
 */
const PLATFORM_WIDE_EXACT = ['/delivery'] as const;

/**
 * True when this route renders something meaningful for an operator who has
 * entered no agency.
 *
 * A null or empty pathname answers false. That is the safe direction: before
 * the router has told us where we are, showing the prompt is wrong but showing
 * an agency page that cannot load is worse. In practice the layout does not
 * render either until it knows who the user is — see `(dashboard)/layout.tsx`.
 */
export function worksWithoutActingTenant(pathname: string | null | undefined): boolean {
  const path = normalise(pathname);
  if (!path) return false;

  if (PLATFORM_WIDE_EXACT.some(exact => exact === path)) return true;
  return PLATFORM_WIDE_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * The pathname as this module compares it.
 *
 * A trailing slash is dropped, so `/delivery/` is `/delivery`. Next normalises
 * that itself today, but the exact match above is one character away from
 * silently failing if anything in front of the app ever stops doing so, and the
 * cost of being explicit is one line.
 */
function normalise(pathname: string | null | undefined): string {
  const path = (pathname ?? '').trim();
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path;
}

/** The routes that must render platform-wide. Read by the browser smoke test. */
export const PLATFORM_WIDE_LANDING_ROUTES = [
  '/delivery',
  '/rating',
  '/delivery/settlements',
] as const;
