'use client';

/**
 * One CRM customer's saved quotes: summary rows only, newest first, from
 * `GET /api/v1/insurance-leads/:id/quotes`. The server checks the customer is
 * the caller's and filters by customer; nothing here narrows a wider list.
 *
 * The full snapshot (applicant and results) is loaded only when a quote is
 * opened (`SavedQuoteDrawer`), so a customer page never waits on payloads it
 * may not show.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { fexApi, type FexQuoteSummary } from '@/lib/fex/api';

export interface CustomerQuotesState {
  quotes: FexQuoteSummary[];
  total: number;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
}

const PAGE = 20;

export function useCustomerQuotes(leadId: string | null | undefined): CustomerQuotesState {
  const [quotes, setQuotes] = useState<FexQuoteSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(leadId));
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    if (!leadId) {
      setQuotes([]);
      setTotal(0);
      setLoading(false);
      return;
    }
    const run = ++latest.current;
    setLoading(true);
    void fexApi.customerQuotes(leadId, { limit: PAGE }).then(result => {
      if (run !== latest.current) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setError(null);
      setQuotes(result.data.quotes);
      setTotal(result.data.total);
      setCursor(result.data.nextCursor);
    });
  }, [leadId, attempt]);

  const loadMore = useCallback(() => {
    if (!leadId || !cursor) return;
    const run = ++latest.current;
    setLoading(true);
    void fexApi.customerQuotes(leadId, { limit: PAGE, cursor }).then(result => {
      if (run !== latest.current) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setQuotes(prev => [...prev, ...result.data.quotes]);
      setTotal(result.data.total);
      setCursor(result.data.nextCursor);
    });
  }, [leadId, cursor]);

  const reload = useCallback(() => setAttempt(a => a + 1), []);

  return { quotes, total, loading, error, hasMore: Boolean(cursor), loadMore, reload };
}
