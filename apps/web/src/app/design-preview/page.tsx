'use client';

import Link from 'next/link';
import * as React from 'react';

import { useAuth } from '@/hooks/use-auth';

import { ThemePane } from './preview-content';

/**
 * /design-preview — the living style guide.
 *
 * Every token, every type step and every DurationBar state on one screen, in
 * both themes side by side. Prompt 2 adds each new domain component here as it
 * is built, so this page stays the place you look to see what the system has.
 *
 * Deliberately outside the (dashboard) route group: it renders with no legacy
 * chrome, so what you see is the design system and nothing else.
 *
 * The admin gate is client-side, matching how the rest of this app gates —
 * auth is a token in localStorage read by useAuth, and there is no server
 * session to check. That is UI-level only, not a security boundary. It is
 * appropriate here because the page renders no customer data, only swatches
 * and static samples.
 */
export default function DesignPreviewPage() {
  const { isAdminOrOwner, loading, user } = useAuth();

  if (loading) {
    return (
      <main data-theme="light" className="min-h-screen bg-paper p-8">
        <p className="t-meta text-ink-3">Loading…</p>
      </main>
    );
  }

  if (!user || !isAdminOrOwner) {
    return (
      <main data-theme="light" className="min-h-screen bg-paper p-8">
        <div className="mx-auto max-w-md pt-24 text-center">
          <h1 className="t-title text-ink">Admins only</h1>
          <p className="t-body mt-2 text-ink-2">
            The design preview is internal. Ask an owner if you need access to it.
          </p>
          <Link href="/dashboard" className="t-body mt-4 inline-block text-money underline">
            Back to dashboard
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main data-theme="light" className="min-h-screen bg-paper">
      <header className="border-b border-rule bg-surface px-6 py-5">
        <h1 className="t-title text-ink">Design system</h1>
        <p className="t-body mt-1 max-w-3xl text-ink-2">
          Every token and every type step, rendered in both themes from the same markup. Light is
          the default and the only mode for publisher and buyer surfaces; dark is scoped with{' '}
          <code className="t-data text-ink">data-theme=&quot;dark&quot;</code> and is intended for
          the admin live board alone.
        </p>
        <p className="t-meta mt-2 text-ink-3">
          Source of truth: <code className="t-data">src/app/globals.css</code> ·{' '}
          <code className="t-data">/hoppwhistle-redesign.md</code>
        </p>
      </header>

      <div className="p-6">
        {/*
          Side by side above 1280px, stacked below. Both panes are the identical
          component — only the data-theme attribute differs.
        */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <ThemePane theme="light" />
          <ThemePane theme="dark" />
        </div>
      </div>
    </main>
  );
}
