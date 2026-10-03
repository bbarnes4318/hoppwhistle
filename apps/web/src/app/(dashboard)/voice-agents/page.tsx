'use client';

import { AlertTriangle, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { useBrand } from '@/hooks/use-brand';
import { apiClient } from '@/lib/api';

/**
 * AI Voice.
 *
 * Embeds the AI Voice app, single-signed-on to the current Hopwhistle user. On
 * mount we call the SSO endpoint, which mints the AI Voice session cookie on
 * the AI Voice app's registrable domain; once that succeeds the iframe loads
 * already authenticated. Which host and which cookie domain come from
 * `AIVOICE_URL` / `AIVOICE_COOKIE_DOMAIN` — see apps/api/src/routes/aivoice.ts.
 *
 * ── Two bugs this page had, both of which looked identical from outside ─────
 *
 * 1. The fetch asked for `/v1/aivoice/session`, MISSING THE `/api` PREFIX. The
 *    client builds its URL as `window.location.origin + endpoint`, so that
 *    resolved to `https://<portal>/v1/aivoice/session` — a path Next.js does
 *    not serve and the API never sees. Every other call site in this app uses
 *    `/api/v1/...`; this was the only one that did not. `api-paths.test.ts`
 *    now pins that.
 *
 * 2. The 404 was then swallowed. `apiClient.get()` NEVER THROWS — it returns
 *    `{ error }` — so the `catch` below could not fire, `res.data?.url` was
 *    undefined, and the page rendered the generic "not available right now"
 *    with nothing about a 404 anywhere. The same mistake had just been fixed in
 *    the call ledger. So the error branch now reads `res.error` and shows the
 *    message the API actually sent.
 *
 * ── Branding and layout ──────────────────────────────────────────────────────
 *
 * The AI Voice app skins itself as the portal that embeds it: `?brand=` on the
 * frame's src names the brand (`netenroll`, or the agency's theme key such as
 * `life-leads-plus`) and the app swaps its logo and palette to match. The src
 * is only set once the session has said whose portal this is, so a
 * white-labelled agency never sees NetEnroll's skin load first.
 *
 * The frame fills <main> exactly; the dashboard layout drops the KPI strip and
 * the softphone runway on this route (see `isEmbeddedAppPath`), so nothing is
 * stacked above the app and no blank band is cut out of the bottom of it.
 */
export default function AIVoicePage() {
  const { brand, settled: brandSettled } = useBrand();
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [frameLoaded, setFrameLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await apiClient.get<{ url: string }>('/api/v1/aivoice/session');
        if (cancelled) return;

        if (res.data?.url) {
          setUrl(res.data.url);
        } else if (res.error) {
          // Show what the API said. "AI Voice is not configured" and "your
          // session expired" need different actions from whoever is reading.
          setError(res.error.message || 'AI Voice is not available right now.');
        } else {
          setError('AI Voice is not available right now.');
        }
      } catch {
        if (!cancelled) setError('Could not connect to AI Voice.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setError(null);
    setUrl(null);
    setFrameLoaded(false);
    setAttempt(n => n + 1);
  }, []);

  if (error) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md rounded-card border border-rule bg-surface p-8 text-center shadow-card">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-dropped-tint">
            <AlertTriangle aria-hidden className="h-5 w-5 text-dropped-ink" />
          </div>
          <h2 className="mt-4 text-base font-semibold text-ink">Voice Agents is unavailable</h2>
          <p className="mt-1.5 t-body text-ink-2">{error}</p>
          <Button className="mt-6" onClick={retry}>
            <RefreshCw aria-hidden className="mr-2 h-4 w-4" />
            Try again
          </Button>
        </div>
      </div>
    );
  }

  const src = url && brandSettled ? frameSrc(url, brand?.key ?? 'netenroll') : null;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-surface">
      {!src || !frameLoaded ? (
        <div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-paper"
          aria-busy="true"
          aria-live="polite"
        >
          <Loader2 aria-hidden className="h-6 w-6 animate-spin text-brand-ink" />
          <p className="t-body text-ink-2">Loading Voice Agents…</p>
        </div>
      ) : null}
      {src ? (
        <iframe
          key={src}
          src={src}
          title="Voice Agents"
          className="block min-h-0 w-full flex-1 border-0"
          allow="microphone; autoplay; clipboard-write"
          onLoad={() => setFrameLoaded(true)}
        />
      ) : null}
    </div>
  );
}

/** The AI Voice URL with the portal's brand on it (see the note above). */
function frameSrc(base: string, brandKey: string): string {
  try {
    const u = new URL(base);
    u.searchParams.set('brand', brandKey);
    return u.toString();
  } catch {
    return base;
  }
}
