/**
 * The white-label tier's three new screens, RENDERED from fixture answers.
 *
 * Each page computes nothing: every figure is the server's. So what these pin
 * is that the page asks the right endpoint, for the right period, and puts
 * each figure where a person reads it -- the KPI row, the "where your calls
 * went" bar, the buyer and publisher tables; payable, held and paid per
 * publisher; and one row per downline agency. An empty period gets the empty
 * state rather than a wall of zeroes.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CallSalesSummary,
  NetworkAgencies,
  PayoutsSummary,
} from '@/components/white-label/types';

const PERIOD = {
  key: 'TODAY' as const,
  label: 'Today',
  from: '2026-09-25',
  to: '2026-09-25',
  days: 1,
  complete: false,
};

const SALES: CallSalesSummary = {
  period: PERIOD,
  totals: {
    inboundCalls: 5,
    answeredByAgents: 1,
    sentToBuyers: 3,
    billableToBuyers: 2,
    sellThroughPct: 66.67,
    revenue: 90,
    publisherPayouts: 45,
    callCost: 1.3,
    otherCosts: 0.05,
    adjustments: -2,
    disputes: 40,
    profit: 43.65,
    marginPct: 48.5,
    revenuePerBillableCall: 45,
    disputedCalls: 1,
    duplicates: 1,
    blocked: 1,
  },
  disposition: { yourAgents: 1, buyers: 3, unanswered: 0, blocked: 1 },
  byBuyer: [
    {
      buyerId: 'buyer-acme',
      buyerName: 'Acme Senior',
      calls: 2,
      billable: 1,
      billablePct: 50,
      revenue: 50,
      avgConnectedSeconds: 115,
      disputed: 0,
      capConsumedToday: 7,
    },
  ],
  byPublisher: [
    {
      publisherId: 'pub-alpha',
      publisherName: 'Alpha Media',
      calls: 3,
      answeredByAgents: 0,
      sentToBuyers: 2,
      billable: 1,
      payout: 20,
      revenue: 50,
      profit: 29.35,
    },
  ],
  byDay: [
    {
      day: '2026-09-25',
      inbound: 5,
      sentToBuyers: 3,
      billable: 2,
      revenue: 90,
      payout: 45,
      profit: 43.65,
    },
  ],
};

const PAYOUTS: PayoutsSummary = {
  period: {
    ...PERIOD,
    key: 'THIS_MONTH',
    from: '2026-09-01',
    to: '2026-09-25',
    startsAt: '2026-09-01T04:00:00.000Z',
    endsAt: '2026-09-26T03:59:59.999Z',
  },
  publishers: [
    {
      publisherId: 'pub-alpha',
      publisherName: 'Alpha Media',
      payable: 20,
      payableCalls: 1,
      held: 15,
      paid: 300,
      lastPayment: {
        id: 'pay-1',
        publisherId: 'pub-alpha',
        publisherName: 'Alpha Media',
        amount: 300,
        periodFrom: '2026-08-01T04:00:00.000Z',
        periodTo: '2026-09-01T03:59:59.999Z',
        method: 'ACH',
        reference: 'TRX-88',
        paidAt: '2026-09-02T15:00:00.000Z',
      },
    },
  ],
  payments: [
    {
      id: 'pay-1',
      publisherId: 'pub-alpha',
      publisherName: 'Alpha Media',
      amount: 300,
      periodFrom: '2026-08-01T04:00:00.000Z',
      periodTo: '2026-09-01T03:59:59.999Z',
      method: 'ACH',
      reference: 'TRX-88',
      paidAt: '2026-09-02T15:00:00.000Z',
    },
  ],
};

const NETWORK: NetworkAgencies = {
  period: { ...PERIOD, key: 'THIS_MONTH', from: '2026-09-01' },
  agencies: [
    {
      tenantId: 'child-1',
      name: 'Downline One',
      status: 'ACTIVE',
      createdAt: '2026-09-20T15:00:00.000Z',
      agents: 4,
      inboundCalls: 120,
      answeredByAgents: 100,
      applications: 9,
      closingPct: 9,
      owner: { status: 'PENDING', email: 'owner@downline.test', invitedAt: null },
    },
  ],
};

/** What each endpoint answers for the case under test. */
let answers: Record<string, unknown> = {};
const requested: string[] = [];

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
            email: 'owner@llp.test',
            roles: ['OWNER', 'ADMIN'],
            tenantId: 'tenant-llp',
            whiteLabel: true,
          },
        });
      }
      if (url.pathname in answers) return json({ data: answers[url.pathname] });
      return json({ data: [] });
    })
  );
}

vi.mock('next/navigation', () => ({
  usePathname: () => '/sales',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

async function mount(load: () => Promise<{ default: () => JSX.Element }>): Promise<void> {
  const { AuthSessionProvider } = await import('@/hooks/use-auth');
  const { default: Page } = await load();
  render(
    <AuthSessionProvider>
      <Page />
    </AuthSessionProvider>
  );
}

describe('white-label screens', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('token', 'a-signed-in-white-label-owner');
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    requested.length = 0;
    answers = {};
    installFetch();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('/sales', () => {
    it('renders the KPIs, where the calls went, and the buyer and publisher tables', async () => {
      answers['/api/v1/call-sales/summary'] = SALES;
      await mount(() => import('../(dashboard)/sales/page'));

      await waitFor(() => expect(screen.getByText('Acme Senior')).toBeTruthy());

      const figure = (label: string) =>
        document.querySelector(`[data-figure-label="${label}"]`)?.getAttribute('data-figure-value');
      expect(figure('Revenue')).toBe('$90.00');
      expect(figure('Profit')).toBe('$43.65');
      expect(figure('Margin')).toBe('48.5%');
      expect(figure('Billable to buyers')).toBe('2');
      expect(figure('Sell-through')).toBe('66.7%');
      expect(figure('Revenue per billable call')).toBe('$45.00');

      expect(screen.getByText('Where your calls went')).toBeTruthy();
      const agents = document.querySelector('[data-part="agents"]');
      expect(agents?.textContent).toContain('1');
      expect(agents?.textContent).toContain('20.0%');
      expect(agents?.querySelector('a')?.getAttribute('href')).toBe('/leaderboard?period=TODAY');

      const buyerLink = screen.getByText('Acme Senior').closest('a');
      expect(buyerLink?.getAttribute('href')).toBe('/buyers?id=buyer-acme');
      expect(screen.getByText('Alpha Media')).toBeTruthy();
      expect(screen.getByText('$29.35')).toBeTruthy();

      expect(requested).toContain('/api/v1/call-sales/summary?period=TODAY');
      expect(screen.getByRole('button', { name: /Export CSV/i })).toBeTruthy();
    });

    it('shows the empty state when there were no inbound calls', async () => {
      answers['/api/v1/call-sales/summary'] = {
        ...SALES,
        totals: { ...SALES.totals, inboundCalls: 0 },
        byBuyer: [],
        byPublisher: [],
        byDay: [],
      };
      await mount(() => import('../(dashboard)/sales/page'));
      await waitFor(() =>
        expect(screen.getByText('No inbound calls in this period.')).toBeTruthy()
      );
      expect(screen.queryByText('Where your calls went')).toBeNull();
    });
  });

  describe('/payouts', () => {
    it("renders each publisher's payable, held and paid, and the payment history", async () => {
      answers['/api/v1/payouts/summary'] = PAYOUTS;
      await mount(() => import('../(dashboard)/payouts/page'));

      await waitFor(() => expect(screen.getAllByText('Alpha Media').length).toBeGreaterThan(0));
      const row = document.querySelector('[data-publisher="pub-alpha"]') as HTMLElement;
      expect(within(row).getByText('$20.00')).toBeTruthy();
      expect(within(row).getByText('$15.00')).toBeTruthy();
      expect(row.querySelector('[data-figure="paid"]')?.textContent).toBe('$300.00');
      expect(within(row).getByRole('button', { name: 'Record payment' })).toBeTruthy();

      expect(screen.getByText('Payment history')).toBeTruthy();
      expect(screen.getByText('TRX-88')).toBeTruthy();
      expect(requested).toContain('/api/v1/payouts/summary?period=THIS_MONTH');
    });
  });

  describe('/network/agencies', () => {
    it('renders one row per downline agency, with its aggregates and owner', async () => {
      answers['/api/v1/network/agencies'] = NETWORK;
      await mount(() => import('../(dashboard)/network/agencies/page'));

      await waitFor(() => expect(screen.getByText('Downline One')).toBeTruthy());
      expect(screen.getByText('120')).toBeTruthy();
      expect(screen.getByText('100')).toBeTruthy();
      expect(screen.getByText('9.0%')).toBeTruthy();
      expect(screen.getByText('Invite pending')).toBeTruthy();
      expect(screen.getByText('owner@downline.test')).toBeTruthy();
      expect(
        screen.getAllByRole('link', { name: /Onboard an Agency/i })[0].getAttribute('href')
      ).toBe('/network/onboarding');
      expect(requested).toContain('/api/v1/network/agencies?period=THIS_MONTH');
    });

    it('offers onboarding when there are none yet', async () => {
      answers['/api/v1/network/agencies'] = { ...NETWORK, agencies: [] };
      await mount(() => import('../(dashboard)/network/agencies/page'));
      await waitFor(() =>
        expect(screen.getByText('You have not onboarded an agency yet.')).toBeTruthy()
      );
    });
  });
});
