'use client';

import { Loader2, AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';

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
 */
export default function AIVoicePage() {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  }, []);

  if (error) {
    return (
      <div className="flex h-[calc(100vh-4rem)] flex-col items-center justify-center gap-3 text-center">
        <AlertTriangle className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{error}</p>
      </div>
    );
  }

  if (!url) {
    return (
      <div className="flex h-[calc(100vh-4rem)] flex-col items-center justify-center gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading AI Voice…</p>
      </div>
    );
  }

  return (
    <iframe
      src={url}
      title="AI Voice"
      className="h-[calc(100vh-4rem)] w-full border-0"
      allow="microphone; autoplay; clipboard-write"
    />
  );
}
