'use client';

import { Globe, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { CompactPageHeader, CompactPageShell } from '@/components/layout/compact-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { cn } from '@/lib/utils';

/**
 * Every agency's rate, side by side.
 *
 * ── Why the three columns are these three ────────────────────────────────────
 *
 * The closing percentage an agency is producing, the rate it is being charged,
 * and the rate that percentage is tracking toward. Read in one row they make
 * the curve legible: an agency at 12% paying $149 and tracking $144 is
 * improving, and one paying $144 and tracking $159 is not — and the second is
 * the conversation somebody needs to have this week.
 *
 * Before this, an operator with no agency selected saw "Choose an agency" and
 * could answer that question only one agency at a time.
 *
 * ── The rate includes the offset, here as everywhere ─────────────────────────
 *
 * Both rates are effective: the curve's answer plus the agency's agreed rate
 * offset. The two halves are shown where an offset exists, because an operator
 * comparing two agencies at the same closing percentage needs to see why they
 * are paying different prices. It is not a fee and there is no fee column —
 * a different price is not a surcharge.
 */

interface PlatformRatingRow {
  tenantId: string;
  name: string;
  slug: string;
  isNonProduction: boolean;
  status: string;
  todayClosingPct: number | null;
  todayDeliveredCalls: number;
  todaySubmittedApplications: number;
  windowClosingPct: number | null;
  windowDayKeys: string[];
  windowDaysFound: number;
  currentRate: number | null;
  curveRate: number | null;
  rateOffset: number;
  trackingRate: number | null;
  trackingBelowMinimum: boolean;
  trackingClosingPct: number | null;
  underReview: boolean;
}

interface RatingOverview {
  calendarDay: string;
  timeZone: string;
  curveVersion: number;
  agencies: PlatformRatingRow[];
  includingNonProduction: boolean;
}

/** A percentage, or an em dash. Never a fabricated 0%. */
function pct(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)}%`;
}

/** Dollars to the cent, or an em dash. Under review there is no rate, not $0. */
function dollars(value: number | null): string {
  return value === null
    ? '—'
    : `$${value.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
}

export function PlatformRatingView(): JSX.Element {
  const [overview, setOverview] = useState<RatingOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [includeNonProduction, setIncludeNonProduction] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const response = await apiClient.get<Envelope<RatingOverview>>(
      `/api/v1/platform/rating/overview${includeNonProduction ? '?includeNonProduction=true' : ''}`
    );
    setError(response.error ? response.error.message : null);
    setOverview(payload(response) ?? null);
    setLoading(false);
  }, [includeNonProduction]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <CompactPageShell>
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading every agency&rsquo;s rate
        </div>
      </CompactPageShell>
    );
  }

  if (error || !overview) {
    return (
      <CompactPageShell>
        <CompactPageHeader title="Rate — every agency" icon={Globe} />
        <p className="text-sm text-muted-foreground">{error ?? 'No rating data yet.'}</p>
      </CompactPageShell>
    );
  }

  const excluded = overview.agencies.filter(row => row.isNonProduction).length;

  return (
    <CompactPageShell fullHeight={false}>
      <CompactPageHeader
        title="Rate — every agency"
        subtitle={`${overview.calendarDay} · days end 23:59:59 ${overview.timeZone} · curve v${overview.curveVersion}`}
        icon={Globe}
      >
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw className="mr-2 h-3 w-3" />
          Refresh
        </Button>
      </CompactPageHeader>

      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          &ldquo;Today so far&rdquo; moves all day and prices nothing. The rating window is the
          trailing Delivery Days that actually set the rate in force.
        </p>
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={includeNonProduction}
            onChange={event => setIncludeNonProduction(event.target.checked)}
          />
          Show non-production tenants
          {includeNonProduction && excluded > 0 ? ` (${excluded})` : ''}
        </label>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agency</TableHead>
                <TableHead className="text-right">Today so far</TableHead>
                <TableHead className="text-right">Rating window</TableHead>
                <TableHead className="text-right">Current rate</TableHead>
                <TableHead className="text-right">Tracking toward</TableHead>
                <TableHead>Window days</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overview.agencies.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No agencies.
                  </TableCell>
                </TableRow>
              )}
              {/*
                Under-review agencies first: an agency below the curve's minimum
                has no rate at all and delivery is paused until somebody clears
                the flag, which is the one row on this table that is somebody's
                job today.
              */}
              {[...overview.agencies]
                .sort((a, b) => {
                  if (a.underReview !== b.underReview) return a.underReview ? -1 : 1;
                  return a.name.localeCompare(b.name);
                })
                .map(row => (
                  <TableRow key={row.tenantId} className={cn(row.underReview && 'bg-ringing-tint')}>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{row.name}</span>
                        {row.isNonProduction && (
                          <Badge variant="outline" className="text-[10px]">
                            non-production
                          </Badge>
                        )}
                        {row.underReview && (
                          <Badge variant="destructive" className="text-[10px]">
                            under review
                          </Badge>
                        )}
                        {row.status === 'OPENING_BLOCK' && (
                          <Badge variant="outline" className="text-[10px]">
                            opening block
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span>{pct(row.todayClosingPct)}</span>
                      <span className="ml-1 text-[10px] text-muted-foreground">
                        {row.todaySubmittedApplications}/{row.todayDeliveredCalls}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {pct(row.windowClosingPct)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span>{dollars(row.currentRate)}</span>
                      {/*
                        The offset shown as part of the price. It is added to the
                        curve rate at every point on the curve; it is never a
                        separate charge, and there is no column here that adds
                        anything to a settlement.
                      */}
                      {row.rateOffset > 0 && (
                        <span className="ml-1 text-[10px] text-muted-foreground">
                          (curve {dollars(row.curveRate)} + {dollars(row.rateOffset)})
                        </span>
                      )}
                    </TableCell>
                    {/*
                      Muted and explicitly provisional, the same treatment the
                      agency's own page gives it: an operator who reads this as
                      the current rate believes an agency is paying something it
                      is not.
                    */}
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {row.trackingBelowMinimum ? (
                        <span className="text-ringing-ink">review</span>
                      ) : (
                        dollars(row.trackingRate)
                      )}
                    </TableCell>
                    <TableCell className="text-[11px] text-muted-foreground">
                      {row.windowDayKeys.length > 0
                        ? row.windowDayKeys.join(', ')
                        : 'not yet rated'}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <p className="text-[11px] text-muted-foreground">
        Enter an agency in the switcher to narrow this page to it. Leaving returns here.
      </p>
    </CompactPageShell>
  );
}
