'use client';

import { BarChart3 } from 'lucide-react';
import * as React from 'react';

import { type Column, DataTable, MoneyCell } from '@/components/domain';

/** Where the money went, one row per campaign and destination. */

export interface CampaignSpendRow {
  key: string;
  campaignName: string;
  destinationNumber: string;
  totalCalls: number;
  billableCalls: number;
  billableRate: number;
  averageDuration: number;
  pricePerBillableCall: number;
  cost: number;
  disputes: number;
}

export function CampaignSpendTable({ rows }: { rows: CampaignSpendRow[] }) {
  const columns: Column<CampaignSpendRow>[] = [
    {
      id: 'campaign',
      header: 'Campaign',
      cell: row => (
        <div className="min-w-0">
          <div className="truncate text-ink">{row.campaignName || 'Unattributed'}</div>
          <div className="t-meta truncate text-ink-3">{row.destinationNumber || '—'}</div>
        </div>
      ),
    },
    {
      id: 'calls',
      header: 'Calls',
      numeric: true,
      width: '80px',
      hideBelow: 'sm',
      cell: row => row.totalCalls.toLocaleString(),
    },
    {
      id: 'billable',
      header: 'Billable',
      numeric: true,
      width: '110px',
      cell: row => (
        <span>
          {row.billableCalls.toLocaleString()}
          <span className="text-ink-3"> · {(row.billableRate * 100).toFixed(0)}%</span>
        </span>
      ),
    },
    {
      id: 'avg',
      header: 'Avg connect',
      numeric: true,
      width: '110px',
      hideBelow: 'lg',
      cell: row => `${row.averageDuration}s`,
    },
    {
      id: 'price',
      header: 'Per call',
      numeric: true,
      width: '96px',
      hideBelow: 'md',
      cell: row => <MoneyCell amount={row.pricePerBillableCall} unit="major" />,
    },
    {
      id: 'disputes',
      header: 'Disputed',
      numeric: true,
      width: '100px',
      hideBelow: 'lg',
      cell: row =>
        row.disputes > 0 ? (
          <MoneyCell amount={row.disputes} unit="major" className="text-ringing-ink" />
        ) : (
          <span className="text-ink-3">—</span>
        ),
    },
    {
      id: 'cost',
      header: 'Spend',
      numeric: true,
      width: '110px',
      cell: row => <MoneyCell amount={row.cost} unit="major" tone="money" />,
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={row => row.key}
      stickyHeader={false}
      caption="Spend by campaign"
      empty={{
        headline: 'No spend in this window',
        body: 'Widen the date range, or clear the campaign filter.',
        icon: BarChart3,
        variant: 'filtered',
      }}
    />
  );
}
