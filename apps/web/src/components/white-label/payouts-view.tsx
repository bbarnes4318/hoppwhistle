'use client';

import { HandCoins, Loader2, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { Fragment, useCallback, useEffect, useState } from 'react';

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
import type { PayoutsSummary, PublisherPaymentView } from '@/components/white-label/types';
import { useAuth } from '@/hooks/use-auth';
import { usePlatformContext } from '@/hooks/use-platform-context';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';
import { formatDayRange, formatDisplayDate } from '@/lib/format-time';
import { cn } from '@/lib/utils';

type PublisherRow = PayoutsSummary['publishers'][number];

/**
 * What the agency pays next, as one cell: the dollars, or "Owes you $X" in the
 * warning tone when the publisher's returns are more than it is owed.
 */
export function NetToPay({ net }: { net: number }): JSX.Element {
  if (net < 0) {
    return (
      <span className="text-ringing-ink" data-owes="true">
        {`Owes you ${dollars(Math.abs(net))}`}
      </span>
    );
  }
  return <>{dollars(net)}</>;
}

/** The server's refusal when returns are at least the payable, word for word. */
export function carryForwardMessage(payable: number, returns: number): string {
  return `Nothing to pay: ${dollars(returns)} in returns is more than the ${dollars(
    payable
  )} payable. It carries to the next payment.`;
}

/** First eight characters of a call id: enough to find it, short enough for a cell. */
function shortCall(callId: string): string {
  return callId.slice(0, 8);
}

/**
 * Payment history in the order it is read: each payment, then the returns
 * deducted from it beneath it. A return still waiting, or one whose payment is
 * outside the hundred shown, stands in its own place.
 */
export function historyRows(
  payments: PublisherPaymentView[]
): Array<{ payment: PublisherPaymentView; nested: boolean }> {
  const shown = new Set(payments.filter(p => p.kind !== 'CLAWBACK').map(p => p.id));
  const under = new Map<string, PublisherPaymentView[]>();
  for (const payment of payments) {
    if (
      payment.kind === 'CLAWBACK' &&
      payment.appliedToPaymentId &&
      shown.has(payment.appliedToPaymentId)
    ) {
      const list = under.get(payment.appliedToPaymentId) ?? [];
      list.push(payment);
      under.set(payment.appliedToPaymentId, list);
    }
  }
  const rows: Array<{ payment: PublisherPaymentView; nested: boolean }> = [];
  for (const payment of payments) {
    const isNested =
      payment.kind === 'CLAWBACK' &&
      payment.appliedToPaymentId !== null &&
      shown.has(payment.appliedToPaymentId);
    if (isNested) continue;
    rows.push({ payment, nested: false });
    for (const clawback of under.get(payment.id) ?? [])
      rows.push({ payment: clawback, nested: true });
  }
  return rows;
}

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
 *
 * ── Returns after the publisher was paid ─────────────────────────────────────
 *
 * An accepted return on a call the publisher was already paid for comes out of
 * their next payment. "Returns to deduct" is what is waiting; "Net to pay" is
 * what the next payment will be, and reads "Owes you" when the returns are more.
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
                is resolved. Returns to deduct come out of the next payment, whatever its period.
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
                      <TableHead className="text-right">Returns to deduct</TableHead>
                      <TableHead className="text-right">Net to pay</TableHead>
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
                        <TableCell className="text-right tabular-nums" data-figure="returns">
                          {row.returnsPending > 0 ? `−${dollars(row.returnsPending)}` : '—'}
                        </TableCell>
                        <TableCell
                          className="text-right font-medium tabular-nums"
                          data-figure="net"
                        >
                          <NetToPay net={row.netPayable} />
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
                    {historyRows(data.payments).map(({ payment, nested }) => (
                      <Fragment key={payment.id}>
                        {payment.kind === 'CLAWBACK' ? (
                          <ClawbackHistoryRow payment={payment} nested={nested} />
                        ) : (
                          <TableRow data-payment={payment.id}>
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
                        )}
                      </Fragment>
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
 * A return deducted from a publisher's payment, under the payment it came out
 * of -- or, while it waits for the next one, on its own.
 */
function ClawbackHistoryRow({
  payment,
  nested,
}: {
  payment: PublisherPaymentView;
  nested: boolean;
}): JSX.Element {
  const waiting = payment.appliedToPaymentId === null;
  const callLink = payment.callId ? (
    <Link
      href={`/calls?call=${encodeURIComponent(payment.callId)}`}
      className="text-ink underline-offset-2 hover:underline"
    >
      {`call ${shortCall(payment.callId)}`}
    </Link>
  ) : null;
  return (
    <TableRow
      data-clawback={payment.id}
      data-applied-to={payment.appliedToPaymentId ?? ''}
      className={cn(nested && 'bg-sunken/50')}
    >
      <TableCell className={cn('t-meta text-ink-3', nested && 'pl-8')}>
        {formatDisplayDate(payment.paidAt)}
      </TableCell>
      <TableCell className="t-meta text-ink-2">{payment.publisherName}</TableCell>
      <TableCell className="text-right tabular-nums text-dropped-ink">
        {`−${dollars(Math.abs(payment.amount))}`}
      </TableCell>
      <TableCell className="t-meta text-ink-2" colSpan={3}>
        {waiting ? (
          <span className="text-ringing-ink">
            Waiting for next payment{callLink ? <> · Return on {callLink}</> : null}
          </span>
        ) : (
          <>Return deducted{callLink ? <>, {callLink}</> : null}</>
        )}
      </TableCell>
    </TableRow>
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
    /** Returns waiting to be deducted, positive, and what is left to pay. */
    returns: number;
    net: number;
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
          returns: row.returnsPending ?? 0,
          net: row.netPayable ?? row.payable,
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
      const response = await apiClient.post<Envelope<{ amount: number; clawbacks?: unknown[] }>>(
        '/api/v1/payouts',
        {
          publisherId: publisher.publisherId,
          periodFrom: quote.startsAt,
          periodTo: quote.endsAt,
          method: method.trim(),
          reference: reference.trim() || undefined,
        }
      );
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
  // Payable, but the returns waiting are at least as much: nothing to pay.
  const returnsExceed = quote !== null && !nothingPayable && quote.net <= 0;

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
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
                <dt className="t-label text-ink-3">{`Payable for ${formatDayRange(from, to)}`}</dt>
                <dd className="t-data text-right text-ink" data-figure="quote">
                  {dollars(quote.amount)}
                </dd>
                <dt className="t-label text-ink-3">Less returns</dt>
                <dd className="t-data text-right text-ink" data-figure="less-returns">
                  {quote.returns > 0 ? `−${dollars(quote.returns)}` : dollars(0)}
                </dd>
                <dt className="t-label text-ink">Net to pay</dt>
                <dd
                  className="t-data text-right text-lg font-semibold text-ink"
                  data-figure="net-to-pay"
                >
                  <NetToPay net={quote.net} />
                </dd>
              </dl>
              <p className="mt-1 t-meta text-ink-3">
                {`${count(quote.calls)} payable, undisputed call${quote.calls === 1 ? '' : 's'}`}
              </p>
              {returnsExceed ? (
                <p className="mt-2 t-meta text-ringing-ink" data-carry-forward="true">
                  {carryForwardMessage(quote.amount, quote.returns)}
                </p>
              ) : null}
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
              saving ||
              quoting ||
              !quote ||
              nothingPayable ||
              returnsExceed ||
              !method.trim() ||
              isReadOnlyPreview
            }
            title={isReadOnlyPreview ? 'A role preview is read-only' : undefined}
          >
            {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
            {nothingPayable || returnsExceed ? 'Nothing to pay' : 'Record payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
