/* eslint-disable */
'use client';

import { Search, X, Plus, Upload, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

import { LeadDetailSheet } from '@/components/leads/lead-detail-sheet';
import { LeadStatsCards } from '@/components/leads/lead-stats-cards';
import { LeadsTable } from '@/components/leads/leads-table';
import { CsvImportDialog } from '@/components/leads/csv-import-dialog';
import { fetchInsuranceLeads, fetchInsuranceLead, fetchInsuranceLeadStats, deleteInsuranceLeads } from '@/lib/api/leads';
import type {
  InsuranceLeadSummary,
  InsuranceLeadStats,
  InsuranceLeadDetail,
} from '@/lib/api/leads';

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
}

const EMPTY_FILTERS: Filters = {
  vertical: '',
  validationStatus: '',
  postStatus: '',
  postMode: '',
  search: '',
  status: '',
  followUp: '',
};

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
      className="rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground
 outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-colors
 appearance-none cursor-pointer"
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
  }, [loadLeads, loadStats]);

  // Load detail when selected
  useEffect(() => {
    if (selectedLeadId) {
      void loadLeadDetail(selectedLeadId);
    } else {
      setSelectedLead(null);
    }
  }, [selectedLeadId, loadLeadDetail]);

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
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Insurance Leads</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Manage inbound ACA and Final Expense leads · Ameriquote / Boberdoo integration
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedLeadIds.length > 0 && (
            <Button
              onClick={handleDeleteSelected}
              className="flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white animate-fade-in"
            >
              <Trash2 className="h-4.5 w-4.5" />
              Delete Selected ({selectedLeadIds.length})
            </Button>
          )}
          <Button
            onClick={() => setIsImportOpen(true)}
            className="flex items-center gap-1.5 border border-white/10 bg-slate-900 hover:bg-slate-800 text-slate-200"
          >
            <Upload className="h-4.5 w-4.5" />
            Import CSV
          </Button>
          <Button
            asChild
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <Link href="/intake">
              <Plus className="h-4.5 w-4.5" />
              Add Customer
            </Link>
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <LeadStatsCards stats={stats} loading={statsLoading} />

      {/* Tabs + Search + Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Vertical Tabs */}
        <div className="flex items-center gap-1 rounded-lg border border-white/5 bg-slate-900/50 p-1">
          {[
            { value: '', label: 'All' },
            { value: 'ACA', label: 'ACA' },
            { value: 'FE', label: 'FE' },
          ].map(tab => (
            <button
              key={tab.value}
              onClick={() => handleFilterChange('vertical', tab.value)}
              className={`rounded-md px-4 py-1.5 text-xs font-medium transition-colors ${
                filters.vertical === tab.value
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search + Filters */}
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search name, phone, email, zip…"
              value={filters.search}
              onChange={e => handleFilterChange('search', e.target.value)}
              className="w-56 rounded-md border border-border bg-card pl-8 pr-3 py-1.5 text-xs text-foreground
 placeholder-slate-600 outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-colors"
            />
          </div>

          {/* Filter Dropdowns */}
          <FilterPill
            label="Validation"
            value={filters.validationStatus}
            options={[
              { value: 'VALID', label: 'Valid' },
              { value: 'INVALID', label: 'Invalid' },
            ]}
            onChange={v => handleFilterChange('validationStatus', v)}
          />
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
          <FilterPill
            label="Post Status"
            value={filters.postStatus}
            options={[
              { value: 'PENDING', label: 'Pending' },
              { value: 'MATCHED', label: 'Matched' },
              { value: 'UNMATCHED', label: 'Unmatched' },
              { value: 'ERROR', label: 'Error' },
              { value: 'SKIPPED', label: 'Skipped' },
              { value: 'HOLD', label: 'Hold' },
            ]}
            onChange={v => handleFilterChange('postStatus', v)}
          />
          <FilterPill
            label="Mode"
            value={filters.postMode}
            options={[
              { value: 'TEST', label: 'Test' },
              { value: 'LIVE', label: 'Live' },
            ]}
            onChange={v => handleFilterChange('postMode', v)}
          />

          {/* Clear Filters */}
          {activeFilterCount > 0 && (
            <button
              onClick={handleClearFilters}
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider
 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <X className="h-3 w-3" />
              Clear ({activeFilterCount})
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <LeadsTable
        leads={leads}
        loading={loading}
        onSelectLead={handleSelectLead}
        selectedLeadIds={selectedLeadIds}
        onSelectLeadsChange={setSelectedLeadIds}
      />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            Page {page} of {totalPages} · {totalLeads.toLocaleString()} leads
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-md border border-border bg-card px-3 py-1 text-xs text-foreground
 hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Prev
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-md border border-border bg-card px-3 py-1 text-xs text-foreground
 hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Next
            </button>
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
