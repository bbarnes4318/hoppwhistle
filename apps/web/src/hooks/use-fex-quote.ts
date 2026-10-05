'use client';

/**
 * Live quoting.
 *
 * Every edit re-quotes, but not every keystroke: the draft settles for 250 ms
 * first, and a request still in flight when the draft changes again is
 * aborted. The last results stay on screen, marked stale, while the next quote
 * is in flight -- the list never flashes empty between two keystrokes.
 *
 * Nothing is sent until the draft has a state, a sex, an age or date of birth
 * and a coverage amount or budget: a quote without them is not a quote.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { fexApi, type FexCatalog, type FexQuoteResponse, type FexSettings } from '@/lib/fex/api';
import { toApplicant, type QuoteDraft } from '@/lib/fex/draft';

export const QUOTE_DEBOUNCE_MS = 250;

export type FexQuoteStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface FexQuoteState {
  status: FexQuoteStatus;
  data: FexQuoteResponse | null;
  /** True while `data` is from an earlier draft and a newer quote is in flight. */
  stale: boolean;
  error: string | null;
  retry: () => void;
}

export function useFexQuote(draft: QuoteDraft): FexQuoteState {
  const applicant = useMemo(() => toApplicant(draft), [draft]);
  // Compared by value: a re-render that rebuilds an identical body is not an edit.
  const key = applicant ? JSON.stringify(applicant) : null;

  const [status, setStatus] = useState<FexQuoteStatus>('idle');
  const [data, setData] = useState<FexQuoteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    controllerRef.current?.abort();
    if (!key) {
      setStatus('idle');
      setError(null);
      return;
    }
    // Loading from the first edit, so the screen can mark what it shows as stale.
    setStatus('loading');
    const timer = setTimeout(() => {
      const controller = new AbortController();
      controllerRef.current = controller;
      void fexApi
        .quote(JSON.parse(key) as NonNullable<typeof applicant>, controller.signal)
        .then(result => {
          if (controller.signal.aborted) return;
          if (result.ok) {
            setData(result.data);
            setError(null);
            setStatus('ready');
          } else {
            setError(result.message);
            setStatus('error');
          }
        });
    }, QUOTE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [key, attempt]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const retry = useCallback(() => setAttempt(a => a + 1), []);

  return {
    status,
    data: key ? data : null,
    stale: status === 'loading' && data !== null,
    error,
    retry,
  };
}

// ─── Catalog: once per session ────────────────────────────────────────────────

let catalogCache: FexCatalog | null = null;
let catalogPromise: Promise<FexCatalog | null> | null = null;

/** Exported for tests. */
export function resetFexCatalogCache(): void {
  catalogCache = null;
  catalogPromise = null;
}

export function useFexCatalog(): { catalog: FexCatalog | null; error: string | null } {
  const [catalog, setCatalog] = useState<FexCatalog | null>(catalogCache);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (catalogCache) {
      setCatalog(catalogCache);
      return;
    }
    let active = true;
    catalogPromise ??= fexApi.catalog().then(result => {
      if (result.ok) {
        catalogCache = result.data;
        return result.data;
      }
      catalogPromise = null;
      if (active) setError(result.message);
      return null;
    });
    void catalogPromise.then(value => {
      if (active && value) setCatalog(value);
    });
    return () => {
      active = false;
    };
  }, []);

  return { catalog, error };
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export function useFexSettings(): {
  settings: FexSettings | null;
  loading: boolean;
  reload: () => void;
  setSettings: (next: FexSettings) => void;
} {
  const [settings, setSettings] = useState<FexSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void fexApi.settings().then(result => {
      if (!active) return;
      if (result.ok) setSettings(result.data);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [attempt]);

  return { settings, loading, reload: () => setAttempt(a => a + 1), setSettings };
}
