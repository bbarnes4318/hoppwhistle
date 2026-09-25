'use client';

import { CheckCircle2, Copy, Loader2 } from 'lucide-react';
import Link from 'next/link';
import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';

import {
  Notice,
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  StatusChip,
} from '@/components/domain';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';
import type { NetworkAgencies, NetworkAgencyRow } from '@/components/white-label/types';
import { useAuth } from '@/hooks/use-auth';
import { usePlatformContext } from '@/hooks/use-platform-context';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';
import { cn } from '@/lib/utils';

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

interface AgencyForm {
  name: string;
  legalName: string;
  state: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  licensedAgents: string;
  deliveryDays: string[];
  deliveryStart: string;
  deliveryEnd: string;
  timezone: string;
}

const EMPTY_FORM: AgencyForm = {
  name: '',
  legalName: '',
  state: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  licensedAgents: '',
  deliveryDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
  deliveryStart: '09:00',
  deliveryEnd: '17:00',
  timezone: 'America/New_York',
};

/**
 * Onboard an Agency: a white-label agency bringing a downline agency on.
 *
 * Two steps, the agency and then its owner. Where an agency has got to is
 * DERIVED from what the server says about it -- it exists or it does not, its
 * owner is invited, active, or not yet -- never from a step this page stored,
 * which is the same rule /admin/onboarding follows. An agency half-onboarded
 * yesterday opens on the right step.
 *
 * There is no terms, payment or enrolment step: a downline agency is billed by
 * the agency that onboarded it, never by NetEnroll.
 */
export default function NetworkOnboardingPage(): JSX.Element {
  const platform = usePlatformContext();
  const { isReadOnlyPreview } = useAuth();

  const [agencies, setAgencies] = useState<NetworkAgencyRow[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await apiClient.get<Envelope<NetworkAgencies>>(
      '/api/v1/network/agencies?period=TODAY'
    );
    if (response.error) {
      setError(response.error.message);
      return;
    }
    setError(null);
    setAgencies(payload(response)?.agencies ?? []);
  }, []);

  useEffect(() => {
    // `?agency=` reopens an agency on its owner step. Read after mount, from
    // `window.location`, so the page needs no Suspense boundary to build.
    const requested = new URLSearchParams(window.location.search).get('agency');
    if (requested) setSelectedId(requested);
  }, []);

  useEffect(() => {
    if (platform.loading || platform.needsAgency) return;
    void load();
  }, [load, platform.loading, platform.needsAgency]);

  if (platform.needsAgency) {
    return (
      <div className="page-canvas">
        <Notice title="Select an agency to onboard agencies under it." />
      </div>
    );
  }

  const selected = agencies?.find(agency => agency.tenantId === selectedId) ?? null;
  const waiting = (agencies ?? []).filter(agency => agency.owner.status !== 'ACCEPTED');

  return (
    <div className="page-canvas">
      <PageHeader
        description="Bring an agency onto your portal: the agency, then its owner's invitation"
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/network/agencies">Your agencies</Link>
          </Button>
        }
      />

      {error ? <Notice tone="error" title={error} /> : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <StepOne
          done={selected !== null}
          selected={selected}
          disabled={isReadOnlyPreview}
          onCreated={async tenantId => {
            setSelectedId(tenantId);
            await load();
          }}
          onStartOver={() => setSelectedId(null)}
        />
        <StepTwo agency={selected} disabled={isReadOnlyPreview} onInvited={() => void load()} />
      </div>

      {waiting.length > 0 ? (
        <Panel>
          <PanelHeader>
            <PanelTitle>Waiting on their owner</PanelTitle>
            <PanelDescription>
              Agencies you have onboarded whose owner has not signed in yet
            </PanelDescription>
          </PanelHeader>
          <PanelBody className="flex flex-col gap-2">
            {waiting.map(agency => (
              <button
                key={agency.tenantId}
                type="button"
                onClick={() => setSelectedId(agency.tenantId)}
                className={cn(
                  'flex items-center justify-between rounded-control border border-rule px-3 py-2 text-left hover:bg-sunken',
                  agency.tenantId === selectedId && 'border-brand bg-brand-tint'
                )}
              >
                <span className="font-medium">{agency.name}</span>
                <StatusChip
                  value={agency.owner.status}
                  label={
                    agency.owner.status === 'PENDING'
                      ? 'Invite pending'
                      : agency.owner.status === 'EXPIRED'
                        ? 'Invite expired'
                        : 'Not invited'
                  }
                  tone={agency.owner.status === 'PENDING' ? 'ringing' : 'neutral'}
                  size="sm"
                />
              </button>
            ))}
          </PanelBody>
        </Panel>
      ) : null}
    </div>
  );
}

function StepShell({
  index,
  title,
  done,
  children,
}: {
  index: number;
  title: string;
  done: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <Panel data-step={index} data-state={done ? 'COMPLETE' : 'READY'}>
      <PanelHeader
        action={
          done ? (
            <span className="inline-flex items-center gap-1 t-meta text-live-ink">
              <CheckCircle2 className="h-3.5 w-3.5" /> Done
            </span>
          ) : null
        }
      >
        <PanelTitle>{`${index}. ${title}`}</PanelTitle>
      </PanelHeader>
      <PanelBody className="flex flex-col gap-3">{children}</PanelBody>
    </Panel>
  );
}

function StepOne({
  done,
  selected,
  disabled,
  onCreated,
  onStartOver,
}: {
  done: boolean;
  selected: NetworkAgencyRow | null;
  disabled: boolean;
  onCreated: (tenantId: string) => Promise<void>;
  onStartOver: () => void;
}): JSX.Element {
  const [form, setForm] = useState<AgencyForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);

  const set = (key: keyof AgencyForm) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm(current => ({ ...current, [key]: event.target.value }));

  async function submit(): Promise<void> {
    setBusy(true);
    try {
      const response = await apiClient.post<
        Envelope<{ tenantId: string }> & { error?: { problems?: string[] } }
      >('/api/v1/network/agencies', {
        ...form,
        licensedAgents: Number(form.licensedAgents),
      });
      const created = payload(response);
      if (response.error || !created) {
        const details = (response.error as { problems?: string[] } | undefined)?.problems;
        setProblems(details ?? [response.error?.message ?? 'The agency was not created.']);
        return;
      }
      setProblems([]);
      setForm(EMPTY_FORM);
      toast.success('Agency created', 'Now invite its owner.');
      await onCreated(created.tenantId);
    } finally {
      setBusy(false);
    }
  }

  if (done && selected) {
    return (
      <StepShell index={1} title="The agency" done>
        <p className="t-body text-ink">{selected.name}</p>
        <Button variant="outline" size="sm" className="self-start" onClick={onStartOver}>
          Onboard another agency
        </Button>
      </StepShell>
    );
  }

  const field = (
    key: keyof AgencyForm,
    label: string,
    props: React.ComponentProps<typeof Input> = {}
  ) => (
    <div>
      <Label htmlFor={`agency-${key}`}>{label}</Label>
      <Input id={`agency-${key}`} value={form[key] as string} onChange={set(key)} {...props} />
    </div>
  );

  return (
    <StepShell index={1} title="The agency" done={false}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {field('name', 'Agency name')}
        {field('legalName', 'Legal name')}
        {field('state', 'State', { maxLength: 2, placeholder: 'TX' })}
        {field('licensedAgents', 'Licensed agents', { type: 'number', min: 1 })}
        {field('contactName', 'Contact name')}
        {field('contactEmail', 'Contact email', { type: 'email' })}
        {field('contactPhone', 'Contact phone', { type: 'tel' })}
        {field('timezone', 'Time zone')}
        {field('deliveryStart', 'Takes calls from', { type: 'time' })}
        {field('deliveryEnd', 'Until', { type: 'time' })}
      </div>
      <fieldset>
        <legend className="t-label text-ink-3">Days it takes calls</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {DAYS.map(day => {
            const on = form.deliveryDays.includes(day);
            return (
              <button
                key={day}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setForm(current => ({
                    ...current,
                    deliveryDays: on
                      ? current.deliveryDays.filter(d => d !== day)
                      : [...current.deliveryDays, day],
                  }))
                }
                className={cn(
                  'h-8 rounded-control border px-3 text-xs font-medium',
                  on ? 'border-brand bg-brand-tint text-brand-ink' : 'border-rule text-ink-2'
                )}
              >
                {day.charAt(0) + day.slice(1).toLowerCase()}
              </button>
            );
          })}
        </div>
      </fieldset>
      {problems.length > 0 ? (
        <ul className="list-disc pl-5 t-meta text-dropped-ink">
          {problems.map(problem => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}
      <Button className="self-start" onClick={() => void submit()} disabled={busy || disabled}>
        {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
        Create the agency
      </Button>
    </StepShell>
  );
}

function StepTwo({
  agency,
  disabled,
  onInvited,
}: {
  agency: NetworkAgencyRow | null;
  disabled: boolean;
  onInvited: () => void;
}): JSX.Element {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  useEffect(() => {
    setLink(null);
    setProblem(null);
    setEmail(agency?.owner.email ?? '');
  }, [agency?.tenantId, agency?.owner.email]);

  const done = agency?.owner.status === 'ACCEPTED';

  async function invite(): Promise<void> {
    if (!agency) return;
    setBusy(true);
    try {
      const response = await apiClient.post<
        Envelope<{ activationToken: string; email: string; emailed: boolean }>
      >(`/api/v1/network/agencies/${agency.tenantId}/owner`, { email });
      const grant = payload(response);
      if (response.error || !grant) {
        setProblem(response.error?.message ?? 'The invitation was not issued.');
        return;
      }
      setProblem(null);
      // The same two parameters the invitation email's link carries, which the
      // login page reads to open on its create-account tab.
      const params = new URLSearchParams({ activation: grant.activationToken, email: grant.email });
      setLink(`${window.location.origin}/login?${params.toString()}`);
      if (grant.emailed) toast.success('Invitation sent', `We emailed ${grant.email}.`);
      onInvited();
    } finally {
      setBusy(false);
    }
  }

  return (
    <StepShell index={2} title="Its owner" done={done}>
      {!agency ? (
        <p className="t-meta text-ink-3">
          Create the agency first, or pick one waiting on its owner.
        </p>
      ) : done ? (
        <p className="t-body text-ink">{`${agency.owner.email ?? 'The owner'} has signed in.`}</p>
      ) : (
        <>
          <div>
            <Label htmlFor="owner-email">{`Owner of ${agency.name}`}</Label>
            <Input
              id="owner-email"
              type="email"
              value={email}
              onChange={event => setEmail(event.target.value)}
              placeholder="owner@agency.example"
            />
          </div>
          {agency.owner.status === 'PENDING' ? (
            <p className="t-meta text-ink-3">
              An invitation is already out. Issue a fresh link if the first one was lost.
            </p>
          ) : null}
          {problem ? <p className="t-meta text-dropped-ink">{problem}</p> : null}
          <Button
            className="self-start"
            onClick={() => void invite()}
            disabled={busy || disabled || !email.trim()}
          >
            {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
            Issue the owner&rsquo;s link
          </Button>
        </>
      )}

      {link ? (
        <div className="rounded-control border border-live bg-live-tint p-3">
          <p className="text-sm font-medium">The owner&rsquo;s activation link</p>
          <p className="mt-1 t-meta text-ink-3">
            Shown once. Single-use, expires in seven days, and works only for the address it was
            issued for.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code
              className="t-code block min-w-0 flex-1 truncate rounded bg-surface px-2 py-1"
              data-testid="activation-link"
            >
              {link}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void navigator.clipboard?.writeText(link)}
              aria-label="Copy the activation link"
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : null}
    </StepShell>
  );
}
