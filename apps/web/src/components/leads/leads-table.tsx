'use client';

import { PhoneCall } from 'lucide-react';

import { usePhone } from '@/components/phone';
import type { InsuranceLeadSummary } from '@/lib/api/leads';

function LeadStageBadge({ stage }: { stage: string | null }) {
  if (!stage) return <span className="text-ink-3">—</span>;
  const configs: Record<string, { className: string; label: string }> = {
    NEW: { className: 'bg-ringing-tint text-ringing-ink border-transparent', label: 'New' },
    CONTACTED: {
      className: 'bg-ringing-tint text-ringing-ink border-transparent',
      label: 'Contacted',
    },
    PROPOSAL: {
      className: 'bg-ringing-tint text-ringing-ink border-transparent',
      label: 'Proposal',
    },
    UNDERWRITING: {
      className: 'bg-ringing-tint text-ringing-ink border-transparent',
      label: 'Underwriting',
    },
    HOLD: { className: 'bg-ringing-tint text-ringing-ink border-transparent', label: 'Hold' },
    CLOSED_WON: {
      className: 'bg-live-tint text-live-ink border-transparent',
      label: 'Closed Won',
    },
    CLOSED_LOST: {
      className: 'bg-dropped-tint text-dropped-ink border-transparent',
      label: 'Closed Lost',
    },
  };
  const config = configs[stage] || {
    className: 'bg-sunken text-ink-2 border-transparent',
    label: stage,
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-wide ${config.className}`}
    >
      {config.label}
    </span>
  );
}

function FollowUpBadge({ dateStr, stage }: { dateStr: string | null; stage: string | null }) {
  if (!dateStr) return <span className="text-ink-3">—</span>;

  const d = new Date(dateStr);
  const now = new Date();

  // Format readable follow up
  const dateFormatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const timeFormatted = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

  const isWonOrLost = stage === 'CLOSED_WON' || stage === 'CLOSED_LOST';
  const isOverdue = d < now && !isWonOrLost;

  // Check if today
  const isToday = d.toDateString() === now.toDateString();

  // Check if tomorrow
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();

  if (isOverdue) {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-dropped-tint px-1.5 py-0.5 text-[10px] font-medium text-dropped-ink">
        <span className="h-1.5 w-1.5 rounded-full bg-dropped animate-pulse" />
        Overdue ({dateFormatted})
      </span>
    );
  }

  if (isToday) {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-ringing-tint px-1.5 py-0.5 text-[10px] font-medium text-ringing-ink">
        Today {timeFormatted}
      </span>
    );
  }

  if (isTomorrow) {
    return (
      <span className="inline-flex items-center rounded bg-sunken px-1.5 py-0.5 text-[10px] font-medium text-ink-2">
        Tomorrow {timeFormatted}
      </span>
    );
  }

  return (
    <span className="text-[11px] text-ink-2">
      {dateFormatted} {timeFormatted}
    </span>
  );
}

interface LeadsTableProps {
  leads: InsuranceLeadSummary[];
  loading: boolean;
  onSelectLead: (id: string) => void;
  selectedLeadIds?: string[];
  onSelectLeadsChange?: (ids: string[]) => void;
}

function StatusBadge({ status }: { status: string }) {
  const configs: Record<string, { className: string; label: string }> = {
    // Validation
    VALID: {
      className: 'bg-live-tint text-live-ink border-transparent',
      label: 'Valid',
    },
    INVALID: { className: 'bg-blocked-tint text-blocked-ink border-transparent', label: 'Invalid' },
    // Post status
    PENDING: { className: 'bg-ringing-tint text-ringing-ink border-transparent', label: 'Pending' },
    HOLD: { className: 'bg-ringing-tint text-ringing-ink border-transparent', label: 'Hold' },
    SKIPPED: { className: 'bg-blocked-tint text-blocked-ink border-transparent', label: 'Skipped' },
    MATCHED: {
      className: 'bg-live-tint text-live-ink border-transparent',
      label: 'Matched',
    },
    UNMATCHED: {
      className: 'bg-dropped-tint text-dropped-ink border-transparent',
      label: 'Unmatched',
    },
    ERROR: { className: 'bg-dropped-tint text-dropped-ink border-transparent', label: 'Error' },
    // Mode
    TEST: { className: 'bg-money-tint text-money-ink border-transparent', label: 'Test' },
    LIVE: { className: 'bg-live-tint text-live-ink border-transparent', label: 'Live' },
  };

  const config = configs[status] || {
    className: 'bg-sunken text-ink-2 border-transparent',
    label: status,
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${config.className}`}
    >
      {config.label}
    </span>
  );
}

function VerticalBadge({ vertical }: { vertical: 'ACA' | 'FE' | 'B2B' }) {
  if (vertical === 'ACA') {
    return (
      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest bg-sunken text-ink-2">
        ACA
      </span>
    );
  }
  if (vertical === 'FE') {
    return (
      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest bg-sunken text-ink-2">
        FE Customers
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest bg-sunken text-ink-2">
      B2B
    </span>
  );
}

function formatPhone(phone: string): string {
  if (phone.length === 10) {
    return `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`;
  }
  return phone;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function LeadsTable({
  leads,
  loading,
  onSelectLead,
  selectedLeadIds = [],
  onSelectLeadsChange,
}: LeadsTableProps) {
  const { makeCall } = usePhone();

  const allSelected = leads.length > 0 && leads.every(lead => selectedLeadIds.includes(lead.id));
  const someSelected =
    leads.length > 0 && leads.some(lead => selectedLeadIds.includes(lead.id)) && !allSelected;

  const handleSelectAll = (checked: boolean) => {
    if (!onSelectLeadsChange) return;
    if (checked) {
      const currentIds = leads.map(l => l.id);
      const newSelection = Array.from(new Set([...selectedLeadIds, ...currentIds]));
      onSelectLeadsChange(newSelection);
    } else {
      const currentIds = leads.map(l => l.id);
      const newSelection = selectedLeadIds.filter(id => !currentIds.includes(id));
      onSelectLeadsChange(newSelection);
    }
  };

  const handleSelectOne = (id: string, checked: boolean) => {
    if (!onSelectLeadsChange) return;
    if (checked) {
      onSelectLeadsChange([...selectedLeadIds, id]);
    } else {
      onSelectLeadsChange(selectedLeadIds.filter(x => x !== id));
    }
  };

  if (loading) {
    return (
      <div className="rounded-card border border-rule bg-surface overflow-hidden">
        <div className="p-8 text-center text-sm text-ink-3">
          <div className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-brand-ink border-t-transparent" />
          <span className="ml-2">Loading leads…</span>
        </div>
      </div>
    );
  }

  if (!leads.length) {
    return (
      <div className="rounded-card border border-rule bg-surface overflow-hidden">
        <div className="p-12 text-center">
          <div className="text-ink-3 text-sm">No leads found</div>
          <div className="text-ink-3 text-xs mt-1">
            Leads will appear here when they are received via the ingestion API.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-card border border-rule bg-surface overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-rule bg-sunken">
              {onSelectLeadsChange && (
                <th className="w-10 px-4 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={el => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={e => handleSelectAll(e.target.checked)}
                    className="rounded border-rule bg-surface text-brand-ink focus:ring-brand-tint focus:ring-offset-surface h-4 w-4 cursor-pointer"
                    aria-label="Select all leads"
                  />
                </th>
              )}
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-3">
                Received
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-3">
                Type
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-3">
                Name
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-3">
                Stage
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-3">
                Follow Up
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-3">
                Phone
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-3">
                State
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-3">
                ZIP
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-rule">
            {leads.map(lead => {
              const sub = lead.latestSubmission;
              const isSelected = selectedLeadIds.includes(lead.id);
              return (
                <tr
                  key={lead.id}
                  onClick={() => onSelectLead(lead.id)}
                  className={`cursor-pointer transition-colors hover:bg-sunken ${
                    isSelected ? 'bg-brand-tint' : ''
                  }`}
                >
                  {onSelectLeadsChange && (
                    <td className="px-4 py-3 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={e => handleSelectOne(lead.id, e.target.checked)}
                        className="rounded border-rule bg-surface text-brand-ink focus:ring-brand-tint focus:ring-offset-surface h-4 w-4 cursor-pointer"
                        aria-label={`Select lead ${lead.fullName || ''}`}
                      />
                    </td>
                  )}
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="text-xs text-ink-2">
                      {sub ? formatDate(sub.receivedAt) : formatDate(lead.createdAt)}
                    </div>
                    <div className="text-[10px] text-ink-3">
                      {sub ? formatTime(sub.receivedAt) : ''}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <VerticalBadge vertical={lead.vertical} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="text-sm text-ink font-medium">
                      {lead.fullName ||
                        `${lead.firstName || ''} ${lead.lastName || ''}`.trim() ||
                        '—'}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <LeadStageBadge stage={lead.leadStage} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <FollowUpBadge dateStr={lead.nextFollowUpAt} stage={lead.leadStage} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-xs text-ink-2 font-mono">
                    <div className="flex items-center gap-2">
                      <span>{formatPhone(lead.phone)}</span>
                      {lead.phone && (
                        <button
                          onClick={e => {
                            e.stopPropagation();
                            void makeCall(lead.phone);
                          }}
                          className="rounded bg-brand-tint p-1 text-brand-ink hover:opacity-80 transition-all"
                          title="Click to dial"
                          aria-label={`Dial ${lead.phone}`}
                        >
                          <PhoneCall className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-xs text-ink-2">
                    {lead.state || '—'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-xs text-ink-2 font-mono">
                    {lead.zipCode || '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export { StatusBadge, VerticalBadge };
