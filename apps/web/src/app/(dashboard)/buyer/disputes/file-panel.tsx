'use client';

import { Flag, PhoneOff } from 'lucide-react';
import * as React from 'react';

import { type Column, DataTable, DurationBar, MoneyCell, PhoneCell } from '@/components/domain';
import { Button } from '@/components/ui/button';

import { DisputeDrawer, type DisputableCall } from '../_components/dispute-drawer';

/**
 * The ten-second path: pick the call, pick a reason, file.
 *
 * The list is the buyer's recent charged calls that are not already settled, so
 * finding the call is scanning rather than searching. The DurationBar is on
 * every row because the single most common dispute is "that call was too short
 * to charge for", and the bar answers it before the drawer opens.
 */

export interface FileableCall extends DisputableCall {
  scaleSeconds: number;
}

export function FilePanel({ calls }: { calls: FileableCall[] }) {
  const [target, setTarget] = React.useState<FileableCall | null>(null);

  const columns: Column<FileableCall>[] = [
    {
      id: 'caller',
      header: 'Caller',
      width: '150px',
      cell: row => <PhoneCell number={row.callerId} />,
    },
    {
      id: 'campaign',
      header: 'Campaign',
      hideBelow: 'lg',
      cell: row => <span className="truncate">{row.campaignName ?? '—'}</span>,
    },
    {
      id: 'when',
      header: 'Received',
      hideBelow: 'md',
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
      id: 'duration',
      header: 'Duration',
      width: '150px',
      cell: row => (
        <DurationBar
          seconds={row.connectedDuration ?? 0}
          thresholdSeconds={row.thresholdSeconds}
          scaleSeconds={row.scaleSeconds}
          showValue
        />
      ),
    },
    {
      id: 'charged',
      header: 'Charged',
      numeric: true,
      width: '100px',
      cell: row => <MoneyCell amount={row.amount} unit="major" />,
    },
    {
      id: 'file',
      header: <span className="sr-only">File a dispute</span>,
      align: 'right',
      width: '110px',
      cell: row => (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Dispute the call from ${row.callerId ?? 'unknown caller'}`}
          onClick={e => {
            e.stopPropagation();
            setTarget(row);
          }}
          className="h-7 gap-1 rounded-control px-2 text-ink-2 hover:bg-dropped-tint hover:text-dropped-ink"
        >
          <Flag aria-hidden className="h-3.5 w-3.5" />
          <span className="t-meta">Dispute</span>
        </Button>
      ),
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        rows={calls}
        rowKey={row => row.id}
        stickyHeader={false}
        onRowActivate={row => setTarget(row)}
        isRowActive={row => target?.id === row.id}
        caption="Recent charged calls you have not settled"
        empty={{
          headline: 'Nothing left to dispute',
          body: 'Every charged call in the last 30 days has been accepted or already has a dispute on it.',
          icon: PhoneOff,
        }}
      />

      <DisputeDrawer
        call={target}
        open={target !== null}
        onOpenChange={open => !open && setTarget(null)}
      />
    </>
  );
}
