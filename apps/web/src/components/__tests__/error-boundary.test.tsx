import { describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from '../error-boundary';

/**
 * The boundary's own logic.
 *
 * ── What this covers, and what it does not ───────────────────────────────────
 *
 * COVERS: the two pieces of behaviour written in this file — capturing the
 * error into state, and clearing it when `resetKey` changes so navigating away
 * from a broken page is a way out of the message.
 *
 * DOES NOT COVER: that React actually calls these when a child throws during
 * render. That is React's contract, not this component's, and asserting it
 * needs a DOM renderer. `apps/web` runs its suite in a plain Node environment
 * with no jsdom, and adding one to ship a production fix is not a trade worth
 * making here. It is worth making later: a rendering test would pin that the
 * topbar survives a throwing switcher, which is the property this exists for.
 *
 * The crash that prompted the boundary is prevented directly — and tested
 * directly — in `lib/__tests__/api-envelope.test.ts` and in
 * `apps/api/src/__tests__/api-response-contract.test.ts`. The boundary is the
 * second line, for the next mistake rather than this one.
 */

describe('ErrorBoundary', () => {
  it('captures a thrown error into state', () => {
    const error = new Error('s.tenants.map is not a function');
    expect(ErrorBoundary.getDerivedStateFromError(error)).toEqual({ error });
  });

  it('clears the error when the reset key changes', () => {
    /*
     * Without this a boundary stays tripped for the life of the mount. On the
     * dashboard layout that would mean one broken page poisoning every route
     * the operator navigated to afterwards — a smaller version of exactly the
     * lock-out it is meant to prevent.
     */
    const boundary = new ErrorBoundary({ children: null, label: 'This page', resetKey: '/a' });
    boundary.state = { error: new Error('boom') };
    const setState = vi.fn();
    boundary.setState = setState as never;

    boundary.componentDidUpdate({ children: null, label: 'This page', resetKey: '/b' });
    expect(setState).toHaveBeenCalledWith({ error: null });
  });

  it('does not clear the error while the reset key is unchanged', () => {
    // A re-render for any other reason must not silently retry a component
    // that is throwing: that is a render loop, not a recovery.
    const boundary = new ErrorBoundary({ children: null, label: 'This page', resetKey: '/a' });
    boundary.state = { error: new Error('boom') };
    const setState = vi.fn();
    boundary.setState = setState as never;

    boundary.componentDidUpdate({ children: null, label: 'This page', resetKey: '/a' });
    expect(setState).not.toHaveBeenCalled();
  });

  it('does nothing on an update when nothing has failed', () => {
    const boundary = new ErrorBoundary({ children: null, label: 'This page', resetKey: '/a' });
    boundary.state = { error: null };
    const setState = vi.fn();
    boundary.setState = setState as never;

    boundary.componentDidUpdate({ children: null, label: 'This page', resetKey: '/b' });
    expect(setState).not.toHaveBeenCalled();
  });

  it('logs the failure rather than swallowing it', () => {
    /*
     * The only trace of the original crash was a minified frame in a screenshot
     * ("at ew (layout-384525777f2d0156.js)"). A boundary that contained a
     * failure and said nothing to the console would make the next one harder to
     * find, not easier.
     */
    const boundary = new ErrorBoundary({ children: null, label: 'The agency switcher' });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    boundary.componentDidCatch(new Error('boom'), { componentStack: '  at TenantSwitcher' });

    expect(spy).toHaveBeenCalled();
    expect(String(spy.mock.calls[0][0])).toContain('The agency switcher');
    spy.mockRestore();
  });
});
