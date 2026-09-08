'use client';

import { Download, Globe, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

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
 * Settlement history, across every agency.
 *
 * ── Why this is the landing screen ───────────────────────────────────────────
 *
 * An agency reads its own settlements one row per Delivery Day. Platform staff
 * read every agency's, over a range, filterable to one — and before this an
 * operator with no agency selected was told "Choose an agency" and could see
 * none of it.
 *
 * The columns are the same columns, plus the agency. Nothing is summarised away
 * and nothing is recomputed in the browser: each row is the stored record.
 *
 * ── The export matches the table ─────────────────────────────────────────────
 *
 * The CSV takes the same range, the same agency filter and the same
 * non-production toggle, and carries the same rows plus everything an invoice
 * is raised from. A file that answered a different question from the screen
 * above it is a file somebody reconciles from and cannot check.
 *
 * The range is sent to the server, which selects the rows. Filtering a fetched
 * page in the browser would export whatever the table happened to have loaded
 * rather than the range that was asked for.
 */

interface PlatformSettlementRow {
  id: string;
  tenantId: string;
  agency: string | null;
  isNonProduction: boolean;
  deliveryDay: string;
  deliveredCalls: number;
  submittedApplications: number;
  windowClosingPct: number | null;
  rate: number | null;
  curveRate: number | null;
  rateOffset: number;
  curveVersion: number | null;
  overrunQuantity: number;
  overrunAmount: number;
  nextBlockQuantity: number;
  nextBlockAmount: number;
  totalCharged: number;
  maxDailyDebit: number;
  paymentStatus: string;
}

interface PlatformSettlements {
  agencyId: string | null;
  includingNonProduction: boolean;
  settlements: PlatformSettlementRow[];
}

interface AgencyOption {
  tenantId: string;
  name: string;
  isNonProduction: boolean;
  enrolled: boolean;
}

function pct(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)}%`;
}

function dollars(value: number | null): string {
  return value === null
    ? '—'
    : `$${value.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
}

/**
 * A dry run is not a failure and a halt is not a decline.
 *
 * The same reading the agency's own history uses: a dry run computed correctly
 * and took no money on purpose, and a halt is the run working and withholding
 * the debit. Rendering either in the red reserved for a declined debit is how a
 * deliberate pre-go-live watch period reads as an outage.
 */
function statusVariant(status: string): 'secondary' | 'destructive' | 'outline' {
  if (status === 'SUCCEEDED' || status === 'NOT_CHARGED') return 'secondary';
  if (status === 'PENDING' || status === 'DRY_RUN') return 'outline';
  return 'destructive';
}

export function PlatformSettlementsView(): JSX.Element {
  const [rows, setRows] = useState<PlatformSettlementRow[]>([]);
  const [agencies, setAgencies] = useState<AgencyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [agencyId, setAgencyId] = useState('');
  const [includeNonProduction, setIncludeNonProduction] = useState(false);

  /** The filters, as the server understands them. One place, two callers. */
  const query = useCallback((): string => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (agencyId) params.set('agencyId', agencyId);
    if (includeNonProduction) params.set('includeNonProduction', 'true');
    const text = params.toString();
    return text ? `?${text}` : '';
  }, [from, to, agencyId, includeNonProduction]);

  const load = useCallback(async () => {
    setLoading(true);
    const response = await apiClient.get<Envelope<PlatformSettlements>>(
      `/api/v1/platform/delivery/settlements${query()}`
    );
    setError(response.error ? response.error.message : null);
    const data = payload(response);
    setRows(Array.isArray(data?.settlements) ? data.settlements : []);
    setLoading(false);
  }, [query]);

  useEffect(() => {
    void (async () => {
      const response = await apiClient.get<Envelope<AgencyOption[]>>(
        '/api/v1/platform/delivery/agencies?includeNonProduction=true'
      );
      const list = payload(response);
      setAgencies(Array.isArray(list) ? list : []);
    })();
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function download(): Promise<void> {
    setExporting(true);
    try {
      /*
       * The same filters the table is showing, in the same shape. The export
       * route names the agency filter `tenantId` rather than `agencyId`, which
       * is the name it has carried since Phase 3 and which a finance team's
       * saved links use.
       */
      const params = new URLSearchParams();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (agencyId) params.set('tenantId', agencyId);
      if (includeNonProduction) params.set('includeNonProduction', 'true');
      const text = params.toString();

      const response = await apiClient.get<string>(
        `/api/v1/platform/delivery/settlements.csv${text ? `?${text}` : ''}`,
        { responseType: 'text' }
      );

      if (!response.data) {
        setError(response.error ? response.error.message : 'The export returned nothing.');
        return;
      }

      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `settlements-${from || 'start'}-to-${to || 'today'}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  return (
    <CompactPageShell fullHeight={false}>
      <CompactPageHeader
        title="Settlements — every agency"
        subtitle="One row per agency per settled Delivery Day"
        icon={Globe}
      >
        <Button variant="outline" size="sm" onClick={() => void download()} disabled={exporting}>
          <Download className="mr-2 h-3 w-3" />
          {exporting ? 'Exporting…' : 'Export CSV'}
        </Button>
      </CompactPageHeader>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div>
            <label className="mb-1 block text-[11px] text-muted-foreground" htmlFor="from">
              From
            </label>
            <Input
              id="from"
              type="date"
              value={from}
              onChange={event => setFrom(event.target.value)}
              className="w-40"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-muted-foreground" htmlFor="to">
              To
            </label>
            <Input
              id="to"
              type="date"
              value={to}
              onChange={event => setTo(event.target.value)}
              className="w-40"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-muted-foreground" htmlFor="agency">
              Agency
            </label>
            <select
              id="agency"
              value={agencyId}
              onChange={event => setAgencyId(event.target.value)}
              className="h-9 rounded-control border border-rule bg-paper px-2 text-sm"
            >
              <option value="">Every agency</option>
              {agencies.map(agency => (
                <option key={agency.tenantId} value={agency.tenantId}>
                  {agency.name}
                  {agency.isNonProduction ? ' (non-production)' : ''}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 pb-2 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={includeNonProduction}
              onChange={event => setIncludeNonProduction(event.target.checked)}
            />
            Include non-production tenants
          </label>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <div className="flex flex-1 items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading settlements
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agency</TableHead>
                  <TableHead>Delivery Day</TableHead>
                  <TableHead className="text-right">Calls</TableHead>
                  <TableHead className="text-right">Applications</TableHead>
                  <TableHead className="text-right">Window</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Overrun</TableHead>
                  <TableHead className="text-right">Next block</TableHead>
                  <TableHead className="text-right">Charged</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center text-muted-foreground">
                      No settlements in this range.
                    </TableCell>
                  </TableRow>
                )}
                {rows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium">{row.agency ?? row.tenantId}</span>
                        {row.isNonProduction && (
                          <Badge variant="outline" className="text-[10px]">
                            non-production
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="tabular-nums">{row.deliveryDay}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.deliveredCalls}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.submittedApplications}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {pct(row.windowClosingPct)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span>{dollars(row.rate)}</span>
                      {/*
                        The two halves of the price where an offset applies.
                        Not a fee: `charged` below is the rate times the
                        quantities and nothing is added to it.
                      */}
                      {row.rateOffset > 0 && (
                        <span className="ml-1 text-[10px] text-muted-foreground">
                          ({dollars(row.curveRate)} + {dollars(row.rateOffset)})
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.overrunQuantity} · {dollars(row.overrunAmount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.nextBlockQuantity} · {dollars(row.nextBlockAmount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">
                      {dollars(row.totalCharged)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(row.paymentStatus)} className="text-[10px]">
                        {row.paymentStatus.replace(/_/g, ' ').toLowerCase()}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <p className="text-[11px] text-muted-foreground">
        Enter an agency in the switcher to narrow this page to it. Leaving returns here.
      </p>
    </CompactPageShell>
  );
}
