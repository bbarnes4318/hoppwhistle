'use client';

import { Download, Loader2, Receipt } from 'lucide-react';
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
import { apiClient } from '@/lib/api';

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

function pct(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)}%`;
}

function money(value: number | null): string {
  return value === null ? '—' : `$${value.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

function statusVariant(status: string): 'secondary' | 'destructive' | 'outline' {
  if (status === 'SUCCEEDED' || status === 'NOT_CHARGED') return 'secondary';
  if (status === 'PENDING') return 'outline';
  return 'destructive';
}

export default function SettlementsPage(): JSX.Element {
  const [rows, setRows] = useState<SettlementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    const response = await apiClient.get<SettlementRow[]>('/api/v1/delivery/settlements');
    setError(response.error ? response.error.message : null);
    setRows(response.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function download(): Promise<void> {
    setExporting(true);
    try {
      const response = await apiClient.get<string>('/api/v1/delivery/settlements.csv', {
        responseType: 'text',
      });
      if (!response.data) return;
      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', 'settlements.csv');
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
        <Button variant="outline" size="sm" onClick={() => void download()} disabled={exporting}>
          {exporting ? (
            <Loader2 className="mr-2 h-3 w-3 animate-spin" />
          ) : (
            <Download className="mr-2 h-3 w-3" />
          )}
          CSV
        </Button>
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
                    <TableHead>Payment</TableHead>
                    <TableHead>Window days</TableHead>
                    <TableHead>Curve</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(row => (
                    <TableRow key={row.id}>
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
                        {row.rate === null ? '—' : `$${row.rate}`}
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
