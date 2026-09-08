'use client';

import { ChevronDown, ChevronRight, Download, Loader2, Receipt } from 'lucide-react';
import { Fragment, useCallback, useEffect, useState } from 'react';

import { CompactPageHeader, CompactPageShell } from '@/components/layout/compact-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';

/**
 * Settlement history: one row per settled Delivery Day.
 *
 * This is the screen an agency disputing a charge is shown, so every figure the
 * settlement record carries is on it -- the counts, the window and the days it
 * covered, the rate and the curve version that produced it, the overrun
 * quantity and amount, the next block quantity and amount, the total charged,
 * and the maximum daily debit that was in force. Nothing is summarised away and
 * nothing is recomputed in the browser: each row is the stored record.
 *
 * The CSV carries the same columns, for a finance team that reconciles in a
 * spreadsheet rather than on a screen.
 *
 * ── A row expands to how its rate was derived ────────────────────────────────
 *
 * The stored figures say WHAT was charged. On their own they do not answer the
 * question an agency actually asks, which is why the rate was what it was. So a
 * row opens onto the Delivery Days the trailing window covered, each day's call
 * and application counts, the totals they sum to, the percentage that gives,
 * and the two curve anchors it was interpolated between.
 *
 * That breakdown is computed by the server, against the curve version the
 * settlement itself names -- never against whichever curve is active today, and
 * never in this browser. This page renders what it is handed and does no
 * arithmetic on money or rates.
 */

interface SettlementRow {
  id: string;
  deliveryDay: string;
  deliveredCalls: number;
  submittedApplications: number;
  windowClosingPct: number | null;
  windowDeliveryDays: number;
  windowDaysFound: number;
  windowDayKeys: string[];
  rate: number | null;
  curveVersion: number | null;
  overrunQuantity: number;
  overrunAmount: number;
  configuredBlockQuantity: number;
  unusedPaidApplications: number;
  nextBlockQuantity: number;
  nextBlockAmount: number;
  totalCharged: number;
  maxDailyDebit: number;
  paymentStatus: string;
  paidAt: string | null;
  gracePeriodEndsOn: string | null;
  computedAt: string;
}

/** How the rate on one Delivery Day was arrived at. Computed by the server. */
interface Derivation {
  stored: {
    windowClosingPct: number | null;
    windowDayKeys: string[];
    windowDeliveryDays: number;
    windowDaysFound: number;
    rate: number | null;
    curveVersion: number | null;
  };
  window: Array<{
    deliveryDay: string;
    deliveredCalls: number;
    submittedApplications: number;
    closingPct: number | null;
  }>;
  recomputed: {
    deliveredCalls: number;
    submittedApplications: number;
    closingPct: number | null;
    rate: number | null;
    belowMinimum: boolean;
    anchors: {
      left: { closingPct: number; rate: number };
      right: { closingPct: number; rate: number };
    } | null;
    minimumClosingPct: number | null;
    flatFromClosingPct: number | null;
  };
  matchesStoredRate: boolean;
  curveFound: boolean;
}

function pct(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)}%`;
}

/**
 * Dollars, to a fixed number of places.
 *
 * `maximumFractionDigits` is set explicitly. Without it `toLocaleString`
 * defaults the maximum to three, so a stored 2,948.005 rendered as $2,948.005
 * on the one screen whose purpose is to match a bank statement to the cent.
 */
function money(value: number | null, digits = 2): string {
  return value === null
    ? '—'
    : `$${value.toLocaleString(undefined, {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })}`;
}

/**
 * How a payment status should read.
 *
 * DRY_RUN is deliberately NOT destructive. A dry run is a settlement that
 * computed correctly and took no money on purpose, and it was falling through
 * to the default here -- so every day of a deliberate pre-go-live watch period
 * rendered in the same red as a declined debit, on the screen an agency checks
 * their charges on.
 *
 * A halt is not a decline either: the run worked and withheld the debit because
 * the total breached the maximum daily debit or the mandate was gone. It needs
 * attention, so it is not quiet, but it is not a failure of payment.
 */
function statusVariant(status: string): 'secondary' | 'destructive' | 'outline' {
  if (status === 'SUCCEEDED' || status === 'NOT_CHARGED') return 'secondary';
  if (status === 'PENDING' || status === 'DRY_RUN') return 'outline';
  return 'destructive';
}

/**
 * What happened to the money on this day, in one word.
 *
 * The payment status carries this, but in the vocabulary of a payment attempt.
 * An agency reading their own history wants the shorter question answered
 * first: were we charged for this day, or not.
 */
function settlementMode(status: string): { label: string; detail: string } {
  switch (status) {
    case 'DRY_RUN':
      return {
        label: 'not charged',
        detail:
          'This day was settled in full and recorded, deliberately without taking a payment. It is what a Delivery Day looks like while charging is switched off.',
      };
    case 'NOT_CHARGED':
      return { label: 'nothing due', detail: 'Nothing was owed for this Delivery Day.' };
    case 'HALTED_MAX_DEBIT':
      return {
        label: 'halted',
        detail:
          'The total came out above the maximum daily debit on your Insertion Order, so no payment was taken and NetEnroll was alerted.',
      };
    case 'HALTED_NO_MANDATE':
      return {
        label: 'halted',
        detail: 'There was no usable bank mandate, so no payment was taken.',
      };
    case 'FAILED':
      return { label: 'declined', detail: 'The debit was placed and the bank declined it.' };
    case 'PENDING':
      return {
        label: 'in flight',
        detail: 'The debit has been placed. ACH takes a few business days to settle.',
      };
    default:
      return { label: 'charged', detail: 'The debit was placed and accepted.' };
  }
}

export default function SettlementsPage(): JSX.Element {
  const [rows, setRows] = useState<SettlementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  /** Which row is open, and what the server said about it. */
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [derivations, setDerivations] = useState<Record<string, Derivation>>({});
  const [derivationLoading, setDerivationLoading] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response =
      await apiClient.get<Envelope<SettlementRow[]>>('/api/v1/delivery/settlements');
    setError(response.error ? response.error.message : null);
    const settlements = payload(response);
    setRows(Array.isArray(settlements) ? settlements : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Open a row onto how its rate was derived.
   *
   * Fetched on demand rather than with the table: the breakdown re-measures the
   * Delivery Days in the window, and doing that for ninety rows nobody opened
   * would be ninety windows measured to show one. Cached once fetched, because
   * a settled day does not change.
   */
  async function toggleRow(settlementId: string): Promise<void> {
    if (openRow === settlementId) {
      setOpenRow(null);
      return;
    }
    setOpenRow(settlementId);
    if (derivations[settlementId]) return;

    setDerivationLoading(settlementId);
    try {
      const response = await apiClient.get<Envelope<Derivation>>(
        `/api/v1/delivery/settlements/${settlementId}/derivation`
      );
      const derivation = payload(response);
      if (derivation) {
        setDerivations(current => ({ ...current, [settlementId]: derivation }));
      }
    } finally {
      setDerivationLoading(null);
    }
  }

  async function download(): Promise<void> {
    setExporting(true);
    try {
      // The range is sent to the server, which selects the rows. Filtering a
      // fetched page in the browser would export whatever the table happened to
      // have loaded rather than the range that was asked for.
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const query = params.toString();

      const response = await apiClient.get<string>(
        `/api/v1/delivery/settlements.csv${query ? `?${query}` : ''}`,
        { responseType: 'text' }
      );
      if (!response.data) {
        setError(response.error ? response.error.message : 'The export returned nothing.');
        return;
      }
      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute(
        'download',
        `settlements-${from || 'start'}-to-${to || 'today'}.csv`
      );
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  if (loading) {
    return (
      <CompactPageShell>
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading settlements
        </div>
      </CompactPageShell>
    );
  }

  return (
    <CompactPageShell fullHeight={false}>
      <CompactPageHeader
        title="Settlements"
        subtitle="One row per settled Delivery Day, exactly as it was recorded"
        icon={Receipt}
      >
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-muted-foreground">
            From
            <Input
              type="date"
              value={from}
              onChange={event => setFrom(event.target.value)}
              className="mt-1 h-8 w-36"
            />
          </label>
          <label className="text-xs text-muted-foreground">
            To
            <Input
              type="date"
              value={to}
              onChange={event => setTo(event.target.value)}
              className="mt-1 h-8 w-36"
            />
          </label>
          <Button variant="outline" size="sm" onClick={() => void download()} disabled={exporting}>
            {exporting ? (
              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
            ) : (
              <Download className="mr-2 h-3 w-3" />
            )}
            CSV
          </Button>
        </div>
      </CompactPageHeader>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Card>
        <CardContent className="pt-4">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No settlements yet. One is written after the close of each Delivery Day.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8" />
                    <TableHead>Delivery day</TableHead>
                    <TableHead className="text-right">Calls</TableHead>
                    <TableHead className="text-right">Applications</TableHead>
                    <TableHead className="text-right">Window closing</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Overrun</TableHead>
                    <TableHead className="text-right">Overrun $</TableHead>
                    <TableHead className="text-right">Next block</TableHead>
                    <TableHead className="text-right">Block $</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Max debit</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Window days</TableHead>
                    <TableHead>Curve</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(row => (
                    <Fragment key={row.id}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => void toggleRow(row.id)}
                    >
                      <TableCell className="align-middle">
                        <button
                          type="button"
                          aria-expanded={openRow === row.id}
                          aria-label={`How the rate on ${row.deliveryDay} was derived`}
                          className="text-muted-foreground"
                          onClick={event => {
                            event.stopPropagation();
                            void toggleRow(row.id);
                          }}
                        >
                          {openRow === row.id ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                      </TableCell>
                      <TableCell className="font-medium tabular-nums">{row.deliveryDay}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.deliveredCalls}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.submittedApplications}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {pct(row.windowClosingPct)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(row.rate)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.overrunQuantity}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(row.overrunAmount)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.nextBlockQuantity}
                        {row.unusedPaidApplications > 0 && (
                          <span
                            className="ml-1 text-[11px] text-muted-foreground"
                            title={`Reduced by ${row.unusedPaidApplications} unused paid applications from a configured block of ${row.configuredBlockQuantity}`}
                          >
                            ({row.configuredBlockQuantity}−{row.unusedPaidApplications})
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {money(row.nextBlockAmount)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {money(row.totalCharged)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {money(row.maxDailyDebit)}
                      </TableCell>
                      {/*
                        The shorter question, answered first: were we charged
                        for this day. The payment status beside it is the same
                        fact in the vocabulary of a payment attempt.
                      */}
                      <TableCell>
                        <span
                          className="text-xs font-medium"
                          title={settlementMode(row.paymentStatus).detail}
                        >
                          {settlementMode(row.paymentStatus).label}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(row.paymentStatus)}>
                          {row.paymentStatus.replace(/_/g, ' ').toLowerCase()}
                        </Badge>
                        {row.gracePeriodEndsOn && row.paymentStatus !== 'SUCCEEDED' && (
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            grace ends {row.gracePeriodEndsOn}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="text-[11px] text-muted-foreground">
                        {row.windowDayKeys.join(', ') || '—'}
                        {row.windowDaysFound < row.windowDeliveryDays
                          ? ` (${row.windowDaysFound}/${row.windowDeliveryDays})`
                          : ''}
                      </TableCell>
                      <TableCell className="text-[11px] text-muted-foreground">
                        {row.curveVersion === null ? (
                          <span title="The window closed below the curve minimum, so no rate was derived from the curve. The overrun was billed at the rate in force on the Delivery Day.">
                            —
                          </span>
                        ) : (
                          `v${row.curveVersion}`
                        )}
                      </TableCell>
                    </TableRow>

                    {openRow === row.id && (
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={16} className="p-4">
                          {derivationLoading === row.id ? (
                            <p className="flex items-center text-sm text-muted-foreground">
                              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                              Working out how this rate was reached
                            </p>
                          ) : derivations[row.id] ? (
                            <Derivation
                              settlement={row}
                              derivation={derivations[row.id]}
                            />
                          ) : (
                            <p className="text-sm text-muted-foreground">
                              This breakdown could not be loaded. Please try again.
                            </p>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </CompactPageShell>
  );
}

/**
 * How one Delivery Day's rate was reached.
 *
 * ── What makes this answer a dispute rather than restate it ──────────────────
 *
 * A panel that reprints the stored rate proves nothing. This shows both halves:
 * the Delivery Days the trailing window covered with each day's counts, and the
 * rate the curve version the settlement NAMES returns for the percentage those
 * counts give. An agency can add the column up themselves and land where the
 * charge did.
 *
 * Every figure here is computed by the server. Nothing on this page multiplies,
 * interpolates or rounds a rate.
 *
 * ── When the recomputation disagrees ─────────────────────────────────────────
 *
 * It is said so, plainly, rather than hidden. A call deleted or an application
 * submitted late changes what a re-measurement finds today, and the stored
 * figures remain what was charged and are immutable. A disagreement is exactly
 * what somebody checking a charge needs to see; suppressing it would turn this
 * panel back into a restatement.
 */
function Derivation({
  settlement,
  derivation,
}: {
  settlement: SettlementRow;
  derivation: Derivation;
}): JSX.Element {
  const { stored, window: days, recomputed } = derivation;

  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="font-medium">
          How the {money(stored.rate)} rate on {settlement.deliveryDay} was reached
        </p>
        <p className="mt-1 text-muted-foreground">
          The rate comes from the trailing window of {stored.windowDeliveryDays} Delivery
          Days, not from {settlement.deliveryDay} alone. These are the days it covered.
        </p>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Delivery day</TableHead>
              <TableHead className="text-right">Calls answered</TableHead>
              <TableHead className="text-right">Applications</TableHead>
              <TableHead className="text-right">Closing</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {days.map(day => (
              <TableRow key={day.deliveryDay}>
                <TableCell className="tabular-nums">{day.deliveryDay}</TableCell>
                <TableCell className="text-right tabular-nums">{day.deliveredCalls}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {day.submittedApplications}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {pct(day.closingPct)}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="border-t-2 font-medium">
              <TableCell>Window total</TableCell>
              <TableCell className="text-right tabular-nums">
                {recomputed.deliveredCalls}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {recomputed.submittedApplications}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {pct(recomputed.closingPct)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded border p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Recorded on this settlement
          </p>
          <dl className="mt-2 space-y-1">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Window closing percentage</dt>
              <dd className="tabular-nums">{pct(stored.windowClosingPct)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Delivery days found</dt>
              <dd className="tabular-nums">
                {stored.windowDaysFound} of {stored.windowDeliveryDays}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Curve version</dt>
              <dd className="tabular-nums">
                {stored.curveVersion === null ? '—' : `v${stored.curveVersion}`}
              </dd>
            </div>
            <div className="flex justify-between gap-4 font-medium">
              <dt>Rate charged</dt>
              <dd className="tabular-nums">{money(stored.rate)}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded border p-3">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Worked through again from the same days
          </p>

          {!derivation.curveFound ? (
            <p className="mt-2 text-muted-foreground">
              The curve version this settlement was priced with is no longer on file, so the
              rate cannot be worked through again here. The figures recorded on the left are
              what was charged.
            </p>
          ) : recomputed.belowMinimum ? (
            <p className="mt-2 text-muted-foreground">
              The window closed at {pct(recomputed.closingPct)}, below the curve minimum of{' '}
              {pct(recomputed.minimumClosingPct)}. Below that there is no rate on the curve,
              and the overrun is billed at the rate that was already in force.
            </p>
          ) : (
            <>
              <dl className="mt-2 space-y-1">
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Window closing percentage</dt>
                  <dd className="tabular-nums">{pct(recomputed.closingPct)}</dd>
                </div>
                {recomputed.anchors && (
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">
                      {recomputed.anchors.left.closingPct === recomputed.anchors.right.closingPct
                        ? 'Curve point'
                        : 'Between curve points'}
                    </dt>
                    <dd className="tabular-nums">
                      {recomputed.anchors.left.closingPct === recomputed.anchors.right.closingPct
                        ? `${recomputed.anchors.left.closingPct}% → ${money(recomputed.anchors.left.rate)}`
                        : `${recomputed.anchors.left.closingPct}% → ${money(recomputed.anchors.left.rate)} and ${recomputed.anchors.right.closingPct}% → ${money(recomputed.anchors.right.rate)}`}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between gap-4 font-medium">
                  <dt>Rate this gives</dt>
                  <dd className="tabular-nums">{money(recomputed.rate)}</dd>
                </div>
              </dl>

              {derivation.matchesStoredRate ? (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  This matches the rate recorded on the settlement.
                </p>
              ) : (
                <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
                  This does not match the {money(stored.rate)} recorded on the settlement. The
                  recorded figures are what was charged and they do not change; a difference
                  here means the underlying calls or applications for those days have moved
                  since. Please contact NetEnroll and we will go through it with you.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {recomputed.flatFromClosingPct !== null && (
        <p className="text-[11px] text-muted-foreground">
          On this curve the rate is flat at and above {pct(recomputed.flatFromClosingPct)}, and
          there is no rate below {pct(recomputed.minimumClosingPct)}.
        </p>
      )}
    </div>
  );
}
