/**
 * The quoter and the CRM as one workflow, rendered: a customer's page with and
 * without quotes, its Quote action, the customer-bound quote workspace and
 * what it saves, a historical quote shown as stored (never re-priced), a
 * Requote that starts a new quote, and Quote from the CRM grid's sheet.
 *
 * The API is a fetch stub. What is asserted is what the screens send and show.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Module mocks ────────────────────────────────────────────────────────────

const auth = vi.hoisted(() => ({
  value: {
    hasFullAccess: false,
    isPlatformAdmin: false,
    isOwner: false,
    isAdmin: false,
  } as Record<string, unknown>,
}));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => auth.value }));

const nav = vi.hoisted(() => ({
  pathname: '/insurance-leads/lead-1',
  params: { id: 'lead-1' } as Record<string, string>,
  search: new URLSearchParams(),
  push: vi.fn(),
  replace: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useParams: () => nav.params,
  useRouter: () => ({ replace: nav.replace, push: nav.push, prefetch: vi.fn() }),
  useSearchParams: () => nav.search,
}));

const toasts = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock('@/components/ui/use-toast', () => ({
  toast: (t: unknown) => toasts.calls.push(t),
  useToast: () => ({ toast: vi.fn(), toasts: [] }),
}));

const phone = vi.hoisted(() => ({ makeCall: vi.fn() }));
vi.mock('@/components/phone/phone-provider', () => ({
  usePhone: () => ({ makeCall: phone.makeCall, currentCall: null, phoneStatus: 'disabled' }),
}));

vi.mock('@/contexts/customer-intake-context', () => ({
  useCustomerIntake: () => ({ formData: { firstName: '', lastName: '', phone: '' } }),
}));

// ─── Imports under test (after the mocks) ────────────────────────────────────

import { CustomerQuoteWorkspace } from '@/components/fex/customer/customer-quote-workspace';
import { LeadDetailSheet } from '@/components/leads/lead-detail-sheet';
import {
  QuoteSessionProvider,
  resetQuoteSession,
  useQuoteSession,
} from '@/contexts/quote-session-context';
import { resetFexCatalogCache } from '@/hooks/use-fex-quote';
import type { InsuranceLeadDetail } from '@/lib/api/leads';
import type { FexQuoteSummary } from '@/lib/fex/api';
import { customerSessionKey } from '@/lib/fex/customer';

import CustomerPage from '../(dashboard)/insurance-leads/[id]/page';
import QuotePage from '../(dashboard)/quote/page';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const LEAD = {
  id: 'lead-1',
  tenantId: 't',
  vertical: 'FE',
  firstName: 'Jane',
  lastName: 'Smith',
  fullName: 'Jane Smith',
  email: null,
  phone: '6155550142',
  address: null,
  address2: null,
  city: null,
  county: null,
  state: 'TN',
  zipCode: null,
  birthDate: '05/14/1958',
  age: null,
  gender: 'Female',
  source: null,
  status: 'NEW',
  notes: null,
  customFields: null,
  tags: [],
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  submissions: [],
  assignedToId: 'agent-1',
  assignedAt: null,
  lastContactedAt: null,
  nextFollowUpAt: null,
  priority: null,
  leadStage: 'CONTACTED',
  doNotCall: false,
  duplicateOfId: null,
  company: null,
  repName: null,
  industry: null,
  revenue: null,
  yearEstablished: null,
  smoker: null,
  faceAmount: '10000',
  lifeType: null,
  riskType: null,
  carrier: null,
  product: null,
  monthlyPremium: null,
  coverageAmount: null,
  trustedFormUrl: null,
  leadidToken: null,
  consentLanguage: null,
  recordingUrl: null,
  activities: [],
  tasks: [],
  applications: [],
  calls: [],
} as unknown as InsuranceLeadDetail;

const summary = (patch: Partial<FexQuoteSummary> = {}): FexQuoteSummary => ({
  id: 'q-1',
  source: 'CRM',
  callId: null,
  insuranceLeadId: 'lead-1',
  engineVersion: 'v18',
  prospectName: 'Jane Smith',
  state: 'TN',
  age: 68,
  sex: 'F',
  tobacco: false,
  faceAmount: 10000,
  budget: null,
  paymentMode: 'monthly',
  eligibleCount: 7,
  lowestPremium: 41.18,
  selectedProductId: 'moo_living_promise',
  selectedCarrier: 'Mutual of Omaha',
  selectedProduct: 'Living Promise',
  selectedClass: 'Level',
  selectedBenefit: 'LEVEL',
  selectedFace: 10000,
  selectedPremium: 54.27,
  createdAt: '2026-10-03T17:42:00Z',
  createdBy: { id: 'agent-1', name: 'Jimmy Kelly' },
  applicationId: null,
  ...patch,
});

const line = {
  classCode: 'LEVEL',
  classLabel: 'Level',
  uwClass: 'LEVEL',
  benefit: 'LEVEL',
  db: null,
  face: 10000,
  premium: 54.27,
  annual: 651.24,
  mode: 'monthly',
  modeLabel: 'Monthly',
  basis: 'ANNUAL_PER_1000',
  faceAdjusted: null,
  premiumNote: null,
  payPeriod: null,
};
const result = {
  productId: 'moo_living_promise',
  carrier: 'Mutual of Omaha',
  family: 'Mutual of Omaha',
  product: 'Living Promise',
  type: 'WL',
  status: 'CURRENT',
  ratesStatus: 'CURRENT_2026',
  uwStatus: 'CURRENT_CARRIER_2026',
  uwLoaded: true,
  alerts: [],
  age: 68,
  ageBasis: 'ANB',
  eligible: true,
  outcome: 'LEVEL',
  outcomeLabel: 'Level',
  best: line,
  others: [],
  reasons: [],
  needsIndication: [],
  assumptions: [],
  refer: false,
  appointed: true,
  application: {
    carrier: 'Mutual of Omaha',
    product: 'Living Promise',
    planType: 'LEVEL',
    annualizedPremium: 651.24,
  },
  facts: null,
};

interface Call {
  method: string;
  path: string;
  search: string;
  body: Record<string, unknown> | null;
}
let calls: Call[] = [];
let lead: InsuranceLeadDetail = LEAD;
let customerQuotes: FexQuoteSummary[] = [];

/** A form control's value, without a cast the type checker and the linter disagree about. */
const valueOf = (el: HTMLElement): string =>
  el instanceof HTMLInputElement || el instanceof HTMLSelectElement ? el.value : '';

const posted = (path: string) => calls.filter(c => c.method === 'POST' && c.path === path);

beforeEach(() => {
  calls = [];
  toasts.calls = [];
  lead = LEAD;
  customerQuotes = [];
  nav.pathname = '/insurance-leads/lead-1';
  nav.params = { id: 'lead-1' };
  nav.search = new URLSearchParams();
  nav.push.mockReset();
  nav.replace.mockReset();
  phone.makeCall.mockReset();
  resetFexCatalogCache();
  resetQuoteSession();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      // A network round trip is never synchronous.
      await Promise.resolve();
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, 'http://localhost');
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      calls.push({ method, path: url.pathname, search: url.search, body });
      switch (url.pathname) {
        case '/api/v1/insurance-leads/lead-1':
          return method === 'PATCH' ? json({ success: true }) : json(lead);
        case '/api/v1/insurance-leads/lead-1/quotes':
          return json({ data: customerQuotes, total: customerQuotes.length, nextCursor: null });
        case '/api/v1/fex/quotes/q-1':
          return json({
            data: {
              ...summary(),
              applicant: {
                state: 'TN',
                sex: 'F',
                tobacco: false,
                dob: '1958-05-14',
                face: 15000,
                mode: 'monthly',
                conditions: [],
                meds: [],
                quoteDate: '2026-10-03',
              },
              results: [result],
              selectedApplication: result.application,
            },
          });
        case '/api/v1/fex/catalog':
          return json({
            data: { engineVersion: 'v18', bundleSha256: 'abc', conditions: [], products: [] },
          });
        case '/api/v1/fex/settings':
          return json({
            data: {
              agency: {
                appointedOnly: false,
                appointedProductIds: [],
                defaultFace: 10000,
                defaultMode: 'monthly',
                showPriceOnly: true,
                autoOpenOnCall: false,
              },
              me: { autoOpenOnCall: null, carriers: null },
              canEdit: false,
            },
          });
        case '/api/v1/fex/quote':
          return json({
            data: {
              results: [result],
              summary: {
                eligible: 1,
                declined: 0,
                priceOnly: 0,
                lowestLevelPremium: 54.27,
                needsIndication: 0,
              },
              licensed: null,
              engineVersion: 'v18',
              quotedAt: new Date().toISOString(),
              quoteDate: '2026-10-07',
            },
          });
        case '/api/v1/fex/quotes':
          return json(
            {
              data: {
                id: 'q-new',
                createdAt: new Date().toISOString(),
                selected: {
                  productId: 'moo_living_promise',
                  carrier: 'Mutual of Omaha',
                  product: 'Living Promise',
                  classCode: 'LEVEL',
                  classLabel: 'Level',
                  benefit: 'LEVEL',
                  face: 10000,
                  premium: 54.27,
                  mode: 'monthly',
                  application: result.application,
                },
              },
            },
            201
          );
        default:
          return json({ data: [] });
      }
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const withSession = (ui: React.ReactNode) => <QuoteSessionProvider>{ui}</QuoteSessionProvider>;

// ─── The customer page ───────────────────────────────────────────────────────

describe('the customer page', () => {
  it('offers Call, Quote and Write application at the top', async () => {
    render(withSession(<CustomerPage />));
    expect(await screen.findByRole('button', { name: /^Quote$/ })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Call/ }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /Write application/ }).length).toBeGreaterThan(0);
  });

  it('with no quotes, says so and offers to create one', async () => {
    render(withSession(<CustomerPage />));
    expect(await screen.findByText('No quotes yet')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create quote' }));
    expect(nav.push).toHaveBeenCalledWith('/insurance-leads/lead-1/quote');
  });

  it("Quote opens this customer's own quote workspace", async () => {
    render(withSession(<CustomerPage />));
    fireEvent.click(await screen.findByRole('button', { name: /^Quote$/ }));
    expect(nav.push).toHaveBeenCalledWith('/insurance-leads/lead-1/quote');
  });

  it('asks the server for this customer’s quotes, never the agency’s list', async () => {
    render(withSession(<CustomerPage />));
    await screen.findByText('No quotes yet');
    expect(calls.some(c => c.path === '/api/v1/insurance-leads/lead-1/quotes')).toBe(true);
    expect(calls.some(c => c.path === '/api/v1/fex/quotes' && c.method === 'GET')).toBe(false);
  });

  it('leads with the selected plan, then the other quotes', async () => {
    customerQuotes = [
      summary({ id: 'q-2', createdAt: '2026-10-07T17:42:00Z' }),
      summary({ id: 'q-1', selectedCarrier: null, selectedPremium: null, selectedFace: null }),
    ];
    render(withSession(<CustomerPage />));
    const plan = await screen.findByRole('region', { name: 'Selected plan' });
    expect(within(plan).getByText('Mutual of Omaha')).toBeTruthy();
    expect(within(plan).getByText('$54.27')).toBeTruthy();
    expect(within(plan).getByText('$10,000 coverage')).toBeTruthy();
    expect(within(plan).getByText('7 plans')).toBeTruthy();
    // Monthly only: the annual premium is never stated.
    expect(within(plan).queryByText('$651.24')).toBeNull();
    expect(within(plan).queryByText(/annual/i)).toBeNull();
    // The carrier's mark, at the size it is recognised by.
    expect(plan.querySelector('[data-carrier-logo]')).toBeTruthy();
    // The quote without a choice follows as a row of its own.
    const others = screen.getByRole('region', { name: 'Other saved quotes' });
    const rows = within(others).getAllByRole('button', { name: /plans qualified/ });
    expect(rows).toHaveLength(1);
    expect(within(rows[0]).getByText('7 plans qualified')).toBeTruthy();
    expect(screen.getByText(/Lowest quoted \$41\.18\/mo/)).toBeTruthy();
  });

  it('opens a historical quote as stored, without re-pricing it', async () => {
    customerQuotes = [summary()];
    lead = { ...LEAD, state: 'FL' } as InsuranceLeadDetail;
    render(withSession(<CustomerPage />));
    fireEvent.click(await screen.findByRole('button', { name: 'View quote' }));
    expect(await screen.findByText(/Historical quote/)).toBeTruthy();
    expect(screen.getByText(/Nothing here is recalculated/)).toBeTruthy();
    // The record has moved since: said, not hidden.
    expect(screen.getByText(/record has changed since/)).toBeTruthy();
    expect(screen.getByText(/State TN → FL/)).toBeTruthy();
    // Read from the snapshot; the engine was never asked.
    expect(calls.some(c => c.path === '/api/v1/fex/quotes/q-1')).toBe(true);
    expect(posted('/api/v1/fex/quote')).toHaveLength(0);
    expect(posted('/api/v1/fex/quotes')).toHaveLength(0);
  });

  it('Requote goes to the workspace with that quote’s answers', async () => {
    customerQuotes = [summary()];
    render(withSession(<CustomerPage />));
    fireEvent.click(await screen.findByRole('button', { name: 'View quote' }));
    fireEvent.click(await screen.findByRole('button', { name: /Requote at today/ }));
    expect(nav.push).toHaveBeenCalledWith('/insurance-leads/lead-1/quote?requote=q-1');
  });

  it('Requote on the selected plan goes straight to the workspace', async () => {
    customerQuotes = [summary()];
    render(withSession(<CustomerPage />));
    fireEvent.click(await screen.findByRole('button', { name: /^Requote$/ }));
    expect(nav.push).toHaveBeenCalledWith('/insurance-leads/lead-1/quote?requote=q-1');
  });

  it('Use for application prefills the form from the quote as it was saved', async () => {
    customerQuotes = [summary()];
    render(withSession(<CustomerPage />));
    fireEvent.click(await screen.findByRole('button', { name: 'View quote' }));
    fireEvent.click(await screen.findByRole('button', { name: /Use for application/ }));
    const dialog = await screen.findByRole('dialog', { name: /Write application — Jane Smith/ });
    expect(within(dialog).getByText(/From quote: Mutual of Omaha Living Promise/)).toBeTruthy();
    expect(within(dialog).getByDisplayValue('651.24')).toBeTruthy();
  });

  it('Write application on the selected plan writes it from that quote', async () => {
    customerQuotes = [summary()];
    render(withSession(<CustomerPage />));
    const plan = await screen.findByRole('region', { name: 'Selected plan' });
    fireEvent.click(within(plan).getByRole('button', { name: /Write application/ }));
    const dialog = await screen.findByRole('dialog', { name: /Write application — Jane Smith/ });
    expect(within(dialog).getByText(/From quote: Mutual of Omaha Living Promise/)).toBeTruthy();
  });

  it('shows the application a quote became, and offers View application instead', async () => {
    lead = {
      ...LEAD,
      applications: [
        {
          id: 'app-1',
          carrier: 'Mutual of Omaha',
          product: 'Living Promise',
          planType: 'LEVEL',
          faceAmount: 10000,
          modalPremium: 651.24,
          paymentMode: 'ANNUAL',
          annualizedPremium: 651.24,
          carrierApplicationNumber: null,
          status: 'SUBMITTED',
          submittedAt: '2026-10-07T18:00:00Z',
          createdAt: '2026-10-07T18:00:00Z',
          callId: null,
          voidedAt: null,
          fexQuoteId: 'q-1',
        },
      ],
    } as InsuranceLeadDetail;
    customerQuotes = [summary({ applicationId: 'app-1' })];
    render(withSession(<CustomerPage />));
    const apps = (await screen.findByText(/From the Oct 3, 2026 quote/)).closest(
      '[id="applications"]'
    ) as HTMLElement;
    expect(within(apps).getAllByText('Submitted').length).toBeGreaterThan(0);
    expect(within(apps).getByRole('list', { name: 'Application progress' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /View application/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Write application/ })).toBeNull();
  });
});

// ─── The customer workspace: tabs, editing, tasks, notes ─────────────────────

describe('the customer workspace', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('opens on Overview, read-only: no open inputs for the record', async () => {
    render(withSession(<CustomerPage />));
    expect(await screen.findByRole('tab', { name: 'Overview', selected: true })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Contact' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Sales status' })).toBeTruthy();
    expect(screen.queryByLabelText('First name')).toBeNull();
    expect(screen.queryByLabelText('Email')).toBeNull();
  });

  it('gives calls their own tab, and keeps the tab in the hash', async () => {
    lead = {
      ...LEAD,
      calls: [
        {
          id: 'call-1',
          createdAt: '2026-10-07T18:05:00Z',
          direction: 'INBOUND',
          campaignName: 'Final Expense Inbound',
          buyerName: null,
          connectedDuration: 7,
          disposition: 'NOT_INTERESTED',
        },
      ],
    } as InsuranceLeadDetail;
    render(withSession(<CustomerPage />));
    const tab = await screen.findByRole('tab', { name: /Calls/ });
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
    const log = await screen.findByRole('tabpanel', { name: /Calls/ });
    expect(within(log).getAllByText('Not interested').length).toBeGreaterThan(0);
    expect(within(log).getAllByText('0:07').length).toBeGreaterThan(0);
    // The whole row opens the call; no "Open call" repeated per row.
    expect(
      within(log)
        .getByRole('link', { name: /Inbound call/ })
        .getAttribute('href')
    ).toBe('/calls?call=call-1');
    expect(window.location.hash).toBe('#calls');
  });

  it('edits the record in a drawer and saves only what changed', async () => {
    render(withSession(<CustomerPage />));
    fireEvent.click(await screen.findByRole('button', { name: /Edit customer/ }));
    const dialog = await screen.findByRole('dialog', { name: /Edit Jane Smith/ });
    fireEvent.change(within(dialog).getByLabelText('Email'), {
      target: { value: 'jane@example.com' },
    });
    fireEvent.change(within(dialog).getByLabelText('Tobacco'), { target: { value: 'NO' } });
    expect(within(dialog).getByText('2 unsaved changes')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: /Save changes/ }));
    await waitFor(() => expect(calls.filter(c => c.method === 'PATCH')).toHaveLength(1));
    expect(calls.find(c => c.method === 'PATCH')?.body).toEqual({
      email: 'jane@example.com',
      smoker: 'NO',
    });
  });

  it('asks before throwing away unsaved edits', async () => {
    render(withSession(<CustomerPage />));
    fireEvent.click(await screen.findByRole('button', { name: /Edit customer/ }));
    const dialog = await screen.findByRole('dialog', { name: /Edit Jane Smith/ });
    fireEvent.change(within(dialog).getByLabelText('City'), { target: { value: 'Nashville' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(within(dialog).getByText(/Discard 1 unsaved change\?/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    expect(valueOf(within(dialog).getByLabelText('City'))).toBe('Nashville');
    expect(calls.some(c => c.method === 'PATCH')).toBe(false);
  });

  it('adds a task and a dated note from Notes & tasks', async () => {
    window.history.replaceState(null, '', '/insurance-leads/lead-1#tasks');
    render(withSession(<CustomerPage />));
    // Nothing open: the empty state says so and offers the composer.
    expect(await screen.findByText('No open tasks')).toBeTruthy();
    const [open] = screen.getAllByRole('button', { name: /Add task/ });
    fireEvent.click(open);
    fireEvent.change(await screen.findByLabelText('Task title'), {
      target: { value: 'Call back Friday' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Tomorrow' }));
    const form = screen.getByRole('form', { name: 'Add a task' });
    fireEvent.click(within(form).getByRole('button', { name: /Add task/ }));
    await waitFor(() => expect(posted('/api/v1/insurance-leads/lead-1/tasks')).toHaveLength(1));
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const day = (n: number) => String(n).padStart(2, '0');
    expect(posted('/api/v1/insurance-leads/lead-1/tasks')[0].body).toMatchObject({
      title: 'Call back Friday',
      priority: 'NORMAL',
      dueAt: `${tomorrow.getFullYear()}-${day(tomorrow.getMonth() + 1)}-${day(tomorrow.getDate())}`,
    });

    fireEvent.change(screen.getByLabelText('New note'), {
      target: { value: 'Prefers calls after 2pm' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    await waitFor(() => expect(calls.filter(c => c.method === 'PATCH')).toHaveLength(1));
    const notes = String(calls.find(c => c.method === 'PATCH')?.body?.notes);
    expect(notes).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}, .+\nPrefers calls after 2pm$/);
  });

  it('completes and, after asking, cancels an open task', async () => {
    lead = {
      ...LEAD,
      tasks: [
        {
          id: 'task-1',
          tenantId: 't',
          insuranceLeadId: 'lead-1',
          assignedToId: null,
          title: 'Send the policy packet',
          description: null,
          status: 'OPEN',
          priority: 'HIGH',
          dueAt: null,
          completedAt: null,
          createdAt: '2026-10-01T00:00:00Z',
          updatedAt: '2026-10-01T00:00:00Z',
        },
      ],
    } as InsuranceLeadDetail;
    window.history.replaceState(null, '', '/insurance-leads/lead-1#tasks');
    render(withSession(<CustomerPage />));
    // The only open task leads as the Next action.
    const next = await screen.findByRole('region', { name: 'Follow-up plan' });
    expect(within(next).getByText('Send the policy packet')).toBeTruthy();
    expect(within(next).getByText(/high priority/)).toBeTruthy();
    const [complete] = within(next).getAllByRole('button', {
      name: 'Complete "Send the policy packet"',
    });
    fireEvent.click(complete);
    await waitFor(() =>
      expect(posted('/api/v1/insurance-leads/lead-1/tasks/task-1/complete')).toHaveLength(1)
    );
    const [cancel] = screen.getAllByRole('button', { name: 'Cancel "Send the policy packet"' });
    fireEvent.click(cancel);
    expect(posted('/api/v1/insurance-leads/lead-1/tasks/task-1/cancel')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel task' }));
    await waitFor(() =>
      expect(posted('/api/v1/insurance-leads/lead-1/tasks/task-1/cancel')).toHaveLength(1)
    );
  });
});

// ─── The customer-bound quote workspace ──────────────────────────────────────

describe("a customer's quote workspace", () => {
  beforeEach(() => {
    nav.pathname = '/insurance-leads/lead-1/quote';
  });

  it('says who is being quoted, and fills in what the record knows', async () => {
    render(withSession(<CustomerQuoteWorkspace leadId="lead-1" />));
    const context = await screen.findByTestId('customer-quote-context');
    await waitFor(() => expect(within(context).getByText('Jane Smith')).toBeTruthy());
    // Tobacco is not on record: asked, not assumed.
    await waitFor(() =>
      expect(within(context).getByText('Ask:').parentElement?.textContent).toMatch(/tobacco/)
    );
    // Filled, and marked as from the record.
    const state = await screen.findByLabelText(/^State/);
    expect(valueOf(state)).toBe('TN');
    expect(state.closest('div')?.parentElement?.textContent).toMatch(/From lead/);
    expect(valueOf(screen.getByLabelText(/^Date of birth/))).toBe('1958-05-14');
    // The quote runs straight away: nothing was retyped.
    await waitFor(() => expect(posted('/api/v1/fex/quote').length).toBeGreaterThan(0));
    expect(posted('/api/v1/fex/quote')[0].body).toMatchObject({
      applicant: { state: 'TN', sex: 'F', dob: '1958-05-14', face: 10000 },
    });
  });

  it('files a used quote on the customer, with no step to attach it', async () => {
    render(withSession(<CustomerQuoteWorkspace leadId="lead-1" />));
    const [use] = await screen.findAllByRole('button', { name: 'Use Quote' });
    fireEvent.click(use);
    await waitFor(() => expect(posted('/api/v1/fex/quotes')).toHaveLength(1));
    expect(posted('/api/v1/fex/quotes')[0].body).toMatchObject({
      source: 'CRM',
      insuranceLeadId: 'lead-1',
      prospectName: 'Jane Smith',
      selectedProductId: 'moo_living_promise',
    });
    // The customer's history is refreshed with it.
    await waitFor(() =>
      expect(
        calls.filter(c => c.path === '/api/v1/insurance-leads/lead-1/quotes').length
      ).toBeGreaterThan(1)
    );
    // And the next step is the application, prefilled.
    fireEvent.click(await screen.findByRole('button', { name: 'Write application' }));
    const dialog = await screen.findByRole('dialog', { name: /Write application — Jane Smith/ });
    expect(within(dialog).getByDisplayValue('Jane')).toBeTruthy();
    expect(within(dialog).getByDisplayValue('651.24')).toBeTruthy();
  });

  it('keeps the selection under the customer, so it outlives the workspace', async () => {
    let session: ReturnType<typeof useQuoteSession> = null;
    function Probe() {
      session = useQuoteSession();
      return null;
    }
    const view = render(
      withSession(
        <>
          <Probe />
          <CustomerQuoteWorkspace leadId="lead-1" />
        </>
      )
    );
    const [use] = await screen.findAllByRole('button', { name: 'Use Quote' });
    fireEvent.click(use);
    await waitFor(() =>
      expect(session?.getSelection(customerSessionKey('lead-1'))?.fexQuoteId).toBe('q-new')
    );
    view.unmount();
    expect(session!.getDraft(customerSessionKey('lead-1'))?.state).toBe('TN');
  });

  it('a Requote starts from the saved answers and saves as a new quote', async () => {
    render(withSession(<CustomerQuoteWorkspace leadId="lead-1" requoteId="q-1" />));
    expect(await screen.findByText(/Requote of/)).toBeTruthy();
    expect(screen.getByText(/the original is unchanged/)).toBeTruthy();
    // The saved applicant's coverage, not the record's.
    await waitFor(() =>
      expect(posted('/api/v1/fex/quote').at(-1)?.body).toMatchObject({
        applicant: { face: 15000, dob: '1958-05-14' },
      })
    );
    // Seeded once: the link no longer carries it, so a reload resumes the work.
    expect(nav.replace).toHaveBeenCalledWith('/insurance-leads/lead-1/quote', { scroll: false });
    const [use] = await screen.findAllByRole('button', { name: 'Use Quote' });
    fireEvent.click(use);
    await waitFor(() => expect(posted('/api/v1/fex/quotes')).toHaveLength(1));
    // A new record: posted, never a write to the old one.
    expect(calls.some(c => c.path === '/api/v1/fex/quotes/q-1' && c.method !== 'GET')).toBe(false);
  });

  it('offers what the agent learned back to the record, only on request', async () => {
    lead = { ...LEAD, birthDate: null, age: 68 } as InsuranceLeadDetail;
    render(withSession(<CustomerQuoteWorkspace leadId="lead-1" />));
    const tobacco = await screen.findByRole('radiogroup', { name: /Tobacco/ });
    fireEvent.click(within(tobacco).getByRole('radio', { name: 'Yes' }));
    const offer = await screen.findByRole('button', { name: /Add tobacco to record/ });
    expect(calls.some(c => c.method === 'PATCH')).toBe(false);
    fireEvent.click(offer);
    await waitFor(() => expect(calls.filter(c => c.method === 'PATCH')).toHaveLength(1));
    expect(calls.find(c => c.method === 'PATCH')?.body).toEqual({ smoker: 'YES' });
  });

  it('tells the agent when a save did not land', async () => {
    const real = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const raw =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (new URL(raw, 'http://localhost').pathname === '/api/v1/fex/quotes') {
          return json(
            { error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' } },
            404
          );
        }
        return real(input, init);
      })
    );
    render(withSession(<CustomerQuoteWorkspace leadId="lead-1" />));
    const [use] = await screen.findAllByRole('button', { name: 'Use Quote' });
    fireEvent.click(use);
    await waitFor(() =>
      expect(toasts.calls).toContainEqual(
        expect.objectContaining({ title: 'The quote was not saved', variant: 'destructive' })
      )
    );
    expect(screen.queryByRole('status')).toBeNull();
  });
});

// ─── The CRM grid's sheet, and the standalone page ───────────────────────────

describe('elsewhere', () => {
  it('the CRM sheet offers Call, Quote and Open customer', () => {
    render(
      withSession(
        <LeadDetailSheet lead={LEAD} loading={false} onClose={vi.fn()} onRefresh={vi.fn()} />
      )
    );
    fireEvent.click(screen.getByRole('button', { name: /^Quote$/ }));
    expect(nav.push).toHaveBeenCalledWith('/insurance-leads/lead-1/quote');
    expect(screen.getByRole('link', { name: /Open customer/ }).getAttribute('href')).toBe(
      '/insurance-leads/lead-1'
    );
    // The header's Call.
    fireEvent.click(screen.getAllByRole('button', { name: /^Call$/ })[0]);
    expect(phone.makeCall).toHaveBeenCalledWith('6155550142');
  });

  it('the standalone Quote page still quotes with no customer at all', async () => {
    nav.pathname = '/quote';
    window.history.replaceState(null, '', '/quote');
    render(withSession(<QuotePage />));
    expect(await screen.findByLabelText('State')).toBeTruthy();
    expect(screen.queryByTestId('customer-quote-context')).toBeNull();
    window.history.replaceState(null, '', '/');
  });
});
