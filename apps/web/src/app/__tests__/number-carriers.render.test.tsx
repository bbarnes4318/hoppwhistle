/* eslint-disable @typescript-eslint/no-explicit-any -- request bodies captured from the fetch stub are parsed JSON */
/**
 * Settings -> Number carriers: NetEnroll's choice of which carriers agencies
 * buy phone numbers from.
 *
 * What these pin: the tab exists for a platform admin and for nobody else --
 * not an agency owner, and not an operator previewing an agency -- and a save
 * sends the whole choice, with the default following the carriers switched on.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/settings',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const CARRIERS = [
  {
    provider: 'fractel',
    label: 'FracTEL',
    purchasable: true,
    configured: true,
    enabled: true,
    isDefault: true,
    numberTypes: ['local', 'tollfree'],
    unavailableReason: null,
    updatedAt: null,
  },
  {
    provider: 'bulkvs',
    label: 'BulkVS',
    purchasable: true,
    configured: true,
    enabled: true,
    isDefault: false,
    numberTypes: ['local'],
    unavailableReason: null,
    updatedAt: null,
  },
  {
    provider: 'vonage',
    label: 'Vonage',
    purchasable: true,
    configured: true,
    enabled: false,
    isDefault: false,
    numberTypes: ['local'],
    unavailableReason: null,
    updatedAt: null,
  },
  {
    provider: 'telnyx',
    label: 'Telnyx',
    purchasable: false,
    configured: false,
    enabled: false,
    isDefault: false,
    numberTypes: [],
    unavailableReason: 'No inventory search for this carrier yet.',
    updatedAt: null,
  },
];

let me: Record<string, unknown> = {};
let context: Record<string, unknown> = {};
const sent: Array<{ method: string; path: string; body: any }> = [];

beforeEach(() => {
  sent.length = 0;
  localStorage.setItem('token', 'signed-in');
  me = { id: 'staff-1', email: 'ops@netenroll.test', roles: [], isPlatformAdmin: true };
  context = { isPlatformAdmin: true, actingTenant: null, previewRole: null };
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, 'http://localhost');
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      sent.push({ method, path: url.pathname, body });
      if (url.pathname === '/api/auth/me') return json({ data: me });
      if (url.pathname === '/api/v1/platform/context') return json({ data: context });
      if (url.pathname === '/api/v1/platform/number-carriers') {
        if (method === 'PUT') {
          return json({
            data: CARRIERS.map(c => {
              const entry = body.carriers.find((e: any) => e.provider === c.provider);
              const enabled = entry ? entry.enabled : c.enabled;
              return { ...c, enabled, isDefault: c.provider === body.defaultProvider };
            }),
          });
        }
        return json({ data: CARRIERS });
      }
      return json({ data: [] });
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openSettings(): Promise<void> {
  const { AuthSessionProvider } = await import('@/hooks/use-auth');
  const { PlatformContextProvider } = await import('@/hooks/use-platform-context');
  const { SettingsView } = await import('@/components/settings/settings-view');
  render(
    <AuthSessionProvider>
      <PlatformContextProvider>
        <SettingsView />
      </PlatformContextProvider>
    </AuthSessionProvider>
  );
  await waitFor(() => expect(screen.getByRole('tab', { name: 'DNC lists' })).toBeTruthy());
}

describe('Number carriers', () => {
  it('is a tab for a platform admin', async () => {
    await openSettings();
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Number carriers' })).toBeTruthy());
  });

  it('is not shown to an agency owner, nor asked for', async () => {
    me = { id: 'owner-1', email: 'owner@agency.test', roles: ['OWNER', 'ADMIN'], tenantId: 't1' };
    context = { isPlatformAdmin: false, actingTenant: null, previewRole: null };
    await openSettings();
    expect(screen.queryByRole('tab', { name: 'Number carriers' })).toBeNull();
    expect(sent.some(r => r.path === '/api/v1/platform/number-carriers')).toBe(false);
  });

  it('is not shown to an operator previewing an agency', async () => {
    me = { ...me, roles: ['OWNER'], tenantId: 't1', previewRole: 'OWNER' };
    context = {
      isPlatformAdmin: true,
      actingTenant: { id: 't1', name: 'Agency' },
      previewRole: 'OWNER',
    };
    await openSettings();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(screen.queryByRole('tab', { name: 'Number carriers' })).toBeNull();
  });

  it('saves the whole choice, and moves the default when the default is switched off', async () => {
    const { NumberCarriersPanel } = await import('@/components/settings/number-carriers-panel');
    render(<NumberCarriersPanel />);
    const panel = await screen.findByRole('list', { name: 'Number carriers' });

    // Telnyx cannot be bought from here: no switch to turn on.
    const telnyx = panel.querySelector('[data-carrier="telnyx"]') as HTMLElement;
    expect(within(telnyx).getByRole('switch').hasAttribute('disabled')).toBe(true);
    expect(telnyx.textContent).toContain('Not available');

    fireEvent.click(screen.getByRole('switch', { name: 'Sell numbers from Vonage' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Sell numbers from FracTEL' }));
    // FracTEL was the default; it moves to the next carrier switched on.
    expect(
      (panel.querySelector('[data-carrier="bulkvs"] input[type="radio"]') as HTMLInputElement)
        .checked
    ).toBe(true);
    fireEvent.click(
      panel.querySelector('[data-carrier="vonage"] input[type="radio"]') as HTMLElement
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sent.some(r => r.method === 'PUT')).toBe(true));
    const put = sent.find(r => r.method === 'PUT');
    expect(put?.body).toEqual({
      carriers: [
        { provider: 'fractel', enabled: false },
        { provider: 'bulkvs', enabled: true },
        { provider: 'vonage', enabled: true },
      ],
      defaultProvider: 'vonage',
    });
  });
});
