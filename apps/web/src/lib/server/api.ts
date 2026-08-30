/**
 * Server-side API access.
 *
 * The browser client in src/lib/api.ts talks to window.location.origin so it
 * always matches the page's protocol. A server render has no origin to borrow,
 * so it goes straight to the API service — through API_INTERNAL_URL when the
 * web container has a private route to it, falling back to the public URL.
 *
 * Nothing here is cached. These pages show a buyer their own money; a stale
 * balance or a call that has already been disputed is worse than a slower page.
 */

import { ApiError } from './errors';

export const API_BASE =
  process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function messageFrom(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const err = (body as { error?: unknown }).error;
    if (typeof err === 'string') return err;
    if (
      err &&
      typeof err === 'object' &&
      typeof (err as { message?: unknown }).message === 'string'
    ) {
      return (err as { message: string }).message;
    }
  }
  return fallback;
}

async function request<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  token: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });

  const parsed = await readBody(res);

  if (!res.ok) {
    throw new ApiError(res.status, messageFrom(parsed, `${method} ${path} failed (${res.status})`));
  }

  return parsed as T;
}

export function apiGet<T>(path: string, token: string): Promise<T> {
  return request<T>('GET', path, token);
}

export function apiPost<T>(path: string, token: string, body?: unknown): Promise<T> {
  return request<T>('POST', path, token, body ?? {});
}

export function apiPatch<T>(path: string, token: string, body?: unknown): Promise<T> {
  return request<T>('PATCH', path, token, body ?? {});
}

/**
 * Panel-level failure containment.
 *
 * A page is a grid of independent panels, each with its own Suspense boundary.
 * One endpoint being down should cost you that panel, not the balance and the
 * call list beside it — so every fetcher is awaited through this and the panel
 * renders an error state in place.
 */
export async function settle<T>(
  promise: Promise<T>
): Promise<{ data: T; error: null } | { data: null; error: string }> {
  try {
    return { data: await promise, error: null };
  } catch (err) {
    const message =
      err instanceof ApiError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Something went wrong';
    return { data: null, error: message };
  }
}
