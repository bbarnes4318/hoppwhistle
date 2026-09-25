'use client';

import { Check, ChevronRight, Loader2, Lock } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/domain';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Onboarding an agency: nothing to enrolled, in the runbook's order.
 *
 * ── There is no self-serve path ──────────────────────────────────────────────
 *
 * Every agency is onboarded here, by NetEnroll staff, after a conversation and
 * a signed agreement. There is no public checkout and no signup that creates an
 * account: registration requires an activation grant, and the only grant for an
 * agency principal is the one step (d) mints.
 *
 * ── The steps refuse to skip ahead ───────────────────────────────────────────
 *
 * Each step shows its state — done, ready, or blocked because an earlier one is
 * not done — and the server refuses one asked for out of order. The state is
 * DERIVED from the rows each step wrote, so an agency half-onboarded last week
 * opens on the right step rather than on wherever a browser thought it was.
 *
 * ── The maximum daily debit ──────────────────────────────────────────────────
 *
 * Shown as (daily block + ceiling quantity) × effective rate, where the
 * effective rate is the opening rate plus the agreed offset. Stored as an
 * explicit figure, because it is a contractual commitment on the Insertion
 * Order rather than something recomputed at charge time — a cap that moved when
 * the rate moved could never be breached, which is not a cap.
 *
 * ── The rate offset is a price, not a fee ────────────────────────────────────
 *
 * Dollars added to whatever the curve returns, at every point on it. There is
 * no fee field on this form and no fee line on anything it produces.
 */

type StepId = 'TENANT' | 'TERMS' | 'PAYMENT_METHOD' | 'OWNER' | 'ENROL';

interface StepState {
  id: StepId;
  state: 'COMPLETE' | 'READY' | 'BLOCKED';
  blockers: string[];
  summary: Record<string, unknown> | null;
}

interface OnboardingState {
  tenantId: string;
  name: string;
  steps: StepState[];
  complete: boolean;
}

const STEP_TITLES: Record<StepId, { title: string; blurb: string }> = {
  TENANT: {
    title: 'Agency',
    blurb: 'Legal name, state, contact, licensed agents, and the days and hours it takes calls.',
  },
  TERMS: {
    title: 'Terms',
    blurb:
      'The opening rate, the rate offset, the opening block, the daily application target, the ceiling percentage and the maximum daily debit.',
  },
  PAYMENT_METHOD: {
    title: 'Payment method',
    blurb:
      'ACH mandate or card. The agency completes it in its own browser; nothing here records an account number.',
  },
  OWNER: {
    title: 'Owner',
    blurb: 'One single-use activation link for the agency principal, bound to their email address.',
  },
  ENROL: {
    title: 'Enrol',
    blurb:
      'The prerequisite check, then billing applies from the next call offered. Charging stays off until it is turned on separately.',
  },
};

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

function dollars(value: number | null | undefined): string {
  return value === null || value === undefined
    ? '—'
    : `$${value.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
}

export default function OnboardingPage(): JSX.Element {
  const [agencies, setAgencies] = useState<OnboardingState[]>([]);
  const [selected, setSelected] = useState<OnboardingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** Shown exactly once, on the response that created it. Never fetched back. */
  const [activationLink, setActivationLink] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const response = await apiClient.get<Envelope<OnboardingState[]>>(
      '/api/v1/platform/onboarding/agencies'
    );
    setError(response.error ? response.error.message : null);
    const rows = payload(response);
    setAgencies(Array.isArray(rows) ? rows : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Re-read one agency's state after a step, so the screen shows the truth. */
  const refreshSelected = useCallback(
    async (tenantId: string) => {
      const response = await apiClient.get<Envelope<OnboardingState>>(
        `/api/v1/platform/onboarding/agencies/${tenantId}`
      );
      const state = payload(response);
      if (state) setSelected(state);
      await load();
    },
    [load]
  );

  if (loading) {
    return (
      <div className="page-canvas">
        <div className="flex items-center justify-center py-12 text-ink-3">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading onboarding
        </div>
      </div>
    );
  }

  return (
    <div className="page-canvas">
      <PageHeader description="Internal. Every agency is onboarded by NetEnroll after a signed agreement." />

      {error && <p className="text-sm text-dropped-ink">{error}</p>}
      {notice && <p className="text-sm text-ink-3">{notice}</p>}

      {activationLink && (
        <Panel className="border-live bg-live-tint">
          <PanelBody>
            <p className="text-sm font-medium">The owner&rsquo;s activation token</p>
            <p className="mt-1 text-[11px] text-ink-3">
              Shown once. It is stored only as a hash and cannot be read back — if it is lost, issue
              a new one. Send it to the address it was issued for; it works for no other.
            </p>
            <code className="mt-2 block break-all rounded-control bg-sunken p-2 text-xs">
              {activationLink}
            </code>
          </PanelBody>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-1">
          <PanelHeader>
            <PanelTitle>Agencies</PanelTitle>
          </PanelHeader>
          <PanelBody className="space-y-1 p-2 min-[1440px]:p-2">
            {agencies.length === 0 && <p className="p-2 text-sm text-ink-3">No agencies yet.</p>}
            {agencies.map(agency => (
              <button
                key={agency.tenantId}
                type="button"
                onClick={() => {
                  setSelected(agency);
                  setActivationLink(null);
                  setNotice(null);
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-sm hover:bg-sunken',
                  selected?.tenantId === agency.tenantId && 'bg-sunken'
                )}
              >
                <span className="flex-1 truncate">{agency.name}</span>
                <Badge variant={agency.complete ? 'secondary' : 'outline'} className="t-meta">
                  {agency.complete
                    ? 'enrolled'
                    : `step ${agency.steps.findIndex(s => s.state !== 'COMPLETE') + 1}/5`}
                </Badge>
              </button>
            ))}
            <div className="border-t border-rule pt-2">
              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                  setActivationLink(null);
                  setNotice(null);
                }}
                className="flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-sm hover:bg-sunken"
              >
                <ChevronRight className="h-3.5 w-3.5" />
                New agency
              </button>
            </div>
          </PanelBody>
        </Panel>

        <div className="space-y-4 lg:col-span-2">
          {selected === null ? (
            <NewAgencyForm
              busy={busy}
              onSubmit={async body => {
                setBusy(true);
                setError(null);
                const response = await apiClient.post<Envelope<OnboardingState>>(
                  '/api/v1/platform/onboarding/agencies',
                  body
                );
                setBusy(false);
                if (response.error) {
                  setError(response.error.message);
                  return;
                }
                const state = payload(response);
                if (state) setSelected(state);
                setNotice('Agency recorded. Next: its terms.');
                await load();
              }}
            />
          ) : (
            <AgencySteps
              state={selected}
              busy={busy}
              setBusy={setBusy}
              setError={setError}
              setNotice={setNotice}
              setActivationLink={setActivationLink}
              refresh={() => refreshSelected(selected.tenantId)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** Step a. Every field is required: a half-recorded agency is one step b guesses from. */
function NewAgencyForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
}): JSX.Element {
  const [form, setForm] = useState({
    name: '',
    legalName: '',
    state: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    licensedAgentCount: '',
    deliveryStartTime: '09:00',
    deliveryEndTime: '18:00',
  });
  const [days, setDays] = useState<string[]>(['MON', 'TUE', 'WED', 'THU', 'FRI']);

  function field(key: keyof typeof form, label: string, props: Record<string, unknown> = {}) {
    return (
      <div>
        <label className="mb-1 block text-[11px] text-ink-3" htmlFor={key}>
          {label}
        </label>
        <Input
          id={key}
          value={form[key]}
          onChange={event => setForm({ ...form, [key]: event.target.value })}
          {...props}
        />
      </div>
    );
  }

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>1. Agency</PanelTitle>
      </PanelHeader>
      <PanelBody className="space-y-3">
        <p className="text-[11px] text-ink-3">{STEP_TITLES.TENANT.blurb}</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {field('name', 'Display name')}
          {field('legalName', 'Legal name on the agreement')}
          {field('state', 'Licensed state (two letters)', { maxLength: 2 })}
          {field('licensedAgentCount', 'Licensed agents', { type: 'number', min: 1 })}
          {field('contactName', 'Contact name')}
          {field('contactEmail', 'Contact email', { type: 'email' })}
          {field('contactPhone', 'Contact phone')}
          <div />
          {field('deliveryStartTime', 'Delivery hours from', { type: 'time' })}
          {field('deliveryEndTime', 'Delivery hours to', { type: 'time' })}
        </div>

        <div>
          <p className="mb-1 text-[11px] text-ink-3">Delivery days</p>
          <div className="flex flex-wrap gap-2">
            {DAYS.map(day => (
              <label key={day} className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={days.includes(day)}
                  onChange={event =>
                    setDays(current =>
                      event.target.checked
                        ? [...current, day]
                        : current.filter(existing => existing !== day)
                    )
                  }
                />
                {day}
              </label>
            ))}
          </div>
        </div>

        <Button
          disabled={busy}
          onClick={() =>
            void onSubmit({
              ...form,
              state: form.state.toUpperCase(),
              licensedAgentCount: Number(form.licensedAgentCount),
              deliveryDays: days,
            })
          }
        >
          {busy ? 'Recording…' : 'Record the agency'}
        </Button>
      </PanelBody>
    </Panel>
  );
}

/** Steps b–e for one agency, each showing its state and refusing to skip ahead. */
function AgencySteps({
  state,
  busy,
  setBusy,
  setError,
  setNotice,
  setActivationLink,
  refresh,
}: {
  state: OnboardingState;
  busy: boolean;
  setBusy: (value: boolean) => void;
  setError: (value: string | null) => void;
  setNotice: (value: string | null) => void;
  setActivationLink: (value: string | null) => void;
  refresh: () => Promise<void>;
}): JSX.Element {
  const [terms, setTerms] = useState({
    openingRate: '',
    rateOffset: '0',
    openingBlockApplications: '',
    dailyBlockApplications: '',
    ceilingPct: '50',
    maxDailyDebit: '',
  });
  const [paymentMethod, setPaymentMethod] = useState('ACH');
  const [ownerEmail, setOwnerEmail] = useState('');
  /**
   * Who moves this agency's money.
   *
   * MELIO, matching the column default, so the control shows what the agency
   * will actually be on if nobody touches it. A screen defaulting to something
   * the database does not is a screen that lies about the state it is about to
   * create.
   */
  const [paymentProvider, setPaymentProvider] = useState('MELIO');

  const stepById = (id: StepId): StepState =>
    state.steps.find(step => step.id === id) ?? {
      id,
      state: 'BLOCKED',
      blockers: [],
      summary: null,
    };

  /*
   * The maximum daily debit, computed live from what is typed, exactly as the
   * server computes it: (daily block + floor(block × ceiling%)) × (rate +
   * offset). Shown so the operator can check the figure they are about to store
   * against the one on the Insertion Order — the stored value is whatever they
   * enter, and this is not silently substituted for it.
   */
  const block = Number(terms.dailyBlockApplications) || 0;
  const ceilingPct = Number(terms.ceilingPct) || 0;
  const rate = Number(terms.openingRate) || 0;
  const offset = Number(terms.rateOffset) || 0;
  const ceilingQuantity = block > 0 && ceilingPct > 0 ? Math.floor((block * ceilingPct) / 100) : 0;
  const effectiveRate = Number((rate + offset).toFixed(2));
  const computedMax = Number(((block + ceilingQuantity) * effectiveRate).toFixed(2));

  async function call(
    method: 'post' | 'put',
    url: string,
    body: Record<string, unknown>,
    onDone?: (data: unknown) => void
  ): Promise<void> {
    setBusy(true);
    setError(null);
    const response =
      method === 'post'
        ? await apiClient.post<Envelope<unknown>>(url, body)
        : await apiClient.put<Envelope<unknown>>(url, body);
    setBusy(false);
    if (response.error) {
      setError(response.error.message);
      return;
    }
    onDone?.(payload(response));
    await refresh();
  }

  function StepShell({
    id,
    index,
    children,
  }: {
    id: StepId;
    index: number;
    children?: React.ReactNode;
  }): JSX.Element {
    const step = stepById(id);
    return (
      <Panel className={cn(step.state === 'BLOCKED' && 'opacity-60')}>
        <PanelHeader>
          <PanelTitle className="flex items-center gap-2">
            {step.state === 'COMPLETE' ? (
              <Check className="h-4 w-4 text-live-ink" />
            ) : step.state === 'BLOCKED' ? (
              <Lock className="h-4 w-4 text-ink-3" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            {index}. {STEP_TITLES[id].title}
            <Badge
              variant={
                step.state === 'COMPLETE'
                  ? 'secondary'
                  : step.state === 'READY'
                    ? 'outline'
                    : 'outline'
              }
              className="t-meta"
            >
              {step.state.toLowerCase()}
            </Badge>
          </PanelTitle>
        </PanelHeader>
        <PanelBody className="space-y-3">
          <p className="text-[11px] text-ink-3">{STEP_TITLES[id].blurb}</p>
          {/*
            Every blocker at once, never one per attempt. An operator working
            down this screen should not discover the requirements one rejected
            submission at a time.
          */}
          {step.blockers.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-ringing-ink">
              {step.blockers.map(blocker => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          )}
          {step.state !== 'BLOCKED' && children}
        </PanelBody>
      </Panel>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium">{state.name}</p>

      <StepShell id="TENANT" index={1}>
        <p className="text-[11px] text-ink-3">
          {String(stepById('TENANT').summary?.legalName ?? '')} ·{' '}
          {String(stepById('TENANT').summary?.state ?? '')} ·{' '}
          {String(stepById('TENANT').summary?.licensedAgentCount ?? '')} licensed agents
        </p>
      </StepShell>

      <StepShell id="TERMS" index={2}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="mb-1 block text-[11px] text-ink-3">Opening rate</label>
            <Input
              type="number"
              value={terms.openingRate}
              onChange={e => setTerms({ ...terms, openingRate: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-ink-3">Rate offset</label>
            <Input
              type="number"
              value={terms.rateOffset}
              onChange={e => setTerms({ ...terms, rateOffset: e.target.value })}
            />
            {/*
              Said here rather than left to be inferred: this is a price, not a
              fee. It is added to whatever the curve returns, at every point on
              the curve, and nothing is itemised separately anywhere.
            */}
            <p className="mt-1 t-meta text-ink-3">
              Dollars added to the curve rate at every point on the curve. Part of the price.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-ink-3">Opening block</label>
            <Input
              type="number"
              value={terms.openingBlockApplications}
              onChange={e => setTerms({ ...terms, openingBlockApplications: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-ink-3">Daily application target</label>
            <Input
              type="number"
              value={terms.dailyBlockApplications}
              onChange={e => setTerms({ ...terms, dailyBlockApplications: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-ink-3">Overrun ceiling %</label>
            <Input
              type="number"
              value={terms.ceilingPct}
              onChange={e => setTerms({ ...terms, ceilingPct: e.target.value })}
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-ink-3">Maximum daily debit</label>
            <Input
              type="number"
              placeholder={computedMax > 0 ? String(computedMax) : ''}
              value={terms.maxDailyDebit}
              onChange={e => setTerms({ ...terms, maxDailyDebit: e.target.value })}
            />
          </div>
        </div>

        <p className="text-[11px] text-ink-3">
          ({block} block + {ceilingQuantity} ceiling) × {dollars(effectiveRate)} ={' '}
          <span className="font-medium">{dollars(computedMax)}</span>. Stored as an explicit figure
          — it is a commitment on the Insertion Order, not something recomputed when a charge is
          placed. Leave the field blank to store this computation.
        </p>

        <Button
          disabled={busy}
          onClick={() =>
            void call('put', `/api/v1/platform/onboarding/agencies/${state.tenantId}/terms`, {
              openingRate: Number(terms.openingRate),
              rateOffset: Number(terms.rateOffset),
              openingBlockApplications: Number(terms.openingBlockApplications),
              dailyBlockApplications: Number(terms.dailyBlockApplications),
              ceilingPct: Number(terms.ceilingPct),
              ...(terms.maxDailyDebit ? { maxDailyDebit: Number(terms.maxDailyDebit) } : {}),
            })
          }
        >
          {busy ? 'Recording…' : 'Record the terms'}
        </Button>
      </StepShell>

      <StepShell id="PAYMENT_METHOD" index={3}>
        <div className="flex items-end gap-3">
          <div>
            <label className="mb-1 block text-[11px] text-ink-3">Payment method</label>
            <select
              value={paymentMethod}
              onChange={e => setPaymentMethod(e.target.value)}
              className="h-9 rounded-control border border-rule bg-paper px-2 text-sm"
            >
              <option value="ACH">ACH mandate</option>
              <option value="CARD">Card</option>
            </select>
          </div>
          <Button
            disabled={busy}
            onClick={() =>
              void call(
                'put',
                `/api/v1/platform/onboarding/agencies/${state.tenantId}/payment-method`,
                { paymentMethod }
              )
            }
          >
            Record
          </Button>
        </div>

        {/*
          Who moves the money, as opposed to what is debited above.

          Separate control and separate request, because they are separate
          decisions with separate consequences: the method decides the Overrun
          ceiling (a card is reversible whoever processes it), the provider
          decides whether this platform debits anybody at all.
        */}
        <div className="flex items-end gap-3 border-t border-rule pt-3">
          <div>
            <label className="mb-1 block text-[11px] text-ink-3">Payment provider</label>
            <select
              value={paymentProvider}
              onChange={e => setPaymentProvider(e.target.value)}
              className="h-9 rounded-control border border-rule bg-paper px-2 text-sm"
            >
              <option value="MELIO">Melio — invoiced (default)</option>
              <option value="STRIPE">Stripe — debited here</option>
              <option value="OFFLINE">Offline — invoiced another way</option>
            </select>
          </div>
          <Button
            disabled={busy}
            variant="outline"
            onClick={() =>
              void call(
                'put',
                `/api/v1/platform/delivery/agencies/${state.tenantId}/payment-provider`,
                { paymentProvider }
              )
            }
          >
            Record
          </Button>
        </div>
        <p className="text-[11px] text-ink-3">
          <strong>Melio</strong> and <strong>offline</strong> agencies are never debited by this
          platform &mdash; Melio cannot pull a bank debit on our schedule, so both are invoiced.
          Their calls, credits, rate and Overrun ceiling work exactly as any other agency&rsquo;s;
          each night&rsquo;s settlement is computed in full and recorded as payable, for you to
          raise the invoice from. Their opening block is recorded with the reference the money
          arrived against, and they need no mandate below. Pick <strong>Stripe</strong> only for an
          agency this platform should debit directly.
        </p>
        {/*
          Stated because it is the question this step raises: choosing CARD does
          not price the agency differently by itself. The offset above is a
          separate, agreed number.
        */}
        <p className="text-[11px] text-ink-3">
          Card-paying agencies get a lower overrun ceiling — 25% above the daily block, and it does
          not rise with settlement history, because a card payment can be taken back. It does not
          change the price by itself: that is the rate offset above, and it is agreed, not derived.
        </p>
      </StepShell>

      <StepShell id="OWNER" index={4}>
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="mb-1 block text-[11px] text-ink-3">Owner email address</label>
            <Input
              type="email"
              value={ownerEmail}
              onChange={e => setOwnerEmail(e.target.value)}
              placeholder="principal@agency.example"
            />
          </div>
          <Button
            disabled={busy}
            onClick={() =>
              void call(
                'post',
                `/api/v1/platform/onboarding/agencies/${state.tenantId}/owner`,
                { email: ownerEmail },
                data => {
                  const token = (data as { activationToken?: string } | null)?.activationToken;
                  if (token) setActivationLink(token);
                }
              )
            }
          >
            Issue activation link
          </Button>
        </div>
        <p className="text-[11px] text-ink-3">
          Single-use, expires in seven days, and works only for the address it was issued for. The
          owner can then invite their own agents from inside the agency — agents only, and only into
          their own agency.
        </p>
      </StepShell>

      <StepShell id="ENROL" index={5}>
        <Button
          disabled={busy}
          onClick={() =>
            void call(
              'post',
              `/api/v1/platform/delivery/agencies/${state.tenantId}/enrol`,
              { note: 'Onboarding screen' },
              () => setNotice('Enrolled. Charging stays off until it is turned on separately.')
            )
          }
        >
          {busy ? 'Enrolling…' : 'Enrol'}
        </Button>
        <p className="text-[11px] text-ink-3">
          Takes effect on the next call offered. Charging is a second switch and stays off, so the
          first settlements compute in full and take no money.
        </p>
      </StepShell>
    </div>
  );
}
