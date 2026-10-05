/**
 * The sign-in page on a white-label agency's own domain, RENDERED.
 *
 * There is no session on /login, so the brand comes from the host the request
 * arrived on: the server asks the API's public brand endpoint and hands the
 * answer to the page. A branded host shows that agency's logo and name, and
 * its title and favicon; agents.netenroll.com and any host no agency owns,
 * and any failure to ask, stay NetEnroll.
 *
 * `next/headers` is stubbed with the request's host and `fetch` with the API,
 * so the real layout, the real helper and the real page run end to end.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LoginBrandLogo, LoginBrandProvider } from '@/components/brand/login-brand';
import {
  brandMetadata,
  fetchPublicBrand,
  requestHost,
  serverBrandForRequest,
} from '@/lib/server/public-brand';

import LoginLayout, { generateMetadata } from '../layout';
import AuthPage from '../page';

let requestHeaders = new Headers({ host: 'agents.netenroll.com' });
let asked: string[] = [];

/** The hosts the stubbed API knows. */
const BRANDS: Record<string, { theme: string; name: string | null }> = {
  'portal.lifeleadsplus.test': { theme: 'life-leads-plus', name: 'Life Leads Plus' },
  'agents.lifeleadsplus.com': { theme: 'life-leads-plus', name: 'Life Leads Plus' },
};

vi.mock('next/headers', () => ({ headers: () => requestHeaders }));

vi.mock('next/script', () => ({ default: () => null }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/login',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: null, isLoading: false, refetch: () => Promise.resolve() }),
}));

class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function installApi(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw);
      asked.push(`${url.pathname}${url.search}`);
      if (url.pathname !== '/api/v1/public/brand') return json({ error: 'nope' }, 404);
      const host = (url.searchParams.get('host') ?? '').toLowerCase().replace(/:\d+$/, '');
      return json({ data: BRANDS[host] ?? null });
    })
  );
}

async function renderLogin(): Promise<void> {
  render(await LoginLayout({ children: <AuthPage /> }));
}

beforeEach(() => {
  asked = [];
  requestHeaders = new Headers({ host: 'agents.netenroll.com' });
  vi.stubGlobal('ResizeObserver', StubResizeObserver);
  installApi();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the host a request came in on', () => {
  it('is the proxy forwarded host when there is one, else Host', () => {
    expect(requestHost(new Headers({ host: 'web:3000' }))).toBe('web:3000');
    expect(
      requestHost(
        new Headers({ host: 'web:3000', 'x-forwarded-host': 'portal.lifeleadsplus.test, proxy' })
      )
    ).toBe('portal.lifeleadsplus.test');
    expect(requestHost(new Headers())).toBeNull();
  });
});

describe('fetchPublicBrand', () => {
  it("asks the API for the host's brand", async () => {
    expect(await fetchPublicBrand('Portal.LifeLeadsPlus.test:443')).toEqual({
      theme: 'life-leads-plus',
      name: 'Life Leads Plus',
    });
    expect(asked).toEqual(['/api/v1/public/brand?host=Portal.LifeLeadsPlus.test%3A443']);
  });

  it('is no brand for an unknown host, a failure, or a malformed answer', async () => {
    expect(await fetchPublicBrand('agents.netenroll.com')).toBeNull();
    expect(await fetchPublicBrand(null)).toBeNull();
    const failing = vi.fn(() => Promise.reject(new Error('down'))) as unknown as typeof fetch;
    expect(await fetchPublicBrand('portal.lifeleadsplus.test', failing)).toBeNull();
    const odd = vi.fn(() =>
      Promise.resolve(json({ data: { theme: 7, id: 'tenant-1' } }))
    ) as unknown as typeof fetch;
    expect(await fetchPublicBrand('portal.lifeleadsplus.test', odd)).toBeNull();
  });
});

describe('/login on a branded host', () => {
  beforeEach(() => {
    requestHeaders = new Headers({ host: 'portal.lifeleadsplus.test' });
  });

  it("shows the agency's logo and name, in its palette, and not NetEnroll's", async () => {
    await renderLogin();
    expect(screen.getByTestId('brand-logo').getAttribute('alt')).toBe('Life Leads Plus');
    expect(screen.queryByTestId('logo')).toBeNull();
    expect(document.querySelector('[data-brand="life-leads-plus"]')).not.toBeNull();
    expect(document.body.innerHTML).not.toContain('netEnroll');
  });

  it('is titled and badged as the agency', async () => {
    expect(await generateMetadata()).toMatchObject({
      title: 'Sign in',
      description: 'Sign in to the Life Leads Plus agent portal for licensed insurance agencies.',
    });

    const { resolveBrand } = await import('@/lib/brand-themes');
    const root = brandMetadata(resolveBrand(await serverBrandForRequest()));
    expect(root.title).toEqual({ default: 'Life Leads Plus', template: '%s · Life Leads Plus' });
    expect(root.applicationName).toBe('Life Leads Plus');
    expect(JSON.stringify(root.icons)).toContain('/brands/life-leads-plus/favicon-32.png');
  });
});

/**
 * The production white-label hostname. nginx passes `Host $host` through
 * (infra/nginx/agents.lifeleadsplus.com), so the page sees the host the browser
 * asked for, and the same application renders both portals.
 */
describe('/login on agents.lifeleadsplus.com', () => {
  it('is Life Leads Plus, asked for by that host', async () => {
    requestHeaders = new Headers({ host: 'agents.lifeleadsplus.com' });
    await renderLogin();
    expect(screen.getByTestId('brand-logo').getAttribute('alt')).toBe('Life Leads Plus');
    expect(screen.queryByTestId('logo')).toBeNull();
    expect(asked).toContain('/api/v1/public/brand?host=agents.lifeleadsplus.com');

    const { resolveBrand } = await import('@/lib/brand-themes');
    const root = brandMetadata(resolveBrand(await serverBrandForRequest()));
    expect(root.title).toEqual({ default: 'Life Leads Plus', template: '%s · Life Leads Plus' });
    expect(JSON.stringify(root.icons)).toContain('/brands/life-leads-plus/favicon-32.png');
  });

  /*
   * The chrome lockup (`logo.png`) has an opaque white canvas. On the navy
   * panel it was a white sticker with the artwork shrunk inside it; the
   * panel carries the wordmark reversed out for a dark ground instead.
   */
  it('sets the reversed wordmark on its navy panel, never the white-canvas lockup', async () => {
    requestHeaders = new Headers({ host: 'agents.lifeleadsplus.com' });
    await renderLogin();
    expect(screen.getByTestId('brand-logo').getAttribute('src')).toBe(
      '/brands/life-leads-plus/wordmark-on-dark.png'
    );
    expect(document.body.innerHTML).not.toContain('/brands/life-leads-plus/logo.png');
    // The panel's navy is the brand block's, keyed on the page's own scope.
    expect(
      document.querySelector('[data-brand="life-leads-plus"] [data-auth-page]')
    ).not.toBeNull();
  });

  it('leaves agents.netenroll.com NetEnroll in the same process', async () => {
    requestHeaders = new Headers({ host: 'agents.lifeleadsplus.com' });
    await renderLogin();
    cleanup();
    requestHeaders = new Headers({ host: 'agents.netenroll.com' });
    await renderLogin();
    expect(screen.getByTestId('logo')).toBeTruthy();
    expect(screen.queryByTestId('brand-logo')).toBeNull();
  });
});

describe('/login anywhere else', () => {
  it('is NetEnroll on agents.netenroll.com', async () => {
    await renderLogin();
    expect(screen.getByTestId('logo')).toBeTruthy();
    expect(screen.queryByTestId('brand-logo')).toBeNull();
    expect(document.querySelector('[data-brand]')).toBeNull();

    expect((await generateMetadata()).description).toBe(
      'Sign in to the NetEnroll agent portal for licensed insurance agencies.'
    );
    expect(brandMetadata(null).title).toEqual({
      default: 'NetEnroll',
      template: '%s · NetEnroll',
    });
  });

  it('is NetEnroll when the API cannot be reached', async () => {
    requestHeaders = new Headers({ host: 'portal.lifeleadsplus.test' });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('down')))
    );
    await renderLogin();
    expect(screen.getByTestId('logo')).toBeTruthy();
  });
});

describe('LoginBrandLogo', () => {
  const llp = { theme: 'life-leads-plus', name: 'Life Leads Plus' };

  it("picks the agency's artwork for the ground it sits on", () => {
    render(
      <LoginBrandProvider brand={llp}>
        <LoginBrandLogo surface="dark" />
      </LoginBrandProvider>
    );
    expect(screen.getByTestId('brand-logo').getAttribute('src')).toBe(
      '/brands/life-leads-plus/wordmark-on-dark.png'
    );
    cleanup();

    render(
      <LoginBrandProvider brand={llp}>
        <LoginBrandLogo />
      </LoginBrandProvider>
    );
    expect(screen.getByTestId('brand-logo').getAttribute('src')).toBe(
      '/brands/life-leads-plus/wordmark.png'
    );
  });

  it('shows Powerhouse Insurance its full lockup on the panel, and its own wordmark canvas on light', () => {
    const phi = { theme: 'powerhouse-insurance', name: 'Powerhouse Insurance' };
    render(
      <LoginBrandProvider brand={phi}>
        <LoginBrandLogo surface="dark" />
      </LoginBrandProvider>
    );
    const dark = screen.getByTestId('brand-logo');
    expect(dark.getAttribute('src')).toBe('/brands/powerhouse-insurance/logo.png');
    expect(dark.getAttribute('alt')).toBe('Powerhouse Insurance');
    expect([dark.getAttribute('width'), dark.getAttribute('height')]).toEqual(['1087', '371']);
    cleanup();

    render(
      <LoginBrandProvider brand={phi}>
        <LoginBrandLogo />
      </LoginBrandProvider>
    );
    const light = screen.getByTestId('brand-logo');
    expect(light.getAttribute('src')).toBe('/brands/powerhouse-insurance/wordmark.png');
    expect([light.getAttribute('width'), light.getAttribute('height')]).toEqual(['900', '233']);
  });

  it("is NetEnroll's lockup with no brand", () => {
    render(
      <LoginBrandProvider brand={null}>
        <LoginBrandLogo />
      </LoginBrandProvider>
    );
    expect(screen.getByTestId('logo').querySelector('img')?.getAttribute('src')).toBe(
      '/netenroll-logo.png'
    );
    expect(screen.queryByTestId('brand-logo')).toBeNull();
  });
});
