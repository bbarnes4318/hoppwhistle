'use client';

import { AlertCircle, Check, ChevronDown, Eye, EyeOff, Info, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from 'react';

import { LoginBrandLogo, useLoginBrand, useLoginSurface } from '@/components/brand/login-brand';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/use-auth';
import { usePlatformContext } from '@/hooks/use-platform-context';
import { clearConsoleExit } from '@/lib/console-exit';
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

/**
 * One field, so the eleven inputs on this page cannot drift apart.
 *
 * 48px tall: this is the one screen everyone types into first, often on a
 * phone. Text is 16px below 640px because iOS zooms into any field set
 * smaller, and 15px above it. Focus turns the border --brand-ink and lays a
 * one-pixel --brand-ink line inside a soft halo, so the indicator is a solid
 * two-pixel edge (the same weight as FOCUS_RING) without a gap around a field.
 */
const FIELD = cn(
  'h-12 w-full rounded-control border-[color:var(--auth-field-rule)] bg-surface px-3.5 text-base text-ink sm:text-[15px]',
  'placeholder:text-ink-3 hover:border-[color:var(--auth-field-hover)]',
  'transition-[border-color,box-shadow] duration-150 ease-out ne-motion',
  'focus-visible:border-brand-ink focus-visible:outline-none focus-visible:ring-0',
  'focus-visible:shadow-[0_0_0_1px_var(--brand-ink),0_0_0_4px_var(--auth-focus-halo)]'
);

/**
 * The primary action: the brand's strong fill, full width, 48px.
 *
 * While a request is in flight the button is disabled but keeps its fill --
 * `data-busy` -- with the spinner beside its label. The primitive's disabled
 * look (a sunken grey) means "not available", which a button that is working
 * on your behalf is not.
 */
const PRIMARY = cn(
  'h-12 w-full rounded-control text-[15px] font-semibold',
  'data-[busy=true]:disabled:cursor-progress data-[busy=true]:disabled:bg-brand-strong data-[busy=true]:disabled:text-white',
  FOCUS_RING
);

/** Underlined ink, not brand colour: the primary button is the one coloured thing. */
const TEXT_LINK = cn(
  'rounded-control font-medium text-ink underline decoration-rule-strong underline-offset-4',
  'transition-colors duration-150 ease-out ne-motion hover:decoration-current',
  FOCUS_RING
);

/** One half of the Sign in / Create account switch. */
const SEGMENT = cn(
  'mb-0 h-10 w-full rounded-[9px] border border-transparent px-3 text-sm font-medium text-ink-2',
  'transition-[color,background-color,border-color,box-shadow] duration-150 ease-out',
  'hover:text-ink',
  'data-[state=active]:border-rule data-[state=active]:bg-surface data-[state=active]:text-ink',
  'data-[state=active]:shadow-[0_1px_2px_rgba(15,23,42,0.06),0_1px_3px_rgba(15,23,42,0.05)]',
  FOCUS_RING
);

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
 * mounted before the Google script loaded, and after. That matters more now
 * that the panel is a tab a person switches to, which mounts a brand new slot
 * long after the script settled.
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
  const Icon = tone === 'error' ? AlertCircle : Info;
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-control border px-3.5 py-3',
        tone === 'error'
          ? 'border-[color:var(--auth-error-rule)] bg-dropped-tint text-dropped-ink'
          : 'border-[color:var(--auth-info-rule)] bg-brand-tint text-ink'
      )}
    >
      <Icon
        className={cn('mt-0.5 h-4 w-4 shrink-0', tone === 'info' && 'text-brand-ink')}
        aria-hidden="true"
      />
      <p className="min-w-0 text-[13.5px] leading-5">{children}</p>
    </div>
  );
}

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium leading-5 text-ink">
      {children}
    </label>
  );
}

export default function AuthPage() {
  const router = useRouter();
  /** The host's agency, or null for NetEnroll; and the ground its panel is painted. */
  const brand = useLoginBrand();
  const surface = useLoginSurface();

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
  /*
   * The platform context is mounted beside the session provider and has the
   * same once-per-page-load problem. Left alone it kept the PREVIOUS session's
   * answer: an agency owner signing in after a NetEnroll operator on the same
   * tab got the platform sidebar and the agency/role switchers until a reload.
   */
  const { refetch: refreshPlatformContext } = usePlatformContext();

  const enter = useCallback(
    async (auth: AuthResponse) => {
      persistSessionToken(auth.token);
      // A fresh sign-in is a fresh start: an agent lands in the console again
      // even if the previous session on this tab had stepped out of it.
      clearConsoleExit();
      await Promise.all([refreshSession(), refreshPlatformContext()]);
      router.push(getRedirectPath(auth.user.roles));
    },
    [refreshSession, refreshPlatformContext, router]
  );

  /**
   * Which of the two things this page does.
   *
   * Both halves are reachable by hand, from the tabs below. An invitation link
   * still selects 'create' on arrival, but a person who was sent an invitation
   * code out of band -- pasted into an email, read off a screen -- has a door
   * to walk through as well, and that door carries the same Google button the
   * sign-in half does.
   */
  const [mode, setMode] = useState<'signin' | 'create'>('signin');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [position, setPosition] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  /**
   * The activation token, either from the invitation link --
   * `https://agents.netenroll.com/login?activation=<token>&email=<address>` --
   * or typed into the field on the Create account tab.
   *
   * It is required, and that is deliberate. The server used to work out which
   * agency a new account belonged to by looking at the request -- Host, then
   * Referer, then Origin, then whichever tenant row happened to be oldest --
   * which on a shared host put strangers inside a paying agency. The tenant
   * now travels with this token, which the server issued when it verified a
   * purchase or an administrator's invitation, and both
   * `POST /api/auth/register` and `POST /api/auth/google` refuse without one.
   */
  const [activationToken, setActivationToken] = useState('');
  /**
   * Whether the token arrived in the URL. A person who followed an invitation
   * link should not be shown a code field they have already satisfied; a
   * person who opened the Create account tab cold has to be given somewhere to
   * put theirs.
   */
  const [tokenFromLink, setTokenFromLink] = useState(false);
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

  /*
   * "Forgot password?" -- an inline form on the Sign in tab. The server answers
   * 202 with the same sentence whether or not the address has an account, so
   * that sentence is shown as-is and nothing here hints at which it was.
   */
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotSending, setForgotSending] = useState(false);
  const [forgotMessage, setForgotMessage] = useState<string | null>(null);
  /** The "Forgot password?" control, so closing the form can hand focus back to it. */
  const forgotToggle = useRef<HTMLButtonElement>(null);
  const closeForgot = useCallback(() => {
    setForgotOpen(false);
    // The control is mounted again by the render this schedules.
    requestAnimationFrame(() => forgotToggle.current?.focus());
  }, []);
  /** Set when /reset-password sent the person back here with a new password. */
  const [resetDone, setResetDone] = useState(false);

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
            ...(activationToken.trim() ? { activationToken: activationToken.trim() } : {}),
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
   * A rejected preview is SHOWN. It is the server's own answer for a link that
   * has expired or has already been used, and telling someone that before they
   * choose a password is the difference between a clear refusal and a form
   * that fails after they have filled it in. Only a rejection is surfaced: a
   * preview that could not be reached at all leaves the form alone, because
   * registration validates the token again either way.
   */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('activation');
    // ?mode=create (or ?signup=1) opens the second tab without an invitation
    // link, which is what a "create an account" link from anywhere else on the
    // site can point at.
    const wantsCreate = params.get('mode') === 'create' || params.get('signup') !== null;
    if (wantsCreate) setMode('create');
    if (params.get('reset') === 'done') setResetDone(true);
    if (!token) return;

    const invitedEmail = params.get('email') ?? '';
    setActivationToken(token);
    setTokenFromLink(true);
    setMode('create');
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

  const handleForgot = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setForgotSending(true);
    setError(null);
    setForgotMessage(null);

    try {
      const res = await fetch(`${API_BASE}/api/auth/password-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });

      if (!res.ok) {
        throw new Error(await messageFor(res, 'We could not send a reset link.'));
      }

      const body = (await res.json().catch(() => null)) as { message?: string } | null;
      setForgotMessage(
        body?.message ||
          'If that address has an account, a link to choose a new password is on its way.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'We could not send a reset link.');
    } finally {
      setForgotSending(false);
    }
  };

  const handleCreate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (passwordStrength.score < 3) {
      setError('Please choose a password that meets all three requirements below.');
      return;
    }

    if (!activationToken.trim()) {
      setError(
        'An invitation code is required to create an account. ' +
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
        body: JSON.stringify({
          email,
          password,
          firstName,
          lastName,
          position,
          activationToken: activationToken.trim(),
        }),
        credentials: 'include',
      });

      if (!res.ok) {
        throw new Error(await messageFor(res, 'We could not set up your account.'));
      }

      // 201 with a token and a session. The activation grant IS the approval --
      // it exists because the server verified a purchase or an administrator's
      // invitation -- so there is no second manual step to wait on. This used
      // to be a 202 with no token and a PENDING account, which left a paying
      // customer with no way in.
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
        className={cn(FIELD, 'pr-12')}
      />
      <button
        type="button"
        onClick={() => setShowPassword(!showPassword)}
        aria-label={showPassword ? 'Hide password' : 'Show password'}
        aria-pressed={showPassword}
        className={cn(
          'absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center',
          'rounded-lg text-ink-3 transition-colors duration-150 ease-out ne-motion hover:text-ink',
          FOCUS_RING
        )}
      >
        {showPassword ? (
          <EyeOff className="h-[18px] w-[18px]" aria-hidden="true" />
        ) : (
          <Eye className="h-[18px] w-[18px]" aria-hidden="true" />
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
    <div className="flex items-center gap-3" aria-hidden="true">
      <span className="h-px flex-1 bg-rule" />
      <span className="text-xs font-medium text-ink-3">{label}</span>
      <span className="h-px flex-1 bg-rule" />
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
        The one screen that runs before there is a session, and -- since the
        root of the domain redirects here -- the front door. Two halves: the
        host's brand, and the form.

        From 960px they sit side by side, the brand panel pinned to the
        viewport while the form side scrolls (Create account is long). Below
        that the panel folds into a compact header and the form rises over its
        lower edge, so a phone opens on the form, not on a poster.

        The panel is the agency's navy on its own domain, carrying the wordmark
        reversed out for it, and NetEnroll's light ground everywhere else
        (useLoginSurface). The form side is the ordinary light palette: the
        brand's strong fill is on the primary action and the focus ring and
        nowhere else, and the logo's red stays inside the logo.
      */}
      <div
        data-auth-page=""
        className={cn(
          'flex min-h-screen flex-col bg-surface',
          // The ground under the pinned panel, for the length of a long form.
          'min-[960px]:bg-[color:var(--auth-panel)]',
          'min-[960px]:grid min-[960px]:grid-cols-[minmax(0,40%)_minmax(0,1fr)]',
          'min-[1200px]:grid-cols-[minmax(0,44%)_minmax(0,1fr)]'
        )}
      >
        <header
          className={cn(
            'auth-panel relative isolate overflow-hidden px-5 pb-12 pt-7 sm:px-10 sm:pb-10 sm:pt-9',
            'min-[960px]:sticky min-[960px]:top-0 min-[960px]:flex min-[960px]:h-screen',
            'min-[960px]:flex-col min-[960px]:self-start min-[960px]:px-12 min-[960px]:py-12',
            'min-[1200px]:px-16 min-[1200px]:py-14'
          )}
        >
          <div
            aria-hidden="true"
            className="auth-panel-grid pointer-events-none absolute inset-0 -z-10 hidden min-[960px]:block"
          />
          <div
            aria-hidden="true"
            className="auth-panel-edge pointer-events-none absolute inset-y-0 right-0 hidden w-px min-[960px]:block"
          />

          {/* The host's agency wordmark on its own domain; NetEnroll's anywhere else. */}
          <h1>
            <LoginBrandLogo
              surface={surface}
              className={
                brand
                  ? 'w-[200px] sm:w-[232px] min-[960px]:w-[300px] min-[1200px]:w-[340px]'
                  : 'w-[184px] sm:w-[208px] min-[960px]:w-[240px] min-[1200px]:w-[272px]'
              }
            />
          </h1>

          <div className="mt-3 min-[960px]:mt-auto min-[960px]:max-w-[460px]">
            <span
              aria-hidden="true"
              className="mb-7 hidden h-[3px] w-10 rounded-full bg-[color:var(--auth-accent)] min-[960px]:block"
            />
            {/*
              What this is, for someone who arrived by mistake. On a phone it
              is the one line under the logo; beside the form it is the panel's
              statement.
            */}
            <p
              className={cn(
                'text-[15px] leading-6 text-[color:var(--auth-panel-ink-2)] [text-wrap:balance]',
                'min-[960px]:text-[30px] min-[960px]:font-semibold min-[960px]:leading-[1.2]',
                'min-[960px]:tracking-[-0.02em] min-[960px]:text-[color:var(--auth-panel-ink)]',
                'min-[1200px]:text-[34px]'
              )}
            >
              The agent portal for licensed insurance agencies.
            </p>
            <p className="mt-5 hidden max-w-[400px] text-base leading-7 text-[color:var(--auth-panel-ink-2)] min-[960px]:block">
              One workspace for your agency and the agents who work with it.
            </p>
          </div>

          <p className="mt-14 hidden border-t border-[color:var(--auth-panel-rule)] pt-6 text-[13px] text-[color:var(--auth-panel-ink-3)] min-[960px]:block">
            © {new Date().getFullYear()} {brand?.name ?? 'NetEnroll'}
          </p>
        </header>

        <main
          className={cn(
            'relative z-10 -mt-6 flex flex-1 flex-col rounded-t-[20px] bg-surface',
            'sm:mt-0 sm:rounded-none sm:bg-[color:var(--auth-canvas)]',
            'min-[960px]:min-h-screen'
          )}
        >
          <div
            className={cn(
              'mx-auto flex w-full max-w-[480px] flex-1 flex-col justify-center px-5 pb-10 pt-8',
              'sm:px-0 sm:py-14 min-[960px]:py-12',
              // A 768px-tall laptop still shows the whole card, terms included.
              '[@media(min-width:960px)_and_(max-height:820px)]:py-6'
            )}
          >
            <section
              aria-labelledby="auth-heading"
              className={cn(
                'sm:rounded-2xl sm:border sm:border-rule sm:bg-surface sm:px-10 sm:py-9',
                'sm:shadow-[var(--auth-card-shadow)]',
                '[@media(min-width:960px)_and_(max-height:820px)]:py-8'
              )}
            >
              <h2
                id="auth-heading"
                className="text-[26px] font-semibold leading-[1.2] tracking-[-0.02em] text-ink sm:text-[28px]"
              >
                {mode === 'signin' ? 'Welcome back' : 'Create your account'}
              </h2>
              <p className="mt-1.5 text-[15px] leading-6 text-ink-2 [text-wrap:pretty]">
                {mode === 'signin'
                  ? 'Sign in to your agency account.'
                  : 'Set up the account your agency invited you to.'}
              </p>

              {/*
                Two doors, both always visible: a contained switch, equal
                halves, so neither reads as the afterthought. The heading above
                already says which one is open.
              */}
              <Tabs
                value={mode}
                onValueChange={value => {
                  setMode(value as 'signin' | 'create');
                  // The previous half's failure is not this half's. Carrying it
                  // across reads as though the tab itself was refused.
                  setError(null);
                }}
                className="mt-6"
              >
                <TabsList className="grid h-auto w-full grid-cols-2 items-stretch gap-1 overflow-visible rounded-xl border border-rule bg-sunken p-1">
                  <TabsTrigger value="signin" className={SEGMENT}>
                    Sign in
                  </TabsTrigger>
                  <TabsTrigger value="create" className={SEGMENT}>
                    Create account
                  </TabsTrigger>
                </TabsList>

                {error ? (
                  <div className="mt-5">
                    <Banner tone="error">{error}</Banner>
                  </div>
                ) : null}

                {resetDone && !error ? (
                  <div className="mt-5">
                    <Banner tone="info">
                      Your password has been changed. Sign in with the new one.
                    </Banner>
                  </div>
                ) : null}

                <TabsContent value="signin" className="mt-6 space-y-5 outline-none">
                  <GoogleButton
                    ready={googleReady}
                    text="continue_with"
                    id="google-signin-button"
                  />

                  {googleReady ? divider('or') : null}

                  <form onSubmit={e => void handleLogin(e)} className="space-y-6">
                    <div className="space-y-5">
                      <div className="space-y-2">
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

                      <div className="space-y-2">
                        <FieldLabel htmlFor="signin-password">Password</FieldLabel>
                        {passwordField('signin-password', 'current-password')}
                      </div>
                    </div>

                    <Button
                      type="submit"
                      className={PRIMARY}
                      disabled={isLoading}
                      data-busy={isLoading}
                      aria-busy={isLoading}
                    >
                      {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : null}
                      Sign in
                    </Button>
                  </form>

                  {forgotOpen ? (
                    /*
                      A well inside the card rather than a second card under
                      it: the same question, asked a different way.
                    */
                    <form
                      onSubmit={e => void handleForgot(e)}
                      className="space-y-4 rounded-xl border border-rule bg-sunken p-5"
                      aria-labelledby="forgot-heading"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p
                            id="forgot-heading"
                            className="text-[15px] font-semibold leading-6 text-ink"
                          >
                            Reset your password
                          </p>
                          {forgotMessage ? null : (
                            <p className="mt-0.5 text-[13.5px] leading-5 text-ink-2 [text-wrap:pretty]">
                              We will email a link to choose a new one.
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={closeForgot}
                          className={cn('-mr-1 shrink-0 px-1 text-[13.5px] leading-6', TEXT_LINK)}
                        >
                          {forgotMessage ? 'Done' : 'Cancel'}
                        </button>
                      </div>
                      {forgotMessage ? (
                        <Banner tone="info">{forgotMessage}</Banner>
                      ) : (
                        <>
                          <div className="space-y-2">
                            <FieldLabel htmlFor="forgot-email">Email address</FieldLabel>
                            <Input
                              id="forgot-email"
                              type="email"
                              placeholder="you@agency.com"
                              value={email}
                              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                setEmail(e.target.value)
                              }
                              required
                              autoComplete="email"
                              autoFocus
                              className={FIELD}
                            />
                          </div>
                          <Button
                            type="submit"
                            variant="outline"
                            className={cn(
                              'h-11 w-full rounded-control border-[color:var(--auth-field-rule)] font-semibold hover:bg-paper',
                              FOCUS_RING
                            )}
                            disabled={forgotSending || !email.trim()}
                            aria-busy={forgotSending}
                          >
                            {forgotSending ? (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            ) : null}
                            Send reset link
                          </Button>
                        </>
                      )}
                    </form>
                  ) : (
                    <p className="text-center text-sm">
                      <button
                        ref={forgotToggle}
                        type="button"
                        onClick={() => {
                          setForgotOpen(true);
                          setForgotMessage(null);
                          setError(null);
                        }}
                        className={TEXT_LINK}
                      >
                        Forgot password?
                      </button>
                    </p>
                  )}
                </TabsContent>

                <TabsContent value="create" className="mt-6 space-y-5 outline-none">
                  {/*
                    Which agency this invitation is for, when the link named one.
                    Worth showing before the password field: an agent following a
                    link should be able to see they are joining the right agency,
                    and someone who is not expecting an invitation should be able
                    to see that they are not.
                  */}
                  {tokenFromLink && !invitationRefused ? (
                    <Banner tone="info">
                      {agencyName
                        ? `You have been invited to join ${agencyName}.`
                        : 'You have been invited to join the agency that sent you this link.'}
                    </Banner>
                  ) : null}

                  <GoogleButton ready={googleReady} text="signup_with" id="google-signup-button" />

                  {googleReady ? divider('or') : null}

                  <form onSubmit={e => void handleCreate(e)} className="space-y-6">
                    <div className="space-y-5">
                      <div className="grid grid-cols-2 gap-3 sm:gap-4">
                        <div className="min-w-0 space-y-2">
                          <FieldLabel htmlFor="create-firstname">First name</FieldLabel>
                          <Input
                            id="create-firstname"
                            type="text"
                            value={firstName}
                            onChange={(e: ChangeEvent<HTMLInputElement>) =>
                              setFirstName(e.target.value)
                            }
                            autoComplete="given-name"
                            className={FIELD}
                          />
                        </div>
                        <div className="min-w-0 space-y-2">
                          <FieldLabel htmlFor="create-lastname">Last name</FieldLabel>
                          <Input
                            id="create-lastname"
                            type="text"
                            value={lastName}
                            onChange={(e: ChangeEvent<HTMLInputElement>) =>
                              setLastName(e.target.value)
                            }
                            autoComplete="family-name"
                            className={FIELD}
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <FieldLabel htmlFor="create-email">Email address</FieldLabel>
                        <Input
                          id="create-email"
                          type="email"
                          placeholder="you@agency.com"
                          value={email}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                          required
                          autoComplete="email"
                          className={FIELD}
                        />
                      </div>

                      {/*
                        The invitation code, for anyone who did not arrive on the
                        link itself -- it was read out, forwarded as text, or the
                        link was opened in another browser. Following the link
                        fills this in and there is nothing left to type, so the
                        field is not shown then.

                        It is required either way. The API refuses a registration
                        without one, and it is what tells the server which agency
                        the new account belongs to; there is no self-serve signup
                        that skips it.
                      */}
                      {tokenFromLink ? null : (
                        <div className="space-y-2">
                          <FieldLabel htmlFor="create-invitation">Invitation code</FieldLabel>
                          <Input
                            id="create-invitation"
                            type="text"
                            value={activationToken}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => {
                              setActivationToken(e.target.value);
                              // A new code is a new question; the last refusal was
                              // about the old one.
                              setInvitationRefused(false);
                            }}
                            required
                            autoComplete="off"
                            spellCheck={false}
                            aria-describedby="create-invitation-help"
                            className={cn(FIELD, 'font-mono sm:text-[14px]')}
                          />
                          <p
                            id="create-invitation-help"
                            className="text-[13px] leading-5 text-ink-2"
                          >
                            From your invitation email. It is the{' '}
                            <code className="font-mono text-[12.5px]">activation</code> value in the
                            link your agency administrator sent you.
                          </p>
                        </div>
                      )}

                      <div className="space-y-2">
                        <FieldLabel htmlFor="create-position">Position</FieldLabel>
                        <div className="relative">
                          <select
                            id="create-position"
                            value={position}
                            onChange={e => setPosition(e.target.value)}
                            required
                            className={cn(
                              FIELD,
                              'cursor-pointer appearance-none border pr-10 shadow-card [&>option]:text-ink',
                              !position && 'text-ink-3'
                            )}
                          >
                            <option value="">Select a position…</option>
                            <option value="Licensed Agent">Licensed Agent</option>
                            <option value="Sales Support">Sales Support</option>
                            <option value="Retention">Retention</option>
                          </select>
                          <ChevronDown
                            className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3"
                            aria-hidden="true"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <FieldLabel htmlFor="create-password">Password</FieldLabel>
                        {passwordField('create-password', 'new-password')}

                        {/*
                          The three rules the API enforces, listed rather than
                          scored: "weak" tells someone nothing they can act on.
                          Announced politely — a person typing does not need each
                          keystroke read out, so the region is polite, not assertive.
                        */}
                        <ul className="grid gap-1.5 pt-1" aria-live="polite">
                          {[
                            { met: passwordStrength.hasLength, label: 'At least 8 characters' },
                            { met: passwordStrength.hasUppercase, label: 'One uppercase letter' },
                            { met: passwordStrength.hasNumber, label: 'One number' },
                          ].map(rule => (
                            <li
                              key={rule.label}
                              className={cn(
                                'flex items-center gap-2 text-[13px] leading-5',
                                rule.met ? 'text-live-ink' : 'text-ink-2'
                              )}
                            >
                              <span
                                className="flex h-4 w-4 shrink-0 items-center justify-center"
                                aria-hidden="true"
                              >
                                {rule.met ? (
                                  <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                                ) : (
                                  <span className="h-1.5 w-1.5 rounded-full bg-ink-3" />
                                )}
                              </span>
                              <span>{rule.label}</span>
                              <span className="sr-only">
                                {rule.met ? ' — met' : ' — not yet met'}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <Button
                      type="submit"
                      className={PRIMARY}
                      disabled={isLoading}
                      data-busy={isLoading}
                      aria-busy={isLoading}
                    >
                      {isLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : null}
                      Create my account
                    </Button>
                  </form>

                  <p className="text-center text-[13px] leading-5 text-ink-2 [text-wrap:balance]">
                    Accounts are created by invitation. If you do not have a code, please ask your
                    agency administrator.
                  </p>
                </TabsContent>
              </Tabs>

              {/*
                Part of the card, not a caption floating under it. Underlined
                ink rather than brand colour: the primary button is the one
                coloured control here, and a second coloured thing at the foot
                of the card would make the accent mean less.
              */}
              <p className="mt-7 border-t border-rule pt-5 text-center text-[13px] leading-5 text-ink-2">
                By continuing, you agree to our{' '}
                <a href="/legal/terms" className={TEXT_LINK}>
                  Terms of Service
                </a>
                .
              </p>
            </section>
          </div>
        </main>
      </div>
    </>
  );
}
