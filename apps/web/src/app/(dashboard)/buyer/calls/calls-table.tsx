'use client';

import { Check, Flag, Loader2, PhoneOff } from 'lucide-react';
import * as React from 'react';

import {
  type Column,
  DataTable,
  DrawerField,
  DrawerSection,
  DurationBar,
  MoneyCell,
  PhoneCell,
  RecordingPlayer,
  SheetDrawer,
  StatusChip,
} from '@/components/domain';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

import { DisputeDrawer, type DisputableCall } from '../_components/dispute-drawer';
import { acceptCall } from '../actions';

/**
 * The call list.
 *
 * Two things decide the shape of this table. First, DurationBar on every row,
 * drawn to one shared scale, so "did this call pay" is answered by a shape you
 * scan down the column rather than a number you read and compare. Second,
 * accept and dispute sit in the row itself: reviewing is the common case and it
 * should not cost a navigation, so the drawer is where you go when you want
 * more, never where you have to go to act.
 */

export interface CallRowView {
  id: string;
  createdAt: string;
  callerId: string | null;
  toNumber: string | null;
  campaignName: string | null;
  targetName: string | null;
  status: string;
  connectedSeconds: number;
  thresholdSeconds: number | null;
  billable: boolean;
  billableReason: string | null;
  amount: number | null;
  chargeStatus: string | null;
  disputeStatus: string | null;
  disposition: string | null;
  recordingUrl: string | null;
}

function outcomeChip(row: CallRowView): React.ReactNode {
  if (row.disputeStatus) {
    // disputeStatus is a free String in the schema, not an enum, so the tone
    // table cannot resolve it. Amber, not violet: an open dispute is an
    // unsettled question, not something the platform stopped on purpose.
    return <StatusChip value={row.disputeStatus} tone="ringing" size="sm" />;
  }
  if (row.disposition === 'VERIFIED') {
    return <StatusChip value="ACCEPTED" tone="live" label="Accepted" size="sm" />;
  }
  return row.billable ? (
    <StatusChip value="BILLABLE" tone="live" label="Billable" size="sm" />
  ) : (
    <StatusChip value="NOT_BILLABLE" tone="neutral" label="Not billable" size="sm" />
  );
}

/** A call is settled once it has been accepted or disputed — nothing left to do. */
function isSettled(row: CallRowView): boolean {
  return Boolean(row.disputeStatus) || row.disposition === 'VERIFIED';
}

function RowActions({
  row,
  canDispute,
  onDispute,
  pendingId,
  onAccept,
}: {
  row: CallRowView;
  canDispute: boolean;
  onDispute: (row: CallRowView) => void;
  pendingId: string | null;
  onAccept: (row: CallRowView) => void;
}) {
  const settled = isSettled(row);
  const pending = pendingId === row.id;

  if (settled) {
    return <span className="t-meta text-ink-3">Settled</span>;
  }

  // stopPropagation on both: the row itself opens the drawer, and clicking an
  // action must not do both things at once.
  return (
    <div className="flex items-center justify-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={pending}
        aria-label={`Accept the call from ${row.callerId ?? 'unknown caller'}`}
        onClick={e => {
          e.stopPropagation();
          onAccept(row);
        }}
        className="h-7 gap-1 rounded-control px-1.5 text-ink-2 hover:bg-live-tint hover:text-live-ink sm:px-2"
      >
        {pending ? (
          <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Check aria-hidden className="h-3.5 w-3.5" />
        )}
        <span className="t-meta hidden sm:inline">Accept</span>
      </Button>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!canDispute}
        title={canDispute ? undefined : 'Your account is not permitted to file disputes.'}
        aria-label={`Dispute the call from ${row.callerId ?? 'unknown caller'}`}
        onClick={e => {
          e.stopPropagation();
          onDispute(row);
        }}
        className="h-7 gap-1 rounded-control px-1.5 text-ink-2 hover:bg-dropped-tint hover:text-dropped-ink sm:px-2"
      >
        <Flag aria-hidden className="h-3.5 w-3.5" />
        <span className="t-meta hidden sm:inline">Dispute</span>
      </Button>
    </div>
  );
}

export function CallsTable({
  rows,
  scaleSeconds,
  canDispute,
  emptyIsFiltered,
}: {
  rows: CallRowView[];
  scaleSeconds: number;
  canDispute: boolean;
  emptyIsFiltered: boolean;
}) {
  const [detail, setDetail] = React.useState<CallRowView | null>(null);
  const [disputing, setDisputing] = React.useState<CallRowView | null>(null);
  const [accepting, setAccepting] = React.useState<string | null>(null);

  // Wrapped rather than passed as an async handler: an onClick that returns a
  // promise is a floating promise nobody awaits, so the await lives in here.
  const onAccept = React.useCallback((row: CallRowView) => {
    void (async () => {
      setAccepting(row.id);
      const result = await acceptCall(row.id);
      setAccepting(null);
      if (result.ok) toast.success('Call accepted');
      else toast.error('Could not accept this call', result.error);
    })();
  }, []);

  const openDispute = React.useCallback((row: CallRowView) => {
    setDisputing(row);
  }, []);

  const columns: Column<CallRowView>[] = [
    {
      id: 'caller',
      // Widths are classes rather than the inline `width` prop so they can be
      // breakpoint-aware: at 375px the row is caller, bar, amount, actions, and
      // every one of them has to give up something for the other three.
      header: 'Caller',
      cellClassName: 'px-2 sm:px-3 w-[104px] sm:w-[150px]',
      headClassName: 'px-2 sm:px-3 w-[104px] sm:w-[150px]',
      cell: row => (
        <div className="max-w-[92px] truncate sm:max-w-none">
          <PhoneCell number={row.callerId} />
        </div>
      ),
    },
    {
      id: 'campaign',
      header: 'Campaign',
      hideBelow: 'lg',
      cell: row => <span className="truncate">{row.campaignName ?? '—'}</span>,
    },
    {
      id: 'received',
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
      cellClassName: 'px-2 sm:px-3 w-[98px] sm:w-[160px]',
      headClassName: 'px-2 sm:px-3 w-[98px] sm:w-[160px]',
      cell: row => (
        <DurationBar
          seconds={row.connectedSeconds}
          thresholdSeconds={row.thresholdSeconds}
          scaleSeconds={scaleSeconds}
          showValue
          className="min-w-[60px]"
        />
      ),
    },
    {
      id: 'outcome',
      header: 'Outcome',
      hideBelow: 'sm',
      width: '130px',
      cell: outcomeChip,
    },
    {
      id: 'charged',
      header: 'Charged',
      numeric: true,
      cellClassName: 'px-2 sm:px-3 w-[68px] sm:w-[100px]',
      headClassName: 'px-2 sm:px-3 w-[68px] sm:w-[100px]',
      cell: row => <MoneyCell amount={row.amount} unit="major" />,
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      cellClassName: 'px-2 sm:px-3 w-[68px] sm:w-[170px]',
      headClassName: 'px-2 sm:px-3 w-[68px] sm:w-[170px]',
      cell: row => (
        <RowActions
          row={row}
          canDispute={canDispute}
          onDispute={openDispute}
          pendingId={accepting}
          onAccept={onAccept}
        />
      ),
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={row => row.id}
        caption="Calls routed to you, newest first"
        onRowActivate={row => setDetail(row)}
        isRowActive={row => detail?.id === row.id}
        empty={{
          headline: emptyIsFiltered ? 'No calls match these filters' : 'No calls yet',
          body: emptyIsFiltered
            ? 'Widen the date range or clear a filter to see more.'
            : 'Calls routed to your targets will appear here as they arrive.',
          icon: PhoneOff,
          variant: emptyIsFiltered ? 'filtered' : 'empty',
        }}
      />

      <CallDetailDrawer
        row={detail}
        open={detail !== null}
        onOpenChange={open => !open && setDetail(null)}
        canDispute={canDispute}
        accepting={accepting === detail?.id}
        onAccept={onAccept}
        onDispute={row => {
          setDetail(null);
          openDispute(row);
        }}
      />

      <DisputeDrawer
        call={disputing ? toDisputable(disputing) : null}
        open={disputing !== null}
        onOpenChange={open => !open && setDisputing(null)}
      />
    </>
  );
}

function toDisputable(row: CallRowView): DisputableCall {
  return {
    id: row.id,
    createdAt: row.createdAt,
    callerId: row.callerId,
    campaignName: row.campaignName,
    connectedDuration: row.connectedSeconds,
    duration: row.connectedSeconds,
    thresholdSeconds: row.thresholdSeconds,
    billable: row.billable,
    billableReason: row.billableReason,
    amount: row.amount,
    recordingUrl: row.recordingUrl,
  };
}

/**
 * The detail drawer. Everything in here is optional — it is the second look at
 * a call you have already decided about from the row, or the recording when the
 * duration alone does not settle it.
 */
function CallDetailDrawer({
  row,
  open,
  onOpenChange,
  canDispute,
  accepting,
  onAccept,
  onDispute,
}: {
  row: CallRowView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canDispute: boolean;
  accepting: boolean;
  onAccept: (row: CallRowView) => void;
  onDispute: (row: CallRowView) => void;
}) {
  if (!row) return null;
  const settled = isSettled(row);

  return (
    <SheetDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={row.callerId ?? 'Call detail'}
      description={new Date(row.createdAt).toLocaleString()}
      footer={
        settled ? (
          <p className="t-meta text-ink-3">
            This call is settled. {row.disputeStatus ? 'A dispute is on file.' : 'You accepted it.'}
          </p>
        ) : (
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!canDispute}
              onClick={() => onDispute(row)}
              className={cn('gap-1.5', canDispute && 'text-dropped-ink')}
            >
              <Flag aria-hidden className="h-3.5 w-3.5" />
              Dispute
            </Button>
            <Button type="button" size="sm" disabled={accepting} onClick={() => onAccept(row)}>
              {accepting ? (
                <Loader2 aria-hidden className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check aria-hidden className="mr-1.5 h-3.5 w-3.5" />
              )}
              Accept
            </Button>
          </div>
        )
      }
    >
      <DrawerSection title="Billing">
        <div className="pb-3">
          <DurationBar
            seconds={row.connectedSeconds}
            thresholdSeconds={row.thresholdSeconds}
            size="detail"
            showValue
          />
        </div>
        <DrawerField label="Outcome">{outcomeChip(row)}</DrawerField>
        <DrawerField label="Charged">
          <MoneyCell amount={row.amount} unit="major" tone="auto" />
        </DrawerField>
        <DrawerField label="Threshold">
          {row.thresholdSeconds != null ? `${row.thresholdSeconds}s connected` : 'Not configured'}
        </DrawerField>
        {row.billableReason ? <DrawerField label="Why">{row.billableReason}</DrawerField> : null}
        {row.chargeStatus ? (
          <DrawerField label="Charge">
            <StatusChip
              value={row.chargeStatus}
              tone={
                row.chargeStatus === 'CHARGED'
                  ? 'money'
                  : row.chargeStatus === 'PENDING'
                    ? 'ringing'
                    : 'neutral'
              }
              size="sm"
            />
          </DrawerField>
        ) : null}
      </DrawerSection>

      <DrawerSection title="Routing">
        <DrawerField label="Caller">
          <PhoneCell number={row.callerId} />
        </DrawerField>
        <DrawerField label="Dialled">
          <PhoneCell number={row.toNumber} />
        </DrawerField>
        <DrawerField label="Campaign">{row.campaignName ?? '—'}</DrawerField>
        <DrawerField label="Target">{row.targetName ?? '—'}</DrawerField>
        <DrawerField label="Call status">
          <StatusChip value={row.status} enumName="CallStatus" size="sm" />
        </DrawerField>
      </DrawerSection>

      <DrawerSection title="Recording">
        {row.recordingUrl ? (
          <RecordingPlayer
            src={row.recordingUrl}
            durationSeconds={row.connectedSeconds}
            thresholdSeconds={row.thresholdSeconds}
          />
        ) : (
          <p className="t-body text-ink-3">No recording is available for this call.</p>
        )}
      </DrawerSection>
    </SheetDrawer>
  );
}
