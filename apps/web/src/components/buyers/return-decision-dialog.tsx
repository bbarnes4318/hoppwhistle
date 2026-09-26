'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { dollars } from '@/components/delivery/ledger';
import { Notice } from '@/components/domain';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';

import type { ReturnDecision, ReturnRow, ReturnSubject } from './returns-types';

/** The server's limit on a decision note. */
export const NOTE_MAX_LENGTH = 500;

/**
 * Shown on Accept when the publisher has already been paid for the call: the
 * payout is taken back out of their next payment (routes/returns.ts).
 */
export function paidPublisherWarning(
  subject: Pick<ReturnSubject, 'publisherPayoutAmount'>
): string {
  const amount = dollars(subject.publisherPayoutAmount ?? 0);
  return `This publisher was already paid ${amount} for this call. ${amount} will be deducted from their next payment.`;
}

/**
 * What a decision will do to the buyer's money, in one sentence.
 *
 * Mirrors the server's rule in `routes/returns.ts` so the person deciding
 * reads the consequence before it happens: an UPFRONT buyer who was CHARGED
 * gets the amount back on their balance; anybody else is simply not charged.
 */
export function buyerEffect(subject: ReturnSubject, decision: ReturnDecision): string {
  const amount = dollars(subject.buyerBillableAmount ?? 0);
  const buyer = subject.buyer?.name ?? 'the buyer';
  if (decision === 'DENY') return `${buyer} is charged ${amount} for this call as normal.`;
  if (subject.buyerBillingType === 'UPFRONT' && subject.buyerChargeStatus === 'CHARGED') {
    return `${amount} is credited back to ${buyer}'s balance.`;
  }
  return `${buyer} is not charged the ${amount} for this call.`;
}

/** What a decision will do to the publisher's payout, in one sentence. */
export function publisherEffect(subject: ReturnSubject, decision: ReturnDecision): string {
  const status = subject.publisherPayoutStatus;
  const amount = dollars(subject.publisherPayoutAmount ?? 0);
  const publisher = subject.publisher?.name ?? 'The publisher';
  if (decision === 'DENY') {
    return status === 'HELD'
      ? `${publisher}'s ${amount} payout goes back to payable.`
      : `${publisher}'s payout is unchanged.`;
  }
  if (status === 'PAYABLE' || status === 'HELD') {
    return `${publisher} is not paid the ${amount} payout for this call.`;
  }
  if (status === 'PAID') return `${publisher}'s ${amount} comes out of their next payment.`;
  return 'There is no publisher payout on this call.';
}

export function ReturnDecisionDialog({
  subject,
  decision,
  onOpenChange,
  onDecided,
}: {
  /** The return being decided; null closes the dialog. */
  subject: ReturnSubject | null;
  decision: ReturnDecision;
  onOpenChange: (open: boolean) => void;
  onDecided: (row: ReturnRow | null) => void;
}): JSX.Element {
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (subject) {
      setNote('');
      setError(null);
    }
  }, [subject]);

  async function submit(): Promise<void> {
    if (!subject) return;
    setSaving(true);
    setError(null);
    try {
      const response = await apiClient.post<Envelope<ReturnRow>>(
        `/api/v1/returns/${encodeURIComponent(subject.callId)}/decision`,
        { decision, note: note.trim() || undefined }
      );
      if (response.error) {
        setError(response.error.message);
        return;
      }
      onDecided(payload(response) ?? null);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  const accept = decision === 'ACCEPT';
  const alreadyPaid = accept && subject?.publisherPayoutStatus === 'PAID';

  return (
    <Dialog open={subject !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{accept ? 'Accept this return?' : 'Deny this return?'}</DialogTitle>
          <DialogDescription>
            {accept
              ? 'The call is taken off the buyer and the publisher, and counts for nothing.'
              : 'The call stands as sold.'}
          </DialogDescription>
        </DialogHeader>

        {subject ? (
          <div className="flex flex-col gap-4">
            <dl className="grid grid-cols-1 gap-3">
              <div>
                <dt className="t-label text-ink-3">{accept ? 'Refund to buyer' : 'Buyer'}</dt>
                <dd className="t-body text-ink" data-effect="buyer">
                  {buyerEffect(subject, decision)}
                </dd>
              </div>
              <div>
                <dt className="t-label text-ink-3">Publisher payout</dt>
                <dd className="t-body text-ink" data-effect="publisher">
                  {publisherEffect(subject, decision)}
                </dd>
              </div>
            </dl>

            {alreadyPaid && subject ? (
              <Notice tone="warning" title={paidPublisherWarning(subject)} />
            ) : null}

            <div className="grid gap-2">
              <Label htmlFor="return-note">Note (optional)</Label>
              <Textarea
                id="return-note"
                value={note}
                maxLength={NOTE_MAX_LENGTH}
                onChange={event => setNote(event.target.value)}
                placeholder={accept ? 'Why the return was accepted' : 'Why the return was denied'}
              />
              <p className="t-meta text-ink-3">
                {note.length}/{NOTE_MAX_LENGTH}
              </p>
            </div>

            {error ? <Notice tone="error" title={error} /> : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant={accept ? 'default' : 'destructive'}
            onClick={() => void submit()}
            disabled={saving || !subject}
          >
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {accept ? 'Accept return' : 'Deny return'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
