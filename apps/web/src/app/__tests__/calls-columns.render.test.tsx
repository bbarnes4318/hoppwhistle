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
        return json({ data: rows, meta: { totalPages: 1 } });
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
    installFetch();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('opens an owner on the money and the returns', async () => {
    roles = ['OWNER', 'ADMIN'];
    await loadCallsPage();

    await waitFor(() => {
      expect(headers()).toEqual([
        'Time',
        'Caller',
        'Campaign',
        'Answered by',
        'Duration',
        'Disposition',
        'Revenue',
        'Payout',
        'Return',
      ]);
    });
  });

  it('opens an agent on their calls and applications, with no Status column', async () => {
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
      ]);
    });
  });

  it('offers recording controls only on a row with a recording of its own', async () => {
    roles = ['OWNER', 'ADMIN'];
    // The owner has turned the Recording column on.
    localStorage.setItem('hopwhistle_calls_columns:v2:owner', JSON.stringify({ recording: true }));
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
    expect(screen.getAllByRole('button', { name: 'Download recording' })).toHaveLength(1);
  });
});
