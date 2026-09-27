/**
 * Two owner screens about money, RENDERED against a stubbed API.
 *
 *   Buyers -> Buyer balances   one table of every buyer: a prepaid buyer's
 *                              wallet, a terms buyer's month so far, status
 *                              with the pause reason, and the last top-up.
 *                              No Balance tiles and no Invoices panel.
 *   Settings -> Plan & Billing an agency not enrolled in per-application
 *                              billing gets one line, in its brand's name,
 *                              instead of Rate, Delivery and Settlements.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let brand: { theme: string; name: string | null } | null = null;
let answers: Record<string, unknown> = {};
let requested: string[] = [];

function urlOf(input: RequestInfo | URL): URL {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return new URL(raw, 'http://localhost');
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function installFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = urlOf(input);
      requested.push(`${url.pathname}${url.search}`);
      if (url.pathname === '/api/auth/me') {
        return json({
          data: {
            id: 'owner-1',
            email: 'owner@agency.test',
            roles: ['OWNER', 'ADMIN'],
            permissions: ['admin:*'],
            tenantId: 'tenant-a',
            whiteLabel: true,
            brand,
          },
        });
      }
      if (url.pathname === '/api/v1/platform/context') {
        return json({ data: { isPlatformAdmin: false, actingTenant: null, previewRole: null } });
      }
      if (url.pathname in answers) return json(answers[url.pathname]);
      return json({ error: { code: 'NOT_FOUND', message: 'Not in this fixture' } }, 404);
    })
  );
}

vi.mock('next/navigation', () => ({
  usePathname: () => '/buyers',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// The three sections stand in for themselves: whether they render is the question.
vi.mock('@/components/rating/rating-view', () => ({ RatingView: () => <p>rate section</p> }));
vi.mock('@/components/delivery/delivery-view', () => ({
  DeliveryView: () => <p>delivery section</p>,
}));
vi.mock('@/components/delivery/settlements-view', () => ({
  SettlementsView: () => <p>settlements section</p>,
}));

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

async function mount(node: JSX.Element): Promise<void> {
  const { AuthSessionProvider } = await import('@/hooks/use-auth');
  const { PlatformContextProvider } = await import('@/hooks/use-platform-context');
  render(
    <AuthSessionProvider>
      <PlatformContextProvider>{node}</PlatformContextProvider>
    </AuthSessionProvider>
  );
}

const BALANCES = {
  data: [
    {
      id: 'buyer-upfront',
      name: 'Acme Senior',
      code: 'ACME',
      billingType: 'UPFRONT',
      walletBalance: 1250.5,
      billedThisMonth: null,
      status: 'ACTIVE',
      pauseReason: null,
      lastTopUp: { amount: 500, at: '2026-09-20T15:00:00.000Z' },
    },
    {
      id: 'buyer-terms',
      name: 'Zen Health',
      code: 'ZEN',
      billingType: 'TERMS',
      walletBalance: null,
      billedThisMonth: 830,
      status: 'ACTIVE',
      pauseReason: null,
      lastTopUp: null,
    },
    {
      id: 'buyer-paused',
      name: 'Bolt Final Expense',
      code: 'BOLT',
      billingType: 'UPFRONT',
      walletBalance: 0,
      billedThisMonth: null,
      status: 'PAUSED',
      pauseReason: 'WALLET_EMPTY',
      lastTopUp: null,
    },
  ],
  meta: { total: 3, month: { from: '2026-09-01', to: '2026-09-27' } },
};

beforeAll(async () => {
  await Promise.all([
    import('@/hooks/use-auth'),
    import('@/hooks/use-platform-context'),
    import('@/components/billing/billing-view'),
    import('@/components/settings/plan-billing-view'),
  ]);
}, 120_000);

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'a-signed-in-owner');
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  brand = null;
  answers = {};
  requested = [];
  installFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Buyer balances', () => {
  it('lists TERMS and UPFRONT buyers, each with its own figure', async () => {
    answers['/api/v1/buyers/balances'] = BALANCES;
    const { BillingView } = await import('@/components/billing/billing-view');
    await mount(<BillingView />);

    await waitFor(() => expect(screen.getAllByTestId('buyer-balance-row')).toHaveLength(3));
    const [acme, zen, bolt] = screen.getAllByTestId('buyer-balance-row');

    expect(within(acme).getByText('Acme Senior')).toBeTruthy();
    expect(within(acme).getByText('Prepaid')).toBeTruthy();
    expect(within(acme).getByText('$1,250.50')).toBeTruthy();
    expect(within(acme).getByText('$500.00')).toBeTruthy();

    expect(within(zen).getByText('Terms')).toBeTruthy();
    expect(within(zen).getByText('$830.00')).toBeTruthy();
    expect(within(zen).getByText('billed this month')).toBeTruthy();

    expect(within(bolt).getByText('Paused · Wallet empty')).toBeTruthy();

    // The tiles read a table nothing writes, and the invoices were the agency's own.
    expect(requested.some(path => path.startsWith('/api/v1/billing/'))).toBe(false);
    expect(screen.queryByText('Invoices')).toBeNull();
    expect(screen.queryByText('Available Balance')).toBeNull();
  });
});

describe('the ledger date range', () => {
  it('covers whole New York days', async () => {
    const { ledgerDateParams } = await import('@/components/billing/billing-view');
    // EDT, UTC-4: the 10th starts at 04:00Z and the 11th's last instant is 03:59:59.999Z on the 12th.
    expect(ledgerDateParams('2026-09-10', '2026-09-11')).toEqual({
      startDate: '2026-09-10T04:00:00.000Z',
      endDate: '2026-09-12T03:59:59.999Z',
    });
    // EST, UTC-5.
    expect(ledgerDateParams('', '2026-12-01')).toEqual({ endDate: '2026-12-02T04:59:59.999Z' });
    expect(ledgerDateParams('', '')).toEqual({});
  });
});

describe('Plan & Billing', () => {
  it('tells an agency that is not enrolled where its money is, in its brand name', async () => {
    brand = { theme: 'life-leads-plus', name: 'Life Leads Plus' };
    answers['/api/v1/delivery/mandate'] = { data: { enrolled: false, status: 'NONE' } };
    const { PlanBillingView } = await import('@/components/settings/plan-billing-view');
    await mount(<PlanBillingView />);

    const notice = await screen.findByTestId('plan-not-enrolled');
    await waitFor(() =>
      expect(notice.textContent).toBe(
        "Life Leads Plus isn't billed per application. Your number charges and statements are under Revenue → Statements."
      )
    );
    expect(screen.queryByText('rate section')).toBeNull();
    expect(screen.queryByText('delivery section')).toBeNull();
    expect(screen.queryByText('settlements section')).toBeNull();
  });

  it('shows Rate, Delivery and Settlements to an enrolled agency', async () => {
    answers['/api/v1/delivery/mandate'] = { data: { enrolled: true, status: 'VALID' } };
    const { PlanBillingView } = await import('@/components/settings/plan-billing-view');
    await mount(<PlanBillingView />);

    await waitFor(() => expect(screen.getByText('rate section')).toBeTruthy());
    expect(screen.getByText('delivery section')).toBeTruthy();
    expect(screen.getByText('settlements section')).toBeTruthy();
    expect(screen.queryByTestId('plan-not-enrolled')).toBeNull();
  });
});
