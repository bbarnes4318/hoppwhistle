/**
 * The brand a request's host is drawn in, before anybody has signed in.
 *
 * Signed in, the brand comes from the session (`/api/auth/me`, see
 * `lib/brand-themes.ts`). The sign-in page and the document's title and
 * favicon are rendered before there is a session, so for those the server asks
 * the API which brand owns the host the request arrived on
 * (`GET /api/v1/public/brand?host=`). A white-label agency's own domain gets
 * its logo, name and favicon; agents.netenroll.com, and any host no agency
 * owns, stays NetEnroll.
 *
 * It only ever chooses between public looks -- the theme key and the name are
 * already on that domain's login page -- so a forged Host header can do no
 * more than show somebody a different agency's logo on their own screen.
 *
 * Any failure (the API down, slow, or answering something unexpected) is
 * "no brand": the NetEnroll login page is always a working login page.
 */

import type { Metadata } from 'next';
import { headers } from 'next/headers';

import { resolveBrand, type ActiveBrand, type ServerBrand } from '@/lib/brand-themes';

import { API_BASE } from './api';

/** The product name, and the default look, when no agency owns the host. */
export const DEFAULT_PRODUCT_NAME = 'NetEnroll';

/** Seconds the web server reuses one host's answer. A brand rarely changes. */
const REVALIDATE_SECONDS = 300;
/** A login page must not wait on a slow API for its logo. */
const TIMEOUT_MS = 2000;

interface HeaderSource {
  get(name: string): string | null;
}

/**
 * The host the browser asked for: the proxy's `x-forwarded-host` when there is
 * one (its first entry), else `host`. Port included; the API strips it.
 */
export function requestHost(source: HeaderSource): string | null {
  const forwarded = source.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host = forwarded || source.get('host')?.trim();
  return host || null;
}

function isServerBrand(value: unknown): value is ServerBrand {
  if (!value || typeof value !== 'object') return false;
  const v = value as { theme?: unknown; name?: unknown };
  return typeof v.theme === 'string' && (v.name === null || typeof v.name === 'string');
}

/** Ask the API which brand owns `host`. Null for none, and for any failure. */
export async function fetchPublicBrand(
  host: string | null,
  fetcher: typeof fetch = fetch
): Promise<ServerBrand | null> {
  if (!host) return null;
  try {
    const res = await fetcher(`${API_BASE}/api/v1/public/brand?host=${encodeURIComponent(host)}`, {
      headers: { Accept: 'application/json' },
      next: { revalidate: REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: unknown } | null;
    const brand = body?.data;
    return isServerBrand(brand) ? { theme: brand.theme, name: brand.name } : null;
  } catch {
    return null;
  }
}

/** The brand for the request being rendered, as the API sent it. */
export async function serverBrandForRequest(): Promise<ServerBrand | null> {
  return fetchPublicBrand(requestHost(headers()));
}

/** The brand for the request being rendered, resolved against this build's themes. */
export async function brandForRequest(): Promise<ActiveBrand | null> {
  return resolveBrand(await serverBrandForRequest());
}

/**
 * The document metadata a brand decides: the title and its template, the
 * application name, and the icons. NetEnroll's own when there is no brand.
 */
export function brandMetadata(brand: ActiveBrand | null): Metadata {
  if (!brand) {
    return {
      title: { default: DEFAULT_PRODUCT_NAME, template: `%s · ${DEFAULT_PRODUCT_NAME}` },
      applicationName: DEFAULT_PRODUCT_NAME,
      /*
       * The supplied square mark, `public/net-enroll-favicon.png`, resized. PNG
       * only: the artwork arrived as pixels, so there is no vector favicon to
       * offer and a stale favicon.svg would win over these on every browser
       * that prefers SVG.
       */
      icons: {
        icon: [
          { url: '/favicon-32.png', type: 'image/png', sizes: '32x32' },
          { url: '/icon-512.png', type: 'image/png', sizes: '512x512' },
        ],
        apple: '/apple-touch-icon.png',
      },
    };
  }
  return {
    title: { default: brand.name, template: `%s · ${brand.name}` },
    applicationName: brand.name,
    // Same slots as NetEnroll's, so <BrandThemeSync> re-points the same links.
    icons: {
      icon: [
        { url: brand.favicon, type: 'image/png', sizes: '32x32' },
        { url: brand.mark, type: 'image/png', sizes: '512x512' },
      ],
      apple: brand.appleTouchIcon,
    },
  };
}
