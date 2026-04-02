'use client';

import { Search, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { LeadDetailSheet } from '@/components/leads/lead-detail-sheet';
import { LeadStatsCards } from '@/components/leads/lead-stats-cards';
import { LeadsTable } from '@/components/leads/leads-table';
import {
  fetchInsuranceLeads,
  fetchInsuranceLead,
  fetchInsuranceLeadStats,
} from '@/lib/api/leads';
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
}

const EMPTY_FILTERS: Filters = {
  vertical: '',
  validationStatus: '',
  postStatus: '',
  postMode: '',
  search: '',
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
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-white/10 bg-slate-900/50 px-2.5 py-1.5 text-xs text-slate-300
        outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-colors
        appearance-none cursor-pointer"
      aria-label={label}
    >
      <option value="">{label}</option>
      {options.map((o) => (
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
  const [stats, setStats] = useState<InsuranceLeadStats | null>(null);
  const [totalLeads, setTotalLeads] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  // Detail sheet
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<InsuranceLeadDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Active filters count
  const activeFilterCount = Object.values(filters).filter((v) => v && v !== '').length;

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
    setFilters((prev) => ({ ...prev, [key]: value }));
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

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Insurance Leads</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Manage inbound ACA and Final Expense leads · Ameriquote / Boberdoo integration
        </p>
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
          ].map((tab) => (
            <button
              key={tab.value}
              onClick={() => handleFilterChange('vertical', tab.value)}
              className={`rounded-md px-4 py-1.5 text-xs font-medium transition-colors ${
                filters.vertical === tab.value
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
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
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search name, phone, email, zip…"
              value={filters.search}
              onChange={(e) => handleFilterChange('search', e.target.value)}
              className="w-56 rounded-md border border-white/10 bg-slate-900/50 pl-8 pr-3 py-1.5 text-xs text-slate-200
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
            onChange={(v) => handleFilterChange('validationStatus', v)}
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
            ]}
            onChange={(v) => handleFilterChange('postStatus', v)}
          />
          <FilterPill
            label="Mode"
            value={filters.postMode}
            options={[
              { value: 'TEST', label: 'Test' },
              { value: 'LIVE', label: 'Live' },
            ]}
            onChange={(v) => handleFilterChange('postMode', v)}
          />

          {/* Clear Filters */}
          {activeFilterCount > 0 && (
            <button
              onClick={handleClearFilters}
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider
                text-slate-400 hover:bg-white/5 hover:text-slate-200 transition-colors"
            >
              <X className="h-3 w-3" />
              Clear ({activeFilterCount})
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <LeadsTable leads={leads} loading={loading} onSelectLead={handleSelectLead} />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-xs text-slate-500">
            Page {page} of {totalPages} · {totalLeads.toLocaleString()} leads
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="rounded-md border border-white/10 bg-slate-900/50 px-3 py-1 text-xs text-slate-300
                hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="rounded-md border border-white/10 bg-slate-900/50 px-3 py-1 text-xs text-slate-300
                hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
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
    </div>
  );
}
