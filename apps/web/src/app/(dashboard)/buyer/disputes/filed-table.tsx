'use client';

import { ShieldCheck } from 'lucide-react';
import * as React from 'react';

import {
  type Column,
  DataTable,
  DrawerField,
  DrawerSection,
  DurationBar,
  MoneyCell,
  PhoneCell,
  SheetDrawer,
  StatusChip,
} from '@/components/domain';

/**
 * Disputes you have filed, and where each one got to.
 *
 * The platform records a dispute as open or not — there is no resolved state
 * behind it yet — so this says "under review" and means it, rather than
 * inventing a progress bar out of a single boolean.
 */

export interface FiledDisputeRow {
  id: string;
  callerId: string | null;
  campaignName: string | null;
  createdAt: string;
  filedAt: string | null;
  status: string;
  reason: string | null;
  amount: number | null;
  connectedSeconds: number;
  thresholdSeconds: number | null;
  scaleSeconds: number;
}

/** The reason is stored as one composed block; the first line is the summary. */
function reasonHeadline(reason: string | null): string {
  if (!reason) return 'No reason recorded';
  return reason.split('\n')[0].replace(/^\[[A-Z_]+\]\s*/, '');
}

export function FiledDisputesTable({ rows }: { rows: FiledDisputeRow[] }) {
  const [detail, setDetail] = React.useState<FiledDisputeRow | null>(null);

  const columns: Column<FiledDisputeRow>[] = [
    {
      id: 'caller',
      header: 'Caller',
      width: '150px',
      cell: row => <PhoneCell number={row.callerId} />,
    },
    {
      id: 'reason',
      header: 'Reason',
      cell: row => <span className="truncate">{reasonHeadline(row.reason)}</span>,
    },
    {
      id: 'filed',
      header: 'Filed',
      hideBelow: 'md',
      width: '130px',
      cell: row => (
        <span className="t-data tabular text-ink-2">
          {row.filedAt ? new Date(row.filedAt).toLocaleDateString() : '—'}
        </span>
      ),
    },
    {
      id: 'duration',
      header: 'Duration',
      hideBelow: 'lg',
      width: '150px',
      cell: row => (
        <DurationBar
          seconds={row.connectedSeconds}
          thresholdSeconds={row.thresholdSeconds}
          scaleSeconds={row.scaleSeconds}
          showValue
        />
      ),
    },
    {
      id: 'status',
      header: 'Outcome',
      width: '140px',
      cell: row => <StatusChip value={row.status} tone="ringing" label="Under review" size="sm" />,
    },
    {
      id: 'amount',
      header: 'At stake',
      numeric: true,
      width: '100px',
      cell: row => <MoneyCell amount={row.amount} unit="major" />,
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={row => row.id}
        stickyHeader={false}
        onRowActivate={row => setDetail(row)}
        isRowActive={row => detail?.id === row.id}
        caption="Disputes you have filed"
        empty={{
          headline: 'You have not filed any disputes',
          body: 'Calls you dispute show up here with the evidence that went with them.',
          icon: ShieldCheck,
        }}
      />

      <SheetDrawer
        open={detail !== null}
        onOpenChange={open => !open && setDetail(null)}
        title="Dispute detail"
        description={
          detail
            ? `Filed ${detail.filedAt ? new Date(detail.filedAt).toLocaleString() : 'recently'}`
            : undefined
        }
      >
        {detail ? (
          <>
            <DrawerSection title="Outcome">
              <DrawerField label="Status">
                <StatusChip value={detail.status} tone="ringing" label="Under review" size="sm" />
              </DrawerField>
              <DrawerField label="At stake">
                <MoneyCell amount={detail.amount} unit="major" tone="auto" />
              </DrawerField>
              <p className="t-meta mt-2 text-ink-3">
                The charge stands while this is reviewed, and the publisher&apos;s payout is held.
                The outcome appears here once it is decided.
              </p>
            </DrawerSection>

            <DrawerSection title="The call">
              <div className="pb-3">
                <DurationBar
                  seconds={detail.connectedSeconds}
                  thresholdSeconds={detail.thresholdSeconds}
                  size="detail"
                  showValue
                />
              </div>
              <DrawerField label="Caller">
                <PhoneCell number={detail.callerId} />
              </DrawerField>
              <DrawerField label="Campaign">{detail.campaignName ?? '—'}</DrawerField>
              <DrawerField label="Received">
                {new Date(detail.createdAt).toLocaleString()}
              </DrawerField>
            </DrawerSection>

            <DrawerSection title="What you filed">
              <pre className="t-body whitespace-pre-wrap break-words font-sans text-ink">
                {detail.reason ?? 'No reason recorded.'}
              </pre>
            </DrawerSection>
          </>
        ) : null}
      </SheetDrawer>
    </>
  );
}
