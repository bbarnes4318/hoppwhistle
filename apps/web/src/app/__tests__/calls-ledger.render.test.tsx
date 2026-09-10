/**
 * The call ledger, RENDERED, when the request for it does not succeed.
 *
 * ── The defect this pins ─────────────────────────────────────────────────────
 *
 * `apiClient.get()` does not throw. It returns `{ data }` or `{ error }`. The
 * calls page was written as though it threw:
 *
 *     try { const r = await apiClient.get('/api/v1/calls?…');
 *           if (r.data) { setCalls(r.data.data || []) } }
 *     catch { toast.error('Failed to fetch call logs') }
 *
 * so the catch never ran, `setCalls` never ran, and `calls` stayed at its
 * initial `[]`. The table then rendered its empty state: "No call events
 * found". Every failure mode of that endpoint — 409 NO_ACTING_TENANT from the
 * cross-agency view, a 500, a 504 while the route reconciled stale recordings,
 * a dropped connection — reached the operator as a calm, confident, false
 * statement that their agency has no calls. There was no toast, no error, and
 * nothing on the page to tell the two apart.
 *
 * An agency reading "No call events found" concludes its call history has been
 * deleted. That is the cost of this, and it is why the assertions below are
 * written as "must NOT say there are no calls" rather than as "should show an
 * error": the page is allowed to present the failure however it likes, and is
 * not allowed to present it as an empty ledger.
 *
 * The one case where that sentence is true — the server answered, with zero
 * rows — is asserted too, so the fix cannot be "never show the empty state".
 */
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** What `/api/v1/calls` answers for the case under test. */
let callsAnswer: { status: number; body: unknown } = {
  status: 200,
  body: { data: [], meta: { totalPages: 1 } },
};

function pathOf(input: RequestInfo | URL): string {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  try {
    return new URL(raw, 'http://localhost').pathname;
  } catch {
    return raw;
  }
}

const json = (body: unknown, status: number): Response =>
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
        return json(
          {
            data: {
              id: 'owner-1',
              email: 'owner@agency.test',
              firstName: 'Agency',
              lastName: 'Owner',
              roles: ['OWNER', 'ADMIN'],
              tenantId: 'tenant-a',
            },
          },
          200
        );
      }

      if (path === '/api/v1/calls') {
        return json(callsAnswer.body, callsAnswer.status);
      }

      if (path.startsWith('/api/v1/platform/context')) {
        return json({ isPlatformAdmin: false, actingTenant: null }, 200);
      }

      // The filter dropdowns. Empty is fine; this file is about the table.
      return json({ data: [] }, 200);
    })
  );
}

vi.mock('next/navigation', () => ({
  usePathname: () => '/calls',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

/** Radix measures its triggers, and jsdom has no ResizeObserver. */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

describe('the call ledger when /api/v1/calls does not return rows', () => {
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

  /** Mount the real page under the real auth provider. */
  async function loadCallsPage(): Promise<void> {
    const { AuthSessionProvider } = await import('@/hooks/use-auth');
    const { default: CallsPage } = await import('../(dashboard)/calls/page');

    render(
      <AuthSessionProvider>
        <CallsPage />
      </AuthSessionProvider>
    );

    // Loading state clears once the request has been answered either way.
    await waitFor(() => {
      expect(screen.queryByText(/Loading pay-per-call ledger/i)).toBeNull();
    });
  }

  /**
   * The sentence an operator must never be shown about a request that failed.
   * Read as "your agency has no calls", which is a claim this page cannot make
   * unless the server made it.
   */
  const emptyLedgerClaim = /No call events found/i;

  it('does not claim the ledger is empty when the server returned 500', async () => {
    callsAnswer = {
      status: 500,
      body: { error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } },
    };

    await loadCallsPage();

    expect(
      screen.queryByText(emptyLedgerClaim),
      'a failed request rendered as "No call events found". An agency reads that as ' +
        'its call history having been deleted.'
    ).toBeNull();
    expect(screen.getByText(/Could not load the call ledger/i)).toBeTruthy();
  });

  it('does not claim the ledger is empty when the request never completed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        if (pathOf(input) === '/api/v1/calls') throw new TypeError('Failed to fetch');
        if (pathOf(input) === '/api/auth/me') {
          return json(
            {
              data: {
                id: 'owner-1',
                email: 'owner@agency.test',
                roles: ['OWNER', 'ADMIN'],
                tenantId: 'tenant-a',
              },
            },
            200
          );
        }
        return json({ data: [] }, 200);
      })
    );

    await loadCallsPage();

    expect(screen.queryByText(emptyLedgerClaim)).toBeNull();
    expect(screen.getByText(/Could not load the call ledger/i)).toBeTruthy();
  });

  it('says to choose an agency when the operator has entered none', async () => {
    callsAnswer = {
      status: 409,
      body: {
        error: {
          code: 'NO_ACTING_TENANT',
          message: 'Select an agency to view this. You are in the cross-agency view.',
        },
      },
    };

    await loadCallsPage();

    expect(
      screen.queryByText(emptyLedgerClaim),
      'a platform operator with no agency entered was told their calls do not exist, ' +
        'rather than that they are looking at the cross-agency view.'
    ).toBeNull();
    expect(screen.getByText(/Choose an agency to see its calls/i)).toBeTruthy();
  });

  it('still shows the empty state when the server really did answer with no rows', async () => {
    callsAnswer = { status: 200, body: { data: [], meta: { totalPages: 1 } } };

    await loadCallsPage();

    expect(
      screen.getByText(emptyLedgerClaim),
      'the empty state has to survive the fix: a successful query with zero rows is ' +
        'the one case where "No call events found" is true.'
    ).toBeTruthy();
  });

  it('renders the rows when the server returns them', async () => {
    callsAnswer = {
      status: 200,
      body: {
        data: [
          {
            id: 'call-1',
            callSid: 'fs-abc',
            createdAt: new Date('2026-07-04T15:00:00Z').toISOString(),
            callerId: '+18135551234',
            toNumber: '+18005559876',
            duration: 132,
            billable: true,
          },
        ],
        meta: { totalPages: 1 },
      },
    };

    await loadCallsPage();

    expect(screen.queryByText(emptyLedgerClaim)).toBeNull();
    expect(screen.queryByText(/Could not load the call ledger/i)).toBeNull();
  });
});
