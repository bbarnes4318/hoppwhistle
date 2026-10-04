/**
 * The Account page, RENDERED, for each kind of login that reaches it: a buyer
 * portal login, an agent, and a Google sign-up with no password. And the one
 * destructive control on it -- signing out every other device -- which must ask
 * first and must keep this tab signed in on the token it is handed.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: () => '/account',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const BUYER = {
  id: 'user-buyer-1',
  email: 'ops@acme.test',
  firstName: 'Dana',
  lastName: 'Reyes',
  roles: ['BUYER'],
  tenantId: 'tenant-a',
  buyerId: 'buyer-1',
  authMethod: 'EMAIL',
  hasPassword: true,
  createdAt: '2025-03-04T12:00:00.000Z',
  organizationName: 'Acme Insurance',
  sessionExpiresAt: '2026-10-11T15:42:00.000Z',
};
const AGENT = {
  id: 'user-agent-1',
  email: 'marcus@agency.test',
  firstName: 'Marcus',
  lastName: 'Bell',
  roles: ['AGENT'],
  tenantId: 'tenant-a',
  authMethod: 'EMAIL',
  hasPassword: true,
  createdAt: '2025-06-01T12:00:00.000Z',
  organizationName: 'Life Leads Plus',
  licensedStates: ['TX', 'FL', 'GA'],
};
const GOOGLE_ONLY = { ...BUYER, authMethod: 'GOOGLE', hasPassword: false };

let user: Record<string, unknown> = BUYER;
const requests: Array<{ method: string; path: string }> = [];
const licenceWrites: unknown[] = [];

beforeEach(() => {
  requests.length = 0;
  licenceWrites.length = 0;
  user = BUYER;
  localStorage.clear();
  localStorage.setItem('token', 'old-token');
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    }
  );
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, 'http://localhost');
      const method = init?.method ?? 'GET';
      requests.push({ method, path: url.pathname });
      switch (url.pathname) {
        case '/api/auth/me':
          return json({ data: user });
        case '/api/auth/me/licensed-states': {
          const body = JSON.parse(String(init?.body)) as { licensedStates: string[] };
          licenceWrites.push(body);
          user = { ...user, licensedStates: body.licensedStates };
          return json({ licensedStates: body.licensedStates });
        }
        case '/api/auth/me/sessions/revoke':
          return json({ ok: true, token: 'fresh-token' });
        case '/api/v1/agent/call-destination':
          return (user.roles as string[]).includes('AGENT')
            ? json({ ringOn: 'softphone', cellForwardNumber: null })
            : json({ error: { code: 'FORBIDDEN', message: 'Agents only' } }, 403);
        case '/api/v1/platform/context':
          return json({ data: { isPlatformAdmin: false, actingTenant: null, previewRole: null } });
        default:
          return json({ data: [] });
      }
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mountAccount(): Promise<void> {
  const { AuthSessionProvider } = await import('@/hooks/use-auth');
  const { PlatformContextProvider } = await import('@/hooks/use-platform-context');
  const { default: AccountPage } = await import('../(dashboard)/account/page');
  render(
    <AuthSessionProvider>
      <PlatformContextProvider>
        <AccountPage />
      </PlatformContextProvider>
    </AuthSessionProvider>
  );
  await waitFor(() => expect(document.querySelector('[data-account-overview]')).toBeTruthy());
}

describe('the Account page', () => {
  it('shows a buyer who they are, whose login it is, and how it signs in', async () => {
    await mountAccount();
    const overview = document.querySelector('[data-account-overview]') as HTMLElement;
    expect(within(overview).getByText('Dana Reyes')).toBeTruthy();
    expect(within(overview).getByText('Acme Insurance')).toBeTruthy();
    expect(within(overview).getByText('Email and password')).toBeTruthy();
    expect(within(overview).getByText('March 4, 2025')).toBeTruthy();

    const details = document.querySelector('[data-profile-details]') as HTMLElement;
    expect(within(details).getByText('user-buyer-1')).toBeTruthy();
    expect(within(details).getByText('Buyer')).toBeTruthy();

    // A buyer has no calling section; the password form and policies are there.
    expect(document.getElementById('calling')).toBeNull();
    expect(document.querySelector('[data-change-password]')).toBeTruthy();
    expect(screen.getByLabelText('Current password')).toBeTruthy();
    expect(document.querySelectorAll('[data-legal-documents] a')).toHaveLength(4);
  });

  it('gives an agent their licensed states and where their calls ring', async () => {
    user = AGENT;
    await mountAccount();
    const states = within(document.querySelector('[data-licensed-states]') as HTMLElement)
      .getAllByRole('listitem')
      .map(item => item.textContent);
    expect(states).toEqual(['FL', 'GA', 'TX']);
    await waitFor(() => expect(screen.getByText('Where your calls ring')).toBeTruthy());
  });

  it('lets an agent change their states, confirming any state they add', async () => {
    user = AGENT;
    await mountAccount();
    const panel = document.querySelector('[data-licensed-states]') as HTMLElement;
    fireEvent.click(within(panel).getByRole('button', { name: /Edit states/ }));

    // Drop Georgia, add Tennessee.
    fireEvent.click(within(panel).getByRole('checkbox', { name: 'Georgia (GA)' }));
    fireEvent.click(within(panel).getByRole('checkbox', { name: 'Tennessee (TN)' }));
    expect(within(panel).getByText('Adding').parentElement?.textContent).toMatch(/^Adding TN\b/);
    expect(within(panel).getByText('Removing').parentElement?.textContent).toMatch(
      /^Removing GA\b/
    );

    // Adding a state needs the licence confirmed before it can be saved.
    const save = within(panel).getByRole('button', { name: 'Save states' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(
      within(panel).getByRole('checkbox', {
        name: 'I hold an active license in every state I am adding',
      })
    );
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);

    await waitFor(() =>
      expect(screen.getByText('Saved. Your calls now come from these states.')).toBeTruthy()
    );
    expect(licenceWrites).toEqual([{ licensedStates: ['FL', 'TN', 'TX'] }]);
    const states = within(document.querySelector('[data-licensed-states]') as HTMLElement)
      .getAllByRole('listitem')
      .map(item => item.textContent);
    expect(states).toEqual(['FL', 'TN', 'TX']);
  });

  it('lets an agent remove a state without the confirmation', async () => {
    user = AGENT;
    await mountAccount();
    const panel = document.querySelector('[data-licensed-states]') as HTMLElement;
    fireEvent.click(within(panel).getByRole('button', { name: /Edit states/ }));
    fireEvent.click(within(panel).getByRole('checkbox', { name: 'Florida (FL)' }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Save states' }));
    await waitFor(() => expect(licenceWrites).toEqual([{ licensedStates: ['GA', 'TX'] }]));
  });

  it('tells a Google sign-up how to set a password instead of showing a form it would fail', async () => {
    user = GOOGLE_ONLY;
    await mountAccount();
    expect(screen.getByText('You sign in with Google')).toBeTruthy();
    expect(screen.queryByLabelText('Current password')).toBeNull();
  });

  it('asks before signing out other devices, then keeps this tab on the new token', async () => {
    await mountAccount();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out other devices' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Sign out of all other devices?')).toBeTruthy();
    expect(requests.some(r => r.path === '/api/auth/me/sessions/revoke')).toBe(false);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign out other devices' }));
    await waitFor(() =>
      expect(screen.getByText('Every other device has been signed out.')).toBeTruthy()
    );
    expect(requests).toContainEqual({ method: 'POST', path: '/api/auth/me/sessions/revoke' });
    expect(localStorage.getItem('token')).toBe('fresh-token');
  });
});
