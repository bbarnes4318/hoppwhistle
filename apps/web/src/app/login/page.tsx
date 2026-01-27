'use client';

import { Eye, EyeOff, Loader2, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import { useState, useCallback, useEffect, type ChangeEvent, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const GOOGLE_CLIENT_ID = '196207148120-2navmspp2renu5cnvr06679jvhm5h12h.apps.googleusercontent.com';
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface AuthResponse {
  token: string;
  csrfToken: string;
  user: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    roles: string[];
  };
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
        const res = await fetch(`${API_BASE}/auth/google`, {
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
        localStorage.setItem('token', (data as AuthResponse).token);
        router.push('/dashboard');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Google authentication failed');
      } finally {
        setIsLoading(false);
      }
    },
    [router]
  );

  // Initialize Google One Tap
  useEffect(() => {
    if (googleLoaded && typeof window !== 'undefined' && (window as any).google) {
      (window as any).google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleResponse,
        auto_select: false,
        cancel_on_tap_outside: true,
      });

      (window as any).google.accounts.id.renderButton(
        document.getElementById('google-signin-button'),
        {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'continue_with',
          shape: 'rectangular',
          logo_alignment: 'left',
          width: '100%',
        }
      );
    }
  }, [googleLoaded, handleGoogleResponse]);

  // Email/Password Login
  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || 'Login failed');
      }

      localStorage.setItem('token', (data as AuthResponse).token);
      router.push('/dashboard');
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
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, firstName, lastName }),
        credentials: 'include',
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || 'Registration failed');
      }

      localStorage.setItem('token', (data as AuthResponse).token);
      router.push('/dashboard');
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
        <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-[#1E3A5F] via-[#2A4A6F] to-[#1E3A5F] relative overflow-hidden">
          {/* Abstract pattern overlay */}
          <div className="absolute inset-0 opacity-10">
            <div className="absolute top-0 left-0 w-96 h-96 bg-[#00D084] rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
            <div className="absolute bottom-0 right-0 w-96 h-96 bg-[#FF6B35] rounded-full blur-3xl translate-x-1/2 translate-y-1/2" />
          </div>

          <div className="relative z-10 flex flex-col justify-center items-center w-full p-12 text-white">
            <Image
              src="/hopwhistle.png"
              alt="Hopwhistle"
              width={280}
              height={93}
              className="mb-8"
              priority
            />
            <h1 className="text-4xl font-bold text-center mb-4">Enterprise Call Tracking</h1>
            <p className="text-xl text-white/80 text-center max-w-md">
              Advanced lead distribution, real-time analytics, and intelligent call routing at
              scale.
            </p>

            {/* Feature highlights */}
            <div className="mt-12 space-y-4 w-full max-w-sm">
              <div className="flex items-center gap-3 text-white/90">
                <CheckCircle2 className="h-5 w-5 text-[#00D084]" />
                <span>Real-time call analytics</span>
              </div>
              <div className="flex items-center gap-3 text-white/90">
                <CheckCircle2 className="h-5 w-5 text-[#00D084]" />
                <span>Intelligent buyer routing</span>
              </div>
              <div className="flex items-center gap-3 text-white/90">
                <CheckCircle2 className="h-5 w-5 text-[#00D084]" />
                <span>Multi-tenant architecture</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Panel - Auth Form */}
        <div className="flex-1 flex items-center justify-center p-8 bg-background">
          <div className="w-full max-w-md">
            {/* Mobile logo */}
            <div className="lg:hidden flex justify-center mb-8">
              <Image src="/hopwhistle.png" alt="Hopwhistle" width={200} height={67} priority />
            </div>

            <Card className="border-0 shadow-xl">
              <CardHeader className="space-y-1 pb-4">
                <CardTitle className="text-2xl font-bold text-center">
                  {activeTab === 'signin' ? 'Welcome back' : 'Create an account'}
                </CardTitle>
                <CardDescription className="text-center">
                  {activeTab === 'signin'
                    ? 'Sign in to your Hopwhistle account'
                    : 'Get started with Hopwhistle today'}
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-4">
                {/* Google Sign In Button */}
                <div id="google-signin-button" className="w-full flex justify-center" />

                {/* Divider */}
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">
                      or continue with email
                    </span>
                  </div>
                </div>

                {/* Error Alert */}
                {error && (
                  <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    <span>{error}</span>
                    <button onClick={clearError} className="ml-auto hover:opacity-70">
                      <XCircle className="h-4 w-4" />
                    </button>
                  </div>
                )}

                {/* Tabs */}
                <Tabs
                  value={activeTab}
                  onValueChange={v => {
                    setActiveTab(v as 'signin' | 'signup');
                    clearError();
                  }}
                  className="w-full"
                >
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="signin">Sign In</TabsTrigger>
                    <TabsTrigger value="signup">Sign Up</TabsTrigger>
                  </TabsList>

                  {/* Sign In Form */}
                  <TabsContent value="signin" className="mt-4">
                    <form onSubmit={e => void handleLogin(e)} className="space-y-4">
                      <div className="space-y-2">
                        <label htmlFor="signin-email" className="text-sm font-medium">
                          Email
                        </label>
                        <Input
                          id="signin-email"
                          type="email"
                          placeholder="you@example.com"
                          value={email}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                          required
                          autoComplete="email"
                        />
                      </div>
                      <div className="space-y-2">
                        <label htmlFor="signin-password" className="text-sm font-medium">
                          Password
                        </label>
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
                            className="pr-10"
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
                      <Button type="submit" className="w-full" disabled={isLoading}>
                        {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        Sign In
                      </Button>
                    </form>
                  </TabsContent>

                  {/* Sign Up Form */}
                  <TabsContent value="signup" className="mt-4">
                    <form onSubmit={e => void handleRegister(e)} className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label htmlFor="signup-firstname" className="text-sm font-medium">
                            First Name
                          </label>
                          <Input
                            id="signup-firstname"
                            type="text"
                            placeholder="John"
                            value={firstName}
                            onChange={(e: ChangeEvent<HTMLInputElement>) =>
                              setFirstName(e.target.value)
                            }
                            autoComplete="given-name"
                          />
                        </div>
                        <div className="space-y-2">
                          <label htmlFor="signup-lastname" className="text-sm font-medium">
                            Last Name
                          </label>
                          <Input
                            id="signup-lastname"
                            type="text"
                            placeholder="Doe"
                            value={lastName}
                            onChange={(e: ChangeEvent<HTMLInputElement>) =>
                              setLastName(e.target.value)
                            }
                            autoComplete="family-name"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label htmlFor="signup-email" className="text-sm font-medium">
                          Email
                        </label>
                        <Input
                          id="signup-email"
                          type="email"
                          placeholder="you@example.com"
                          value={email}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                          required
                          autoComplete="email"
                        />
                      </div>
                      <div className="space-y-2">
                        <label htmlFor="signup-password" className="text-sm font-medium">
                          Password
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
                            className="pr-10"
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
                          <div className="space-y-2 mt-2">
                            <div className="flex gap-1">
                              <div
                                className={`h-1 flex-1 rounded-full transition-colors ${passwordStrength.score >= 1 ? 'bg-destructive' : 'bg-muted'}`}
                              />
                              <div
                                className={`h-1 flex-1 rounded-full transition-colors ${passwordStrength.score >= 2 ? 'bg-yellow-500' : 'bg-muted'}`}
                              />
                              <div
                                className={`h-1 flex-1 rounded-full transition-colors ${passwordStrength.score >= 3 ? 'bg-green-500' : 'bg-muted'}`}
                              />
                            </div>
                            <div className="text-xs space-y-1 text-muted-foreground">
                              <div className={passwordStrength.hasLength ? 'text-green-600' : ''}>
                                {passwordStrength.hasLength ? '✓' : '○'} At least 8 characters
                              </div>
                              <div
                                className={passwordStrength.hasUppercase ? 'text-green-600' : ''}
                              >
                                {passwordStrength.hasUppercase ? '✓' : '○'} One uppercase letter
                              </div>
                              <div className={passwordStrength.hasNumber ? 'text-green-600' : ''}>
                                {passwordStrength.hasNumber ? '✓' : '○'} One number
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                      <Button
                        type="submit"
                        className="w-full"
                        disabled={isLoading || passwordStrength.score < 3}
                      >
                        {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                        Create Account
                      </Button>
                    </form>
                  </TabsContent>
                </Tabs>

                {/* Terms */}
                <p className="text-xs text-muted-foreground text-center pt-4">
                  By continuing, you agree to our{' '}
                  <a href="/legal/terms" className="underline hover:text-foreground">
                    Terms of Service
                  </a>{' '}
                  and{' '}
                  <a href="/legal/privacy" className="underline hover:text-foreground">
                    Privacy Policy
                  </a>
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
