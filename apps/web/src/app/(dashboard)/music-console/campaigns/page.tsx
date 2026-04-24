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
} from 'lucide-react';
import { useState } from 'react';

import { fanCampaigns } from '@/features/music/data/demo-music-data';
import { campaignTypeLabel, formatCompactNumber, formatCurrency, segmentLabel } from '@/features/music/lib/utils';
import { cn } from '@/lib/utils';

export default function MusicCampaignsPage() {
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [builderStep, setBuilderStep] = useState(1);

  const totalActive = fanCampaigns.filter(c => c.status === 'active').length;
  const totalVerified = fanCampaigns.reduce((s, c) => s + c.verifiedEngagements, 0);

  return (
    <div className="relative z-10 p-6 md:p-8 space-y-8">
      
      {/* ─── Header ─── */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[var(--m-border-2)] pb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
            <Megaphone className="h-6 w-6 m-text-accent" /> Fan Campaigns
          </h1>
          <p className="mt-1 text-sm m-text-muted max-w-xl">
            Design, deploy, and monitor direct-to-fan AI voice campaigns.
            Active: {totalActive} | Total Verified Actions: {formatCompactNumber(totalVerified)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button className="m-btn m-btn--secondary">
            <ListFilter className="h-4 w-4" /> Filter
          </button>
          <button 
            onClick={() => { setIsBuilderOpen(true); setBuilderStep(1); }}
            className="m-btn m-btn--primary"
          >
            <Plus className="h-4 w-4" /> New Campaign
          </button>
        </div>
      </header>

      {/* ─── Campaign Table ─── */}
      <section className="m-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="m-table">
            <thead>
              <tr>
                <th>Campaign Name</th>
                <th>Artist</th>
                <th>Type</th>
                <th>Segment</th>
                <th>Status</th>
                <th className="text-right">Contacted</th>
                <th className="text-right">Answer Rate</th>
                <th className="text-right">Verified</th>
                <th className="text-right">CPA</th>
                <th className="text-right">Proof</th>
                <th>Start Date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {fanCampaigns.map((c) => (
                <tr key={c.id}>
                  <td className="font-medium text-[var(--m-text)]">{c.name}</td>
                  <td className="m-text-muted">{c.artist}</td>
                  <td>
                    <span className="m-badge m-badge--neutral">
                      {campaignTypeLabel(c.type)}
                    </span>
                  </td>
                  <td className="m-text-muted text-[11px]">{segmentLabel(c.segment)}</td>
                  <td>
                    <span className={cn(
                      "m-badge",
                      c.status === 'active' ? 'm-badge--active' :
                      c.status === 'completed' ? 'm-badge--completed' :
                      c.status === 'paused' ? 'm-badge--paused' : 'm-badge--draft'
                    )}>
                      {c.status === 'active' && <span className="m-pulse-dot" style={{ width: '6px', height: '6px' }} />}
                      {c.status}
                    </span>
                  </td>
                  <td className="text-right m-font-mono">{formatCompactNumber(c.fansContacted)}</td>
                  <td className="text-right m-font-mono m-text-accent">{c.answerRate}%</td>
                  <td className="text-right m-font-mono m-text-accent-2">{formatCompactNumber(c.verifiedEngagements)}</td>
                  <td className="text-right m-font-mono">{c.cpa > 0 ? formatCurrency(c.cpa) : '\u2014'}</td>
                  <td className="text-right m-font-mono m-text-muted">{formatCompactNumber(c.proofCaptured)}</td>
                  <td className="m-text-dim m-font-mono text-[11px]">{c.startDate}</td>
                  <td className="text-right">
                    <button className="m-text-dim hover:text-[var(--m-text)]"><MoreHorizontal className="h-4 w-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ─── Campaign Builder Modal ─── */}
      {isBuilderOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-6">
          <div className="w-full max-w-4xl m-card shadow-2xl flex flex-col max-h-[90vh]">
            
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--m-border-2)]">
              <h2 className="text-lg font-bold flex items-center gap-2">
                <Mic className="h-5 w-5 m-text-accent" /> New Fan Campaign
              </h2>
              <button onClick={() => setIsBuilderOpen(false)} className="m-text-dim hover:text-[var(--m-text)]">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex flex-1 overflow-hidden">
              {/* Sidebar Steps */}
              <div className="w-64 border-r border-[var(--m-border-2)] p-6 m-bg-surface overflow-y-auto">
                <div className="space-y-6">
                  {[
                    { num: 1, title: 'Campaign Goal' },
                    { num: 2, title: 'Artist / Project' },
                    { num: 3, title: 'Audience' },
                    { num: 4, title: 'Message & Script' },
                    { num: 5, title: 'Proof & Tracking' },
                    { num: 6, title: 'Review & Launch' },
                  ].map((step) => (
                    <div key={step.num} className="flex items-start gap-3">
                      <div className={cn(
                        "flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold border",
                        builderStep === step.num ? "bg-[var(--m-accent)] border-[var(--m-accent)] text-white" :
                        builderStep > step.num ? "bg-[var(--m-surface-2)] border-transparent m-text-dim" :
                        "bg-transparent border-[var(--m-border)] m-text-dim"
                      )}>
                        {builderStep > step.num ? <Check className="h-3 w-3" /> : step.num}
                      </div>
                      <div className={cn(
                        "text-xs font-semibold",
                        builderStep === step.num ? "text-[var(--m-text)]" : "m-text-dim"
                      )}>
                        {step.title}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Step Content */}
              <div className="flex-1 p-8 overflow-y-auto">
                
                {builderStep === 1 && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-lg font-bold">Select Campaign Goal</h3>
                      <p className="text-sm m-text-muted">What is the primary verified action you want to drive?</p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      {['Drive pre-saves', 'Sell tickets', 'Promote merch', 'Generate VIP interest', 'Reactivate fan club', 'Capture feedback'].map((goal) => (
                        <div key={goal} className="p-4 border border-[var(--m-border)] rounded m-bg-surface hover:m-bg-surface-2 hover:border-[var(--m-accent)] cursor-pointer transition-all">
                          <span className="text-sm font-semibold">{goal}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {builderStep === 2 && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-lg font-bold">Artist & Project Details</h3>
                      <p className="text-sm m-text-muted">Define the core entity for this campaign.</p>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-medium m-text-dim mb-1.5 uppercase tracking-wider">Artist Name</label>
                        <input type="text" placeholder="e.g., Nova Ray" className="w-full bg-[var(--m-bg)] border border-[var(--m-border)] rounded px-4 py-2.5 text-sm focus:outline-none focus:border-[var(--m-accent)]" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium m-text-dim mb-1.5 uppercase tracking-wider">Release / Tour Name</label>
                        <input type="text" placeholder="e.g., Midnight Signal" className="w-full bg-[var(--m-bg)] border border-[var(--m-border)] rounded px-4 py-2.5 text-sm focus:outline-none focus:border-[var(--m-accent)]" />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-medium m-text-dim mb-1.5 uppercase tracking-wider">Launch Date</label>
                          <input type="date" className="w-full bg-[var(--m-bg)] border border-[var(--m-border)] rounded px-4 py-2.5 text-sm focus:outline-none focus:border-[var(--m-accent)] [&::-webkit-calendar-picker-indicator]:invert" />
                        </div>
                        <div>
                          <label className="block text-xs font-medium m-text-dim mb-1.5 uppercase tracking-wider">Market / City</label>
                          <input type="text" placeholder="Optional" className="w-full bg-[var(--m-bg)] border border-[var(--m-border)] rounded px-4 py-2.5 text-sm focus:outline-none focus:border-[var(--m-accent)]" />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {builderStep === 3 && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-lg font-bold">Target Audience</h3>
                      <p className="text-sm m-text-muted">Select the opted-in fan segments for outreach.</p>
                    </div>
                    <div className="space-y-4">
                      <div className="p-4 border border-dashed border-[var(--m-border)] rounded m-bg-surface text-center hover:m-bg-surface-2 cursor-pointer">
                        <Users className="h-6 w-6 m-text-dim mx-auto mb-2" />
                        <span className="text-sm font-semibold">Upload Opted-In Fan List (CSV)</span>
                        <p className="text-xs m-text-dim mt-1">Must contain phone numbers and explicit TCPA consent.</p>
                      </div>
                      <div>
                        <label className="block text-xs font-medium m-text-dim mb-2 uppercase tracking-wider">Or Select Existing Segment</label>
                        <div className="flex flex-wrap gap-2">
                          {['Superfans', 'Previous merch buyers', 'Tour city fans', 'Stream save audience', 'VIP List', 'Fan club inactive'].map(s => (
                            <span key={s} className="m-filter-pill">{s}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {builderStep === 4 && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-lg font-bold">Message & Scripting</h3>
                      <p className="text-sm m-text-muted">Configure the AI voice persona and conversational bounds.</p>
                    </div>
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-medium m-text-dim mb-1.5 uppercase tracking-wider">Voice Persona</label>
                          <select className="w-full bg-[var(--m-bg)] border border-[var(--m-border)] rounded px-4 py-2.5 text-sm focus:outline-none focus:border-[var(--m-accent)]">
                            <option>Luna (Warm / Authentic)</option>
                            <option>Blaze (Energetic / Direct)</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium m-text-dim mb-1.5 uppercase tracking-wider">Pacing</label>
                          <select className="w-full bg-[var(--m-bg)] border border-[var(--m-border)] rounded px-4 py-2.5 text-sm focus:outline-none focus:border-[var(--m-accent)]">
                            <option>Conversational (Standard)</option>
                            <option>Urgent (Ticket Drops)</option>
                          </select>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-medium m-text-dim mb-1.5 uppercase tracking-wider">Artist-Approved Opening Line</label>
                        <textarea rows={2} placeholder="Hey, this is Nova's team reaching out..." className="w-full bg-[var(--m-bg)] border border-[var(--m-border)] rounded px-4 py-2.5 text-sm focus:outline-none focus:border-[var(--m-accent)]" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium m-text-dim mb-1.5 uppercase tracking-wider">Primary Call to Action (CTA)</label>
                        <input type="text" placeholder="Want me to set up a pre-save on Spotify for you?" className="w-full bg-[var(--m-bg)] border border-[var(--m-border)] rounded px-4 py-2.5 text-sm focus:outline-none focus:border-[var(--m-accent)]" />
                      </div>
                      <div className="p-3 m-bg-surface border border-[var(--m-border-2)] rounded flex gap-3 text-xs m-text-muted">
                        <ShieldCheck className="h-4 w-4 m-text-accent-2 shrink-0" />
                        <p>Mandatory compliance disclosures (AI disclosure, opt-out instructions) are automatically injected based on region.</p>
                      </div>
                    </div>
                  </div>
                )}

                {builderStep === 5 && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-lg font-bold">Proof & Tracking</h3>
                      <p className="text-sm m-text-muted">Map conversational outcomes to measurable links and evidence.</p>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-medium m-text-dim mb-1.5 uppercase tracking-wider">Destination Link (SMS Fallback)</label>
                        <input type="url" placeholder="https://ffm.to/midnightsignal" className="w-full bg-[var(--m-bg)] border border-[var(--m-border)] rounded px-4 py-2.5 text-sm focus:outline-none focus:border-[var(--m-accent)]" />
                      </div>
                      <div className="space-y-3 mt-6">
                        <h4 className="text-xs font-bold uppercase tracking-wider border-b border-[var(--m-border-2)] pb-2">Interaction Evidence</h4>
                        {[
                          'Record all fan audio (where legally permitted)',
                          'Transcribe interactions verbatim',
                          'Run real-time sentiment analysis',
                          'Capture strict intent flags (High/Medium/Low)',
                        ].map(opt => (
                          <label key={opt} className="flex items-center gap-3 text-sm">
                            <input type="checkbox" defaultChecked className="accent-[var(--m-accent)] h-4 w-4" />
                            {opt}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {builderStep === 6 && (
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-lg font-bold">Review & Launch</h3>
                      <p className="text-sm m-text-muted">Verify your campaign architecture before live dialing.</p>
                    </div>
                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-4">
                        <div className="m-kpi">
                          <p className="m-kpi-label">Total Audience</p>
                          <p className="m-kpi-value">12,400 <span className="text-xs m-text-dim">fans</span></p>
                        </div>
                        <div className="m-kpi">
                          <p className="m-kpi-label">Estimated Contact Rate</p>
                          <p className="m-kpi-value m-text-accent-2">65% <span className="text-xs m-text-dim">~8,060 answers</span></p>
                        </div>
                        <div className="m-kpi">
                          <p className="m-kpi-label">Projected Verified Actions</p>
                          <p className="m-kpi-value m-text-accent-2">4,200 <span className="text-xs m-text-dim">actions</span></p>
                        </div>
                      </div>
                      
                      <div className="m-card-deep p-5">
                        <h4 className="text-xs font-bold mb-4 uppercase tracking-wider flex items-center gap-2">
                          <ShieldCheck className="h-4 w-4 m-text-accent-2" /> Compliance Clear
                        </h4>
                        <ul className="space-y-3 text-xs m-text-muted">
                          <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 m-text-dim" /> DNC Registry scrubbed</li>
                          <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 m-text-dim" /> AI disclosure present</li>
                          <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 m-text-dim" /> Timezone bounds checked</li>
                          <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 m-text-dim" /> Opt-out phrasing verified</li>
                        </ul>
                        <div className="mt-8 pt-4 border-t border-[var(--m-border-2)]">
                          <p className="text-[10px] uppercase m-text-dim mb-1">Estimated CPA</p>
                          <p className="text-xl m-font-mono m-text-accent">$1.15 - $1.40</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

              </div>
            </div>

            {/* Footer Actions */}
            <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--m-border-2)] m-bg-surface">
              <button 
                onClick={() => setBuilderStep(Math.max(1, builderStep - 1))}
                className={cn("m-btn m-btn--ghost", builderStep === 1 && "invisible")}
              >
                Back
              </button>
              
              {builderStep < 6 ? (
                <button 
                  onClick={() => setBuilderStep(builderStep + 1)}
                  className="m-btn m-btn--cta"
                >
                  Continue <ChevronRight className="h-4 w-4" />
                </button>
              ) : (
                <button 
                  onClick={() => setIsBuilderOpen(false)}
                  className="m-btn m-btn--primary"
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
