'use client';

import { AlertTriangle, Gauge, Loader2, TrendingUp } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { CompactPageHeader, CompactPageShell } from '@/components/layout/compact-layout';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * The agency's own rate, and the measurements behind it.
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
  newRate: number | null;
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

export default function RatingPage(): JSX.Element {
  const [summary, setSummary] = useState<RatingSummary | null>(null);
  const [history, setHistory] = useState<RateChangeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [summaryResponse, historyResponse] = await Promise.all([
      apiClient.get<RatingSummary>('/api/v1/rating/summary'),
      apiClient.get<RateChangeRow[]>('/api/v1/rating/history?limit=30'),
    ]);

    if (summaryResponse.error) setError(summaryResponse.error.message);
    else setError(null);

    setSummary(summaryResponse.data ?? null);
    setHistory(historyResponse.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <CompactPageShell>
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading rate
        </div>
      </CompactPageShell>
    );
  }

  if (error || !summary) {
    return (
      <CompactPageShell>
        <CompactPageHeader title="Rate" icon={Gauge} />
        <p className="text-sm text-muted-foreground">{error ?? 'No rating data yet.'}</p>
      </CompactPageShell>
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
    <CompactPageShell fullHeight={false}>
      <CompactPageHeader
        title="Rate"
        subtitle={`Days end 23:59:59 ${summary.timeZone} · curve v${summary.curveVersion}`}
        icon={Gauge}
      >
        <Badge variant={summary.status === 'UNDER_REVIEW' ? 'destructive' : 'secondary'}>
          {summary.status.replace('_', ' ').toLowerCase()}
        </Badge>
      </CompactPageHeader>

      {summary.reviewFlag && (
        <div className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div>
            <p className="font-medium">Flagged for review</p>
            <p className="text-muted-foreground">
              The trailing window closed at {pct(summary.reviewFlag.closingPct)} —{' '}
              {summary.reviewFlag.submittedApplications} applications from{' '}
              {summary.reviewFlag.deliveredCalls} delivered calls. There is no rate while this
              flag is open; NetEnroll clears it.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {/* The rate in force. The number the agency is being paid, today. */}
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Current rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums">{dollars(summary.currentRate)}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              per submitted application
              {summary.currentRateCalendarDay ? ` · effective ${summary.currentRateCalendarDay}` : ''}
            </p>
          </CardContent>
        </Card>

        {/* The window that set it. Deliberately adjacent to the rate, and
            deliberately not adjacent to "today". */}
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Rating window — sets the rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums">
              {pct(summary.ratingWindow.closingPct)}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {summary.ratingWindow.submittedApplications} of{' '}
              {summary.ratingWindow.deliveredCalls} delivered
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Delivery days: {windowLabel}
              {windowShort
                ? ` · ${summary.ratingWindow.daysFound} of ${summary.ratingWindow.deliveryDays} found`
                : ''}
            </p>
          </CardContent>
        </Card>

        {/* Today. Prices nothing, and says so. */}
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Today so far
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums text-muted-foreground">
              {pct(summary.today.closingPct)}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {summary.today.submittedApplications} of {summary.today.deliveredCalls} delivered ·
              does not set today&rsquo;s rate
            </p>
          </CardContent>
        </Card>

        {/* Tomorrow, provisionally. */}
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <TrendingUp className="h-3 w-3" />
              Tracking toward
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={cn(
                'text-3xl font-bold tabular-nums',
                summary.trackingBelowMinimum ? 'text-amber-500' : 'text-muted-foreground'
              )}
            >
              {summary.trackingBelowMinimum ? 'review' : dollars(summary.trackingRate)}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {summary.trackingBelowMinimum
                ? 'the window ending today is below the curve minimum'
                : 'what tomorrow would be if today closed now'}
            </p>
            {summary.trackingDayKeys.length > 0 && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                over {summary.trackingDayKeys.join(', ')}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {summary.openingBlock && (
        <p className="text-[11px] text-muted-foreground">
          Agreed opening rate: ${summary.openingBlock.rate} per application
          {summary.openingBlock.applications
            ? ` for an opening block of ${summary.openingBlock.applications}`
            : ''}
          . Daily rating begins from the first settled Delivery Day; from then the
          rate curve governs. There is no introductory rate.
        </p>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Rate history</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
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
                    <TableCell className="font-medium tabular-nums">
                      {row.effectiveCalendarDay}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{row.deliveredCalls}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.submittedApplications}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{pct(row.closingPct)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.status === 'BELOW_MINIMUM' ? (
                        <span className="text-amber-500">review</span>
                      ) : (
                        <>
                          {row.previousRate !== null && row.previousRate !== row.newRate && (
                            <span className="mr-1 text-muted-foreground line-through">
                              {dollars(row.previousRate)}
                            </span>
                          )}
                          {dollars(row.newRate)}
                        </>
                      )}
                    </TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">
                      {row.windowDayKeys.join(', ') || '—'}
                      {row.windowDaysFound < row.windowDeliveryDays
                        ? ` (${row.windowDaysFound}/${row.windowDeliveryDays})`
                        : ''}
                    </TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">
                      v{row.curveVersion}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </CompactPageShell>
  );
}
