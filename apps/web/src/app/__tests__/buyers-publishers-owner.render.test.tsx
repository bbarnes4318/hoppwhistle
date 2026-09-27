/**
 * Buyers and Publishers, RENDERED as a white-label agency's owner.
 *
 *   Buyers      Edit on a buyer with no publisher. Every Life Leads Plus buyer
 *               has none, and the dialog read `buyer.publisher.id`, so Edit
 *               threw instead of opening.
 *   Publishers  "View stats" opens a "Publisher stats" drawer in place. It used
 *               to send the owner to `/dashboard?publisherId=`, which Today
 *               ignores. The drawer is mounted directly: opening the row's
 *               Radix dropdown under jsdom never returns.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function pathOf(input: RequestInfo | URL): string {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  try {
    return new URL(raw, 'http://localhost').pathname;
  } catch {
    return raw;
  }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const BUYER = {
  id: 'buyer-1',
  name: 'Acme Insurance',
  code: 'ACME',
  subId: null,
  status: 'ACTIVE',
  billingType: 'TERMS',
  leadsRemaining: 0,
  billableDuration: 60,
  canPauseTargets: false,
  canSetCaps: false,
  canDisputeConversions: false,
  publisher: null,
  callCount: 0,
  transactionCount: 0,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

const PUBLISHER = {
  id: 'pub-1',
  name: 'Northwind Media',
  code: 'NW',
  email: null,
  accessToRecordings: false,
  status: 'ACTIVE',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

const STATS = {
  period: { key: 'CUSTOM', label: 'x', from: '2026-09-21', to: '2026-09-27', days: 7 },
  totalCalls: 12,
  billableCalls: 7,
  billableToBuyers: 5,
  billableAgentAnswered: 2,
  nonBillableCalls: 5,
  payout: 84.5,
  billableRate: 58.3,
  averageConnectedDuration: 125,
  pingCount: 0,
  noBidCount: 0,
  revenue: 300,
  profit: 190.25,
  topCampaigns: [{ campaignId: 'c1', campaignName: 'Final Expense', callsCount: 12, payout: 84.5 }],
  recentCalls: [
    {
      id: 'call-9',
      createdAt: '2026-09-27T14:00:00.000Z',
      callerId: '+15551234567',
      billable: true,
      campaign: { name: 'Final Expense' },
    },
  ],
};

const requested: string[] = [];

function installFetch(): void {
  requested.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      requested.push(raw);
      const path = pathOf(input);

      if (path === '/api/auth/me') {
        return json({
          data: {
            id: 'owner-1',
            email: 'owner@agency.test',
            roles: ['OWNER', 'ADMIN'],
            tenantId: 'tenant-a',
          },
        });
      }
      if (path.startsWith('/api/v1/platform/context')) {
        return json({ isPlatformAdmin: false, actingTenant: null });
      }
      if (path === '/api/v1/buyers') {
        return json({ data: [BUYER], meta: { totalPages: 1 } });
      }
      if (path === '/api/v1/publishers') {
        return json({ data: [PUBLISHER], meta: { totalPages: 1 } });
      }
      if (path === '/api/v1/publishers/pub-1/stats') return json(STATS);
      if (path === '/api/v1/publishers/pub-1/daily') {
        return json({
          data: {
            days: [
              { day: '2026-09-26', calls: 5, billable: 3, payout: 30 },
              { day: '2026-09-27', calls: 7, billable: 4, payout: 54.5 },
            ],
          },
        });
      }
      return json({ data: [] });
    })
  );
}

vi.mock('next/navigation', () => ({
  usePathname: () => '/buyers',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

/** Radix and recharts measure, and jsdom has no ResizeObserver. */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

describe('owner screens: buyers without a publisher, publisher stats', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    installFetch();
    localStorage.setItem('token', 'a-signed-in-agency-owner');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens Edit on a buyer whose publisher is null', async () => {
    const { AuthSessionProvider } = await import('@/hooks/use-auth');
    const { BuyersView } = await import('@/components/buyers/buyers-view');

    render(
      <AuthSessionProvider>
        <BuyersView />
      </AuthSessionProvider>
    );

    await screen.findByText('Acme Insurance');
    fireEvent.click(screen.getByTitle('Edit'));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Edit Buyer')).toBeTruthy();
    expect(within(dialog).getByText('Publisher (optional)')).toBeTruthy();
    expect(within(dialog).getByLabelText('Company Name')).toHaveProperty('value', 'Acme Insurance');
  });

  it('opens the "Publisher stats" drawer with the owner figures', async () => {
    const { PublisherStatsDrawer } = await import('@/components/publishers/publisher-stats-drawer');

    render(<PublisherStatsDrawer publisher={PUBLISHER} onOpenChange={() => {}} />);

    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('Publisher stats')).toBeTruthy();
    await within(drawer).findByText('$84.50', { selector: 'dd' });
    expect(within(drawer).getByText('$300.00')).toBeTruthy();
    expect(within(drawer).getByText('$190.25')).toBeTruthy();

    const call = within(drawer).getByRole('link', { name: /555/ });
    expect(call.getAttribute('href')).toBe('/calls?call=call-9');
    expect(within(drawer).getByRole('link', { name: 'Payouts' }).getAttribute('href')).toBe(
      '/publishers?tab=payouts'
    );

    // Last 7 days by default: a custom range of seven New York days.
    const statsUrl = requested.find(url => url.includes('/api/v1/publishers/pub-1/stats'));
    expect(statsUrl).toMatch(/period=CUSTOM&from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}/);

    fireEvent.click(within(drawer).getByRole('button', { name: 'This month' }));
    await waitFor(() =>
      expect(requested.some(url => url.endsWith('/stats?period=THIS_MONTH'))).toBe(true)
    );
  });
});
