'use client';

import { ArrowLeft, Loader2, Pencil, RefreshCw, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';

import { InviteOwnerDialog } from '@/components/agencies/invite-owner-dialog';
import { count, pct } from '@/components/delivery/ledger';
import {
  EmptyState,
  Notice,
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  StatTile,
  StatTileRow,
  StatusChip,
} from '@/components/domain';
import { useClaimPageTitle } from '@/components/layout/use-page-title';
import { ChildStatementButton } from '@/components/statements/statements-view';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';
import { DownlineSettings } from '@/components/white-label/downline-settings';
import { PeriodToolbar, usePeriod } from '@/components/white-label/period-toolbar';
import type {
  NetworkAgencyDetail,
  NetworkAgencyProfile,
  NetworkAgencyRow,
} from '@/components/white-label/types';
import { usePlatformContext } from '@/hooks/use-platform-context';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';
import { formatDisplayDate } from '@/lib/format-time';
import { cn } from '@/lib/utils';

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;

/** How an owner's activation reads, and the tone it is drawn in. As the list. */
const OWNER_LABEL: Record<
  NetworkAgencyRow['owner']['status'],
  { label: string; tone: 'live' | 'ringing' | 'neutral' | 'dropped' }
> = {
  ACCEPTED: { label: 'Owner active', tone: 'live' },
  PENDING: { label: 'Invite pending', tone: 'ringing' },
  EXPIRED: { label: 'Invite expired', tone: 'dropped' },
  NOT_INVITED: { label: 'Not invited', tone: 'neutral' },
};

/** The edit form: every field a string, as the inputs hold them. */
interface DetailsForm {
  name: string;
  legalName: string;
  state: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  licensedAgentCount: string;
  deliveryDays: string[];
  deliveryStartTime: string;
  deliveryEndTime: string;
  deliveryTimeZone: string;
}

function formFrom(detail: NetworkAgencyDetail): DetailsForm {
  const p = detail.profile;
  return {
    name: detail.name,
    legalName: p?.legalName ?? '',
    state: p?.state ?? '',
    contactName: p?.contactName ?? '',
    contactEmail: p?.contactEmail ?? '',
    contactPhone: p?.contactPhone ?? '',
    licensedAgentCount: p ? String(p.licensedAgentCount) : '',
    deliveryDays: p?.deliveryDays ?? ['MON', 'TUE', 'WED', 'THU', 'FRI'],
    deliveryStartTime: p?.deliveryStartTime ?? '09:00',
    deliveryEndTime: p?.deliveryEndTime ?? '17:00',
    deliveryTimeZone: p?.deliveryTimeZone ?? 'America/New_York',
  };
}

function dayLabel(day: string): string {
  return day.charAt(0) + day.slice(1).toLowerCase();
}

/**
 * One downline agency, as its white-label parent sees it.
 *
 * The same aggregates as its row on /network/agencies, over a period; its own
 * record (the details it was onboarded with), which the parent can correct;
 * its owner's activation, with a way to send the invitation again; and what
 * the parent sells it -- its numbers limit and upgrades (`DownlineSettings`),
 * beside the upgrades it has asked for. Its status is shown, never edited.
 *
 * Everything is read from `GET /api/v1/network/agencies/:tenantId`, which
 * answers 404 for anything that is not the acting agency's own child.
 */
export default function NetworkAgencyPage(): JSX.Element {
  const params = useParams<{ tenantId: string }>();
  const tenantId = typeof params?.tenantId === 'string' ? params.tenantId : '';

  // The agency's name is this page's title, so the topbar leaves its own out.
  useClaimPageTitle(true);

  const state = usePeriod('THIS_MONTH');
  const { sendable, query } = state;

  const [detail, setDetail] = useState<NetworkAgencyDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);

  const platform = usePlatformContext();
  const withoutAgency = platform.needsAgency;

  const load = useCallback(async () => {
    if (!sendable || !tenantId) return;
    setLoading(true);
    try {
      const response = await apiClient.get<Envelope<NetworkAgencyDetail>>(
        `/api/v1/network/agencies/${encodeURIComponent(tenantId)}?${query}`
      );
      if (response.error) {
        if (response.error.code === 'NOT_FOUND') setNotFound(true);
        setError(response.error.message);
        return;
      }
      setError(null);
      setNotFound(false);
      setDetail(payload(response) ?? null);
    } finally {
      setLoading(false);
    }
  }, [query, sendable, tenantId]);

  useEffect(() => {
    if (platform.loading || withoutAgency) return;
    void load();
  }, [load, platform.loading, withoutAgency]);

  if (withoutAgency) {
    return (
      <div className="page-canvas">
        <Notice title="Select an agency to see its downline." />
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="page-canvas">
        <EmptyState
          headline="This agency is not one of yours."
          body="It may have been removed, or the link is wrong."
          action={{ label: 'Back to Agencies', href: '/network/agencies' }}
        />
      </div>
    );
  }

  return (
    <div className="page-canvas">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Link
            href="/network/agencies"
            className="inline-flex items-center gap-1 t-meta text-ink-3 hover:text-ink"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Agencies
          </Link>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="t-title truncate text-ink">{detail?.name ?? 'Agency'}</h2>
            {detail ? <StatusChip value={detail.status} enumName="TenantStatus" size="sm" /> : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:shrink-0 md:justify-end">
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', loading && 'animate-spin')} />
            Refresh
          </Button>
          {detail ? <ChildStatementButton tenantId={detail.tenantId} name={detail.name} /> : null}
          {detail && detail.owner.status !== 'ACCEPTED' ? (
            <Button size="sm" onClick={() => setInviteOpen(true)}>
              <UserPlus className="mr-1.5 h-3.5 w-3.5" />
              {detail.owner.status === 'NOT_INVITED' ? 'Invite owner' : 'Resend invite'}
            </Button>
          ) : null}
        </div>
      </div>

      {error && !notFound ? <Notice tone="error" title={error} /> : null}

      <PeriodToolbar state={state} resolved={detail?.period ?? null} label="Agency period" />

      <StatTileRow className="lg:grid-cols-5">
        <StatTile
          size="hero"
          label="Agents"
          value={count(detail?.stats.agents)}
          loading={!detail}
        />
        <StatTile
          size="hero"
          label="Inbound calls"
          value={count(detail?.stats.inboundCalls)}
          loading={!detail}
        />
        <StatTile
          size="hero"
          label="Answered by agents"
          value={count(detail?.stats.answeredByAgents)}
          loading={!detail}
        />
        <StatTile
          size="hero"
          label="Applications"
          value={count(detail?.stats.applications)}
          loading={!detail}
        />
        <StatTile
          size="hero"
          label="Closing"
          value={pct(detail?.stats.closingPct, 1)}
          sub="Applications per answered call"
          loading={!detail}
        />
      </StatTileRow>

      {detail ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
            <DetailsPanel detail={detail} onSaved={() => void load()} />
            <Panel className="min-w-0">
              <PanelHeader>
                <PanelTitle>Numbers and upgrades</PanelTitle>
                <PanelDescription>
                  What you let this agency hold, and the upgrades you sell it.
                </PanelDescription>
              </PanelHeader>
              <PanelBody>
                <DownlineSettings agency={detail} onSaved={() => void load()} />
              </PanelBody>
            </Panel>
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <OwnerPanel detail={detail} onInvite={() => setInviteOpen(true)} />
            <Panel className="min-w-0" data-open-upgrade-requests="">
              <PanelHeader>
                <PanelTitle>Upgrade requests</PanelTitle>
                <PanelDescription>Turning an upgrade on closes its request.</PanelDescription>
              </PanelHeader>
              <PanelBody>
                {detail.openUpgradeRequests.length === 0 ? (
                  <p className="t-meta text-ink-3">No open requests.</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-rule">
                    {detail.openUpgradeRequests.map(request => (
                      <li
                        key={request.id}
                        className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
                        data-upgrade-request={request.upgradeKey}
                      >
                        <span className="t-body text-ink">{request.upgradeName}</span>
                        <span className="t-meta text-ink-3">
                          {`Asked ${formatDisplayDate(request.createdAt)}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </PanelBody>
            </Panel>
          </div>
        </div>
      ) : null}

      {loading && !detail ? (
        <div className="flex items-center justify-center py-8 t-body text-ink-3">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading the agency
        </div>
      ) : null}

      {detail ? (
        <InviteOwnerDialog
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          scope="network"
          agency={{
            tenantId: detail.tenantId,
            name: detail.name,
            email: detail.owner.email ?? detail.profile?.contactEmail ?? '',
            alreadyInvited: detail.owner.status !== 'NOT_INVITED',
          }}
          onInvited={() => void load()}
        />
      ) : null}
    </div>
  );
}

/**
 * The agency's owner: who they are, where their invitation stands, and the one
 * button that sends it. Always on the page, so the way to invite an owner never
 * depends on noticing a banner.
 */
function OwnerPanel({
  detail,
  onInvite,
}: {
  detail: NetworkAgencyDetail;
  onInvite: () => void;
}): JSX.Element {
  const owner = OWNER_LABEL[detail.owner.status];
  const accepted = detail.owner.status === 'ACCEPTED';
  const neverInvited = detail.owner.status === 'NOT_INVITED';

  return (
    <Panel className="min-w-0" data-agency-owner="">
      <PanelHeader>
        <PanelTitle>Owner</PanelTitle>
        <PanelDescription>
          {accepted
            ? 'Signed in, and in charge of the agency’s agents.'
            : 'The owner signs in first, then adds the agency’s agents.'}
        </PanelDescription>
      </PanelHeader>
      <PanelBody className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip value={detail.owner.status} label={owner.label} tone={owner.tone} size="sm" />
          {detail.owner.email ? (
            <span className="t-body break-all text-ink">{detail.owner.email}</span>
          ) : null}
        </div>
        {detail.owner.invitedAt ? (
          <p className="t-meta text-ink-3">
            {`Invited ${formatDisplayDate(detail.owner.invitedAt)}. The link works once and expires in seven days.`}
          </p>
        ) : null}
        {accepted ? null : (
          <Button
            size="sm"
            variant={neverInvited ? 'default' : 'outline'}
            className="self-start"
            onClick={onInvite}
          >
            <UserPlus className="mr-1.5 h-3.5 w-3.5" />
            {neverInvited ? 'Invite owner' : 'Resend invite'}
          </Button>
        )}
      </PanelBody>
    </Panel>
  );
}

/** The agency's own record: read, then edited in place. */
function DetailsPanel({
  detail,
  onSaved,
}: {
  detail: NetworkAgencyDetail;
  onSaved: () => void;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<DetailsForm>(() => formFrom(detail));
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // A fresh read replaces the form, unless it is mid-edit.
  useEffect(() => {
    if (!editing) setForm(formFrom(detail));
  }, [detail, editing]);

  const set =
    (key: keyof DetailsForm) =>
    (event: React.ChangeEvent<HTMLInputElement>): void =>
      setForm(current => ({ ...current, [key]: event.target.value }));

  async function save(): Promise<void> {
    setBusy(true);
    try {
      // Only what changed: the server merges it onto the record and validates
      // the whole. A name-only edit then never needs the rest of a record an
      // older agency may not have.
      const initial = formFrom(detail);
      const body: Record<string, unknown> = {};
      for (const key of Object.keys(form) as Array<keyof DetailsForm>) {
        if (JSON.stringify(form[key]) === JSON.stringify(initial[key])) continue;
        body[key] =
          key === 'licensedAgentCount'
            ? form.licensedAgentCount.trim() === ''
              ? null
              : Number(form.licensedAgentCount)
            : form[key];
      }
      if (Object.keys(body).length === 0) {
        setProblems([]);
        setEditing(false);
        return;
      }
      const response = await apiClient.patch<
        Envelope<{ tenantId: string; name: string; profile: NetworkAgencyProfile | null }>
      >(`/api/v1/network/agencies/${detail.tenantId}`, body);
      if (response.error || !payload(response)) {
        const details = (response.error as { problems?: string[] } | undefined)?.problems;
        // The API lists every problem, joined with '; ', in its message.
        setProblems(
          details ?? (response.error?.message ?? 'The details were not saved.').split('; ')
        );
        return;
      }
      setProblems([]);
      setEditing(false);
      toast.success('Details saved', form.name);
      onSaved();
    } finally {
      setBusy(false);
    }
  }

  const p = detail.profile;
  const rows: Array<[string, React.ReactNode]> = [
    ['Agency name', detail.name],
    ['Legal name', p?.legalName],
    ['State', p?.state],
    ['Licensed agents', p ? count(p.licensedAgentCount) : null],
    ['Contact', p?.contactName],
    ['Contact email', p?.contactEmail],
    ['Contact phone', p?.contactPhone],
    [
      'Takes calls',
      p
        ? `${p.deliveryDays.map(dayLabel).join(', ')} · ${p.deliveryStartTime}–${p.deliveryEndTime}`
        : null,
    ],
    ['Time zone', p?.deliveryTimeZone],
    ['Onboarded', formatDisplayDate(detail.createdAt)],
  ];

  const field = (
    key: Exclude<keyof DetailsForm, 'deliveryDays'>,
    label: string,
    props: React.ComponentProps<typeof Input> = {}
  ) => (
    <div>
      <Label htmlFor={`details-${key}`}>{label}</Label>
      <Input id={`details-${key}`} value={form[key]} onChange={set(key)} {...props} />
    </div>
  );

  return (
    <Panel className="min-w-0" data-agency-details="">
      <PanelHeader
        action={
          editing ? null : (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              Edit
            </Button>
          )
        }
      >
        <PanelTitle>Details</PanelTitle>
        {!p && !editing ? (
          <PanelDescription>
            No details were recorded when this agency was created.
          </PanelDescription>
        ) : null}
      </PanelHeader>
      <PanelBody>
        {!editing ? (
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="t-caption text-ink-2">{label}</dt>
                <dd className="t-body break-words text-ink">{value || '—'}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {field('name', 'Agency name')}
              {field('legalName', 'Legal name')}
              {field('state', 'State', { maxLength: 2, placeholder: 'TX' })}
              {field('licensedAgentCount', 'Licensed agents', { type: 'number', min: 1 })}
              {field('contactName', 'Contact name')}
              {field('contactEmail', 'Contact email', { type: 'email' })}
              {field('contactPhone', 'Contact phone', { type: 'tel' })}
              {field('deliveryStartTime', 'Takes calls from', { type: 'time' })}
              {field('deliveryEndTime', 'Until', { type: 'time' })}
              {field('deliveryTimeZone', 'Time zone')}
            </div>
            <fieldset>
              <legend className="t-caption text-ink-2">Days it takes calls</legend>
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
                      {dayLabel(day)}
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
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void save()} disabled={busy}>
                {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  setProblems([]);
                  setForm(formFrom(detail));
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}
