import { describe, expect, it } from 'vitest';

import { PLATFORM_WIDE_LANDING_ROUTES, worksWithoutActingTenant } from '@/lib/platform-routes';

/**
 * Which pages a NetEnroll operator can use without having entered an agency.
 *
 * This used to be asserted by reading `layout.tsx` as text and regex-matching
 * the shape of the expression inside it. That test passed throughout the phase
 * in which the page it describes was broken in production, which is about as
 * clear a statement of the limits of that approach as one could ask for: it
 * checked that somebody had written the intended code, not that the code
 * answered the intended question.
 *
 * The decision is a function now, so it can simply be called.
 */
describe('worksWithoutActingTenant', () => {
  it('is true for the four surfaces with a genuine cross-agency reading', () => {
    /*
     *   /settings              the signed-in person, not an agency.
     *   /admin                 the platform console.
     *   /rating                every agency's closing percentage, current rate
     *                          and tracking rate, side by side.
     *   /delivery/settlements  every agency's settlements over a date range.
     *   /delivery  (exact)     every agency's calls, applications, block,
     *                          overrun and rate, with platform totals.
     */
    for (const path of [
      '/settings',
      '/settings/security',
      '/admin',
      '/admin/onboarding',
      '/rating',
      '/delivery/settlements',
      '/delivery',
    ]) {
      expect(worksWithoutActingTenant(path), path).toBe(true);
    }
  });

  it('keeps the prompt on /delivery/me, which is one agent and not a platform view', () => {
    // The reason `/delivery` is an exact match rather than a prefix. An agent's
    // own numbers have no cross-agency reading at all, so serving that page to
    // an operator with no agency would show them an empty, refused page.
    expect(worksWithoutActingTenant('/delivery/me')).toBe(false);
  });

  it('keeps the prompt on everything else under the dashboard', () => {
    for (const path of [
      '/dashboard',
      '/calls',
      '/call-center',
      '/publisher/dashboard',
      '/buyer/dashboard',
      '/campaigns',
      '/numbers',
    ]) {
      expect(worksWithoutActingTenant(path), path).toBe(false);
    }
  });

  it('does not treat a prefix as a path segment boundary by accident', () => {
    // `/ratings-archive` starts with `/rating` as a STRING. It is not under
    // `/rating` as a ROUTE, and a `startsWith` with no separator would have
    // exempted it.
    expect(worksWithoutActingTenant('/ratings-archive')).toBe(false);
    expect(worksWithoutActingTenant('/administration')).toBe(false);
    expect(worksWithoutActingTenant('/settings-export')).toBe(false);
  });

  it('ignores a trailing slash', () => {
    expect(worksWithoutActingTenant('/delivery/')).toBe(true);
    expect(worksWithoutActingTenant('/rating/')).toBe(true);
  });

  it('answers false when the router has not said where we are', () => {
    // The safe direction, though in practice the layout renders neither the
    // page nor the prompt until it knows -- see `settling` there.
    expect(worksWithoutActingTenant(null)).toBe(false);
    expect(worksWithoutActingTenant(undefined)).toBe(false);
    expect(worksWithoutActingTenant('')).toBe(false);
  });

  it('lists the three landing routes the browser smoke test loads', () => {
    // Pinned so that widening it stays a deliberate act: a new entry is a new
    // page that can render broken for an operator with no agency, and the
    // browser test reads this list to know what to open.
    expect([...PLATFORM_WIDE_LANDING_ROUTES].sort()).toEqual([
      '/delivery',
      '/delivery/settlements',
      '/rating',
    ]);
    for (const route of PLATFORM_WIDE_LANDING_ROUTES) {
      expect(worksWithoutActingTenant(route), route).toBe(true);
    }
  });
});
