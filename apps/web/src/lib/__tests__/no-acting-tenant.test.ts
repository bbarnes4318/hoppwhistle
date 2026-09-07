import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The login loop, pinned.
 *
 * ── What happened ────────────────────────────────────────────────────────────
 *
 * A platform admin with no acting tenant loaded the app. `/api/auth/me`
 * answered 200. Every agency-scoped route answered 401, because "no acting
 * tenant" and "not authenticated" were the same refusal. This client reads 401
 * as a dead session: it cleared the token and set `window.location.href` to
 * `/login`. The login page loaded the app, which called an agency-scoped route,
 * which answered 401. Six requests in one second, and the only way back in was
 * deleting the selection row from the production database by hand.
 *
 * Two properties keep it closed, and both are asserted here:
 *
 *   1. A NO_ACTING_TENANT response never clears the token and never navigates.
 *      That holds whatever status carries it — the check is on the code, so a
 *      status change elsewhere cannot reopen the loop.
 *   2. A genuine 401 still does both. The fix must not have quietly disabled
 *      the auto-logout for everyone.
 *
 * This drives the real `ApiClient` through a stubbed `fetch`, rather than
 * asserting on a copy of the logic.
 */

interface StubbedLocation {
  pathname: string;
  href: string;
}

let location: StubbedLocation;
let removed: string[];

function stubResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

beforeEach(() => {
  vi.resetModules();

  location = { pathname: '/dashboard', href: '/dashboard' };
  removed = [];

  const store = new Map<string, string>([['token', 'a-valid-looking-jwt']]);

  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => {
      removed.push(key);
      store.delete(key);
    },
  };

  // Both spellings, because the client reaches for the bare global and
  // `session-token.ts` reaches for `window.localStorage`. A stub with only one
  // of them makes `clearToken()` throw, which the client catches — and the test
  // then passes for the wrong reason.
  vi.stubGlobal('window', {
    location,
    localStorage,
    origin: 'https://agents.netenroll.test',
  });
  vi.stubGlobal('localStorage', localStorage);
  vi.stubGlobal('document', { cookie: '' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the cross-agency refusal never sends the browser to /login', () => {
  it('does not clear the session or navigate on NO_ACTING_TENANT', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          stubResponse(409, {
            error: {
              code: 'NO_ACTING_TENANT',
              message: 'Select an agency to view this.',
            },
          })
        )
      )
    );

    const { apiClient } = await import('../api');
    const response = await apiClient.get('/api/v1/calls');

    expect(response.error?.code).toBe('NO_ACTING_TENANT');
    // The two things that made it a loop.
    expect(location.href, 'the client navigated to the login page').toBe('/dashboard');
    expect(removed, 'the client cleared a live session').not.toContain('token');
  });

  it('does not clear the session even if NO_ACTING_TENANT ever arrives as a 401', async () => {
    // Defence in depth: the redirect is gated on the CODE, so moving the status
    // back to 401 somewhere in the API cannot reopen the loop on its own.
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          stubResponse(401, {
            error: { code: 'NO_ACTING_TENANT', message: 'Select an agency to view this.' },
          })
        )
      )
    );

    const { apiClient } = await import('../api');
    await apiClient.get('/api/v1/calls');

    expect(location.href).toBe('/dashboard');
    expect(removed).not.toContain('token');
  });

  it('still logs out on a genuine authentication failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          stubResponse(401, {
            error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' },
          })
        )
      )
    );

    const { apiClient } = await import('../api');
    await apiClient.get('/api/v1/calls');

    expect(location.href).toBe('/login');
    expect(removed).toContain('token');
  });

  it('recognises the refusal by code, for callers deciding what to render', async () => {
    const { isNoActingTenant } = await import('../api');

    expect(isNoActingTenant({ error: { code: 'NO_ACTING_TENANT' } })).toBe(true);
    expect(isNoActingTenant({ error: { code: 'UNAUTHORIZED' } })).toBe(false);
    expect(isNoActingTenant({})).toBe(false);
  });
});
