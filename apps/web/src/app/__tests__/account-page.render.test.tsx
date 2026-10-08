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

/** Three quoted carriers (one with two plans) and one the quoter does not quote. */
const product = (id: string, family: string, quotable = true) => ({
  id,
  family,
  product: `${family} plan ${id}`,
  quotable,
  appointed: quotable,
});
const CATALOG = {
  engineVersion: 'test',
  bundleSha256: 'abc',
  conditions: [],
  products: [
    product('moo', 'Mutual of Omaha'),
    product('ta', 'Transamerica'),
    product('sn1', 'Security National'),
    product('sn2', 'Security National'),
    product('old', 'Retired Carrier', false),
  ],
};
let myCarriers: string[] | null = null;

/** A checkbox's or button's state, without a cast the type checker and the linter disagree about. */
const isChecked = (el: HTMLElement): boolean => el instanceof HTMLInputElement && el.checked;
const isDisabled = (el: HTMLElement): boolean => el instanceof HTMLButtonElement && el.disabled;
const carrierWrites: unknown[] = [];

let user: Record<string, unknown> = BUYER;
const requests: Array<{ method: string; path: string }> = [];
const licenseWrites: unknown[] = [];

beforeEach(() => {
  requests.length = 0;
  licenseWrites.length = 0;
  carrierWrites.length = 0;
  myCarriers = null;
  user = BUYER;
  localStorage.clear();
  localStorage.setItem('token', 'old-token');
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe(): void {}
      unobserve(): void {}
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
          licenseWrites.push(body);
          user = { ...user, licensedStates: body.licensedStates };
          return json({ licensedStates: body.licensedStates });
        }
        case '/api/auth/me/sessions/revoke':
          return json({ ok: true, token: 'fresh-token' });
        case '/api/v1/agent/call-destination':
          return (user.roles as string[]).includes('AGENT')
            ? json({ ringOn: 'softphone', cellForwardNumber: null })
            : json({ error: { code: 'FORBIDDEN', message: 'Agents only' } }, 403);
        case '/api/v1/fex/catalog':
          return json({ data: CATALOG });
        case '/api/v1/fex/settings':
          return json({
            data: {
              agency: {},
              me: { autoOpenOnCall: null, carriers: myCarriers },
              canEdit: false,
            },
          });
        case '/api/v1/fex/settings/me': {
          const body = JSON.parse(String(init?.body)) as { carriers: string[] | null };
          carrierWrites.push(body);
          myCarriers = body.carriers;
          return json({ data: { me: { autoOpenOnCall: null, carriers: myCarriers } } });
        }
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
  const { resetFexCatalogCache } = await import('@/hooks/use-fex-quote');
  resetFexCatalogCache();
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
    expect(document.getElementById('state-licensing')).toBeNull();
    expect(document.getElementById('call-routing')).toBeNull();
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

    // Adding a state needs the license confirmed before it can be saved.
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
    expect(licenseWrites).toEqual([{ licensedStates: ['FL', 'TN', 'TX'] }]);
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
    await waitFor(() => expect(licenseWrites).toEqual([{ licensedStates: ['GA', 'TX'] }]));
  });

  it('offers an agent only the carriers the quoter quotes, all of them by default', async () => {
    user = AGENT;
    await mountAccount();
    const panel = await waitFor(() => {
      const el = document.querySelector('[data-quote-carriers]') as HTMLElement;
      expect(within(el).getAllByRole('checkbox')).toHaveLength(3);
      return el;
    });
    const boxes = within(panel).getAllByRole('checkbox');
    expect(boxes.map(b => b.closest('[data-carrier]')?.getAttribute('data-carrier'))).toEqual([
      'Mutual of Omaha',
      'Security National',
      'Transamerica',
    ]);
    expect(boxes.every(isChecked)).toBe(true);
    expect(within(panel).getByText('All 3 selected')).toBeTruthy();
    expect(within(panel).getByText('2 plans')).toBeTruthy();
    expect(within(panel).queryByText(/Retired Carrier/)).toBeNull();
  });

  it('saves the carriers an agent picks, and every carrier as no pick at all', async () => {
    user = AGENT;
    await mountAccount();
    const panel = await waitFor(() => {
      const el = document.querySelector('[data-quote-carriers]') as HTMLElement;
      expect(within(el).getAllByRole('checkbox')).toHaveLength(3);
      return el;
    });
    const save = within(panel).getByRole('button', { name: 'Save carriers' });
    expect(isDisabled(save)).toBe(true);

    // Clearing leaves nothing to quote: it cannot be saved.
    fireEvent.click(within(panel).getByRole('button', { name: /Clear/ }));
    expect(within(panel).getByText('Select at least one carrier.')).toBeTruthy();
    expect(isDisabled(save)).toBe(true);

    fireEvent.click(within(panel).getByRole('checkbox', { name: /Transamerica/ }));
    fireEvent.click(within(panel).getByRole('checkbox', { name: /Mutual of Omaha/ }));
    expect(within(panel).getByText('2 of 3 selected')).toBeTruthy();
    fireEvent.click(save);
    await waitFor(() =>
      expect(within(panel).getByText('Saved. Your quotes show 2 carriers.')).toBeTruthy()
    );
    expect(carrierWrites).toEqual([{ carriers: ['Mutual of Omaha', 'Transamerica'] }]);

    fireEvent.click(within(panel).getByRole('button', { name: /Select all/ }));
    fireEvent.click(within(panel).getByRole('button', { name: 'Save carriers' }));
    await waitFor(() =>
      expect(within(panel).getByText('Saved. Your quotes show every carrier.')).toBeTruthy()
    );
    expect(carrierWrites[1]).toEqual({ carriers: null });
  });

  it('opens on the carriers an agent saved, and filters them by name', async () => {
    user = AGENT;
    myCarriers = ['Transamerica'];
    await mountAccount();
    const panel = await waitFor(() => {
      const el = document.querySelector('[data-quote-carriers]') as HTMLElement;
      expect(within(el).getByText('1 of 3 selected')).toBeTruthy();
      return el;
    });
    expect(isChecked(within(panel).getByRole('checkbox', { name: /Transamerica/ }))).toBe(true);
    fireEvent.change(within(panel).getByPlaceholderText('Find a carrier or plan'), {
      target: { value: 'omaha' },
    });
    expect(within(panel).getAllByRole('checkbox')).toHaveLength(1);
  });

  it('gives a buyer no carrier picker', async () => {
    await mountAccount();
    expect(document.getElementById('quote-carriers')).toBeNull();
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
