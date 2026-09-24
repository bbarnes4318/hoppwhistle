'use client';

import { Loader2, TrendingUp } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { RoleGuard } from '@/components/auth/role-guard';
import { Notice, Panel, PanelBody, PanelHeader, PanelTitle, StatTile } from '@/components/domain';
import { PlatformRatingView } from '@/components/platform/platform-rating-view';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { usePlatformContext } from '@/hooks/use-platform-context';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * The agency's own rate, and the measurements behind it.
 *
 * ── Two readings of one page ─────────────────────────────────────────────────
 *
 * An agency sees its own rate, which is everything below. A platform admin with
 * no agency selected sees EVERY agency's closing percentage, current rate and
 * tracking rate side by side — because NetEnroll staff run the whole platform,
 * and answering "who is drifting" one agency at a time is not answering it.
 * Selecting an agency narrows this page to that agency; leaving returns to the
 * platform-wide view.
 *
 * An agency OWNER never reaches the platform-wide reading: they hold no
 * platform capability, so `needsAgency` is false for them, and the endpoint
 * behind it refuses them regardless of what this page renders.
 *
 * ── The four numbers, and why they are laid out like this ────────────────────
 *
 * Two of these are closing percentages and they are not the same number:
 *
 *   Today so far        moves all day and prices nothing.
 *   Rating window       the trailing three DELIVERY DAYS that actually set the
 *                       rate now in force. This is what the agency is paid on.
 *
 * A Delivery Day is a calendar day on which this agency was delivered at least
 * one call, so a weekday-only agency's Monday window is the prior Thursday,
 * Friday and Monday. The panel names those days rather than saying "3 days":
 * an agency that cannot reconstruct its own window cannot check its own price.
 *
 * An agency that reads the first as the second thinks its price changed at
 * 10am. So they are separated, labelled with what each does, and the window one
 * names the days it covers.
 *
 * The other two are rates, and also not the same:
 *
 *   Current rate        what is being paid today.
 *   Tracking toward     what tomorrow would be if today closed now.
 *
 * "Tracking toward" is rendered muted and explicitly provisional, because an
 * agency that reads it as the current rate believes it is being paid something
 * it is not.
 *
 * Every figure here comes from the server, computed from counts the server made
 * itself. Nothing on this page sends a rate, a price or an amount anywhere.
 */

interface RatingSummary {
  calendarDay: string;
  timeZone: string;
  // INTRODUCTORY is retired: there is no introductory rate. It survives in the
  // database enum because migrations here are additive, and an agency carrying
  // it has no opening agreement recorded, which means no rate at all.
  status: 'INTRODUCTORY' | 'OPENING_BLOCK' | 'RATED' | 'UNDER_REVIEW';
  today: {
    calendarDay: string;
    deliveredCalls: number;
    submittedApplications: number;
    closingPct: number | null;
  };
  ratingWindow: {
    deliveryDays: number;
    daysFound: number;
    dayKeys: string[];
    deliveredCalls: number;
    submittedApplications: number;
    closingPct: number | null;
  };
  currentRate: number | null;
  /** The curve half of the rate, when the curve set it. */
  curveRate: number | null;
  /** Dollars added to the curve rate. Part of the price, never a fee line. */
  rateOffset: number;
  currentRateCalendarDay: string | null;
  trackingRate: number | null;
  trackingBelowMinimum: boolean;
  trackingDayKeys: string[];
  curveVersion: number;
  reviewFlag: {
    id: string;
    raisedAt: string;
    closingPct: number;
    deliveredCalls: number;
    submittedApplications: number;
  } | null;
  openingBlock: { rate: number; applications: number | null; note: string | null } | null;
}

interface RateChangeRow {
  id: string;
  effectiveCalendarDay: string;
  windowDayKeys: string[];
  windowDeliveryDays: number;
  windowDaysFound: number;
  deliveredCalls: number;
  submittedApplications: number;
  closingPct: number | null;
  curveVersion: number;
  previousRate: number | null;
  /** The effective rate applied: `curveRate + rateOffset`. */
  newRate: number | null;
  curveRate: number | null;
  rateOffset: number;
  status: 'APPLIED' | 'BELOW_MINIMUM' | 'NO_DATA';
}

/** A percentage, or an em dash. Never a fabricated 0. */
function pct(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)}%`;
}

/** Whole dollars, or an em dash. Under review there is no rate, not a $0 one. */
function dollars(value: number | null): string {
  return value === null ? '—' : `$${Math.round(value)}`;
}

/**
 * Which reading of this page to render.
 *
 * A component boundary rather than an early return: the agency panel below
 * calls hooks, and returning before them would be a conditional hook. It also
 * means the agency panel never mounts for an operator with no agency, so it
 * never fires the agency-scoped requests that would be refused 409.
 */
function RatingPage(): JSX.Element {
  const platform = usePlatformContext();

  if (platform.loading) {
    return (
      <div className="page-canvas min-h-full">
        <div className="t-body flex flex-1 items-center justify-center text-ink-3">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading rate
        </div>
      </div>
    );
  }

  return platform.needsAgency ? <PlatformRatingView /> : <AgencyRatingPanel />;
}

/** One agency's own rate: the acting tenant's, and nobody else's. */
function AgencyRatingPanel(): JSX.Element {
  const [summary, setSummary] = useState<RatingSummary | null>(null);
  const [history, setHistory] = useState<RateChangeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [summaryResponse, historyResponse] = await Promise.all([
      apiClient.get<Envelope<RatingSummary>>('/api/v1/rating/summary'),
      apiClient.get<Envelope<RateChangeRow[]>>('/api/v1/rating/history?limit=30'),
    ]);

    if (summaryResponse.error) setError(summaryResponse.error.message);
    else setError(null);

    setSummary(payload(summaryResponse) ?? null);
    const rows = payload(historyResponse);
    setHistory(Array.isArray(rows) ? rows : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="page-canvas min-h-full">
        <div className="t-body flex flex-1 items-center justify-center text-ink-3">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading rate
        </div>
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="page-canvas">
        <p className="t-body text-ink-3">{error ?? 'No rating data yet.'}</p>
      </div>
    );
  }

  /*
   * The days themselves, not a count.
   *
   * "3 days" does not tell an agency whether its weekend was in the window, and
   * an agency that cannot reconstruct its own window cannot check its own
   * price. For a weekday-only agency this reads "Sep 3, Sep 4, Sep 7".
   */
  const windowLabel =
    summary.ratingWindow.dayKeys.length > 0
      ? summary.ratingWindow.dayKeys.join(', ')
      : `${summary.ratingWindow.deliveryDays} delivery days`;

  const windowShort =
    summary.ratingWindow.dayKeys.length > 0 &&
    summary.ratingWindow.daysFound < summary.ratingWindow.deliveryDays;

  return (
    <div className="page-canvas">
      {summary.reviewFlag && (
        <Notice tone="warning" title="Flagged for review">
          The trailing window closed at {pct(summary.reviewFlag.closingPct)} —{' '}
          {summary.reviewFlag.submittedApplications} applications from{' '}
          {summary.reviewFlag.deliveredCalls} delivered calls. There is no rate while this flag is
          open; NetEnroll clears it.
        </Notice>
      )}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        {/* The rate in force. The number the agency is being paid, today. */}
        <StatTile
          label="Current rate"
          figure={dollars(summary.currentRate)}
          sub={
            <>
              {/*
                The rate's status (introductory, opening block, rated, under
                review) rides on the tile it qualifies rather than taking a
                header row of its own above the figures.
              */}
              <span className="block">
                <span
                  data-testid="rating-status"
                  className={cn(
                    'font-medium capitalize',
                    summary.status === 'UNDER_REVIEW' ? 'text-ringing-ink' : 'text-ink-2'
                  )}
                >
                  {summary.status.replace('_', ' ').toLowerCase()}
                </span>
                {' · '}per submitted application
                {summary.currentRateCalendarDay
                  ? ` · effective ${summary.currentRateCalendarDay}`
                  : ''}
              </span>
              {/*
                An agreed rate offset is shown as part of the price rather than
                as a fee beside it, which is what makes the number above add up
                against the published curve. There is no line anywhere on this
                page that adds anything to a charge.
              */}
              {summary.rateOffset > 0 && (
                <span className="mt-1 block">
                  {dollars(summary.curveRate)} from the curve, plus your agreed rate offset of{' '}
                  {dollars(summary.rateOffset)}
                </span>
              )}
            </>
          }
        />

        {/* The window that set it. Deliberately adjacent to the rate, and
            deliberately not adjacent to "today". */}
        <StatTile
          label="Rating window — sets the rate"
          figure={pct(summary.ratingWindow.closingPct)}
          sub={
            <>
              <span className="block">
                {summary.ratingWindow.submittedApplications} of{' '}
                {summary.ratingWindow.deliveredCalls} delivered
              </span>
              <span className="mt-0.5 block">
                Delivery days: {windowLabel}
                {windowShort
                  ? ` · ${summary.ratingWindow.daysFound} of ${summary.ratingWindow.deliveryDays} found`
                  : ''}
              </span>
            </>
          }
        />

        {/* Today. Prices nothing, and says so. */}
        <StatTile
          label="Today so far"
          figure={<span className="text-ink-3">{pct(summary.today.closingPct)}</span>}
          sub={
            <>
              {summary.today.submittedApplications} of {summary.today.deliveredCalls} delivered ·
              does not set today&rsquo;s rate
            </>
          }
        />

        {/* Tomorrow, provisionally. */}
        <StatTile
          label="Tracking toward"
          icon={TrendingUp}
          figure={
            <span className={cn(summary.trackingBelowMinimum ? 'text-ringing-ink' : 'text-ink-3')}>
              {summary.trackingBelowMinimum ? 'review' : dollars(summary.trackingRate)}
            </span>
          }
          sub={
            <>
              <span className="block">
                {summary.trackingBelowMinimum
                  ? 'the window ending today is below the curve minimum'
                  : 'what tomorrow would be if today closed now'}
              </span>
              {summary.trackingDayKeys.length > 0 && (
                <span className="mt-0.5 block">over {summary.trackingDayKeys.join(', ')}</span>
              )}
            </>
          }
        />
      </div>

      {summary.openingBlock && (
        <Notice tone="info">
          Agreed opening rate: ${summary.openingBlock.rate} per application
          {summary.openingBlock.applications
            ? ` for an opening block of ${summary.openingBlock.applications}`
            : ''}
          . Daily rating begins from the first settled Delivery Day; from then the rate curve
          governs. There is no introductory rate.
        </Notice>
      )}

      <Panel className="min-w-0">
        <PanelHeader>
          <PanelTitle>Rate history</PanelTitle>
        </PanelHeader>
        <PanelBody flush={history.length > 0} className="overflow-x-auto">
          {history.length === 0 ? (
            <p className="t-body text-ink-3">
              No rate changes yet. The engine runs after the close of each business day.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Effective</TableHead>
                  <TableHead className="text-right">Delivered</TableHead>
                  <TableHead className="text-right">Applications</TableHead>
                  <TableHead className="text-right">Closing</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead>Delivery days</TableHead>
                  <TableHead>Curve</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map(row => (
                  <TableRow key={row.id}>
                    <TableCell className="t-num font-medium text-ink">
                      {row.effectiveCalendarDay}
                    </TableCell>
                    <TableCell className="t-num text-right">{row.deliveredCalls}</TableCell>
                    <TableCell className="t-num text-right">{row.submittedApplications}</TableCell>
                    <TableCell className="t-num text-right">{pct(row.closingPct)}</TableCell>
                    <TableCell className="t-num text-right">
                      {row.status === 'BELOW_MINIMUM' ? (
                        <span className="text-ringing-ink">review</span>
                      ) : (
                        <>
                          {row.previousRate !== null && row.previousRate !== row.newRate && (
                            <span className="mr-1 text-ink-3 line-through">
                              {dollars(row.previousRate)}
                            </span>
                          )}
                          {dollars(row.newRate)}
                        </>
                      )}
                    </TableCell>
                    <TableCell className="t-meta text-ink-3">
                      {row.windowDayKeys.join(', ') || '—'}
                      {row.windowDaysFound < row.windowDeliveryDays
                        ? ` (${row.windowDaysFound}/${row.windowDeliveryDays})`
                        : ''}
                    </TableCell>
                    <TableCell className="t-meta text-ink-3">v{row.curveVersion}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}

/**
 * ADMIN and OWNER only.
 *
 * What this agency is paid per submitted application. A price, and therefore
 * the principal's business: `/api/v1/rating/*` now refuses an AGENT outright
 * (see `requireAgencyPrincipal`), and this guard is so an agent who reaches the
 * URL is sent somewhere useful instead of watching a page fill with 403s.
 *
 * A platform operator inside an agency carries both roles and is unaffected --
 * except while previewing as AGENT, where being turned away is the point.
 */
export default function GuardedRatingPage(): JSX.Element {
  return (
    <RoleGuard allowedRoles={['ADMIN', 'OWNER']}>
      <RatingPage />
    </RoleGuard>
  );
}
