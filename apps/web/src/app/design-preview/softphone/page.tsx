'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import * as React from 'react';

import { ThemeScope } from '@/components/domain/theme-scope';
import { useAuth } from '@/hooks/use-auth';

import { MockSoftphone, SOFTPHONE_SCENARIOS, isScenario } from '../softphone-gallery';

/**
 * /design-preview/softphone?state=connected&theme=dark — one softphone state,
 * full screen, positioned exactly as the app positions it: floating at the
 * bottom right from 640px, a bottom sheet below. That is the part the
 * side-by-side gallery cannot show, and what the PR screenshots are taken of.
 *
 * Mock data only; there is no PhoneProvider on this page. Admin-gated like
 * the rest of /design-preview (UI-level only — the page holds no real data).
 */
export default function SoftphonePreviewPage(): JSX.Element {
  return (
    <React.Suspense fallback={null}>
      <SoftphonePreview />
    </React.Suspense>
  );
}

function SoftphonePreview(): JSX.Element {
  const { isAdminOrOwner, loading, user } = useAuth();
  const params = useSearchParams();
  const state = params.get('state');
  const theme = params.get('theme') === 'dark' ? 'dark' : 'light';

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
          <p className="t-body mt-2 text-ink-2">The design preview is internal.</p>
        </div>
      </main>
    );
  }

  if (!isScenario(state)) {
    return (
      <main data-theme="light" className="min-h-screen bg-paper p-6">
        <h1 className="t-title text-ink">Softphone states</h1>
        <p className="t-body mt-1 text-ink-2">
          Each state, full screen, in each theme. Resize below 640px for the bottom sheet.
        </p>
        <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {SOFTPHONE_SCENARIOS.map(s => (
            <li
              key={s.id}
              className="flex items-center justify-between rounded-card border border-rule bg-surface px-3 py-2"
            >
              <span className="text-sm text-ink">{s.label}</span>
              <span className="flex gap-3 text-sm">
                <Link
                  className="text-brand-ink hover:underline"
                  href={`?state=${s.id}&theme=light`}
                >
                  Light
                </Link>
                <Link className="text-brand-ink hover:underline" href={`?state=${s.id}&theme=dark`}>
                  Dark
                </Link>
              </span>
            </li>
          ))}
        </ul>
      </main>
    );
  }

  const label = SOFTPHONE_SCENARIOS.find(s => s.id === state)?.label ?? state;

  return (
    <ThemeScope theme={theme} className="min-h-screen">
      <FauxWorkspace label={label} />
      <MockSoftphone scenario={state} placement="floating" />
    </ThemeScope>
  );
}

/** A quiet stand-in for the page the softphone floats over. */
function FauxWorkspace({ label }: { label: string }): JSX.Element {
  return (
    <div className="min-h-screen bg-paper p-4 sm:p-6" aria-hidden>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="t-label text-ink-3">Softphone preview</p>
          <p className="t-section text-ink">{label}</p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[0, 1, 2].map(i => (
          <div key={i} className="h-24 rounded-card border border-rule bg-surface shadow-card" />
        ))}
      </div>
      <div className="mt-4 h-[420px] rounded-card border border-rule bg-surface shadow-card">
        <div className="space-y-3 p-4">
          {[0, 1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-4 rounded bg-sunken" style={{ width: `${90 - i * 9}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}
