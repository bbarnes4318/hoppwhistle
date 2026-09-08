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
 * ── What is left here, now that the pages are rendered for real ─────────────
 *
 * `platform-landing.render.test.tsx` renders this layout in jsdom and
 * `apps/web/e2e/platform-landing.smoke.mjs` loads it in Chromium against the
 * real API, so the BEHAVIOUR is no longer asserted by reading source — which is
 * the right way round, because reading source is what missed the defect that
 * shipped.
 *
 * One property survives here, and only because it genuinely is structural: no
 * return path may render `children` unguarded. A rendering test can only cover
 * the paths it thinks to visit, and the call-centre regression was precisely a
 * path nobody thought to visit. Counting the return paths in the file covers
 * all of them at once, including one added tomorrow.
 *
 * The exemption list moved to `src/lib/platform-routes.ts` and is asserted by
 * calling it — see `src/lib/__tests__/platform-routes.test.ts`.
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
    const guarded =
      source.match(
        /settling \? <SettlingPlaceholder \/> : needsAgency \? <CrossAgencyPrompt \/> : children/g
      ) ?? [];

    expect(
      rendersChildren.length,
      'A return path renders {children} directly. Every path must go through ' +
        'the settling/needsAgency swap instead, or a platform admin with no agency ' +
        'selected gets that page full of 409s.'
    ).toBe(0);

    // Both return paths: the standard dashboard, and the fullscreen call centre.
    expect(guarded.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the exemption decision in one place rather than inline', () => {
    /*
     * The list used to be declared in this file, and each of the three
     * platform-wide pages separately branched on `platform.needsAgency` to pick
     * its view. Two decisions about the same question, and nothing holding them
     * together -- which is the shape of the defect that reached production.
     *
     * There is one answer now, in `@/lib/platform-routes`, asserted by calling
     * it in `src/lib/__tests__/platform-routes.test.ts`. This only checks that
     * the layout still asks it rather than growing a second copy.
     */
    expect(source).toMatch(/worksWithoutActingTenant\(pathname\)/);
    expect(
      source.includes('PLATFORM_WIDE_PREFIXES'),
      'the layout has its own copy of the exemption list again'
    ).toBe(false);
  });

  it('waits for the platform context before acting on roles', () => {
    /*
     * The production defect, and the reason it is worth pinning in the source
     * as well as in a rendering test: `isPlatformAdmin` is false until
     * /api/v1/platform/context answers, so reading it alone as "not staff" sent
     * an operator who also held PUBLISHER off /delivery before the answer
     * arrived. Anybody deleting this guard as redundant should see this.
     */
    expect(
      source,
      'the role redirect acts on the platform context before it has loaded'
    ).toMatch(/if \(platform\.loading \|\| platform\.isPlatformAdmin\) return;/);
  });

  it('keeps the call centre inside the rule, since it returns early', () => {
    // The specific regression. The fullscreen branch must carry the swap too.
    const callCentreBranch = source.slice(source.indexOf('if (isCallCenterPage)'));
    expect(
      callCentreBranch.includes('needsAgency ? <CrossAgencyPrompt /> : children'),
      'the fullscreen call centre branch renders children without the prompt'
    ).toBe(true);
    expect(
      callCentreBranch.includes('settling ? <SettlingPlaceholder />'),
      'the fullscreen call centre branch mounts the page before it knows who the user is'
    ).toBe(true);
  });

  it('wraps every rendered page in an error boundary', () => {
    // Both return paths, for the same reason: a page that throws must not take
    // the shell — or, on the fullscreen branch, the whole app — with it.
    const boundaries = source.match(/<ErrorBoundary/g) ?? [];
    expect(boundaries.length).toBeGreaterThanOrEqual(2);
  });
});
