// URL canonicalization + validation helpers used during evidence normalization.

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'fbclid',
  'mc_cid',
  'mc_eid',
  'ref',
  'ref_src',
]);

/** Return a normalized form of a URL for deduplication. Preserves the original. */
export function canonicalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = '';
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    // strip tracking params
    const keep = new URLSearchParams();
    const entries = Array.from(u.searchParams.entries()).sort(([a], [b]) => a.localeCompare(b));
    for (const [k, v] of entries) {
      if (!TRACKING_PARAMS.has(k.toLowerCase())) keep.set(k, v);
    }
    u.search = keep.toString();
    // drop trailing slash on path (but keep root)
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.replace(/\/+$/, '');
    }
    return u.toString();
  } catch {
    return raw.trim();
  }
}

export function isValidHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function domainOf(raw: string): string | null {
  try {
    return new URL(raw.trim()).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}
