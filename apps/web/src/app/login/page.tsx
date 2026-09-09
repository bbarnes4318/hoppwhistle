'use client';

import { AlertCircle, Check, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import {
  useCallback,
  useEffect,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from 'react';

import { Wordmark } from '@/components/brand/wordmark';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/use-auth';
import { getRedirectPath } from '@/lib/roles';
import { persistSessionToken } from '@/lib/session-token';
import { cn } from '@/lib/utils';

/**
 * Public OAuth client identifier — not a secret; it ships in the page HTML.
 *
 * The API hardcodes this same id (apps/api/src/services/google-auth.ts) and
 * verifies every token against it, so a sign-in only works when the two match.
 * They are not independently configurable in practice, and treating this as
 * environment-specific is what broke it: the value came only from
 * NEXT_PUBLIC_GOOGLE_CLIENT_ID, nothing set it, and because Next.js inlines
 * NEXT_PUBLIC_* at build time the buttons silently vanished on the next
 * rebuild with no error anywhere.
 *
 * The default is the working id. The env var still overrides it for anyone
 * pointing a build at a different Google project — and `||`, not `??`, because
 * compose passes an empty string rather than leaving it undefined.
 */
const DEFAULT_GOOGLE_CLIENT_ID =
  '196207148120-2navmspp2renu5cnvr06679jvhm5h12h.apps.googleusercontent.com';
const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_CLIENT_ID;
const API_BASE =
  typeof window !== 'undefined'
    ? window.location.origin
    : process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

/**
 * The focus treatment, on every control this page owns.
 *
 * globals.css gives the product one `:focus-visible` outline, but `Input` and
 * `Button` both cancel it with `focus-visible:outline-none` and draw a ring
 * instead — and `Input`'s ring is a single pixel. This is the only screen a
 * person reaches with no session and possibly no mouse, so every field, every
 * button and every link here carries the same two-pixel offset ring in
 * --brand-ink. `cn` is tailwind-merge, so this wins over the primitive's own.
 */
const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-ink ' +
  'focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

/** One field, so the eleven inputs on this page cannot drift apart. */
const FIELD = cn('h-10 w-full rounded-control border-rule bg-surface text-sm text-ink', FOCUS_RING);

interface AuthResponse {
  token: string;
  csrfToken: string;
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    roles: string[];
    buyerId?: string | null;
  };
}

interface PasswordStrength {
  score: number;
  hasLength: boolean;
  hasUppercase: boolean;
  hasNumber: boolean;
}

/** The same three rules `PASSWORD_REGEX` enforces in apps/api/src/routes/auth.ts. */
function validatePasswordStrength(password: string): PasswordStrength {
  const hasLength = password.length >= 8;
  const hasUppercase = /[A-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  const score = [hasLength, hasUppercase, hasNumber].filter(Boolean).length;
  return { score, hasLength, hasUppercase, hasNumber };
}

/**
 * Read an error out of a response without ever producing an empty panel.
 *
 * `res.json()` throws on a body that is not JSON — an nginx 502, a proxy's
 * HTML error page — and the thrown SyntaxError is what used to reach the
 * banner. Every failure gets a sentence a person can act on: the server's own
 * message when there is one, and a plain description of the status when there
 * is not.
 */
async function messageFor(res: Response, fallback: string): Promise<string> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Not JSON. The status is all there is to go on.
  }
  const message = (body as { error?: { message?: string } } | null)?.error?.message;
  if (typeof message === 'string' && message.trim()) return message.trim();
  if (res.status >= 500) return `${fallback} The server is not answering right now.`;
  return `${fallback} (HTTP ${res.status})`;
}

interface GoogleAccountsWindow extends Window {
  google?: {
    accounts: {
      id: {
        initialize: (config: Record<string, unknown>) => void;
        renderButton: (el: HTMLElement | null, config: Record<string, unknown>) => void;
      };
    };
  };
}

/**
 * A slot that Google renders its own button into.
 *
 * WHY THIS IS NOT AN EFFECT DOING getElementById.
 *
 * It used to be, and that is why the button never appeared on the second
 * panel. The slot is inside a conditionally rendered branch, so on the commit
 * where that branch first becomes the one being shown, the container exists in
 * the element tree but is not yet in the document. The effect ran on that
 * commit, looked the id up, got null, and returned — and because nothing about
 * the next commit changed the state it depended on, it never ran again.
 *
 * A ref callback has no such ordering to get wrong: React invokes it with the
 * node at the moment the node is attached, whenever that turns out to be. It
 * is kept in state so the draw below re-runs for either order — the panel
 * mounted before the Google script loaded, and after.
 *
 * The width is measured rather than fixed. Google draws to an integer pixel
 * width, so the 300 this used to pass overflowed the card on a 360px phone;
 * the button is redrawn when the measurement actually changes, which is a
 * rotation or a resize and not the redraw itself.
 */
function GoogleButton({
  ready,
  text,
  id,
}: {
  ready: boolean;
  text: 'continue_with' | 'signup_with';
  id: string;
}): JSX.Element {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);
  const mount = useCallback((node: HTMLDivElement | null) => setSlot(node), []);

  useEffect(() => {
    if (!slot || !ready) return;
    const googleWindow = window as unknown as GoogleAccountsWindow;
    const accounts = googleWindow.google?.accounts;
    if (!accounts) return;

    let drawnAt = 0;
    const draw = () => {
      const measured = Math.round(slot.getBoundingClientRect().width);
      // Google's own accepted range. 320 is the fallback for a slot measured
      // at zero, which is what a display:none ancestor reports.
      const width = Math.min(400, Math.max(200, measured || 320));
      if (width === drawnAt) return;
      drawnAt = width;
      // React does not own these children — Google does — so clearing first is
      // what stops a redraw stacking a second button under the first.
      slot.replaceChildren();
      accounts.id.renderButton(slot, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text,
        shape: 'rectangular',
        logo_alignment: 'left',
        width,
      });
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(slot);
    return () => observer.disconnect();
  }, [slot, ready, text]);

  return <div id={id} ref={mount} className="flex w-full justify-center" />;
}

/** The error and the invitation notice are the same shape; only the tone moves. */
function Banner({ tone, children }: { tone: 'error' | 'info'; children: ReactNode }) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-control border px-3 py-2.5',
        tone === 'error'
          ? 'border-dropped bg-dropped-tint text-dropped-ink'
          : 'border-rule bg-sunken text-ink-2'
      )}
    >
      {tone === 'error' ? (
        <AlertCircle className="mt-px h-4 w-4 shrink-0" aria-hidden="true" />
      ) : null}
      <p className="t-body min-w-0">{children}</p>
    </div>
  );
}

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="t-meta block font-medium text-ink-2">
      {children}
    </label>
  );
}

export default function AuthPage() {
  const router = useRouter();

  /**
   * Tell the session provider about the token before navigating.
   *
   * `AuthSessionProvider` lives in the root layout and asks `/api/auth/me`
   * exactly once, when it mounts. On this page it mounts while there is no
   * token, so it settles on `user: null` -- and a client-side push to
   * /dashboard does not remount it. The dashboard layout then reads that stale
   * null and replaces the route back to /login, which is what a signed-in user
   * saw: correct credentials, a stored token, and the sign-in page again. It
   * cleared on a manual reload, which is why it looked intermittent.
   *
   * Refetching first is what makes the session real to the rest of the app
   * before anything navigates. `refetch` resolves either way -- it reports a
   * failure through the provider's own error state rather than throwing -- so
   * this cannot strand someone who is holding a valid token.
   */
  const { refetch: refreshSession } = useAuth();

  const enter = useCallback(
    async (auth: AuthResponse) => {
      persistSessionToken(auth.token);
      await refreshSession();
      router.push(getRedirectPath(auth.user.roles));
    },
    [refreshSession, router]
  );

  /**
   * Which of the two things this page does. Read from the URL and from nothing
   * else: there is no self-serve registration, so there is no control on this
   * page that puts it into 'activate'. A person gets here with an invitation
   * link or they get here to sign in.
   */
  const [mode, setMode] = useState<'signin' | 'activate'>('signin');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [position, setPosition] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  /**
   * The activation token from the invitation link, e.g.
   * `https://agents.netenroll.com/login?activation=<token>&email=<address>`.
   *
   * Signing up is not something a stranger can do from this page. The server
   * used to work out which agency a new account belonged to by looking at the
   * request -- Host, then Referer, then Origin, then whichever tenant row
   * happened to be oldest -- which on a shared host put strangers inside a
   * paying agency. The tenant now travels with this token, which the server
   * issued when it verified an administrator's invitation, and
   * `POST /api/auth/register` refuses without one.
   */
  const [activationToken, setActivationToken] = useState('');
  const [agencyName, setAgencyName] = useState<string | null>(null);
  /*
   * Set when the server has answered that this link cannot be used. It is what
   * takes the invitation notice down: "This link is not valid" directly above
   * "You have been invited to join…" is two answers to the same question.
   */
  const [invitationRefused, setInvitationRefused] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleLoaded, setGoogleLoaded] = useState(false);
  // Set once accounts.id.initialize() has run; the buttons cannot render before it.
  const [googleReady, setGoogleReady] = useState(false);

  const passwordStrength = validatePasswordStrength(password);

  const handleGoogleResponse = useCallback(
    async (response: { credential: string }) => {
      setIsLoading(true);
      setError(null);

      try {
        const res = await fetch(`${API_BASE}/api/auth/google`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // The token is sent when there is one. An existing account signs in
          // without it; a brand new Google identity needs it for the same
          // reason the email path does -- there is no safe way to guess which
          // agency a stranger belongs to.
          body: JSON.stringify({
            credential: response.credential,
            ...(activationToken ? { activationToken } : {}),
          }),
          credentials: 'include',
        });

        if (!res.ok) {
          throw new Error(await messageFor(res, 'Google could not sign you in.'));
        }

        await enter((await res.json()) as AuthResponse);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Google could not sign you in.');
      } finally {
        setIsLoading(false);
      }
    },
    [enter, activationToken]
  );

  /**
   * Pick the invitation up out of the URL and show who it is for.
   *
   * The preview call consumes nothing -- the grant is still single-use
   * afterwards -- and answers only with the agency's display name, never its
   * id, so a stolen link cannot be turned into a tenant identifier.
   *
   * A rejected preview is now SHOWN. It is the server's own answer for a link
   * that has expired or has already been used, and telling someone that before
   * they choose a password is the difference between a clear refusal and a
   * form that fails after they have filled it in. Only a rejection is
   * surfaced: a preview that could not be reached at all leaves the form
   * alone, because registration validates the token again either way.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('activation');
    if (!token) return;

    const invitedEmail = params.get('email') ?? '';
    setActivationToken(token);
    setMode('activate');
    if (invitedEmail) setEmail(invitedEmail);

    if (!invitedEmail) return;

    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/auth/activation/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: invitedEmail, activationToken: token }),
        });
        if (!res.ok) {
          setError(await messageFor(res, 'This invitation link cannot be used.'));
          setInvitationRefused(true);
          return;
        }
        const data = (await res.json()) as { agencyName?: string };
        if (data.agencyName) setAgencyName(data.agencyName);
      } catch {
        // Unreachable, not rejected. Registration still validates the token.
      }
    })();
  }, []);

  // Initialize the Google client once the script is in. Rendering the buttons is
  // deliberately NOT done here -- see GoogleButton above for why.
  useEffect(() => {
    if (!googleLoaded || !GOOGLE_CLIENT_ID) return;
    const googleWindow = window as unknown as GoogleAccountsWindow;
    if (!googleWindow.google) return;

    googleWindow.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleGoogleResponse as unknown as (res: unknown) => void,
      auto_select: false,
      cancel_on_tap_outside: true,
    });
    setGoogleReady(true);
  }, [googleLoaded, handleGoogleResponse]);

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      });

      if (!res.ok) {
        throw new Error(await messageFor(res, 'We could not sign you in.'));
      }

      await enter((await res.json()) as AuthResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not sign you in.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleActivate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (passwordStrength.score < 3) {
      setError('Please choose a password that meets all three requirements below.');
      return;
    }

    if (!activationToken) {
      setError(
        'An invitation link is required to create an account. ' +
          'Your agency administrator can send you one.'
      );
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, firstName, lastName, position, activationToken }),
        credentials: 'include',
      });

      if (!res.ok) {
        throw new Error(await messageFor(res, 'We could not set up your account.'));
      }

      // 201 with a token and a session. The activation grant IS the approval --
      // it exists because the server verified an administrator's invitation --
      // so there is no second manual step to wait on. This used to be a 202
      // with no token and a PENDING account, which left a paying customer with
      // no way in.
      await enter((await res.json()) as AuthResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not set up your account.');
    } finally {
      setIsLoading(false);
    }
  };

  const passwordField = (id: string, autoComplete: 'current-password' | 'new-password') => (
    <div className="relative">
      <Input
        id={id}
        type={showPassword ? 'text' : 'password'}
        value={password}
        onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
        required
        autoComplete={autoComplete}
        className={cn(FIELD, 'pr-11')}
      />
      <button
        type="button"
        onClick={() => setShowPassword(!showPassword)}
        aria-label={showPassword ? 'Hide password' : 'Show password'}
        aria-pressed={showPassword}
        className={cn(
          'absolute right-1 top-1/2 flex h-8 w-9 -translate-y-1/2 items-center justify-center',
          'rounded-control text-ink-2 hover:text-ink',
          FOCUS_RING
        )}
      >
        {showPassword ? (
          <EyeOff className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Eye className="h-4 w-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );

  /*
   * Only drawn once Google's script has initialised. The slot above it is
   * always mounted -- the ref has to be able to attach, and a hidden slot
   * measures zero and would draw the button at the wrong width -- but an "or"
   * with nothing above it is a dead end for anyone whose network or extension
   * blocks accounts.google.com, which is who this branch is for.
   */
  const divider = (label: string) => (
    <div className="relative py-1" aria-hidden="true">
      <div className="absolute inset-0 flex items-center">
        <span className="w-full border-t border-rule" />
      </div>
      <div className="relative flex justify-center">
        <span className="t-meta bg-surface px-3 text-ink-2">{label}</span>
      </div>
    </div>
  );

  return (
    <>
      <Script
        src="https://accounts.google.com/gsi/client"
        onLoad={() => setGoogleLoaded(true)}
        strategy="lazyOnload"
      />

      {/*
        The one screen that runs before there is a session, and — since the
        root of agents.netenroll.com redirects here — the front door of the
        domain. One centred card on --paper, the wordmark above it, and the
        line under the wordmark that tells someone who arrived by mistake
        whether this is for them. Nothing decorative: no gradient, no hero, no
        marketing copy. Brand green appears on the primary action and the focus
        ring, and nowhere else.
      */}
      <main className="flex min-h-screen flex-col bg-paper px-4 py-10 sm:px-6 sm:py-16">
        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center">
          <header className="text-center">
            <h1>
              <Wordmark size="lg" />
            </h1>
            <p className="t-body mt-3 text-ink-2">
              The agent portal for licensed insurance agencies.
            </p>
          </header>

          <section
            aria-labelledby="auth-heading"
            className="mt-8 rounded-card border border-rule bg-surface p-6 sm:p-8"
          >
            <h2 id="auth-heading" className="t-title text-ink">
              {mode === 'signin' ? 'Sign in' : 'Set your password'}
            </h2>
            <p className="t-body mt-1.5 text-ink-2">
              {mode === 'signin'
                ? 'Use the account your agency set up for you.'
                : 'Choose a password to finish setting up your account.'}
            </p>

            {error ? (
              <div className="mt-5">
                <Banner tone="error">{error}</Banner>
              </div>
            ) : null}

            {mode === 'signin' ? (
              <div className="mt-6 space-y-6">
                <GoogleButton ready={googleReady} text="continue_with" id="google-signin-button" />

                {googleReady ? divider('or') : null}

                <form onSubmit={e => void handleLogin(e)} className="space-y-4">
                  <div className="space-y-1.5">
                    <FieldLabel htmlFor="signin-email">Email address</FieldLabel>
                    <Input
                      id="signin-email"
                      type="email"
                      placeholder="you@agency.com"
                      value={email}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                      autoFocus
                      className={FIELD}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <FieldLabel htmlFor="signin-password">Password</FieldLabel>
                    {passwordField('signin-password', 'current-password')}
                  </div>

                  <Button
                    type="submit"
                    className={cn('h-10 w-full', FOCUS_RING)}
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : null}
                    Sign in
                  </Button>
                </form>

                {/*
                  There is no self-serve registration and no password-reset
                  route to link to. Saying who to ask is more use than a link
                  that does not exist.
                */}
                <p className="t-meta text-center text-ink-2">
                  Accounts are created by invitation. If you need one, or you cannot get in, please
                  ask your agency administrator.
                </p>
              </div>
            ) : (
              <div className="mt-6 space-y-6">
                {/*
                  Which agency this invitation is for, when the link named one.
                  Worth showing before the password field: an agent following a
                  link should be able to see they are joining the right agency,
                  and someone who is not expecting an invitation should be able
                  to see that they are not.
                */}
                {invitationRefused ? null : (
                  <Banner tone="info">
                    {agencyName
                      ? `You have been invited to join ${agencyName}.`
                      : 'You have been invited to join the agency that sent you this link.'}
                  </Banner>
                )}

                <GoogleButton ready={googleReady} text="signup_with" id="google-activate-button" />

                {googleReady ? divider('or') : null}

                <form onSubmit={e => void handleActivate(e)} className="space-y-4">
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <FieldLabel htmlFor="activate-firstname">First name</FieldLabel>
                      <Input
                        id="activate-firstname"
                        type="text"
                        value={firstName}
                        onChange={(e: ChangeEvent<HTMLInputElement>) =>
                          setFirstName(e.target.value)
                        }
                        autoComplete="given-name"
                        className={FIELD}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <FieldLabel htmlFor="activate-lastname">Last name</FieldLabel>
                      <Input
                        id="activate-lastname"
                        type="text"
                        value={lastName}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setLastName(e.target.value)}
                        autoComplete="family-name"
                        className={FIELD}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <FieldLabel htmlFor="activate-email">Email address</FieldLabel>
                    <Input
                      id="activate-email"
                      type="email"
                      placeholder="you@agency.com"
                      value={email}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                      required
                      autoComplete="email"
                      className={FIELD}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <FieldLabel htmlFor="activate-position">Position</FieldLabel>
                    <select
                      id="activate-position"
                      value={position}
                      onChange={e => setPosition(e.target.value)}
                      required
                      className={cn(FIELD, 'border px-3')}
                    >
                      <option value="">Select a position…</option>
                      <option value="Licensed Agent">Licensed Agent</option>
                      <option value="Sales Support">Sales Support</option>
                      <option value="Retention">Retention</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <FieldLabel htmlFor="activate-password">Password</FieldLabel>
                    {passwordField('activate-password', 'new-password')}

                    {/*
                      The three rules the API enforces, listed rather than
                      scored: "weak" tells someone nothing they can act on.
                      Announced politely — a person typing does not need each
                      keystroke read out, so the region is polite, not assertive.
                    */}
                    <ul className="space-y-1 pt-1.5" aria-live="polite">
                      {[
                        { met: passwordStrength.hasLength, label: 'At least 8 characters' },
                        { met: passwordStrength.hasUppercase, label: 'One uppercase letter' },
                        { met: passwordStrength.hasNumber, label: 'One number' },
                      ].map(rule => (
                        <li
                          key={rule.label}
                          className={cn(
                            't-meta flex items-center gap-1.5',
                            rule.met ? 'text-live-ink' : 'text-ink-2'
                          )}
                        >
                          {rule.met ? (
                            <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          ) : (
                            <span
                              className="h-1 w-1 shrink-0 rounded-full bg-ink-3"
                              aria-hidden="true"
                            />
                          )}
                          <span>{rule.label}</span>
                          <span className="sr-only">{rule.met ? ' — met' : ' — not yet met'}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <Button
                    type="submit"
                    className={cn('h-10 w-full', FOCUS_RING)}
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : null}
                    Create my account
                  </Button>
                </form>
              </div>
            )}
          </section>

          {/*
            Underlined rather than green. Brand green carries the primary
            action on this page and, through globals.css, the focus ring; a
            second green thing at the bottom of the card would make the accent
            mean less on the one screen where it has to mean "this is the
            button".
          */}
          <p className="t-meta mt-6 text-center text-ink-2">
            By continuing, you agree to our{' '}
            <a
              href="/legal/terms"
              className={cn(
                'rounded-control text-ink underline underline-offset-2 hover:text-brand-ink',
                FOCUS_RING
              )}
            >
              Terms of Service
            </a>
            .
          </p>
        </div>
      </main>
    </>
  );
}
