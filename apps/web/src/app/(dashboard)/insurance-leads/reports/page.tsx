'use client';

/**
 * CRM Reports — Ameriquote delivery outcomes.
 *
 * The question this page answers: of the leads we sent to Ameriquote, which
 * ones did they accept, which ones did they not, and what reason did they give
 * for each refusal. Every view here exports to CSV, and the CSV is rendered
 * server-side from the same rows shown on screen, so the file and the screen
 * can never disagree.
 */

import {
  ArrowLeft,
  CheckCircle2,
  Download,
  Loader2,
  RefreshCw,
  Search,
  XCircle,
  Clock,
  DollarSign,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  EmptyState,
  Notice,
  Panel,
  PanelBody,
  PanelHeader,
  PanelTitle,
  Segmented,
  SegmentedItem,
} from '@/components/domain';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { apiClient } from '@/lib/api';
import {
  exportDeliveryReportCsv,
  fetchDeliveryReport,
  type DeliveryOutcome,
  type DeliveryReport,
} from '@/lib/api/leads';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 100;

/** How many distinct reasons the panel lists before it summarises the tail. */
const TOP_REASONS = 8;

function pastDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

interface Filters {
  startDate: string;
  endDate: string;
  outcome: string;
  vertical: string;
  postMode: string;
  listId: string;
  search: string;
}

const DATE_PRESETS: Array<{ key: string; label: string; days: number }> = [
  { key: 'today', label: 'Today', days: 0 },
  { key: 'last-7', label: '7 days', days: 7 },
  { key: 'last-30', label: '30 days', days: 30 },
  { key: 'last-90', label: '90 days', days: 90 },
];

const OUTCOME_STYLES: Record<DeliveryOutcome, string> = {
  ACCEPTED: 'bg-live-tint text-live-ink',
  NOT_ACCEPTED: 'bg-dropped-tint text-dropped-ink',
  NOT_SENT: 'bg-ringing-tint text-ringing-ink',
};

/** Native date inputs and selects, drawn like the Input and Select primitives. */
const CONTROL =
  'h-9 rounded-control border border-rule-strong bg-surface px-3 text-sm text-ink shadow-card transition-[border-color,box-shadow] duration-150 ease-out hover:border-ink-3 focus-visible:border-brand-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [@media(pointer:coarse)]:min-h-[40px]';

/** The pill a count or an outcome sits in — the Badge shape. */
const PILL =
  'inline-flex h-[22px] shrink-0 items-center whitespace-nowrap rounded-full px-2.5 text-[12px] font-medium';

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) return phone;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function SummaryTile({
  label,
  value,
  sub,
  icon: Icon,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: string;
  sub: string;
  icon: typeof CheckCircle2;
  tone: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const Wrapper = onClick ? 'button' : 'div';
  return (
    <Wrapper
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={cn(
        'flex min-w-0 flex-col rounded-card border bg-surface p-5 text-left shadow-card',
        'transition-[border-color,box-shadow] duration-150 ease-out',
        active ? 'border-brand ring-1 ring-brand' : 'border-rule',
        Wrapper === 'button' && 'hover:shadow-raised',
        onClick && 'hover:border-border cursor-pointer'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="t-label pt-0.5 text-ink-3">{label}</span>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-brand-tint text-brand-ink">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className={cn('t-figure mt-1 min-w-0 tabular-nums', tone)}>{value}</div>
      <div className="t-meta mt-1 min-h-[17px] text-ink-3">{sub}</div>
    </Wrapper>
  );
}

export default function CrmReportsPage() {
  const [filters, setFilters] = useState<Filters>({
    startDate: pastDate(30),
    endDate: pastDate(0),
    outcome: '',
    vertical: '',
    postMode: '',
    listId: '',
    search: '',
  });
  const [datePreset, setDatePreset] = useState('last-30');
  const [page, setPage] = useState(1);
  const [report, setReport] = useState<DeliveryReport | null>(null);
  const [leadLists, setLeadLists] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryParams = useMemo(
    () => ({
      startDate: filters.startDate || undefined,
      endDate: filters.endDate || undefined,
      outcome: filters.outcome || undefined,
      vertical: filters.vertical || undefined,
      postMode: filters.postMode || undefined,
      listId: filters.listId || undefined,
      search: filters.search.trim() || undefined,
    }),
    [filters]
  );

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchDeliveryReport({ ...queryParams, page, limit: PAGE_SIZE });
      setReport(result);
    } catch (err) {
      setReport(null);
      setError(err instanceof Error ? err.message : 'Failed to load the delivery report');
    } finally {
      setLoading(false);
    }
  }, [queryParams, page]);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  useEffect(() => {
    void (async () => {
      const response =
        await apiClient.get<Array<{ id: string; name: string }>>('/api/v1/lead-lists');
      if (!response.error && Array.isArray(response.data)) setLeadLists(response.data);
    })();
  }, []);

  const setFilter = (key: keyof Filters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const applyPreset = (preset: { key: string; days: number }) => {
    setDatePreset(preset.key);
    setFilters(prev => ({ ...prev, startDate: pastDate(preset.days), endDate: pastDate(0) }));
    setPage(1);
  };

  const handleExport = async () => {
    setExporting(true);
    setError(null);
    try {
      await exportDeliveryReportCsv(queryParams);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export the report');
    } finally {
      setExporting(false);
    }
  };

  const summary = report?.summary;
  const acceptanceRate =
    summary?.acceptanceRate === null || summary?.acceptanceRate === undefined
      ? '—'
      : `${(summary.acceptanceRate * 100).toFixed(1)}%`;

  const toggleOutcome = (outcome: DeliveryOutcome) =>
    setFilter('outcome', filters.outcome === outcome ? '' : outcome);

  const totalPages = report?.meta.totalPages ?? 1;

  return (
    <div className="page-canvas">
      <PageHeader
        description={
          <>
            <Link
              href="/insurance-leads"
              className="t-meta mb-1 inline-flex items-center gap-1 text-ink-3 transition-colors hover:text-ink"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to CRM
            </Link>
            <p>Every lead sent to Ameriquote — what they accepted, what they refused, and why.</p>
          </>
        }
        actions={
          <>
            <Tooltip content="Refresh">
              <Button
                variant="outline"
                size="icon"
                onClick={() => void loadReport()}
                disabled={loading}
                title="Refresh"
              >
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              </Button>
            </Tooltip>
            <Button
              onClick={() => void handleExport()}
              disabled={exporting}
              className="min-w-[136px]"
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {exporting ? 'Building CSV…' : 'Export CSV'}
            </Button>
          </>
        }
      />

      {error && <Notice tone="error">{error}</Notice>}

      {/* Filters */}
      <Panel>
        <PanelBody className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center">
          <div className="flex flex-wrap items-center gap-2">
            <span className="t-label text-ink-3">From</span>
            <input
              type="date"
              value={filters.startDate}
              onChange={e => {
                setFilter('startDate', e.target.value);
                setDatePreset('custom');
              }}
              className={CONTROL}
            />
            <span className="t-label text-ink-3">To</span>
            <input
              type="date"
              value={filters.endDate}
              onChange={e => {
                setFilter('endDate', e.target.value);
                setDatePreset('custom');
              }}
              className={CONTROL}
            />
          </div>

          <Segmented>
            {DATE_PRESETS.map(preset => (
              <SegmentedItem
                key={preset.key}
                type="button"
                onClick={() => applyPreset(preset)}
                active={datePreset === preset.key}
              >
                {preset.label}
              </SegmentedItem>
            ))}
          </Segmented>

          <select
            value={filters.outcome}
            onChange={e => setFilter('outcome', e.target.value)}
            className={cn(CONTROL, 'min-w-[168px] cursor-pointer')}
            aria-label="Outcome"
          >
            <option value="">All outcomes</option>
            <option value="ACCEPTED">Accepted</option>
            <option value="NOT_ACCEPTED">Not accepted</option>
            <option value="NOT_SENT">Not sent</option>
          </select>

          <select
            value={filters.vertical}
            onChange={e => setFilter('vertical', e.target.value)}
            className={cn(CONTROL, 'min-w-[168px] cursor-pointer')}
            aria-label="Vertical"
          >
            <option value="">All verticals</option>
            <option value="ACA">ACA</option>
            <option value="FE">FE</option>
            <option value="B2B">B2B</option>
          </select>

          <select
            value={filters.postMode}
            onChange={e => setFilter('postMode', e.target.value)}
            className={cn(CONTROL, 'min-w-[168px] cursor-pointer')}
            aria-label="Mode"
          >
            <option value="">Test + Live</option>
            <option value="LIVE">Live only</option>
            <option value="TEST">Test only</option>
          </select>

          <select
            value={filters.listId}
            onChange={e => setFilter('listId', e.target.value)}
            className={cn(CONTROL, 'min-w-[168px] cursor-pointer')}
            aria-label="Lead list"
          >
            <option value="">All lead lists</option>
            {leadLists.map(list => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
          </select>

          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
            <input
              type="text"
              placeholder="Name, phone, email, zip…"
              value={filters.search}
              onChange={e => setFilter('search', e.target.value)}
              className={cn(CONTROL, 'w-full pl-9 placeholder:text-ink-3')}
            />
          </div>
        </PanelBody>
      </Panel>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <SummaryTile
          label="Accepted"
          value={(summary?.accepted ?? 0).toLocaleString()}
          sub={`${(summary?.matched ?? 0).toLocaleString()} matched · ${(summary?.manualReview ?? 0).toLocaleString()} awaiting approval`}
          icon={CheckCircle2}
          tone="text-live-ink"
          active={filters.outcome === 'ACCEPTED'}
          onClick={() => toggleOutcome('ACCEPTED')}
        />
        <SummaryTile
          label="Not accepted"
          value={(summary?.notAccepted ?? 0).toLocaleString()}
          sub={`${(summary?.unmatched ?? 0).toLocaleString()} unmatched · ${(summary?.errored ?? 0).toLocaleString()} rejected`}
          icon={XCircle}
          tone="text-dropped-ink"
          active={filters.outcome === 'NOT_ACCEPTED'}
          onClick={() => toggleOutcome('NOT_ACCEPTED')}
        />
        <SummaryTile
          label="Not sent"
          value={(summary?.notSent ?? 0).toLocaleString()}
          sub="Held, queued or failed validation"
          icon={Clock}
          tone="text-ringing-ink"
          active={filters.outcome === 'NOT_SENT'}
          onClick={() => toggleOutcome('NOT_SENT')}
        />
        <SummaryTile
          label="Acceptance rate"
          value={acceptanceRate}
          sub="Of the leads actually sent"
          icon={RefreshCw}
          tone="text-brand-ink"
        />
        <SummaryTile
          label="Accepted value"
          value={`$${Number(summary?.acceptedRevenue ?? 0).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`}
          sub="Price Ameriquote paid"
          icon={DollarSign}
          tone="text-live-ink"
        />
      </div>

      {/* Why the rest were not accepted */}
      {report && report.reasons.length > 0 && (
        <Panel>
          <PanelHeader>
            <PanelTitle>
              Why leads were not accepted — whole date range, most common first
            </PanelTitle>
          </PanelHeader>
          <div className="divide-y divide-rule">
            {report.reasons.slice(0, TOP_REASONS).map(reason => (
              <div
                key={`${reason.postStatus}-${reason.reason}`}
                className="flex items-start gap-3 px-5 py-3 min-[1440px]:px-6"
              >
                <span className={cn(PILL, 'tabular-nums', OUTCOME_STYLES[reason.outcome])}>
                  {reason.count.toLocaleString()}
                </span>
                <div className="min-w-0">
                  <div className="t-body text-ink">{reason.reason}</div>
                  <div className="t-meta mt-0.5 truncate text-ink-3">
                    {reason.postStatus} · e.g.{' '}
                    {reason.examples
                      .map(example => `${example.name} ${formatPhone(example.phone)}`)
                      .join(', ')}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {report.reasons.length > TOP_REASONS && (
            /* Without this the visible counts sum to less than the tiles and
               the arithmetic looks broken. Say what is not shown. */
            <div className="t-meta border-t border-rule px-5 py-3 text-ink-3 min-[1440px]:px-6">
              +{report.reasons.length - TOP_REASONS} more{' '}
              {report.reasons.length - TOP_REASONS === 1 ? 'reason' : 'reasons'} covering{' '}
              {report.reasons
                .slice(TOP_REASONS)
                .reduce((sum, r) => sum + r.count, 0)
                .toLocaleString()}{' '}
              more leads — all of them are in the CSV export.
            </div>
          )}
        </Panel>
      )}

      {/* Per-lead detail */}
      <Panel className="min-w-0 overflow-hidden">
        <PanelBody flush className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="sticky top-0 bg-sunken [&_th]:h-10 [&_th]:whitespace-nowrap [&_th]:px-3 [&_th]:py-0 [&_th]:align-middle [&_th]:t-label [&_th]:text-ink-3">
              <tr className="border-b border-rule">
                <th>Outcome</th>
                <th>Lead</th>
                <th>Phone</th>
                <th>Vertical</th>
                <th>Sent</th>
                <th>Ameriquote ID</th>
                <th>Price</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule [&_td]:px-3 [&_td]:py-2.5">
              {loading && (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-ink-3">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                  </td>
                </tr>
              )}
              {!loading && report && report.rows.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      variant="filtered"
                      headline="No delivery attempts match these filters."
                    />
                  </td>
                </tr>
              )}
              {!loading &&
                report?.rows.map(row => (
                  <tr
                    key={row.submissionId}
                    className="h-11 transition-colors duration-150 ease-out hover:bg-sunken"
                  >
                    <td>
                      <span className={cn(PILL, OUTCOME_STYLES[row.outcome])}>
                        {row.outcomeLabel}
                      </span>
                    </td>
                    <td>
                      <div className="font-medium text-ink">{row.leadName}</div>
                      <div className="t-meta text-ink-3">{row.listName || row.source || '—'}</div>
                    </td>
                    <td className="t-data whitespace-nowrap text-ink-2">
                      {formatPhone(row.phone)}
                    </td>
                    <td className="whitespace-nowrap text-ink-2">
                      {row.vertical}
                      <span className="t-label ml-1.5 text-ink-3">{row.postMode}</span>
                    </td>
                    <td className="t-data whitespace-nowrap text-ink-2">
                      {formatDateTime(row.sentAt ?? row.receivedAt)}
                    </td>
                    <td className="t-data whitespace-nowrap text-ink-2">
                      {row.ameriquoteLeadId || '—'}
                    </td>
                    <td className="whitespace-nowrap font-medium tabular-nums text-money-ink">
                      {row.ameriquotePrice ? `$${row.ameriquotePrice}` : '—'}
                    </td>
                    <td className="max-w-md text-ink-2">{row.reason}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </PanelBody>
      </Panel>

      {/* Pagination */}
      {report && totalPages > 1 && (
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Next
            </Button>
          </div>
          <div className="t-meta tabular-nums text-ink-3">
            Page {page} of {totalPages} · {report.meta.total.toLocaleString()} delivery attempts ·
            the export covers all of them
          </div>
        </div>
      )}
    </div>
  );
}
