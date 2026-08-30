'use client';

import { PhoneOff } from 'lucide-react';
import * as React from 'react';

import { type Column, DataTable, DurationBar, MoneyCell, PhoneCell } from '@/components/domain';

/**
 * The dashboard's last-few-calls table.
 *
 * Read-only on purpose: the dashboard answers "am I getting what I am paying
 * for", and acting on an individual call belongs on the calls page where the
 * whole list is. It is a client component only because DataTable takes cell
 * render functions, which cannot cross the server boundary.
 */

export interface RecentCallRow {
  id: string;
  createdAt: string;
  callerId: string | null;
  campaignName: string | null;
  connectedSeconds: number;
  thresholdSeconds: number | null;
  amount: number | null;
}

export function RecentCallsTable({
  rows,
  scaleSeconds,
}: {
  rows: RecentCallRow[];
  scaleSeconds: number;
}) {
  const columns: Column<RecentCallRow>[] = [
    {
      id: 'caller',
      header: 'Caller',
      width: '150px',
      cell: row => <PhoneCell number={row.callerId} />,
    },
    {
      id: 'campaign',
      header: 'Campaign',
      hideBelow: 'md',
      cell: row => <span className="truncate">{row.campaignName ?? '—'}</span>,
    },
    {
      id: 'received',
      header: 'Received',
      hideBelow: 'sm',
      width: '110px',
      cell: row => (
        <time dateTime={row.createdAt} className="t-data tabular text-ink-2">
          {new Date(row.createdAt).toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </time>
      ),
    },
    {
      id: 'duration',
      header: 'Duration',
      width: '160px',
      cell: row => (
        <DurationBar
          seconds={row.connectedSeconds}
          thresholdSeconds={row.thresholdSeconds}
          scaleSeconds={scaleSeconds}
          showValue
        />
      ),
    },
    {
      id: 'charged',
      header: 'Charged',
      numeric: true,
      width: '92px',
      cell: row => <MoneyCell amount={row.amount} unit="major" />,
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={row => row.id}
      stickyHeader={false}
      caption="The most recent calls routed to you"
      empty={{
        headline: 'No calls yet today',
        body: 'Calls routed to your targets show up here as they land.',
        icon: PhoneOff,
      }}
    />
  );
}
