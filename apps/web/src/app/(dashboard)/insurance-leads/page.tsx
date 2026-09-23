/* eslint-disable */
'use client';

import {
  Activity,
  BarChart3,
  CheckCircle2,
  Download,
  Loader2,
  Plus,
  Radio,
  Search,
  TestTube,
  Trash2,
  Upload,
  X,
  XCircle,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { EmptyState, Panel, PanelBody, StatTile } from '@/components/domain';
import { PageHeader } from '@/components/layout/page-header';
import { CsvImportDialog } from '@/components/leads/csv-import-dialog';
import { LeadDetailSheet } from '@/components/leads/lead-detail-sheet';
import { LeadsTable } from '@/components/leads/leads-table';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import {
  fetchInsuranceLeads,
  fetchInsuranceLead,
  fetchInsuranceLeadStats,
  deleteInsuranceLeads,
  deleteLeadList,
  exportInsuranceLeadsCsv,
} from '@/lib/api/leads';
import type {
  InsuranceLeadSummary,
  InsuranceLeadStats,
  InsuranceLeadDetail,
} from '@/lib/api/leads';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Filter Bar
// ---------------------------------------------------------------------------

interface Filters {
  vertical: string;
  validationStatus: string;
  postStatus: string;
  postMode: string;
  search: string;
  status: string;
  followUp: string;
  listId: string;
}

const EMPTY_FILTERS: Filters = {
  vertical: '',
  validationStatus: '',
  postStatus: '',
  postMode: '',
  search: '',
  status: '',
  followUp: '',
  listId: '',
};

const SELECT =
  'h-9 w-full min-w-0 cursor-pointer rounded-control border border-rule bg-surface px-3 text-sm text-ink ' +
  'outline-none transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring';

function FilterPill({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={SELECT}
      aria-label={label}
    >
      <option value="">{label}</option>
      {options.map(o => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function InsuranceLeadsPage() {
  // State
  const [leads, setLeads] = useState<InsuranceLeadSummary[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  const [stats, setStats] = useState<InsuranceLeadStats | null>(null);
  const [totalLeads, setTotalLeads] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [leadLists, setLeadLists] = useState<any[]>([]);
  const [exporting, setExporting] = useState(false);

  // Detail sheet
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  const [selectedLead, setSelectedLead] = useState<InsuranceLeadDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Active filters count
  const activeFilterCount = Object.values(filters).filter(v => v && v !== '').length;

  // Fetch leads
  const loadLeads = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchInsuranceLeads({
        page,
        limit: 25,
        vertical: filters.vertical || undefined,
        validationStatus: filters.validationStatus || undefined,
        postStatus: filters.postStatus || undefined,
        postMode: filters.postMode || undefined,
        search: filters.search || undefined,
        status: filters.status || undefined,
        followUp: filters.followUp || undefined,
        listId: filters.listId || undefined,
      });
      setLeads(result.data);
      setTotalLeads(result.meta.total);
      setTotalPages(result.meta.totalPages);
    } catch {
      // Silent fail — empty state will show
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  // Fetch stats
  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const result = await fetchInsuranceLeadStats();
      setStats(result);
    } catch {
      // Silent fail
    } finally {
      setStatsLoading(false);
    }
  }, []);

  // Fetch lead lists
  const loadLists = useCallback(async () => {
    try {
      const response = await apiClient.get<any[]>('/api/v1/lead-lists');
      if (!response.error && response.data) {
        setLeadLists(response.data);
      }
    } catch {
      // Silent fail
    }
  }, []);

  // Fetch lead detail
  const loadLeadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const result = await fetchInsuranceLead(id);
      setSelectedLead(result);
    } catch {
      setSelectedLead(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    void loadLeads();
    void loadStats();
    void loadLists();
  }, [loadLeads, loadStats, loadLists]);

  // Load detail when selected
  useEffect(() => {
    if (selectedLeadId) {
      void loadLeadDetail(selectedLeadId);
    } else {
      setSelectedLead(null);
    }
  }, [selectedLeadId, loadLeadDetail]);

  const handleDeleteList = async () => {
    if (!filters.listId) return;
    const selectedList = leadLists.find(l => l.id === filters.listId);
    if (!selectedList) return;

    const confirmMsg = `Are you sure you want to delete the lead list "${selectedList.name}" and all leads in it? This action cannot be undone.`;
    if (!window.confirm(confirmMsg)) return;

    try {
      await deleteLeadList(filters.listId);
      handleFilterChange('listId', '');
      void loadLists();
      void loadLeads();
      void loadStats();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete lead list');
    }
  };

  // Handlers
  const handleFilterChange = (key: keyof Filters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const handleClearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };

  const handleSelectLead = (id: string) => {
    setSelectedLeadId(id);
  };

  const handleCloseDetail = () => {
    setSelectedLeadId(null);
  };

  const handleRefresh = () => {
    void loadLeads();
    void loadStats();
    if (selectedLeadId) void loadLeadDetail(selectedLeadId);
  };

  /**
   * Exports what the filters currently describe, not the 25 rows on screen —
   * a paged export is the one thing nobody wants from an export button.
   */
  const handleExportCsv = async () => {
    setExporting(true);
    try {
      await exportInsuranceLeadsCsv({
        vertical: filters.vertical || undefined,
        validationStatus: filters.validationStatus || undefined,
        postStatus: filters.postStatus || undefined,
        postMode: filters.postMode || undefined,
        search: filters.search || undefined,
        status: filters.status || undefined,
        followUp: filters.followUp || undefined,
        listId: filters.listId || undefined,
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to export leads');
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedLeadIds.length === 0) return;
    const confirmMsg = `Are you sure you want to delete ${selectedLeadIds.length} selected lead${
      selectedLeadIds.length > 1 ? 's' : ''
    }? This action cannot be undone.`;
    if (!window.confirm(confirmMsg)) return;

    try {
      await deleteInsuranceLeads(selectedLeadIds);
      setSelectedLeadIds([]);
      handleRefresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete leads');
    }
  };

  return (
    <div className="page-canvas">
      <PageHeader
        description="Manage inbound ACA, FE Customers, and B2B leads"
        actions={
          <>
            {selectedLeadIds.length > 0 && (
              <Button
                variant="destructive"
                onClick={handleDeleteSelected}
                className="gap-1.5"
              >
                <Trash2 className="h-4 w-4" />
                Delete Selected ({selectedLeadIds.length})
              </Button>
            )}
            <Button
              asChild
              variant="outline"
              className="gap-1.5"
            >
              <Link href="/insurance-leads/reports">
                <BarChart3 className="h-4 w-4" />
                Reports
              </Link>
            </Button>
            <Button
              variant="outline"
              onClick={handleExportCsv}
              disabled={exporting || loading}
              className="gap-1.5"
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {exporting ? 'Exporting…' : 'Export CSV'}
            </Button>
            <Button
              variant="outline"
              onClick={() => setIsImportOpen(true)}
              className="gap-1.5"
            >
              <Upload className="h-4 w-4" />
              Import CSV
            </Button>
            <Button
              asChild
              className="gap-1.5"
            >
              <Link href="/intake">
                <Plus className="h-4 w-4" />
                Add Customer
              </Link>
            </Button>
          </>
        }
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="Total Leads"
          value={stats?.totalLeads ?? 0}
          sub={`${stats?.acaLeads ?? 0} ACA · ${stats?.feLeads ?? 0} FE`}
          icon={Activity}
          loading={statsLoading}
        />
        <StatTile
          label="Valid"
          value={stats?.validSubmissions ?? 0}
          sub={`of ${stats?.totalSubmissions ?? 0} submissions`}
          icon={CheckCircle2}
          loading={statsLoading}
        />
        <StatTile
          label="Invalid"
          value={stats?.invalidSubmissions ?? 0}
          sub="validation failures"
          icon={XCircle}
          loading={statsLoading}
        />
        <StatTile
          label="Matched"
          value={stats?.matchedSubmissions ?? 0}
          sub={`${stats?.unmatchedSubmissions ?? 0} unmatched · ${stats?.errorSubmissions ?? 0} errors`}
          icon={Zap}
          loading={statsLoading}
        />
        <StatTile
          label="Test"
          value={stats?.testSubmissions ?? 0}
          sub="test mode submissions"
          icon={TestTube}
          loading={statsLoading}
        />
        <StatTile
          label="Live"
          value={stats?.liveSubmissions ?? 0}
          sub="live mode submissions"
          icon={Radio}
          loading={statsLoading}
        />
      </div>

      {/* Vertical Tabs */}
      <div className="flex items-end gap-6 overflow-x-auto border-b border-rule">
        {[
          { value: '', label: 'All' },
          { value: 'ACA', label: 'ACA' },
          { value: 'FE', label: 'FE Customers' },
          { value: 'B2B', label: 'B2B' },
        ].map(tab => (
          <button
            key={tab.value}
            type="button"
            onClick={() => handleFilterChange('vertical', tab.value)}
            className={cn(
              '-mb-px inline-flex h-10 shrink-0 items-center whitespace-nowrap border-b-2 px-0.5 text-sm font-medium transition-colors duration-150 ease-out',
              '[@media(pointer:coarse)]:min-h-[44px]',
              filters.vertical === tab.value
                ? 'border-brand text-ink'
                : 'border-transparent text-ink-2 hover:text-ink'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search + Filters */}
      <Panel>
        <PanelBody>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {/* Search */}
            <div className="relative min-w-0">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
              <input
                type="text"
                placeholder="Search name, phone, email, zip…"
                value={filters.search}
                onChange={e => handleFilterChange('search', e.target.value)}
                className="h-9 w-full rounded-control border border-rule bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-ink-3 outline-none transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>

            {/* Filter Dropdowns */}
            <FilterPill
              label="Stage"
              value={filters.status}
              options={[
                { value: 'NEW', label: 'New' },
                { value: 'CONTACTED', label: 'Contacted' },
                { value: 'QUALIFIED', label: 'Qualified' },
                { value: 'CONVERTED', label: 'Converted' },
                { value: 'LOST', label: 'Lost' },
              ]}
              onChange={v => handleFilterChange('status', v)}
            />
            <FilterPill
              label="Follow Up"
              value={filters.followUp}
              options={[
                { value: 'OVERDUE', label: 'Overdue' },
                { value: 'TODAY', label: 'Today' },
                { value: 'TOMORROW', label: 'Tomorrow' },
                { value: 'UPCOMING', label: 'Upcoming' },
                { value: 'NONE', label: 'No Follow-up' },
              ]}
              onChange={v => handleFilterChange('followUp', v)}
            />

            <div className="flex min-w-0 items-center gap-2">
              <select
                value={filters.listId}
                onChange={e => handleFilterChange('listId', e.target.value)}
                className={SELECT}
                aria-label="Lead List"
              >
                <option value="">All Lead Lists</option>
                {leadLists.map(list => (
                  <option key={list.id} value={list.id}>
                    {list.name} ({list._count?.leads ?? 0})
                  </option>
                ))}
              </select>
              {filters.listId && (
                <Tooltip content="Delete Selected Lead List" align="end">
                  <button
                    onClick={handleDeleteList}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-dropped-ink transition-colors duration-150 ease-out hover:bg-dropped-tint"
                    title="Delete Selected Lead List"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </Tooltip>
              )}
            </div>
          </div>

          {/* Clear Filters */}
          {activeFilterCount > 0 && (
            <div className="mt-3 flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearFilters}
                className="gap-1"
              >
                <X className="h-3.5 w-3.5" />
                Clear ({activeFilterCount})
              </Button>
            </div>
          )}
        </PanelBody>
      </Panel>

      {/* Table */}
      {!loading && leads.length === 0 ? (
        <Panel>
          <EmptyState
            headline="No leads found"
            body="Leads will appear here when they are received via the ingestion API."
          />
        </Panel>
      ) : (
        <div className="min-w-0 [&>div]:shadow-card">
          <LeadsTable
            leads={leads}
            loading={loading}
            onSelectLead={handleSelectLead}
            selectedLeadIds={selectedLeadIds}
            onSelectLeadsChange={setSelectedLeadIds}
          />
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex flex-col items-center justify-center gap-2">
          <div className="flex items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Next
            </Button>
          </div>
          <div className="t-meta tabular-nums text-ink-3">
            Page {page} of {totalPages} · {totalLeads.toLocaleString()} leads
          </div>
        </div>
      )}

      {/* Detail Sheet */}
      {selectedLeadId && (
        <LeadDetailSheet
          lead={selectedLead}
          loading={detailLoading}
          onClose={handleCloseDetail}
          onRefresh={handleRefresh}
        />
      )}

      {/* Import CSV Dialog */}
      {isImportOpen && (
        <CsvImportDialog onClose={() => setIsImportOpen(false)} onSuccess={handleRefresh} />
      )}
    </div>
  );
}
