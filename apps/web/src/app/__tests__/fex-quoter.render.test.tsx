/**
 * The final expense quoter, rendered: live quoting, the page's tabs, the
 * softphone screen pop, the disposition it prefills, and the console's tab.
 *
 * The API is a fetch stub. What is asserted is what the screen does with it:
 * one request per burst of edits, old results kept on screen while the next
 * quote is in flight, a medication's use answered from the banner, a used
 * quote posted once and handed on, and the application prefilled from it.
 */
import type { QuoteLine } from '@hopwhistle/fex-engine/types';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Module mocks ────────────────────────────────────────────────────────────

const auth = vi.hoisted(() => ({
  value: { hasFullAccess: false, isPlatformAdmin: false } as Record<string, unknown>,
}));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => auth.value }));

const nav = vi.hoisted(() => ({ pathname: '/dashboard' }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const toasts = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock('@/components/ui/use-toast', () => ({
  toast: (t: unknown) => toasts.calls.push(t),
  useToast: () => ({ toast: vi.fn(), toasts: [] }),
}));

const phone = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('@/components/phone/phone-provider', () => ({ usePhone: () => phone.value }));

vi.mock('@/contexts/customer-intake-context', () => ({
  useCustomerIntake: () => ({ formData: { firstName: '', lastName: '', phone: '' } }),
}));

// ─── Imports under test (after the mocks) ────────────────────────────────────

import {
  applicationPrefillFrom,
  quoteToCallData,
} from '@/components/call-center/application-prefill';
import {
  ApplicationLogForm,
  type ApplicationLogPayload,
} from '@/components/call-center/ApplicationLogForm';
import { WorkspaceTabs } from '@/components/call-center/WorkspaceTabs';
import { QuoteDrawer } from '@/components/fex/quote-drawer';
import { QuoteWorkspace } from '@/components/fex/quote-workspace';
import { AgentPhonePanel } from '@/components/phone/agent-phone-panel';
import { GlobalDispositionModal } from '@/components/phone/global-disposition-modal';
import {
  QuoteSessionProvider,
  resetQuoteSession,
  useQuoteSession,
} from '@/contexts/quote-session-context';
import { resetFexCatalogCache } from '@/hooks/use-fex-quote';
import type { FexResult, FexSelection } from '@/lib/fex/api';
import { emptyDraft, type QuoteDraft } from '@/lib/fex/draft';

import QuotePage from '../(dashboard)/quote/page';

// ─── The API stub ────────────────────────────────────────────────────────────

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const line = (patch: Record<string, unknown> = {}): QuoteLine =>
  ({
    classCode: 'LEVEL',
    classLabel: 'Level',
    uwClass: 'LEVEL',
    benefit: 'LEVEL',
    db: null,
    face: 10000,
    premium: 41.18,
    annual: 494.16,
    mode: 'monthly',
    modeLabel: 'Monthly',
    basis: 'ANNUAL_PER_1000',
    faceAdjusted: null,
    premiumNote: null,
    payPeriod: null,
    ...patch,
  }) as unknown as QuoteLine;

const result = (patch: Partial<FexResult> = {}): FexResult =>
  ({
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
    best: line(),
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
      annualizedPremium: 494.16,
    },
    facts: null,
    ...patch,
  }) as FexResult;

interface Call {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}
let calls: Call[] = [];
let quoteResults: () => FexResult[] = () => [result()];
/** When set, POST /fex/quote waits on it (to hold a quote "in flight"). */
let holdQuote: Promise<void> | null = null;
/** What the quote response says about the agent's own carrier pick. */
let quoteCarriers: { selected: number; total: number } | null = null;
let settings = {
  agency: {
    appointedOnly: false,
    appointedProductIds: [],
    defaultFace: 10000,
    defaultMode: 'monthly',
    showPriceOnly: true,
    autoOpenOnCall: true,
  },
  me: { autoOpenOnCall: null as boolean | null, carriers: null as string[] | null },
  canEdit: false,
};
let customerVertical: string | null = 'FE';

/** A form control's value, without a cast the type checker and the linter disagree about. */
const valueOf = (el: HTMLElement): string =>
  el instanceof HTMLInputElement || el instanceof HTMLSelectElement ? el.value : '';

const quotesPosted = () => calls.filter(c => c.method === 'POST' && c.path === '/api/v1/fex/quote');
const savesPosted = () => calls.filter(c => c.method === 'POST' && c.path === '/api/v1/fex/quotes');

beforeEach(() => {
  calls = [];
  toasts.calls = [];
  quoteResults = () => [result()];
  holdQuote = null;
  quoteCarriers = null;
  customerVertical = 'FE';
  settings = { ...settings, me: { autoOpenOnCall: null, carriers: null } };
  auth.value = { hasFullAccess: false, isPlatformAdmin: false };
  nav.pathname = '/dashboard';
  resetFexCatalogCache();
  resetQuoteSession();
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, 'http://localhost');
      const method = init?.method ?? 'GET';
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      calls.push({ method, path: url.pathname, body });
      switch (url.pathname) {
        case '/api/v1/fex/catalog':
          return json({
            data: {
              engineVersion: 'v18',
              bundleSha256: 'abc',
              conditions: [
                { code: 'NEUROPATHY', label: 'Neuropathy', category: 'Neuro' },
                { code: 'SEIZURES', label: 'Seizures / epilepsy', category: 'Neuro' },
                { code: 'DIABETES', label: 'Diabetes', category: 'Endocrine' },
              ],
              products: [],
            },
          });
        case '/api/v1/fex/settings':
          return json({ data: settings });
        case '/api/v1/fex/quote': {
          if (holdQuote) await holdQuote;
          const results = quoteResults();
          return json({
            data: {
              results,
              summary: {
                eligible: 1,
                declined: 0,
                priceOnly: 0,
                lowestLevelPremium: 41.18,
                needsIndication: 0,
              },
              licensed: null,
              carriers: quoteCarriers,
              engineVersion: 'v18',
              quotedAt: new Date().toISOString(),
              quoteDate: '2026-10-05',
            },
          });
        }
        case '/api/v1/fex/quotes':
          return json(
            {
              data: {
                id: '11111111-1111-4111-8111-111111111111',
                createdAt: new Date().toISOString(),
                selected: {
                  productId: body?.selectedProductId,
                  carrier: 'Mutual of Omaha',
                  product: 'Living Promise',
                  classCode: 'LEVEL',
                  classLabel: 'Level',
                  benefit: 'LEVEL',
                  face: 10000,
                  premium: 41.18,
                  mode: 'monthly',
                  application: {
                    carrier: 'Mutual of Omaha',
                    product: 'Living Promise',
                    planType: 'LEVEL',
                    annualizedPremium: 494.16,
                  },
                },
              },
            },
            201
          );
        case '/api/v1/call-center/customer-lookup':
          return json({
            customer: customerVertical
              ? {
                  id: 'lead-1',
                  recordType: 'InsuranceLead',
                  phone: '6155550142',
                  vertical: customerVertical,
                  state: 'TN',
                  firstName: 'Ruth',
                  lastName: 'Adams',
                }
              : null,
          });
        default:
          return json({ data: [] });
      }
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const READY: QuoteDraft = {
  ...emptyDraft(),
  state: 'TN',
  sex: 'F',
  ageOrDob: { mode: 'age', age: '68' },
};

// ─── QuoteWorkspace ──────────────────────────────────────────────────────────

/** The results list's rows, in order, by product id. */
const rowIds = (): string[] =>
  Array.from(document.querySelectorAll('[role="tabpanel"] li[data-product]')).map(
    li => li.getAttribute('data-product') ?? ''
  );

const TRINITY = (patch: Partial<FexResult> = {}) =>
  result({
    productId: 'trinity_golden_eagle',
    carrier: 'Trinity',
    family: 'Family Benefit / Trinity',
    product: 'Golden Eagle Final Expense',
    best: line({ premium: 35.88 }),
    ...patch,
  });
const GRADED = (patch: Partial<FexResult> = {}) =>
  result({
    productId: 'aetna_protection',
    carrier: 'Aetna',
    family: 'Aetna / Continental Life',
    product: 'Protection Series Final Expense',
    outcome: 'GRADED',
    outcomeLabel: 'Graded',
    best: line({ classCode: 'GRADED', classLabel: 'Graded', benefit: 'GRADED', premium: 52.1 }),
    ...patch,
  });
const DECLINED = () =>
  result({
    productId: 'foresters_planright',
    carrier: 'Foresters',
    family: 'Foresters',
    product: 'PlanRight Whole Life',
    eligible: false,
    outcome: 'DECLINE',
    outcomeLabel: 'Declined',
    best: null,
    ineligibleReason: 'Insulin use before age 50',
    reasons: [
      {
        kind: 'rule',
        outcome: 'DECLINE',
        text: 'Diabetes with insulin before age 50',
        page: 4,
        src: 'application',
      },
    ] as FexResult['reasons'],
  });

describe('QuoteWorkspace', () => {
  it('shows every intake block open at once, with no accordion to work', () => {
    render(<QuoteWorkspace variant="page" source="PAGE" initialDraft={READY} />);
    for (const name of ['Applicant', 'Coverage', 'Health', 'Medications'])
      expect(screen.getByRole('heading', { name })).toBeTruthy();
    // Every field is on screen: nothing to open first.
    expect(valueOf(screen.getByLabelText(/^State/))).toBe('TN');
    expect(valueOf(screen.getByLabelText(/^Age/))).toBe('68');
    expect(screen.getByRole('radiogroup', { name: 'Quote by' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Add a condition' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Add a medication' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Applicant' })).toBeNull();
  });

  it('sends one request per burst of edits', async () => {
    render(<QuoteWorkspace variant="page" source="PAGE" initialDraft={READY} />);
    await screen.findAllByText(/Living Promise/);
    const before = quotesPosted().length;
    expect(before).toBe(1);

    const age = screen.getByLabelText(/^Age/);
    fireEvent.change(age, { target: { value: '6' } });
    fireEvent.change(age, { target: { value: '69' } });
    fireEvent.change(age, { target: { value: '70' } });

    await waitFor(() => expect(quotesPosted().length).toBe(before + 1));
    await new Promise(r => setTimeout(r, 400));
    expect(quotesPosted().length).toBe(before + 1);
    expect(quotesPosted().at(-1)!.body).toMatchObject({ applicant: { age: 70 } });
  });

  it("says when the results are the agent's own carriers, and links to change them", async () => {
    render(<QuoteWorkspace variant="page" source="PAGE" initialDraft={READY} />);
    await screen.findAllByText(/Living Promise/);
    expect(screen.queryByRole('link', { name: /carriers$/ })).toBeNull();
    cleanup();

    quoteCarriers = { selected: 6, total: 19 };
    render(<QuoteWorkspace variant="page" source="PAGE" initialDraft={READY} />);
    const link = await screen.findByRole('link', { name: '6 of 19 carriers' });
    expect(link.getAttribute('href')).toBe('/account#quote-carriers');
  });

  it('keeps the last results on screen, marked updating, while the next quote runs', async () => {
    render(<QuoteWorkspace variant="page" source="PAGE" initialDraft={READY} />);
    await screen.findAllByText(/Living Promise/);
    expect(screen.getByText('Live quoting')).toBeTruthy();

    let release!: () => void;
    holdQuote = new Promise(r => (release = r));
    fireEvent.change(screen.getByLabelText(/^Age/), { target: { value: '71' } });

    await waitFor(() => expect(quotesPosted().length).toBe(2));
    expect(screen.getAllByText(/Living Promise/).length).toBeGreaterThan(0);
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.getByText('Updating quotes…')).toBeTruthy();

    await act(async () => {
      release();
      await holdQuote;
    });
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
  });

  it("asks what a medication is for in the medication's own row, and re-quotes with it", async () => {
    quoteResults = () => {
      const answered = (
        quotesPosted().at(-1)?.body?.applicant as { meds?: Array<{ indication?: string }> }
      )?.meds?.[0]?.indication;
      return [
        result({
          needsIndication: answered
            ? []
            : [{ drugId: 'gabapentin', name: 'gabapentin', options: ['NEUROPATHY', 'SEIZURES'] }],
        }),
      ];
    };
    const draft: QuoteDraft = {
      ...READY,
      meds: [{ key: 'm1', drugId: 'gabapentin', name: 'gabapentin', lastTakenMonthsAgo: 0 }],
    };
    render(<QuoteWorkspace variant="page" source="PAGE" initialDraft={draft} />);

    const meds = screen.getByRole('list', { name: 'Selected medications' });
    const question = await within(meds).findByRole('radiogroup', {
      name: 'What gabapentin is prescribed for',
    });
    expect(within(meds).getByText(/strictest use it lists/)).toBeTruthy();
    // Named in the readiness panel and on the Medications block, too.
    expect(screen.getByText('Quoting on assumptions')).toBeTruthy();
    expect(screen.getByText('1 to review')).toBeTruthy();
    fireEvent.click(within(question).getByRole('radio', { name: 'Neuropathy' }));

    await waitFor(() => expect(quotesPosted().length).toBe(2));
    expect(quotesPosted()[1].body).toMatchObject({
      applicant: { meds: [{ drugId: 'gabapentin', indication: 'NEUROPATHY' }] },
    });
    await waitFor(() =>
      expect(within(meds).queryByRole('radiogroup', { name: /prescribed for/ })).toBeNull()
    );
    expect(within(meds).getByText(/For Neuropathy/)).toBeTruthy();
  });

  it("opens a condition's questions right under it, and folds back on Done", async () => {
    render(<QuoteWorkspace variant="page" source="PAGE" initialDraft={READY} />);
    await screen.findAllByText(/Living Promise/);
    fireEvent.click(screen.getByRole('button', { name: 'Add Diabetes' }));
    // The questions open inside the condition's own row, cursor in the first.
    const list = screen.getByRole('list', { name: 'Selected conditions' });
    const questions = within(list).getByRole('group', { name: 'Diabetes questions' });
    const dx = within(questions).getByLabelText('Diagnosed');
    expect(document.activeElement).toBe(dx);
    expect(within(questions).getByText(/2 details to ask/)).toBeTruthy();
    // The search stays where it was, for the next condition.
    expect(screen.getByRole('combobox', { name: 'Add a condition' })).toBeTruthy();

    fireEvent.change(dx, { target: { value: '18' } });
    await waitFor(() =>
      expect(quotesPosted().at(-1)?.body).toMatchObject({
        applicant: { conditions: [{ code: 'DIABETES', diagnosedMonthsAgo: 18 }] },
      })
    );
    fireEvent.click(within(questions).getByRole('button', { name: 'Done' }));
    // Folded to one line, the cursor back in the search.
    const search = screen.getByRole('combobox', { name: 'Add a condition' });
    await waitFor(() => expect(document.activeElement).toBe(search));
    expect(within(list).queryByRole('group')).toBeNull();
    expect(within(list).getByText(/Dx 1–2 yrs/)).toBeTruthy();

    // Reopened from its row, the answer is still there.
    fireEvent.click(within(list).getByRole('button', { name: /^Diabetes/ }));
    expect(valueOf(screen.getByLabelText('Diagnosed'))).toBe('18');
  });

  it('names unanswered details in the readiness panel, and each opens its question', async () => {
    const draft: QuoteDraft = {
      ...READY,
      conditions: [{ key: 'c1', code: 'SEIZURES', onMeds: false, detail: {} }],
    };
    render(<QuoteWorkspace variant="page" source="PAGE" initialDraft={draft} />);
    await screen.findAllByText(/Living Promise/);
    expect(screen.getByText('Quoting on assumptions')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Seizures \/ epilepsy · / }));
    const questions = screen.getByRole('group', { name: 'Seizures / epilepsy questions' });
    expect(document.activeElement).toBe(within(questions).getByLabelText('Diagnosed'));
    expect(within(questions).getByLabelText('Last seizure')).toBeTruthy();
  });

  it('posts a used quote once and hands the selection on', async () => {
    const onUseQuote = vi.fn();
    render(
      <QuoteWorkspace
        variant="page"
        source="PAGE"
        initialDraft={READY}
        prospectName="Ruth Adams"
        onUseQuote={onUseQuote}
      />
    );
    // The first row is the recommendation, its reason said, with the carrier's logo.
    const [use] = await screen.findAllByRole('button', { name: 'Use Quote' });
    const row = use.closest('li')!;
    expect(row.hasAttribute('data-recommended')).toBe(true);
    expect(within(row).getByText('Recommended')).toBeTruthy();
    expect(within(row).getByText('Best price')).toBeTruthy();
    expect(row.querySelector('[data-carrier-logo="Mutual of Omaha"] img')).toBeTruthy();
    fireEvent.click(use);

    await waitFor(() => expect(onUseQuote).toHaveBeenCalledTimes(1));
    expect(savesPosted()).toHaveLength(1);
    expect(savesPosted()[0].body).toMatchObject({
      source: 'PAGE',
      prospectName: 'Ruth Adams',
      selectedProductId: 'moo_living_promise',
      selectedClassCode: 'LEVEL',
      applicant: { state: 'TN', sex: 'F', age: 68 },
    });
    expect(onUseQuote.mock.calls[0][0]).toMatchObject({
      fexQuoteId: '11111111-1111-4111-8111-111111111111',
      carrier: 'Mutual of Omaha',
      application: { annualizedPremium: 494.16 },
    });
    expect(toasts.calls).toContainEqual(
      expect.objectContaining({ title: 'Quote saved — Mutual of Omaha Living Promise, $41.18/mo' })
    );
    // The selected quote, pinned, and the row's own button turned to "Selected".
    const bar = await screen.findByRole('status', { name: 'Selected quote' });
    expect(within(bar).getByText('Selected')).toBeTruthy();
    expect(within(bar).getByText('$41.18/mo')).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Selected' })).toBeTruthy();
    // View details opens the chosen carrier's row.
    fireEvent.click(within(bar).getByRole('button', { name: 'View details' }));
    expect(
      within(row)
        .getByRole('button', { name: /Hide details/ })
        .getAttribute('aria-expanded')
    ).toBe('true');
    // Change clears it.
    fireEvent.click(within(bar).getByRole('button', { name: 'Change' }));
    expect(screen.queryByRole('status', { name: 'Selected quote' })).toBeNull();
  });

  it('lists every required field, marks it, and moves the cursor to the first', async () => {
    render(<QuoteWorkspace variant="page" source="PAGE" initialDraft={emptyDraft()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Get quotes' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('3 items required');
    for (const name of ['State', 'Sex', 'Age (18–100)'])
      expect(within(alert).getByRole('button', { name })).toBeTruthy();
    await waitFor(() => expect(document.activeElement?.id).toMatch(/-state$/));
    expect(screen.getByLabelText(/^State/).getAttribute('aria-invalid')).toBe('true');
    expect(screen.getAllByText('Required to quote').length).toBeGreaterThan(0);
    // Each missing item goes straight to its field.
    fireEvent.click(within(alert).getByRole('button', { name: 'Age (18–100)' }));
    await waitFor(() => expect(document.activeElement?.id).toMatch(/-age$/));
    expect(quotesPosted()).toHaveLength(0);
  });

  it('says it is ready, then live, and refreshes on request', async () => {
    render(<QuoteWorkspace variant="page" source="PAGE" initialDraft={READY} />);
    expect(screen.getByText('Ready to quote')).toBeTruthy();
    await screen.findAllByText(/Living Promise/);
    expect(screen.getByText('Live quoting')).toBeTruthy();
    expect(screen.getByText(/^Updated /)).toBeTruthy();
    const before = quotesPosted().length;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh quotes' }));
    await waitFor(() => expect(quotesPosted().length).toBe(before + 1));
  });

  it('asks for the minimum before quoting anything, in a compact pane', async () => {
    const onOpenTab = vi.fn();
    render(
      <QuoteWorkspace
        variant="page"
        source="PAGE"
        initialDraft={emptyDraft()}
        onOpenTab={onOpenTab}
      />
    );
    expect(await screen.findByRole('heading', { name: 'No quote yet' })).toBeTruthy();
    expect(screen.getByText(/still needed/).parentElement?.textContent).toMatch(
      /State, Sex, Age \(18–100\)/
    );
    fireEvent.click(screen.getByRole('button', { name: 'Search underwriting' }));
    expect(onOpenTab).toHaveBeenCalledWith('conditions');
    await new Promise(r => setTimeout(r, 350));
    expect(quotesPosted()).toHaveLength(0);
  });

  it('shows full product names, one row shape, and a command bar of the figures', async () => {
    // The API sends its natural order: lowest price first.
    quoteResults = () => [TRINITY(), result(), GRADED(), DECLINED()];
    render(<QuoteWorkspace variant="page" source="PAGE" initialDraft={READY} />);
    await screen.findByText('Golden Eagle Final Expense');
    const summary = screen.getByRole('region', { name: 'Summary' });
    expect(within(summary).getByRole('heading', { level: 2 }).textContent).toMatch(
      /3 qualify\s*of 4 quoted/
    );
    const bestPrice = within(summary).getByText('Best price').parentElement!;
    expect(bestPrice.textContent).toBe('Best price$35.88/mo');
    // Lowest price first; every qualifying row the same component.
    expect(rowIds()).toEqual(['trinity_golden_eagle', 'moo_living_promise', 'aetna_protection']);
    const rows = document.querySelectorAll('[role="tabpanel"] li[data-product]');
    expect(rows[0].hasAttribute('data-recommended')).toBe(true);
    expect(rows[1].hasAttribute('data-recommended')).toBe(false);
    // The tab counts.
    expect(screen.getByRole('tab', { name: /Qualified\s*3/ }).getAttribute('aria-selected')).toBe(
      'true'
    );
    expect(screen.getByRole('tab', { name: /Declined\s*1/ })).toBeTruthy();
  });

  it('sorts, filters to level, searches, and shows the active filters', async () => {
    quoteResults = () => [result(), TRINITY(), GRADED()];
    render(<QuoteWorkspace variant="page" source="PAGE" initialDraft={READY} />);
    await screen.findByText('Golden Eagle Final Expense');

    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'carrier' } });
    expect(rowIds()).toEqual(['aetna_protection', 'trinity_golden_eagle', 'moo_living_promise']);

    fireEvent.click(screen.getByRole('button', { name: 'Level only' }));
    expect(rowIds()).not.toContain('aetna_protection');
    const chip = screen.getByRole('button', { name: 'Remove filter: Level only' });

    // Search is an icon until it is wanted.
    fireEvent.click(screen.getByRole('button', { name: 'Search carriers or products' }));
    fireEvent.change(
      await screen.findByRole('searchbox', { name: 'Search carriers or products' }),
      {
        target: { value: 'golden' },
      }
    );
    expect(rowIds()).toEqual(['trinity_golden_eagle']);

    fireEvent.click(chip);
    fireEvent.click(screen.getByRole('button', { name: /Remove filter: “golden”/ }));
    expect(rowIds()).toHaveLength(3);
  });

  it('shows declines with their reason and source, in their own category', async () => {
    quoteResults = () => [result(), DECLINED()];
    render(<QuoteWorkspace variant="page" source="PAGE" initialDraft={READY} />);
    await screen.findAllByText(/Living Promise/);
    expect(screen.queryByText('PlanRight Whole Life')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /Declined/ }));
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByText('PlanRight Whole Life')).toBeTruthy();
    expect(within(panel).getByText('Insulin use before age 50')).toBeTruthy();
    expect(within(panel).getByText(/Application\s+p\. 4/)).toBeTruthy();
    // A decline cannot be used or compared.
    expect(within(panel).queryByRole('button', { name: 'Use Quote' })).toBeNull();
    // Opened, it says why it was declined.
    fireEvent.click(within(panel).getByRole('button', { name: /Show details/ }));
    expect(within(panel).getByRole('heading', { name: 'Why it was declined' })).toBeTruthy();
  });

  it('puts referrals and unconfirmed medications under Needs review', async () => {
    quoteResults = () => [result(), TRINITY({ refer: true })];
    render(<QuoteWorkspace variant="page" source="PAGE" initialDraft={READY} />);
    await screen.findByText('Golden Eagle Final Expense');
    fireEvent.click(screen.getByRole('tab', { name: /Needs review\s*1/ }));
    expect(rowIds()).toEqual(['trinity_golden_eagle']);
    expect(
      within(screen.getByRole('tabpanel')).getAllByText('Referral required').length
    ).toBeGreaterThan(0);
  });

  it('compares carriers side by side from a pinned tray', async () => {
    quoteResults = () => [result(), TRINITY(), GRADED()];
    render(<QuoteWorkspace variant="page" source="PAGE" initialDraft={READY} />);
    await screen.findByText('Golden Eagle Final Expense');
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'Add Family Benefit / Trinity Golden Eagle Final Expense to comparison',
      })
    );
    const tray = screen.getByRole('region', { name: 'Comparison' });
    expect(within(tray).getByRole('button', { name: 'Compare' }).hasAttribute('disabled')).toBe(
      true
    );
    // C on a focused row adds it too.
    const toggle = document.querySelector<HTMLElement>(
      '[data-product="aetna_protection"] [data-row-toggle]'
    )!;
    fireEvent.keyDown(toggle, { key: 'c' });
    expect(within(tray).getByText('2')).toBeTruthy();
    fireEvent.click(within(tray).getByRole('button', { name: 'Compare' }));
    const dialog = await screen.findByRole('dialog', { name: 'Compare 2 carriers' });
    // The lowest premium is marked as the winner of its row.
    expect(within(dialog).getByText('Lowest')).toBeTruthy();
    expect(within(dialog).getByText('Health outcome')).toBeTruthy();
  });

  it('says what changed after a health edit, carrier by carrier', async () => {
    quoteResults = () => {
      const conditions = (
        quotesPosted().at(-1)?.body?.applicant as { conditions?: unknown[] } | undefined
      )?.conditions;
      return conditions?.length
        ? [
            GRADED({
              productId: 'moo_living_promise',
              family: 'Mutual of Omaha',
              product: 'Living Promise',
            }),
            DECLINED(),
          ]
        : [
            result(),
            result({
              ...DECLINED(),
              eligible: true,
              outcome: 'LEVEL',
              best: line(),
              ineligibleReason: undefined,
              reasons: [],
            }),
          ];
    };
    render(<QuoteWorkspace variant="page" source="PAGE" initialDraft={READY} />);
    await screen.findAllByText(/Living Promise/);
    fireEvent.click(screen.getByRole('button', { name: 'Add Diabetes' }));
    const strip = await screen.findByText(/2 outcomes changed/);
    expect(strip.parentElement?.textContent).toMatch(/after: Added Diabetes/);
    const changes = strip.closest('div')!.parentElement!;
    expect(within(changes).getByText('No longer qualifies')).toBeTruthy();
    expect(within(changes).getByText('Graded')).toBeTruthy();
    // And on the row itself.
    expect(screen.getAllByText(/was Level/).length).toBeGreaterThan(0);
  });

  it('shows a localized error over the last good results', async () => {
    render(<QuoteWorkspace variant="page" source="PAGE" initialDraft={READY} />);
    await screen.findAllByText(/Living Promise/);
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(json({ error: { code: 'BOOM', message: 'The engine is down' } }, 500))
      )
    );
    fireEvent.change(screen.getByLabelText(/^Age/), { target: { value: '72' } });
    expect(await screen.findByText('Quotes could not refresh.')).toBeTruthy();
    expect(screen.getByText(/Showing results from/)).toBeTruthy();
    expect(screen.getAllByText(/Living Promise/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Retry/ })).toBeTruthy();
  });
});

// ─── The page ────────────────────────────────────────────────────────────────

describe('the Quote page', () => {
  const tabNames = () => screen.getAllByRole('tab').map(t => t.textContent);

  it('gives an agent four sections and no Insights or Settings', () => {
    auth.value = { hasFullAccess: false, isPlatformAdmin: false };
    render(<QuotePage />);
    expect(tabNames()).toEqual(['Quote', 'History', 'Underwriting', 'Carriers']);
  });

  it('gives an owner Insights after them, and Settings from the account menu', () => {
    auth.value = { hasFullAccess: true, isPlatformAdmin: false };
    render(<QuotePage />);
    expect(tabNames()).toEqual(['Quote', 'History', 'Underwriting', 'Carriers', 'Insights']);
  });

  it('still opens Settings at its URL for an owner', () => {
    auth.value = { hasFullAccess: true, isPlatformAdmin: false };
    window.history.replaceState(null, '', '/quote?tab=settings');
    render(<QuotePage />);
    expect(screen.getAllByRole('tab').some(t => t.getAttribute('aria-selected') === 'true')).toBe(
      false
    );
    expect(document.querySelector('[role="tabpanel"][data-state="active"]')).not.toBeNull();
    window.history.replaceState(null, '', '/');
  });

  it('opens an agent asking for Settings on the quoter instead', () => {
    window.history.replaceState(null, '', '/quote?tab=settings');
    render(<QuotePage />);
    expect(screen.getByRole('tab', { name: 'Quote' }).getAttribute('aria-selected')).toBe('true');
    window.history.replaceState(null, '', '/');
  });

  it('keeps each lookup at its own URL, under Underwriting', () => {
    window.history.replaceState(null, '', '/quote?tab=drugs');
    render(<QuotePage />);
    expect(screen.getByRole('tab', { name: 'Underwriting' }).getAttribute('aria-selected')).toBe(
      'true'
    );
    const lookups = screen.getByRole('radiogroup', { name: 'Underwriting lookup' });
    expect(
      within(lookups).getByRole('radio', { name: 'Drug lookup' }).getAttribute('aria-checked')
    ).toBe('true');
    window.history.replaceState(null, '', '/');
  });
});

// ─── The softphone ─────────────────────────────────────────────────────────────

const CALL = {
  callId: 'sip-call-1',
  direction: 'inbound',
  state: 'active',
  phoneNumber: '6155550142',
  callerName: 'Ruth Adams',
  duration: 42,
  isMuted: false,
  isOnHold: false,
  recordingEnabled: false,
  prospectData: { state: 'TN', dob: '04/02/1958', gender: 'F' },
};

function livePhone(patch: Record<string, unknown> = {}) {
  phone.value = {
    agentStatus: 'on-call',
    currentCall: CALL,
    callHistory: [],
    isPhonePanelOpen: true,
    phoneStatus: 'registered',
    phoneAttempts: 0,
    reconnectPhone: vi.fn(),
    closePhonePanel: vi.fn(),
    openPhonePanel: vi.fn(),
    setDialerNumber: vi.fn(),
    error: null,
    clearError: vi.fn(),
    userNumbers: [],
    selectedCallerId: null,
    setSelectedCallerId: vi.fn(),
    pendingDispositionCall: null,
    answerCall: vi.fn(),
    hangupCall: vi.fn(),
    toggleMute: vi.fn(),
    toggleHold: vi.fn(),
    sendDTMF: vi.fn(),
    mergeCalls: vi.fn(),
    hasHeldCalls: false,
    screenPopFields: [],
    setAgentStatus: vi.fn(),
    audioDevices: [],
    clearPendingDispositionCall: vi.fn(),
    ...patch,
  };
}

function Shell({ children }: { children?: React.ReactNode }) {
  return (
    <>
      <QuoteSessionProvider />
      {children}
      <QuoteDrawer />
    </>
  );
}

const drawerOpen = () => screen.queryByRole('dialog', { name: /^Quote — / });

describe('the softphone screen pop', () => {
  beforeEach(() => {
    settings = { ...settings, agency: { ...settings.agency, autoOpenOnCall: false } };
  });

  it('opens the quoter from the Quote control', async () => {
    livePhone();
    render(
      <Shell>
        <AgentPhonePanel />
      </Shell>
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Quote' }));
    await waitFor(() => expect(drawerOpen()).not.toBeNull());
  });

  it('opens it with Q on a call, and not while typing in a field', async () => {
    livePhone();
    render(
      <Shell>
        <AgentPhonePanel />
        <input aria-label="Notes" />
      </Shell>
    );
    await screen.findByRole('button', { name: 'Quote' });

    fireEvent.keyDown(screen.getByLabelText('Notes'), { key: 'q' });
    await new Promise(r => setTimeout(r, 50));
    expect(drawerOpen()).toBeNull();

    fireEvent.keyDown(window, { key: 'q' });
    await waitFor(() => expect(drawerOpen()).not.toBeNull());
  });
});

describe('opening the quoter when a call connects', () => {
  const connect = async () => {
    livePhone({ currentCall: { ...CALL, state: 'ringing' } });
    const view = render(<Shell />);
    await act(async () => {
      await new Promise(r => setTimeout(r, 20));
    });
    livePhone();
    view.rerender(<Shell />);
    return view;
  };

  beforeEach(() => {
    settings = { ...settings, agency: { ...settings.agency, autoOpenOnCall: true } };
  });

  it('opens once per connected call, prefilled from the lead', async () => {
    const view = await connect();
    await waitFor(() => expect(drawerOpen()).not.toBeNull());
    expect(drawerOpen()!.textContent).toContain('Ruth Adams');

    // Closed by the agent, it stays closed for this call.
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }));
    await waitFor(() => expect(drawerOpen()).toBeNull());
    view.rerender(<Shell />);
    await new Promise(r => setTimeout(r, 50));
    expect(drawerOpen()).toBeNull();
  });

  it('does not open on the call-center console', async () => {
    nav.pathname = '/call-center';
    await connect();
    await new Promise(r => setTimeout(r, 100));
    expect(drawerOpen()).toBeNull();
  });

  it('does not open for an ACA customer', async () => {
    customerVertical = 'ACA';
    await connect();
    await new Promise(r => setTimeout(r, 100));
    expect(drawerOpen()).toBeNull();
  });

  it('does not open when the agent has turned it off', async () => {
    settings = { ...settings, me: { autoOpenOnCall: false, carriers: null } };
    await connect();
    await new Promise(r => setTimeout(r, 100));
    expect(drawerOpen()).toBeNull();
  });
});

// ─── The disposition ─────────────────────────────────────────────────────────

const SELECTION: FexSelection = {
  fexQuoteId: '22222222-2222-4222-8222-222222222222',
  productId: 'foresters_planright',
  carrier: 'Foresters',
  product: 'PlanRight Whole Life',
  classCode: 'STANDARD',
  classLabel: 'Standard',
  benefit: 'LEVEL',
  face: 10000,
  premium: 120.5,
  mode: 'quarterly',
  application: {
    carrier: 'Foresters',
    product: 'PlanRight Whole Life',
    planType: 'LEVEL',
    annualizedPremium: 482,
  },
};

function SeedSelection({ callId }: { callId: string }) {
  const session = useQuoteSession();
  React.useEffect(() => {
    session?.setSelection(callId, SELECTION);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(session)]);
  return null;
}

describe('the disposition after a quoted call', () => {
  it('prefills the application from the quote and sends its fexQuoteId', async () => {
    livePhone({
      currentCall: null,
      pendingDispositionCall: {
        callId: 'sip-call-9',
        direction: 'inbound',
        phoneNumber: '6155550142',
        callerName: 'Ruth Adams',
        duration: 300,
        endTime: new Date(),
      },
    });
    render(
      <Shell>
        <SeedSelection callId="sip-call-9" />
        <GlobalDispositionModal />
      </Shell>
    );
    fireEvent.click(await screen.findByRole('radio', { name: /Application submitted/i }));

    // Foresters is not on the form's carrier list: "Other", with the name typed in.
    expect(valueOf(screen.getByLabelText(/^Carrier/))).toBe('Other');
    expect(valueOf(screen.getByLabelText('Other carrier name'))).toBe('Foresters');
    expect(valueOf(screen.getByLabelText(/^Coverage amount/))).toBe('10000');
    expect(valueOf(screen.getByLabelText(/^Annual premium/))).toBe('482');
    expect(
      screen.getByText(/From quote: Foresters PlanRight Whole Life · Standard · \$10,000/)
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save wrap-up' }));
    await waitFor(() =>
      expect(calls.find(c => c.path === '/api/v1/calls/disposition')?.body).toMatchObject({
        disposition: 'APPLICATION_SUBMITTED',
        application: {
          carrier: 'Foresters',
          faceAmount: 10000,
          modalPremium: 482,
          paymentMode: 'ANNUAL',
          product: 'PlanRight Whole Life',
          planType: 'LEVEL',
          fexQuoteId: SELECTION.fexQuoteId,
          firstName: 'Ruth',
          lastName: 'Adams',
        },
      })
    );
  });
});

describe('the call bar on the quoter', () => {
  beforeEach(() => {
    settings = { ...settings, agency: { ...settings.agency, autoOpenOnCall: false } };
  });

  async function openQuoter() {
    render(
      <Shell>
        <AgentPhonePanel />
      </Shell>
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Quote' }));
    await waitFor(() => expect(drawerOpen()).not.toBeNull());
    return within(within(drawerOpen()!).getByRole('region', { name: 'Live call' }));
  }

  it('adds a third party from inside the quoter', async () => {
    const addThirdParty = vi.fn();
    livePhone({ addThirdParty });
    const bar = await openQuoter();

    fireEvent.click(bar.getByRole('button', { name: 'Add caller' }));
    const input = bar.getByLabelText('Phone number to add');
    fireEvent.change(input, { target: { value: '123' } });
    fireEvent.click(bar.getByRole('button', { name: 'Call' }));
    expect(addThirdParty).not.toHaveBeenCalled();
    expect(bar.getByText('Enter a 10-digit US phone number.')).toBeTruthy();

    fireEvent.change(input, { target: { value: '(615) 555-0199' } });
    fireEvent.click(bar.getByRole('button', { name: 'Call' }));
    expect(addThirdParty).toHaveBeenCalledWith('6155550199');
  });

  it('offers Merge calls once a third party is being added', async () => {
    const mergeCalls = vi.fn();
    livePhone({ hasHeldCalls: true, mergeCalls });
    const bar = await openQuoter();

    expect(bar.queryByRole('button', { name: 'Add caller' })).toBeNull();
    fireEvent.click(bar.getByRole('button', { name: 'Merge calls' }));
    expect(mergeCalls).toHaveBeenCalled();
  });
});

describe('the disposition over an open quoter', () => {
  it('closes the quoter so the wrap-up can be answered', async () => {
    settings = { ...settings, agency: { ...settings.agency, autoOpenOnCall: false } };
    livePhone();
    const view = render(
      <Shell>
        <AgentPhonePanel />
        <GlobalDispositionModal />
      </Shell>
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Quote' }));
    await waitFor(() => expect(drawerOpen()).not.toBeNull());

    livePhone({
      currentCall: null,
      pendingDispositionCall: {
        callId: CALL.callId,
        direction: 'inbound',
        phoneNumber: CALL.phoneNumber,
        callerName: CALL.callerName,
        duration: 60,
        endTime: new Date(),
      },
    });
    view.rerender(
      <Shell>
        <AgentPhonePanel />
        <GlobalDispositionModal />
      </Shell>
    );

    await waitFor(() => expect(drawerOpen()).toBeNull());
    expect(await screen.findByRole('radio', { name: /Application submitted/i })).toBeTruthy();
  });
});

describe('ApplicationLogForm from a quote', () => {
  it('"Not this one" clears the quote and keeps the names', async () => {
    const onChange = vi.fn<[ApplicationLogPayload | null], void>();
    render(
      <ApplicationLogForm
        prefill={{
          carrier: 'Mutual of Omaha',
          faceAmount: 10000,
          premium: '494.16',
          product: 'Living Promise',
          planType: 'LEVEL',
          fexQuoteId: SELECTION.fexQuoteId,
          quoteClass: 'Level',
          firstName: 'Ruth',
          lastName: 'Adams',
        }}
        onChange={onChange}
      />
    );
    await waitFor(() =>
      expect(onChange.mock.calls.at(-1)![0]).toMatchObject({
        carrier: 'Mutual of Omaha',
        fexQuoteId: SELECTION.fexQuoteId,
        product: 'Living Promise',
        planType: 'LEVEL',
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Not this one' }));
    expect(valueOf(screen.getByLabelText(/^Carrier/))).toBe('');
    expect(valueOf(screen.getByLabelText(/^Coverage amount/))).toBe('');
    expect(valueOf(screen.getByLabelText(/^Annual premium/))).toBe('');
    expect(valueOf(screen.getByLabelText(/^First name/))).toBe('Ruth');
    expect(screen.queryByText(/From quote:/)).toBeNull();

    // Re-entered by hand: no quote fields ride along.
    fireEvent.change(screen.getByLabelText(/^Carrier/), { target: { value: 'Aflac' } });
    fireEvent.change(screen.getByLabelText(/^Coverage amount/), { target: { value: '5000' } });
    fireEvent.change(screen.getByLabelText(/^Annual premium/), { target: { value: '300' } });
    const payload = onChange.mock.calls.at(-1)![0]!;
    expect(payload.carrier).toBe('Aflac');
    expect(payload.fexQuoteId).toBeUndefined();
    expect(payload.product).toBeUndefined();
  });

  it('drops the quote fields when the carrier is changed away from the quoted one', () => {
    const onChange = vi.fn<[ApplicationLogPayload | null], void>();
    render(
      <ApplicationLogForm
        prefill={{
          carrier: 'Mutual of Omaha',
          faceAmount: 10000,
          premium: '494.16',
          product: 'Living Promise',
          fexQuoteId: SELECTION.fexQuoteId,
          firstName: 'Ruth',
          lastName: 'Adams',
        }}
        onChange={onChange}
      />
    );
    fireEvent.change(screen.getByLabelText(/^Carrier/), { target: { value: 'Aflac' } });
    const payload = onChange.mock.calls.at(-1)![0]!;
    expect(payload.carrier).toBe('Aflac');
    expect(payload.fexQuoteId).toBeUndefined();
  });
});

// ─── The console ──────────────────────────────────────────────────────────────

describe('the call-center console', () => {
  it('has a Quote tab beside the others', () => {
    const set = vi.fn();
    render(<WorkspaceTabs activeCallView="script" setActiveCallView={set} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map(t => t.textContent)).toEqual([
      'Command Script',
      'Target Profile',
      'Captured Info',
      'Quote',
    ]);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: 'Quote' }));
    expect(set).toHaveBeenCalledWith('quote');
  });

  it('Use this quote fills the application with carrier, face and the exact annual premium', () => {
    const monthly = applicationPrefillFrom({
      first_name: 'Ruth',
      ...quoteToCallData({
        ...SELECTION,
        mode: 'monthly',
        premium: 41.18,
        application: {
          ...SELECTION.application,
          carrier: 'Mutual of Omaha',
          annualizedPremium: 494.16,
        },
      }),
    });
    expect(monthly).toMatchObject({
      carrier: 'Mutual of Omaha',
      faceAmount: '10000',
      premium: '494.16',
      product: 'PlanRight Whole Life',
      planType: 'LEVEL',
      fexQuoteId: SELECTION.fexQuoteId,
      firstName: 'Ruth',
    });

    // Quarterly: $120.50 x 4 = $482.00, exactly -- not $40.17 x 12 = $482.04.
    const quarterly = applicationPrefillFrom(quoteToCallData(SELECTION));
    expect(quarterly.premium).toBe('482.00');
    expect(quarterly.carrier).toBe('Foresters');
  });

  it('still converts a monthly premium from the legacy calculator', () => {
    expect(applicationPrefillFrom({ selectedPremium: 52.4 }).premium).toBe('628.80');
  });
});
