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

  it('exempts only the two surfaces that are not agency data', () => {
    /*
     * `/settings` is about the signed-in person and `/admin` is the platform
     * console. Everything else under this layout renders one agency's data.
     *
     * Pinned because widening this list is how the rule would quietly stop
     * meaning anything: a new prefix here is a new page that can render broken.
     */
    const exemption = source.match(/const worksWithoutAgency =\s*([\s\S]*?);/);
    expect(exemption, 'the exemption list moved or was renamed').not.toBeNull();

    const prefixes = [...(exemption?.[1].match(/startsWith\('([^']+)'\)/g) ?? [])].map(m =>
      m.replace(/startsWith\('|'\)/g, '')
    );
    expect(prefixes.sort()).toEqual(['/admin', '/settings']);
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
