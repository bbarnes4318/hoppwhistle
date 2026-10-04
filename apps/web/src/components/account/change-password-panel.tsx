'use client';

import { Check, Eye, EyeOff, KeyRound, Loader2, X } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';

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
import { cn } from '@/lib/utils';

import {
  PASSWORD_STRENGTH_LABELS,
  passwordStrength,
  type PasswordStrength,
} from './account-identity';

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
 *
 * ── A login with no password ─────────────────────────────────────────────────
 *
 * A Google sign-up has no password to change, and the API would refuse the
 * form whatever was typed. It is told how to set one instead.
 */

/** The API's floor for a new password (`routes/password.ts`). */
export const MIN_NEW_PASSWORD_LENGTH = 10;

const STRENGTH_BAR: Record<PasswordStrength, string> = {
  0: 'bg-dropped',
  1: 'bg-dropped',
  2: 'bg-ringing',
  3: 'bg-live',
  4: 'bg-live',
};

const STRENGTH_TEXT: Record<PasswordStrength, string> = {
  0: 'text-ink-3',
  1: 'text-dropped-ink',
  2: 'text-ringing-ink',
  3: 'text-live-ink',
  4: 'text-live-ink',
};

export function ChangePasswordPanel({
  hasPassword = true,
  readOnly = false,
  username,
}: {
  /** The login's email, so a password manager files the new password under it. */
  username?: string;
  /** False for a login that signs in with Google and has never set a password. */
  hasPassword?: boolean;
  /** A read-only role preview: the server refuses the write, so say so here. */
  readOnly?: boolean;
}): JSX.Element {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const strength = passwordStrength(next, MIN_NEW_PASSWORD_LENGTH);
  // Anything typed lights at least the first segment, red until it is long enough.
  const filledSegments = next.length === 0 ? 0 : Math.max(1, strength);
  const checks = [
    {
      met: next.length >= MIN_NEW_PASSWORD_LENGTH,
      label: `At least ${MIN_NEW_PASSWORD_LENGTH} characters`,
    },
    { met: next.length > 0 && next === confirm, label: 'Both new passwords match' },
    { met: next.length > 0 && next !== current, label: 'Different from your current password' },
  ];

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
        {!hasPassword ? (
          <Notice tone="info" title="You sign in with Google">
            This login has no password of its own. To add one, sign out and choose &ldquo;Forgot
            password?&rdquo; on the sign-in page; we will email you a link to set it.
          </Notice>
        ) : (
          <form
            onSubmit={e => void submit(e)}
            className="grid gap-8 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]"
          >
            <div className="grid content-start gap-4">
              {/* For password managers: which login this new password belongs to. */}
              {username ? (
                <input
                  type="text"
                  name="username"
                  autoComplete="username"
                  value={username}
                  readOnly
                  hidden
                />
              ) : null}
              <PasswordField
                label="Current password"
                autoComplete="current-password"
                value={current}
                onChange={setCurrent}
                disabled={saving || readOnly}
              />
              <div className="grid gap-1.5">
                <PasswordField
                  label="New password"
                  autoComplete="new-password"
                  value={next}
                  onChange={setNext}
                  minLength={MIN_NEW_PASSWORD_LENGTH}
                  disabled={saving || readOnly}
                  describedBy="new-password-strength"
                />
                <div id="new-password-strength" className="grid gap-1.5" aria-live="polite">
                  <div className="grid grid-cols-4 gap-1" aria-hidden>
                    {[1, 2, 3, 4].map(step => (
                      <span
                        key={step}
                        className={cn(
                          'h-1 rounded-full transition-colors duration-200',
                          step <= filledSegments ? STRENGTH_BAR[strength] : 'bg-sunken'
                        )}
                      />
                    ))}
                  </div>
                  <p className="t-meta text-ink-3">
                    {next.length === 0 ? (
                      <>At least {MIN_NEW_PASSWORD_LENGTH} characters.</>
                    ) : (
                      <>
                        Strength:{' '}
                        <span className={cn('font-medium', STRENGTH_TEXT[strength])}>
                          {PASSWORD_STRENGTH_LABELS[strength]}
                        </span>
                      </>
                    )}
                  </p>
                </div>
              </div>
              <PasswordField
                label="Confirm new password"
                autoComplete="new-password"
                value={confirm}
                onChange={setConfirm}
                disabled={saving || readOnly}
              />

              {error ? <Notice tone="error" title={error} /> : null}
              {done ? <Notice tone="info" title="Your password has been changed." /> : null}

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="submit"
                  disabled={saving || readOnly || !current || !next || !confirm}
                >
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Change password
                </Button>
                {readOnly ? (
                  <span className="t-meta text-ink-3">Not available in a read-only preview.</span>
                ) : null}
              </div>
            </div>

            <aside className="h-fit rounded-card border border-rule bg-paper p-4">
              <h3 className="text-sm font-semibold text-ink">Password requirements</h3>
              <ul className="mt-3 grid gap-2">
                {checks.map(check => (
                  <li key={check.label} className="flex items-center gap-2 text-sm">
                    <span
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded-full',
                        check.met ? 'bg-live text-white' : 'bg-sunken text-ink-3'
                      )}
                    >
                      {check.met ? (
                        <Check aria-hidden className="h-3 w-3" strokeWidth={3} />
                      ) : (
                        <X aria-hidden className="h-2.5 w-2.5" strokeWidth={3} />
                      )}
                    </span>
                    <span className={check.met ? 'text-ink' : 'text-ink-2'}>
                      {check.label}
                      <span className="sr-only">{check.met ? ' (met)' : ' (not yet)'}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="t-meta mt-4 border-t border-rule pt-3 text-ink-3">
                A long passphrase of unrelated words is stronger than a short password full of
                symbols. Don&rsquo;t reuse a password from another site.
              </p>
            </aside>
          </form>
        )}
      </PanelBody>
    </Panel>
  );
}

function PasswordField({
  label,
  autoComplete,
  value,
  onChange,
  disabled,
  minLength,
  describedBy,
}: {
  label: string;
  autoComplete: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  minLength?: number;
  describedBy?: string;
}): JSX.Element {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          onChange={e => onChange(e.target.value)}
          minLength={minLength}
          required
          disabled={disabled}
          aria-describedby={describedBy}
          className="pr-10"
        />
        <button
          type="button"
          onClick={() => setVisible(v => !v)}
          className={cn(
            'absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-control text-ink-3',
            'transition-colors duration-150 hover:text-ink',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
          )}
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          aria-pressed={visible}
        >
          {visible ? (
            <EyeOff aria-hidden className="h-4 w-4" />
          ) : (
            <Eye aria-hidden className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );
}
