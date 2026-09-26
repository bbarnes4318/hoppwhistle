'use client';

import { HandCoins, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { dollars, count } from '@/components/delivery/ledger';
import {
  EmptyState,
  Notice,
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
} from '@/components/domain';
import { PageHeader } from '@/components/layout/page-header';
import { localDayKey } from '@/components/leaderboard/period-picker';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from '@/components/ui/use-toast';
import { PeriodToolbar, usePeriod } from '@/components/white-label/period-toolbar';
import type { PayoutsSummary } from '@/components/white-label/types';
import { useAuth } from '@/hooks/use-auth';
import { usePlatformContext } from '@/hooks/use-platform-context';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';
import { formatDayRange, formatDisplayDate } from '@/lib/format-time';
import { cn } from '@/lib/utils';

type PublisherRow = PayoutsSummary['publishers'][number];

/**
 * Payouts: what a white-label agency owes its publishers, and what it has paid.
 *
 * ── Recording a payment moves no money ───────────────────────────────────────
 *
 * The agency pays its publisher however it pays them and records it here. The
 * dialog shows the amount the server will mark paid BEFORE anything is saved:
 * it asks `GET /api/v1/payouts/summary` for exactly the chosen days and reads
 * that publisher's payable figure, then records against the same two instants
 * the server resolved. The browser computes no amount and no date.
 */
export function PayoutsView(): JSX.Element {
  const state = usePeriod('THIS_MONTH');
  const { sendable, query } = state;

  const [data, setData] = useState<PayoutsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [recording, setRecording] = useState<PublisherRow | null>(null);

  const platform = usePlatformContext();
  const withoutAgency = platform.needsAgency;

  const load = useCallback(async () => {
    if (!sendable) return;
    setLoading(true);
    try {
      const response = await apiClient.get<Envelope<PayoutsSummary>>(
        `/api/v1/payouts/summary?${query}`
      );
      if (response.error) {
        setError(response.error.message);
        return;
      }
      setError(null);
      setData(payload(response) ?? null);
    } finally {
      setLoading(false);
    }
  }, [query, sendable]);

  useEffect(() => {
    if (platform.loading || withoutAgency) return;
    void load();
  }, [load, platform.loading, withoutAgency]);

  if (withoutAgency) {
    return (
      <div className="page-canvas">
        <Notice title="Select an agency to see what it owes its publishers." />
      </div>
    );
  }

  return (
    <div className="page-canvas">
      <PageHeader
        description="What you owe each publisher, and what you have paid"
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', loading && 'animate-spin')} />
            Refresh
          </Button>
        }
      />

      <PeriodToolbar state={state} resolved={data?.period ?? null} label="Payouts period" />

      {error ? <Notice tone="error" title={error} /> : null}

      {loading && !data ? (
        <div className="flex items-center justify-center py-16 t-body text-ink-3">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading payouts
        </div>
      ) : !data ? null : (
        <>
          <Panel className="min-w-0">
            <PanelHeader>
              <PanelTitle>Publishers</PanelTitle>
              <PanelDescription>
                Calls created in the period. Held is disputed or on hold; it is not payable until it
                is resolved.
              </PanelDescription>
            </PanelHeader>
            <PanelBody flush className="overflow-x-auto">
              {data.publishers.length === 0 ? (
                <EmptyState
                  headline="You have no publishers yet."
                  body="Add a publisher, send its calls to a campaign, and what you owe it appears here."
                  icon={HandCoins}
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Publisher</TableHead>
                      <TableHead className="text-right">Payable</TableHead>
                      <TableHead className="text-right">Held</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead>Last payment</TableHead>
                      <TableHead className="w-[1%]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.publishers.map(row => (
                      <TableRow key={row.publisherId} data-publisher={row.publisherId}>
                        <TableCell className="font-medium">{row.publisherName}</TableCell>
                        <TableCell className="text-right tabular-nums" data-figure="payable">
                          {dollars(row.payable)}
                          <span className="ml-1 t-meta text-ink-3">
                            {`${count(row.payableCalls)} call${row.payableCalls === 1 ? '' : 's'}`}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {dollars(row.held)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums" data-figure="paid">
                          {dollars(row.paid)}
                        </TableCell>
                        <TableCell className="t-meta text-ink-2">
                          {row.lastPayment
                            ? `${dollars(row.lastPayment.amount)} · ${formatDisplayDate(
                                row.lastPayment.paidAt
                              )}`
                            : '—'}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 whitespace-nowrap text-xs"
                            onClick={() => setRecording(row)}
                          >
                            Record payment
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </PanelBody>
          </Panel>

          <Panel className="min-w-0">
            <PanelHeader>
              <PanelTitle>Payment history</PanelTitle>
              <PanelDescription>The most recent hundred, newest first</PanelDescription>
            </PanelHeader>
            <PanelBody flush className="overflow-x-auto">
              {data.payments.length === 0 ? (
                <EmptyState headline="No payments recorded yet." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Paid</TableHead>
                      <TableHead>Publisher</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Covers</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Reference</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.payments.map(payment => (
                      <TableRow key={payment.id}>
                        <TableCell>{formatDisplayDate(payment.paidAt)}</TableCell>
                        <TableCell className="font-medium">{payment.publisherName}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {dollars(payment.amount)}
                        </TableCell>
                        <TableCell className="t-meta text-ink-2">
                          {`${formatDisplayDate(payment.periodFrom)} – ${formatDisplayDate(
                            payment.periodTo
                          )}`}
                        </TableCell>
                        <TableCell>{payment.method}</TableCell>
                        <TableCell className="t-data">{payment.reference ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </PanelBody>
          </Panel>
        </>
      )}

      {recording ? (
        <RecordPaymentDialog
          publisher={recording}
          onClose={() => setRecording(null)}
          onRecorded={() => {
            setRecording(null);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * "Record payment": the period, how it was paid, and the amount the server
 * will mark paid -- shown before saving, from the server, for exactly those
 * days.
 */
function RecordPaymentDialog({
  publisher,
  onClose,
  onRecorded,
}: {
  publisher: PublisherRow;
  onClose: () => void;
  onRecorded: () => void;
}): JSX.Element {
  const { isReadOnlyPreview } = useAuth();
  const [from, setFrom] = useState(() => localDayKey(30));
  const [to, setTo] = useState(() => localDayKey(0));
  const [method, setMethod] = useState('ACH');
  const [reference, setReference] = useState('');
  const [quote, setQuote] = useState<{
    amount: number;
    calls: number;
    startsAt: string;
    endsAt: string;
  } | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const reversed = Boolean(from && to && from > to);

  useEffect(() => {
    if (!from || !to || reversed) {
      setQuote(null);
      return;
    }
    let cancelled = false;
    setQuoting(true);
    void apiClient
      .get<Envelope<PayoutsSummary>>(
        `/api/v1/payouts/summary?period=CUSTOM&from=${encodeURIComponent(
          from
        )}&to=${encodeURIComponent(to)}`
      )
      .then(response => {
        if (cancelled) return;
        const summary = payload(response);
        const row = summary?.publishers.find(p => p.publisherId === publisher.publisherId);
        if (response.error || !summary || !row) {
          setQuote(null);
          setProblem(response.error?.message ?? 'Could not work out what is payable.');
          return;
        }
        setProblem(null);
        setQuote({
          amount: row.payable,
          calls: row.payableCalls,
          startsAt: summary.period.startsAt,
          endsAt: summary.period.endsAt,
        });
      })
      .finally(() => {
        if (!cancelled) setQuoting(false);
      });
    return () => {
      cancelled = true;
    };
  }, [from, to, reversed, publisher.publisherId]);

  async function save(): Promise<void> {
    if (!quote) return;
    setSaving(true);
    try {
      const response = await apiClient.post<Envelope<{ amount: number }>>('/api/v1/payouts', {
        publisherId: publisher.publisherId,
        periodFrom: quote.startsAt,
        periodTo: quote.endsAt,
        method: method.trim(),
        reference: reference.trim() || undefined,
      });
      const recorded = payload(response);
      if (response.error || !recorded) {
        setProblem(response.error?.message ?? 'The payment was not recorded.');
        return;
      }
      toast.success(
        'Payment recorded',
        `${dollars(recorded.amount)} to ${publisher.publisherName}.`
      );
      onRecorded();
    } finally {
      setSaving(false);
    }
  }

  const nothingPayable = quote !== null && (quote.calls === 0 || quote.amount <= 0);

  return (
    <Dialog open onOpenChange={open => (open ? null : onClose())}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{`Record a payment to ${publisher.publisherName}`}</DialogTitle>
          <DialogDescription>
            Record what you paid. Nothing is sent from here; the calls it covers are marked paid.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="payout-from">Calls from</Label>
            <Input
              id="payout-from"
              type="date"
              value={from}
              max={to}
              onChange={event => setFrom(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="payout-to">Through</Label>
            <Input
              id="payout-to"
              type="date"
              value={to}
              min={from}
              onChange={event => setTo(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="payout-method">Method</Label>
            <Input
              id="payout-method"
              value={method}
              maxLength={40}
              onChange={event => setMethod(event.target.value)}
              placeholder="ACH, check, wire"
            />
          </div>
          <div>
            <Label htmlFor="payout-reference">Reference</Label>
            <Input
              id="payout-reference"
              value={reference}
              maxLength={120}
              onChange={event => setReference(event.target.value)}
              placeholder="Check number, transfer id"
            />
          </div>
        </div>

        <div className="rounded-control bg-sunken p-3" aria-live="polite">
          {reversed ? (
            <p className="t-meta text-dropped-ink">The start date is after the end date.</p>
          ) : quoting || !quote ? (
            <p className="t-meta text-ink-3">Working out what is payable…</p>
          ) : (
            <>
              <p className="t-label text-ink-3">{`Payable for ${formatDayRange(from, to)}`}</p>
              <p className="t-data text-lg font-semibold text-ink" data-figure="quote">
                {dollars(quote.amount)}
              </p>
              <p className="t-meta text-ink-3">
                {`${count(quote.calls)} payable, undisputed call${quote.calls === 1 ? '' : 's'}`}
              </p>
            </>
          )}
        </div>

        {problem ? <p className="t-meta text-dropped-ink">{problem}</p> : null}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            disabled={
              saving || quoting || !quote || nothingPayable || !method.trim() || isReadOnlyPreview
            }
            title={isReadOnlyPreview ? 'A role preview is read-only' : undefined}
          >
            {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
            {nothingPayable ? 'Nothing payable' : 'Record payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
