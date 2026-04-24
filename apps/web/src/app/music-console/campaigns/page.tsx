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
  Target,
  BarChart3,
  Clock
} from 'lucide-react';
import { useState } from 'react';

import { fanCampaigns } from '@/features/music/data/demo-music-data';
import { campaignTypeLabel, formatCompactNumber, formatCurrency, segmentLabel } from '@/features/music/lib/utils';
import { cn } from '@/lib/utils';
import type { FanCampaign } from '@/features/music/types';
import Link from 'next/link';

export default function MusicCampaignsPage() {
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [builderStep, setBuilderStep] = useState(1);
  const [selectedCampaign, setSelectedCampaign] = useState<FanCampaign | null>(null);

  const totalActive = fanCampaigns.filter(c => c.status === 'active').length;
  const totalContacted = fanCampaigns.reduce((s, c) => s + c.fansContacted, 0);
  const totalVerified = fanCampaigns.reduce((s, c) => s + c.verifiedEngagements, 0);
  const totalProof = fanCampaigns.reduce((s, c) => s + c.proofCaptured, 0);
  const blendedCpa = 1.68; // Mock blended CPA

  return (
    <div className="space-y-6">
      
      {/* ─── Header ─── */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[var(--m-border-2)] pb-6">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight flex items-center gap-3 m-text-text">
            <Megaphone className="h-7 w-7 m-text-accent" /> Fan Campaigns
          </h1>
          <p className="mt-2 text-sm m-text-muted max-w-xl">
            Design, deploy, and monitor direct-to-fan AI voice campaigns.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 px-4 py-2 bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded-md text-sm font-medium hover:bg-[var(--m-border-2)] transition-colors" onClick={() => alert('Opening filters panel...')}>
            <ListFilter className="h-4 w-4" /> Filter
          </button>
          <button 
            onClick={() => { setIsBuilderOpen(true); setBuilderStep(1); }}
            className="flex items-center gap-2 px-4 py-2 bg-[var(--m-accent)] text-white rounded-md text-sm font-medium hover:bg-violet-600 transition-colors"
          >
            <Plus className="h-4 w-4" /> New Campaign
          </button>
        </div>
      </header>

      {/* ─── Summary Cards ─── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="m-card p-4">
          <div className="text-xs font-semibold m-text-muted uppercase tracking-wider">Active Campaigns</div>
          <div className="mt-2 text-2xl font-bold m-text-accent">{totalActive}</div>
        </div>
        <div className="m-card p-4">
          <div className="text-xs font-semibold m-text-muted uppercase tracking-wider">Fans Contacted</div>
          <div className="mt-2 text-2xl font-bold m-text-text">{formatCompactNumber(totalContacted)}</div>
        </div>
        <div className="m-card p-4">
          <div className="text-xs font-semibold m-text-muted uppercase tracking-wider">Verified Actions</div>
          <div className="mt-2 text-2xl font-bold m-text-text">{formatCompactNumber(totalVerified)}</div>
        </div>
        <div className="m-card p-4">
          <div className="text-xs font-semibold m-text-muted uppercase tracking-wider">Blended CPA</div>
          <div className="mt-2 text-2xl font-bold m-text-text">{formatCurrency(blendedCpa)}</div>
        </div>
        <div className="m-card p-4">
          <div className="text-xs font-semibold m-text-muted uppercase tracking-wider">Proof Records</div>
          <div className="mt-2 text-2xl font-bold m-text-text">{formatCompactNumber(totalProof)}</div>
        </div>
      </div>

      {/* ─── Campaign Table ─── */}
      <section className="m-card overflow-x-auto">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-[var(--m-surface-2)] border-b border-[var(--m-border-2)] text-[11px] uppercase tracking-wider m-text-muted">
            <tr>
              <th className="px-4 py-3 font-semibold">Campaign</th>
              <th className="px-4 py-3 font-semibold">Artist</th>
              <th className="px-4 py-3 font-semibold">Type</th>
              <th className="px-4 py-3 font-semibold">Segment</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold text-right">Contacted</th>
              <th className="px-4 py-3 font-semibold text-right">Answer Rate</th>
              <th className="px-4 py-3 font-semibold text-right">Verified</th>
              <th className="px-4 py-3 font-semibold text-right">CPA</th>
              <th className="px-4 py-3 font-semibold text-right">Proof</th>
              <th className="px-4 py-3 font-semibold">Start Date</th>
              <th className="px-4 py-3 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--m-border-2)]">
            {fanCampaigns.map((c) => (
              <tr 
                key={c.id} 
                onClick={() => setSelectedCampaign(c)}
                className="hover:bg-[rgba(255,255,255,0.02)] transition-colors cursor-pointer"
              >
                <td className="px-4 py-3">
                  <div className="font-semibold m-text-text truncate max-w-[150px] lg:max-w-[200px]" title={c.name}>{c.name}</div>
                </td>
                <td className="px-4 py-3 m-text-muted">{c.artist}</td>
                <td className="px-4 py-3">
                  <span className="px-2 py-1 bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded text-[10px] m-text-dim">
                    {campaignTypeLabel(c.type)}
                  </span>
                </td>
                <td className="px-4 py-3 m-text-muted text-[11px]">{segmentLabel(c.segment)}</td>
                <td className="px-4 py-3">
                  <span className={cn(
                    "inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-semibold border",
                    c.status === 'active' ? 'bg-[var(--m-accent)]/10 text-[var(--m-accent)] border-[var(--m-accent)]/20' :
                    c.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                    c.status === 'paused' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
                  )}>
                    {c.status === 'active' && <span className="m-pulse-dot" style={{ width: '6px', height: '6px' }} />}
                    {c.status.toUpperCase()}
                  </span>
                </td>
                <td className="px-4 py-3 text-right m-font-mono m-text-dim">{formatCompactNumber(c.fansContacted)}</td>
                <td className="px-4 py-3 text-right m-font-mono text-[var(--m-accent)]">{c.answerRate}%</td>
                <td className="px-4 py-3 text-right m-font-mono m-text-text">{formatCompactNumber(c.verifiedEngagements)}</td>
                <td className="px-4 py-3 text-right m-font-mono">{c.cpa > 0 ? formatCurrency(c.cpa) : '\u2014'}</td>
                <td className="px-4 py-3 text-right m-font-mono m-text-muted">{formatCompactNumber(c.proofCaptured)}</td>
                <td className="px-4 py-3 m-text-dim m-font-mono text-[11px]">{c.startDate}</td>
                <td className="px-4 py-3 text-right">
                  <button className="p-1 hover:bg-[var(--m-surface-2)] rounded m-text-muted hover:text-[var(--m-text)] transition-colors" onClick={(e) => { e.stopPropagation(); setSelectedCampaign(c); }}>
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ─── Campaign Detail Drawer ─── */}
      {selectedCampaign && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm" onClick={() => setSelectedCampaign(null)}>
          <div 
            className="w-full max-w-md bg-[var(--m-surface)] border-l border-[var(--m-border-2)] h-full overflow-y-auto flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-6 border-b border-[var(--m-border-2)] bg-[var(--m-surface-2)]">
              <div>
                <h2 className="text-xl font-bold m-text-text truncate max-w-[280px]" title={selectedCampaign.name}>{selectedCampaign.name}</h2>
                <div className="flex items-center gap-2 text-sm m-text-dim mt-1">
                  <span>{selectedCampaign.artist}</span>
                  <span>•</span>
                  <span className={cn(
                    "text-xs font-semibold uppercase",
                    selectedCampaign.status === 'active' ? 'text-[var(--m-accent)]' :
                    selectedCampaign.status === 'completed' ? 'text-emerald-400' : 'text-zinc-400'
                  )}>{selectedCampaign.status}</span>
                </div>
              </div>
              <button onClick={() => setSelectedCampaign(null)} className="p-2 hover:bg-[var(--m-border-2)] rounded-full transition-colors">
                <X className="h-5 w-5 m-text-muted" />
              </button>
            </div>

            <div className="p-6 space-y-8">
              {/* Overview */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[var(--m-bg)] p-3 rounded-md border border-[var(--m-border)]">
                  <div className="text-xs m-text-muted uppercase tracking-wider mb-1 flex items-center gap-1"><Target className="h-3 w-3"/> Goal</div>
                  <div className="font-semibold text-sm capitalize">{selectedCampaign.type.replace(/_/g, ' ')}</div>
                </div>
                <div className="bg-[var(--m-bg)] p-3 rounded-md border border-[var(--m-border)]">
                  <div className="text-xs m-text-muted uppercase tracking-wider mb-1 flex items-center gap-1"><Users className="h-3 w-3"/> Audience</div>
                  <div className="font-semibold text-sm capitalize">{selectedCampaign.segment.replace(/_/g, ' ')}</div>
                </div>
                <div className="bg-[var(--m-bg)] p-3 rounded-md border border-[var(--m-border)]">
                  <div className="text-xs m-text-muted uppercase tracking-wider mb-1 flex items-center gap-1"><Clock className="h-3 w-3"/> Launched</div>
                  <div className="font-semibold text-sm">{selectedCampaign.startDate}</div>
                </div>
                <div className="bg-[var(--m-bg)] p-3 rounded-md border border-[var(--m-border)]">
                  <div className="text-xs m-text-muted uppercase tracking-wider mb-1 flex items-center gap-1"><BarChart3 className="h-3 w-3"/> CPA Target</div>
                  <div className="font-semibold text-sm">{formatCurrency(selectedCampaign.cpa)}</div>
                </div>
              </div>

              {/* Performance */}
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider m-text-muted mb-4 border-b border-[var(--m-border-2)] pb-2">Performance KPIs</h3>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span className="text-sm m-text-dim">Fans Contacted</span>
                    <span className="font-mono font-bold text-[var(--m-text)]">{formatCompactNumber(selectedCampaign.fansContacted)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm m-text-dim">Human Answers</span>
                    <span className="font-mono font-bold text-[var(--m-text)]">{formatCompactNumber(selectedCampaign.humanAnswers)} <span className="text-xs m-text-accent font-normal ml-1">({selectedCampaign.answerRate}%)</span></span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm m-text-dim">Verified Engagements</span>
                    <span className="font-mono font-bold text-emerald-400">{formatCompactNumber(selectedCampaign.verifiedEngagements)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm m-text-dim">Proof Captured</span>
                    <span className="font-mono font-bold text-[var(--m-text)]">{formatCompactNumber(selectedCampaign.proofCaptured)}</span>
                  </div>
                </div>
              </div>

              {/* Script / Message */}
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider m-text-muted mb-4 border-b border-[var(--m-border-2)] pb-2">Script Preview</h3>
                <div className="bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded-md p-4 text-sm font-mono m-text-dim leading-relaxed">
                  "Hey, this is Nova's team reaching out. The new album 'Midnight Signal' drops Friday. Do you want me to set up a pre-save on Spotify for you?"
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-3 pt-4 border-t border-[var(--m-border-2)]">
                <Link href="/music-console/reports" className="flex items-center justify-center w-full py-2 bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded text-sm font-semibold hover:bg-[var(--m-border-2)] transition-colors">
                  View Full Report
                </Link>
                <button className="w-full py-2 bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded text-sm font-semibold hover:bg-[var(--m-border-2)] transition-colors" onClick={() => alert('Exporting proof log to CSV...')}>
                  Export Proof Log (.csv)
                </button>
                {selectedCampaign.status === 'active' ? (
                  <button className="w-full py-2 bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded text-sm font-semibold hover:bg-amber-500/20 transition-colors" onClick={() => alert('Pausing campaign...')}>
                    Pause Campaign
                  </button>
                ) : (
                  <button className="w-full py-2 bg-[var(--m-accent)] text-white rounded text-sm font-semibold hover:bg-violet-600 transition-colors" onClick={() => alert('Resuming campaign...')}>
                    Resume Campaign
                  </button>
                )}
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
              <h2 className="text-lg font-bold flex items-center gap-2 m-text-text">
                <Mic className="h-5 w-5 m-text-accent" /> New Fan Campaign
              </h2>
              <button onClick={() => setIsBuilderOpen(false)} className="p-1.5 m-text-dim hover:bg-[var(--m-border-2)] rounded-full transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
              {/* Sidebar Steps */}
              <div className="w-full md:w-64 border-b md:border-b-0 md:border-r border-[var(--m-border-2)] p-6 bg-[var(--m-surface-2)] overflow-y-auto shrink-0">
                <div className="flex md:flex-col gap-4 md:gap-6 overflow-x-auto md:overflow-visible">
                  {[
                    { num: 1, title: 'Campaign Goal' },
                    { num: 2, title: 'Artist / Project' },
                    { num: 3, title: 'Audience' },
                    { num: 4, title: 'Message & Script' },
                    { num: 5, title: 'Proof & Tracking' },
                    { num: 6, title: 'Review & Launch' },
                  ].map((step) => (
                    <div key={step.num} className="flex items-start gap-3 shrink-0">
                      <div className={cn(
                        "flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold border transition-colors",
                        builderStep === step.num ? "bg-[var(--m-accent)] border-[var(--m-accent)] text-white" :
                        builderStep > step.num ? "bg-[var(--m-surface)] border-[var(--m-border-2)] m-text-dim" :
                        "bg-transparent border-[var(--m-border)] m-text-dim"
                      )}>
                        {builderStep > step.num ? <Check className="h-3 w-3" /> : step.num}
                      </div>
                      <div className={cn(
                        "text-xs font-semibold whitespace-nowrap",
                        builderStep === step.num ? "text-[var(--m-text)]" : "m-text-dim"
                      )}>
                        {step.title}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Step Content */}
              <div className="flex-1 p-6 md:p-8 overflow-y-auto">
                
                {builderStep === 1 && (
                  <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                    <div>
                      <h3 className="text-xl font-bold m-text-text">Select Campaign Goal</h3>
                      <p className="text-sm m-text-muted mt-1">What is the primary verified action you want to drive?</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {['Drive pre-saves', 'Sell tickets', 'Promote merch', 'Generate VIP interest', 'Reactivate fan club', 'Capture feedback'].map((goal) => (
                        <div key={goal} className="p-4 border border-[var(--m-border)] rounded-md bg-[var(--m-surface-2)] hover:bg-[var(--m-surface)] hover:border-[var(--m-accent)] cursor-pointer transition-all">
                          <span className="text-sm font-semibold m-text-text">{goal}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {builderStep === 2 && (
                  <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                    <div>
                      <h3 className="text-xl font-bold m-text-text">Artist & Project Details</h3>
                      <p className="text-sm m-text-muted mt-1">Define the core entity for this campaign.</p>
                    </div>
                    <div className="space-y-5">
                      <div>
                        <label className="block text-xs font-semibold m-text-muted mb-2 uppercase tracking-wider">Artist Name</label>
                        <input type="text" placeholder="e.g., Nova Ray" className="w-full bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded-md px-4 py-3 text-sm focus:outline-none focus:border-[var(--m-accent)] text-[var(--m-text)]" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold m-text-muted mb-2 uppercase tracking-wider">Release / Tour Name</label>
                        <input type="text" placeholder="e.g., Midnight Signal" className="w-full bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded-md px-4 py-3 text-sm focus:outline-none focus:border-[var(--m-accent)] text-[var(--m-text)]" />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                        <div>
                          <label className="block text-xs font-semibold m-text-muted mb-2 uppercase tracking-wider">Launch Date</label>
                          <input type="date" className="w-full bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded-md px-4 py-3 text-sm focus:outline-none focus:border-[var(--m-accent)] text-[var(--m-text)] [&::-webkit-calendar-picker-indicator]:invert" />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold m-text-muted mb-2 uppercase tracking-wider">Market / City</label>
                          <input type="text" placeholder="Optional" className="w-full bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded-md px-4 py-3 text-sm focus:outline-none focus:border-[var(--m-accent)] text-[var(--m-text)]" />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {builderStep === 3 && (
                  <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                    <div>
                      <h3 className="text-xl font-bold m-text-text">Target Audience</h3>
                      <p className="text-sm m-text-muted mt-1">Select the opted-in fan segments for outreach.</p>
                    </div>
                    <div className="space-y-6">
                      <div className="p-6 border-2 border-dashed border-[var(--m-border)] rounded-md bg-[var(--m-surface-2)] text-center hover:bg-[var(--m-surface)] cursor-pointer transition-colors">
                        <Users className="h-8 w-8 m-text-dim mx-auto mb-3" />
                        <span className="text-sm font-semibold text-[var(--m-text)]">Upload Opted-In Fan List (CSV)</span>
                        <p className="text-xs m-text-muted mt-2 max-w-sm mx-auto">Must contain phone numbers and explicit TCPA consent logs.</p>
                      </div>
                      <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                          <div className="w-full border-t border-[var(--m-border-2)]"></div>
                        </div>
                        <div className="relative flex justify-center">
                          <span className="bg-[var(--m-surface)] px-3 text-xs uppercase font-semibold m-text-dim tracking-wider">Or</span>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold m-text-muted mb-3 uppercase tracking-wider">Select Existing Segment</label>
                        <div className="flex flex-wrap gap-2.5">
                          {['Superfans', 'Previous merch buyers', 'Tour city fans', 'Stream save audience', 'VIP List', 'Fan club inactive'].map(s => (
                            <span key={s} className="px-3 py-1.5 bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded text-xs font-medium m-text-text cursor-pointer hover:border-[var(--m-accent)] transition-colors">{s}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {builderStep === 4 && (
                  <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                    <div>
                      <h3 className="text-xl font-bold m-text-text">Message & Scripting</h3>
                      <p className="text-sm m-text-muted mt-1">Configure the AI voice persona and conversational bounds.</p>
                    </div>
                    <div className="space-y-5">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                        <div>
                          <label className="block text-xs font-semibold m-text-muted mb-2 uppercase tracking-wider">Voice Persona</label>
                          <select className="w-full bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded-md px-4 py-3 text-sm focus:outline-none focus:border-[var(--m-accent)] text-[var(--m-text)]">
                            <option>Luna (Warm / Authentic)</option>
                            <option>Blaze (Energetic / Direct)</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold m-text-muted mb-2 uppercase tracking-wider">Pacing</label>
                          <select className="w-full bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded-md px-4 py-3 text-sm focus:outline-none focus:border-[var(--m-accent)] text-[var(--m-text)]">
                            <option>Conversational (Standard)</option>
                            <option>Urgent (Ticket Drops)</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold m-text-muted mb-2 uppercase tracking-wider">Artist-Approved Opening Line</label>
                        <textarea rows={2} placeholder="Hey, this is Nova's team reaching out..." className="w-full bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded-md px-4 py-3 text-sm focus:outline-none focus:border-[var(--m-accent)] text-[var(--m-text)] resize-none" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold m-text-muted mb-2 uppercase tracking-wider">Primary Call to Action (CTA)</label>
                        <input type="text" placeholder="Want me to set up a pre-save on Spotify for you?" className="w-full bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded-md px-4 py-3 text-sm focus:outline-none focus:border-[var(--m-accent)] text-[var(--m-text)]" />
                      </div>
                      <div className="p-4 bg-[var(--m-surface-2)] border border-emerald-500/20 rounded-md flex gap-3 text-sm text-emerald-400">
                        <ShieldCheck className="h-5 w-5 shrink-0" />
                        <p>Mandatory compliance disclosures (AI disclosure, opt-out instructions) are automatically injected based on regional dialing codes.</p>
                      </div>
                    </div>
                  </div>
                )}

                {builderStep === 5 && (
                  <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                    <div>
                      <h3 className="text-xl font-bold m-text-text">Proof & Tracking</h3>
                      <p className="text-sm m-text-muted mt-1">Map conversational outcomes to measurable links and evidence.</p>
                    </div>
                    <div className="space-y-6">
                      <div>
                        <label className="block text-xs font-semibold m-text-muted mb-2 uppercase tracking-wider">Destination Link (SMS Fallback)</label>
                        <input type="url" placeholder="https://ffm.to/midnightsignal" className="w-full bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded-md px-4 py-3 text-sm focus:outline-none focus:border-[var(--m-accent)] text-[var(--m-text)]" />
                      </div>
                      <div className="space-y-4 pt-4 border-t border-[var(--m-border-2)]">
                        <h4 className="text-xs font-bold uppercase tracking-wider m-text-text mb-3">Interaction Evidence Collection</h4>
                        {[
                          'Record all fan audio (where legally permitted)',
                          'Transcribe interactions verbatim',
                          'Run real-time sentiment analysis',
                          'Capture strict intent flags (High/Medium/Low)',
                        ].map(opt => (
                          <label key={opt} className="flex items-center gap-3 text-sm m-text-dim hover:text-[var(--m-text)] cursor-pointer">
                            <input type="checkbox" defaultChecked className="accent-[var(--m-accent)] h-4 w-4" />
                            {opt}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {builderStep === 6 && (
                  <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                    <div>
                      <h3 className="text-xl font-bold m-text-text">Review & Launch</h3>
                      <p className="text-sm m-text-muted mt-1">Verify your campaign architecture before live dialing.</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      <div className="space-y-4">
                        <div className="bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded-md p-4">
                          <p className="text-xs font-semibold uppercase tracking-wider m-text-muted mb-1">Total Audience</p>
                          <p className="text-2xl font-bold m-text-text">12,400 <span className="text-sm font-normal m-text-dim">fans</span></p>
                        </div>
                        <div className="bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded-md p-4">
                          <p className="text-xs font-semibold uppercase tracking-wider m-text-muted mb-1">Estimated Contact Rate</p>
                          <p className="text-2xl font-bold m-text-accent">65% <span className="text-sm font-normal m-text-dim">~8,060 answers</span></p>
                        </div>
                        <div className="bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded-md p-4">
                          <p className="text-xs font-semibold uppercase tracking-wider m-text-muted mb-1">Projected Verified Actions</p>
                          <p className="text-2xl font-bold text-emerald-400">4,200 <span className="text-sm font-normal m-text-dim">actions</span></p>
                        </div>
                      </div>
                      
                      <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-md p-6">
                        <h4 className="text-sm font-bold mb-4 uppercase tracking-wider flex items-center gap-2 text-emerald-400">
                          <ShieldCheck className="h-5 w-5" /> Compliance Clear
                        </h4>
                        <ul className="space-y-3 text-sm text-emerald-400/80">
                          <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> DNC Registry scrubbed</li>
                          <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> AI disclosure present</li>
                          <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> Timezone bounds checked</li>
                          <li className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> Opt-out phrasing verified</li>
                        </ul>
                        <div className="mt-8 pt-4 border-t border-emerald-500/20">
                          <p className="text-xs font-semibold uppercase tracking-wider m-text-muted mb-1">Estimated CPA</p>
                          <p className="text-2xl font-mono text-[var(--m-text)]">$1.15 - $1.40</p>
                        </div>
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
                className={cn("px-4 py-2 text-sm font-semibold rounded-md transition-colors", builderStep === 1 ? "invisible" : "m-text-dim hover:text-[var(--m-text)] hover:bg-[var(--m-border-2)]")}
              >
                Back
              </button>
              
              {builderStep < 6 ? (
                <button 
                  onClick={() => setBuilderStep(builderStep + 1)}
                  className="flex items-center gap-2 px-6 py-2 bg-[var(--m-surface)] border border-[var(--m-border)] text-white rounded-md text-sm font-semibold hover:border-[var(--m-accent)] transition-colors"
                >
                  Continue <ChevronRight className="h-4 w-4" />
                </button>
              ) : (
                <button 
                  onClick={() => setIsBuilderOpen(false)}
                  className="flex items-center gap-2 px-6 py-2 bg-[var(--m-accent)] text-white rounded-md text-sm font-semibold hover:bg-violet-600 transition-colors"
                >
                  <Play className="h-4 w-4 fill-current" /> Launch Campaign
                </button>
              )}
            </div>
            
          </div>
        </div>
      )}
    </div>
  );
}
