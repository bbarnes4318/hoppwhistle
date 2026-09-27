'use client';

import { KeyRound, Loader2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';

import {
  Notice,
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
} from '@/components/domain';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiClient } from '@/lib/api';

/**
 * Changing your own password, from Account. Every role has it -- agents,
 * owners, and the buyer and publisher portal logins alike.
 *
 * ── The token is replaced, not kept ──────────────────────────────────────────
 *
 * `PATCH /api/auth/me/password` revokes every session the account had,
 * including the one making the request, and answers with a fresh token. It is
 * stored through `apiClient.setToken` (which writes localStorage and the
 * session cookie together, see `lib/session-token.ts`) so this tab stays signed
 * in; any other device is signed out, which is the point of changing it.
 */

/** The API's floor for a new password (`routes/password.ts`). */
export const MIN_NEW_PASSWORD_LENGTH = 10;

export function ChangePasswordPanel(): JSX.Element {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setDone(false);
    if (next.length < MIN_NEW_PASSWORD_LENGTH) {
      setError(`Your new password must be at least ${MIN_NEW_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (next !== confirm) {
      setError('The two new passwords do not match.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await apiClient.patch<{ ok: boolean; token: string }>(
        '/api/auth/me/password',
        { currentPassword: current, newPassword: next }
      );
      if (response.error || !response.data?.token) {
        setError(
          response.error?.code === 'INVALID_CURRENT_PASSWORD'
            ? 'Your current password is not right.'
            : (response.error?.message ?? 'Your password was not changed.')
        );
        return;
      }
      apiClient.setToken(response.data.token);
      setCurrent('');
      setNext('');
      setConfirm('');
      setDone(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel data-change-password>
      <PanelHeader>
        <PanelTitle className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-ink-3" aria-hidden />
          Change password
        </PanelTitle>
        <PanelDescription>
          You stay signed in here. Every other device signed in to this account is signed out.
        </PanelDescription>
      </PanelHeader>
      <PanelBody>
        <form onSubmit={e => void submit(e)} className="grid max-w-md gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="current-password">Current password</Label>
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={e => setCurrent(e.target.value)}
              required
              disabled={saving}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={e => setNext(e.target.value)}
              minLength={MIN_NEW_PASSWORD_LENGTH}
              required
              disabled={saving}
            />
            <p className="t-meta text-ink-3">At least {MIN_NEW_PASSWORD_LENGTH} characters.</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              required
              disabled={saving}
            />
          </div>

          {error ? <Notice tone="error" title={error} /> : null}
          {done ? <Notice tone="info" title="Your password has been changed." /> : null}

          <div>
            <Button type="submit" disabled={saving || !current || !next || !confirm}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Change password
            </Button>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}
