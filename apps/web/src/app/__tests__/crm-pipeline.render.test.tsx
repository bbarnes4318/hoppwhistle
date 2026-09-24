/**
 * The agency CRM, RENDERED: one book, split into prospects and the prospects
 * that became submitted applications, with their annual premium.
 *
 * Pins what agencies asked for: no ACA / FE Customers / B2B tabs, no
 * lead-ingestion counters (valid, invalid, matched, test, live) across the
 * top, and the two lists an agency actually works.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

      switch (url.pathname) {
        case '/api/auth/me':
          return json({
            data: {
              id: 'owner-1',
              email: 'owner@agency.test',
              roles: ['OWNER', 'ADMIN'],
              tenantId: 'tenant-a',
            },
          });
        case '/api/v1/insurance-leads/pipeline':
          return json({
            prospects: 42,
            followUpsDue: 5,
            submittedApps: 3,
            annualPremium: 2520,
            averageAnnualPremium: 840,
          });
        case '/api/v1/insurance-leads':
          return json({
            data: [
              {
                id: 'lead-1',
                vertical: 'FE',
                firstName: 'Pat',
                lastName: 'Prospect',
                fullName: 'Pat Prospect',
                phone: '5551234567',
                email: null,
                state: 'TX',
                zipCode: '75001',
                source: null,
                status: 'NEW',
                leadStage: null,
                nextFollowUpAt: null,
                lastContactedAt: null,
                createdAt: '2026-09-01T15:00:00.000Z',
                latestSubmission: null,
              },
            ],
            meta: { page: 1, limit: 25, total: 1, totalPages: 1 },
          });
        case '/api/v1/insurance-leads/submitted-apps':
          return json({
            data: [
              {
                id: 'app-1',
                submittedAt: '2026-09-10T15:00:00.000Z',
                applicant: 'Sam Submitted',
                phone: '5559876543',
                state: 'FL',
                carrier: 'American Amicable',
                product: 'Senior Choice',
                faceAmount: 10000,
                annualPremium: 840,
                agentName: 'Alex Agent',
                leadId: 'lead-2',
              },
            ],
            meta: { page: 1, limit: 25, total: 1, totalPages: 1 },
          });
        case '/api/v1/lead-lists':
          return json([]);
        default:
          if (url.pathname.startsWith('/api/v1/platform/context')) {
            return json({ isPlatformAdmin: false, actingTenant: null });
          }
          return json({ data: [] });
      }
    })
  );
}

vi.mock('next/navigation', () => ({
  usePathname: () => '/insurance-leads',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/components/phone', () => ({ usePhone: () => ({ makeCall: vi.fn() }) }));

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

describe('the agency CRM', () => {
  beforeEach(() => {
    requested.length = 0;
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

  async function loadCrm(): Promise<void> {
    const { AuthSessionProvider } = await import('@/hooks/use-auth');
    const { default: CrmPage } = await import('../(dashboard)/insurance-leads/page');
    render(
      <AuthSessionProvider>
        <CrmPage />
      </AuthSessionProvider>
    );
    await waitFor(() => expect(screen.getByText('Pat Prospect')).toBeTruthy());
  }

  it('shows the pipeline, not lead verticals or ingestion counters', async () => {
    await loadCrm();

    expect(screen.getAllByText('Prospects').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Submitted Apps').length).toBeGreaterThan(0);
    expect(screen.getByText('Annual Premium')).toBeTruthy();
    expect(screen.getByText('$2,520.00')).toBeTruthy();

    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/FE Customers|\bACA\b|\bB2B\b/);
    expect(text).not.toMatch(/Unmatched|test mode|live mode|validation failures/i);
  });

  it('lists only prospects that have not submitted', async () => {
    await loadCrm();

    expect(
      requested.some(
        r => r.startsWith('/api/v1/insurance-leads?') && r.includes('pipeline=prospects')
      )
    ).toBe(true);
  });

  it('lists submitted apps with their annual premium', async () => {
    await loadCrm();

    // The tile and the tab both lead there.
    fireEvent.click(screen.getAllByRole('button', { name: /Submitted Apps/ })[0]);

    await waitFor(() => expect(screen.getByText('Sam Submitted')).toBeTruthy());
    expect(screen.getAllByText('$840.00').length).toBeGreaterThan(0);
    expect(screen.getByText('American Amicable')).toBeTruthy();
  });
});
