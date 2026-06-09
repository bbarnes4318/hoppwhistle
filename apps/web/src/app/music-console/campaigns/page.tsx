'use client';

import {
  Check,
  CheckCircle2,
  ChevronRight,
  ListFilter,
  Megaphone,
  Mic,
  MoreHorizontal,
  Play,
  Plus,
  ShieldCheck,
  Users,
  X,
  Coins,
} from 'lucide-react';
import Link from 'next/link';
import React, { useState, useEffect } from 'react';

import { StatusBadge } from '../../../features/music/components';
import { fanCampaigns } from '../../../features/music/data/demo-music-data';
import {
  campaignTypeLabel,
  formatCompactNumber,
  formatCurrency,
  formatCurrencyInt,
  segmentLabel,
} from '../../../features/music/lib/utils';
import type { FanCampaign } from '../../../features/music/types';

import { cn } from '@/lib/utils';

export default function MusicCampaignsPage() {
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [builderStep, setBuilderStep] = useState(1);
  const [selectedCampaign, setSelectedCampaign] = useState<FanCampaign | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [isComplianceChecked, setIsComplianceChecked] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedCampaign(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleLaunch = async () => {
    setIsLaunching(true);
    try {
      const res = await fetch('/api/music/voice-campaigns/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId: 'new-campaign',
          assistantId: 'rps-assistant-mock',
          contacts: Array(12400).fill({ phone: '+1234567890' }),
        }),
      });
      if (res.ok) {
        setIsBuilderOpen(false);
      }
    } catch (e) {
      console.error('Launch error', e);
    } finally {
      setIsLaunching(false);
    }
  };

  const handleExport = () => {
    const csvContent =
      'data:text/csv;charset=utf-8,ProofID,Campaign,Result\nPR123,Midnightsignal,Verified';
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csvContent));
    link.setAttribute('download', 'proof_log.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const totalActive = fanCampaigns.filter(c => c.status === 'active').length;
  const totalContacted = fanCampaigns.reduce((s, c) => s + c.fansContacted, 0);
  const totalVerified = fanCampaigns.reduce((s, c) => s + c.verifiedEngagements, 0);
  const totalProof = fanCampaigns.reduce((s, c) => s + c.proofCaptured, 0);
  const blendedCpa = 1.68; // Mock blended CPA

  return (
    <div className="space-y-5">
      
      {/* ─── Header ─── */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[var(--m-border-2)] pb-4">
        <div className="space-y-1.5">
          <h1 className="text-xl lg:text-2xl font-black tracking-tight flex items-center gap-3 text-[var(--m-text)] uppercase">
            <Megaphone className="h-6 w-6 text-[var(--m-accent)]" /> Fan Campaigns
          </h1>
          <p className="text-xs text-[var(--m-muted)] font-medium max-w-xl">
            “Create measurable fan engagement campaigns across RPS stations, sponsors, markets, and artist audiences.”
          </p>
          <div className="flex items-center gap-2 pt-1 flex-wrap">
            <span className="px-2 py-0.5 bg-[var(--m-accent-dim)] border border-[var(--m-accent)]/20 rounded text-[9px] text-[var(--m-accent)] font-bold uppercase tracking-wider font-mono">
              Active Media Inventory
            </span>
            <span className="px-2 py-0.5 bg-emerald-50 border border-emerald-250 rounded text-[9px] text-emerald-700 font-bold uppercase tracking-wider font-mono">
              Proof Enabled
            </span>
            <span className="px-2 py-0.5 bg-[var(--m-accent-gold-dim)] border border-[var(--m-accent-gold)]/20 rounded text-[9px] text-[#B45309] font-bold uppercase tracking-wider font-mono">
              Sponsor Ready
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded text-xs font-semibold hover:bg-[var(--m-surface-3)] transition-colors text-[var(--m-text-2)]"
            onClick={() => setShowFilters(!showFilters)}
          >
            <ListFilter className="h-3.5 w-3.5" /> Filter
          </button>
          <button
            onClick={() => {
              setIsBuilderOpen(true);
              setBuilderStep(1);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--m-accent)] text-white rounded text-xs font-semibold hover:bg-[#008be5] transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> Launch RPS Campaign
          </button>
        </div>
      </header>

      {showFilters && (
        <div className="p-4 bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded-lg grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-semibold m-text-muted mb-2 uppercase tracking-wider">
              Status
            </label>
            <select className="w-full bg-[var(--m-bg)] border border-[var(--m-border)] rounded p-2 text-sm text-[var(--m-text)] focus:outline-none focus:border-[var(--m-accent)]">
              <option>All Statuses</option>
              <option>Active</option>
              <option>Completed</option>
              <option>Paused</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold m-text-muted mb-2 uppercase tracking-wider">
              Campaign Type
            </label>
            <select className="w-full bg-[var(--m-bg)] border border-[var(--m-border)] rounded p-2 text-sm text-[var(--m-text)] focus:outline-none focus:border-[var(--m-accent)]">
              <option>All Types</option>
              <option>Album Pre-Save</option>
              <option>Tour On-Sale</option>
            </select>
          </div>
        </div>
      )}

      {/* ─── Summary Cards ─── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {/* Card 1: Active Campaigns */}
        <div className="m-metric-tile">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--m-muted)]">
            Active Campaigns
          </div>
          <div className="mt-2 text-2xl font-black text-[var(--m-accent)]">{totalActive}</div>
          <div className="text-[9px] text-[var(--m-muted)] mt-1 font-medium">Deployments Live</div>
        </div>
        {/* Card 2: Fans Reached */}
        <div className="m-metric-tile">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--m-muted)]">
            Fans Reached
          </div>
          <div className="mt-2 text-2xl font-black text-[var(--m-text)]">{formatCompactNumber(totalContacted)}</div>
          <div className="text-[9px] text-[var(--m-muted)] mt-1 font-medium">Total Connections</div>
        </div>
        {/* Card 3: Verified Actions */}
        <div className="m-metric-tile">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--m-muted)]">
            Verified Actions
          </div>
          <div className="mt-2 text-2xl font-black text-emerald-600">
            {formatCompactNumber(totalVerified)}
          </div>
          <div className="text-[9px] text-[var(--m-muted)] mt-1 font-medium">Verified Actions Logged</div>
        </div>
        {/* Card 4: Sponsor-Ready Proof */}
        <div className="m-metric-tile">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--m-muted)]">
            Sponsor-Ready Proof
          </div>
          <div className="mt-2 text-2xl font-black text-[var(--m-text)]">
            {formatCompactNumber(totalProof)}
          </div>
          <div className="text-[9px] text-[var(--m-muted)] mt-1 font-medium">Attributed Records</div>
        </div>
        {/* Card 5: Blended CPA */}
        <div className="m-metric-tile">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--m-muted)]">
            Blended CPA
          </div>
          <div className="mt-2 text-2xl font-black font-mono text-[#D97706]">
            {formatCurrency(blendedCpa)}
          </div>
          <div className="text-[9px] text-[var(--m-muted)] mt-1 font-medium">Cost per Action</div>
        </div>
        {/* Card 6: Est. Campaign Value */}
        <div className="m-metric-tile">
          <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--m-muted)]">
            Est. Campaign Value
          </div>
          <div className="mt-2 text-2xl font-black font-mono text-[#D97706]">
            {formatCurrencyInt(totalVerified * 2.8)}
          </div>
          <div className="text-[9px] text-[var(--m-muted)] mt-1 font-medium">Network Yield</div>
        </div>
      </div>

      {/* ─── Campaign Table ─── */}
      <section className="m-card overflow-x-auto bg-[var(--m-surface)] shadow-sm">
        <table className="w-full text-left text-xs border-collapse m-dense-table">
          <thead>
            <tr className="border-b border-[var(--m-border-2)] text-[9px] uppercase tracking-wider m-text-muted">
              <th className="py-2.5 font-bold">Campaign</th>
              <th className="py-2.5 font-bold">Artist / Station</th>
              <th className="py-2.5 font-bold">Campaign Type</th>
              <th className="py-2.5 font-bold">Audience Segment</th>
              <th className="py-2.5 font-bold">Status</th>
              <th className="py-2.5 font-bold text-right">Fans Reached</th>
              <th className="py-2.5 font-bold text-right">Answer Rate</th>
              <th className="py-2.5 font-bold text-right">Verified Actions</th>
              <th className="py-2.5 font-bold text-right">Cost / Action</th>
              <th className="py-2.5 font-bold text-right">Proof</th>
              <th className="py-2.5 font-bold text-right">Campaign Value</th>
              <th className="py-2.5 font-bold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--m-border-2)]">
            {fanCampaigns.map(c => (
              <tr
                key={c.id}
                onClick={() => setSelectedCampaign(c)}
                className="hover:bg-black/[0.015] transition-colors cursor-pointer"
                title={`Click to view full performance logs & economics for ${c.name}`}
              >
                <td className="py-2.5 font-bold text-[var(--m-text)] pr-3" title={c.name}>
                  {c.name}
                </td>
                <td className="py-2.5 text-[var(--m-text-2)]">{c.artist}</td>
                <td className="py-2.5">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--m-accent-dim)] text-[var(--m-accent)] border border-[var(--m-accent)]/10">
                    {campaignTypeLabel(c.type)}
                  </span>
                </td>
                <td className="py-2.5 text-[var(--m-muted)]">{segmentLabel(c.segment)}</td>
                <td className="py-2.5">
                  <StatusBadge status={c.status} className="text-[8px]" />
                </td>
                <td className="py-2.5 text-right font-mono text-[var(--m-text-2)] font-semibold">
                  {formatCompactNumber(c.fansContacted)}
                </td>
                <td className="py-2.5 text-right font-mono text-[var(--m-accent)] font-semibold">
                  {c.answerRate}%
                </td>
                <td className="py-2.5 text-right font-mono text-[var(--m-text)] font-bold">
                  {formatCompactNumber(c.verifiedEngagements)}
                </td>
                <td className="py-2.5 text-right font-mono text-[var(--m-text-2)]">
                  {c.cpa > 0 ? formatCurrency(c.cpa) : '—'}
                </td>
                <td className="py-2.5 text-right font-mono text-[var(--m-muted)]">
                  {formatCompactNumber(c.proofCaptured)}
                </td>
                <td className="py-2.5 text-right font-mono font-bold text-[#D97706]">
                  {formatCurrencyInt(c.verifiedEngagements * 2.8)}
                </td>
                <td className="py-2.5 text-right">
                  <button
                    className="p-1 hover:bg-[var(--m-surface-3)] rounded text-zinc-400 hover:text-[var(--m-text)] transition-colors"
                    onClick={e => {
                      e.stopPropagation();
                      setSelectedCampaign(c);
                    }}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ─── Campaign Detail Side Panel ─── */}
      {selectedCampaign && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs"
          onClick={() => setSelectedCampaign(null)}
        >
          <div
            className="w-full max-w-xl bg-[var(--m-surface)] border-l border-[var(--m-border-2)] h-screen fixed top-0 right-0 flex flex-col shadow-2xl overflow-hidden animate-[m-slide-in_0.2s_ease-out]"
            onClick={e => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div className="flex items-center justify-between p-5 border-b border-[var(--m-border-2)] bg-[var(--m-surface-2)] shrink-0">
              <div>
                <h2
                  className="text-base font-bold text-[var(--m-text)] truncate max-w-[280px]"
                  title={selectedCampaign.name}
                >
                  {selectedCampaign.name}
                </h2>
                <div className="flex items-center gap-2 text-xs text-[var(--m-muted)] mt-1">
                  <span>{selectedCampaign.artist}</span>
                  <span>•</span>
                  <span
                    className={cn(
                      'text-[10px] font-bold uppercase',
                      selectedCampaign.status === 'active' ? 'text-[var(--m-accent)]' :
                      selectedCampaign.status === 'completed' ? 'text-emerald-600' : 'text-[var(--m-dim)]'
                    )}
                  >
                    {selectedCampaign.status}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setSelectedCampaign(null)}
                className="p-1.5 hover:bg-[var(--m-surface-3)] rounded-lg transition-colors border border-[var(--m-border)] flex items-center justify-center bg-[var(--m-surface-2)]"
              >
                <X className="h-4 w-4 text-[var(--m-text)]" />
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* KPI Strip */}
              <div className="grid grid-cols-4 gap-2 pb-4 border-b border-[var(--m-border-2)]">
                <div className="bg-[var(--m-surface-2)] p-2.5 border border-[var(--m-border-2)] rounded">
                  <div className="text-[9px] text-[var(--m-muted)] uppercase tracking-wider font-semibold">
                    Reached
                  </div>
                  <div className="font-mono font-bold text-sm text-[var(--m-text)] mt-1">
                    {formatCompactNumber(selectedCampaign.fansContacted)}
                  </div>
                </div>
                <div className="bg-[var(--m-surface-2)] p-2.5 border border-[var(--m-border-2)] rounded">
                  <div className="text-[9px] text-[var(--m-muted)] uppercase tracking-wider font-semibold">
                    Answers
                  </div>
                  <div className="font-mono font-bold text-sm text-[var(--m-accent)] mt-1">
                    {selectedCampaign.answerRate}%
                  </div>
                </div>
                <div className="bg-[var(--m-surface-2)] p-2.5 border border-[var(--m-border-2)] rounded">
                  <div className="text-[9px] text-[var(--m-muted)] uppercase tracking-wider font-semibold">
                    Verified
                  </div>
                  <div className="font-mono font-bold text-sm text-emerald-600 mt-1">
                    {formatCompactNumber(selectedCampaign.verifiedEngagements)}
                  </div>
                </div>
                <div className="bg-[var(--m-surface-2)] p-2.5 border border-[var(--m-border-2)] rounded">
                  <div className="text-[9px] text-[var(--m-muted)] uppercase tracking-wider font-semibold">
                    Proof
                  </div>
                  <div className="font-mono font-bold text-sm text-[var(--m-text-2)] mt-1">
                    {formatCompactNumber(selectedCampaign.proofCaptured)}
                  </div>
                </div>
              </div>

              {/* Economics Section */}
              <div className="space-y-3 pb-4 border-b border-[var(--m-border-2)]">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--m-accent)] flex items-center gap-1.5">
                  <Coins className="h-3.5 w-3.5" /> Campaign Economics
                </h3>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="flex justify-between items-center bg-[var(--m-surface-2)] p-2.5 border border-[var(--m-border-2)] rounded">
                    <span className="text-[var(--m-muted)] font-medium">Total Spend</span>
                    <span className="font-mono font-bold text-[var(--m-text)]">
                      {formatCurrency(selectedCampaign.fansContacted * 0.4)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center bg-[var(--m-surface-2)] p-2.5 border border-[var(--m-border-2)] rounded">
                    <span className="text-[var(--m-muted)] font-medium">CPA Target</span>
                    <span className="font-mono font-bold text-[var(--m-text)]">
                      {selectedCampaign.cpa > 0 ? formatCurrency(selectedCampaign.cpa) : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center bg-[var(--m-surface-2)] p-2.5 border border-[var(--m-border-2)] rounded">
                    <span className="text-[var(--m-muted)] font-medium">Est. Sponsor Value</span>
                    <span className="font-mono font-bold text-[#D97706]">
                      {formatCurrency(selectedCampaign.verifiedEngagements * 2.8)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center bg-[var(--m-surface-2)] p-2.5 border border-[var(--m-border-2)] rounded">
                    <span className="text-[var(--m-muted)] font-medium">Artist Share (70%)</span>
                    <span className="font-mono font-bold text-[#D97706]">
                      {formatCurrency(selectedCampaign.verifiedEngagements * 2.8 * 0.7)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center bg-[var(--m-surface-2)] p-2.5 border border-[var(--m-border-2)] rounded col-span-2">
                    <span className="text-[var(--m-muted)] font-medium">RPS Share (30%)</span>
                    <span className="font-mono font-bold text-[var(--m-accent)]">
                      {formatCurrency(selectedCampaign.verifiedEngagements * 2.8 * 0.3)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Proof Readiness Check */}
              <div className="space-y-3 pb-4 border-b border-[var(--m-border-2)]">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5" /> Proof Readiness Checklist
                </h3>
                <div className="grid grid-cols-2 gap-2.5 text-xs">
                  <div className="flex items-center gap-2 text-[11px] text-[var(--m-text-2)]">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>TCPA Opt-In Consent Checked</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-[var(--m-text-2)]">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>Recording Consent Active</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-[var(--m-text-2)]">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>Dialing Safe-Time Check</span>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-[var(--m-text-2)]">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>Proof Audit Trail Ready</span>
                  </div>
                </div>
              </div>

              {/* Opening script preview */}
              <div className="space-y-1.5">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--m-muted)] border-b border-[var(--m-border-2)] pb-1">
                  Approved Conversational Script
                </h3>
                <div className="bg-[var(--m-surface-2)] border border-[var(--m-border-2)] rounded p-3 text-xs font-mono m-text-dim leading-relaxed">
                  {"\"Hey, this is Nova's team reaching out. The new album 'Midnight Signal' drops Friday. Do you want me to set up a pre-save on Spotify for you?\""}
                </div>
              </div>
            </div>

            {/* Drawer Actions */}
            <div className="p-4 border-t border-[var(--m-border-2)] bg-[var(--m-surface-2)] shrink-0 space-y-3">
              <div className="text-[8px] font-black uppercase text-[var(--m-accent)] tracking-widest font-mono">
                Next Recommended Action
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                {selectedCampaign.status === 'active' && (
                  <button className="col-span-2 py-2 bg-[var(--m-accent)] text-white text-xs font-bold hover:bg-[#008be5] rounded tracking-wider uppercase transition-colors">
                    OPTIMIZE DIALER VELOCITY
                  </button>
                )}
                {selectedCampaign.status === 'completed' && (
                  <button className="col-span-2 py-2 bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-500 rounded tracking-wider uppercase transition-colors">
                    ARCHIVE & EXPORT PROOF LOGS
                  </button>
                )}
                {selectedCampaign.status === 'paused' && (
                  <button className="col-span-2 py-2 bg-amber-600 text-white text-xs font-bold hover:bg-amber-500 rounded tracking-wider uppercase transition-colors">
                    RESUME DIALER STREAM
                  </button>
                )}
                {selectedCampaign.status === 'draft' && (
                  <button className="col-span-2 py-2 bg-[var(--m-accent)] text-white text-xs font-bold hover:bg-[#008be5] rounded tracking-wider uppercase transition-colors">
                    CONFIRM COMPLIANCE & LAUNCH
                  </button>
                )}
                <button
                  className="py-2 bg-[var(--m-surface-2)] border border-[var(--m-border)] text-[var(--m-text-2)] rounded text-xs font-bold hover:bg-[var(--m-surface-3)] transition-colors"
                  onClick={handleExport}
                >
                  Export Proof
                </button>
                <Link
                  href="/music-console/reports"
                  className="flex items-center justify-center py-2 bg-[var(--m-surface-2)] border border-[var(--m-border)] text-[var(--m-text-2)] rounded text-xs font-bold hover:bg-[var(--m-surface-3)] transition-colors text-center"
                >
                  View Full Report
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Campaign Builder Modal ─── */}
      {isBuilderOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 md:p-6">
          <div className="w-full max-w-4xl bg-[var(--m-surface)] border border-[var(--m-border-2)] rounded-lg shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">
            
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--m-border-2)] bg-[var(--m-surface-2)]">
              <h2 className="text-lg font-bold flex items-center gap-2 text-[var(--m-text)] uppercase tracking-wide">
                <Mic className="h-5 w-5 text-[var(--m-accent)]" /> New Fan Campaign
              </h2>
              <button
                onClick={() => setIsBuilderOpen(false)}
                className="p-1.5 text-zinc-400 hover:bg-[var(--m-surface-3)] rounded-full transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
              {/* Sidebar Steps */}
              <div className="w-full md:w-64 border-b md:border-b-0 md:border-r border-[var(--m-border-2)] p-6 bg-[var(--m-surface-3)] overflow-y-auto shrink-0">
                <div className="flex md:flex-col gap-4 md:gap-6 overflow-x-auto md:overflow-visible">
                  {[
                    { num: 1, title: 'Artist / Station' },
                    { num: 2, title: 'Campaign Objective' },
                    { num: 3, title: 'Audience Segment' },
                    { num: 4, title: 'Market Targeting' },
                    { num: 5, title: 'Sponsor / Monetization' },
                    { num: 6, title: 'Compliance Review' },
                  ].map(step => (
                    <div key={step.num} className="flex items-start gap-3 shrink-0">
                      <div
                        className={cn(
                          'flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold border transition-colors',
                          builderStep === step.num
                            ? 'bg-[var(--m-accent)] border-[var(--m-accent)] text-white'
                            : builderStep > step.num
                              ? 'bg-[var(--m-surface-2)] border-[var(--m-border-2)] text-zinc-400'
                              : 'bg-transparent border-[var(--m-border)] text-zinc-500'
                        )}
                      >
                        {builderStep > step.num ? <Check className="h-3 w-3" /> : step.num}
                      </div>
                      <div
                        className={cn(
                          'text-xs font-semibold whitespace-nowrap',
                          builderStep === step.num ? 'text-[var(--m-text)]' : 'text-zinc-500'
                        )}
                      >
                        {step.title}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Step Content */}
              <div className="flex-1 p-6 md:p-8 overflow-y-auto">
                
                {/* Step 1: Artist / Station */}
                {builderStep === 1 && (
                  <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                    <div>
                      <h3 className="text-xl font-bold text-[var(--m-text)]">Select Artist & Station Profile</h3>
                      <p className="text-sm text-[var(--m-muted)] mt-1">
                        Select the active broadcast profile and phone node for this outreach campaign.
                      </p>
                    </div>
                    <div className="space-y-5">
                      <div>
                        <label className="block text-xs font-semibold m-text-muted mb-2 uppercase tracking-wider font-mono">
                          Artist Name
                        </label>
                        <input
                          type="text"
                          placeholder="e.g., Nova Ray"
                          className="w-full bg-[var(--m-surface-3)] border border-[var(--m-border)] rounded px-4 py-3 text-sm focus:outline-none focus:border-[var(--m-accent)] text-[var(--m-text)]"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold m-text-muted mb-2 uppercase tracking-wider font-mono">
                          Broadcast Station ID Node
                        </label>
                        <select className="w-full bg-[var(--m-surface-3)] border border-[var(--m-border)] rounded px-4 py-3 text-sm focus:outline-none focus:border-[var(--m-accent)] text-[var(--m-text)]">
                          <option>RPS Station #25 - (Nova Ray Main Node)</option>
                          <option>RPS Station #02 - (Jace Vale Main Node)</option>
                          <option>RPS Station #11 - (Aria Stone Main Node)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold m-text-muted mb-2 uppercase tracking-wider font-mono">
                          Target Launch Date
                        </label>
                        <input
                          type="date"
                          className="w-full bg-[var(--m-surface-3)] border border-[var(--m-border)] rounded px-4 py-3 text-sm focus:outline-none focus:border-[var(--m-accent)] text-[var(--m-text)]"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Step 2: Campaign Objective */}
                {builderStep === 2 && (
                  <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                    <div>
                      <h3 className="text-xl font-bold text-[var(--m-text)]">Campaign Objective</h3>
                      <p className="text-sm text-[var(--m-muted)] mt-1">
                        Select the primary conversion action to drive and track.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {[
                        { label: 'Drive Spotify Pre-Saves', desc: 'Auto-verify Spotify API actions' },
                        { label: 'Sell Concert Tickets', desc: 'Secure early-access ticket intent' },
                        { label: 'Promote Merch Drops', desc: 'Broadcast exclusive merch passcodes' },
                        { label: 'Generate VIP Interest', desc: 'Collect phone sign-ups for VIP passes' },
                        { label: 'Reactivate Fan Club', desc: 'Follow-up with cold member database' },
                        { label: 'Capture Fan Feedback', desc: 'Conduct short surveys and responses' },
                      ].map(obj => (
                        <div
                          key={obj.label}
                          className="p-4 border border-[var(--m-border)] rounded-md bg-[var(--m-surface-3)] hover:bg-[var(--m-surface-2)] hover:border-[var(--m-accent)] cursor-pointer transition-all space-y-1"
                        >
                          <span className="text-sm font-bold text-[var(--m-text)]">{obj.label}</span>
                          <p className="text-[10px] text-[var(--m-muted)]">{obj.desc}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Step 3: Audience Segment */}
                {builderStep === 3 && (
                  <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                    <div>
                      <h3 className="text-xl font-bold text-[var(--m-text)]">Target Audience Segment</h3>
                      <p className="text-sm text-[var(--m-muted)] mt-1">
                        Define the opt-in audience to queue for conversational dialing.
                      </p>
                    </div>
                    <div className="space-y-6">
                      <div className="p-6 border-2 border-dashed border-[var(--m-border)] rounded-md bg-[var(--m-surface-3)] text-center hover:bg-[var(--m-surface-2)] cursor-pointer transition-colors">
                        <Users className="h-8 w-8 text-zinc-500 mx-auto mb-3" />
                        <span className="text-sm font-semibold text-[var(--m-text)]">
                          Upload Opted-In Fan List (CSV)
                        </span>
                        <p className="text-xs text-[var(--m-muted)] mt-2 max-w-sm mx-auto">
                           CSV must include phone numbers and matching TCPA consent timestamps.
                        </p>
                      </div>
                      <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                          <div className="w-full border-t border-[var(--m-border-2)]"></div>
                        </div>
                        <div className="relative flex justify-center">
                          <span className="bg-[var(--m-surface)] px-3 text-xs uppercase font-semibold text-zinc-500 tracking-wider">
                            Or Select Existing Cohort
                          </span>
                        </div>
                      </div>
                      <div>
                        <div className="flex flex-wrap gap-2.5">
                          {[
                            'Superfans',
                            'Previous merch buyers',
                            'Tour city fans',
                            'Stream save audience',
                            'VIP List',
                            'Fan club inactive',
                          ].map(s => (
                            <span
                              key={s}
                              className="px-3 py-1.5 bg-[var(--m-surface-3)] border border-[var(--m-border)] rounded text-xs font-semibold text-[var(--m-text-2)] cursor-pointer hover:border-[var(--m-accent)] transition-colors"
                            >
                              {s}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Step 4: Market Targeting */}
                {builderStep === 4 && (
                  <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                    <div>
                      <h3 className="text-xl font-bold text-[var(--m-text)]">Market & Dialer Configuration</h3>
                      <p className="text-sm text-[var(--m-muted)] mt-1">
                        Configure conversational bounds, timezone guards, and voice pacing.
                      </p>
                    </div>
                    <div className="space-y-5">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                        <div>
                          <label className="block text-xs font-semibold m-text-muted mb-2 uppercase tracking-wider font-mono">
                            Timezone Dialing Window
                          </label>
                          <select className="w-full bg-[var(--m-surface-3)] border border-[var(--m-border)] rounded px-4 py-3 text-sm focus:outline-none focus:border-[var(--m-accent)] text-[var(--m-text)]">
                            <option>Strict Safe Hours (10:00 AM - 6:00 PM Local)</option>
                            <option>Standard TCPA Window (8:00 AM - 9:00 PM Local)</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold m-text-muted mb-2 uppercase tracking-wider font-mono">
                            Dialing Pacing Pacing
                          </label>
                          <select className="w-full bg-[var(--m-surface-3)] border border-[var(--m-border)] rounded px-4 py-3 text-sm focus:outline-none focus:border-[var(--m-accent)] text-[var(--m-text)]">
                            <option>Balanced Conversational (Default)</option>
                            <option>High Velocity (Tour Sales/Merch Drops)</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold m-text-muted mb-2 uppercase tracking-wider font-mono">
                          Station Voice Persona
                        </label>
                        <select className="w-full bg-[var(--m-surface-3)] border border-[var(--m-border)] rounded px-4 py-3 text-sm focus:outline-none focus:border-[var(--m-accent)] text-[var(--m-text)]">
                          <option>Luna (Warm / Conversational)</option>
                          <option>Blaze (Energetic / Promo Focused)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold m-text-muted mb-2 uppercase tracking-wider font-mono">
                          Opening Script Phrasing
                        </label>
                        <textarea
                          rows={2}
                          placeholder="Hey, this is Nova's team reaching out..."
                          className="w-full bg-[var(--m-surface-3)] border border-[var(--m-border)] rounded px-4 py-3 text-sm focus:outline-none focus:border-[var(--m-accent)] text-[var(--m-text)] resize-none"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Step 5: Sponsor / Monetization */}
                {builderStep === 5 && (
                  <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                    <div>
                      <h3 className="text-xl font-bold text-[var(--m-text)]">Sponsor Connection & Split</h3>
                      <p className="text-sm text-[var(--m-muted)] mt-1">
                        Link sponsor inventory to monetize verified fan interactions.
                      </p>
                    </div>
                    <div className="space-y-5">
                      <div>
                        <label className="block text-xs font-semibold m-text-muted mb-2 uppercase tracking-wider font-mono">
                          Active Ad Sponsor Partner
                        </label>
                        <select className="w-full bg-[var(--m-surface-3)] border border-[var(--m-border)] rounded px-4 py-3 text-sm focus:outline-none focus:border-[var(--m-accent)] text-[var(--m-text)]">
                          <option>Spotify Pre-Save Advertising Pool</option>
                          <option>Live Nation Concert On-Sale Campaign</option>
                          <option>Direct Brand Merchandise Sponsor</option>
                          <option>None (Self-Funded Engagement)</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold m-text-muted mb-2 uppercase tracking-wider font-mono">
                          Target Cost per Action (CPA) Payout
                        </label>
                        <input
                          type="number"
                          step="0.05"
                          placeholder="$1.20"
                          className="w-full bg-[var(--m-surface-3)] border border-[var(--m-border)] rounded px-4 py-3 text-sm focus:outline-none focus:border-[var(--m-accent)] text-[var(--m-text)]"
                        />
                      </div>
                      <div className="p-4 bg-amber-50 border border-amber-255 rounded flex gap-3 text-xs text-amber-900">
                        <Coins className="h-5 w-5 text-amber-600 shrink-0" />
                        <div>
                          <p className="font-bold">Monetization Split Ratio</p>
                          <p className="text-[10px] mt-1 text-amber-800">
                            Split ratio defaults to 70% Artist Payout / 30% RPS Network Share. Revenue is computed on verified intent payload syncs.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Step 6: Compliance Review */}
                {builderStep === 6 && (
                  <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                    <div>
                      <h3 className="text-xl font-bold text-[var(--m-text)]">Compliance Review & Verification</h3>
                      <p className="text-sm text-[var(--m-muted)] mt-1">
                        Review dialing architecture safety protocols.
                      </p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <div className="space-y-4">
                        <div className="bg-[var(--m-surface-3)] border border-[var(--m-border)] rounded p-4">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--m-muted)] mb-1">
                            Audience Size
                          </p>
                          <p className="text-xl font-bold text-[var(--m-text)]">12,400 fans</p>
                        </div>
                        <div className="bg-[var(--m-surface-3)] border border-[var(--m-border)] rounded p-4">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--m-muted)] mb-1">
                            Expected Contact Yield
                          </p>
                          <p className="text-xl font-bold text-[var(--m-accent)]">~8,060 answers</p>
                        </div>
                      </div>
                      
                      <div className="bg-emerald-50 border border-emerald-250 rounded-md p-6">
                        <h4 className="text-sm font-bold mb-4 uppercase tracking-wider flex items-center gap-2 text-emerald-900">
                          <ShieldCheck className="h-5 w-5 text-emerald-600" /> Compliance Checkmarks
                        </h4>
                        <ul className="space-y-3 text-xs text-emerald-800 mb-6">
                          <li className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" /> DNC Registry Scrubbed
                          </li>
                          <li className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Regional Safe Dialing Hours Locked
                          </li>
                          <li className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" /> AI Opening Disclosure Active
                          </li>
                          <li className="flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Opt-out 블랙리스트 Auto-sync Active
                          </li>
                        </ul>
                        <label className="flex items-start gap-3 p-3 bg-[var(--m-surface)] border border-[var(--m-border)] rounded cursor-pointer hover:border-[var(--m-accent)] transition-colors">
                          <input
                            type="checkbox"
                            className="accent-[var(--m-accent)] w-4 h-4 mt-0.5 shrink-0"
                            checked={isComplianceChecked}
                            onChange={e => setIsComplianceChecked(e.target.checked)}
                          />
                          <span className="text-[11px] text-[var(--m-text-2)] leading-snug">
                            I verify that this campaign cohort complies with TCPA opt-in consent parameters and authorize launching this station stream.
                          </span>
                        </label>
                      </div>
                    </div>
                  </div>
                )}

              </div>
            </div>

            {/* Footer Actions */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--m-border-2)] bg-[var(--m-surface-2)]">
              <button
                onClick={() => setBuilderStep(Math.max(1, builderStep - 1))}
                className={cn(
                  'px-4 py-2 text-sm font-semibold rounded transition-colors',
                  builderStep === 1
                    ? 'invisible'
                    : 'text-[var(--m-muted)] hover:text-[var(--m-text)] hover:bg-[var(--m-surface-3)]'
                )}
              >
                Back
              </button>
              
              {builderStep < 6 ? (
                <button
                  onClick={() => setBuilderStep(builderStep + 1)}
                  className="flex items-center gap-1.5 px-5 py-2 bg-[var(--m-surface)] border border-[var(--m-border)] text-[var(--m-text-2)] rounded text-sm font-semibold hover:border-[var(--m-accent)] transition-colors"
                >
                  Continue <ChevronRight className="h-4 w-4" />
                </button>
              ) : (
                <button
                  onClick={() => { void handleLaunch(); }}
                  disabled={isLaunching || !isComplianceChecked}
                  className="flex items-center gap-1.5 px-6 py-2 bg-[var(--m-accent)] text-white rounded text-sm font-bold hover:bg-[#008be5] transition-colors disabled:opacity-50"
                  title={!isComplianceChecked ? 'Please verify compliance requirements above' : ''}
                >
                  <Play className="h-4 w-4 fill-current" />{' '}
                  {isLaunching ? 'Launching...' : 'Launch RPS Campaign'}
                </button>
              )}
            </div>
            
          </div>
        </div>
      )}
    </div>
  );
}
