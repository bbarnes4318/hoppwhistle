/**
 * The Applications page, RENDERED: a row opens its customer.
 *
 * A row used to open the call it was written on, and did nothing at all when
 * there was no call. It now opens the customer record: straight there when the
 * application is already linked, and through
 * `POST /api/v1/applications/:id/customer` (which links or creates the
 * customer) when it is not. The call stays one click away on the date.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/applications',
  useRouter: () => ({ replace: vi.fn(), push, prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function pathOf(input: RequestInfo | URL): string {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return new URL(raw, 'http://localhost').pathname;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const row = (overrides: Record<string, unknown>) => ({
  id: 'app-1',
  submittedAt: new Date('2026-09-20T15:00:00Z').toISOString(),
  source: 'AGENT_ENTRY',
  carrier: 'Aflac',
  product: null,
  planType: 'LEVEL',
  faceAmount: 10000,
  modalPremium: 50,
  paymentMode: 'MONTHLY',
  annualizedPremium: 600,
  applicant: 'Rosa D.',
  state: 'TN',
  carrierApplicationNumber: null,
  agentId: 'agent-1',
  agentName: 'Marisol Vance',
  callId: 'call-9',
  customerId: null,
  voidedAt: null,
  voidReason: null,
  ...overrides,
});

let rows: unknown[] = [];
let customerAnswer: { status: number; body: unknown } = { status: 200, body: {} };
const posts: string[] = [];

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

describe('an application row', () => {
  beforeEach(() => {
    push.mockReset();
    posts.length = 0;
    localStorage.setItem('token', 'owner');
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const path = pathOf(input);
        if (path === '/api/v1/applications') {
          return json({ data: { applications: rows, nextCursor: null } });
        }
        if (path === '/api/v1/applications/summary') {
          return json({
            data: {
              count: 1,
              totalAnnualizedPremium: 600,
              averageAnnualizedPremium: 600,
              byCarrier: [],
              byAgent: [],
            },
          });
        }
        if (path.endsWith('/customer') && init?.method === 'POST') {
          posts.push(path);
          return json(customerAnswer.body, customerAnswer.status);
        }
        return json({ data: [] });
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  async function loadPage(): Promise<void> {
    const { default: ApplicationsPage } = await import('../(dashboard)/applications/page');
    render(<ApplicationsPage />);
    await waitFor(() => expect(screen.getByText('Rosa D.')).toBeTruthy());
  }

  it('goes straight to a linked customer', async () => {
    rows = [row({ customerId: 'lead-7' })];
    await loadPage();
    fireEvent.click(screen.getByText('Rosa D.'));
    expect(push).toHaveBeenCalledWith('/insurance-leads/lead-7');
    expect(posts).toEqual([]);
  });

  it('links an unlinked application, then opens the customer', async () => {
    rows = [row({ callId: null })];
    customerAnswer = { status: 200, body: { data: { customerId: 'lead-new' } } };
    await loadPage();
    fireEvent.click(screen.getByText('Rosa D.'));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/insurance-leads/lead-new'));
    expect(posts).toEqual(['/api/v1/applications/app-1/customer']);
  });

  it('keeps the call one click away on the date', async () => {
    rows = [row({ customerId: 'lead-7' })];
    await loadPage();
    const link = screen.getByTitle('Open the call');
    expect(link.getAttribute('href')).toBe('/calls?call=call-9');
  });
});
