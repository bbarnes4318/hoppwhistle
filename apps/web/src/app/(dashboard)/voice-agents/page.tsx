'use client';

import { Loader2, AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';

import { apiClient } from '@/lib/api';

/**
 * AI Voice.
 *
 * Embeds the AI Voice app (aivoice.hopwhistle.com), single-signed-on to the
 * current Hopwhistle user. On mount we call the SSO endpoint, which mints the
 * AI Voice session cookie on `.hopwhistle.com`; once that succeeds the iframe
 * loads already authenticated. See apps/api/src/routes/aivoice.ts.
 */
export default function AIVoicePage() {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await apiClient.get<{ url: string }>('/v1/aivoice/session');
        if (cancelled) return;
        if (res.data?.url) {
          setUrl(res.data.url);
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
