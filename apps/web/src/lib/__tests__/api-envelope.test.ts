import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `payload()`, and the crash it exists to make impossible.
 *
 * ── What happened ────────────────────────────────────────────────────────────
 *
 * `apiClient`'s `data` is the parsed response BODY, not the payload inside it.
 * `GET /api/v1/platform/tenants` answers `{ data: tenants }`, so the body is an
 * object and the array is one level in. The agency switcher read the body as
 * the array, called `.map` on an object, and threw during render — which
 * unmounted the dashboard layout it lives in and locked every platform admin
 * out of the portal.
 *
 * TypeScript could not catch it: `get<T>` types the body as whatever the caller
 * claims, so `get<PlatformTenant[]>` against an enveloped route is a lie the
 * compiler accepts.
 *
 * The end-to-end contract — real client, real endpoint — is asserted in
 * `apps/api/src/__tests__/api-response-contract.test.ts`, which can boot the
 * server. This suite pins the client-side half: that `payload()` unwraps what
 * it should, and that it returns "nothing" rather than throwing for every shape
 * a component might be handed.
 */

interface StubbedLocation {
  pathname: string;
  href: string;
  origin: string;
}

let location: StubbedLocation;

function stubResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

beforeEach(() => {
  vi.resetModules();
  location = { pathname: '/dashboard', href: '/dashboard', origin: 'https://agents.test' };
  const store = new Map<string, string>([['token', 'a-valid-looking-jwt']]);
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  };
  vi.stubGlobal('window', { location, localStorage, origin: location.origin });
  vi.stubGlobal('localStorage', localStorage);
  vi.stubGlobal('document', { cookie: '' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('payload()', () => {
  it('returns the value inside the envelope', async () => {
    const { payload } = await import('../api');
    expect(payload({ data: { data: [{ id: 't1' }] } })).toEqual([{ id: 't1' }]);
    expect(payload({ data: { data: { calendarDay: '2026-09-08' } } })).toEqual({
      calendarDay: '2026-09-08',
    });
  });

  it('returns undefined rather than throwing for anything that is not an envelope', async () => {
    /*
     * Every one of these reached a component in some form during the incident.
     * A boundary catches a throw; not throwing in the first place is better,
     * and "there is nothing to render" is a state every caller already handles.
     */
    const { payload } = await import('../api');

    expect(payload({} as never)).toBeUndefined();
    expect(payload({ data: undefined } as never)).toBeUndefined();
    expect(payload({ data: null } as never)).toBeUndefined();
    // A bare-body route: the payload is the body, and there is no `data` key.
    expect(payload({ data: { isPlatformAdmin: true } } as never)).toBeUndefined();
    // An array body, which is what the switcher wrongly expected.
    expect(payload({ data: [1, 2, 3] } as never)).toBeUndefined();
    expect(payload({ data: 'a string' } as never)).toBeUndefined();
    // A refusal.
    expect(payload({ error: { code: 'FORBIDDEN', message: 'no' } } as never)).toBeUndefined();
  });

  it('preserves a null payload, which is a legitimate value', async () => {
    // `actingTenant: null` means "no agency selected" and must not be confused
    // with "the response could not be read".
    const { payload } = await import('../api');
    expect(payload({ data: { data: null } })).toBeNull();
  });
});

describe('the switcher’s data path, against the shape the server actually sends', () => {
  it('produces an array from an enveloped body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          stubResponse(200, { data: [{ id: 't1', name: 'Ridgeline', slug: 'r', status: 'ACTIVE' }] })
        )
      )
    );

    const { apiClient, payload } = await import('../api');
    const response = await apiClient.get<{ data: Array<{ name: string }> }>(
      '/api/v1/platform/tenants'
    );

    const tenants = payload(response);
    expect(Array.isArray(tenants)).toBe(true);
    // The exact call that threw in production.
    expect((tenants ?? []).map(t => t.name)).toEqual(['Ridgeline']);
  });

  it('shows the raw body is the envelope, which is what made the old read wrong', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(stubResponse(200, { data: [{ id: 't1' }] })))
    );

    const { apiClient } = await import('../api');
    const response = await apiClient.get('/api/v1/platform/tenants');

    // `response.data` is NOT the array. Reading it as one and calling `.map`
    // is the whole bug, in one assertion.
    expect(Array.isArray(response.data)).toBe(false);
    expect(() => (response.data as unknown as unknown[]).map(x => x)).toThrow(TypeError);
  });
});
