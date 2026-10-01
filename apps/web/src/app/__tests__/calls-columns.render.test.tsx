/**
 * The call ledger, RENDERED per role: which columns each viewer opens on, and
 * that a row offers recording controls only when it has a recording.
 *
 * `calls-columns.test.ts` pins the lists; this pins that the page actually
 * reads them once the session says who is looking -- the defaults depend on
 * the role, and the role is not known on the first render.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let roles: string[] = ['OWNER', 'ADMIN'];
let rows: unknown[] = [];
let meta: Record<string, unknown> = { totalPages: 1 };

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

function installFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const path = pathOf(input);
      if (path === '/api/auth/me') {
        return json({
          data: {
            id: 'user-1',
            email: 'someone@agency.test',
            firstName: 'Some',
            lastName: 'One',
            roles,
            tenantId: 'tenant-a',
          },
        });
      }
      if (path === '/api/v1/calls') {
        return json({ data: rows, meta });
      }
      if (path.startsWith('/api/v1/platform/context')) {
        return json({ isPlatformAdmin: false, actingTenant: null });
      }
      return json({ data: [] });
    })
  );
}

vi.mock('next/navigation', () => ({
  usePathname: () => '/calls',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const baseCall = {
  createdAt: new Date('2026-09-27T15:00:00Z').toISOString(),
  callerId: '+18135551234',
  duration: 132,
  billable: true,
};

async function loadCallsPage(): Promise<void> {
  const { AuthSessionProvider } = await import('@/hooks/use-auth');
  const { default: CallsPage } = await import('../(dashboard)/calls/page');

  render(
    <AuthSessionProvider>
      <CallsPage />
    </AuthSessionProvider>
  );

  await waitFor(() => {
    expect(screen.queryByText(/Loading calls/i)).toBeNull();
    expect(screen.getAllByRole('row').length).toBeGreaterThan(1);
  });
}

/** The table's column headers, in order. */
function headers(): string[] {
  const table = screen.getAllByRole('table')[0];
  return within(table)
    .getAllByRole('columnheader')
    .map(th => th.textContent?.trim() ?? '');
}

describe('the call ledger per role', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    localStorage.setItem('token', 'a-signed-in-user');
    rows = [{ ...baseCall, id: 'call-1' }];
    meta = { totalPages: 1 };
    installFetch();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens an owner on where each call went, the recording and the money', async () => {
    roles = ['OWNER', 'ADMIN'];
    await loadCallsPage();

    await waitFor(() => {
      expect(headers()).toEqual([
        'Time',
        'Caller',
        'Campaign',
        'Went to',
        'Duration',
        'Disposition',
        'Recording',
        'Revenue',
        'Payout',
        'Profit',
      ]);
    });
  });

  it('badges every row by where it went: agent, buyer, unanswered or blocked', async () => {
    roles = ['OWNER', 'ADMIN'];
    rows = [
      {
        ...baseCall,
        id: 'to-agent',
        answeredByUserId: 'u-1',
        agentName: 'Marcus Bell',
        buyerId: 'b-1',
        buyerName: 'Acme',
      },
      { ...baseCall, id: 'to-buyer', buyerId: 'b-1', buyerName: 'Heritage Final Expense' },
      { ...baseCall, id: 'unanswered' },
      { ...baseCall, id: 'blocked', blocked: true },
    ];
    await loadCallsPage();

    const badges = await waitFor(() => {
      const found = [...document.querySelectorAll('tbody [data-entity]')] as HTMLElement[];
      expect(found).toHaveLength(4);
      return found;
    });
    expect(badges.map(badge => badge.getAttribute('data-entity'))).toEqual([
      'agent',
      'buyer',
      'unanswered',
      'blocked',
    ]);
    expect(badges[0].textContent).toContain('Marcus Bell');
    expect(badges[0].textContent).toContain('Agent:');
    expect(badges[1].textContent).toContain('Heritage Final Expense');
    expect(badges[1].textContent).toContain('Buyer:');
    expect(badges[2].textContent).toContain('Unanswered');
    expect(badges[3].textContent).toContain('Blocked');
  });

  it('puts a return beside the disposition, and every disposition in a chip', async () => {
    roles = ['OWNER', 'ADMIN'];
    rows = [
      { ...baseCall, id: 'returned', disposition: 'FOLLOW_UP', disputeStatus: 'DISPUTED' },
      { ...baseCall, id: 'unset', disposition: null },
    ];
    await loadCallsPage();

    const cells = await waitFor(() => {
      const found = [...document.querySelectorAll('[data-disposition]')] as HTMLElement[];
      expect(found).toHaveLength(2);
      return found;
    });
    expect(cells[0].querySelector('[data-value="FOLLOW_UP"]')?.textContent).toContain('Follow up');
    expect(cells[0].querySelector('[data-return="DISPUTED"]')?.textContent).toBe('Return: waiting');
    expect(cells[1].textContent).toBe('Not set');
  });

  it('totals the filtered set above the table and counts rows below it', async () => {
    roles = ['OWNER', 'ADMIN'];
    meta = {
      page: 1,
      limit: 50,
      total: 4112,
      totalPages: 83,
      totals: { calls: 4112, billable: 1234, revenue: 200940.5, payout: 80000, profit: 0 },
    };
    await loadCallsPage();

    await waitFor(() => expect(document.querySelector('[data-call-totals]')).toBeTruthy());
    const total = (label: string) => document.querySelector(`[data-total="${label}"]`)?.textContent;
    expect(total('Calls')).toBe('4,112');
    expect(total('Billable')).toBe('1,234');
    expect(total('Revenue')).toBe('$200,941');
    expect(total('Payout')).toBe('$80,000');
    expect(total('Profit')).toBe('$0');
    expect(document.querySelector('[data-total="Profit"]')?.className).toContain('text-ink-3');
    expect(document.querySelector('[data-page-range]')?.textContent).toBe('1–50 of 4,112');
  });

  it('opens an agent on their calls, applications and recordings, with no Status column', async () => {
    roles = ['AGENT'];
    await loadCallsPage();

    await waitFor(() => {
      expect(headers()).toEqual([
        'Time',
        'Caller',
        'Campaign',
        'Duration',
        'Disposition',
        'Application',
        'Recording',
      ]);
    });
  });

  it('shows an agent the Recording column even if their browser saved it switched off', async () => {
    roles = ['AGENT'];
    localStorage.setItem(
      'hopwhistle_calls_columns:v3:agent',
      JSON.stringify({ recording: false, campaignName: false })
    );
    rows = [{ ...baseCall, id: 'call-rec', primaryRecordingId: 'rec-1' }];
    await loadCallsPage();

    await waitFor(() => expect(headers()).toContain('Recording'));
    // Their other choice is kept.
    expect(headers()).not.toContain('Campaign');
    await waitFor(() => expect(document.querySelector('[data-recording="ready"]')).toBeTruthy());
  });

  it('offers a play button on a row with a recording, and a disabled one without', async () => {
    roles = ['OWNER', 'ADMIN'];
    rows = [
      // A recording URL but no recording id: nothing to play.
      { ...baseCall, id: 'call-no-rec', recordingUrl: '/r.wav', primaryRecordingId: null },
      { ...baseCall, id: 'call-rec', primaryRecordingId: 'rec-1' },
    ];

    await loadCallsPage();

    await waitFor(() => {
      expect(headers()).toContain('Recording');
    });
    expect(screen.getAllByRole('button', { name: 'Play or pause recording' })).toHaveLength(1);
    const none = screen.getByRole('button', { name: 'No recording' });
    expect(none.hasAttribute('disabled')).toBe(true);
  });
});
