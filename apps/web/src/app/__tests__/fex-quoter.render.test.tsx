/**
 * The final expense quoter, rendered: live quoting, the page's tabs, the
 * softphone screen pop, the disposition it prefills, and the console's tab.
 *
 * The API is a fetch stub. What is asserted is what the screen does with it:
 * one request per burst of edits, old results kept on screen while the next
 * quote is in flight, a medication's use answered from the banner, a used
 * quote posted once and handed on, and the application prefilled from it.
 */
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

const line = (patch: Record<string, unknown> = {}) => ({
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
});

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
let settings = {
  agency: {
    appointedOnly: false,
    appointedProductIds: [],
    defaultFace: 10000,
    defaultMode: 'monthly',
    showPriceOnly: true,
    autoOpenOnCall: true,
  },
  me: { autoOpenOnCall: null as boolean | null },
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
  customerVertical = 'FE';
  settings = { ...settings, me: { autoOpenOnCall: null } };
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

describe('QuoteWorkspace', () => {
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

  it('keeps the last results on screen, marked stale, while the next quote runs', async () => {
    render(<QuoteWorkspace variant="page" source="PAGE" initialDraft={READY} />);
    await screen.findAllByText(/Living Promise/);

    let release!: () => void;
    holdQuote = new Promise(r => (release = r));
    fireEvent.change(screen.getByLabelText(/^Age/), { target: { value: '71' } });

    await waitFor(() => expect(quotesPosted().length).toBe(2));
    expect(screen.getAllByText(/Living Promise/).length).toBeGreaterThan(0);
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();

    await act(async () => {
      release();
      await holdQuote;
    });
    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull());
  });

  it('asks what a medication is for, and re-quotes with the answer', async () => {
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

    const banner = await screen.findByText('Confirm what these are prescribed for');
    const chip = await within(banner.closest('[role="alert"]') ?? document.body).findByRole(
      'button',
      {
        name: 'Neuropathy',
      }
    );
    fireEvent.click(chip);

    await waitFor(() => expect(quotesPosted().length).toBe(2));
    expect(quotesPosted()[1].body).toMatchObject({
      applicant: { meds: [{ drugId: 'gabapentin', indication: 'NEUROPATHY' }] },
    });
    await waitFor(() =>
      expect(screen.queryByText('Confirm what these are prescribed for')).toBeNull()
    );
  });

  it('keeps Medications as its own section, each with its use asked beneath it', async () => {
    quoteResults = () => [
      result({
        needsIndication: [
          { drugId: 'gabapentin', name: 'gabapentin', options: ['NEUROPATHY', 'SEIZURES'] },
        ],
      }),
    ];
    const draft: QuoteDraft = {
      ...READY,
      meds: [{ key: 'm1', drugId: 'gabapentin', name: 'gabapentin', lastTakenMonthsAgo: 0 }],
    };
    render(<QuoteWorkspace variant="page" source="PAGE" initialDraft={draft} />);
    // Four sections, Health and Medications each with their own search.
    for (const name of ['Applicant', 'Coverage', 'Health', 'Medications'])
      expect(screen.getByRole('heading', { name })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Add a condition' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Add a medication' })).toBeTruthy();
    // The medication is listed, and its use is asked right under it.
    const meds = screen.getByRole('heading', { name: 'Medications' }).closest('section')!;
    expect(within(meds).getByText('gabapentin')).toBeTruthy();
    expect(await within(meds).findByLabelText('Prescribed for')).toBeTruthy();
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
    // The first row is the best one, marked as such, with the carrier's logo.
    const [use] = await screen.findAllByRole('button', { name: 'Use Quote' });
    const row = use.closest('li')!;
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
    // The selected-quote bar, and the row's own button turned to "Selected".
    const bar = await screen.findByRole('status');
    expect(within(bar).getByText('Selected')).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Selected' })).toBeTruthy();
  });

  it('asks for the minimum before quoting anything', async () => {
    render(<QuoteWorkspace variant="page" source="PAGE" initialDraft={emptyDraft()} />);
    expect(
      await screen.findByText('Enter state, sex, age and coverage to see every carrier.')
    ).toBeTruthy();
    await new Promise(r => setTimeout(r, 350));
    expect(quotesPosted()).toHaveLength(0);
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

// ─── The softphone ───────────────────────────────────────────────────────────

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
    settings = { ...settings, me: { autoOpenOnCall: false } };
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

// ─── The console ─────────────────────────────────────────────────────────────

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
