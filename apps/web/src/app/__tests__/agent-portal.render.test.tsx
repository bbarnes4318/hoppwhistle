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

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/components/phone', () => ({ usePhone: () => ({ makeCall: vi.fn() }) }));

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const AGENT = { id: 'agent-1', email: 'agent@agency.test', roles: ['AGENT'], tenantId: 'tenant-a' };
const OWNER = {
  id: 'owner-1',
  email: 'owner@agency.test',
  roles: ['OWNER', 'ADMIN'],
  tenantId: 'tenant-a',
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

let user: typeof AGENT | typeof OWNER = AGENT;
let me: unknown = selfView();

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
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  installFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('My day', () => {
  async function loadMyDay(): Promise<void> {
    const { default: MyDeliveryPage } = await import('../(dashboard)/delivery/me/page');
    render(<MyDeliveryPage />);
    await waitFor(() => expect(screen.getByTestId('my-day')).toBeTruthy());
  }

  it('leads with four hero figures and keeps the labels the live strip is checked against', async () => {
    await loadMyDay();

    for (const label of ['Applications', 'My closing percentage', 'Calls taken', 'Talk time']) {
      const tile = document.querySelector(`[data-figure-label="${label}"]`);
      expect(tile, label).toBeTruthy();
    }
    expect(document.querySelectorAll('.t-kpi-hero')).toHaveLength(4);
    expect(
      document.querySelector('[data-figure-label="Calls taken"]')?.getAttribute('data-figure-value')
    ).toBe('4');
    expect(
      document
        .querySelector('[data-figure-label="Applications"]')
        ?.getAttribute('data-figure-value')
    ).toBe('1');

    // Secondary tiles, smaller.
    for (const label of ['On the queue', 'Average call', 'Agency closing']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('compares the closing percentage with the agency, and nothing else with yesterday', async () => {
    await loadMyDay();

    // 25% against the agency's 4.44%.
    expect(
      document
        .querySelector('[data-figure-label="My closing percentage"]')
        ?.getAttribute('data-figure-value')
    ).toBe('25.00%');
    expect(screen.getByText(/\+20\.6 pts/)).toBeTruthy();
    expect(screen.getByText('vs agency 4.44%')).toBeTruthy();

    // Yesterday is a fact beside the figure, never a percentage against a half day.
    expect(screen.getByText('Yesterday 3')).toBeTruthy(); // applications
    expect(screen.getByText('Yesterday 12')).toBeTruthy(); // calls
    expect(document.body.textContent).not.toMatch(/vs (same time )?yesterday/i);
  });

  it('shows the last seven days, newest first, zeros quiet', async () => {
    await loadMyDay();

    const panel = screen.getByTestId('my-last-seven-days');
    const rows = Array.from(panel.querySelectorAll('tbody tr'));
    expect(rows.map(r => r.getAttribute('data-day'))).toEqual([
      '2026-09-29',
      '2026-09-28',
      '2026-09-27',
      '2026-09-26',
      '2026-09-25',
      '2026-09-24',
      '2026-09-23',
    ]);
    expect(within(rows[0] as HTMLElement).getByText('today so far')).toBeTruthy();

    // 2026-09-27 had no calls: every cell in that row is quiet, closing is a dash.
    const quiet = Array.from((rows[2] as HTMLElement).querySelectorAll('td')).slice(1);
    expect(quiet.map(td => td.textContent)).toEqual(['0', '0', '—', '0m']);
    for (const td of quiet) expect(td.className).toContain('text-ink-3');
  });

  it('keeps its layout on a day with no calls, and never shows 0.00%', async () => {
    const trend = week({ callsTaken: 0, applications: 0, talk: 0 });
    me = selfView({
      callsTaken: 0,
      applications: 0,
      closingPct: null,
      talkTimeSeconds: 0,
      availableSeconds: null,
      trend,
    });
    await loadMyDay();

    expect(document.querySelectorAll('.t-kpi-hero')).toHaveLength(4);
    expect(screen.getByTestId('my-last-seven-days')).toBeTruthy();
    const closing = document.querySelector('[data-figure-label="My closing percentage"]');
    expect(closing?.getAttribute('data-figure-value')).toBe('—');
    // A real 0.00% is a day of calls and no applications, in the table below.
    // The tiles for a day with no calls at all never say it.
    expect(document.querySelector('[aria-label="Today at a glance"]')?.textContent).not.toContain(
      '0.00%'
    );
    // Never recorded is a dash, not "0m".
    expect(
      document
        .querySelector('[data-figure-label="On the queue"]')
        ?.getAttribute('data-figure-value')
    ).toBe('—');
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
