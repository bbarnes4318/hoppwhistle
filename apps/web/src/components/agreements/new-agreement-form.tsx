'use client';

import { ArrowLeft, Check, Copy, Eye, Loader2, Send, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { SignatureScript } from '@/components/agreements/signature-script';
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/domain';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  DAYS,
  DAY_SHORT,
  EMAIL_PATTERN,
  VERTICALS,
  VERTICAL_NAMES,
  authorityStatement,
  etTodayIso,
  type AgreementSurface,
  type Vertical,
} from '@/lib/agreements';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * The APIs `surface.apiBase` can name: NetEnroll's suite, or the session's
 * sales workspace. Listed here so a reader (and api-paths.test.ts) can see
 * every request this screen makes reaches a served prefix.
 */
export const SURFACE_API_BASES = [
  { apiBase: '/api/v1/platform/agreements' },
  { apiBase: '/api/v1/sales/agreements' },
] as const;

/**
 * A new set of agreements: the MSA (unless the agency already has one) and the
 * CPA and/or CPL Agreement, signed for NetEnroll at send and emailed to the
 * agency, which enters its own details (as a business or as an individual
 * licensed agent) before reviewing and signing.
 *
 * "Sign and send" stays disabled until the documents have been previewed for
 * exactly the form as it stands -- change anything and the preview is needed
 * again -- and until the authority box is ticked. What is previewed is what is
 * frozen and sent.
 */

interface AgencyOption {
  id: string;
  name: string;
  legalName: string;
  state: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  deliveryDays: string[];
  deliveryStartTime: string;
  deliveryEndTime: string;
  executedMsa: { id: string; reference: string; effectiveDate: string } | null;
}

interface Schedule {
  deliveryDays: string[];
  deliveryStart: string;
  deliveryEnd: string;
  firstDeliveryDay: string;
}

type CpaRow = { selected: boolean; rate: string; dailyBlock: string };
type CplRow = { selected: boolean; rate: string; bufferSeconds: string; dailyBlock: string };

const DEFAULT_SCHEDULE: Schedule = {
  deliveryDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
  deliveryStart: '10:00',
  deliveryEnd: '19:00',
  firstDeliveryDay: '',
};

/** A Sales CRM prospect the form was opened from (`?prospectId=`). */
interface ProspectSeed {
  id: string;
  displayName: string;
  companyName: string | null;
  primaryContactName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  agreements: Array<{
    id: string;
    reference: string;
    status: string;
    includesMsa: boolean;
    effectiveDate: string | null;
  }>;
}

function num(value: string): number | null {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function Field({
  id,
  label,
  children,
  hint,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
  hint?: string;
}): JSX.Element {
  return (
    <div>
      <label className="mb-1 block text-[11px] text-ink-3" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-ink-3">{hint}</p>}
    </div>
  );
}

function EmailChips({
  values,
  onChange,
  max,
  id,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  max: number;
  id: string;
}): JSX.Element {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  function add(): void {
    const value = draft.trim().toLowerCase().replace(/,$/, '');
    if (!value) return;
    if (!EMAIL_PATTERN.test(value)) {
      setError(`${value} is not an email address.`);
      return;
    }
    if (values.length >= max) {
      setError(`At most ${max} copy recipients.`);
      return;
    }
    setError(null);
    onChange(Array.from(new Set([...values, value])));
    setDraft('');
  }
  return (
    <div>
      {values.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {values.map(email => (
            <span
              key={email}
              className="inline-flex items-center gap-1 rounded-full bg-sunken px-2.5 py-1 text-xs"
            >
              {email}
              <button
                type="button"
                aria-label={`Remove ${email}`}
                onClick={() => onChange(values.filter(v => v !== email))}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Input
          id={id}
          type="email"
          value={draft}
          placeholder="name@agency.com"
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button type="button" variant="outline" onClick={add}>
          Add
        </Button>
      </div>
      {error && <p className="mt-1 text-[11px] text-dropped-ink">{error}</p>}
    </div>
  );
}

function ScheduleFields({
  prefix,
  value,
  onChange,
}: {
  prefix: string;
  value: Schedule;
  onChange: (value: Schedule) => void;
}): JSX.Element {
  return (
    <div className="space-y-3">
      <div>
        <p className="mb-1 text-[11px] text-ink-3">Delivery days</p>
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map(day => {
            const on = value.deliveryDays.includes(day);
            return (
              <button
                key={day}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  onChange({
                    ...value,
                    deliveryDays: on
                      ? value.deliveryDays.filter(d => d !== day)
                      : [...value.deliveryDays, day],
                  })
                }
                className={cn(
                  'rounded-full border px-3 py-1 text-xs',
                  on
                    ? 'border-brand-strong bg-brand-tint text-brand-ink'
                    : 'border-rule-strong bg-surface text-ink-2'
                )}
              >
                {DAY_SHORT[day]}
              </button>
            );
          })}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Field id={`${prefix}-start`} label="Delivery hours from (Eastern Time)">
          <Input
            id={`${prefix}-start`}
            type="time"
            value={value.deliveryStart}
            onChange={e => onChange({ ...value, deliveryStart: e.target.value })}
          />
        </Field>
        <Field id={`${prefix}-end`} label="to (Eastern Time)">
          <Input
            id={`${prefix}-end`}
            type="time"
            value={value.deliveryEnd}
            onChange={e => onChange({ ...value, deliveryEnd: e.target.value })}
          />
        </Field>
        <Field
          id={`${prefix}-first`}
          label="First delivery day (optional)"
          hint="Leave empty to start on the first Delivery Day after payment clears"
        >
          <Input
            id={`${prefix}-first`}
            type="date"
            value={value.firstDeliveryDay}
            onChange={e => onChange({ ...value, firstDeliveryDay: e.target.value })}
          />
        </Field>
      </div>
    </div>
  );
}

export function NewAgreementForm({ surface }: { surface: AgreementSurface }): JSX.Element {
  const router = useRouter();
  const search = useSearchParams();
  const prospectId = search?.get('prospectId') ?? null;
  const [prospect, setProspect] = useState<ProspectSeed | null>(null);
  const AUTHORITY = authorityStatement(surface);
  const [includesCpa, setIncludesCpa] = useState(true);
  const [includesCpl, setIncludesCpl] = useState(false);
  const [msaMode, setMsaMode] = useState<'new' | 'existing'>('new');

  const [agencyQuery, setAgencyQuery] = useState('');
  const [agencyOptions, setAgencyOptions] = useState<AgencyOption[]>([]);
  const [selectedAgency, setSelectedAgency] = useState<AgencyOption | null>(null);

  /*
   * Who the link goes to. The agency enters its own details when it signs --
   * as a business or as an individual licensed agent -- so nothing about its
   * legal name, entity, address, principal or signer is typed here.
   */
  const [recipient, setRecipient] = useState({ name: '', email: '', organization: '' });
  const [effectiveDate, setEffectiveDate] = useState(etTodayIso());

  const [cpaRows, setCpaRows] = useState<Record<Vertical, CpaRow>>({
    FE: { selected: true, rate: '160', dailyBlock: '' },
    MEDICARE: { selected: false, rate: '160', dailyBlock: '' },
    ACA: { selected: false, rate: '100', dailyBlock: '' },
  });
  const [cpaSchedule, setCpaSchedule] = useState<Schedule>(DEFAULT_SCHEDULE);
  const [cplRows, setCplRows] = useState<Record<Vertical, CplRow>>({
    FE: { selected: true, rate: '', bufferSeconds: '120', dailyBlock: '' },
    MEDICARE: { selected: false, rate: '', bufferSeconds: '120', dailyBlock: '' },
    ACA: { selected: false, rate: '', bufferSeconds: '120', dailyBlock: '' },
  });
  const [cplSchedule, setCplSchedule] = useState<Schedule>(DEFAULT_SCHEDULE);

  const [ccEmails, setCcEmails] = useState<string[]>([]);
  const [signatory, setSignatory] = useState({ name: '', title: '' });
  const [authority, setAuthority] = useState(false);

  const [previewDocs, setPreviewDocs] = useState<Array<{
    kind: string;
    title: string;
    html: string;
  }> | null>(null);
  const [previewTab, setPreviewTab] = useState(0);
  const [previewedFor, setPreviewedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<'preview' | 'send' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notSent, setNotSent] = useState<{ id: string; signUrl: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void apiClient
      .get<
        Envelope<{ defaultSignatoryName: string | null; defaultSignatoryTitle: string | null }>
      >(surface.kind === 'platform' ? `${surface.apiBase}/settings` : '/api/v1/sales/settings')
      .then(response => {
        const s = payload(response);
        if (s) {
          setSignatory({
            name: s.defaultSignatoryName ?? '',
            title: s.defaultSignatoryTitle ?? '',
          });
        }
      });
  }, [surface]);

  // Opened from a prospect: prefill who it goes to, and offer that prospect's
  // own executed MSA. The API re-checks the prospect is in this workspace.
  useEffect(() => {
    if (!prospectId) return;
    void apiClient
      .get<Envelope<ProspectSeed>>(`/api/v1/sales/prospects/${encodeURIComponent(prospectId)}`)
      .then(response => {
        const seed = payload(response);
        if (!seed) {
          setError(response.error?.message ?? 'The prospect could not be loaded.');
          return;
        }
        setProspect(seed);
        const person =
          seed.primaryContactName || [seed.firstName, seed.lastName].filter(Boolean).join(' ');
        setRecipient({
          name: person,
          email: seed.email ?? '',
          organization: seed.companyName ?? '',
        });
        if (seed.agreements.some(a => a.status === 'COMPLETED' && a.includesMsa)) {
          setMsaMode('existing');
        }
      });
  }, [prospectId]);

  const prospectMsa = useMemo(() => {
    const done = prospect?.agreements.find(a => a.status === 'COMPLETED' && a.includesMsa);
    return done
      ? { id: done.id, reference: done.reference, effectiveDate: done.effectiveDate ?? '' }
      : null;
  }, [prospect]);
  const executedMsa = selectedAgency?.executedMsa ?? prospectMsa;

  useEffect(() => {
    if (surface.kind !== 'platform') return;
    const handle = setTimeout(() => {
      void apiClient
        .get<
          Envelope<AgencyOption[]>
        >(`${surface.apiBase}/agencies?q=${encodeURIComponent(agencyQuery.trim())}`)
        .then(response => setAgencyOptions(payload(response) ?? []));
    }, 250);
    return () => clearTimeout(handle);
  }, [agencyQuery, surface]);

  function chooseAgency(option: AgencyOption | null): void {
    setSelectedAgency(option);
    if (!option) {
      setMsaMode('new');
      return;
    }
    setRecipient({
      name: option.contactName,
      email: option.contactEmail,
      organization: option.legalName,
    });
    const schedule: Schedule = {
      deliveryDays:
        option.deliveryDays.length > 0 ? option.deliveryDays : DEFAULT_SCHEDULE.deliveryDays,
      deliveryStart: option.deliveryStartTime || DEFAULT_SCHEDULE.deliveryStart,
      deliveryEnd: option.deliveryEndTime || DEFAULT_SCHEDULE.deliveryEnd,
      firstDeliveryDay: '',
    };
    setCpaSchedule(schedule);
    setCplSchedule(schedule);
    setMsaMode(option.executedMsa ? 'existing' : 'new');
  }

  const requestBody = useMemo(() => {
    const scheduleOut = (s: Schedule) => ({
      deliveryDays: s.deliveryDays,
      deliveryStart: s.deliveryStart,
      deliveryEnd: s.deliveryEnd,
      firstDeliveryDay: s.firstDeliveryDay || null,
    });
    const existing = msaMode === 'existing' && executedMsa ? executedMsa : null;
    return {
      tenantId: selectedAgency?.id ?? null,
      salesProspectId: prospect?.id ?? null,
      includesCpa,
      includesCpl,
      existingMsaEnvelopeId: existing?.id ?? null,
      terms: {
        effectiveDate,
        msaEffectiveDate: existing?.effectiveDate ?? effectiveDate,
        cpa: includesCpa
          ? {
              verticals: Object.fromEntries(
                VERTICALS.map(v => [
                  v,
                  {
                    selected: cpaRows[v].selected,
                    rate: num(cpaRows[v].rate) ?? 0,
                    dailyBlock: num(cpaRows[v].dailyBlock),
                  },
                ])
              ),
              ...scheduleOut(cpaSchedule),
            }
          : undefined,
        cpl: includesCpl
          ? {
              verticals: Object.fromEntries(
                VERTICALS.map(v => [
                  v,
                  {
                    selected: cplRows[v].selected,
                    rate: num(cplRows[v].rate),
                    bufferSeconds: num(cplRows[v].bufferSeconds),
                    dailyBlock: num(cplRows[v].dailyBlock),
                  },
                ])
              ),
              ...scheduleOut(cplSchedule),
            }
          : undefined,
      },
      recipient: {
        name: recipient.name,
        email: recipient.email,
        organization: recipient.organization || null,
      },
      ccEmails,
      // NetEnroll's API has always named it this way; the Sales CRM's names the issuer.
      ...(surface.kind === 'platform'
        ? { netenrollSignatory: signatory }
        : { issuerSignatory: signatory }),
    };
  }, [
    executedMsa,
    prospect,
    surface,
    ccEmails,
    cpaRows,
    cpaSchedule,
    cplRows,
    cplSchedule,
    effectiveDate,
    includesCpa,
    includesCpl,
    msaMode,
    selectedAgency,
    recipient,
    signatory,
  ]);
  const bodyKey = useMemo(() => JSON.stringify(requestBody), [requestBody]);
  const previewCurrent = previewedFor === bodyKey;

  async function preview(): Promise<void> {
    setBusy('preview');
    setError(null);
    const response = await apiClient.post<
      Envelope<{ documents: Array<{ kind: string; title: string; html: string }> }>
    >(`${surface.apiBase}/preview`, requestBody);
    setBusy(null);
    if (response.error) {
      setError(response.error.message);
      return;
    }
    const docs = payload(response)?.documents ?? [];
    setPreviewDocs(docs);
    setPreviewTab(0);
    setPreviewedFor(bodyKey);
  }

  async function send(): Promise<void> {
    setBusy('send');
    setError(null);
    const response = await apiClient.post<
      Envelope<{ envelope: { id: string }; signUrl: string; emailSent: boolean }>
    >(surface.apiBase, {
      ...requestBody,
      ...(surface.kind === 'platform'
        ? { netenrollAuthorityConfirmed: authority }
        : { issuerAuthorityConfirmed: authority }),
    });
    setBusy(null);
    if (response.error) {
      setError(response.error.message);
      return;
    }
    const result = payload(response);
    if (!result) return;
    if (result.emailSent) {
      router.push(`${surface.routeBase}/${result.envelope.id}`);
    } else {
      setNotSent({ id: result.envelope.id, signUrl: result.signUrl });
    }
  }

  return (
    <div className="page-canvas">
      <PageHeader
        title="New agreement"
        description={`Set the terms, sign for ${surface.issuerName}, and email the agency a secure link to enter its details and sign.`}
        actions={
          <Button variant="outline" asChild>
            <Link href={prospect ? `/sales-crm/prospects/${prospect.id}` : surface.routeBase}>
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              Agreements
            </Link>
          </Button>
        }
      />

      <div className="grid max-w-4xl grid-cols-1 gap-4">
        <Panel>
          <PanelHeader>
            <PanelTitle>1. Agreements</PanelTitle>
          </PanelHeader>
          <PanelBody className="space-y-4">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includesCpa}
                  onChange={e => setIncludesCpa(e.target.checked)}
                />
                CPA Agreement (pay per submitted application)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={includesCpl}
                  onChange={e => setIncludesCpl(e.target.checked)}
                />
                CPL Agreement (pay per billable call)
              </label>
              {!includesCpa && !includesCpl && (
                <p className="text-[11px] text-dropped-ink">
                  Choose at least one campaign agreement.
                </p>
              )}
            </div>
            <div className="space-y-2 border-t border-rule pt-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="msa"
                  checked={msaMode === 'new'}
                  onChange={() => setMsaMode('new')}
                />
                Include a new Master Services Agreement
              </label>
              <label
                className={cn('flex items-center gap-2 text-sm', !executedMsa && 'text-ink-3')}
              >
                <input
                  type="radio"
                  name="msa"
                  disabled={!executedMsa}
                  checked={msaMode === 'existing'}
                  onChange={() => setMsaMode('existing')}
                />
                This agency already has an executed MSA
                {executedMsa && (
                  <span className="text-xs text-ink-3">
                    ({executedMsa.reference}, effective {executedMsa.effectiveDate})
                  </span>
                )}
              </label>
            </div>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader>
            <PanelTitle>2. Recipient</PanelTitle>
          </PanelHeader>
          <PanelBody className="space-y-3">
            {prospect && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-[11px] uppercase tracking-wide text-ink-3">Prospect</span>
                <Badge variant="secondary">{prospect.displayName}</Badge>
                <span className="text-xs text-ink-3">
                  The agreement is linked to this prospect and its activity appears on its timeline.
                </span>
              </div>
            )}
            {surface.kind === 'platform' && (
              <Field id="agency-search" label="Existing agency (optional)">
                {selectedAgency ? (
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{selectedAgency.name}</Badge>
                    <span className="text-xs text-ink-3">{selectedAgency.legalName}</span>
                    <Button variant="ghost" size="sm" onClick={() => chooseAgency(null)}>
                      Clear
                    </Button>
                  </div>
                ) : (
                  <div>
                    <Input
                      id="agency-search"
                      value={agencyQuery}
                      placeholder="Search agencies"
                      onChange={e => setAgencyQuery(e.target.value)}
                    />
                    {agencyOptions.length > 0 && (
                      <div className="mt-1 max-h-48 overflow-y-auto rounded-control border border-rule bg-surface">
                        {agencyOptions.map(option => (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => chooseAgency(option)}
                            className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-sunken"
                          >
                            <span>{option.name}</span>
                            <span className="text-xs text-ink-3">{option.legalName}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </Field>
            )}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field id="recipient-name" label="Send to (name)">
                <Input
                  id="recipient-name"
                  value={recipient.name}
                  onChange={e => setRecipient({ ...recipient, name: e.target.value })}
                />
              </Field>
              <Field id="recipient-email" label="Send to (email)">
                <Input
                  id="recipient-email"
                  type="email"
                  value={recipient.email}
                  onChange={e => setRecipient({ ...recipient, email: e.target.value })}
                />
              </Field>
              <Field id="recipient-organization" label="Agency name (optional, for your records)">
                <Input
                  id="recipient-organization"
                  value={recipient.organization}
                  onChange={e => setRecipient({ ...recipient, organization: e.target.value })}
                />
              </Field>
            </div>
            <p className="text-[11px] text-ink-3">
              The agency fills in its own details when it signs: as a business (legal name, state,
              entity type, address, principal, contact details and who signs) or as an individual
              licensed agent (their own name, address and contact details). The documents you send
              show those fields as &ldquo;To be completed by Agency&rdquo;. The signing link and its
              one-time code go only to this email address.
            </p>
            <div className="max-w-xs">
              <Field id="effective-date" label="Effective date">
                <Input
                  id="effective-date"
                  type="date"
                  value={effectiveDate}
                  onChange={e => setEffectiveDate(e.target.value)}
                />
              </Field>
            </div>
          </PanelBody>
        </Panel>

        {includesCpa && (
          <Panel>
            <PanelHeader>
              <PanelTitle>3. CPA terms</PanelTitle>
            </PanelHeader>
            <PanelBody className="space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-ink-3">
                      <th className="py-1 pr-3 font-medium">Vertical</th>
                      <th className="py-1 pr-3 font-medium">Select</th>
                      <th className="py-1 pr-3 font-medium">Rate per submitted application</th>
                      <th className="py-1 font-medium">Daily block</th>
                    </tr>
                  </thead>
                  <tbody>
                    {VERTICALS.map(v => (
                      <tr key={v}>
                        <td className="py-1 pr-3">{VERTICAL_NAMES[v]}</td>
                        <td className="py-1 pr-3">
                          <input
                            type="checkbox"
                            aria-label={`Select ${VERTICAL_NAMES[v]}`}
                            checked={cpaRows[v].selected}
                            onChange={e =>
                              setCpaRows({
                                ...cpaRows,
                                [v]: { ...cpaRows[v], selected: e.target.checked },
                              })
                            }
                          />
                        </td>
                        <td className="py-1 pr-3">
                          <Input
                            aria-label={`${VERTICAL_NAMES[v]} CPA rate`}
                            type="number"
                            min={0}
                            step="0.01"
                            value={cpaRows[v].rate}
                            onChange={e =>
                              setCpaRows({
                                ...cpaRows,
                                [v]: { ...cpaRows[v], rate: e.target.value },
                              })
                            }
                          />
                        </td>
                        <td className="py-1">
                          <Input
                            aria-label={`${VERTICAL_NAMES[v]} CPA daily block`}
                            type="number"
                            min={1}
                            step="1"
                            disabled={!cpaRows[v].selected}
                            value={cpaRows[v].dailyBlock}
                            onChange={e =>
                              setCpaRows({
                                ...cpaRows,
                                [v]: { ...cpaRows[v], dailyBlock: e.target.value },
                              })
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ScheduleFields prefix="cpa" value={cpaSchedule} onChange={setCpaSchedule} />
            </PanelBody>
          </Panel>
        )}

        {includesCpl && (
          <Panel>
            <PanelHeader>
              <PanelTitle>{includesCpa ? '4' : '3'}. CPL terms</PanelTitle>
            </PanelHeader>
            <PanelBody className="space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-ink-3">
                      <th className="py-1 pr-3 font-medium">Vertical</th>
                      <th className="py-1 pr-3 font-medium">Select</th>
                      <th className="py-1 pr-3 font-medium">Rate per billable call</th>
                      <th className="py-1 pr-3 font-medium">Buffer (seconds)</th>
                      <th className="py-1 font-medium">Daily block</th>
                    </tr>
                  </thead>
                  <tbody>
                    {VERTICALS.map(v => (
                      <tr key={v}>
                        <td className="py-1 pr-3">{VERTICAL_NAMES[v]}</td>
                        <td className="py-1 pr-3">
                          <input
                            type="checkbox"
                            aria-label={`Select ${VERTICAL_NAMES[v]} CPL`}
                            checked={cplRows[v].selected}
                            onChange={e =>
                              setCplRows({
                                ...cplRows,
                                [v]: { ...cplRows[v], selected: e.target.checked },
                              })
                            }
                          />
                        </td>
                        {(['rate', 'bufferSeconds', 'dailyBlock'] as const).map(key => (
                          <td key={key} className="py-1 pr-3">
                            <Input
                              aria-label={`${VERTICAL_NAMES[v]} CPL ${key}`}
                              type="number"
                              min={key === 'rate' ? 0 : 1}
                              step={key === 'rate' ? '0.01' : '1'}
                              disabled={!cplRows[v].selected}
                              value={cplRows[v][key]}
                              onChange={e =>
                                setCplRows({
                                  ...cplRows,
                                  [v]: { ...cplRows[v], [key]: e.target.value },
                                })
                              }
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ScheduleFields prefix="cpl" value={cplSchedule} onChange={setCplSchedule} />
            </PanelBody>
          </Panel>
        )}

        <Panel>
          <PanelHeader>
            <PanelTitle>Copies</PanelTitle>
          </PanelHeader>
          <PanelBody className="space-y-3">
            <Field id="cc" label="Copy recipients (receive the executed copies; up to 10)">
              <EmailChips id="cc" values={ccEmails} onChange={setCcEmails} max={10} />
            </Field>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader>
            <PanelTitle>{surface.issuerName} signature</PanelTitle>
          </PanelHeader>
          <PanelBody className="space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field id="signatory-name" label="Signatory name">
                <Input
                  id="signatory-name"
                  value={signatory.name}
                  onChange={e => setSignatory({ ...signatory, name: e.target.value })}
                />
              </Field>
              <Field id="signatory-title" label="Signatory title">
                <Input
                  id="signatory-title"
                  value={signatory.title}
                  onChange={e => setSignatory({ ...signatory, title: e.target.value })}
                />
              </Field>
            </div>
            <div className="rounded-control border border-rule bg-sunken px-4 py-3">
              <SignatureScript name={signatory.name} />
              <div className="mt-1 border-t border-ink pt-1 text-[10px] uppercase tracking-wider text-ink-3">
                Authorized signature · {surface.issuerLegalName}
              </div>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={authority}
                onChange={e => setAuthority(e.target.checked)}
              />
              {AUTHORITY}
            </label>
          </PanelBody>
        </Panel>

        {error && <p className="text-sm text-dropped-ink">{error}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" disabled={busy !== null} onClick={() => void preview()}>
            {busy === 'preview' ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Eye className="mr-1.5 h-4 w-4" />
            )}
            Preview
          </Button>
          <Button
            disabled={busy !== null || !previewCurrent || !authority}
            onClick={() => void send()}
          >
            {busy === 'send' ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-1.5 h-4 w-4" />
            )}
            Sign and send
          </Button>
          <span className="text-xs text-ink-3">
            {!previewCurrent
              ? 'Preview the documents as they stand before signing.'
              : !authority
                ? `Confirm your authority to sign for ${surface.issuerName}.`
                : 'Ready to sign and send.'}
          </span>
        </div>
      </div>

      <Dialog open={previewDocs !== null} onOpenChange={open => !open && setPreviewDocs(null)}>
        <DialogContent className="flex h-[92vh] max-w-[min(96vw,1000px)] flex-col gap-3 p-4">
          <DialogHeader>
            <DialogTitle>Preview</DialogTitle>
            <DialogDescription>
              Exactly as the signer will receive them. {surface.issuerName}&rsquo;s signature is
              applied at send.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-1" role="tablist">
            {previewDocs?.map((doc, i) => (
              <button
                key={doc.kind}
                type="button"
                role="tab"
                aria-selected={previewTab === i}
                onClick={() => setPreviewTab(i)}
                className={cn(
                  'rounded-control px-3 py-1.5 text-xs font-medium',
                  previewTab === i ? 'bg-brand-tint text-brand-ink' : 'text-ink-2 hover:bg-sunken'
                )}
              >
                {doc.title}
              </button>
            ))}
          </div>
          {previewDocs?.[previewTab] && (
            <iframe
              key={previewDocs[previewTab].kind}
              title={previewDocs[previewTab].title}
              srcDoc={previewDocs[previewTab].html}
              sandbox=""
              className="min-h-0 w-full flex-1 rounded-control border border-rule bg-white"
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={notSent !== null}
        onOpenChange={open => {
          if (!open && notSent) router.push(`${surface.routeBase}/${notSent.id}`);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>The email was not sent</DialogTitle>
            <DialogDescription>
              The agreements are signed for {surface.issuerName} and recorded, but the invitation
              email could not be sent. Send the signer this link yourself. It works only for{' '}
              {recipient.email}.
            </DialogDescription>
          </DialogHeader>
          <code className="block break-all rounded-control bg-sunken p-2 text-xs">
            {notSent?.signUrl}
          </code>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (!notSent) return;
                void navigator.clipboard.writeText(notSent.signUrl).then(() => setCopied(true));
              }}
            >
              {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Button onClick={() => notSent && router.push(`${surface.routeBase}/${notSent.id}`)}>
              Open the agreement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
