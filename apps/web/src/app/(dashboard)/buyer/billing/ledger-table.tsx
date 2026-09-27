'use client';

import { Receipt } from 'lucide-react';
import * as React from 'react';

import { type Column, DataTable, MoneyCell, StatusChip } from '@/components/domain';

/**
 * The wallet ledger: every credit in and every call charged out.
 *
 * Column sizes are MINIMUMS, not fixed widths. At 390px four fixed widths
 * (150 + 110 + 120 and the description) added up to more than the screen, and a
 * fixed-layout cell gives way by crushing its content -- the date wrapped onto
 * three lines and the amount lost its cents. A minimum keeps each cell whole
 * and lets the table run wider than the phone, and DataTable's own
 * `overflow-x-auto` wrapper scrolls it sideways inside the panel instead of
 * widening the page.
 */

export interface LedgerRow {
  id: string;
  createdAt: string;
  type: string;
  description: string | null;
  amount: number;
}

export function LedgerTable({ rows }: { rows: LedgerRow[] }) {
  const columns: Column<LedgerRow>[] = [
    {
      id: 'when',
      header: 'When',
      headClassName: 'min-w-[128px]',
      cellClassName: 'min-w-[128px] whitespace-nowrap',
      cell: row => (
        <time dateTime={row.createdAt} className="t-data tabular text-ink-2">
          {new Date(row.createdAt).toLocaleString(undefined, {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </time>
      ),
    },
    {
      id: 'type',
      header: 'Type',
      headClassName: 'min-w-[96px]',
      cellClassName: 'min-w-[96px]',
      cell: row => (
        <StatusChip
          value={row.type}
          tone={row.amount >= 0 ? 'money' : 'neutral'}
          size="sm"
          dot={false}
        />
      ),
    },
    {
      id: 'description',
      header: 'Description',
      hideBelow: 'sm',
      cell: row => <span className="truncate">{row.description || '—'}</span>,
    },
    {
      id: 'amount',
      header: 'Amount',
      numeric: true,
      headClassName: 'min-w-[104px]',
      cellClassName: 'min-w-[104px] whitespace-nowrap',
      cell: row => <MoneyCell amount={row.amount} unit="major" tone="auto" signed />,
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={row => row.id}
      stickyHeader={false}
      caption="Wallet transactions, newest first"
      empty={{
        headline: 'No transactions yet',
        body: 'Credits added to your account and calls charged against it both land here.',
        icon: Receipt,
      }}
    />
  );
}
