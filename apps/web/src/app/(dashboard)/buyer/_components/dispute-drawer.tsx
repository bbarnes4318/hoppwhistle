'use client';

import { FileAudio, Loader2 } from 'lucide-react';
import * as React from 'react';

import { DrawerSection, DurationBar, MoneyCell, SheetDrawer } from '@/components/domain';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

import { DISPUTE_REASONS, type DisputeEvidence, type DisputeReason } from '../_lib/dispute';
import { disputeCall } from '../actions';

/**
 * The dispute form: reason first, note second, evidence already attached.
 *
 * The ordering is the whole design. A free-text box first produces a paragraph
 * that has to be read and categorised by hand before anything can happen to it;
 * a reason first produces a dispute that can be routed the moment it lands, and
 * makes the note optional rather than load-bearing. Filing is two clicks — pick
 * a reason, file — because the evidence a reviewer needs is gathered by the
 * page, not typed by the buyer.
 */

export interface DisputableCall {
  id: string;
  createdAt: string;
  callerId: string | null;
  campaignName: string | null;
  connectedDuration: number | null;
  duration: number | null;
  thresholdSeconds: number | null;
  billable: boolean;
  billableReason: string | null;
  amount: number | null;
  recordingUrl: string | null;
}

export function buildEvidence(call: DisputableCall): DisputeEvidence {
  return {
    connectedSeconds: call.connectedDuration ?? call.duration ?? 0,
    thresholdSeconds: call.thresholdSeconds,
    billable: call.billable,
    billableReason: call.billableReason,
    amount: call.amount,
    recordingUrl: call.recordingUrl,
    callCreatedAt: call.createdAt,
  };
}

export function DisputeDrawer({
  call,
  open,
  onOpenChange,
  onFiled,
}: {
  call: DisputableCall | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFiled?: () => void;
}) {
  const [reason, setReason] = React.useState<DisputeReason | null>(null);
  const [note, setNote] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);

  // A drawer opened on a different call must not carry the last one's answers.
  React.useEffect(() => {
    if (open) {
      setReason(null);
      setNote('');
    }
  }, [open, call?.id]);

  if (!call) {
    return (
      <SheetDrawer open={open} onOpenChange={onOpenChange} title="File a dispute">
        <p className="t-body p-4 text-ink-3">No call selected.</p>
      </SheetDrawer>
    );
  }

  const connected = call.connectedDuration ?? call.duration ?? 0;

  async function submit() {
    if (!reason || !call) return;
    setSubmitting(true);
    const result = await disputeCall({
      callId: call.id,
      reason,
      note,
      evidence: buildEvidence(call),
    });
    setSubmitting(false);

    if (result.ok) {
      toast.success('Dispute filed', 'The recording and the threshold measurement went with it.');
      onOpenChange(false);
      onFiled?.();
    } else {
      toast.error('Could not file the dispute', result.error);
    }
  }

  return (
    <SheetDrawer
      open={open}
      onOpenChange={onOpenChange}
      title="File a dispute"
      description={`${new Date(call.createdAt).toLocaleString()} · ${call.callerId ?? 'unknown caller'}`}
      footer={
        <div className="flex items-center justify-between gap-3">
          <span className="t-meta text-ink-3">
            {reason ? 'Evidence is attached below.' : 'Pick a reason to file.'}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!reason || submitting}
              onClick={() => void submit()}
            >
              {submitting ? (
                <Loader2 aria-hidden className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : null}
              File dispute
            </Button>
          </div>
        </div>
      }
    >
      <fieldset className="border-b border-rule px-4 py-3">
        <legend className="t-label mb-2 text-ink-3">1 · Reason</legend>
        <div className="space-y-1">
          {DISPUTE_REASONS.map(option => (
            <label
              key={option.value}
              className={cn(
                'flex cursor-pointer items-center gap-2.5 rounded-control border px-3 py-2',
                reason === option.value
                  ? 'border-money bg-money-tint'
                  : 'border-rule hover:bg-sunken'
              )}
            >
              <input
                type="radio"
                name="dispute-reason"
                value={option.value}
                checked={reason === option.value}
                onChange={() => setReason(option.value)}
                className="h-3.5 w-3.5 shrink-0 accent-[color:var(--money)]"
              />
              <span className="t-body text-ink">{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="border-b border-rule px-4 py-3">
        <label htmlFor="dispute-note" className="t-label mb-2 block text-ink-3">
          2 · Note <span className="normal-case tracking-normal">(optional)</span>
        </label>
        <Textarea
          id="dispute-note"
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={3}
          placeholder="Anything the reason code does not already say."
          className="t-body rounded-control border-rule bg-surface text-ink"
        />
      </div>

      <DrawerSection title="Attached automatically">
        <div className="space-y-3">
          <div>
            <p className="t-meta mb-1 text-ink-3">Duration against the threshold</p>
            <DurationBar
              seconds={connected}
              thresholdSeconds={call.thresholdSeconds}
              size="detail"
              showValue
            />
            <p className="t-meta mt-1 text-ink-2">
              Connected {connected}s
              {call.thresholdSeconds != null
                ? ` against a ${call.thresholdSeconds}s threshold`
                : ', no threshold configured'}
              {' · '}
              marked {call.billable ? 'billable' : 'not billable'}
              {call.amount != null ? ' · ' : ''}
              {call.amount != null ? (
                <MoneyCell amount={call.amount} unit="major" className="text-ink-2" />
              ) : null}
            </p>
            {call.billableReason ? (
              <p className="t-meta mt-1 text-ink-3">Reason on file: {call.billableReason}</p>
            ) : null}
          </div>

          <div>
            <p className="t-meta mb-1 text-ink-3">Recording</p>
            {call.recordingUrl ? (
              <a
                href={call.recordingUrl}
                target="_blank"
                rel="noreferrer"
                className="t-body inline-flex items-center gap-1.5 text-money underline"
              >
                <FileAudio aria-hidden className="h-3.5 w-3.5" />
                Attached to this dispute
              </a>
            ) : (
              <p className="t-body text-ink-3">
                No recording is available for this call — the dispute says so explicitly.
              </p>
            )}
          </div>
        </div>
      </DrawerSection>
    </SheetDrawer>
  );
}
