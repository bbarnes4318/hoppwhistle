'use client';

import { Receipt } from 'lucide-react';
import * as React from 'react';

import { type Column, DataTable, MoneyCell, StatusChip } from '@/components/domain';

/** The wallet ledger: every credit in and every call charged out. */

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
      width: '150px',
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
      width: '110px',
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
      width: '120px',
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
