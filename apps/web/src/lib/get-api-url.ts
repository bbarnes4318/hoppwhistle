/**
 * Returns the correct API base URL for the current environment.
 *
 * In the browser we always use `window.location.origin` so that requests
 * automatically match the page's protocol and domain.  This avoids Mixed
 * Content blocks that happen when the build-time NEXT_PUBLIC_API_URL was
 * compiled with an http:// address but the page is served over HTTPS.
 *
 * During SSR (server components / Node) we fall back to the env var.
 */
export function getApiUrl(): string {
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
}
