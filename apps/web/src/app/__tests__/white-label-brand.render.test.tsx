/**
 * No "NetEnroll" on a branded agency's screens, RENDERED.
 *
 * A white-labelled agency's people are looking at their agency's product. The
 * screens that used to name NetEnroll -- as the product, or as the company the
 * agency deals with -- now say the brand's name or "your account manager"
 * when a brand is active, and exactly what they said before when none is.
 *
 * Each case mounts the real component with the fixture that makes the line in
 * question render, under the Life Leads Plus brand, and reads the whole
 * document -- text and attributes, so a `title` counts -- for the word.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let brand: { theme: string; name: string | null } | null = {
  theme: 'life-leads-plus',
  name: 'Life Leads Plus',
};
let answers: Record<string, unknown> = {};

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
      if (url.pathname === '/api/auth/me') {
        return json({
          data: {
            id: 'owner-1',
            email: 'owner@llp.test',
            roles: ['OWNER', 'ADMIN'],
            permissions: ['admin:*'],
            tenantId: 'tenant-llp',
            whiteLabel: true,
            brand,
          },
        });
      }
      if (url.pathname === '/api/v1/platform/context') {
        return json({ data: { isPlatformAdmin: false, actingTenant: null, previewRole: null } });
      }
      if (url.pathname in answers) return json(answers[url.pathname]);
      return json({ data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 1 } });
    })
  );
}

vi.mock('next/navigation', () => ({
  usePathname: () => '/settings',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

// The agency switcher, failing: its fallback is one of the lines under test.
vi.mock('@/components/platform/tenant-switcher', () => ({
  TenantSwitcher: () => {
    throw new Error('switcher failed');
  },
}));

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

async function mount(node: JSX.Element): Promise<void> {
  const { AuthSessionProvider } = await import('@/hooks/use-auth');
  const { PlatformContextProvider } = await import('@/hooks/use-platform-context');
  render(
    <AuthSessionProvider>
      <PlatformContextProvider>{node}</PlatformContextProvider>
    </AuthSessionProvider>
  );
}

/** Every word of the document, attributes included. */
const everything = () => document.body.innerHTML;

const DELIVERY_TODAY = {
  calendarDay: '2026-09-25',
  timeZone: 'America/New_York',
  enrolled: true,
  chargesEnabled: false,
  autoRefill: false,
  callsRouted: 10,
  callsInProgress: 1,
  callsAnswered: 8,
  applicationsSubmitted: 2,
  todayClosingPct: 25,
  windowClosingPct: 20,
  windowDayKeys: ['2026-09-22', '2026-09-23', '2026-09-24'],
  windowDaysFound: 3,
  windowDeliveryDays: 3,
  currentRate: 50,
  curveRate: 50,
  rateOffset: 0,
  trackingRate: 55,
  trackingBelowMinimum: false,
  applicationsRemainingOnBlock: 5,
  dailyBlockApplications: 10,
  applicationsConsumedToday: 2,
  overrunToday: 0,
  overrunAmountTonight: 0,
  overrunCeiling: 5,
  distanceToCeiling: 5,
  projectedTotalCharge: 100,
  projectedNextBlockQuantity: 10,
  delivering: true,
  holdReason: null,
  holdDetail: null,
  holdSince: null,
  mandate: { status: 'NONE', valid: false, paymentMethod: 'ACH', bankName: null, last4: null },
};

const SETTLEMENT = {
  id: 'settle-1',
  deliveryDay: '2026-09-24',
  deliveredCalls: 10,
  submittedApplications: 2,
  windowClosingPct: 20,
  windowDeliveryDays: 3,
  windowDaysFound: 3,
  windowDayKeys: ['2026-09-21', '2026-09-22', '2026-09-23'],
  rate: 50,
  curveVersion: 1,
  overrunQuantity: 0,
  overrunAmount: 0,
  configuredBlockQuantity: 10,
  unusedPaidApplications: 0,
  nextBlockQuantity: 10,
  nextBlockAmount: 500,
  totalCharged: 900,
  maxDailyDebit: 800,
  paymentStatus: 'HALTED_MAX_DEBIT',
  paidAt: null,
  gracePeriodEndsOn: null,
  computedAt: '2026-09-25T04:00:00.000Z',
};

const DERIVATION = {
  stored: {
    windowClosingPct: 20,
    windowDayKeys: ['2026-09-21', '2026-09-22', '2026-09-23'],
    windowDeliveryDays: 3,
    windowDaysFound: 3,
    rate: 50,
    curveVersion: 1,
  },
  window: [
    { deliveryDay: '2026-09-21', deliveredCalls: 10, submittedApplications: 2, closingPct: 20 },
  ],
  recomputed: {
    deliveredCalls: 10,
    submittedApplications: 3,
    closingPct: 30,
    rate: 60,
    belowMinimum: false,
    anchors: { left: { closingPct: 20, rate: 50 }, right: { closingPct: 40, rate: 70 } },
    minimumClosingPct: 10,
    flatFromClosingPct: 50,
  },
  matchesStoredRate: false,
  curveFound: true,
};

const RATING_SUMMARY = {
  calendarDay: '2026-09-25',
  timeZone: 'America/New_York',
  status: 'UNDER_REVIEW',
  today: { calendarDay: '2026-09-25', deliveredCalls: 8, submittedApplications: 2, closingPct: 25 },
  ratingWindow: {
    deliveryDays: 3,
    daysFound: 3,
    dayKeys: ['2026-09-22', '2026-09-23', '2026-09-24'],
    deliveredCalls: 30,
    submittedApplications: 1,
    closingPct: 3.3,
  },
  currentRate: null,
  curveRate: null,
  rateOffset: 0,
  currentRateCalendarDay: null,
  trackingRate: null,
  trackingBelowMinimum: false,
  trackingDayKeys: [],
  curveVersion: 1,
  reviewFlag: {
    id: 'flag-1',
    raisedAt: '2026-09-24T04:00:00.000Z',
    closingPct: 3.3,
    deliveredCalls: 30,
    submittedApplications: 1,
  },
  openingBlock: null,
};

describe('a branded agency never reads "NetEnroll"', () => {
  beforeAll(async () => {
    await Promise.all([
      import('@/hooks/use-auth'),
      import('@/hooks/use-platform-context'),
      import('@/components/layout/footer'),
      import('@/components/layout/topbar'),
      import('@/components/settings/settings-view'),
      import('@/components/users/team-members-view'),
      import('@/components/delivery/delivery-view'),
      import('@/components/delivery/settlements-view'),
      import('@/components/rating/rating-view'),
      import('../(dashboard)/settings/quotas/page'),
      import('@/components/numbers/create-route-dialog'),
      import('@/components/numbers/bulkvs-purchase-dialog'),
      import('@/components/leads/manual-lead-entry-form-v2'),
      import('../(dashboard)/publisher/docs/page'),
    ]);
  }, 120_000);

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('token', 'a-signed-in-branded-owner');
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    brand = { theme: 'life-leads-plus', name: 'Life Leads Plus' };
    answers = {};
    installFetch();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('the footer names the brand', async () => {
    const { Footer } = await import('@/components/layout/footer');
    await mount(<Footer />);
    await waitFor(() =>
      expect(screen.getByText(/Life Leads Plus\. All rights reserved/)).toBeTruthy()
    );
    expect(everything()).not.toContain('NetEnroll');
  });

  it('the settings footer names the brand', async () => {
    const { SettingsView } = await import('@/components/settings/settings-view');
    await mount(<SettingsView />);
    // The line is on the Legal tab.
    fireEvent.mouseDown(await screen.findByRole('tab', { name: 'Legal' }), { button: 0 });
    await waitFor(() =>
      expect(screen.getByText(/Life Leads Plus\. All rights reserved/)).toBeTruthy()
    );
    expect(everything()).not.toContain('NetEnroll');
  });

  it('Team Members sends the agency to its account manager for a campaign', async () => {
    answers['/api/v1/users'] = {
      data: [
        {
          id: 'agent-1',
          email: 'agent@llp.test',
          status: 'active',
          roles: ['agent'],
          invitedAt: '2026-09-01T00:00:00.000Z',
          lastLoginAt: null,
          licensedStates: ['TX'],
        },
      ],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    };
    answers['/api/v1/agent-roster'] = {
      data: {
        agents: [
          {
            id: 'agent-1',
            email: 'agent@llp.test',
            name: 'Ada Agent',
            status: 'ACTIVE',
            licensedStates: ['TX'],
            extension: null,
            hasSipCredential: false,
            cellForwardNumber: null,
            maxConcurrentCalls: 1,
            campaignIds: [],
            schedule: null,
            softphoneStatus: 'offline',
            availableForCalls: true,
            availabilityChangedAt: null,
            blockedReason: 'No campaign',
            blockedBy: 'NO_CAMPAIGN',
          },
        ],
        campaigns: [],
        defaultMaxConcurrentCalls: 1,
        deliveryTimeZone: 'America/New_York',
      },
    };
    const { TeamMembersView } = await import('@/components/users/team-members-view');
    await mount(<TeamMembersView />);
    await waitFor(() =>
      expect(screen.getByText(/Your account manager sets that up\./)).toBeTruthy()
    );
    expect(everything()).not.toContain('NetEnroll');
  });

  it('Delivery, not enrolled, names the account manager', async () => {
    answers['/api/v1/delivery/today'] = { data: { ...DELIVERY_TODAY, enrolled: false } };
    answers['/api/v1/delivery/agents'] = {
      data: { agencyClosingPct: null, agencyAnnualizedPremium: 0, agents: [] },
    };
    const { DeliveryView } = await import('@/components/delivery/delivery-view');
    await mount(<DeliveryView />);
    await waitFor(() => expect(screen.getByText(/Your account manager enables it/)).toBeTruthy());
    expect(everything()).not.toContain('NetEnroll');
  });

  it('Delivery, not charging and with no mandate, names the account manager', async () => {
    answers['/api/v1/delivery/today'] = { data: DELIVERY_TODAY };
    answers['/api/v1/delivery/agents'] = {
      data: { agencyClosingPct: null, agencyAnnualizedPremium: 0, agents: [] },
    };
    const { DeliveryView } = await import('@/components/delivery/delivery-view');
    await mount(<DeliveryView />);
    await waitFor(() =>
      expect(screen.getByText(/Contact your account manager to set one up/)).toBeTruthy()
    );
    expect(screen.getByText(/your account manager turns charging on/)).toBeTruthy();
    expect(everything()).not.toContain('NetEnroll');
  });

  it('keeps the NetEnroll wording for an unbranded agency', async () => {
    brand = null;
    answers['/api/v1/delivery/today'] = { data: { ...DELIVERY_TODAY, enrolled: false } };
    answers['/api/v1/delivery/agents'] = {
      data: { agencyClosingPct: null, agencyAnnualizedPremium: 0, agents: [] },
    };
    const { DeliveryView } = await import('@/components/delivery/delivery-view');
    await mount(<DeliveryView />);
    await waitFor(() => expect(screen.getByText(/NetEnroll enables it per agency/)).toBeTruthy());
  });

  it('Settlements: a halted day and a rate that moved name the account manager', async () => {
    answers['/api/v1/delivery/settlements'] = { data: [SETTLEMENT] };
    answers['/api/v1/delivery/settlements/settle-1/derivation'] = { data: DERIVATION };
    const { SettlementsView } = await import('@/components/delivery/settlements-view');
    await mount(<SettlementsView />);
    const day = await screen.findAllByText(/halted/i);
    fireEvent.click(day[0].closest('tr') as HTMLElement);
    await waitFor(() =>
      expect(
        screen.getByText(/contact your account manager and they will go through it/i)
      ).toBeTruthy()
    );
    expect(everything()).toContain('your account manager was alerted');
    expect(everything()).not.toContain('NetEnroll');
  });

  it('Rate: a review flag is cleared by the account manager', async () => {
    answers['/api/v1/rating/summary'] = { data: RATING_SUMMARY };
    answers['/api/v1/rating/history'] = { data: [] };
    const { RatingView } = await import('@/components/rating/rating-view');
    await mount(<RatingView />);
    await waitFor(() => expect(screen.getByText(/your account manager clears it/)).toBeTruthy());
    expect(everything()).not.toContain('NetEnroll');
  });

  it('Quotas are set by the account manager', async () => {
    answers['/api/v1/quota/summary'] = { data: { quota: null, budget: null, status: null } };
    const { default: QuotasPage } = await import('../(dashboard)/settings/quotas/page');
    await mount(<QuotasPage />);
    await waitFor(() =>
      expect(
        screen.getByText('Your agency’s limits and spend, set by your account manager')
      ).toBeTruthy()
    );
    expect(everything()).not.toContain('NetEnroll');
  });

  it('the route dialog says "Phone number"', async () => {
    const { CreateRouteDialog } = await import('@/components/numbers/create-route-dialog');
    await mount(
      <CreateRouteDialog
        open
        onOpenChange={() => undefined}
        availableNumbers={[]}
        onSuccess={() => undefined}
      />
    );
    await waitFor(() => expect(screen.getByText('Phone number')).toBeTruthy());
    expect(everything()).not.toContain('NetEnroll');
  });

  it('the number dialog names the brand', async () => {
    const { BulkvsPurchaseDialog } = await import('@/components/numbers/bulkvs-purchase-dialog');
    await mount(<BulkvsPurchaseDialog open onOpenChange={() => undefined} />);
    await waitFor(() =>
      expect(screen.getByText('Add Phone Number (Life Leads Plus)')).toBeTruthy()
    );
    expect(everything()).not.toContain('NetEnroll');
  });

  it('the manual lead form names the brand', async () => {
    const { ManualLeadEntryFormV2 } = await import('@/components/leads/manual-lead-entry-form-v2');
    await mount(<ManualLeadEntryFormV2 />);
    await waitFor(() => expect(screen.getByText(/Life Leads Plus CRM page/)).toBeTruthy());
    expect(everything()).not.toContain('NetEnroll');
  });

  it('the topbar sends a failed switcher to the account manager', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { Topbar } = await import('@/components/layout/topbar');
    await mount(<Topbar />);
    const alert = await screen.findByRole('alert');
    expect(alert.getAttribute('title')).toContain('let your account manager know');
    expect(everything()).not.toContain('NetEnroll');
  });

  it('the publisher docs name the brand', async () => {
    const { default: PublisherDocsPage } = await import('../(dashboard)/publisher/docs/page');
    await mount(<PublisherDocsPage />);
    await waitFor(() => expect(screen.getByText(/integrate with Life Leads Plus/)).toBeTruthy());
    expect(everything()).not.toContain('NetEnroll');
  });
});
