'use client';

import { Download, Globe, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Ledger, count, dollars, pct } from '@/components/delivery/ledger';
import { StatusChip } from '@/components/domain/status-chip';
import { CompactPageHeader, CompactPageShell } from '@/components/layout/compact-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

/**
 * A dry run is not a failure and a halt is not a decline.
 *
 * The same reading the agency's own history uses: a dry run computed correctly
 * and took no money on purpose, and a halt is the run working and withholding
 * the debit. Rendering either in the red reserved for a declined debit is how a
 * deliberate pre-go-live watch period reads as an outage.
 */
function statusTone(status: string): 'live' | 'ringing' | 'dropped' | 'neutral' {
  if (status === 'SUCCEEDED') return 'live';
  if (status === 'NOT_CHARGED' || status === 'DRY_RUN') return 'neutral';
  if (status === 'PENDING') return 'ringing';
  return 'dropped';
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
    <CompactPageShell fullHeight={false} data-print="page">
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

      {/* The filters, on one line, no box: they are controls, not content. */}
      <div className="flex flex-wrap items-end gap-3" data-print="hide">
        <div>
          <label className="mb-1 block t-meta text-ink-3" htmlFor="from">
            From
          </label>
          <Input
            id="from"
            type="date"
            value={from}
            onChange={event => setFrom(event.target.value)}
            className="h-8 w-36"
          />
        </div>
        <div>
          <label className="mb-1 block t-meta text-ink-3" htmlFor="to">
            To
          </label>
          <Input
            id="to"
            type="date"
            value={to}
            onChange={event => setTo(event.target.value)}
            className="h-8 w-36"
          />
        </div>
        <div>
          <label className="mb-1 block t-meta text-ink-3" htmlFor="agency">
            Agency
          </label>
          <select
            id="agency"
            value={agencyId}
            onChange={event => setAgencyId(event.target.value)}
            className="h-8 rounded-control border border-rule bg-surface px-2 t-body text-ink"
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
        <label className="flex h-8 cursor-pointer items-center gap-2 t-meta text-ink-2">
          <input
            type="checkbox"
            checked={includeNonProduction}
            onChange={event => setIncludeNonProduction(event.target.checked)}
            className="accent-brand-ink"
          />
          Include non-production tenants
        </label>
      </div>

      {error && <p className="t-body text-dropped-ink">{error}</p>}

      {loading ? (
        <div className="flex flex-1 items-center justify-center py-12 t-body text-ink-3">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Loading settlements
        </div>
      ) : (
        <div className="overflow-auto rounded-card border border-rule bg-surface">
          <Ledger>
            <thead>
              <tr>
                <th scope="col">Agency</th>
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
                  Charged
                </th>
                <th scope="col">Payment</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={12} className="text-center t-body text-ink-3">
                    No settlements in this range.
                  </td>
                </tr>
              )}
              {rows.map(row => (
                <tr key={row.id} className="hover:bg-sunken">
                  <td className="max-w-[16rem]">
                    <span className="truncate font-medium text-ink">
                      {row.agency ?? row.tenantId}
                    </span>
                    {row.isNonProduction && (
                      <span className="ml-1.5 t-meta text-ink-3">non-production</span>
                    )}
                  </td>
                  <td className="t-data whitespace-nowrap text-ink">{row.deliveryDay}</td>
                  <td className="num">{count(row.deliveredCalls)}</td>
                  <td className="num">{count(row.submittedApplications)}</td>
                  <td className="num">{pct(row.windowClosingPct)}</td>
                  <td className="num">
                    {/*
                      The two halves of the price where an offset applies, on
                      hover. Not a fee: `charged` is the rate times the
                      quantities and nothing is added to it.
                    */}
                    <span
                      title={
                        row.rateOffset > 0
                          ? `curve ${dollars(row.curveRate)} + offset ${dollars(row.rateOffset)}`
                          : undefined
                      }
                    >
                      {dollars(row.rate)}
                      {row.rateOffset > 0 && <span className="text-ink-3">*</span>}
                    </span>
                  </td>
                  <td className="num">{count(row.overrunQuantity)}</td>
                  <td className="num">{dollars(row.overrunAmount)}</td>
                  <td className="num">{count(row.nextBlockQuantity)}</td>
                  <td className="num">{dollars(row.nextBlockAmount)}</td>
                  <td className="num font-medium">{dollars(row.totalCharged)}</td>
                  <td className="whitespace-nowrap">
                    <StatusChip
                      value={row.paymentStatus}
                      label={row.paymentStatus.replace(/_/g, ' ').toLowerCase()}
                      tone={statusTone(row.paymentStatus)}
                      size="sm"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </Ledger>
        </div>
      )}

      <p className="t-meta text-ink-3">
        * rate includes an agreed offset above the curve; hover for the two halves. Enter an agency
        in the switcher to narrow this page to it; leaving returns here.
      </p>
    </CompactPageShell>
  );
}
