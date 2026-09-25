'use client';

import {
  CalendarClock,
  DollarSign,
  Download,
  FileCheck2,
  Loader2,
  PhoneCall,
  Plus,
  Trash2,
  Upload,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  EmptyState,
  MoneyCell,
  Pagination,
  Panel,
  Segmented,
  SegmentedItem,
  StatTile,
  Toolbar,
  ToolbarActions,
  ToolbarClear,
  ToolbarMeta,
  ToolbarSearch,
  ToolbarSelect,
} from '@/components/domain';
import { PageHeader } from '@/components/layout/page-header';
import { CsvImportDialog } from '@/components/leads/csv-import-dialog';
import { LeadDetailSheet } from '@/components/leads/lead-detail-sheet';
import { LeadsTable } from '@/components/leads/leads-table';
import { usePhone } from '@/components/phone';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { apiClient } from '@/lib/api';
import {
  deleteInsuranceLeads,
  deleteLeadList,
  exportInsuranceLeadsCsv,
  fetchCrmPipeline,
  fetchInsuranceLead,
  fetchInsuranceLeads,
  fetchSubmittedApps,
} from '@/lib/api/leads';
import type {
  CrmPipelineSummary,
  InsuranceLeadDetail,
  InsuranceLeadSummary,
  SubmittedAppRow,
} from '@/lib/api/leads';
import { formatPhoneNumber } from '@/lib/utils';

/**
 * The agency CRM.
 *
 * Two lists, because an agency asks two questions of its book: who is still a
 * prospect, and which prospects became submitted applications -- and what
 * those applications are worth in annual premium. A lead moves from the first
 * list to the second the moment a submitted application is tied to it, by its
 * lead id or by the applicant's phone number (see apps/api/src/services/
 * crm-pipeline.ts). Nothing here is split by lead source or vertical: every
 * agency sees one book.
 */

type View = 'prospects' | 'submitted';
type Period = 'all' | 'today' | 'week' | 'month' | 'last-month' | 'year';

const PAGE_SIZE = 25;

const STAGE_OPTIONS = [
  { value: 'NEW', label: 'New' },
  { value: 'CONTACTED', label: 'Contacted' },
  { value: 'PROPOSAL', label: 'Proposal' },
  { value: 'UNDERWRITING', label: 'Underwriting' },
  { value: 'HOLD', label: 'Hold' },
  { value: 'CLOSED_LOST', label: 'Closed Lost' },
];

const FOLLOW_UP_OPTIONS = [
  { value: 'DUE', label: 'Due today or overdue' },
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'TODAY', label: 'Due today' },
  { value: 'TOMORROW', label: 'Due tomorrow' },
  { value: 'UPCOMING', label: 'Upcoming' },
  { value: 'NONE', label: 'No follow-up set' },
];

const PERIOD_OPTIONS: Array<{ value: Period; label: string }> = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'year', label: 'This year' },
];

/** A local calendar day as YYYY-MM-DD. */
function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Both ends inclusive; undefined for all time. */
function periodRange(period: Period): { from?: string; to?: string } {
  const now = new Date();
  switch (period) {
    case 'today':
      return { from: dayKey(now), to: dayKey(now) };
    case 'week': {
      const start = new Date(now);
      start.setDate(now.getDate() - 6);
      return { from: dayKey(start), to: dayKey(now) };
    }
    case 'month':
      return { from: dayKey(new Date(now.getFullYear(), now.getMonth(), 1)), to: dayKey(now) };
    case 'last-month':
      return {
        from: dayKey(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        to: dayKey(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    case 'year':
      return { from: dayKey(new Date(now.getFullYear(), 0, 1)), to: dayKey(now) };
    default:
      return {};
  }
}

function formatDay(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

interface ProspectFilters {
  search: string;
  leadStage: string;
  followUp: string;
  listId: string;
}

const EMPTY_PROSPECT_FILTERS: ProspectFilters = {
  search: '',
  leadStage: 'all',
  followUp: 'all',
  listId: 'all',
};

/** `all` is the toolbar's "no filter"; the API wants nothing at all. */
const set = (v: string) => (v && v !== 'all' ? v : undefined);

interface LeadList {
  id: string;
  name: string;
  _count?: { leads: number };
}

export default function CrmPage() {
  const { makeCall } = usePhone();
  const router = useRouter();

  const [view, setView] = useState<View>('prospects');
  const [period, setPeriod] = useState<Period>('all');
  const range = useMemo(() => periodRange(period), [period]);

  // Headline figures
  const [summary, setSummary] = useState<CrmPipelineSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  // Prospects
  const [prospects, setProspects] = useState<InsuranceLeadSummary[]>([]);
  const [prospectTotal, setProspectTotal] = useState(0);
  const [prospectPage, setProspectPage] = useState(1);
  const [prospectsLoading, setProspectsLoading] = useState(true);
  const [filters, setFilters] = useState<ProspectFilters>(EMPTY_PROSPECT_FILTERS);
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [leadLists, setLeadLists] = useState<LeadList[]>([]);

  // Submitted apps
  const [apps, setApps] = useState<SubmittedAppRow[]>([]);
  const [appTotal, setAppTotal] = useState(0);
  const [appPage, setAppPage] = useState(1);
  const [appsLoading, setAppsLoading] = useState(true);
  const [appSearch, setAppSearch] = useState('');

  // Chrome
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<InsuranceLeadDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const prospectQuery = useMemo(
    () => ({
      search: filters.search || undefined,
      leadStage: set(filters.leadStage),
      followUp: set(filters.followUp),
      listId: set(filters.listId),
      pipeline: 'prospects' as const,
    }),
    [filters]
  );

  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      setSummary(await fetchCrmPipeline(range));
    } catch {
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  }, [range]);

  const loadProspects = useCallback(async () => {
    setProspectsLoading(true);
    try {
      const result = await fetchInsuranceLeads({
        ...prospectQuery,
        page: prospectPage,
        limit: PAGE_SIZE,
      });
      setProspects(result?.data ?? []);
      setProspectTotal(result?.meta?.total ?? 0);
    } catch {
      setProspects([]);
      setProspectTotal(0);
    } finally {
      setProspectsLoading(false);
    }
  }, [prospectQuery, prospectPage]);

  const loadApps = useCallback(async () => {
    setAppsLoading(true);
    try {
      const result = await fetchSubmittedApps({
        ...range,
        search: appSearch || undefined,
        page: appPage,
        limit: PAGE_SIZE,
      });
      setApps(result?.data ?? []);
      setAppTotal(result?.meta?.total ?? 0);
    } catch {
      setApps([]);
      setAppTotal(0);
    } finally {
      setAppsLoading(false);
    }
  }, [range, appSearch, appPage]);

  const loadLists = useCallback(async () => {
    const response = await apiClient.get<LeadList[]>('/api/v1/lead-lists').catch(() => null);
    if (response && !response.error && Array.isArray(response.data)) setLeadLists(response.data);
  }, []);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    void loadProspects();
  }, [loadProspects]);

  useEffect(() => {
    void loadApps();
  }, [loadApps]);

  useEffect(() => {
    void loadLists();
  }, [loadLists]);

  useEffect(() => {
    if (!selectedLeadId) {
      setSelectedLead(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    fetchInsuranceLead(selectedLeadId)
      .then(lead => !cancelled && setSelectedLead(lead))
      .catch(() => !cancelled && setSelectedLead(null))
      .finally(() => !cancelled && setDetailLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selectedLeadId]);

  const refreshAll = () => {
    void loadSummary();
    void loadProspects();
    void loadApps();
    void loadLists();
    if (selectedLeadId) {
      void fetchInsuranceLead(selectedLeadId)
        .then(setSelectedLead)
        .catch(() => undefined);
    }
  };

  const setFilter = (key: keyof ProspectFilters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setProspectPage(1);
  };

  const activeFilterCount =
    (filters.search ? 1 : 0) +
    (['leadStage', 'followUp', 'listId'] as const).filter(k => filters[k] !== 'all').length;

  const clearFilters = () => {
    setFilters(EMPTY_PROSPECT_FILTERS);
    setProspectPage(1);
  };

  const handleDeleteList = async () => {
    const list = leadLists.find(l => l.id === filters.listId);
    if (!list) return;
    if (
      !window.confirm(
        `Delete the list "${list.name}" and every prospect in it? This cannot be undone.`
      )
    )
      return;
    try {
      await deleteLeadList(list.id);
      setFilter('listId', 'all');
      refreshAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete the list');
    }
  };

  const handleDeleteSelected = async () => {
    const n = selectedLeadIds.length;
    if (n === 0) return;
    if (!window.confirm(`Delete ${n} prospect${n > 1 ? 's' : ''}? This cannot be undone.`)) return;
    try {
      await deleteInsuranceLeads(selectedLeadIds);
      setSelectedLeadIds([]);
      refreshAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete prospects');
    }
  };

  /** Exports the prospects the filters describe, not just the page on screen. */
  const handleExport = async () => {
    setExporting(true);
    try {
      await exportInsuranceLeadsCsv(prospectQuery);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to export');
    } finally {
      setExporting(false);
    }
  };

  const periodLabel = PERIOD_OPTIONS.find(p => p.value === period)?.label.toLowerCase() ?? '';

  return (
    <div className="page-canvas">
      <PageHeader
        actions={
          <>
            {view === 'prospects' && selectedLeadIds.length > 0 && (
              <Button
                variant="destructive"
                onClick={() => void handleDeleteSelected()}
                className="gap-1.5"
              >
                <Trash2 className="h-4 w-4" />
                Delete ({selectedLeadIds.length})
              </Button>
            )}
            {view === 'prospects' && (
              <Button
                variant="outline"
                onClick={() => void handleExport()}
                disabled={exporting || prospectsLoading}
                className="gap-1.5"
              >
                {exporting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {exporting ? 'Exporting…' : 'Export'}
              </Button>
            )}
            <Button variant="outline" onClick={() => setIsImportOpen(true)} className="gap-1.5">
              <Upload className="h-4 w-4" />
              Import
            </Button>
            <Button asChild className="gap-1.5">
              <Link href="/intake">
                <Plus className="h-4 w-4" />
                Add Prospect
              </Link>
            </Button>
          </>
        }
      />

      {/* The pipeline at a glance. The tiles double as the way between views. */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <button
          type="button"
          onClick={() => setView('prospects')}
          className="rounded-card text-left transition-shadow hover:shadow-raised"
          aria-pressed={view === 'prospects'}
        >
          <StatTile
            label="Prospects"
            value={summary?.prospects ?? 0}
            sub="not yet submitted"
            icon={Users}
            loading={summaryLoading}
            className={view === 'prospects' ? 'ring-2 ring-brand-ink' : undefined}
          />
        </button>
        <button
          type="button"
          onClick={() => {
            setView('prospects');
            setFilter('followUp', 'DUE');
          }}
          className="rounded-card text-left transition-shadow hover:shadow-raised"
        >
          <StatTile
            label="Follow-ups Due"
            value={summary?.followUpsDue ?? 0}
            sub="today or overdue"
            icon={CalendarClock}
            loading={summaryLoading}
          />
        </button>
        <button
          type="button"
          onClick={() => setView('submitted')}
          className="rounded-card text-left transition-shadow hover:shadow-raised"
          aria-pressed={view === 'submitted'}
        >
          <StatTile
            label="Submitted Apps"
            value={summary?.submittedApps ?? 0}
            sub={periodLabel}
            icon={FileCheck2}
            loading={summaryLoading}
            className={view === 'submitted' ? 'ring-2 ring-brand-ink' : undefined}
          />
        </button>
        <button
          type="button"
          onClick={() => setView('submitted')}
          className="rounded-card text-left transition-shadow hover:shadow-raised"
        >
          <StatTile
            label="Annual Premium"
            figure={<MoneyCell amount={summary?.annualPremium ?? 0} unit="major" size="figure" />}
            sub={
              summary?.averageAnnualPremium != null ? (
                <>
                  <MoneyCell amount={summary.averageAnnualPremium} unit="major" tone="none" /> avg
                  per app
                </>
              ) : (
                periodLabel
              )
            }
            icon={DollarSign}
            tone="money"
            loading={summaryLoading}
          />
        </button>
      </div>

      <Segmented aria-label="CRM view">
        <SegmentedItem active={view === 'prospects'} onClick={() => setView('prospects')}>
          Prospects
          <span className="t-num text-ink-3">{summary?.prospects ?? ''}</span>
        </SegmentedItem>
        <SegmentedItem active={view === 'submitted'} onClick={() => setView('submitted')}>
          Submitted Apps
          <span className="t-num text-ink-3">{summary?.submittedApps ?? ''}</span>
        </SegmentedItem>
      </Segmented>

      {view === 'prospects' ? (
        <>
          <Toolbar>
            <ToolbarSearch
              value={filters.search}
              onChange={v => setFilter('search', v)}
              placeholder="Search name, phone, email, ZIP…"
            />
            <ToolbarSelect
              label="Stage"
              value={filters.leadStage}
              onChange={v => setFilter('leadStage', v)}
              options={STAGE_OPTIONS}
              allLabel="Any stage"
            />
            <ToolbarSelect
              label="Follow-up"
              value={filters.followUp}
              onChange={v => setFilter('followUp', v)}
              options={FOLLOW_UP_OPTIONS}
              allLabel="Any follow-up"
            />
            {leadLists.length > 0 && (
              <ToolbarSelect
                label="List"
                value={filters.listId}
                onChange={v => setFilter('listId', v)}
                options={leadLists.map(l => ({
                  value: l.id,
                  label: `${l.name} (${l._count?.leads ?? 0})`,
                }))}
                allLabel="All lists"
              />
            )}
            {filters.listId !== 'all' && (
              <Tooltip content="Delete this list and its prospects" align="end">
                <button
                  type="button"
                  onClick={() => void handleDeleteList()}
                  aria-label="Delete this list"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-dropped-ink transition-colors duration-150 ease-out hover:bg-dropped-tint"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </Tooltip>
            )}
            {activeFilterCount > 0 && <ToolbarClear onClick={clearFilters} />}
            <ToolbarActions>
              <ToolbarMeta className="tabular-nums">
                {prospectTotal.toLocaleString()} prospect{prospectTotal === 1 ? '' : 's'}
              </ToolbarMeta>
            </ToolbarActions>
          </Toolbar>

          <div className="min-w-0 [&>div]:shadow-card">
            <LeadsTable
              leads={prospects}
              loading={prospectsLoading}
              onSelectLead={setSelectedLeadId}
              selectedLeadIds={selectedLeadIds}
              onSelectLeadsChange={setSelectedLeadIds}
              filtered={activeFilterCount > 0}
              onClearFilters={clearFilters}
              onImport={() => setIsImportOpen(true)}
              onAddProspect={() => router.push('/intake')}
            />
          </div>

          {prospectTotal > PAGE_SIZE && (
            <Pagination
              page={prospectPage}
              pageSize={PAGE_SIZE}
              total={prospectTotal}
              onPageChange={setProspectPage}
              noun="prospects"
              disabled={prospectsLoading}
            />
          )}
        </>
      ) : (
        <>
          <Toolbar>
            <ToolbarSearch
              value={appSearch}
              onChange={v => {
                setAppSearch(v);
                setAppPage(1);
              }}
              placeholder="Search applicant, phone, carrier…"
            />
            <ToolbarSelect
              label="Submitted"
              value={period}
              onChange={v => {
                setPeriod(v as Period);
                setAppPage(1);
              }}
              options={PERIOD_OPTIONS}
              allValue={null}
            />
            <ToolbarActions>
              <ToolbarMeta className="tabular-nums">
                {(summary?.submittedApps ?? 0).toLocaleString()} app
                {summary?.submittedApps === 1 ? '' : 's'} ·{' '}
                <MoneyCell amount={summary?.annualPremium ?? 0} unit="major" tone="none" /> annual
                premium
              </ToolbarMeta>
            </ToolbarActions>
          </Toolbar>

          <Panel className="min-w-0 overflow-hidden">
            {appsLoading ? (
              <div className="p-8 text-center text-sm text-ink-3">
                <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
                Loading submitted apps…
              </div>
            ) : apps.length === 0 ? (
              <EmptyState
                headline="No submitted apps"
                body={
                  period === 'all'
                    ? 'When a prospect becomes a submitted application, it shows up here with its annual premium.'
                    : `No applications were submitted ${periodLabel}.`
                }
                icon={FileCheck2}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-rule bg-sunken">
                      {[
                        'Submitted',
                        'Applicant',
                        'Phone',
                        'State',
                        'Carrier · Product',
                        'Face Amount',
                        'Annual Premium',
                        'Agent',
                      ].map(h => (
                        <th
                          key={h}
                          className={`whitespace-nowrap px-4 py-3 text-xs font-medium uppercase tracking-wider text-ink-3 ${
                            h === 'Face Amount' || h === 'Annual Premium'
                              ? 'text-right'
                              : 'text-left'
                          }`}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule">
                    {apps.map(app => (
                      <tr
                        key={app.id}
                        onClick={app.leadId ? () => setSelectedLeadId(app.leadId) : undefined}
                        title={app.leadId ? 'Open prospect record' : undefined}
                        className={
                          app.leadId
                            ? 'cursor-pointer transition-colors hover:bg-sunken'
                            : 'transition-colors'
                        }
                      >
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-2">
                          {formatDay(app.submittedAt)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-medium text-ink">
                          {app.applicant}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-ink-2">
                          {app.phone ? (
                            <div className="flex items-center gap-2">
                              <span>{formatPhoneNumber(app.phone)}</span>
                              <button
                                type="button"
                                onClick={e => {
                                  e.stopPropagation();
                                  void makeCall(app.phone!);
                                }}
                                className="rounded bg-brand-tint p-1 text-brand-ink transition-all hover:opacity-80"
                                aria-label={`Dial ${app.phone}`}
                              >
                                <PhoneCall className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-2">
                          {app.state || '—'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-2">
                          {app.carrier}
                          {app.product ? (
                            <span className="text-ink-3"> · {app.product}</span>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-xs">
                          <MoneyCell amount={app.faceAmount} unit="major" tone="none" />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-medium">
                          <MoneyCell amount={app.annualPremium} unit="major" tone="money" />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-2">
                          {app.agentName || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {appTotal > PAGE_SIZE && (
            <Pagination
              page={appPage}
              pageSize={PAGE_SIZE}
              total={appTotal}
              onPageChange={setAppPage}
              noun="apps"
              disabled={appsLoading}
            />
          )}
        </>
      )}

      {selectedLeadId && (
        <LeadDetailSheet
          lead={selectedLead}
          loading={detailLoading}
          onClose={() => setSelectedLeadId(null)}
          onRefresh={refreshAll}
        />
      )}

      {isImportOpen && (
        <CsvImportDialog onClose={() => setIsImportOpen(false)} onSuccess={refreshAll} />
      )}
    </div>
  );
}
