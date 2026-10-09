/**
 * Feedback & Roadmap, RENDERED: the agent's page, a request opened in its
 * drawer, Submit Feedback from first click to confirmation, and the product
 * team's console. The API is a fetch stub; what is asserted is what a person
 * would see and what the page sends.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const target = (label = 'No timeline yet') => ({ kind: 'NONE', date: null, label });

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: 'fb-1',
    number: 12,
    title: 'Faster medication entry in the quoter',
    summary: 'Add several medications at once.',
    category: 'IMPROVEMENT',
    productArea: '/quote',
    status: 'IN_PROGRESS',
    visibility: 'PUBLIC',
    target: { kind: 'WEEK', date: '2026-10-12', label: 'Next week' },
    interestCount: 14,
    viewerInterested: false,
    isMine: false,
    ownTenant: true,
    fromProductTeam: false,
    submittedBy: null,
    unread: true,
    needsReply: false,
    latestUpdate: {
      headline: 'Development update',
      body: 'We have completed the redesigned medication search.',
      createdAt: new Date(Date.now() - 86_400_000).toISOString(),
    },
    mergedInto: null,
    shippedAt: null,
    createdAt: '2026-09-22T15:00:00.000Z',
    updatedAt: '2026-10-07T15:00:00.000Z',
    lastPublicActivityAt: '2026-10-07T15:00:00.000Z',
    ...overrides,
  };
}

const MINE = item({
  id: 'fb-mine',
  number: 20,
  title: 'Callback reminders do not show which lead they are for',
  status: 'NEEDS_INFO',
  visibility: 'PRIVATE',
  isMine: true,
  submittedBy: 'You',
  interestCount: 1,
  target: target(),
  needsReply: true,
  unread: true,
  latestUpdate: null,
});

const SHIPPED = item({
  id: 'fb-shipped',
  number: 5,
  title: 'Improved Final Expense quote workflow',
  status: 'SHIPPED',
  shippedAt: '2026-10-01T16:00:00.000Z',
  interestCount: 18,
  unread: false,
  latestUpdate: {
    headline: 'Released',
    body: 'Medication questions now stay in view.',
    createdAt: '2026-10-01T16:00:00.000Z',
  },
});

const OVERVIEW = {
  sections: {
    inProgress: { count: 1, items: [item()] },
    planned: { count: 0, items: [] },
    underReview: { count: 1, items: [MINE] },
    recentlyShipped: { count: 1, items: [SHIPPED] },
  },
  mine: { count: 1, items: [MINE] },
  unreadCount: 2,
  mineUnreadCount: 1,
  needsReplyCount: 1,
  recentlyShippedDays: 90,
  viewer: { orgAdmin: false },
};

const DETAIL = {
  ...MINE,
  description: 'The reminder pops up but it does not say who I am meant to call back.',
  originalTitle: null,
  urgency: 'MEDIUM',
  timeline: [
    { status: 'NEW', at: '2026-10-05T14:00:00.000Z' },
    { status: 'NEEDS_INFO', at: '2026-10-06T16:00:00.000Z' },
  ],
  thread: [
    {
      id: 'c-1',
      kind: 'QUESTION',
      headline: 'Question from the product team',
      body: 'Are you opening the reminder from the bell or from the lead list?',
      createdAt: '2026-10-06T16:00:00.000Z',
      author: 'Product Team',
    },
  ],
  canReply: true,
  canVote: false,
};

let searchParams = new URLSearchParams();
const replace = vi.fn((url: string) => {
  searchParams = new URLSearchParams(url.split('?')[1] ?? '');
});
const calls: Array<{ method: string; path: string; body: unknown }> = [];
let me: Record<string, unknown>;

function installFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, 'http://localhost');
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, path: `${url.pathname}${url.search}`, body });
      const path = url.pathname;
      if (path === '/api/auth/me') return json({ data: me });
      if (path === '/api/v1/platform/context') {
        return json({
          data: {
            isPlatformAdmin: me.isPlatformAdmin === true,
            actingTenant: null,
            previewRole: null,
          },
        });
      }
      if (path === '/api/v1/feedback/roadmap') return json({ data: OVERVIEW });
      if (path === '/api/v1/feedback/similar') return json({ data: [item()] });
      if (path === '/api/v1/feedback' && method === 'POST') {
        return json({ data: { ...DETAIL, id: 'fb-new', title: body.title, status: 'NEW' } }, 201);
      }
      if (path === '/api/v1/feedback') {
        return json({ data: [MINE], meta: { page: 1, pageSize: 20, total: 1 } });
      }
      if (path === '/api/v1/feedback/fb-mine') return json({ data: DETAIL });
      if (path === '/api/v1/feedback/fb-mine/read') return json({ data: { read: true } });
      if (path === '/api/v1/feedback/fb-mine/replies') {
        return json(
          {
            data: {
              ...DETAIL,
              needsReply: false,
              thread: [
                ...DETAIL.thread,
                {
                  id: 'c-2',
                  kind: 'USER_REPLY',
                  headline: null,
                  body: body.body,
                  createdAt: new Date().toISOString(),
                  author: 'You',
                },
              ],
            },
          },
          201
        );
      }
      if (path === '/api/v1/feedback/fb-1/vote') {
        return json({ data: { interestCount: 15, viewerInterested: true } }, 201);
      }
      if (path === '/api/v1/admin/product-feedback/summary') {
        return json({
          data: {
            counts: {
              new: 3,
              underReview: 2,
              needsInfo: 1,
              planned: 2,
              inProgress: 2,
              awaitingResponse: 1,
              shippedThisMonth: 1,
            },
            tenants: [{ id: 't-llp', name: 'Life Leads Plus', count: 11 }],
            owners: [{ id: 'op-1', name: 'Casey Morgan' }],
            productAreas: ['/quote'],
          },
        });
      }
      if (path === '/api/v1/admin/product-feedback') {
        return json({
          data: [
            {
              ...item(),
              publicTitle: null,
              urgency: null,
              priority: 'HIGH',
              tenant: { id: 't-llp', name: 'Life Leads Plus' },
              submittedBy: { id: 'u-1', name: 'Jordan Lee', email: 'jordan@llp.test' },
              submittedByRole: 'AGENT',
              assignedTo: { id: 'op-1', name: 'Casey Morgan' },
              awaitingResponse: true,
              latestUpdate: null,
              mergedIntoId: null,
              lastUserReplyAt: null,
            },
          ],
          meta: { page: 1, pageSize: 25, total: 1 },
        });
      }
      return json({ error: { code: 'NOT_FOUND', message: 'Not in this fixture' } }, 404);
    })
  );
}

vi.mock('next/navigation', () => ({
  usePathname: () => '/feedback',
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => searchParams,
}));

async function mount(which: 'agency' | 'staff' = 'agency'): Promise<void> {
  const { AuthSessionProvider } = await import('@/hooks/use-auth');
  const { PlatformContextProvider } = await import('@/hooks/use-platform-context');
  const { FeedbackRoadmap } = await import('@/components/feedback/feedback-roadmap');
  const { ProductFeedbackConsole } = await import(
    '@/components/feedback/staff/product-feedback-console'
  );
  render(
    <AuthSessionProvider>
      <PlatformContextProvider>
        {which === 'agency' ? <FeedbackRoadmap /> : <ProductFeedbackConsole />}
      </PlatformContextProvider>
    </AuthSessionProvider>
  );
}

const LLP_AGENT = {
  id: 'agent-1',
  email: 'alex@llp.test',
  firstName: 'Alex',
  lastName: 'Rivera',
  roles: ['AGENT'],
  tenantId: 't-llp',
  isPlatformAdmin: false,
  whiteLabel: true,
  brand: { theme: 'life-leads-plus', name: 'Life Leads Plus' },
  licensedStates: ['TX'],
};

describe('Feedback & Roadmap, for a Life Leads Plus agent', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('token', 'an-agent');
    searchParams = new URLSearchParams();
    calls.length = 0;
    replace.mockClear();
    me = LLP_AGENT;
    installFetch();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('says what it is, in the agency’s name, and shows the roadmap and their own requests', async () => {
    await mount();
    expect(await screen.findByText('Help shape Life Leads Plus')).toBeTruthy();
    await waitFor(() =>
      expect(document.querySelector('[data-section="In Progress"]')).toBeTruthy()
    );

    const progress = document.querySelector('[data-section="In Progress"]') as HTMLElement;
    expect(within(progress).getByText('Faster medication entry in the quoter')).toBeTruthy();
    expect(within(progress).getByText('Next week')).toBeTruthy();
    expect(within(progress).getByText('New update')).toBeTruthy();
    // An empty roadmap column is not drawn.
    expect(document.querySelector('[data-section="Planned"]')).toBeNull();

    const mine = document.querySelector('[data-panel="my-feedback"]') as HTMLElement;
    expect(within(mine).getByText(MINE.title)).toBeTruthy();
    expect(within(mine).getByText('The product team asked you a question')).toBeTruthy();

    const shipped = document.querySelector('[data-panel="recently-shipped"]') as HTMLElement;
    expect(within(shipped).getByText(/Asked for by 18 people/)).toBeTruthy();
    // The My Feedback filter carries the count of the viewer's own requests with news.
    expect(screen.getByLabelText('1 of yours with news')).toBeTruthy();
    // "NetEnroll" is nowhere on a branded agent's page.
    expect(document.body.textContent).not.toContain('NetEnroll');
  });

  it('adds "I want this too" in one press', async () => {
    await mount();
    await waitFor(() => expect(document.querySelector('[data-feedback-row="fb-1"]')).toBeTruthy());
    const row = document.querySelector('[data-feedback-row="fb-1"]') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: /I want this too/ }));
    await waitFor(() =>
      expect(calls.some(c => c.method === 'POST' && c.path === '/api/v1/feedback/fb-1/vote')).toBe(
        true
      )
    );
    expect(await within(row).findByRole('button', { name: /You want this/ })).toBeTruthy();
  });

  it('asks the API for only their own requests under My Feedback', async () => {
    await mount();
    fireEvent.click(await screen.findByRole('button', { name: /^My Feedback/ }));
    await waitFor(() =>
      expect(calls.some(c => c.method === 'GET' && c.path.includes('view=mine'))).toBe(true)
    );
    expect(replace).toHaveBeenCalledWith(expect.stringContaining('filter=mine'), expect.anything());
  });

  it('opens a request with the question first, its timeline, and a reply box', async () => {
    searchParams = new URLSearchParams('item=fb-mine');
    await mount();
    const drawer = await screen.findByRole('dialog');
    await within(drawer).findByText('The product team needs more information');
    expect(within(drawer).getByText('Submitted')).toBeTruthy();
    expect(within(drawer).getByText('More information requested')).toBeTruthy();
    // The stages not reached are drawn, but not as done.
    const future = drawer.querySelectorAll('[data-state="future"]');
    expect([...future].map(li => li.getAttribute('data-step'))).toEqual([
      'PLANNED',
      'IN_PROGRESS',
      'TESTING',
      'SHIPPED',
    ]);
    // Opening an unread request marks it read.
    await waitFor(() =>
      expect(
        calls.some(c => c.method === 'POST' && c.path === '/api/v1/feedback/fb-mine/read')
      ).toBe(true)
    );

    fireEvent.change(within(drawer).getByLabelText('Reply to the product team'), {
      target: { value: 'From the bell, every time.' },
    });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Send reply' }));
    await within(drawer).findByText('From the bell, every time.');
    expect(calls.find(c => c.path === '/api/v1/feedback/fb-mine/replies')?.body).toEqual({
      body: 'From the bell, every time.',
    });
  });

  it('takes feedback in two short steps, offers a similar request, and confirms', async () => {
    sessionStorage.setItem('feedback:lastRoute', '/quote');
    await mount();
    fireEvent.click(await screen.findByRole('button', { name: /Submit Feedback/ }));
    expect(await screen.findByText('What kind of feedback?')).toBeTruthy();
    fireEvent.click(document.querySelector('[data-kind="PROBLEM"]') as HTMLElement);

    fireEvent.change(await screen.findByLabelText('Title'), {
      target: { value: 'Medication search is slow' },
    });
    expect(
      await screen.findByText('Similar requests already exist', {}, { timeout: 2000 })
    ).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Details'), {
      target: { value: 'Searching a medication takes several seconds every time.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit feedback' }));

    expect(await screen.findByText('Feedback received')).toBeTruthy();
    const sent = calls.find(c => c.method === 'POST' && c.path === '/api/v1/feedback')
      ?.body as Record<string, unknown>;
    expect(sent).toMatchObject({
      category: 'PROBLEM',
      title: 'Medication search is slow',
      productArea: '/quote',
      sourceRoute: '/quote',
    });
    // The agency is the session's, never the browser's to say.
    expect(sent).not.toHaveProperty('tenantId');
    expect(Object.keys(sent.clientContext as object)).toEqual(
      expect.arrayContaining(['viewport', 'timezone', 'userAgent'])
    );
  });
});

describe('the product team’s console', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('token', 'an-operator');
    searchParams = new URLSearchParams();
    calls.length = 0;
    me = {
      id: 'op-1',
      email: 'casey@netenroll.test',
      roles: [],
      tenantId: null,
      isPlatformAdmin: true,
    };
    installFetch();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the queue with agency, submitter, interest, priority and owner', async () => {
    await mount('staff');
    const row = await waitFor(() => {
      const found = document.querySelector('[data-queue-row="fb-1"]');
      expect(found).toBeTruthy();
      return found as HTMLElement;
    });
    expect(within(row).getByText('Life Leads Plus')).toBeTruthy();
    expect(within(row).getByText(/Jordan Lee/)).toBeTruthy();
    expect(within(row).getByText('14')).toBeTruthy();
    expect(within(row).getByText('High')).toBeTruthy();
    expect(within(row).getByText('Casey Morgan')).toBeTruthy();
    expect(within(row).getByText('Replied')).toBeTruthy();

    const awaiting = document.querySelector('[data-tile="awaiting"]') as HTMLElement;
    expect(awaiting.textContent).toContain('1');
    fireEvent.click(awaiting);
    await waitFor(() =>
      expect(
        calls.some(
          c => c.path.startsWith('/api/v1/admin/product-feedback?') && c.path.includes('awaiting=1')
        )
      ).toBe(true)
    );
  });
});
