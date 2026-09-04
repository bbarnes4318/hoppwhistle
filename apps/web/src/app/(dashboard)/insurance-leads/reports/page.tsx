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
  AlertTriangle,
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

import { Button } from '@/components/ui/button';
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
  ACCEPTED: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  NOT_ACCEPTED: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  NOT_SENT: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
};

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
        'rounded-lg border bg-card p-3 text-left transition-colors',
        active ? 'border-emerald-500/40 ring-1 ring-emerald-500/20' : 'border-border/40',
        onClick && 'hover:border-border cursor-pointer'
      )}
    >
      <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        <Icon className={cn('h-3.5 w-3.5', tone)} />
      </div>
      <div className={cn('mt-1 text-xl font-bold', tone)}>{value}</div>
      <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>
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
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/insurance-leads"
            className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to CRM
          </Link>
          <h1 className="text-xl font-semibold text-foreground">CRM Reports</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Every lead sent to Ameriquote — what they accepted, what they refused, and why.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 border-border/40"
            onClick={() => void loadReport()}
            disabled={loading}
            title="Refresh"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
          <Button
            onClick={() => void handleExport()}
            disabled={exporting}
            className="flex items-center gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            {exporting ? 'Building CSV…' : 'Export CSV'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col gap-2.5 rounded-lg border border-border/40 bg-card p-2.5 md:flex-row md:flex-wrap md:items-center">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase text-muted-foreground">From</span>
          <input
            type="date"
            value={filters.startDate}
            onChange={e => {
              setFilter('startDate', e.target.value);
              setDatePreset('custom');
            }}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
          />
          <span className="text-[10px] font-semibold uppercase text-muted-foreground">To</span>
          <input
            type="date"
            value={filters.endDate}
            onChange={e => {
              setFilter('endDate', e.target.value);
              setDatePreset('custom');
            }}
            className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
          />
        </div>

        <div className="flex rounded border border-border/40 bg-muted/40 p-0.5">
          {DATE_PRESETS.map(preset => (
            <button
              key={preset.key}
              type="button"
              onClick={() => applyPreset(preset)}
              className={cn(
                'rounded px-2 py-1 text-[10px] font-semibold transition-colors',
                datePreset === preset.key
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <select
          value={filters.outcome}
          onChange={e => setFilter('outcome', e.target.value)}
          className="h-8 cursor-pointer rounded-md border border-border bg-card px-2 text-xs text-foreground"
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
          className="h-8 cursor-pointer rounded-md border border-border bg-card px-2 text-xs text-foreground"
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
          className="h-8 cursor-pointer rounded-md border border-border bg-card px-2 text-xs text-foreground"
          aria-label="Mode"
        >
          <option value="">Test + Live</option>
          <option value="LIVE">Live only</option>
          <option value="TEST">Test only</option>
        </select>

        <select
          value={filters.listId}
          onChange={e => setFilter('listId', e.target.value)}
          className="h-8 cursor-pointer rounded-md border border-border bg-card px-2 text-xs text-foreground"
          aria-label="Lead list"
        >
          <option value="">All lead lists</option>
          {leadLists.map(list => (
            <option key={list.id} value={list.id}>
              {list.name}
            </option>
          ))}
        </select>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Name, phone, email, zip…"
            value={filters.search}
            onChange={e => setFilter('search', e.target.value)}
            className="h-8 w-52 rounded-md border border-border bg-card pl-8 pr-2 text-xs text-foreground placeholder-slate-600"
          />
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
        <SummaryTile
          label="Accepted"
          value={(summary?.accepted ?? 0).toLocaleString()}
          sub={`${(summary?.matched ?? 0).toLocaleString()} matched · ${(summary?.manualReview ?? 0).toLocaleString()} awaiting approval`}
          icon={CheckCircle2}
          tone="text-emerald-400"
          active={filters.outcome === 'ACCEPTED'}
          onClick={() => toggleOutcome('ACCEPTED')}
        />
        <SummaryTile
          label="Not accepted"
          value={(summary?.notAccepted ?? 0).toLocaleString()}
          sub={`${(summary?.unmatched ?? 0).toLocaleString()} unmatched · ${(summary?.errored ?? 0).toLocaleString()} rejected`}
          icon={XCircle}
          tone="text-rose-400"
          active={filters.outcome === 'NOT_ACCEPTED'}
          onClick={() => toggleOutcome('NOT_ACCEPTED')}
        />
        <SummaryTile
          label="Not sent"
          value={(summary?.notSent ?? 0).toLocaleString()}
          sub="Held, queued or failed validation"
          icon={Clock}
          tone="text-amber-400"
          active={filters.outcome === 'NOT_SENT'}
          onClick={() => toggleOutcome('NOT_SENT')}
        />
        <SummaryTile
          label="Acceptance rate"
          value={acceptanceRate}
          sub="Of the leads actually sent"
          icon={RefreshCw}
          tone="text-cyan-400"
        />
        <SummaryTile
          label="Accepted value"
          value={`$${Number(summary?.acceptedRevenue ?? 0).toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`}
          sub="Price Ameriquote paid"
          icon={DollarSign}
          tone="text-emerald-400"
        />
      </div>

      {/* Why the rest were not accepted */}
      {report && report.reasons.length > 0 && (
        <div className="rounded-lg border border-border/40 bg-card">
          <div className="border-b border-border/20 px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Why leads were not accepted — whole date range, most common first
          </div>
          <div className="divide-y divide-border/20">
            {report.reasons.slice(0, TOP_REASONS).map(reason => (
              <div
                key={`${reason.postStatus}-${reason.reason}`}
                className="flex items-start gap-3 px-3 py-2"
              >
                <span
                  className={cn(
                    'mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold',
                    OUTCOME_STYLES[reason.outcome]
                  )}
                >
                  {reason.count.toLocaleString()}
                </span>
                <div className="min-w-0">
                  <div className="text-xs text-foreground">{reason.reason}</div>
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
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
            <div className="border-t border-border/20 px-3 py-2 text-[11px] text-muted-foreground">
              +{report.reasons.length - TOP_REASONS} more{' '}
              {report.reasons.length - TOP_REASONS === 1 ? 'reason' : 'reasons'} covering{' '}
              {report.reasons
                .slice(TOP_REASONS)
                .reduce((sum, r) => sum + r.count, 0)
                .toLocaleString()}{' '}
              more leads — all of them are in the CSV export.
            </div>
          )}
        </div>
      )}

      {/* Per-lead detail */}
      <div className="overflow-x-auto rounded-lg border border-border/40 bg-card">
        <table className="w-full min-w-[1100px] text-left text-xs">
          <thead className="border-b border-border/20 text-[10px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-semibold">Outcome</th>
              <th className="px-3 py-2 font-semibold">Lead</th>
              <th className="px-3 py-2 font-semibold">Phone</th>
              <th className="px-3 py-2 font-semibold">Vertical</th>
              <th className="px-3 py-2 font-semibold">Sent</th>
              <th className="px-3 py-2 font-semibold">Ameriquote ID</th>
              <th className="px-3 py-2 font-semibold">Price</th>
              <th className="px-3 py-2 font-semibold">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/10">
            {loading && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            )}
            {!loading && report && report.rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                  No delivery attempts match these filters.
                </td>
              </tr>
            )}
            {!loading &&
              report?.rows.map(row => (
                <tr key={row.submissionId} className="hover:bg-muted/30">
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        'whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] font-semibold',
                        OUTCOME_STYLES[row.outcome]
                      )}
                    >
                      {row.outcomeLabel}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-foreground">{row.leadName}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {row.listName || row.source || '—'}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    {formatPhone(row.phone)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {row.vertical}
                    <span className="ml-1 text-[10px] uppercase text-muted-foreground/70">
                      {row.postMode}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    {formatDateTime(row.sentAt ?? row.receivedAt)}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{row.ameriquoteLeadId || '—'}</td>
                  <td className="px-3 py-2 text-emerald-400">
                    {row.ameriquotePrice ? `$${row.ameriquotePrice}` : '—'}
                  </td>
                  <td className="max-w-md px-3 py-2 text-muted-foreground">{row.reason}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {report && totalPages > 1 && (
        <div className="flex flex-col items-center gap-2 py-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-md border border-border bg-card px-3 py-1 text-xs text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-30"
            >
              Prev
            </button>
            <button
              type="button"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-md border border-border bg-card px-3 py-1 text-xs text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-30"
            >
              Next
            </button>
          </div>
          <div className="text-xs text-muted-foreground">
            Page {page} of {totalPages} · {report.meta.total.toLocaleString()} delivery attempts ·
            the export covers all of them
          </div>
        </div>
      )}
    </div>
  );
}
