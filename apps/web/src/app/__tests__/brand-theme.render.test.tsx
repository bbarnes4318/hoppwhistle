/**
 * The agency brand theme, RENDERED: the real providers and the real dashboard
 * shell against a stubbed `/api/auth/me`.
 *
 * ── What this pins ───────────────────────────────────────────────────────────
 *
 * A white-labelled agency's people must see their agency's logo and never
 * NetEnroll's -- not as the final state, and not as a flash before it. Everyone
 * else must see exactly what they saw before. The brand comes from the session
 * the server answered with; nothing in this file puts it anywhere else, so a
 * pass here also says the shell reads it from there.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let brand: { theme: string; name: string | null } | null = null;
let meLatencyMs = 0;

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function pathOf(input: RequestInfo | URL): string {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  try {
    return new URL(raw, 'http://localhost').pathname;
  } catch {
    return raw;
  }
}

function installFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = pathOf(input);
      if (path === '/api/auth/me') {
        if (meLatencyMs > 0) await new Promise(resolve => setTimeout(resolve, meLatencyMs));
        return json({
          id: 'owner-1',
          email: 'owner@agency.test',
          firstName: 'Agency',
          lastName: 'Owner',
          roles: ['OWNER'],
          permissions: ['admin:*'],
          tenantId: 'tenant-a',
          isPlatformAdmin: false,
          brand,
        });
      }
      if (path === '/api/v1/platform/context') {
        return json({ data: { isPlatformAdmin: false, actingTenant: null, previewRole: null } });
      }
      return json({ data: null });
    })
  );
}

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

/** The icon links the root layout's metadata renders, so the swap has something to swap. */
function installIconLinks(): void {
  document.head.innerHTML = `
    <link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32">
    <link rel="icon" href="/icon-512.png" type="image/png" sizes="512x512">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  `;
}

function iconHrefs(): string[] {
  return [...document.head.querySelectorAll('link')].map(link => link.getAttribute('href') ?? '');
}

/**
 * The sidebar opens full width, with the wordmark; a user may collapse it to
 * the 56px rail, which carries the brand's square mark instead.
 */
async function collapseRail(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: 'Collapse navigation' }));
}

async function mountShell(): Promise<() => void> {
  const { AuthSessionProvider } = await import('@/hooks/use-auth');
  const { PlatformContextProvider } = await import('@/hooks/use-platform-context');
  const { CustomerIntakeProvider } = await import('@/contexts/customer-intake-context');
  const { default: DashboardLayout } = await import('../(dashboard)/layout');

  const { unmount } = render(
    <AuthSessionProvider>
      <PlatformContextProvider>
        <CustomerIntakeProvider>
          <DashboardLayout>
            <p>page body</p>
          </DashboardLayout>
        </CustomerIntakeProvider>
      </PlatformContextProvider>
    </AuthSessionProvider>
  );
  return unmount;
}

describe('the agency brand theme in the authenticated shell', () => {
  /*
   * Load the shell once, before any test's clock starts. The first
   * `mountShell` otherwise pays for importing the whole dashboard layout
   * inside the 5s test timeout -- about 1.8s quietly, more on a busy runner.
   * `mountShell` imports the same modules and now gets them from the cache.
   */
  beforeAll(async () => {
    await Promise.all([
      import('@/hooks/use-auth'),
      import('@/hooks/use-platform-context'),
      import('@/contexts/customer-intake-context'),
      import('../(dashboard)/layout'),
    ]);
  }, 60_000);

  beforeEach(() => {
    brand = null;
    meLatencyMs = 0;
    localStorage.clear();
    localStorage.setItem('token', 'test-token');
    document.documentElement.removeAttribute('data-brand');
    document.title = 'NetEnroll';
    installIconLinks();
    installFetch();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('with a Life Leads Plus brand from /api/auth/me', () => {
    beforeEach(() => {
      brand = { theme: 'life-leads-plus', name: 'Life Leads Plus' };
    });

    it('renders the Life Leads Plus logo and no NetEnroll logo', async () => {
      await mountShell();

      const logo = await screen.findByTestId('brand-logo');
      // The transparent wordmark reversed out for the navy, straight on the
      // rail: never the old white-canvas lockup, never on a plate.
      expect(logo.getAttribute('src')).toBe('/brands/life-leads-plus/wordmark-on-dark.png');
      expect(document.body.innerHTML).not.toContain('/brands/life-leads-plus/logo.png');
      expect(logo.closest('.bg-white')).toBeNull();
      expect(logo.getAttribute('alt')).toBe('Life Leads Plus');

      expect(document.querySelector('[data-testid="logo"]')).toBeNull();
      expect(document.querySelector('img[src="/netenroll-logo.png"]')).toBeNull();
      expect(screen.queryByLabelText('NetEnroll home')).toBeNull();
      expect(screen.getByLabelText('Life Leads Plus home')).toBeTruthy();

      // Collapsed, the rail carries the agency's square mark.
      await collapseRail();
      const mark = await screen.findByTestId('brand-mark');
      expect(mark.getAttribute('src')).toBe('/brands/life-leads-plus/mark-128.png');
      expect(document.querySelector('[data-testid="logo-mark"]')).toBeNull();
    });

    it('opens as the full 232px sidebar, and collapses to the 56px rail on request', async () => {
      await mountShell();
      await screen.findByTestId('brand-logo');
      const rail = screen.getByRole('navigation', { name: 'Main' }).parentElement;
      expect(rail?.className).toContain('w-[232px]');
      // Not laid over the page: the column takes its width in the shell.
      expect(rail?.className).not.toContain('absolute');
      await collapseRail();
      await screen.findByTestId('brand-mark');
      expect(rail?.className).toContain('w-14');
      expect(localStorage.getItem('ne:sidebar')).toBe('collapsed');
    });

    it('remembers a collapsed rail', async () => {
      localStorage.setItem('ne:sidebar', 'collapsed');
      await mountShell();
      await screen.findByTestId('brand-mark');
      fireEvent.click(await screen.findByRole('button', { name: 'Expand navigation' }));
      await screen.findByTestId('brand-logo');
      expect(localStorage.getItem('ne:sidebar')).toBe('expanded');
    });

    it('draws the navigation rail in the brand navy', async () => {
      await mountShell();
      await screen.findByTestId('brand-logo');
      const rail = screen.getByRole('navigation', { name: 'Main' }).parentElement;
      expect(rail?.hasAttribute('data-brand-nav')).toBe(true);
    });

    it('sets data-brand on <html>, the icons and the title', async () => {
      await mountShell();

      await waitFor(() =>
        expect(document.documentElement.getAttribute('data-brand')).toBe('life-leads-plus')
      );
      expect(iconHrefs()).toEqual([
        '/brands/life-leads-plus/favicon-32.png',
        '/brands/life-leads-plus/mark.png',
        '/brands/life-leads-plus/apple-touch-icon.png',
      ]);
      await waitFor(() => expect(document.title).toBe('Dashboard · Life Leads Plus'));
      expect(document.title).not.toContain('NetEnroll');
    });

    it('never names NetEnroll anywhere in the shell', async () => {
      await mountShell();
      await screen.findByTestId('brand-logo');
      // Open and collapsed alike.
      for (const collapsed of [false, true]) {
        if (collapsed) {
          await collapseRail();
          await screen.findByTestId('brand-mark');
        }
        expect(document.body.textContent ?? '').not.toMatch(/net\s*enroll/i);
        for (const img of document.querySelectorAll('img')) {
          expect(img.getAttribute('alt') ?? '').not.toMatch(/net\s*enroll/i);
        }
      }
    });

    it('draws no NetEnroll logo while the session is still resolving', async () => {
      meLatencyMs = 150;
      await mountShell();

      // Before /api/auth/me answers: neither logo.
      expect(document.querySelector('[data-testid="logo"]')).toBeNull();
      expect(document.querySelector('[data-testid="brand-logo"]')).toBeNull();

      // After: the agency's, and still never NetEnroll's.
      await screen.findByTestId('brand-logo');
      expect(document.querySelector('[data-testid="logo-mark"]')).toBeNull();
      expect(document.querySelector('[data-testid="logo"]')).toBeNull();
    });

    it('uses the theme name when the server sends no brand name', async () => {
      brand = { theme: 'life-leads-plus', name: null };
      await mountShell();
      expect((await screen.findByTestId('brand-logo')).getAttribute('alt')).toBe('Life Leads Plus');
    });

    it('removes the brand and restores the icons when the shell unmounts', async () => {
      const unmount = await mountShell();
      await waitFor(() =>
        expect(document.documentElement.getAttribute('data-brand')).toBe('life-leads-plus')
      );

      unmount();

      expect(document.documentElement.hasAttribute('data-brand')).toBe(false);
      expect(iconHrefs()).toEqual(['/favicon-32.png', '/icon-512.png', '/apple-touch-icon.png']);
    });
  });

  describe('with a Powerhouse Insurance brand from /api/auth/me', () => {
    beforeEach(() => {
      brand = { theme: 'powerhouse-insurance', name: 'Powerhouse Insurance' };
    });

    it('carries the full logo, tagline included, in a wider sidebar', async () => {
      await mountShell();
      const logo = await screen.findByTestId('brand-logo');
      expect(logo.getAttribute('src')).toBe('/brands/powerhouse-insurance/logo.png');
      expect(logo.getAttribute('alt')).toBe('Powerhouse Insurance');
      expect(screen.getByLabelText('Powerhouse Insurance home')).toBeTruthy();
      const rail = screen.getByRole('navigation', { name: 'Main' }).parentElement;
      expect(rail?.className).toContain('w-[264px]');
      expect(rail?.querySelector('[data-brand-row]')?.className).toContain('h-[116px]');
    });
  });

  describe('with no brand', () => {
    it('renders the NetEnroll logo, and no brand logo', async () => {
      await mountShell();
      expect(document.querySelector('[data-brand-nav]')).toBeNull();
      const logo = await screen.findByTestId('logo');
      expect(logo.querySelector('img')?.getAttribute('src')).toBe('/netenroll-logo.png');
      expect(document.querySelector('[data-testid="brand-logo"]')).toBeNull();

      await collapseRail();
      await screen.findByTestId('logo-mark');
      expect(document.querySelector('[data-testid="brand-mark"]')).toBeNull();
    });

    it('leaves <html>, the icons and the title as NetEnroll', async () => {
      // A stale attribute from an earlier session must be cleared, not kept.
      document.documentElement.setAttribute('data-brand', 'life-leads-plus');
      await mountShell();
      await screen.findByTestId('logo');

      await waitFor(() => expect(document.documentElement.hasAttribute('data-brand')).toBe(false));
      expect(iconHrefs()).toEqual(['/favicon-32.png', '/icon-512.png', '/apple-touch-icon.png']);
      await waitFor(() => expect(document.title).toBe('Dashboard · NetEnroll'));
    });

    it('treats a theme this build does not know as no brand', async () => {
      brand = { theme: 'someone-else', name: 'Someone Else' };
      await mountShell();

      await screen.findByTestId('logo');
      expect(document.querySelector('[data-testid="brand-logo"]')).toBeNull();
      expect(document.documentElement.hasAttribute('data-brand')).toBe(false);
    });
  });
});
