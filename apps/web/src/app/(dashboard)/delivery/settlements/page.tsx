'use client';

import { ChevronDown, ChevronRight, Download, Loader2, Printer, Receipt } from 'lucide-react';
import { Fragment, useCallback, useEffect, useState } from 'react';

import { RoleGuard } from '@/components/auth/role-guard';
import { Ledger, SectionRule, count, pct } from '@/components/delivery/ledger';
import { StatusChip } from '@/components/domain/status-chip';
import { CompactPageHeader, CompactPageShell } from '@/components/layout/compact-layout';
import { PlatformSettlementsView } from '@/components/platform/platform-settlements-view';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePlatformContext } from '@/hooks/use-platform-context';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Settlement history: one row per settled Delivery Day.
 *
 * ── Two readings of one page ─────────────────────────────────────────────────
 *
 * An agency reads its own, which is everything below. A platform admin with no
 * agency selected reads EVERY agency's over a date range, filterable to one,
 * with the export widened to match — because NetEnroll staff reconcile the
 * platform, not one account at a time. Selecting an agency narrows this page to
 * that agency; leaving returns to the platform-wide view.
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
function statusTone(status: string): 'live' | 'ringing' | 'dropped' | 'neutral' {
  if (status === 'SUCCEEDED') return 'live';
  if (status === 'NOT_CHARGED' || status === 'DRY_RUN') return 'neutral';
  if (status === 'PENDING') return 'ringing';
  return 'dropped';
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

/**
 * Which reading of this page to render.
 *
 * A component boundary rather than an early return: the agency panel calls
 * hooks, and returning before them would be a conditional hook. It also means
 * the agency panel never mounts for an operator with no agency, so it never
 * fires the agency-scoped request that would be refused 409.
 */
function SettlementsPage(): JSX.Element {
  const platform = usePlatformContext();

  if (platform.loading) {
    return (
      <CompactPageShell>
        <div className="flex flex-1 items-center justify-center t-body text-ink-3">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading settlements
        </div>
      </CompactPageShell>
    );
  }

  return platform.needsAgency ? <PlatformSettlementsView /> : <AgencySettlementsPanel />;
}

/** One agency's own settlement history: the acting tenant's, and nobody else's. */
function AgencySettlementsPanel(): JSX.Element {
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
    const response = await apiClient.get<Envelope<SettlementRow[]>>('/api/v1/delivery/settlements');
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
      link.setAttribute('download', `settlements-${from || 'start'}-to-${to || 'today'}.csv`);
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
        <div className="flex flex-1 items-center justify-center t-body text-ink-3">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading settlements
        </div>
      </CompactPageShell>
    );
  }

  return (
    <CompactPageShell fullHeight={false} data-print="page">
      <CompactPageHeader
        title="Settlements"
        subtitle="One row per settled Delivery Day, exactly as it was recorded"
        icon={Receipt}
      >
        <div className="flex flex-wrap items-end gap-2" data-print="hide">
          <label className="t-meta text-ink-3">
            From
            <Input
              type="date"
              value={from}
              onChange={event => setFrom(event.target.value)}
              className="mt-1 h-8 w-36"
            />
          </label>
          <label className="t-meta text-ink-3">
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            title="Prints the ledger with the open row's derivation, without the navigation"
          >
            <Printer className="mr-2 h-3 w-3" />
            Print
          </Button>
        </div>
      </CompactPageHeader>

      {error && <p className="t-body text-dropped-ink">{error}</p>}

      {rows.length === 0 ? (
        <p className="t-body text-ink-3">
          No settlements yet. One is written after the close of each Delivery Day.
        </p>
      ) : (
        <div className="overflow-auto rounded-card border border-rule bg-surface">
          <Ledger>
            <thead>
              <tr>
                <th scope="col" className="w-8" data-print="hide" />
                <th scope="col">Delivery day</th>
                <th scope="col" className="num">
                  Calls
                </th>
                <th scope="col" className="num">
                  Apps
                </th>
                <th
                  scope="col"
                  className="num"
                  title="The trailing-window closing percentage that set this day's rate"
                >
                  Window
                </th>
                <th scope="col" className="num">
                  Rate
                </th>
                <th scope="col" className="num">
                  Overrun
                </th>
                <th scope="col" className="num">
                  Overrun $
                </th>
                <th scope="col" className="num">
                  Next block
                </th>
                <th scope="col" className="num">
                  Block $
                </th>
                <th scope="col" className="num">
                  Total
                </th>
                <th
                  scope="col"
                  className="num"
                  title="The maximum daily debit on the Insertion Order at the time"
                >
                  Max debit
                </th>
                <th scope="col">Outcome</th>
                <th scope="col">Payment</th>
                <th scope="col">Curve</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => {
                const open = openRow === row.id;
                const mode = settlementMode(row.paymentStatus);
                return (
                  <Fragment key={row.id}>
                    <tr
                      className={cn('cursor-pointer hover:bg-sunken', open && 'bg-sunken')}
                      onClick={() => void toggleRow(row.id)}
                    >
                      <td data-print="hide">
                        <button
                          type="button"
                          aria-expanded={open}
                          aria-label={`How the rate on ${row.deliveryDay} was derived`}
                          className="flex h-6 w-6 items-center justify-center rounded-control text-ink-3 hover:bg-rule hover:text-ink"
                          onClick={event => {
                            event.stopPropagation();
                            void toggleRow(row.id);
                          }}
                        >
                          {open ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </button>
                      </td>
                      <td className="t-data whitespace-nowrap font-medium text-ink">
                        {row.deliveryDay}
                      </td>
                      <td className="num">{count(row.deliveredCalls)}</td>
                      <td className="num">{count(row.submittedApplications)}</td>
                      <td className="num">{pct(row.windowClosingPct)}</td>
                      <td className="num">{money(row.rate)}</td>
                      <td className="num">{count(row.overrunQuantity)}</td>
                      <td className="num">{money(row.overrunAmount)}</td>
                      <td className="num">
                        {count(row.nextBlockQuantity)}
                        {row.unusedPaidApplications > 0 && (
                          <span
                            className="ml-1 text-ink-3"
                            title={`Reduced by ${row.unusedPaidApplications} unused paid applications from a configured block of ${row.configuredBlockQuantity}`}
                          >
                            ({row.configuredBlockQuantity}−{row.unusedPaidApplications})
                          </span>
                        )}
                      </td>
                      <td className="num">{money(row.nextBlockAmount)}</td>
                      {/* The one figure per row: what was charged. */}
                      <td className="num font-medium">{money(row.totalCharged)}</td>
                      <td className="num !text-ink-3">{money(row.maxDailyDebit)}</td>
                      {/*
                        The shorter question, answered first: were we charged
                        for this day. The payment status beside it is the same
                        fact in the vocabulary of a payment attempt.
                      */}
                      <td
                        className="whitespace-nowrap t-body font-medium text-ink"
                        title={mode.detail}
                      >
                        {mode.label}
                      </td>
                      <td className="whitespace-nowrap">
                        <StatusChip
                          value={row.paymentStatus}
                          label={row.paymentStatus.replace(/_/g, ' ').toLowerCase()}
                          tone={statusTone(row.paymentStatus)}
                          size="sm"
                        />
                        {row.gracePeriodEndsOn && row.paymentStatus !== 'SUCCEEDED' && (
                          <span className="ml-1.5 t-meta text-ink-3">
                            grace ends {row.gracePeriodEndsOn}
                          </span>
                        )}
                      </td>
                      <td className="t-data whitespace-nowrap text-ink-3">
                        {row.curveVersion === null ? (
                          <span title="The window closed below the curve minimum, so no rate was derived from the curve. The overrun was billed at the rate in force on the Delivery Day.">
                            —
                          </span>
                        ) : (
                          `v${row.curveVersion}`
                        )}
                        {row.windowDaysFound < row.windowDeliveryDays && (
                          <span
                            className="ml-1"
                            title={`Only ${row.windowDaysFound} of ${row.windowDeliveryDays} Delivery Days were found for the window`}
                          >
                            ({row.windowDaysFound}/{row.windowDeliveryDays})
                          </span>
                        )}
                      </td>
                    </tr>

                    {open && (
                      <tr className="bg-paper">
                        <td colSpan={15} className="!h-auto px-4 py-4">
                          {derivationLoading === row.id ? (
                            <p className="flex items-center t-body text-ink-3">
                              <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                              Working out how this rate was reached
                            </p>
                          ) : derivations[row.id] ? (
                            <Derivation settlement={row} derivation={derivations[row.id]} />
                          ) : (
                            <p className="t-body text-ink-3">
                              This breakdown could not be loaded. Please try again.
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </Ledger>
        </div>
      )}
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

  const line = (label: React.ReactNode, value: React.ReactNode, strong = false) => (
    <div
      className={cn(
        'flex items-baseline justify-between gap-4 py-1',
        strong && 'border-t border-rule pt-2 font-medium'
      )}
    >
      <dt className={strong ? 'text-ink' : 'text-ink-2'}>{label}</dt>
      <dd className="t-data text-ink">{value}</dd>
    </div>
  );

  return (
    <div className="grid max-w-5xl grid-cols-1 gap-x-8 gap-y-4 t-body lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="lg:col-span-2">
        <p className="t-section text-ink">
          How the {money(stored.rate)} rate on {settlement.deliveryDay} was reached
        </p>
        <p className="mt-1 text-ink-2">
          The rate comes from the trailing window of {stored.windowDeliveryDays} Delivery Days, not
          from {settlement.deliveryDay} alone. These are the days it covered.
        </p>
      </div>

      <div>
        <Ledger className="[&_thead_th]:static [&_thead_th]:bg-transparent">
          <thead>
            <tr>
              <th scope="col">Delivery day</th>
              <th scope="col" className="num">
                Calls answered
              </th>
              <th scope="col" className="num">
                Apps
              </th>
              <th scope="col" className="num">
                Closing
              </th>
            </tr>
          </thead>
          <tbody>
            {days.map(day => (
              <tr key={day.deliveryDay}>
                <td className="t-data text-ink">{day.deliveryDay}</td>
                <td className="num">{count(day.deliveredCalls)}</td>
                <td className="num">{count(day.submittedApplications)}</td>
                <td className="num !text-ink-3">{pct(day.closingPct)}</td>
              </tr>
            ))}
            <tr className="font-medium [&_td]:!border-t [&_td]:!border-rule-strong">
              <td className="text-ink">Window total</td>
              <td className="num">{count(recomputed.deliveredCalls)}</td>
              <td className="num">{count(recomputed.submittedApplications)}</td>
              <td className="num">{pct(recomputed.closingPct)}</td>
            </tr>
          </tbody>
        </Ledger>
      </div>

      <div className="space-y-4">
        <div>
          <SectionRule className="border-t-0 pt-0">Recorded on this settlement</SectionRule>
          <dl className="mt-1">
            {line('Window closing percentage', pct(stored.windowClosingPct))}
            {line(
              'Delivery days found',
              `${stored.windowDaysFound} of ${stored.windowDeliveryDays}`
            )}
            {line('Curve version', stored.curveVersion === null ? '—' : `v${stored.curveVersion}`)}
            {line('Rate charged', money(stored.rate), true)}
          </dl>
        </div>

        <div>
          <SectionRule>Worked through again from the same days</SectionRule>
          {!derivation.curveFound ? (
            <p className="mt-2 text-ink-2">
              The curve version this settlement was priced with is no longer on file, so the rate
              cannot be worked through again here. The figures recorded above are what was charged.
            </p>
          ) : recomputed.belowMinimum ? (
            <p className="mt-2 text-ink-2">
              The window closed at {pct(recomputed.closingPct)}, below the curve minimum of{' '}
              {pct(recomputed.minimumClosingPct)}. Below that there is no rate on the curve, and the
              overrun is billed at the rate that was already in force.
            </p>
          ) : (
            <>
              <dl className="mt-1">
                {line('Window closing percentage', pct(recomputed.closingPct))}
                {recomputed.anchors &&
                  line(
                    recomputed.anchors.left.closingPct === recomputed.anchors.right.closingPct
                      ? 'Curve point'
                      : 'Between curve points',
                    recomputed.anchors.left.closingPct === recomputed.anchors.right.closingPct
                      ? `${recomputed.anchors.left.closingPct}% → ${money(recomputed.anchors.left.rate)}`
                      : `${recomputed.anchors.left.closingPct}% → ${money(recomputed.anchors.left.rate)} and ${recomputed.anchors.right.closingPct}% → ${money(recomputed.anchors.right.rate)}`
                  )}
                {line('Rate this gives', money(recomputed.rate), true)}
              </dl>

              {derivation.matchesStoredRate ? (
                <p className="mt-2 t-meta text-ink-3">
                  This matches the rate recorded on the settlement.
                </p>
              ) : (
                <p className="mt-2 t-meta text-ringing-ink">
                  This does not match the {money(stored.rate)} recorded on the settlement. The
                  recorded figures are what was charged and they do not change; a difference here
                  means the underlying calls or applications for those days have moved since. Please
                  contact NetEnroll and we will go through it with you.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {recomputed.flatFromClosingPct !== null && (
        <p className="t-meta text-ink-3 lg:col-span-2">
          On this curve the rate is flat at and above {pct(recomputed.flatFromClosingPct)}, and
          there is no rate below {pct(recomputed.minimumClosingPct)}.
        </p>
      )}
    </div>
  );
}

/**
 * ADMIN and OWNER only.
 *
 * Every settled Delivery Day and what each one cost. Money, and therefore the
 * principal's: `/api/v1/delivery/settlements*` refuses an AGENT (see
 * `requireAgencyPrincipal`), and this guard is so an agent who reaches the URL is
 * sent somewhere useful instead of watching a page fill with 403s.
 *
 * A platform operator inside an agency carries both roles and is unaffected --
 * except while previewing as AGENT, where being turned away is the point.
 */
export default function GuardedSettlementsPage(): JSX.Element {
  return (
    <RoleGuard allowedRoles={['ADMIN', 'OWNER']}>
      <SettlementsPage />
    </RoleGuard>
  );
}
