'use client';

import type { InsuranceLeadSummary } from '@/lib/api/leads';
import { PhoneCall } from 'lucide-react';
import { usePhone } from '@/components/phone';

function LeadStageBadge({ stage }: { stage: string | null }) {
  if (!stage) return <span className="text-slate-600">—</span>;
  const configs: Record<string, { className: string; label: string }> = {
    NEW: { className: 'bg-slate-500/10 text-slate-400 border-slate-500/20', label: 'New' },
    CONTACTED: { className: 'bg-blue-500/10 text-blue-400 border-blue-500/20', label: 'Contacted' },
    PROPOSAL: {
      className: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
      label: 'Proposal',
    },
    UNDERWRITING: {
      className: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      label: 'Underwriting',
    },
    HOLD: { className: 'bg-orange-500/10 text-orange-400 border-orange-500/20', label: 'Hold' },
    CLOSED_WON: {
      className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      label: 'Closed Won',
    },
    CLOSED_LOST: {
      className: 'bg-red-500/10 text-red-400 border-red-500/20',
      label: 'Closed Lost',
    },
  };
  const config = configs[stage] || {
    className: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
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
  if (!dateStr) return <span className="text-slate-600">—</span>;

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
      <span className="inline-flex items-center gap-1 rounded bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 text-[10px] font-medium text-red-400">
        <span className="h-1.5 w-1.5 rounded-full bg-red-400 animate-pulse" />
        Overdue ({dateFormatted})
      </span>
    );
  }

  if (isToday) {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-400">
        Today {timeFormatted}
      </span>
    );
  }

  if (isTomorrow) {
    return (
      <span className="inline-flex items-center rounded bg-slate-500/10 border border-slate-500/20 px-1.5 py-0.5 text-[10px] font-medium text-slate-300">
        Tomorrow {timeFormatted}
      </span>
    );
  }

  return (
    <span className="text-[11px] text-slate-300">
      {dateFormatted} {timeFormatted}
    </span>
  );
}

interface LeadsTableProps {
  leads: InsuranceLeadSummary[];
  loading: boolean;
  onSelectLead: (id: string) => void;
}

function StatusBadge({ status }: { status: string }) {
  const configs: Record<string, { className: string; label: string }> = {
    // Validation
    VALID: {
      className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
      label: 'Valid',
    },
    INVALID: { className: 'bg-red-500/15 text-red-400 border-red-500/30', label: 'Invalid' },
    // Post status
    PENDING: { className: 'bg-amber-500/15 text-amber-400 border-amber-500/30', label: 'Pending' },
    HOLD: { className: 'bg-amber-500/15 text-amber-500 border-amber-500/30', label: 'Hold' },
    SKIPPED: { className: 'bg-slate-500/15 text-slate-400 border-slate-500/30', label: 'Skipped' },
    MATCHED: {
      className: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
      label: 'Matched',
    },
    UNMATCHED: {
      className: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
      label: 'Unmatched',
    },
    ERROR: { className: 'bg-red-500/15 text-red-400 border-red-500/30', label: 'Error' },
    // Mode
    TEST: { className: 'bg-blue-500/15 text-blue-400 border-blue-500/30', label: 'Test' },
    LIVE: { className: 'bg-purple-500/15 text-purple-400 border-purple-500/30', label: 'Live' },
  };

  const config = configs[status] || {
    className: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
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

function VerticalBadge({ vertical }: { vertical: 'ACA' | 'FE' }) {
  const isACA = vertical === 'ACA';
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest ${
        isACA ? 'bg-cyan-500/15 text-cyan-400' : 'bg-violet-500/15 text-violet-400'
      }`}
    >
      {vertical}
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

export function LeadsTable({ leads, loading, onSelectLead }: LeadsTableProps) {
  const { makeCall } = usePhone();
  if (loading) {
    return (
      <div className="rounded-lg border border-white/5 bg-slate-900/50 overflow-hidden">
        <div className="p-8 text-center text-sm text-slate-500">
          <div className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-slate-500 border-t-transparent" />
          <span className="ml-2">Loading leads…</span>
        </div>
      </div>
    );
  }

  if (!leads.length) {
    return (
      <div className="rounded-lg border border-white/5 bg-slate-900/50 overflow-hidden">
        <div className="p-12 text-center">
          <div className="text-slate-500 text-sm">No leads found</div>
          <div className="text-slate-600 text-xs mt-1">
            Leads will appear here when they are received via the ingestion API.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-white/5 bg-slate-900/50 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 bg-slate-900/80">
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                Received
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                Type
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                Name
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                Stage
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                Follow Up
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                Phone
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                State
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                ZIP
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                Source
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                Validation
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                Post
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                Mode
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                Result
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {leads.map(lead => {
              const sub = lead.latestSubmission;
              return (
                <tr
                  key={lead.id}
                  onClick={() => onSelectLead(lead.id)}
                  className="cursor-pointer transition-colors hover:bg-white/[0.02]"
                >
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="text-xs text-slate-300">
                      {sub ? formatDate(sub.receivedAt) : formatDate(lead.createdAt)}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {sub ? formatTime(sub.receivedAt) : ''}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <VerticalBadge vertical={lead.vertical} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="text-sm text-slate-200 font-medium">
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
                  <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-300 font-mono">
                    <div className="flex items-center gap-2">
                      <span>{formatPhone(lead.phone)}</span>
                      {lead.phone && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void makeCall(lead.phone);
                          }}
                          className="rounded bg-emerald-500/10 border border-emerald-500/20 p-1 text-emerald-400 hover:bg-emerald-500/20 transition-all"
                          title="Click to dial"
                          aria-label={`Dial ${lead.phone}`}
                        >
                          <PhoneCall className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-400">
                    {lead.state || '—'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-400 font-mono">
                    {lead.zipCode || '—'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-400">
                    {sub?.source || lead.source || '—'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {sub ? <StatusBadge status={sub.validationStatus} /> : '—'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {sub ? <StatusBadge status={sub.postStatus} /> : '—'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {sub ? <StatusBadge status={sub.postMode} /> : '—'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-400">
                    {sub?.ameriquoteResponseStatus || '—'}
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
