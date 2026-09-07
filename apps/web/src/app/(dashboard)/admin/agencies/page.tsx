'use client';

import { AlertTriangle, Building2, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { CompactPageHeader, CompactPageShell } from '@/components/layout/compact-layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
 * NetEnroll's cross-agency view.
 *
 * Platform staff only — the endpoints behind it are gated on the platform
 * capability, and an agency OWNER is refused by the server rather than by this
 * page choosing not to render.
 *
 * Two questions it exists to answer, in this order:
 *
 *   WHAT NEEDS ACTION.  Below the minimum and paused, at the ceiling, a failed
 *                       or unpaid settlement, no valid mandate, suspended.
 *                       Flagged rows sort to the top, because the point of the
 *                       screen is the exceptions.
 *   WHERE DID THE RUN   Settled, failed, or not yet run — per agency, for the
 *   GET TO.             Delivery Day named.
 *
 * Every figure is per agency and computed per agency. There is no pooled
 * cross-tenant aggregate anywhere on it: one agency's number must never be
 * derived from another's traffic.
 */

interface AgencyRow {
  tenantId: string;
  name: string;
  slug: string;
  deliveredCalls: number;
  applications: number;
  closingPct: number | null;
  rate: number | null;
  revenue: number | null;
  callCost: number | null;
  margin: number | null;
  revenuePerCall: number | null;
  costPerCall: number | null;
  flags: {
    belowMinimumAndPaused: boolean;
    atCeiling: boolean;
    settlementFailedOrUnpaid: boolean;
    noValidMandate: boolean;
    suspended: boolean;
  };
  settlement: {
    status: 'SETTLED' | 'FAILED' | 'NOT_YET_RUN';
    paymentStatus: string | null;
    totalCharged: number | null;
    overrunQuantity: number | null;
    nextBlockQuantity: number | null;
  };
}

function pct(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)}%`;
}

function money(value: number | null, digits = 2): string {
  return value === null
    ? '—'
    : `$${value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function flagCount(row: AgencyRow): number {
  return Object.values(row.flags).filter(Boolean).length;
}

export default function PlatformAgenciesPage(): JSX.Element {
  const [day, setDay] = useState('');
  const [rows, setRows] = useState<AgencyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    const query = day ? `?day=${encodeURIComponent(day)}` : '';
    const response = await apiClient.get<{ calendarDay: string; agencies: AgencyRow[] }>(
      `/api/v1/platform/delivery/overview${query}`
    );
    setError(response.error ? response.error.message : null);
    setRows(response.data?.agencies ?? []);
    if (!day && response.data?.calendarDay) setDay(response.data.calendarDay);
    setLoading(false);
  }, [day]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Run the settlement for the day shown.
   *
   * Safe to press twice: one settlement exists per agency per Delivery Day,
   * enforced by a unique index, so a second run charges nobody. No amount is
   * sent — the body carries a day and nothing else.
   */
  async function runSettlement(): Promise<void> {
    setRunning(true);
    try {
      await apiClient.post('/api/v1/platform/delivery/settlement/run', { deliveryDay: day });
      await load();
    } finally {
      setRunning(false);
    }
  }

  const sorted = [...rows].sort((a, b) => flagCount(b) - flagCount(a) || a.name.localeCompare(b.name));
  const needingAction = sorted.filter(row => flagCount(row) > 0);

  if (loading) {
    return (
      <CompactPageShell>
        <div className="flex flex-1 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading agencies
        </div>
      </CompactPageShell>
    );
  }

  return (
    <CompactPageShell fullHeight={false}>
      <CompactPageHeader
        title="Agencies"
        subtitle="Cross-agency delivery, revenue and settlement status"
        icon={Building2}
      >
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value={day}
            onChange={event => setDay(event.target.value)}
            className="h-8 w-40"
          />
          <Button variant="outline" size="sm" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-3 w-3" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => void runSettlement()} disabled={running}>
            {running && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
            Run settlement
          </Button>
        </div>
      </CompactPageHeader>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {needingAction.length > 0 && (
        <div className="flex items-start gap-2 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div>
            <p className="font-medium">
              {needingAction.length} agenc{needingAction.length === 1 ? 'y needs' : 'ies need'}{' '}
              action
            </p>
            <p className="text-muted-foreground">
              {needingAction.map(row => row.name).join(', ')}
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Per agency — {day}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agency</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Applications</TableHead>
                  <TableHead className="text-right">Closing</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                  <TableHead className="text-right">Call cost</TableHead>
                  <TableHead className="text-right">Margin</TableHead>
                  <TableHead className="text-right">Rev / call</TableHead>
                  <TableHead className="text-right">Cost / call</TableHead>
                  <TableHead>Settlement</TableHead>
                  <TableHead>Flags</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map(row => (
                  <TableRow key={row.tenantId}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.deliveredCalls}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.applications}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(row.closingPct)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.rate === null ? '—' : `$${row.rate}`}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{money(row.revenue)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(row.callCost)}</TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-medium tabular-nums',
                        row.margin !== null && row.margin < 0 && 'text-destructive'
                      )}
                    >
                      {money(row.margin)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {money(row.revenuePerCall, 4)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {money(row.costPerCall, 4)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          row.settlement.status === 'SETTLED'
                            ? 'secondary'
                            : row.settlement.status === 'FAILED'
                              ? 'destructive'
                              : 'outline'
                        }
                      >
                        {row.settlement.status === 'NOT_YET_RUN'
                          ? 'not yet run'
                          : (row.settlement.paymentStatus ?? row.settlement.status)
                              .replace(/_/g, ' ')
                              .toLowerCase()}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {row.flags.belowMinimumAndPaused && (
                          <Badge variant="destructive" title="Below the curve minimum; only a platform admin can clear the review">
                            below 5%
                          </Badge>
                        )}
                        {row.flags.atCeiling && (
                          <Badge variant="destructive" title="Overrun ceiling reached for this Delivery Day">
                            at ceiling
                          </Badge>
                        )}
                        {row.flags.settlementFailedOrUnpaid && (
                          <Badge variant="destructive" title="A settlement is failed or unpaid">
                            unpaid
                          </Badge>
                        )}
                        {row.flags.noValidMandate && (
                          <Badge variant="destructive" title="No valid ACH mandate — no delivery">
                            no mandate
                          </Badge>
                        )}
                        {row.flags.suspended && (
                          <Badge variant="destructive" title="Suspended by a platform admin">
                            suspended
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </CompactPageShell>
  );
}
