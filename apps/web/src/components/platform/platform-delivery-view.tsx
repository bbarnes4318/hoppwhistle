'use client';

import { AlertTriangle, Globe, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useState } from 'react';

import { CompactPageHeader, CompactPageShell } from '@/components/layout/compact-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useLivePoll } from '@/hooks/use-live-poll';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Delivery, across every agency.
 *
 * ── Why this is the landing screen ───────────────────────────────────────────
 *
 * NetEnroll staff run the whole platform, and drilling into a single agency is
 * the exception. Before this, an operator with no agency selected was told
 * "Choose an agency" and could see nothing until they picked one — so the
 * question "how is the platform doing this morning" could only be answered one
 * agency at a time.
 *
 * This is the same figures the agency's own /delivery panel shows, one row per
 * agency, with the platform totals across the top. Selecting an agency in the
 * switcher narrows the page to that agency's own panel; leaving returns here.
 * The switcher is a filter, not a gate.
 *
 * ── Nothing here is an agency's view of another agency ───────────────────────
 *
 * The route behind it is gated on the platform capability. An agency OWNER
 * cannot reach it, sees only their own agency on /delivery, and gets a 403 from
 * the endpoint rather than an empty table.
 *
 * ── Nulls render as em dashes, never zeroes ──────────────────────────────────
 *
 * A closing percentage with no delivered calls behind it, a rate under review,
 * an agency with no settlement yet. All em dashes. A fabricated 0% on the
 * screen platform staff read every morning is worse than an absent number.
 */

interface PlatformAgencyRow {
  tenantId: string;
  name: string;
  slug: string;
  isNonProduction: boolean;
  enrolled: boolean;
  chargesEnabled: boolean;
  deliveredCalls: number;
  applications: number;
  closingPct: number | null;
  rate: number | null;
  rateOffset: number;
  curveRate: number | null;
  paymentMethod: string;
  applicationsRemainingOnBlock: number;
  dailyBlockApplications: number;
  overrunToday: number;
  overrunCeiling: number;
  distanceToCeiling: number;
  revenue: number | null;
  callCost: number | null;
  margin: number | null;
  flags: {
    belowMinimumAndPaused: boolean;
    atCeiling: boolean;
    settlementFailedOrUnpaid: boolean;
    noValidMandate: boolean;
    suspended: boolean;
    enrolledNeverSettled: boolean;
    disputed: boolean;
  };
  dispute: {
    count: number;
    amount: number;
    latestStatus: string | null;
    openedAt: string | null;
  } | null;
  settlement: {
    status: string;
    totalCharged: number | null;
  };
}

interface PlatformTotals {
  agencies: number;
  agenciesExcluded: number;
  enrolled: number;
  deliveredCalls: number;
  applications: number;
  closingPct: number | null;
  revenue: number | null;
  callCost: number | null;
  margin: number | null;
  applicationsRemainingOnBlock: number;
  overrunToday: number;
  flagged: number;
  disputed: number;
}

interface Overview {
  calendarDay: string;
  agencies: PlatformAgencyRow[];
  totals: PlatformTotals;
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

/**
 * The flags that need somebody to act, worst first.
 *
 * A dispute leads, because it is money already taken back and delivery is
 * already stopped. It is its own badge rather than folded into "suspended",
 * even though a dispute does suspend the agency: an operator needs to know
 * which of the two they are looking at.
 */
function flagLabels(row: PlatformAgencyRow): string[] {
  const labels: string[] = [];
  if (row.flags.disputed) labels.push('disputed');
  if (row.flags.suspended && !row.flags.disputed) labels.push('suspended');
  if (row.flags.noValidMandate) labels.push('no payment method');
  if (row.flags.settlementFailedOrUnpaid) labels.push('unpaid settlement');
  if (row.flags.belowMinimumAndPaused) labels.push('below minimum');
  if (row.flags.atCeiling) labels.push('at ceiling');
  if (row.flags.enrolledNeverSettled) labels.push('never settled');
  return labels;
}

export function PlatformDeliveryView(): JSX.Element {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  /*
   * Demo and fixture tenants, off by default.
   *
   * Production has five tenants and none is a real agency. They are excluded
   * from the totals whether or not this is on: hiding a row and excluding a
   * number are two decisions, and only the first one is this toggle.
   */
  const [includeNonProduction, setIncludeNonProduction] = useState(false);

  const load = useCallback(async () => {
    const response = await apiClient.get<Envelope<Overview>>(
      `/api/v1/platform/delivery/overview${includeNonProduction ? '?includeNonProduction=true' : ''}`
    );
    setError(response.error ? response.error.message : null);
    setOverview(payload(response) ?? null);
  }, [includeNonProduction]);

  /**
   * Mark a tenant as not a real agency, or unmark it.
   *
   * Deletes nothing, suspends nothing and un-enrols nothing: it excludes the
   * tenant from the totals and hides its row behind the toggle above. The same
   * call reverses it, and the server audits both directions.
   *
   * Which of the production tenants are fixtures is deliberately not something
   * this software decides. A name that looks like a demo is not evidence, and
   * one of them could be carrying live client traffic — so an operator marks
   * them, from the volume figures.
   */
  const setNonProduction = useCallback(
    async (tenantId: string, next: boolean) => {
      const response = await apiClient.put(
        `/api/v1/platform/tenants/${tenantId}/non-production`,
        { isNonProduction: next }
      );
      if (response.error) {
        setError(response.error.message);
        return;
      }
      await load();
    },
    [load]
  );

  // Live while somebody is looking, on the same terms as the agency panel: a
  // hidden tab does no work and a returning one refreshes immediately.
  const { loading, refresh } = useLivePoll(load, { intervalMs: 30_000 });

  if (loading) {
    return (
      <CompactPageShell>
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading every agency
        </div>
      </CompactPageShell>
    );
  }

  if (error || !overview) {
    return (
      <CompactPageShell>
        <CompactPageHeader title="Delivery — every agency" icon={Globe} />
        <p className="text-sm text-muted-foreground">{error ?? 'No delivery data yet.'}</p>
      </CompactPageShell>
    );
  }

  const { totals } = overview;

  return (
    <CompactPageShell fullHeight={false}>
      <CompactPageHeader
        title="Delivery — every agency"
        subtitle={`${overview.calendarDay} · ${totals.agencies} ${
          totals.agencies === 1 ? 'agency' : 'agencies'
        }, ${totals.enrolled} enrolled`}
        icon={Globe}
      >
        <div className="flex items-center gap-2">
          {totals.flagged > 0 && (
            <Badge variant="destructive">
              {totals.flagged} needing attention
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="mr-2 h-3 w-3" />
            Refresh
          </Button>
        </div>
      </CompactPageHeader>

      {/*
        The totals, across the production agencies only. `agenciesExcluded` is
        stated beside them so a total is never quietly smaller than the table
        underneath it.
      */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Calls today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums">{totals.deliveredCalls}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">answered across the platform</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Applications today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums">{totals.applications}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">submitted across the platform</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Closing percentage
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums">{pct(totals.closingPct)}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              applications as a share of answered calls
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Settled today
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums">{dollars(totals.revenue)}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              margin {dollars(totals.margin)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              On the block
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums">
              {totals.applicationsRemainingOnBlock}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              paid applications remaining · {totals.overrunToday} in overrun
            </p>
          </CardContent>
        </Card>
      </div>

      {totals.disputed > 0 && (
        <div className="flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div>
            <p className="font-medium">
              {totals.disputed} {totals.disputed === 1 ? 'agency has' : 'agencies have'} a disputed
              payment
            </p>
            <p className="text-muted-foreground">
              Delivery is stopped for each of them and no overrun is being extended. Nothing has
              been refunded or credited — a chargeback is contained, not reversed. Delivery
              resumes only when a platform admin stands the dispute down.
            </p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          {totals.agenciesExcluded > 0
            ? `${totals.agenciesExcluded} non-production ${
                totals.agenciesExcluded === 1 ? 'tenant is' : 'tenants are'
              } excluded from these totals.`
            : 'Every active tenant is counted in these totals.'}
        </p>
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={includeNonProduction}
            onChange={event => setIncludeNonProduction(event.target.checked)}
          />
          Show non-production tenants
        </label>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agency</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Applications</TableHead>
                <TableHead className="text-right">Closing</TableHead>
                <TableHead className="text-right">On block</TableHead>
                <TableHead className="text-right">Overrun</TableHead>
                <TableHead className="text-right">To ceiling</TableHead>
                <TableHead className="text-right">Rate</TableHead>
                <TableHead>Settlement</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {overview.agencies.length === 0 && (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground">
                    No agencies.
                  </TableCell>
                </TableRow>
              )}
              {/*
                Flagged agencies first. The screen exists so somebody can find
                what needs acting on, and sorting alphabetically buries it.
              */}
              {[...overview.agencies]
                .sort((a, b) => {
                  const af = flagLabels(a).length > 0 ? 0 : 1;
                  const bf = flagLabels(b).length > 0 ? 0 : 1;
                  if (af !== bf) return af - bf;
                  return a.name.localeCompare(b.name);
                })
                .map(row => {
                  const flags = flagLabels(row);
                  return (
                    <TableRow key={row.tenantId} className={cn(flags.length > 0 && 'bg-destructive/5')}>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium">{row.name}</span>
                          {row.isNonProduction && (
                            <Badge variant="outline" className="text-[10px]">
                              non-production
                            </Badge>
                          )}
                          {!row.enrolled && (
                            <Badge variant="outline" className="text-[10px]">
                              not enrolled
                            </Badge>
                          )}
                          {flags.map(flag => (
                            <Badge key={flag} variant="destructive" className="text-[10px]">
                              {flag}
                            </Badge>
                          ))}
                          {/*
                            Offered only while the toggle is on, because that is
                            the state an operator is in when they are deciding
                            which tenants are fixtures. It changes nothing about
                            delivery or billing.
                          */}
                          {includeNonProduction && (
                            <button
                              type="button"
                              onClick={() =>
                                void setNonProduction(row.tenantId, !row.isNonProduction)
                              }
                              className="text-[10px] text-muted-foreground underline hover:text-ink"
                            >
                              {row.isNonProduction ? 'mark as production' : 'mark non-production'}
                            </button>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.deliveredCalls}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.applications}</TableCell>
                      <TableCell className="text-right tabular-nums">{pct(row.closingPct)}</TableCell>
                      {/*
                        Every billing figure is an em dash for an agency that is
                        not in the billing system. A zero there would read as
                        "out of credit" rather than "not metered".
                      */}
                      <TableCell className="text-right tabular-nums">
                        {row.enrolled
                          ? `${row.applicationsRemainingOnBlock} / ${row.dailyBlockApplications}`
                          : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.enrolled ? row.overrunToday : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.enrolled ? row.distanceToCeiling : '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        <span>{dollars(row.rate)}</span>
                        {/*
                          The offset shown beside the rate, not added to a total
                          somewhere else. It is part of the price: there is no
                          fee line on this platform.
                        */}
                        {row.rateOffset > 0 && (
                          <span className="ml-1 text-[10px] text-muted-foreground">
                            (curve {dollars(row.curveRate)} + {dollars(row.rateOffset)})
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Badge
                            variant={
                              row.settlement.status === 'SETTLED'
                                ? 'secondary'
                                : row.settlement.status === 'DRY_RUN' ||
                                    row.settlement.status === 'NOT_YET_RUN' ||
                                    row.settlement.status === 'NOT_ENROLLED'
                                  ? 'outline'
                                  : 'destructive'
                            }
                            className="text-[10px]"
                          >
                            {row.settlement.status.replace(/_/g, ' ').toLowerCase()}
                          </Badge>
                          {row.settlement.totalCharged !== null && (
                            <span className="text-[11px] tabular-nums text-muted-foreground">
                              {dollars(row.settlement.totalCharged)}
                            </span>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
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
