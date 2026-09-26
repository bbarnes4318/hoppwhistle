/**
 * The platform admin's Upgrades switches, RENDERED.
 *
 * Flipping one sends the whole list to the one route that may change it, and
 * the switch shows what the server saved. An agency's own owner is shown
 * nothing to flip.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let isPlatformAdmin = true;
let stored: string[] = ['VOICE_STUDIO'];
const puts: unknown[] = [];

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function installFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(raw, 'http://localhost').pathname;
      if (path === '/api/auth/me') {
        return json({
          data: {
            id: 'op-1',
            email: 'op@netenroll.test',
            roles: [],
            tenantId: null,
            isPlatformAdmin,
          },
        });
      }
      if (path === '/api/v1/platform/context') {
        return json({ data: { isPlatformAdmin, actingTenant: null, previewRole: null } });
      }
      if (path === '/api/v1/admin/tenants/tenant-llp/upgrades') {
        if ((init?.method ?? 'GET').toUpperCase() === 'PUT') {
          const body = JSON.parse(String(init?.body)) as { upgrades: string[] };
          puts.push(body);
          stored = body.upgrades;
        }
        return json({ data: { tenantId: 'tenant-llp', upgrades: stored } });
      }
      return json({ error: { code: 'NOT_FOUND', message: 'Not in this fixture' } }, 404);
    })
  );
}

vi.mock('next/navigation', () => ({
  usePathname: () => '/admin/agencies',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

async function mount(): Promise<void> {
  const { AuthSessionProvider } = await import('@/hooks/use-auth');
  const { PlatformContextProvider } = await import('@/hooks/use-platform-context');
  const { UpgradesControl } = await import('@/components/platform/upgrades-control');
  render(
    <AuthSessionProvider>
      <PlatformContextProvider>
        <UpgradesControl tenantId="tenant-llp" agencyName="Life Leads Plus" />
      </PlatformContextProvider>
    </AuthSessionProvider>
  );
}

const switchFor = (key: string) =>
  document.querySelector(`[data-upgrade-switch="${key}"]`) as HTMLElement | null;

describe('the Upgrades switches', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('token', 'a-platform-admin');
    isPlatformAdmin = true;
    stored = ['VOICE_STUDIO'];
    puts.length = 0;
    installFetch();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows what is on, and turning Power Dialer on sends the whole list', async () => {
    await mount();
    await waitFor(() =>
      expect(switchFor('VOICE_STUDIO')?.getAttribute('data-state')).toBe('checked')
    );
    expect(switchFor('POWER_DIALER')?.getAttribute('data-state')).toBe('unchecked');
    expect(document.querySelectorAll('[data-upgrade-switch]')).toHaveLength(5);

    fireEvent.click(switchFor('POWER_DIALER') as HTMLElement);
    await waitFor(() => expect(puts).toEqual([{ upgrades: ['VOICE_STUDIO', 'POWER_DIALER'] }]));
    await waitFor(() =>
      expect(switchFor('POWER_DIALER')?.getAttribute('data-state')).toBe('checked')
    );

    fireEvent.click(switchFor('VOICE_STUDIO') as HTMLElement);
    await waitFor(() => expect(puts[1]).toEqual({ upgrades: ['POWER_DIALER'] }));
  });

  it('renders nothing for somebody who is not staff', async () => {
    isPlatformAdmin = false;
    await mount();
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(screen.queryByTestId('upgrades-control')).toBeNull();
  });
});
