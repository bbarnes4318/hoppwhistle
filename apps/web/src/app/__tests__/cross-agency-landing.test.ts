import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every page under the dashboard shows the prompt, not a broken page.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────
 *
 * A platform admin who has entered no agency cannot be served agency data:
 * every agency-scoped route answers `409 NO_ACTING_TENANT`. Phase 2 required
 * that this lands them on a prompt to pick an agency rather than on a page full
 * of empty tables, spinners that never resolve, or error banners.
 *
 * The dashboard layout implements that by swapping the ENTIRE children subtree
 * for `<CrossAgencyPrompt />`. That is what makes the rule hold for every page
 * at once rather than page by page: no page component mounts, so none of them
 * fetches anything, so there is nothing for a 409 to break.
 *
 * ── Phase 5: the prompt is the exception, not the entry point ────────────────
 *
 * Three pages now have a platform-wide counterpart -- `/delivery`, `/rating`
 * and `/delivery/settlements` -- and an operator with no acting tenant lands on
 * those rather than on the prompt. They are exempt from the swap and each
 * decides for itself, from `usePlatformContext`, whether to render the
 * platform-wide view or the agency one.
 *
 * The rule below is unchanged for everything else, and the exemption list is
 * pinned so widening it stays a deliberate act.
 *
 * ── What went wrong, and why a test rather than a reading ────────────────────
 *
 * The layout has TWO return paths. The call centre renders fullscreen and
 * returns early, above the swap — so `/call-center` rendered the live queue for
 * an operator with no agency, asked for that agency's calls and metrics, and
 * was refused on every one. One page, missed because it left through a
 * different door.
 *
 * A reading of the file is exactly what missed it. This asserts the property of
 * the file instead: every path that renders `children` also offers the prompt.
 *
 * It is a source-level test on purpose. Rendering the layout needs a DOM, and
 * `apps/web` has no jsdom; what actually needs pinning here is structural —
 * "no return path renders children unguarded" — and that is visible in the
 * source. If a DOM is added later this should become a rendering test.
 */

const LAYOUT = join(__dirname, '..', '(dashboard)', 'layout.tsx');

describe('the cross-agency landing prompt', () => {
  const source = readFileSync(LAYOUT, 'utf8');

  it('offers the prompt on every path that renders children', () => {
    /*
     * Each `{children}` in a return path must be guarded by the `needsAgency`
     * ternary. Counting them is the point: one unguarded `{children}` is one
     * page family an operator can reach in a broken state, which is what
     * happened to the call centre.
     */
    // Only JSX renders, not the `{ children }` in the component's own
    // parameter list, which matches the same shape and is not a render.
    const jsxOnly = source
      .split('\n')
      .filter(line => !line.includes('export default function'))
      .join('\n');

    const rendersChildren = jsxOnly.match(/\{\s*children\s*\}/g) ?? [];
    const guarded = source.match(/needsAgency \? <CrossAgencyPrompt \/> : children/g) ?? [];

    expect(
      rendersChildren.length,
      'A return path renders {children} directly. Every path must render ' +
        '`needsAgency ? <CrossAgencyPrompt /> : children` instead, or a platform admin ' +
        'with no agency selected gets that page full of 409s.'
    ).toBe(0);

    // Both return paths: the standard dashboard, and the fullscreen call centre.
    expect(guarded.length).toBeGreaterThanOrEqual(2);
  });

  it('exempts only the surfaces that have a platform-wide reading', () => {
    /*
     * Four prefixes and one exact path, and each earns its place:
     *
     *   /settings              the signed-in person, not an agency.
     *   /admin                 the platform console.
     *   /rating                every agency's closing percentage, current rate
     *                          and tracking rate, side by side.
     *   /delivery/settlements  every agency's settlements over a date range.
     *   /delivery  (exact)     every agency's calls, applications, block, overrun
     *                          and rate, with platform totals.
     *
     * The last three are Phase 5: NetEnroll staff run the whole platform, so
     * those pages render a platform-wide counterpart rather than a prompt, and
     * entering an agency narrows the same page to it.
     *
     * `/delivery` is EXACT, not a prefix, and that is the part worth pinning:
     * `/delivery/me` is one agent's own numbers and has no cross-agency
     * meaning, so a prefix here would have quietly served it to an operator
     * with no agency and broken it.
     *
     * Pinned because widening this list is how the rule would stop meaning
     * anything: a new entry is a new page that can render broken.
     */
    const list = source.match(/const PLATFORM_WIDE_PREFIXES = \[([\s\S]*?)\];/);
    expect(list, 'the exemption list moved or was renamed').not.toBeNull();

    const prefixes = [...(list?.[1].match(/'([^']+)'/g) ?? [])].map(m => m.replace(/'/g, ''));
    expect(prefixes.sort()).toEqual(['/admin', '/delivery/settlements', '/rating', '/settings']);

    // `/delivery` is exempt only as an exact match.
    expect(source).toMatch(/path === '\/delivery'/);
    expect(
      source.includes("startsWith('/delivery')"),
      "/delivery must be matched exactly, or /delivery/me is served to an operator with no agency"
    ).toBe(false);
  });

  it('keeps the call centre inside the rule, since it returns early', () => {
    // The specific regression. The fullscreen branch must carry the swap too.
    const callCentreBranch = source.slice(source.indexOf('if (isCallCenterPage)'));
    expect(
      callCentreBranch.includes('needsAgency ? <CrossAgencyPrompt /> : children'),
      'the fullscreen call centre branch renders children without the prompt'
    ).toBe(true);
  });

  it('wraps every rendered page in an error boundary', () => {
    // Both return paths, for the same reason: a page that throws must not take
    // the shell — or, on the fullscreen branch, the whole app — with it.
    const boundaries = source.match(/<ErrorBoundary/g) ?? [];
    expect(boundaries.length).toBeGreaterThanOrEqual(2);
  });
});
