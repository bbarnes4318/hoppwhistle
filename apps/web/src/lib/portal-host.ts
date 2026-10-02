/**
 * Keeping a white-label agency's people on their own host.
 *
 * An agency with its own portal domain (or a white-label parent's) must only
 * ever be served from that host: sessions are host-only, so an agent who ends up
 * on agents.netenroll.com is on the wrong brand, the wrong login and a
 * different sign-in from the one their agency gave them. The API tells the
 * client which host that is (`portalDomain`); this decides whether the browser
 * is somewhere else and, if so, where to send it.
 *
 * Pure so it can be tested without a browser.
 */

/** A host a person cannot be "wrong" on: local development and bare IPs. */
function isDevelopmentHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) ||
    hostname.startsWith('[')
  );
}

/**
 * The URL to move to, or null when the browser is already on the right host.
 *
 * `portalDomain` is null for an agency on the default portal, which never
 * redirects: only an agency with a domain of its own has a host to be wrong
 * about.
 */
export function portalRedirectTarget(
  portalDomain: string | null | undefined,
  location: { hostname: string; pathname: string; search: string; protocol: string }
): string | null {
  if (!portalDomain) return null;

  const wanted = portalDomain.trim().toLowerCase();
  const current = location.hostname.trim().toLowerCase();

  if (!wanted || current === wanted || isDevelopmentHost(current)) return null;

  return `https://${wanted}${location.pathname}${location.search}`;
}
