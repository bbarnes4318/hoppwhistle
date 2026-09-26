/**
 * The white-label owner's consolidated portal, RENDERED from fixture answers.
 *
 * The nav went from twenty-seven entries to eleven, and most of what the
 * other sixteen were is now a tab of a hub. What these pin is that each hub
 * opens the tab its URL names, that each tab mounts the screen it stands for
 * (asking that screen's own endpoint), and the new screens -- Today, Returns,
 * Plan & Billing, Upgrades -- put every figure the server sent where a person
 * reads it. The layout's redirects from the old URLs are here too, because a
 * redirect is only right if it is right for the viewer: a white-label owner
 * lands on the tab, and a normal agency owner is not moved.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ReturnRow } from '@/components/buyers/returns-types';
import type { WhiteLabelToday } from '@/components/white-label/types';
import { WHITE_LABEL_REDIRECTS } from '@/lib/staff-only-routes';

/* ── The session and the API ──────────────────────────────────────────────── */

let whiteLabel = true;
let upgrades: string[] = [];

/** Bodies by pathname, exactly as the server would send them. */
let answers: Record<string, unknown> = {};
const requested: string[] = [];
const posted: Array<{ path: string; body: unknown }> = [];

function urlOf(input: RequestInfo | URL): URL {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return new URL(raw, 'http://localhost');
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** An empty page of anything, for the list endpoints a test is not about. */
const EMPTY_PAGE = { data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } };

const LISTS = [
  '/api/v1/buyers',
  '/api/v1/buyers/stats',
  '/api/v1/publishers',
  '/api/v1/publishers/stats',
  '/api/v1/campaigns',
  '/api/v1/campaigns/stats',
  '/api/v1/numbers',
  '/api/v1/users',
  '/api/v1/webhooks',
  '/api/v1/billing/invoices',
  '/api/v1/delivery/settlements',
];

function installFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      requested.push(`${method} ${url.pathname}${url.search}`);
      if (method !== 'GET') {
        posted.push({
          path: url.pathname,
          body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
        });
      }
      if (url.pathname === '/api/auth/me') {
        return json({
          data: {
            id: 'owner-1',
            email: 'owner@llp.test',
            roles: ['OWNER', 'ADMIN'],
            permissions: ['admin:*'],
            tenantId: 'tenant-llp',
            whiteLabel,
            upgrades,
            brand: whiteLabel ? { theme: 'life-leads-plus', name: 'Life Leads Plus' } : null,
          },
        });
      }
      if (url.pathname === '/api/v1/platform/context') {
        return json({ data: { isPlatformAdmin: false, actingTenant: null, previewRole: null } });
      }
      const key = `${method} ${url.pathname}`;
      if (key in answers) return json(answers[key]);
      if (url.pathname in answers) return json(answers[url.pathname]);
      // The list endpoints a test is not about answer an empty page; anything
      // else is not in the fixture, and says so the way the API would.
      if (LISTS.includes(url.pathname)) return json(EMPTY_PAGE);
      return json({ error: { code: 'NOT_FOUND', message: 'Not in this fixture' } }, 404);
    })
  );
}

/* ── The router ───────────────────────────────────────────────────────────── */

let pathname = '/dashboard';
let search = new URLSearchParams();
let redirects: string[] = [];

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({
    replace: (to: string) => redirects.push(to),
    push: (to: string) => redirects.push(to),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => search,
}));

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** Open `path` (with its query) and mount the page for it under the real providers. */
async function mount(
  path: string,
  load: () => Promise<{ default: () => JSX.Element }>
): Promise<void> {
  const [bare, query = ''] = path.split('?');
  pathname = bare;
  search = new URLSearchParams(query);
  window.history.replaceState(null, '', path);

  const { AuthSessionProvider } = await import('@/hooks/use-auth');
  const { PlatformContextProvider } = await import('@/hooks/use-platform-context');
  const { default: Page } = await load();
  render(
    <AuthSessionProvider>
      <PlatformContextProvider>
        <Page />
      </PlatformContextProvider>
    </AuthSessionProvider>
  );
}

const figure = (label: string) =>
  document.querySelector(`[data-figure-label="${label}"]`)?.getAttribute('data-figure-value');

const activeTab = () =>
  document.querySelector('[role="tab"][data-state="active"]')?.getAttribute('data-hub-tab');

const asked = (prefix: string) => requested.some(line => line.startsWith(prefix));

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

const TODAY: WhiteLabelToday = {
  now: {
    callsUp: 4,
    agentsReady: 3,
    agentsOnCall: 1,
    agentsActive: 5,
    buyersTaking: 2,
    buyersAtCap: 1,
    buyersActive: 3,
    returnsOpen: 2,
  },
  today: {
    inbound: 20,
    answeredByAgents: 8,
    sentToBuyers: 9,
    unanswered: 2,
    blocked: 1,
    revenue: 450,
    profit: 210.5,
    applications: 3,
    closingPct: 37.5,
  },
  buyers: [
    {
      id: 'buyer-acme',
      name: 'Acme Senior',
      kind: 'buyer',
      callsInFlight: 2,
      deliveredToday: 6,
      applicationsToday: 2,
      closingPct: 33.3,
      atCap: true,
      capUsed: 6,
      capMax: 6,
    },
  ],
  attention: [
    {
      kind: 'returns',
      count: 2,
      href: '/buyers?tab=returns',
      label: 'Returns waiting for a decision',
    },
    { kind: 'buyers_at_cap', count: 1, href: '/buyers', label: "Buyers at today's cap" },
    {
      kind: 'agents_blocked',
      count: 2,
      href: '/agents?tab=roster',
      label: "Agents who can't take calls",
    },
    {
      kind: 'payouts_owed',
      count: 5,
      amount: 125,
      href: '/publishers?tab=payouts',
      label: 'Owed to publishers',
    },
  ],
};

function returnRow(overrides: Partial<ReturnRow>): ReturnRow {
  return {
    callId: 'call-1',
    startedAt: '2026-09-25T15:00:00.000Z',
    status: 'OPEN',
    buyer: { id: 'buyer-acme', name: 'Acme Senior' },
    publisher: { id: 'pub-alpha', name: 'Alpha Media' },
    campaignName: 'Final Expense',
    callerId: '+14155550142',
    connectedDuration: 45,
    buyerBillableAmount: 40,
    publisherPayoutAmount: 15,
    publisherPayoutStatus: 'PAYABLE',
    buyerChargeStatus: 'CHARGED',
    buyerBillingType: 'UPFRONT',
    reason: 'Caller hung up before the threshold',
    disputedAt: '2026-09-25T16:00:00.000Z',
    disputedBy: 'buyer@acme.test',
    recordingId: 'rec-1',
    decision: null,
    returnAfterPublisherPaid: false,
    ...overrides,
  };
}

const RETURNS = {
  data: [
    returnRow({}),
    returnRow({
      callId: 'call-2',
      reason: 'Duplicate caller',
      publisherPayoutStatus: 'PAID',
      recordingId: null,
    }),
  ],
  meta: { page: 1, limit: 50, total: 2, totalPages: 1, openCount: 2 },
};

const USERS = {
  data: [
    {
      id: 'agent-1',
      email: 'agent@llp.test',
      firstName: 'Ada',
      lastName: 'Agent',
      status: 'active',
      roles: ['agent'],
      invitedAt: '2026-09-01T00:00:00.000Z',
      lastLoginAt: null,
      licensedStates: ['TX'],
    },
  ],
  meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
};

const ROSTER = {
  data: {
    agents: [],
    campaigns: [{ id: 'camp-1', name: 'Final Expense' }],
    defaultMaxConcurrentCalls: 1,
    deliveryTimeZone: 'America/New_York',
  },
};

/* ── The tests ────────────────────────────────────────────────────────────── */

describe('the white-label portal', () => {
  beforeAll(async () => {
    await Promise.all([
      import('@/hooks/use-auth'),
      import('@/hooks/use-platform-context'),
      import('../(dashboard)/dashboard/page'),
      import('../(dashboard)/agents/page'),
      import('../(dashboard)/buyers/page'),
      import('../(dashboard)/publishers/page'),
      import('../(dashboard)/revenue/page'),
      import('../(dashboard)/routing/page'),
      import('../(dashboard)/settings/page'),
      import('../(dashboard)/upgrades/page'),
    ]);
  }, 120_000);

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('token', 'a-signed-in-white-label-owner');
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    whiteLabel = true;
    upgrades = [];
    requested.length = 0;
    posted.length = 0;
    redirects = [];
    answers = {};
    installFetch();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('Today', () => {
    it('is the dashboard for a white-label owner, with every figure where it is read', async () => {
      answers['/api/v1/white-label/today'] = { data: TODAY };
      await mount('/dashboard', () => import('../(dashboard)/dashboard/page'));

      await waitFor(() => expect(figure('Calls up')).toBe('4'));
      expect(figure('Agents ready')).toBe('3 of 5');
      expect(screen.getByText('1 on a call')).toBeTruthy();
      expect(figure('Buyers taking calls')).toBe('2 of 3');
      expect(screen.getByText('1 at cap')).toBeTruthy();
      expect(figure('Returns waiting')).toBe('2');
      expect(screen.getByRole('link', { name: 'Returns waiting: 2' }).getAttribute('href')).toBe(
        '/buyers?tab=returns'
      );

      expect(screen.getByText('Where your calls went')).toBeTruthy();
      expect(document.querySelector('[data-part="agents"]')?.textContent).toContain('8');
      expect(document.querySelector('[data-part="buyers"]')?.textContent).toContain('9');
      expect(document.querySelector('[data-part="unanswered"]')?.textContent).toContain('2');
      expect(document.querySelector('[data-part="blocked"]')?.textContent).toContain('1');

      expect(figure('Revenue')).toBe('$450.00');
      expect(figure('Profit')).toBe('$210.50');
      expect(figure('Applications')).toBe('3');
      expect(figure('Closing %')).toBe('37.5%');

      const attention = screen.getByRole('list', { name: 'Needs attention' });
      const links = within(attention).getAllByRole('link');
      expect(links.map(link => link.getAttribute('href'))).toEqual([
        '/buyers?tab=returns',
        '/buyers',
        '/agents?tab=roster',
        '/publishers?tab=payouts',
      ]);
      expect(within(attention).getByText('$125.00')).toBeTruthy();

      const buyer = document.querySelector('[data-buyer="buyer-acme"]') as HTMLElement;
      expect(within(buyer).getByText('Acme Senior').closest('a')?.getAttribute('href')).toBe(
        '/buyers?id=buyer-acme'
      );
      expect(buyer.querySelector('[data-cap]')?.textContent).toBe('6 / 6');

      // Not on this page: the chart and the call history the old dashboard had.
      expect(screen.queryByText(/Sales today/i)).toBeNull();
      expect(asked('GET /api/v1/calls')).toBe(false);
    });

    it('says so when nothing needs attention', async () => {
      answers['/api/v1/white-label/today'] = { data: { ...TODAY, attention: [] } };
      await mount('/dashboard', () => import('../(dashboard)/dashboard/page'));
      await waitFor(() => expect(screen.getByText('Nothing needs you right now.')).toBeTruthy());
    });

    it('is not what a normal agency owner gets', async () => {
      whiteLabel = false;
      await mount('/dashboard', () => import('../(dashboard)/dashboard/page'));
      await waitFor(() => expect(asked('GET /api/auth/me')).toBe(true));
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(document.querySelector('[data-testid="white-label-today"]')).toBeNull();
      expect(asked('GET /api/v1/white-label/today')).toBe(false);
    });
  });

  describe('Agents', () => {
    it('opens on Performance, the Leaderboard', async () => {
      await mount('/agents', () => import('../(dashboard)/agents/page'));
      await waitFor(() => expect(asked('GET /api/v1/leaderboard?period=TODAY')).toBe(true));
      expect(activeTab()).toBe('performance');
      expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual([
        'Performance',
        'Today',
        'Over a period',
        'Roster',
      ]);
    });

    it('shows Agents today on the Today tab', async () => {
      await mount('/agents?tab=today', () => import('../(dashboard)/agents/page'));
      await waitFor(() => expect(screen.getByText('Agents today')).toBeTruthy());
      expect(activeTab()).toBe('today');
      expect(asked('GET /api/v1/delivery/agents')).toBe(true);
      // Only the rows: Delivery's block and rate are on Plan & Billing.
      expect(asked('GET /api/v1/delivery/today')).toBe(false);
    });

    it('shows the Team report on the period tab', async () => {
      await mount('/agents?tab=period', () => import('../(dashboard)/agents/page'));
      await waitFor(() => expect(asked('GET /api/v1/delivery/agents/range?')).toBe(true));
      expect(activeTab()).toBe('period');
    });

    it('shows Team Members on the roster tab, inviting only the agency’s own people', async () => {
      answers['/api/v1/users'] = USERS;
      answers['/api/v1/agent-roster'] = ROSTER;
      await mount('/agents?tab=roster', () => import('../(dashboard)/agents/page'));
      await waitFor(() => expect(screen.getByText('agent@llp.test')).toBeTruthy());
      expect(activeTab()).toBe('roster');
      expect(screen.getByRole('button', { name: 'Invite agent or manager' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Invite user' })).toBeNull();

      const { rolesOffered } = await import('@/components/users/invite-user-dialog');
      expect(rolesOffered(['AGENT', 'ADMIN', 'ANALYST']).map(role => role.value)).toEqual([
        'ADMIN',
        'ANALYST',
        'AGENT',
      ]);
      expect(rolesOffered().map(role => role.value)).toEqual([
        'ADMIN',
        'OWNER',
        'ANALYST',
        'AGENT',
        'BUYER',
        'PUBLISHER',
      ]);
    });

    it('changes tab by replacing ?tab=', async () => {
      await mount('/agents', () => import('../(dashboard)/agents/page'));
      await waitFor(() => expect(activeTab()).toBe('performance'));
      const roster = screen.getByRole('tab', { name: 'Roster' });
      fireEvent.mouseDown(roster);
      fireEvent.click(roster);
      await waitFor(() => expect(redirects).toContain('/agents?tab=roster'));
    });
  });

  describe('Buyers', () => {
    it('shows Returns with the open count, and decides one', async () => {
      answers['/api/v1/returns'] = RETURNS;
      answers['POST /api/v1/returns/call-2/decision'] = {
        data: returnRow({ callId: 'call-2', status: 'ACCEPTED' }),
      };
      await mount('/buyers?tab=returns', () => import('../(dashboard)/buyers/page'));

      await waitFor(() =>
        expect(screen.getAllByText('Duplicate caller').length).toBeGreaterThan(0)
      );
      expect(activeTab()).toBe('returns');
      await waitFor(() => expect(screen.getByRole('tab', { name: 'Returns (2)' })).toBeTruthy());
      expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual([
        'Buyers',
        'Buyer balances',
        'Returns (2)',
      ]);
      expect(asked('GET /api/v1/returns?status=OPEN&page=1')).toBe(true);

      const first = document.querySelector('[data-return="call-1"]') as HTMLElement;
      expect(within(first).getByRole('button', { name: 'Play recording' })).toBeTruthy();
      const paid = document.querySelector('[data-return="call-2"]') as HTMLElement;
      expect(within(paid).queryByRole('button', { name: 'Play recording' })).toBeNull();

      fireEvent.click(within(paid).getByRole('button', { name: 'Accept' }));
      const dialog = await screen.findByRole('dialog');
      expect(
        within(dialog).getByText(/This publisher was already paid for this call/)
      ).toBeTruthy();
      expect(dialog.querySelector('[data-effect="buyer"]')?.textContent).toBe(
        "$40.00 is credited back to Acme Senior's balance."
      );

      fireEvent.change(within(dialog).getByLabelText('Note (optional)'), {
        target: { value: 'Same caller twice' },
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Accept return' }));
      await waitFor(() =>
        expect(posted).toContainEqual({
          path: '/api/v1/returns/call-2/decision',
          body: { decision: 'ACCEPT', note: 'Same caller twice' },
        })
      );
    });

    it('says what a denial does to a held payout', async () => {
      answers['/api/v1/returns'] = {
        ...RETURNS,
        data: [returnRow({ publisherPayoutStatus: 'HELD' })],
      };
      await mount('/buyers?tab=returns', () => import('../(dashboard)/buyers/page'));
      await waitFor(() => expect(document.querySelector('[data-return="call-1"]')).toBeTruthy());
      const row = document.querySelector('[data-return="call-1"]') as HTMLElement;
      fireEvent.click(within(row).getByRole('button', { name: 'Deny' }));
      const dialog = await screen.findByRole('dialog');
      expect(dialog.querySelector('[data-effect="publisher"]')?.textContent).toBe(
        "Alpha Media's $15.00 payout goes back to payable."
      );
      expect(within(dialog).queryByText(/already paid/)).toBeNull();
    });

    it('shows buyer balances on the wallets tab', async () => {
      await mount('/buyers?tab=wallets', () => import('../(dashboard)/buyers/page'));
      await waitFor(() => expect(asked('GET /api/v1/billing/balance')).toBe(true));
      expect(activeTab()).toBe('wallets');
      expect(screen.getByText('Invoices')).toBeTruthy();
    });

    it('is the plain buyers screen for anybody else', async () => {
      whiteLabel = false;
      await mount('/buyers', () => import('../(dashboard)/buyers/page'));
      await waitFor(() => expect(asked('GET /api/v1/buyers?')).toBe(true));
      expect(screen.queryByRole('tab', { name: /Returns/ })).toBeNull();
      expect(asked('GET /api/v1/returns')).toBe(false);
    });
  });

  describe('Publishers', () => {
    it('shows Payouts on the payouts tab', async () => {
      await mount('/publishers?tab=payouts', () => import('../(dashboard)/publishers/page'));
      await waitFor(() =>
        expect(asked('GET /api/v1/payouts/summary?period=THIS_MONTH')).toBe(true)
      );
      expect(activeTab()).toBe('payouts');
      expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual([
        'Publishers',
        'Payouts',
      ]);
    });
  });

  describe('Revenue', () => {
    it('opens on the overview, which is the Sales view', async () => {
      await mount('/revenue', () => import('../(dashboard)/revenue/page'));
      await waitFor(() => expect(asked('GET /api/v1/call-sales/summary?period=TODAY')).toBe(true));
      expect(activeTab()).toBe('overview');
    });

    it('shows Reports on the reports tab', async () => {
      await mount('/revenue?tab=reports', () => import('../(dashboard)/revenue/page'));
      await waitFor(() => expect(asked('GET /api/v1/reports/')).toBe(true));
      expect(activeTab()).toBe('reports');
    });
  });

  describe('Routing', () => {
    it('opens on Campaigns, and Numbers is a tab', async () => {
      await mount('/routing', () => import('../(dashboard)/routing/page'));
      await waitFor(() => expect(asked('GET /api/v1/campaigns?')).toBe(true));
      expect(activeTab()).toBe('campaigns');
      cleanup();
      requested.length = 0;
      await mount('/routing?tab=numbers', () => import('../(dashboard)/routing/page'));
      await waitFor(() => expect(asked('GET /api/v1/numbers?')).toBe(true));
      expect(activeTab()).toBe('numbers');
      // Buying, adding and syncing numbers stay with platform admins.
      expect(screen.queryByRole('button', { name: /Buy Number/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /Add existing/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /Sync Anveo/ })).toBeNull();
    });
  });

  describe('Settings', () => {
    it('stacks Rate, Delivery and Settlements under Plan & Billing', async () => {
      await mount(
        '/settings?tab=plan&section=settlements',
        () => import('../(dashboard)/settings/page')
      );
      await waitFor(() => expect(screen.getByRole('heading', { name: 'Rate' })).toBeTruthy());
      expect(activeTab()).toBe('plan');
      expect(screen.getByRole('heading', { name: 'Delivery' })).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'Settlements' })).toBeTruthy();
      expect(document.getElementById('settlements')).toBeTruthy();
      await waitFor(() => expect(asked('GET /api/v1/rating/summary')).toBe(true));
      expect(asked('GET /api/v1/delivery/today')).toBe(true);
      expect(asked('GET /api/v1/delivery/settlements')).toBe(true);
    });

    it('is the plain settings screen for a normal agency', async () => {
      whiteLabel = false;
      await mount('/settings', () => import('../(dashboard)/settings/page'));
      await waitFor(() => expect(asked('GET /api/auth/me')).toBe(true));
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(screen.queryByRole('tab', { name: 'Plan & Billing' })).toBeNull();
    });
  });

  describe('Upgrades', () => {
    it('lists the five upgrades, each with who to ask', async () => {
      await mount('/upgrades', () => import('../(dashboard)/upgrades/page'));
      await waitFor(() => expect(document.querySelectorAll('[data-upgrade]').length).toBe(5));
      expect(
        [...document.querySelectorAll('[data-upgrade] h2')].map(heading => heading.textContent)
      ).toEqual([
        'Power Dialer',
        'VOIP Carrier Routing',
        'Voice Agents',
        'Voice Studio',
        'Payroll Admin',
      ]);
      expect(screen.getByText('Includes the CRM and lead lists your agents dial.')).toBeTruthy();
      expect(screen.getAllByText('Ask your account manager to turn this on.')).toHaveLength(5);
    });

    it('says which are already on', async () => {
      upgrades = ['POWER_DIALER'];
      await mount('/upgrades', () => import('../(dashboard)/upgrades/page'));
      await waitFor(() => expect(screen.getByText('Turned on for your agency.')).toBeTruthy());
      expect(screen.getAllByText('Ask your account manager to turn this on.')).toHaveLength(4);
    });
  });
});

describe('the old URLs', () => {
  beforeAll(async () => {
    await Promise.all([
      import('@/hooks/use-auth'),
      import('@/hooks/use-platform-context'),
      import('@/contexts/customer-intake-context'),
      import('../(dashboard)/layout'),
    ]);
  }, 120_000);

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('token', 'a-signed-in-owner');
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    upgrades = [];
    requested.length = 0;
    redirects = [];
    answers = {};
    installFetch();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** Mount the real dashboard layout at `path` with an empty page, and let it settle. */
  async function visit(path: string): Promise<void> {
    const [bare, query = ''] = path.split('?');
    pathname = bare;
    search = new URLSearchParams(query);
    window.history.replaceState(null, '', path);
    const { AuthSessionProvider } = await import('@/hooks/use-auth');
    const { PlatformContextProvider } = await import('@/hooks/use-platform-context');
    const { CustomerIntakeProvider } = await import('@/contexts/customer-intake-context');
    const { default: DashboardLayout } = await import('../(dashboard)/layout');
    render(
      <AuthSessionProvider>
        <PlatformContextProvider>
          <CustomerIntakeProvider>
            <DashboardLayout>
              <div />
            </DashboardLayout>
          </CustomerIntakeProvider>
        </PlatformContextProvider>
      </AuthSessionProvider>
    );
    await waitFor(() => expect(asked('GET /api/v1/platform/context')).toBe(true));
    await new Promise(resolve => setTimeout(resolve, 60));
  }

  const OLD = Object.entries(WHITE_LABEL_REDIRECTS);

  it.each(OLD)('sends a white-label owner from %s to %s', async (from, to) => {
    whiteLabel = true;
    await visit(from);
    await waitFor(() => expect(redirects).toContain(to));
  });

  it.each(OLD)('leaves a normal owner on %s, or sends them home as before', async from => {
    whiteLabel = false;
    await visit(from);
    const hubs = Object.values(WHITE_LABEL_REDIRECTS);
    expect(redirects.filter(to => hubs.includes(to) && to !== '/dashboard')).toEqual([]);
    // The screens a normal agency always had stay where they are.
    if (['/sales', '/reports', '/payouts', '/numbers'].includes(from)) {
      expect(redirects).toEqual(['/dashboard']);
    } else {
      expect(redirects).toEqual([]);
    }
  });

  it('sends a normal owner home from the white-label hubs', async () => {
    whiteLabel = false;
    for (const hub of ['/agents', '/revenue', '/routing', '/upgrades']) {
      redirects = [];
      await visit(hub);
      expect(redirects, hub).toEqual(['/dashboard']);
      cleanup();
    }
  });
});
