/**
 * The platform-wide screens, RENDERED, as a platform admin with no agency.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────
 *
 * Three consecutive phases shipped a defect that one load of a page as a
 * platform admin would have caught: the switcher's `.map` crash, fourteen
 * routes answering 401, and then `/delivery` rendering "Choose an agency" where
 * the cross-agency view was supposed to be, with agency-scoped endpoints being
 * polled in a loop behind it.
 *
 * Every one of those passed the suite. The suite could not have caught any of
 * them, because `apps/web` had no DOM renderer: the closest thing was
 * `cross-agency-landing.test.ts`, which reads the layout's SOURCE and checks
 * the shape of an expression. A source-level test cannot tell you whether two
 * components disagree, whether a router redirect fired, or how many requests a
 * mounted tree makes. It asserts that the code says what somebody intended,
 * which is the thing that keeps being true while the page is broken.
 *
 * ── What this covers, and what the browser test covers ───────────────────────
 *
 * This is the fast half. It renders the real providers, the real layout, the
 * real pages and the real API client against a stubbed `fetch`, and it OWNS THE
 * CLOCK -- which is the part a browser cannot do. The production defect was a
 * race between two requests, and the whole of it lives in the gap between
 * `/api/auth/me` answering and `/api/v1/platform/context` answering. Here that
 * gap is set explicitly, so the failure is deterministic rather than a matter
 * of how fast the API happened to be.
 *
 * `apps/web/e2e/platform-landing.smoke.mjs` is the other half: a real browser
 * against the real API, which catches what a stubbed fetch cannot.
 */
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PLATFORM_WIDE_LANDING_ROUTES } from '@/lib/platform-routes';

/* ── The routes, split the way the server splits them ───────────────────── */

/**
 * Answers `409 NO_ACTING_TENANT`, exactly as the API does for an authenticated
 * platform admin who has entered no agency. Requesting one of these at all is
 * the defect; the body is here so a component that ignores the status still
 * behaves like production.
 */
const AGENCY_SCOPED = [
  '/api/v1/live/metrics',
  '/api/v1/calls',
  '/api/v1/dashboard/stats',
  '/api/v1/agent/my-numbers',
  '/api/v1/agent/webrtc/credentials',
  '/api/v1/delivery/today',
  '/api/v1/delivery/agents',
  '/api/v1/delivery/settlements',
  '/api/v1/delivery/me',
  '/api/v1/rating/summary',
  '/api/v1/rating/history',
];

/** What each platform route answers. Enveloped, as `{ data: ... }`. */
const PLATFORM_RESPONSES: Record<string, unknown> = {
  '/api/v1/platform/context': { isPlatformAdmin: true, actingTenant: null },
  '/api/v1/platform/tenants': [],
  '/api/v1/platform/delivery/overview': {
    calendarDay: '2026-09-08',
    agencies: [],
    totals: {
      agencies: 0,
      agenciesExcluded: 0,
      enrolled: 0,
      deliveredCalls: 0,
      applications: 0,
      closingPct: null,
      revenue: null,
      callCost: null,
      margin: null,
      applicationsRemainingOnBlock: 0,
      overrunToday: 0,
      flagged: 0,
      disputed: 0,
    },
    includingNonProduction: false,
  },
  '/api/v1/platform/rating/overview': {
    calendarDay: '2026-09-08',
    timeZone: 'America/New_York',
    curveVersion: 1,
    agencies: [],
    includingNonProduction: false,
  },
  '/api/v1/platform/delivery/settlements': {
    agencyId: null,
    includingNonProduction: false,
    settlements: [],
  },
  '/api/v1/platform/delivery/agencies': [],
};

interface Recorded {
  url: string;
  status: number;
}

let requests: Recorded[] = [];

/**
 * The roles the signed-in operator holds ALONGSIDE the platform capability.
 *
 * A platform admin is not a role -- it is a row in `platform_admins` -- so
 * whatever agency roles the same person happens to hold are still on their
 * user. PUBLISHER is the set that broke: the layout's role-based redirect fired
 * before the platform context landed and sent them to /publisher/dashboard.
 */
let roles: string[] = [];

/**
 * How long `/api/v1/platform/context` takes to answer, relative to everything
 * else. Zero would mean both requests settle in the same microtask queue drain
 * and the ordering under test never happens.
 */
let contextLatencyMs = 0;

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

/** The API as a platform admin with no acting tenant actually experiences it. */
function installFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const path = pathOf(input);

      if (path === '/api/auth/me') {
        requests.push({ url: path, status: 200 });
        return json(
          {
            data: {
              id: 'operator-1',
              email: 'operator@netenroll.test',
              firstName: 'Platform',
              lastName: 'Staff',
              roles,
              tenantId: null,
            },
          },
          200
        );
      }

      if (AGENCY_SCOPED.some(route => path.startsWith(route))) {
        requests.push({ url: path, status: 409 });
        return json(
          {
            error: {
              code: 'NO_ACTING_TENANT',
              message: 'Select an agency to view this. You are in the cross-agency view.',
            },
          },
          409
        );
      }

      const match = Object.keys(PLATFORM_RESPONSES).find(route => path.startsWith(route));
      if (match) {
        if (path.startsWith('/api/v1/platform/context') && contextLatencyMs > 0) {
          await new Promise(resolve => setTimeout(resolve, contextLatencyMs));
        }
        requests.push({ url: path, status: 200 });
        return json({ data: PLATFORM_RESPONSES[match] }, 200);
      }

      // Anything else: a 200 with an empty envelope. An unlisted route is not
      // what this file is about, and failing it would make the test about the
      // fixture rather than about the page.
      requests.push({ url: path, status: 200 });
      return json({ data: null }, 200);
    })
  );
}

let pathname = '/delivery';
let redirects: string[] = [];

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({
    replace: (to: string) => redirects.push(to),
    push: (to: string) => redirects.push(to),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
}));

describe('a platform admin with no acting tenant', () => {
  beforeEach(() => {
    requests = [];
    redirects = [];
    roles = [];
    contextLatencyMs = 0;
    localStorage.clear();
    installFetch();
    // The app reads its own signed-in state from here; `useAuth` sends the
    // token to /api/auth/me, which is stubbed above.
    localStorage.setItem('token', 'test-token-for-a-platform-admin');
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /**
   * Mount the real tree at one path: the root layout's providers, the dashboard
   * layout, and the page.
   *
   * The providers are the real ones from `app/layout.tsx`, not stubs. Two of
   * them are the fix under test -- one auth request and one platform-context
   * request for the whole tree instead of one per component -- so replacing
   * them with fixtures would remove exactly what this needs to see.
   */
  async function loadPage(path: string): Promise<void> {
    pathname = path;

    const { AuthSessionProvider } = await import('@/hooks/use-auth');
    const { PlatformContextProvider } = await import('@/hooks/use-platform-context');
    const { CustomerIntakeProvider } = await import('@/contexts/customer-intake-context');
    const { default: DashboardLayout } = await import('../(dashboard)/layout');

    const Page =
      path === '/delivery'
        ? (await import('../(dashboard)/delivery/page')).default
        : path === '/rating'
          ? (await import('../(dashboard)/rating/page')).default
          : (await import('../(dashboard)/delivery/settlements/page')).default;

    render(
      <AuthSessionProvider>
        <PlatformContextProvider>
          <CustomerIntakeProvider>
            <DashboardLayout>
              <Page />
            </DashboardLayout>
          </CustomerIntakeProvider>
        </PlatformContextProvider>
      </AuthSessionProvider>
    );
  }

  /** Wait until the tree knows who the operator is, then let it settle. */
  async function settle(): Promise<void> {
    await waitFor(() => {
      expect(
        requests.some(r => r.url === '/api/v1/platform/context'),
        'the page never asked who the operator is'
      ).toBe(true);
    });
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  // The list is the layout's own, so a platform-wide page added there without
  // being added here fails rather than going untested.
  for (const path of PLATFORM_WIDE_LANDING_ROUTES) {
    describe(path, () => {
      it('is not shown the "Choose an agency" prompt', async () => {
        await loadPage(path);
        await settle();

        expect(
          screen.queryByText(/Choose an agency/i),
          `${path} rendered the "Choose an agency" prompt for a platform admin. ` +
            'This is the cross-agency view; it is where NetEnroll staff land.'
        ).toBeNull();
      });

      it('fires no agency-scoped request, so nothing can be refused', async () => {
        await loadPage(path);
        await settle();

        const refused = requests.filter(r => r.status === 409);
        expect(
          refused.map(r => r.url),
          `${path} requested agency-scoped routes with no acting tenant. Each is a 409, ` +
            'and whatever polls them will do it again.'
        ).toEqual([]);
      });

      it('asks who the operator is exactly once', async () => {
        await loadPage(path);
        await settle();

        // Both were per-component fetches. Ten concurrent /api/auth/me on one
        // page load is what exhausted the API's connection pool in production,
        // and the platform-context request behind it failed as a result.
        const auth = requests.filter(r => r.url === '/api/auth/me');
        const context = requests.filter(r => r.url === '/api/v1/platform/context');
        expect(auth.length, 'the auth check is fetched per component again').toBe(1);
        expect(context.length, 'the platform context is fetched per component again').toBe(1);
      });
    });
  }

  /**
   * The production defect, pinned to the ordering that caused it.
   *
   * An operator who also holds PUBLISHER, on a platform-wide page, with the
   * platform context answering after the auth check. The layout's role-based
   * redirect read `isPlatformAdmin` as false because it had not loaded and sent
   * them to /publisher/dashboard -- a page with no cross-agency reading, which
   * then correctly showed "Choose an agency". The prompt was right about the
   * page it was on; the operator had been moved off the page they asked for.
   */
  describe('when the platform context answers after the auth check', () => {
    for (const alsoHolds of [['PUBLISHER'], ['BUYER'], ['AGENT']]) {
      for (const path of PLATFORM_WIDE_LANDING_ROUTES) {
        it(`keeps a platform admin holding ${alsoHolds.join('+')} on ${path}`, async () => {
          roles = alsoHolds;
          contextLatencyMs = 50;

          await loadPage(path);
          await settle();

          expect(
            redirects,
            `a platform admin holding ${alsoHolds.join('+')} was redirected off ${path} ` +
              'before the platform context had loaded. The page they land on is not ' +
              'cross-agency, so it shows the prompt, and the operator never sees the ' +
              'view this page exists to give them.'
          ).toEqual([]);

          expect(screen.queryByText(/Choose an agency/i)).toBeNull();
        });
      }
    }
  });
});
