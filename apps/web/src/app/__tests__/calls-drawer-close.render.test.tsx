/**
 * The call drawer, RENDERED: one Close button, not two.
 *
 * The drawer is a DialogContent laid out as a right-hand sheet, and its header
 * carries its own Close. DialogContent used to add a second, absolutely
 * positioned X in the corner on top of it, so the drawer showed two. The
 * drawer now passes `hideClose`, and this pins it: exactly one element named
 * "Close".
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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

vi.mock('next/navigation', () => ({
  usePathname: () => '/calls',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams('call=call-1'),
}));

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

describe('the call detail drawer', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('token', 'a-signed-in-agency-owner');
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    window.history.replaceState(null, '', '/calls?call=call-1');
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
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
        if (path === '/api/v1/calls') return json({ data: [], meta: { totalPages: 1 } });
        if (path === '/api/v1/calls/call-1') {
          return json({
            data: {
              id: 'call-1',
              callSid: 'fs-abc',
              createdAt: new Date('2026-07-04T15:00:00Z').toISOString(),
              callerId: '+18135551234',
              toNumber: '+18005559876',
              duration: 132,
              status: 'COMPLETED',
            },
          });
        }
        if (path.startsWith('/api/v1/platform/context')) {
          return json({ isPlatformAdmin: false, actingTenant: null });
        }
        return json({ data: [] });
      })
    );
  });

  afterEach(() => {
    cleanup();
    window.history.replaceState(null, '', '/');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('has exactly one Close button', async () => {
    const { AuthSessionProvider } = await import('@/hooks/use-auth');
    const { default: CallsPage } = await import('../(dashboard)/calls/page');

    render(
      <AuthSessionProvider>
        <CallsPage />
      </AuthSessionProvider>
    );

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.queryByText(/Loading call\.\.\./i)).toBeNull();
    });

    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1);
  });
});
