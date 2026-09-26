'use client';

import { Check, Copy, KeyRound, Loader2, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Notice, StatusChip } from '@/components/domain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiClient } from '@/lib/api';
import { formatTableDateTime } from '@/lib/format-time';

/**
 * Portal access: the logins a buyer or a publisher has to its own portal.
 *
 * ── One section, two owners ──────────────────────────────────────────────────
 *
 * A buyer's logins are users carrying that `buyerId`, a publisher's carry that
 * `publisherId`, and the portal each lands in shows that buyer's or that
 * publisher's calls and nothing else (the API scopes them; see
 * `middleware/auth.ts`). They used to be issued from Team Members, beside the
 * agency's own people; they are issued here now, from the buyer or publisher
 * they belong to, so a login cannot be tied to the wrong one.
 *
 * ── The password is shown once ───────────────────────────────────────────────
 *
 * `POST /api/v1/users/invite` answers with a one-time temporary password, as
 * the invite dialog always has. It is shown here, with a copy button, until
 * the section is closed or another invite is sent -- and never fetched again.
 */

export type PortalKind = 'buyer' | 'publisher';

interface PortalUser {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  status: string;
  lastLoginAt: string | null;
  buyerId?: string | null;
  publisherId?: string | null;
}

interface InviteAnswer {
  email: string;
  tempPassword?: string;
}

/** Enough for every login one agency's buyers or publishers could have. */
const USERS_PATH = '/api/v1/users?limit=500';

function statusTone(status: string): 'live' | 'ringing' | 'neutral' {
  const value = status.toLowerCase();
  if (value === 'active') return 'live';
  if (value === 'pending') return 'ringing';
  return 'neutral';
}

export function PortalAccess({
  kind,
  entityId,
  entityName,
}: {
  kind: PortalKind;
  entityId: string;
  entityName: string;
}): JSX.Element {
  const [users, setUsers] = useState<PortalUser[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [form, setForm] = useState({ email: '', firstName: '', lastName: '' });
  const [saving, setSaving] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const response = await apiClient.get<{ data: PortalUser[] }>(USERS_PATH);
    if (response.error || !response.data) {
      setLoadError(response.error?.message ?? 'Logins could not be loaded.');
      return;
    }
    setLoadError(null);
    setUsers(
      (response.data.data ?? []).filter(user =>
        kind === 'buyer' ? user.buyerId === entityId : user.publisherId === entityId
      )
    );
  }, [kind, entityId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function invite(): Promise<void> {
    setSaving(true);
    setInviteError(null);
    try {
      const response = await apiClient.post<InviteAnswer>('/api/v1/users/invite', {
        email: form.email.trim(),
        firstName: form.firstName.trim() || undefined,
        lastName: form.lastName.trim() || undefined,
        role: kind === 'buyer' ? 'BUYER' : 'PUBLISHER',
        ...(kind === 'buyer' ? { buyerId: entityId } : { publisherId: entityId }),
      });
      if (response.error || !response.data) {
        setInviteError(response.error?.message ?? 'The invite was not sent.');
        return;
      }
      setIssued(
        response.data.tempPassword
          ? { email: response.data.email, password: response.data.tempPassword }
          : null
      );
      setCopied(false);
      setInviting(false);
      setForm({ email: '', firstName: '', lastName: '' });
      void load();
    } finally {
      setSaving(false);
    }
  }

  async function copyPassword(): Promise<void> {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.password);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim());
  const noun = kind === 'buyer' ? 'buyer' : 'publisher';

  return (
    <section
      className="flex flex-col gap-3"
      aria-label={`Portal access for ${entityName}`}
      data-portal-access={kind}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <KeyRound className="h-4 w-4 text-ink-3" />
          Portal access
        </h3>
        {!inviting ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => setInviting(true)}
          >
            <UserPlus className="mr-1 h-3 w-3" />
            Invite to portal
          </Button>
        ) : null}
      </div>

      {issued ? (
        <Notice tone="info" title={`${issued.email} can sign in now`}>
          <p className="t-body">
            Temporary password, shown once. Send it to them securely; they change it when they first
            sign in.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="t-data rounded bg-sunken px-2 py-1 text-ink" data-temp-password>
              {issued.password}
            </code>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => void copyPassword()}
              aria-label="Copy temporary password"
            >
              {copied ? <Check className="mr-1 h-3 w-3" /> : <Copy className="mr-1 h-3 w-3" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </Notice>
      ) : null}

      {inviting ? (
        <div className="grid gap-3 rounded-control border border-rule bg-surface p-3">
          <div className="grid gap-1.5">
            <Label htmlFor={`portal-email-${entityId}`}>Email *</Label>
            <Input
              id={`portal-email-${entityId}`}
              type="email"
              value={form.email}
              onChange={event => setForm(f => ({ ...f, email: event.target.value }))}
              placeholder={`someone@${noun}.com`}
              disabled={saving}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor={`portal-first-${entityId}`}>First name</Label>
              <Input
                id={`portal-first-${entityId}`}
                value={form.firstName}
                onChange={event => setForm(f => ({ ...f, firstName: event.target.value }))}
                disabled={saving}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`portal-last-${entityId}`}>Last name</Label>
              <Input
                id={`portal-last-${entityId}`}
                value={form.lastName}
                onChange={event => setForm(f => ({ ...f, lastName: event.target.value }))}
                disabled={saving}
              />
            </div>
          </div>
          <p className="t-meta text-ink-3">
            They sign in to the {noun} portal and see {entityName}&apos;s calls, and nothing else.
          </p>
          {inviteError ? <Notice tone="error" title={inviteError} /> : null}
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setInviting(false);
                setInviteError(null);
              }}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={() => void invite()} disabled={saving || !emailValid}>
              {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              Send invite
            </Button>
          </div>
        </div>
      ) : null}

      {loadError ? (
        <Notice tone="error" title={loadError} />
      ) : users === null ? (
        <div className="flex items-center gap-2 t-meta text-ink-3">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading logins
        </div>
      ) : users.length === 0 ? (
        <p className="t-meta text-ink-3">No one from {entityName} can sign in yet.</p>
      ) : (
        <ul className="divide-y divide-rule rounded-control border border-rule bg-surface">
          {users.map(user => {
            const name = [user.firstName, user.lastName].filter(Boolean).join(' ');
            return (
              <li
                key={user.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                data-portal-user={user.id}
              >
                <div className="min-w-0">
                  <div className="truncate t-body text-ink">{name || user.email}</div>
                  {name ? <div className="truncate t-meta text-ink-3">{user.email}</div> : null}
                </div>
                <div className="flex items-center gap-3">
                  <span className="t-meta text-ink-3">
                    {user.lastLoginAt
                      ? `Last signed in ${formatTableDateTime(user.lastLoginAt)}`
                      : 'Never signed in'}
                  </span>
                  <StatusChip
                    value={user.status.toUpperCase()}
                    label={user.status.charAt(0).toUpperCase() + user.status.slice(1).toLowerCase()}
                    tone={statusTone(user.status)}
                    size="sm"
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
