'use client';

import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, ShieldCheck, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/domain';
import { PageHeader } from '@/components/layout/page-header';
import { SalesGate } from '@/components/sales-crm/sales-gate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { EMAIL_PATTERN } from '@/lib/agreements';
import { apiClient, payload, type Envelope } from '@/lib/api';
import { SELECT_CLASS, type SalesContext } from '@/lib/sales-crm';

/**
 * The workspace's agreement suite and who may use the Sales CRM.
 *
 * ── Brand is not the legal entity ────────────────────────────────────────────
 *
 * The display name is what the portal and emails call the issuer; the legal
 * contracting entity is who signs the contract. They are separate fields and
 * the second is never assumed from the first.
 *
 * Template set, seal, brand and link domain are NetEnroll's to set (platform
 * admins, audited) and are shown here read-only.
 */

interface SuiteSettings {
  scope: 'PLATFORM' | 'TENANT';
  displayName: string;
  legalEntityName: string | null;
  dbaName: string | null;
  noticeAddress: string | null;
  noticeEmail: string | null;
  replyToEmail: string | null;
  defaultSignatoryName: string | null;
  defaultSignatoryTitle: string | null;
  internalCopyEmails: string[];
  referencePrefix: string;
  brandTheme: string | null;
  linkOrigin: string;
  templateSet: { key: string; label: string; installNote: string | null } | null;
  sealed: boolean;
  legalName: string;
  templatesConfigured: boolean;
  templatesMessage: string | null;
  missingSetting: string | null;
  canSend: boolean;
}

interface AccessUser {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  status: string;
  roles: string[];
  implicit: boolean;
  level: 'MANAGER' | 'MEMBER' | 'READONLY' | null;
}

const LEVEL_LABELS: Record<string, string> = {
  MANAGER: 'Manager',
  MEMBER: 'Member',
  READONLY: 'Read only',
};

function Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[11px] text-ink-3">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-ink-3">{hint}</p>}
    </div>
  );
}

function SuitePanel({ context }: { context: SalesContext }): JSX.Element {
  const [s, setS] = useState<SuiteSettings | null>(null);
  const [chip, setChip] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void apiClient.get<Envelope<SuiteSettings>>('/api/v1/sales/settings').then(r => {
      setS(payload(r) ?? null);
      setError(r.error?.message ?? null);
    });
  }, []);

  if (!s) {
    return (
      <div className="flex items-center py-8 text-ink-3">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        {error ?? 'Loading the agreement suite'}
      </div>
    );
  }

  const manage = context.can.manage;
  const set = (key: keyof SuiteSettings) => (e: { target: { value: string } }) =>
    setS(prev => (prev ? { ...prev, [key]: e.target.value } : prev));

  async function save(): Promise<void> {
    if (!s) return;
    setBusy(true);
    setNotice(null);
    const r = await apiClient.put<Envelope<SuiteSettings>>('/api/v1/sales/settings', {
      displayName: s.displayName,
      legalEntityName: s.legalEntityName ?? '',
      dbaName: s.dbaName ?? '',
      noticeAddress: s.noticeAddress ?? '',
      noticeEmail: s.noticeEmail ?? '',
      replyToEmail: s.replyToEmail ?? '',
      defaultSignatoryName: s.defaultSignatoryName ?? '',
      defaultSignatoryTitle: s.defaultSignatoryTitle ?? '',
      internalCopyEmails: s.internalCopyEmails,
    });
    setBusy(false);
    const saved = payload(r);
    if (!saved) {
      setError(r.error?.message ?? 'The settings could not be saved.');
      return;
    }
    setS(saved);
    setError(null);
    setNotice('Saved.');
  }

  function addChip(): void {
    const value = chip.trim().toLowerCase();
    if (!value) return;
    if (!EMAIL_PATTERN.test(value)) {
      setError(`${value} is not an email address.`);
      return;
    }
    setS(prev =>
      prev
        ? { ...prev, internalCopyEmails: Array.from(new Set([...prev.internalCopyEmails, value])) }
        : prev
    );
    setChip('');
  }

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
      <Panel>
        <PanelHeader>
          <PanelTitle>Agreement suite</PanelTitle>
        </PanelHeader>
        <PanelBody className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field id="display" label="Brand / display name" hint="What emails and pages call you.">
              <Input
                id="display"
                disabled={!manage}
                value={s.displayName}
                onChange={set('displayName')}
              />
            </Field>
            <Field
              id="legal"
              label="Legal contracting entity"
              hint="The company that signs the contracts, exactly as registered."
            >
              <Input
                id="legal"
                disabled={!manage}
                value={s.legalEntityName ?? ''}
                onChange={set('legalEntityName')}
              />
            </Field>
            <Field id="dba" label="d/b/a (optional)">
              <Input
                id="dba"
                disabled={!manage}
                value={s.dbaName ?? ''}
                onChange={set('dbaName')}
              />
            </Field>
            <Field
              id="reply"
              label="Reply-to email (optional)"
              hint="Defaults to the notice email."
            >
              <Input
                id="reply"
                type="email"
                disabled={!manage}
                value={s.replyToEmail ?? ''}
                onChange={set('replyToEmail')}
              />
            </Field>
          </div>
          <Field id="address" label="Notice address">
            <Textarea
              id="address"
              rows={2}
              disabled={!manage}
              value={s.noticeAddress ?? ''}
              onChange={set('noticeAddress')}
            />
          </Field>
          <Field
            id="notice"
            label="Notice email"
            hint="Named on every agreement and in every 'contact' line the signer sees."
          >
            <Input
              id="notice"
              type="email"
              disabled={!manage}
              value={s.noticeEmail ?? ''}
              onChange={set('noticeEmail')}
            />
          </Field>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Field id="sig-name" label="Default signatory">
              <Input
                id="sig-name"
                disabled={!manage}
                value={s.defaultSignatoryName ?? ''}
                onChange={set('defaultSignatoryName')}
              />
            </Field>
            <Field id="sig-title" label="Signatory title">
              <Input
                id="sig-title"
                disabled={!manage}
                value={s.defaultSignatoryTitle ?? ''}
                onChange={set('defaultSignatoryTitle')}
              />
            </Field>
          </div>
          <Field id="copies" label="Internal copy emails" hint="Receive every executed copy.">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {s.internalCopyEmails.map(email => (
                <span
                  key={email}
                  className="inline-flex items-center gap-1 rounded-full bg-sunken px-2.5 py-1 text-xs"
                >
                  {email}
                  {manage && (
                    <button
                      type="button"
                      aria-label={`Remove ${email}`}
                      onClick={() =>
                        setS({
                          ...s,
                          internalCopyEmails: s.internalCopyEmails.filter(e => e !== email),
                        })
                      }
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              ))}
            </div>
            {manage && (
              <div className="flex gap-2">
                <Input
                  id="copies"
                  type="email"
                  value={chip}
                  onChange={e => setChip(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addChip();
                    }
                  }}
                />
                <Button type="button" variant="outline" onClick={addChip}>
                  Add
                </Button>
              </div>
            )}
          </Field>
          {error && <p className="text-sm text-dropped-ink">{error}</p>}
          {notice && <p className="text-sm text-ink-2">{notice}</p>}
          {manage && (
            <Button disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          )}
        </PanelBody>
      </Panel>

      <div className="space-y-4">
        <Panel>
          <PanelHeader>
            <PanelTitle>Readiness</PanelTitle>
          </PanelHeader>
          <PanelBody className="space-y-2 text-sm">
            <div className="flex items-start gap-2">
              {s.templatesConfigured ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-live-ink" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 text-ringing-ink" />
              )}
              <div>
                <div className="font-medium">
                  {s.templatesConfigured
                    ? 'Contract templates installed'
                    : 'Contract templates not configured'}
                </div>
                <div className="text-xs text-ink-3">
                  {s.templateSet?.label ?? 'No template set assigned.'}
                  {!s.templatesConfigured &&
                    ' Approved MSA, CPA and CPL text must be installed by NetEnroll before anything can be sent.'}
                </div>
              </div>
            </div>
            <div className="flex items-start gap-2">
              {s.missingSetting ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 text-ringing-ink" />
              ) : (
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-live-ink" />
              )}
              <div>
                <div className="font-medium">
                  {s.missingSetting ? 'Settings incomplete' : 'Settings complete'}
                </div>
                {s.missingSetting && (
                  <div className="text-xs text-ink-3">{s.missingSetting} is empty.</div>
                )}
              </div>
            </div>
            <div className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 text-ink-3" />
              <div>
                <div className="font-medium">
                  {s.sealed ? 'Document seal configured' : 'No document seal'}
                </div>
                <div className="text-xs text-ink-3">
                  {s.sealed
                    ? `Executed PDFs are sealed in the name of ${s.legalName}.`
                    : 'Executed PDFs are hashed and verifiable, and marked Unsealed.'}
                </div>
              </div>
            </div>
          </PanelBody>
        </Panel>
        <Panel>
          <PanelHeader>
            <PanelTitle>Set by NetEnroll</PanelTitle>
          </PanelHeader>
          <PanelBody className="space-y-1 text-xs text-ink-2">
            <div>
              Signs as: <span className="text-ink">{s.legalName}</span>
            </div>
            <div>
              Signing links: <span className="font-mono text-ink">{s.linkOrigin}</span>
            </div>
            <div>
              References: <span className="font-mono text-ink">{s.referencePrefix}-XXXXXXXX</span>
            </div>
            <div>
              Brand: <span className="text-ink">{s.brandTheme ?? 'Default'}</span>
            </div>
          </PanelBody>
        </Panel>
      </div>
    </div>
  );
}

function AccessPanel(): JSX.Element {
  const [users, setUsers] = useState<AccessUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await apiClient.get<Envelope<{ users: AccessUser[] }>>('/api/v1/sales/access');
    setUsers(payload(r)?.users ?? null);
    setError(r.error?.message ?? null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function change(user: AccessUser, level: string): Promise<void> {
    setBusy(user.id);
    const r = level
      ? await apiClient.put(`/api/v1/sales/access/${user.id}`, { level })
      : await apiClient.delete(`/api/v1/sales/access/${user.id}`);
    setBusy(null);
    if (r.error) setError(r.error.message);
    else setError(null);
    await load();
  }

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Who can use the Sales CRM</PanelTitle>
      </PanelHeader>
      <PanelBody className="space-y-3">
        <p className="text-xs text-ink-3">
          The owner always has full access. Anyone else in your agency needs to be granted it here.
          Granting access does not change their role in the agency: an agent you grant stays an
          agent everywhere else.
        </p>
        {error && <p className="text-sm text-dropped-ink">{error}</p>}
        {!users ? (
          <div className="text-sm text-ink-3">Loading people</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-rule text-left text-[11px] uppercase tracking-wide text-ink-3">
                <th className="py-2 pr-3 font-medium">Person</th>
                <th className="py-2 pr-3 font-medium">Role</th>
                <th className="py-2 font-medium">Sales CRM access</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-b border-rule last:border-0">
                  <td className="py-2 pr-3">
                    <div>{[u.firstName, u.lastName].filter(Boolean).join(' ') || u.email}</div>
                    <div className="text-xs text-ink-3">{u.email}</div>
                  </td>
                  <td className="py-2 pr-3 text-xs text-ink-2">{u.roles.join(', ') || '—'}</td>
                  <td className="py-2">
                    {u.implicit ? (
                      <Badge variant="success">Owner · full access</Badge>
                    ) : (
                      <select
                        aria-label={`Sales CRM access for ${u.email}`}
                        className={SELECT_CLASS}
                        value={u.level ?? ''}
                        disabled={busy === u.id || u.status !== 'ACTIVE'}
                        onChange={e => void change(u, e.target.value)}
                      >
                        <option value="">No access</option>
                        {(['MANAGER', 'MEMBER', 'READONLY'] as const).map(l => (
                          <option key={l} value={l}>
                            {LEVEL_LABELS[l]}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </PanelBody>
    </Panel>
  );
}

export default function SalesSettingsPage(): JSX.Element {
  return (
    <SalesGate>
      {context => (
        <div className="page-canvas">
          <PageHeader
            title="Sales CRM settings"
            description={`${context.workspace.name}'s agreement suite and Sales CRM access.`}
            actions={
              <Button variant="outline" asChild>
                <Link href="/sales-crm">
                  <ArrowLeft className="mr-1.5 h-4 w-4" />
                  Sales CRM
                </Link>
              </Button>
            }
          />
          <SuitePanel context={context} />
          {context.can.grantAccess && <AccessPanel />}
        </div>
      )}
    </SalesGate>
  );
}
