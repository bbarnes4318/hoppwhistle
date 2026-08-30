/**
 * The bridge between the browser's session token and the server render.
 *
 * Auth in this app is a JWT the login page puts in localStorage, which a server
 * component cannot read: there is no server session to check, which is why
 * every dashboard page so far has been a client component fetching in an
 * effect. Mirroring the same token into a cookie is what lets a page render on
 * the server with the user's own scope already applied.
 *
 * The cookie is deliberately NOT HttpOnly — it cannot be, because the value is
 * written by client JavaScript from localStorage. That means it carries exactly
 * the same exposure the localStorage copy already had and no more; it is not a
 * new attack surface, and it is not a substitute for one. SameSite=Lax keeps it
 * off cross-site requests, and it is marked Secure whenever the page is HTTPS.
 */

export const SESSION_COOKIE = 'hw_session';

/** Matches the JWT lifetime the API issues; the token is re-set on every login. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function cookieAttributes(): string {
  const secure = typeof window !== 'undefined' && window.location.protocol === 'https:';
  return `Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function readSessionCookie(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${SESSION_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** Write the token to both stores. Call this everywhere a token is obtained. */
export function persistSessionToken(token: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem('token', token);
  document.cookie = `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${cookieAttributes()}`;
}

export function clearSessionToken(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem('token');
  document.cookie = `${SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/**
 * Bring the cookie up to date with localStorage. Returns true when it had to
 * change something — the caller uses that to trigger one router.refresh(), so a
 * session that predates this cookie re-renders with auth instead of showing a
 * signed-out page until the next navigation.
 */
export function syncSessionCookie(): boolean {
  if (typeof window === 'undefined') return false;
  const stored = window.localStorage.getItem('token');
  const current = readSessionCookie();
  if (stored && stored !== current) {
    persistSessionToken(stored);
    return true;
  }
  if (!stored && current) {
    clearSessionToken();
    return true;
  }
  return false;
}
