import { clearSessionToken, persistSessionToken } from './session-token';

// Use window.location.origin in the browser so requests always match the
// current protocol/domain (avoids Mixed Content blocks when the build-time
// NEXT_PUBLIC_API_URL was baked with an http:// address).
const API_URL =
  typeof window !== 'undefined'
    ? window.location.origin
    : process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

/**
 * The API's answer to "you are authenticated, you are NetEnroll staff, and you
 * have entered no agency."
 *
 * Distinct from an authentication failure on purpose: signing in again does
 * nothing for it, and picking an agency fixes it. Anything rendering agency
 * data should show the cross-agency view and a prompt to choose, never a login
 * page. See `apps/api/src/lib/tenant-context.ts`.
 */
export const NO_ACTING_TENANT = 'NO_ACTING_TENANT';

/** Whether a failed response means "pick an agency" rather than "sign in". */
export function isNoActingTenant(response: { error?: { code: string } }): boolean {
  return response.error?.code === NO_ACTING_TENANT;
}

/**
 * What a call to this client returns.
 *
 * ── `data` is the RESPONSE BODY, not the payload inside it ───────────────────
 *
 * This is the single most important thing to know about this type, and not
 * knowing it put a crash into production. `request()` returns `{ data }` where
 * `data` is the parsed body exactly as the server sent it. It does not unwrap
 * anything.
 *
 * So for a route that answers with a bare object:
 *
 *     reply.send({ isPlatformAdmin: true })   ->  response.data.isPlatformAdmin
 *
 * and for a route that answers with an envelope:
 *
 *     reply.send({ data: tenants })           ->  response.data.data
 *
 * The generic `T` therefore describes the BODY. Declaring
 * `get<PlatformTenant[]>('/api/v1/platform/tenants')` against an enveloped
 * route type-checks and is wrong: the body is `{ data: PlatformTenant[] }`, so
 * `response.data` is an object, `.map` is undefined, and the component throws.
 * That is exactly what happened to the agency switcher.
 *
 * TypeScript cannot catch it, because `T` is whatever the caller claims. So for
 * an enveloped route, say so in the type and unwrap it by name:
 *
 *     const response = await apiClient.get<Envelope<PlatformTenant[]>>(path);
 *     const tenants = payload(response) ?? [];
 *
 * `apps/api/src/__tests__/api-response-contract.test.ts` drives the real
 * endpoints through this real client and fails if a route's shape and its
 * caller's accessor ever disagree again.
 */
export interface ApiResponse<T> {
  data?: T;
  error?: {
    code: string;
    message: string;
  };
  meta?: {
    page?: number;
    limit?: number;
    total?: number;
    totalPages?: number;
  };
}

/**
 * The body shape of a route that answers `reply.send({ data: ... })`.
 *
 * Every route under `/api/v1/platform/*`, `/api/v1/delivery/*` and
 * `/api/v1/rating/*` does. Naming it makes the envelope visible at the call
 * site rather than something a reader has to know.
 */
export type Envelope<T> = { data: T };

/**
 * The payload inside an enveloped response, or `undefined`.
 *
 * `undefined` for a failed request and for a body that is not an envelope --
 * both are "there is nothing to render", and both are cases a caller has to
 * handle anyway. It never throws: a malformed response should leave a component
 * with no data, not unmount the tree above it.
 *
 * Three ad-hoc copies of this unwrap existed before it did, each written by
 * somebody who had just been caught by the same thing.
 */
export function payload<T>(response: ApiResponse<Envelope<T>>): T | undefined {
  const body = response.data;
  if (!body || typeof body !== 'object' || !('data' in body)) return undefined;
  return body.data;
}

export interface RequestOptions {
  /**
   * `text` hands back the raw body untouched. CSV exports need this: a file
   * whose first cell happens to be a number would otherwise be JSON-parsed
   * into a number and the rest of the download thrown away.
   */
  responseType?: 'json' | 'text';
}

/**
 * Whether this browser is caught in a sign-out loop, and should stop.
 *
 * ── Why the code check above is not enough on its own ────────────────────────
 *
 * The redirect is gated on the error CODE, so a refusal that says
 * `NO_ACTING_TENANT` never signs anybody out however it is delivered. That
 * guards the case Phase 2 named, and it is not the only way to reach the loop.
 *
 * A route that answers a live session with a bare `401 UNAUTHORIZED` is
 * indistinguishable, here, from a genuinely dead token: same status, same code.
 * That is not hypothetical -- fourteen routes were doing exactly that for a
 * platform admin with no agency selected, six of them on the softphone surface,
 * and the gate above let every one of them through. The server-side fix is the
 * load-bearing one, and `no-acting-tenant-audit.test.ts` is what keeps it
 * fixed.
 *
 * This is the fallback for the next one nobody has found yet. The loop's
 * mechanism is: refuse -> clear -> navigate to /login -> the app loads ->
 * refuse again. Breaking the navigation breaks the loop. Above the threshold
 * the client stops redirecting and leaves the person where they are, with a
 * console line saying why: a page they can read and navigate away from is
 * recoverable, and a browser cycling through six requests a second is not.
 *
 * The counter resets on its own after the window, so an ordinary sign-out
 * tomorrow behaves normally.
 */
const LOGOUT_LOOP_KEY = 'auth:logout-redirects';
const LOGOUT_LOOP_WINDOW_MS = 30_000;
const LOGOUT_LOOP_LIMIT = 3;

export function loopingOnLogout(now: number = Date.now()): boolean {
  try {
    const raw = window.localStorage.getItem(LOGOUT_LOOP_KEY);
    const previous = raw ? (JSON.parse(raw) as { count: number; firstAt: number }) : null;

    const state =
      previous && now - previous.firstAt < LOGOUT_LOOP_WINDOW_MS
        ? { count: previous.count + 1, firstAt: previous.firstAt }
        : { count: 1, firstAt: now };

    window.localStorage.setItem(LOGOUT_LOOP_KEY, JSON.stringify(state));

    if (state.count > LOGOUT_LOOP_LIMIT) {
      // eslint-disable-next-line no-console
      console.error(
        `[auth] ${state.count} sign-out redirects in ${LOGOUT_LOOP_WINDOW_MS / 1000}s. ` +
          'Refusing to redirect again: a route is answering a live session with a bare 401. ' +
          'Sign in again from /login if this was genuine.'
      );
      return true;
    }
    return false;
  } catch {
    /*
     * Storage can throw -- private browsing, blocked site data. A broken
     * counter must not stop a legitimate sign-out, so the safe answer here is
     * "not looping" and the behaviour falls back to what it was before.
     */
    return false;
  }
}

/** Called after any successful response: we are plainly not in a loop. */
export function clearLogoutLoop(): void {
  try {
    window.localStorage.removeItem(LOGOUT_LOOP_KEY);
  } catch {
    /* nothing to clear if storage is unavailable */
  }
}

class ApiClient {
  private baseUrl: string;
  private token?: string;
  private apiKey?: string;

  constructor(baseUrl: string = API_URL) {
    this.baseUrl = baseUrl;
    // Get API key from environment
    this.apiKey = process.env.NEXT_PUBLIC_API_KEY;
    // Load token from localStorage if available (client-side only)
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem('token') || undefined;
    }
  }

  // Get current token (checks localStorage for most up-to-date value)
  private getAuthToken(): string | undefined {
    if (typeof window !== 'undefined') {
      const storedToken = localStorage.getItem('token');
      if (storedToken) {
        this.token = storedToken;
      }
    }
    return this.token;
  }

  // Both setters go through session-token so the cookie the server render
  // reads never drifts from the localStorage copy the browser client uses.
  setToken(token: string) {
    this.token = token;
    persistSessionToken(token);
  }

  clearToken() {
    this.token = undefined;
    clearSessionToken();
  }

  setApiKey(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    requestOptions: RequestOptions = {}
  ): Promise<ApiResponse<T>> {
    // Check for demo mode
    const demoMode = localStorage.getItem('demoMode') === 'true';
    const demoTenantId = localStorage.getItem('demoTenantId');

    // If demo mode is enabled, add demo tenant header
    if (demoMode && demoTenantId) {
      options.headers = {
        ...options.headers,
        'X-Demo-Tenant-Id': demoTenantId,
      };
    }
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (options.headers) {
      if (options.headers instanceof Headers) {
        options.headers.forEach((value, key) => {
          headers[key] = value;
        });
      } else if (Array.isArray(options.headers)) {
        options.headers.forEach(([key, value]) => {
          headers[key] = value;
        });
      } else {
        Object.assign(headers, options.headers);
      }
    }

    // Get the current auth token (checks localStorage for freshest value)
    const authToken = this.getAuthToken();
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    // Add API key header if available
    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      let data: any = null;
      const text = await response.text();
      if (text) {
        if (requestOptions.responseType === 'text' && response.ok) {
          data = text;
        } else {
          try {
            data = JSON.parse(text);
          } catch (e) {
            data = text;
          }
        }
      }

      if (!response.ok) {
        const code: string = data?.error?.code || 'UNKNOWN_ERROR';

        /*
         * The login redirect, and the one condition it must never fire on.
         *
         * A platform admin who has entered no agency is not signed out. Until
         * Phase 2 the API answered them with 401 on every agency-scoped route,
         * this branch cleared their token and sent them to /login, the login
         * page loaded the app, the app called an agency-scoped route, and the
         * whole thing went round again — six requests in a second, ended only
         * by deleting a row from the production database by hand.
         *
         * The server now says NO_ACTING_TENANT (409) for that case, so it does
         * not reach this branch at all. The code is checked here as well
         * because this is the line that clears somebody's session, and it
         * should be impossible to reintroduce the loop by changing a status
         * code somewhere else.
         */
        if (response.status === 401 && code !== NO_ACTING_TENANT) {
          this.clearToken();
          // Only redirect if we're in a browser and not already on login page,
          // and only if we are not evidently already going round in circles.
          if (
            typeof window !== 'undefined' &&
            !window.location.pathname.includes('/login') &&
            !loopingOnLogout()
          ) {
            window.location.href = '/login';
          }
        }

        return {
          error: {
            code,
            message: data?.error?.message || 'An error occurred',
          },
        };
      }

      // A response came back fine, so whatever the last refusal was, this
      // browser is not cycling through sign-outs.
      if (typeof window !== 'undefined') clearLogoutLoop();

      return { data };
    } catch (error) {
      return {
        error: {
          code: 'NETWORK_ERROR',
          message: error instanceof Error ? error.message : 'Network error',
        },
      };
    }
  }

  async get<T>(endpoint: string, requestOptions?: RequestOptions): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'GET' }, requestOptions);
  }

  async post<T>(endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async put<T>(endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async patch<T>(endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async delete<T>(endpoint: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'DELETE',
      body: body ? JSON.stringify(body) : undefined,
    });
  }
}

export const apiClient = new ApiClient();

// Mock data generators for demo
export const mockData = {
  activeCalls: () => Math.floor(Math.random() * 50) + 10,
  asr: () => Math.random() * 0.3 + 0.4, // 40-70%
  aht: () => Math.floor(Math.random() * 300) + 120, // 120-420 seconds
  billableMinutes: () => Math.floor(Math.random() * 5000) + 1000,
  cpaStats: () => ({
    conversions: Math.floor(Math.random() * 50) + 10,
    revenue: Math.random() * 5000 + 1000,
  }),
};
