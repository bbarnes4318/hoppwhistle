/**
 * The agent's portal, RENDERED: the parts of it that are an agent's alone.
 *
 * An agent sees the owner's design system, and a handful of things the owner
 * does not: their own day, a console whose figures are the server's, no
 * webhooks, no column that repeats their own name. This pins those.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const requested: string[] = [];

function urlOf(input: RequestInfo | URL): URL {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return new URL(raw, 'http://localhost');
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let pathname = '/';
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

vi.mock('@/components/phone', () => ({ usePhone: () => ({ makeCall: vi.fn() }) }));

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

// On a white-label agency: an agent there is still an agent, not an operator.
const AGENT = {
  id: 'agent-1',
  email: 'agent@agency.test',
  roles: ['AGENT'],
  tenantId: 'tenant-a',
  whiteLabel: true,
  upgrades: ['POWER_DIALER'],
};
const OWNER = {
  id: 'owner-1',
  email: 'owner@agency.test',
  roles: ['OWNER', 'ADMIN'],
  tenantId: 'tenant-a',
  whiteLabel: true,
};
/** A NetEnroll operator who holds AGENT on their own account, not previewing. */
const STAFF_HOLDING_AGENT = {
  id: 'staff-2',
  email: 'ops@netenroll.test',
  roles: ['AGENT'],
  tenantId: 'tenant-a',
  whiteLabel: true,
  upgrades: ['POWER_DIALER'],
  isPlatformAdmin: true,
  previewRole: null,
  isReadOnlyPreview: false,
};
/** A NetEnroll operator inside the agency, viewing it as AGENT. */
const PREVIEW = {
  id: 'staff-1',
  email: 'staff@netenroll.test',
  roles: ['AGENT'],
  tenantId: 'tenant-a',
  whiteLabel: true,
  upgrades: ['POWER_DIALER'],
  isPlatformAdmin: true,
  previewRole: 'AGENT',
  isReadOnlyPreview: true,
};

/** Seven New York days ending on 2026-09-29, oldest first. */
function week(today: Partial<{ callsTaken: number; applications: number; talk: number }> = {}) {
  const days = ['23', '24', '25', '26', '27', '28', '29'];
  const shape = [
    [0, 0, 0],
    [9, 1, 2400],
    [11, 2, 3000],
    [6, 0, 1500],
    [0, 0, 0],
    [12, 3, 3600],
    [today.callsTaken ?? 4, today.applications ?? 1, today.talk ?? 900],
  ];
  return days.map((d, i) => ({
    day: `2026-09-${d}`,
    callsTaken: shape[i][0],
    applications: shape[i][1],
    talkTimeSeconds: shape[i][2],
  }));
}

function selfView(overrides: Record<string, unknown> = {}) {
  const trend = week();
  const last = trend[trend.length - 1];
  return {
    calendarDay: '2026-09-29',
    callsTaken: last.callsTaken,
    applications: last.applications,
    closingPct: last.callsTaken ? (last.applications / last.callsTaken) * 100 : null,
    talkTimeSeconds: last.talkTimeSeconds,
    availableSeconds: 5400,
    agencyClosingPct: 4.44,
    agencyCallsTaken: 90,
    agencyApplications: 4,
    trend,
    ...overrides,
  };
}

/** An agent's Today: four calls, one application, a 7-day trend, two follow-ups. */
function agentToday(
  overrides: Record<string, unknown> = {},
  summary: Record<string, unknown> = {}
) {
  const trend = week();
  return {
    generatedAt: '2026-09-29T18:30:00.000Z',
    period: { key: 'TODAY', label: 'Today', from: '2026-09-29', to: '2026-09-29', complete: false },
    summary: {
      callsAnswered: 4,
      applications: 1,
      closingPct: 25,
      talkTimeSeconds: 900,
      averageCallSeconds: 225,
      availableSeconds: 5400,
      followUpsDue: 7,
      ...summary,
    },
    comparison: {
      callsAnswered: 6,
      applications: 1,
      closingPct: 16.67,
      talkTimeSeconds: 1500,
      averageCallSeconds: 250,
      label: 'same time yesterday',
    },
    agencyBenchmark: { closingPct: 4.44 },
    trend,
    byHour: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      day: null,
      callsAnswered: hour === 10 ? 3 : hour === 11 ? 1 : 0,
      applications: hour === 11 ? 1 : 0,
    })),
    attention: [
      {
        kind: 'follow_up_overdue',
        leadId: 'lead-1',
        name: 'Carol Simmons',
        phone: '6155550101',
        stage: 'QUOTED',
        dueAt: '2026-09-27T15:00:00.000Z',
        overdue: true,
      },
      {
        kind: 'follow_up_due',
        leadId: 'lead-2',
        name: 'Dan Ortiz',
        phone: '6155550102',
        stage: null,
        dueAt: '2026-09-29T21:00:00.000Z',
        overdue: false,
      },
    ],
    recentCalls: [
      {
        id: 'call-1',
        at: '2026-09-29T15:10:00.000Z',
        caller: '+16155550101',
        direction: 'INBOUND',
        connectedSeconds: 412,
        disposition: 'APPLICATION_SUBMITTED',
        application: true,
      },
      {
        id: 'call-2',
        at: '2026-09-29T14:02:00.000Z',
        caller: '+16155550177',
        direction: 'INBOUND',
        connectedSeconds: 95,
        disposition: 'NOT_INTERESTED',
        application: false,
      },
    ],
    standing: {
      rank: 3,
      ranked: 12,
      points: 41,
      calls: 4,
      applications: 1,
      closingPct: 25,
      next: { rank: 2, pointsBehind: 9 },
    },
    ...overrides,
  };
}

let user: typeof AGENT | typeof OWNER | typeof PREVIEW | typeof STAFF_HOLDING_AGENT = AGENT;
let me: unknown = selfView();
let today: unknown = agentToday();

function installFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = urlOf(input);
      requested.push(`${url.pathname}${url.search}`);
      switch (url.pathname) {
        case '/api/auth/me':
          return json({ data: user });
        case '/api/v1/delivery/me':
          return json({ data: me });
        case '/api/v1/agent/today':
          return json({ data: today });
        case '/api/v1/white-label/today':
          return json({ error: { code: 'NOT_IN_FIXTURE', message: 'Owner Today' } }, 500);
        case '/api/v1/platform/context':
          return json({
            data:
              'isPlatformAdmin' in user && user.isPlatformAdmin
                ? {
                    isPlatformAdmin: true,
                    actingTenant: { id: 'tenant-a', name: 'Life Leads Plus' },
                    previewRole: 'previewRole' in user ? user.previewRole : null,
                    readOnly: 'isReadOnlyPreview' in user && user.isReadOnlyPreview,
                  }
                : { isPlatformAdmin: false, actingTenant: null, previewRole: null },
          });
        case '/api/v1/insurance-leads/pipeline':
          return json({
            prospects: 0,
            followUpsDue: 3,
            submittedApps: 11,
            annualPremium: 10449,
            averageAnnualPremium: 949.92,
          });
        case '/api/v1/applications':
          return json({
            data: {
              applications: [
                {
                  id: 'app-1',
                  submittedAt: '2026-09-26T22:03:00.000Z',
                  source: 'AGENT_ENTRY',
                  carrier: 'Corebridge',
                  product: null,
                  planType: 'LEVEL',
                  faceAmount: 20000,
                  modalPremium: 102.15,
                  paymentMode: 'MONTHLY',
                  annualizedPremium: 1225.8,
                  applicant: 'Carol S.',
                  state: 'FL',
                  carrierApplicationNumber: null,
                  agentId: 'agent-1',
                  agentName: 'Marcus Bell',
                  callId: null,
                  customerId: null,
                  voidedAt: null,
                  voidReason: null,
                },
              ],
              nextCursor: null,
            },
          });
        case '/api/v1/applications/summary':
          return json({
            data: {
              count: 1,
              totalAnnualizedPremium: 1225.8,
              averageAnnualizedPremium: 1225.8,
              byCarrier: [],
              byAgent: [],
            },
          });
        default:
          if (url.pathname.startsWith('/api/v1/platform/context')) {
            return json({ isPlatformAdmin: false, actingTenant: null });
          }
          return json({ data: [] });
      }
    })
  );
}

beforeEach(() => {
  requested.length = 0;
  localStorage.clear();
  localStorage.setItem('token', 'a-signed-in-person');
  user = AGENT;
  me = selfView();
  today = agentToday();
  pathname = '/';
  search = new URLSearchParams();
  redirects = [];
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  installFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Open `path` and mount `/dashboard` under the real auth and platform providers. */
async function mountDashboard(path = '/dashboard'): Promise<void> {
  const [bare, query = ''] = path.split('?');
  pathname = bare;
  search = new URLSearchParams(query);
  window.history.replaceState(null, '', path);
  const { AuthSessionProvider } = await import('@/hooks/use-auth');
  const { PlatformContextProvider } = await import('@/hooks/use-platform-context');
  const { default: DashboardPage } = await import('../(dashboard)/dashboard/page');
  render(
    <AuthSessionProvider>
      <PlatformContextProvider>
        <DashboardPage />
      </PlatformContextProvider>
    </AuthSessionProvider>
  );
}

const figure = (label: string) =>
  document.querySelector(`[data-figure-label="${label}"]`)?.getAttribute('data-figure-value');

describe("an agent's Today", () => {
  async function loadToday(path = '/dashboard'): Promise<void> {
    await mountDashboard(path);
    await waitFor(() => expect(figure('Calls answered')).toBe('4'));
  }

  it('is what /dashboard renders for an agent, from their own endpoint', async () => {
    await loadToday();

    expect(screen.getByTestId('agent-today')).toBeTruthy();
    expect(screen.queryByTestId('white-label-today')).toBeNull();
    expect(requested).toContain('/api/v1/agent/today?period=TODAY');
    // Never the owner's endpoint, and no agent id in the request.
    expect(requested.some(r => r.startsWith('/api/v1/white-label/today'))).toBe(false);
    expect(requested.some(r => /agentId|userId/.test(r))).toBe(false);
  });

  it('leads with calls answered, applications, closing % and follow-ups due', async () => {
    await loadToday();

    const heroes = Array.from(
      document.querySelectorAll('[aria-label="Your day at a glance"] [data-tile-size="hero"]')
    ).map(tile => tile.getAttribute('data-figure-label'));
    expect(heroes).toEqual(['Calls answered', 'Applications', 'Closing %', 'Follow-ups due']);

    expect(figure('Calls answered')).toBe('4');
    expect(figure('Applications')).toBe('1');
    expect(figure('Closing %')).toBe('25.0%');
    expect(figure('Follow-ups due')).toBe('7');

    for (const label of ['Talk time', 'Average call', 'Time available']) {
      expect(document.querySelector(`[data-figure-label="${label}"]`), label).toBeTruthy();
    }
    expect(figure('Talk time')).toBe('15m');
    expect(figure('Time available')).toBe('1h 30m');
  });

  it('compares closing with the agency, and counts with a like-for-like window, never as a %', async () => {
    await loadToday();

    const closing = document.querySelector('[data-figure-label="Closing %"]') as HTMLElement;
    expect(closing.textContent).toContain('+20.6 pts');
    expect(closing.textContent).toContain('vs agency 4.4%');

    const calls = document.querySelector('[data-figure-label="Calls answered"]') as HTMLElement;
    expect(calls.textContent).toContain('−2');
    expect(calls.textContent).toContain('vs same time yesterday');
    expect(calls.textContent).not.toMatch(/%/);
  });

  it('shows no owner money and no counterparty anywhere on the page', async () => {
    await loadToday();
    const text = document.body.textContent ?? '';
    for (const word of [
      'Revenue',
      'Profit',
      'Buyers',
      'Buyer',
      'Publishers',
      'Publisher',
      'Billable calls',
      'Billable',
      'Billing',
      'Payout',
      'Margin',
      'Went to',
    ]) {
      expect(text, word).not.toContain(word);
    }
    expect(text).not.toMatch(/\$\d/);
  });

  it('opens the CRM filtered to what the follow-ups tile counted', async () => {
    await loadToday();
    const link = document.querySelector('[data-follow-ups-link]');
    expect(link?.getAttribute('href')).toBe('/insurance-leads?tab=prospects&followUp=DUE');
  });

  it('lists what needs doing next, each row opening the customer', async () => {
    await loadToday();
    const panel = document.querySelector('[data-needs-attention]') as HTMLElement;
    const rows = Array.from(panel.querySelectorAll('[data-attention]'));
    expect(rows.map(r => r.getAttribute('data-attention'))).toEqual([
      'follow_up_overdue',
      'follow_up_due',
    ]);
    expect(
      within(rows[0] as HTMLElement)
        .getByText('Carol Simmons')
        .closest('a')
        ?.getAttribute('href')
    ).toBe('/insurance-leads/lead-1');
    expect(within(panel).getByText(/and 5 more in the CRM/)).toBeTruthy();
    expect(
      within(rows[0] as HTMLElement).getByRole('button', { name: 'Call Carol Simmons' })
    ).toBeTruthy();
  });

  it('says the agent is caught up rather than inventing work', async () => {
    today = agentToday({ attention: [] }, { followUpsDue: 0 });
    await loadToday();
    expect(document.querySelector('[data-all-clear]')?.textContent).toContain("You're caught up");
  });

  it('shows their latest calls with no money columns, and a way to all of them', async () => {
    await loadToday();
    const panel = document.querySelector('[data-recent-calls]') as HTMLElement;
    const headers = within(panel)
      .getAllByRole('columnheader')
      .map(h => h.textContent);
    expect(headers).toEqual(['Time', 'Caller', 'Duration', 'Disposition', 'Application']);
    expect(within(panel).getByText('View all calls').closest('a')?.getAttribute('href')).toBe(
      '/calls'
    );
    expect(panel.querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('gives no standing and no Leaderboard link on a white-label agency', async () => {
    await loadToday();
    expect(document.querySelector('[data-standing]')).toBeNull();
    expect(figure('Rank')).toBeUndefined();
    expect(document.querySelector('a[href^="/leaderboard"]')).toBeNull();
  });

  it('gives their standing in a small panel, not a second leaderboard', async () => {
    // A normal agency's agent: the white-label tier keeps the board to its owner.
    user = { ...AGENT, whiteLabel: false };
    await loadToday();
    const panel = document.querySelector('[data-standing]') as HTMLElement;
    expect(figure('Rank')).toBe('#3');
    expect(panel.textContent).toContain('of 12 on the floor');
    expect(panel.textContent).toContain('9 points behind #2');
    expect(panel.textContent).toContain('Points41');
    expect(panel.querySelector('table')).toBeNull();
    expect(within(panel).getByText('Leaderboard').closest('a')?.getAttribute('href')).toBe(
      '/leaderboard?period=TODAY'
    );
  });

  it('keeps its layout on a day with no calls: closing and time available are dashes', async () => {
    today = agentToday(
      {
        attention: [],
        recentCalls: [],
        standing: {
          rank: null,
          ranked: 12,
          points: 0,
          calls: 0,
          applications: 0,
          closingPct: null,
          next: null,
        },
      },
      {
        callsAnswered: 0,
        applications: 0,
        closingPct: null,
        talkTimeSeconds: 0,
        averageCallSeconds: null,
        availableSeconds: null,
        followUpsDue: 0,
      }
    );
    await mountDashboard();
    await waitFor(() => expect(figure('Calls answered')).toBe('0'));

    expect(
      document.querySelectorAll('[aria-label="Your day at a glance"] [data-tile-size="hero"]')
    ).toHaveLength(4);
    expect(figure('Closing %')).toBe('—');
    expect(figure('Average call')).toBe('—');
    // Never recorded is a dash, not "0m".
    expect(figure('Time available')).toBe('—');
    const glance = document.querySelector('[aria-label="Your day at a glance"]')?.textContent ?? '';
    expect(glance).not.toMatch(/0\.0+%/);
  });

  it('reads the period from the URL, so a shared link opens the same view', async () => {
    today = agentToday({
      period: {
        key: 'YESTERDAY',
        label: 'Yesterday',
        from: '2026-09-28',
        to: '2026-09-28',
        complete: true,
      },
    });
    await loadToday('/dashboard?period=YESTERDAY');
    expect(requested).toContain('/api/v1/agent/today?period=YESTERDAY');
    expect(screen.getByTestId('agent-today').getAttribute('data-period')).toBe('YESTERDAY');
    expect(screen.getByRole('button', { name: 'Yesterday' }).getAttribute('aria-pressed')).toBe(
      'true'
    );
  });
});

describe('/dashboard for each viewer', () => {
  it('still gives a white-label owner the owner Today', async () => {
    user = OWNER;
    await mountDashboard();
    await waitFor(() => expect(screen.getByTestId('white-label-today')).toBeTruthy());
    expect(screen.queryByTestId('agent-today')).toBeNull();
    expect(requested.some(r => r.startsWith('/api/v1/agent/today'))).toBe(false);
  });

  it('gives an operator previewing as AGENT exactly the agent Today', async () => {
    user = PREVIEW;
    await mountDashboard();
    await waitFor(() => expect(figure('Calls answered')).toBe('4'));
    expect(screen.getByTestId('agent-today')).toBeTruthy();
    expect(screen.queryByTestId('white-label-today')).toBeNull();
    expect(requested).toContain('/api/v1/agent/today?period=TODAY');
    // And nothing moved them off it.
    expect(redirects).toEqual([]);
  });

  it('keeps the platform dashboard for an operator who holds AGENT but is not previewing', async () => {
    // The nav gives them PLATFORM_NAV; the page must agree with it.
    user = STAFF_HOLDING_AGENT;
    await mountDashboard();
    await waitFor(() =>
      expect(requested.some(r => r.startsWith('/api/v1/platform/context'))).toBe(true)
    );
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(screen.queryByTestId('agent-today')).toBeNull();
    expect(requested.some(r => r.startsWith('/api/v1/agent/today'))).toBe(false);
  });

  it('does not redirect a real agent anywhere either', async () => {
    await mountDashboard();
    await waitFor(() => expect(figure('Calls answered')).toBe('4'));
    expect(redirects).toEqual([]);
  });
});

describe('My day', () => {
  it('is now the agent Today: /delivery/me redirects to /dashboard', async () => {
    const { default: MyDayMovedPage } = await import('../(dashboard)/delivery/me/page');
    render(<MyDayMovedPage />);
    await waitFor(() => expect(redirects).toEqual(['/dashboard']));
  });
});

describe('the console figures', () => {
  it("shows the server's numbers", async () => {
    const { StatsStrip } = await import('@/components/call-center/StatsStrip');
    render(
      <StatsStrip figures={{ callsTaken: 4, applications: 1, closingPct: 25, followUpsDue: 3 }} />
    );

    const value = (label: string) =>
      document.querySelector(`[data-figure-label="${label}"]`)?.getAttribute('data-figure-value');
    expect(value('Calls answered')).toBe('4');
    expect(value('Applications')).toBe('1');
    expect(value('Closing')).toBe('25.00%');
    expect(value('Follow-ups due')).toBe('3');
  });

  it('shows a dash until it knows, and for a CRM it could not read, never a zero', async () => {
    const { StatsStrip } = await import('@/components/call-center/StatsStrip');
    const { rerender } = render(<StatsStrip figures={null} />);
    for (const label of ['Calls answered', 'Applications', 'Closing', 'Follow-ups due']) {
      expect(
        document.querySelector(`[data-figure-label="${label}"]`)?.getAttribute('data-figure-value'),
        label
      ).toBe('—');
    }

    rerender(
      <StatsStrip
        figures={{ callsTaken: 0, applications: 0, closingPct: null, followUpsDue: null }}
      />
    );
    const value = (label: string) =>
      document.querySelector(`[data-figure-label="${label}"]`)?.getAttribute('data-figure-value');
    expect(value('Calls answered')).toBe('0');
    expect(value('Closing')).toBe('—');
    expect(value('Follow-ups due')).toBe('—');
  });

  it('is read from /delivery/me and the CRM, not counted in the browser', async () => {
    const { useConsoleFigures } = await import('@/components/call-center/use-console-figures');
    const { StatsStrip } = await import('@/components/call-center/StatsStrip');
    function Probe(): JSX.Element {
      const { figures } = useConsoleFigures();
      return <StatsStrip figures={figures} />;
    }
    render(<Probe />);
    await waitFor(() =>
      expect(
        document
          .querySelector('[data-figure-label="Follow-ups due"]')
          ?.getAttribute('data-figure-value')
      ).toBe('3')
    );
    expect(requested).toContain('/api/v1/delivery/me');
    expect(requested).toContain('/api/v1/insurance-leads/pipeline');
    // The old tallies lived here and never reset.
    expect(localStorage.getItem('cc_total_calls_count')).toBeNull();
  });
});

describe('Settings for an agent', () => {
  async function loadSettings(): Promise<void> {
    const { AuthSessionProvider } = await import('@/hooks/use-auth');
    const { SettingsView } = await import('@/components/settings/settings-view');
    render(
      <AuthSessionProvider>
        <SettingsView />
      </AuthSessionProvider>
    );
  }

  it('has no webhooks, opens on DNC lists, and never asks for the webhooks', async () => {
    user = AGENT;
    await loadSettings();
    await waitFor(() => expect(screen.getByRole('tab', { name: 'DNC lists' })).toBeTruthy());

    expect(screen.queryByRole('tab', { name: 'Webhooks' })).toBeNull();
    expect(screen.queryByText('Add Webhook')).toBeNull();
    expect(screen.getByRole('tab', { name: 'DNC lists' }).getAttribute('aria-selected')).toBe(
      'true'
    );
    expect(requested.some(r => r.startsWith('/api/v1/webhooks'))).toBe(false);
  });

  it('still gives an owner their webhooks', async () => {
    user = OWNER;
    await loadSettings();
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Webhooks' })).toBeTruthy());
    await waitFor(() => expect(requested.some(r => r.startsWith('/api/v1/webhooks'))).toBe(true));
  });
});

describe('Applications for an agent', () => {
  async function loadApplications(): Promise<void> {
    const { AuthSessionProvider } = await import('@/hooks/use-auth');
    const { default: ApplicationsPage } = await import('../(dashboard)/applications/page');
    render(
      <AuthSessionProvider>
        <ApplicationsPage />
      </AuthSessionProvider>
    );
    await waitFor(() => expect(screen.getByText('Carol S.')).toBeTruthy());
  }

  it('is their own, with no column repeating their name', async () => {
    user = AGENT;
    await loadApplications();
    await waitFor(() =>
      expect(
        screen.getByText('Every application you submitted, by carrier and premium.')
      ).toBeTruthy()
    );
    expect(screen.queryByRole('columnheader', { name: 'Agent' })).toBeNull();
    expect(screen.queryByText('Marcus Bell')).toBeNull();
  });

  it('keeps the Agent column for an owner', async () => {
    user = OWNER;
    await loadApplications();
    await waitFor(() => expect(screen.getByRole('columnheader', { name: 'Agent' })).toBeTruthy());
    expect(screen.getByText('Marcus Bell')).toBeTruthy();
  });
});

describe('the live strip', () => {
  it('quiets a plain zero and leaves a warning coloured', async () => {
    const { LiveStrip } = await import('@/components/domain/live-strip');
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
      }))
    );
    render(
      <LiveStrip
        metrics={[
          { id: 'calls', label: 'Your calls', value: '4' },
          { id: 'applications', label: 'Your applications', value: '0' },
          { id: 'conversion', label: 'Your conversion %', value: '0.00%', tone: 'dropped' },
        ]}
      />
    );

    const valueOf = (id: string) =>
      document.querySelector(`[data-figure="${id}"] .tabular-nums`) as HTMLElement;
    expect(valueOf('calls').className).toContain('text-ink');
    expect(valueOf('calls').className).not.toContain('text-ink-3');
    expect(valueOf('applications').className).toContain('text-ink-3');
    // Below the agency's is something to act on: still coloured.
    expect(valueOf('conversion').className).toContain('text-dropped-ink');
  });
});
