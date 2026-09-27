'use client';

import { AlertCircle, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { Logo } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/**
 * Choosing a new password from an emailed reset link: `/reset-password?token=…`.
 *
 * The token is single-use and short-lived; the server says INVALID_RESET_TOKEN
 * for one that is unknown, used or expired, and that sentence is shown as it
 * comes. On success every session the account had is gone, so the person is
 * sent to /login to sign in with the new password rather than signed in here.
 *
 * The token is read from `window.location` in an effect rather than through
 * `useSearchParams`, the same as /login, so the page needs no Suspense
 * boundary to build.
 */

const API_BASE =
  typeof window !== 'undefined'
    ? window.location.origin
    : process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

/** The API's own floor for a new password (`routes/password.ts`). */
const MIN_PASSWORD_LENGTH = 10;

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-surface';
const FIELD = cn('h-10 w-full rounded-control border-rule bg-surface text-sm text-ink', FOCUS_RING);

export default function ResetPasswordPage(): JSX.Element {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get('token') ?? '');
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Your new password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/auth/password-reset/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(
          body?.error?.message ||
            'This reset link cannot be used. Ask for a new one from the sign-in page.'
        );
        return;
      }
      router.push('/login?reset=done');
    } catch {
      setError('The server is not answering right now. Try again in a moment.');
    } finally {
      setSaving(false);
    }
  }

  const missingToken = token === '';

  return (
    <main className="flex min-h-screen flex-col bg-paper px-4 py-10 sm:px-6 sm:py-16">
      <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center">
        <header className="text-center">
          <h1>
            <Logo width={272} />
          </h1>
        </header>

        <section
          aria-labelledby="reset-heading"
          className="mt-8 rounded-card border border-rule bg-surface p-6 sm:p-8"
        >
          <h2 id="reset-heading" className="t-title text-ink">
            Choose a new password
          </h2>

          {error || missingToken ? (
            <div
              role="alert"
              className="mt-5 flex items-start gap-2.5 rounded-control border border-dropped bg-dropped-tint px-3 py-2.5 text-dropped-ink"
            >
              <AlertCircle className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />
              <p className="t-body min-w-0">
                {error ??
                  'This link is missing its reset code. Open the link from your email again, or ask for a new one from the sign-in page.'}
              </p>
            </div>
          ) : null}

          <form onSubmit={e => void submit(e)} className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="reset-password" className="t-meta block font-medium text-ink-2">
                New password
              </label>
              <Input
                id="reset-password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
                className={FIELD}
              />
              <p className="t-meta text-ink-2">At least {MIN_PASSWORD_LENGTH} characters.</p>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="reset-confirm" className="t-meta block font-medium text-ink-2">
                Confirm new password
              </label>
              <Input
                id="reset-confirm"
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                required
                autoComplete="new-password"
                className={FIELD}
              />
            </div>
            <Button
              type="submit"
              className={cn('h-10 w-full', FOCUS_RING)}
              disabled={saving || !token || !password || !confirm}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Set new password
            </Button>
          </form>

          <p className="t-meta mt-6 text-center text-ink-2">
            <a
              href="/login"
              className={cn(
                'rounded-control text-ink underline underline-offset-2 hover:text-brand-ink',
                FOCUS_RING
              )}
            >
              Back to sign in
            </a>
          </p>
        </section>
      </div>
    </main>
  );
}
