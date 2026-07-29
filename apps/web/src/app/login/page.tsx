'use client';

import { Eye, EyeOff, Loader2, XCircle, AlertCircle } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import { useState, useCallback, useEffect, type ChangeEvent, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const GOOGLE_CLIENT_ID = '196207148120-2navmspp2renu5cnvr06679jvhm5h12h.apps.googleusercontent.com';
const API_BASE =
  typeof window !== 'undefined'
    ? window.location.origin
    : process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

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

// Determine redirect path based on user roles
// With unified dashboard, all users go to /dashboard
function getRedirectPath(_roles: string[]): string {
  // Buyer portal removed - all users use unified dashboard with RBAC
  return '/dashboard';
}

interface PasswordStrength {
  score: number;
  hasLength: boolean;
  hasUppercase: boolean;
  hasNumber: boolean;
}

function validatePasswordStrength(password: string): PasswordStrength {
  const hasLength = password.length >= 8;
  const hasUppercase = /[A-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  const score = [hasLength, hasUppercase, hasNumber].filter(Boolean).length;
  return { score, hasLength, hasUppercase, hasNumber };
}

export default function AuthPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'signin' | 'signup'>('signin');

  // Form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [position, setPosition] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // UI state
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [googleLoaded, setGoogleLoaded] = useState(false);

  // Password strength for signup
  const passwordStrength = validatePasswordStrength(password);

  // Handle Google credential response
  const handleGoogleResponse = useCallback(
    async (response: { credential: string }) => {
      setIsLoading(true);
      setError(null);

      try {
        const res = await fetch(`${API_BASE}/api/auth/google`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credential: response.credential }),
          credentials: 'include',
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error?.message || 'Google authentication failed');
        }

        // Store token
        const authData = data as AuthResponse;
        localStorage.setItem('token', authData.token);

        // Redirect based on role - BUYER goes to buyer portal
        const redirectPath = getRedirectPath(authData.user.roles);
        router.push(redirectPath);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Google authentication failed');
      } finally {
        setIsLoading(false);
      }
    },
    [router]
  );

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

  // Initialize Google One Tap
  useEffect(() => {
    const googleWindow = window as unknown as GoogleAccountsWindow;
    if (googleLoaded && typeof window !== 'undefined' && googleWindow.google) {
      googleWindow.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleResponse as unknown as (res: unknown) => void,
        auto_select: false,
        cancel_on_tap_outside: true,
      });

      if (activeTab === 'signin') {
        const btn = document.getElementById('google-signin-button');
        if (btn) {
          googleWindow.google.accounts.id.renderButton(btn, {
            type: 'standard',
            theme: 'outline',
            size: 'large',
            text: 'continue_with',
            shape: 'rectangular',
            logo_alignment: 'left',
            width: 300,
          });
        }
      } else {
        const btn = document.getElementById('google-signup-button');
        if (btn) {
          googleWindow.google.accounts.id.renderButton(btn, {
            type: 'standard',
            theme: 'outline',
            size: 'large',
            text: 'signup_with',
            shape: 'rectangular',
            logo_alignment: 'left',
            width: 300,
          });
        }
      }
    }
  }, [googleLoaded, handleGoogleResponse, activeTab]);

  // Email/Password Login
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

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || 'Login failed');
      }

      const authData = data as AuthResponse;
      localStorage.setItem('token', authData.token);

      // Redirect based on role - BUYER goes to buyer portal
      const redirectPath = getRedirectPath(authData.user.roles);
      router.push(redirectPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  // Email Registration
  const handleRegister = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (passwordStrength.score < 3) {
      setError('Please use a stronger password');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, firstName, lastName, position }),
        credentials: 'include',
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || 'Registration failed');
      }

      const authData = data as AuthResponse;
      localStorage.setItem('token', authData.token);

      // Redirect based on role - BUYER goes to buyer portal
      const redirectPath = getRedirectPath(authData.user.roles);
      router.push(redirectPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setIsLoading(false);
    }
  };

  const clearError = () => setError(null);

  return (
    <>
      <Script
        src="https://accounts.google.com/gsi/client"
        onLoad={() => setGoogleLoaded(true)}
        strategy="lazyOnload"
      />

      <div className="min-h-screen flex">
        {/* Left Panel - Brand */}
        <div className="relative hidden flex-col justify-between overflow-hidden border-r border-border bg-background p-12 lg:flex lg:w-1/2">
          {/* Engineering grid, fading out toward the bottom so it never competes */}
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#ffffff08_1px,transparent_1px),linear-gradient(to_bottom,#ffffff08_1px,transparent_1px)] bg-[size:28px_28px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]" />
          {/* Jade aurora anchoring the top-left corner */}
          <div className="pointer-events-none absolute -left-32 -top-32 h-[420px] w-[420px] rounded-full bg-primary/12 blur-[120px]" />
          <div className="pointer-events-none absolute -bottom-40 left-1/3 h-[380px] w-[380px] rounded-full bg-sky-500/[0.07] blur-[130px]" />

          {/* Top Logotype */}
          <div className="relative z-10 flex items-center justify-start">
            <Image src="/hopwhistle-mark.svg" alt="Hopwhistle" width={200} height={66} priority />
          </div>

          {/* Center Content / Core Value */}
          <div className="relative z-10 max-w-lg space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/70 py-1.5 pl-2.5 pr-3.5 backdrop-blur-sm">
              <span className="pulse-dot" aria-hidden />
              <span className="text-[10px] font-semibold uppercase tracking-eyebrow text-muted-foreground">
                System Operational
              </span>
            </div>
            <h1 className="text-[42px] font-semibold leading-[1.08] tracking-[-0.03em] text-foreground">
              The telephony
              <br />
              command center.
            </h1>
            <p className="max-w-md text-[15px] leading-relaxed text-muted-foreground">
              Real-time media routing, deterministic node orchestration, and a private workspace
              where your numbers, leads and revenue stay strictly your own.
            </p>
          </div>

          {/* Bottom System Stats */}
          <div className="relative z-10 mt-12 w-full max-w-md">
            <div className="rule-fade mb-7" />
            <div className="grid grid-cols-2 gap-x-6 gap-y-5">
              {[
                { label: 'Network Status', value: 'Optimal (0ms jitter)' },
                { label: 'Authentication', value: 'Zero-Trust Enforced' },
                { label: 'Isolation', value: 'Per-Tenant Enforced' },
                { label: 'Protocol', value: 'SIP/TLS Active' },
              ].map(stat => (
                <div key={stat.label} className="space-y-1.5">
                  <p className="eyebrow">{stat.label}</p>
                  <p className="text-[13px] font-medium text-foreground/85">{stat.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Panel - Auth Form */}
        <div className="flex-1 flex flex-col justify-center px-4 py-12 sm:px-6 lg:flex-none lg:px-20 xl:px-24 bg-background">
          <div className="mx-auto w-full max-w-sm">
            {/* Mobile logo */}
            <div className="lg:hidden flex justify-center mb-10">
              <Image src="/hopwhistle-mark.svg" alt="Hopwhistle" width={180} height={60} priority />
            </div>

            <div className="space-y-8">
              <div className="space-y-2">
                <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                  {activeTab === 'signin' ? 'Portal Access' : 'Provision Identity'}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {activeTab === 'signin'
                    ? 'Enter your operational credentials to access the secure command center.'
                    : 'Create an account and we will provision a private workspace for your data.'}
                </p>
              </div>

              {/* Error Alert */}
              {error && (
                <div className="flex items-center gap-3 p-4 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm font-medium shadow-sm">
                  <AlertCircle className="h-5 w-5 flex-shrink-0" />
                  <span className="flex-1">{error}</span>
                  <button
                    onClick={clearError}
                    className="flex-shrink-0 hover:opacity-70 transition-opacity"
                  >
                    <XCircle className="h-4 w-4" />
                  </button>
                </div>
              )}

              <Tabs
                value={activeTab}
                onValueChange={v => {
                  setActiveTab(v as 'signin' | 'signup');
                  clearError();
                }}
                className="w-full"
              >
                <TabsList className="grid w-full grid-cols-2 h-10 mb-8 bg-muted/50 rounded-md">
                  <TabsTrigger value="signin" className="text-xs font-medium">
                    Authenticate
                  </TabsTrigger>
                  <TabsTrigger value="signup" className="text-xs font-medium">
                    Provision
                  </TabsTrigger>
                </TabsList>

                {/* Sign In Form */}
                <TabsContent value="signin" className="space-y-6 outline-none">
                  {/*
                    The button host must stay mounted for Google to render into
                    it, so collapse the whole block rather than unmounting it —
                    otherwise an unconfigured Google leaves a blank gap above a
                    divider that separates nothing.
                  */}
                  <div className={googleLoaded ? undefined : 'hidden'}>
                    <div id="google-signin-button" className="w-full flex justify-center" />

                    <div className="relative my-8">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t border-border" />
                      </div>
                      <div className="relative flex justify-center">
                        <span className="bg-background px-3 text-[10px] uppercase tracking-widest font-mono text-muted-foreground font-semibold">
                          Or authenticate via email
                        </span>
                      </div>
                    </div>
                  </div>

                  <form onSubmit={e => void handleLogin(e)} className="space-y-5">
                    <div className="space-y-1.5">
                      <label
                        htmlFor="signin-email"
                        className="text-[10px] font-mono font-semibold tracking-widest text-muted-foreground uppercase"
                      >
                        Email Address
                      </label>
                      <Input
                        id="signin-email"
                        type="email"
                        placeholder="operator@domain.com"
                        value={email}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                        required
                        autoComplete="email"
                        className="h-10 font-mono text-sm shadow-none"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label
                          htmlFor="signin-password"
                          className="text-[10px] font-mono font-semibold tracking-widest text-muted-foreground uppercase"
                        >
                          Passphrase
                        </label>
                      </div>
                      <div className="relative">
                        <Input
                          id="signin-password"
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(e: ChangeEvent<HTMLInputElement>) =>
                            setPassword(e.target.value)
                          }
                          required
                          autoComplete="current-password"
                          className="h-10 pr-10 font-mono text-sm shadow-none"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>
                    <Button
                      type="submit"
                      className="w-full h-10 font-medium shadow-none mt-2"
                      disabled={isLoading}
                    >
                      {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Authenticate Session
                    </Button>
                  </form>
                </TabsContent>

                {/* Sign Up Form */}
                <TabsContent value="signup" className="space-y-6 outline-none">
                  <div className={googleLoaded ? undefined : 'hidden'}>
                    <div id="google-signup-button" className="w-full flex justify-center" />

                    <div className="relative my-8">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t border-border" />
                      </div>
                      <div className="relative flex justify-center">
                        <span className="bg-background px-3 text-[10px] uppercase tracking-widest font-mono text-muted-foreground font-semibold">
                          Or register via email
                        </span>
                      </div>
                    </div>
                  </div>

                  <form onSubmit={e => void handleRegister(e)} className="space-y-5">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1.5">
                        <label
                          htmlFor="signup-firstname"
                          className="text-[10px] font-mono font-semibold tracking-widest text-muted-foreground uppercase"
                        >
                          First Name
                        </label>
                        <Input
                          id="signup-firstname"
                          type="text"
                          placeholder="Node"
                          value={firstName}
                          onChange={(e: ChangeEvent<HTMLInputElement>) =>
                            setFirstName(e.target.value)
                          }
                          autoComplete="given-name"
                          className="h-10 text-sm shadow-none"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label
                          htmlFor="signup-lastname"
                          className="text-[10px] font-mono font-semibold tracking-widest text-muted-foreground uppercase"
                        >
                          Last Name
                        </label>
                        <Input
                          id="signup-lastname"
                          type="text"
                          placeholder="Operator"
                          value={lastName}
                          onChange={(e: ChangeEvent<HTMLInputElement>) =>
                            setLastName(e.target.value)
                          }
                          autoComplete="family-name"
                          className="h-10 text-sm shadow-none"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label
                        htmlFor="signup-email"
                        className="text-[10px] font-mono font-semibold tracking-widest text-muted-foreground uppercase"
                      >
                        Email Address
                      </label>
                      <Input
                        id="signup-email"
                        type="email"
                        placeholder="operator@domain.com"
                        value={email}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                        required
                        autoComplete="email"
                        className="h-10 font-mono text-sm shadow-none"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label
                        htmlFor="signup-position"
                        className="text-[10px] font-mono font-semibold tracking-widest text-muted-foreground uppercase"
                      >
                        Position / Role
                      </label>
                      <select
                        id="signup-position"
                        value={position}
                        onChange={(e) => setPosition(e.target.value)}
                        required
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <option value="">Select Position...</option>
                        <option value="Licensed Agent">Licensed Agent</option>
                        <option value="Sales Support">Sales Support</option>
                        <option value="Retention">Retention</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label
                        htmlFor="signup-password"
                        className="text-[10px] font-mono font-semibold tracking-widest text-muted-foreground uppercase"
                      >
                        Passphrase
                      </label>
                      <div className="relative">
                        <Input
                          id="signup-password"
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(e: ChangeEvent<HTMLInputElement>) =>
                            setPassword(e.target.value)
                          }
                          required
                          autoComplete="new-password"
                          className="pr-10 h-10 font-mono text-sm shadow-none"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          {showPassword ? (
                            <EyeOff className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </button>
                      </div>

                      {/* Password Strength Indicator */}
                      {password && (
                        <div className="space-y-2 mt-3 pt-1">
                          <div className="flex gap-1.5">
                            <div
                              className={`h-0.5 flex-1 rounded-full transition-colors ${passwordStrength.score >= 1 ? 'bg-destructive' : 'bg-muted'}`}
                            />
                            <div
                              className={`h-0.5 flex-1 rounded-full transition-colors ${passwordStrength.score >= 2 ? 'bg-yellow-500' : 'bg-muted'}`}
                            />
                            <div
                              className={`h-0.5 flex-1 rounded-full transition-colors ${passwordStrength.score >= 3 ? 'bg-emerald-500' : 'bg-muted'}`}
                            />
                          </div>
                          <div className="text-[10px] uppercase font-mono tracking-wider space-y-1 pt-1">
                            <div
                              className={
                                passwordStrength.hasLength
                                  ? 'text-emerald-500'
                                  : 'text-muted-foreground'
                              }
                            >
                              {passwordStrength.hasLength ? '✓' : '○'} At least 8 characters
                            </div>
                            <div
                              className={
                                passwordStrength.hasUppercase
                                  ? 'text-emerald-500'
                                  : 'text-muted-foreground'
                              }
                            >
                              {passwordStrength.hasUppercase ? '✓' : '○'} One uppercase
                            </div>
                            <div
                              className={
                                passwordStrength.hasNumber
                                  ? 'text-emerald-500'
                                  : 'text-muted-foreground'
                              }
                            >
                              {passwordStrength.hasNumber ? '✓' : '○'} One number
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                    <Button
                      type="submit"
                      className="w-full h-10 font-medium mt-4 shadow-none"
                      disabled={isLoading || passwordStrength.score < 3}
                    >
                      {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Provision Identity
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>

              {/* Terms */}
              <p className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground text-center pt-8">
                By continuing, you enforce our{' '}
                <a
                  href="/legal/terms"
                  className="underline underline-offset-2 hover:text-foreground transition-colors"
                >
                  Security Protocol
                </a>
              </p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
