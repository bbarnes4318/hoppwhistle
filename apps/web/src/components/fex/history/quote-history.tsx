'use client';

/**
 * Saved quotes. An agent sees their own; an agency principal sees every
 * agent's, with the agent named. Opening one shows the inputs and the ranked
 * results exactly as they were quoted, read-only.
 */

import Link from 'next/link';
import * as React from 'react';

import { CarrierLogo, DataTable, Notice, Panel, type Column } from '@/components/domain';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { fexApi, MODE_SHORT, money, wholeDollars, type FexQuoteSummary } from '@/lib/fex/api';

import { quoteDateTime as dateTime, SavedQuoteDrawer } from './saved-quote-drawer';

export function QuoteHistory(): JSX.Element {
  const { hasFullAccess, isPlatformAdmin } = useAuth();
  const principal = hasFullAccess || isPlatformAdmin;
  const [rows, setRows] = React.useState<FexQuoteSummary[]>([]);
  const [cursor, setCursor] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [openId, setOpenId] = React.useState<string | null>(null);

  const load = React.useCallback(async (after?: string) => {
    setLoading(true);
    const result = await fexApi.list({ limit: 50, cursor: after });
    setLoading(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setError(null);
    setRows(prev => (after ? [...prev, ...result.data] : result.data));
    setCursor(result.nextCursor ?? null);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const columns: Column<FexQuoteSummary>[] = [
    {
      id: 'when',
      header: 'Quoted',
      cell: q => <span className="tabular-nums">{dateTime(q.createdAt)}</span>,
    },
    {
      id: 'prospect',
      header: 'Prospect',
      // A customer's quote opens their record: the quote is filed there.
      cell: q =>
        q.insuranceLeadId ? (
          <Link
            href={`/insurance-leads/${encodeURIComponent(q.insuranceLeadId)}`}
            className="font-medium text-ink hover:text-brand-ink hover:underline"
            onClick={e => e.stopPropagation()}
          >
            {q.prospectName ?? 'Customer'}
          </Link>
        ) : (
          (q.prospectName ?? <span className="text-ink-3">—</span>)
        ),
    },
    {
      id: 'who',
      header: 'State · age',
      hideBelow: 'md',
      cell: q => (
        <span className="tabular-nums">
          {q.state} · {q.age ?? '—'}
        </span>
      ),
    },
    {
      id: 'ask',
      header: 'Face or budget',
      numeric: true,
      hideBelow: 'lg',
      cell: q =>
        q.faceAmount
          ? wholeDollars(q.faceAmount)
          : q.budget
            ? `${money(q.budget)}/${MODE_SHORT[q.paymentMode]}`
            : '—',
    },
    {
      id: 'selected',
      header: 'Selected',
      cell: q =>
        q.selectedCarrier ? (
          <span className="flex items-center gap-2.5">
            <CarrierLogo names={[q.selectedCarrier, q.selectedProductId]} size="xs" />
            <span className="min-w-0">
              <span className="font-medium">{q.selectedCarrier}</span>
              <span className="text-ink-2">
                {' '}
                · {q.selectedProduct} · {q.selectedClass}
              </span>
            </span>
          </span>
        ) : (
          <span className="text-ink-3">Saved, none used</span>
        ),
    },
    {
      id: 'premium',
      header: 'Premium',
      numeric: true,
      cell: q =>
        q.selectedPremium != null ? (
          <span className="t-num tabular-nums">
            {money(q.selectedPremium)}
            <span className="text-ink-3">/{MODE_SHORT[q.paymentMode]}</span>
          </span>
        ) : (
          '—'
        ),
    },
    ...(principal
      ? [
          {
            id: 'agent',
            header: 'Agent',
            hideBelow: 'md' as const,
            cell: (q: FexQuoteSummary) => q.createdBy.name,
          },
        ]
      : []),
    {
      id: 'app',
      header: 'Application',
      hideBelow: 'sm',
      cell: q =>
        q.applicationId ? (
          <Link
            href="/applications"
            className="text-brand-ink hover:underline"
            onClick={e => e.stopPropagation()}
          >
            Application
          </Link>
        ) : null,
    },
  ];

  return (
    <Panel>
      {error ? (
        <Notice
          tone="error"
          className="m-4"
          action={
            <Button size="sm" variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          }
        >
          {error}
        </Notice>
      ) : null}
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={q => q.id}
        loading={loading && rows.length === 0}
        onRowActivate={q => setOpenId(q.id)}
        caption="Saved quotes"
        empty={{
          headline: 'No saved quotes yet',
          body: 'A quote is saved when you use it or choose Save quote on a result.',
        }}
      />
      {cursor ? (
        <div className="border-t border-rule p-3 text-center">
          <Button size="sm" variant="outline" disabled={loading} onClick={() => void load(cursor)}>
            Load more
          </Button>
        </div>
      ) : null}
      <SavedQuoteDrawer id={openId} onClose={() => setOpenId(null)} />
    </Panel>
  );
}
