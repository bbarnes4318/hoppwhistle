'use client';

import {
  BarChart3,
  Calendar,
  CheckCircle2,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  Headphones,
  Music,
  Printer,
  ShieldCheck,
  Target,
  Users,
} from 'lucide-react';

import { funnelData, topSegmentsData } from '@/features/music/data/demo-music-data';
import { formatCompactNumber, formatCurrency } from '@/features/music/lib/utils';

export default function MusicReportsPage() {
  const outcomeBreakdown = [
    { label: 'Pre-Save (Spotify/Apple)', count: 3616, rate: 44.1, spend: 3977.60, cpa: 1.10, proof: 3616 },
    { label: 'Ticket Intent (Waitlist)', count: 1205, rate: 14.7, spend: 3012.50, cpa: 2.50, proof: 1205 },
    { label: 'Merch Intent (Capsule)', count: 850, rate: 10.3, spend: 1572.50, cpa: 1.85, proof: 850 },
    { label: 'VIP Interest', count: 420, rate: 5.1, spend: 1890.00, cpa: 4.50, proof: 420 },
    { label: 'Fan Club Reactivation', count: 890, rate: 10.8, spend: 2759.00, cpa: 3.10, proof: 890 },
    { label: 'Feedback Completed', count: 1219, rate: 14.8, spend: 1097.10, cpa: 0.90, proof: 1219 },
  ];

  return (
    <div className="relative z-10 p-6 md:p-8">
      
      {/* ─── Header & Toolbar ─── */}
      <header className="flex flex-col md:flex-row md:items-start justify-between gap-4 border-b border-[var(--m-border-2)] pb-6 mb-8">
        <div>
          <div className="flex items-center gap-2 m-text-dim text-xs font-medium uppercase tracking-widest mb-2">
            <Music className="h-4 w-4 m-text-accent" /> Executive Report
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Midnight Signal Pre-Save</h1>
          <p className="mt-1 text-sm m-text-muted">
            Nova Ray • April 10 – April 24, 2026
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button className="m-btn m-btn--secondary">
            <Calendar className="h-4 w-4" /> Last 14 Days
          </button>
          <button className="m-btn m-btn--secondary">
            <Printer className="h-4 w-4" /> Print / PDF
          </button>
          <button className="m-btn m-btn--primary">
            <Download className="h-4 w-4" /> Export Report
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Left Column */}
        <div className="lg:col-span-2 space-y-8">
          
          {/* 1. Performance Summary */}
          <section>
            <h2 className="m-section-title mb-4">
              <Target className="!text-[var(--m-accent-2)]" /> Performance Summary
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Audience Size', value: '12,400', icon: Users },
                { label: 'Fans Contacted', value: '8,200', icon: Headphones },
                { label: 'Answer Rate', value: '63%', icon: BarChart3 },
                { label: 'Verified Actions', value: '3,616', icon: CheckCircle2 },
                { label: 'Overall CPA', value: '$1.12', icon: FileSpreadsheet },
                { label: 'Total Spend', value: '$4,050', icon: ShieldCheck },
                { label: 'Proof Captured', value: '5,100', icon: FileText },
                { label: 'Opt-Out Rate', value: '0.8%', icon: Filter },
              ].map((metric) => (
                <div key={metric.label} className="m-kpi">
                  <div className="flex items-center justify-between">
                    <span className="m-kpi-label">{metric.label}</span>
                    <metric.icon className="h-3 w-3 m-text-dim" />
                  </div>
                  <div className="m-kpi-value text-xl">{metric.value}</div>
                </div>
              ))}
            </div>
          </section>

          {/* 2. Engagement Funnel */}
          <section>
            <h2 className="m-section-title mb-4 mt-8">
              <BarChart3 /> Engagement Funnel
            </h2>
            <div className="m-card p-6 space-y-5">
              {funnelData.map((stage) => (
                <div key={stage.label} className="flex items-center gap-4">
                  <div className="w-32 text-xs font-semibold m-text-muted text-right">{stage.label}</div>
                  <div className="flex-1 h-10 rounded bg-[var(--m-surface-2)] flex items-center overflow-hidden">
                    <div 
                      className="m-funnel-bar"
                      style={{ width: `${stage.percentage}%`, backgroundColor: stage.color }}
                    >
                      <span className="m-funnel-label">
                        {formatCompactNumber(stage.count)}
                      </span>
                    </div>
                  </div>
                  <div className="w-12 text-right text-xs m-font-mono m-text-dim">{stage.percentage.toFixed(1)}%</div>
                </div>
              ))}
            </div>
          </section>

          {/* 3. CPA / Outcome Table */}
          <section>
            <h2 className="m-section-title mb-4 mt-8">
              <FileSpreadsheet className="!text-[var(--m-accent-2)]" /> Outcome Economics
            </h2>
            <div className="m-card overflow-hidden">
              <table className="m-table">
                <thead>
                  <tr>
                    <th>Verified Outcome</th>
                    <th className="text-right">Count</th>
                    <th className="text-right">Conv. Rate</th>
                    <th className="text-right">Spend</th>
                    <th className="text-right">CPA</th>
                    <th className="text-right">Proof Records</th>
                  </tr>
                </thead>
                <tbody>
                  {outcomeBreakdown.map((row) => (
                    <tr key={row.label}>
                      <td className="font-bold text-[var(--m-text)]">{row.label}</td>
                      <td className="text-right m-font-mono">{formatCompactNumber(row.count)}</td>
                      <td className="text-right m-font-mono m-text-accent-2">{row.rate}%</td>
                      <td className="text-right m-font-mono m-text-muted">{formatCurrency(row.spend)}</td>
                      <td className="text-right m-font-mono m-text-accent">{formatCurrency(row.cpa)}</td>
                      <td className="text-right m-font-mono m-text-accent-2 flex items-center justify-end gap-2">
                        <ShieldCheck className="h-3.5 w-3.5 opacity-50" /> {formatCompactNumber(row.proof)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

        </div>

        {/* Right Column (Sidebar) */}
        <div className="space-y-8">

          {/* Executive Summary */}
          <section>
            <h2 className="m-section-title mb-4">
              <FileText className="!text-[var(--m-accent-2)]" /> Executive Summary
            </h2>
            <div className="m-card p-6 relative group">
              <button className="absolute top-4 right-4 m-text-dim hover:text-[var(--m-text)] transition-colors opacity-0 group-hover:opacity-100 flex items-center gap-1 text-[10px] uppercase font-bold tracking-widest">
                <Copy className="h-3 w-3" /> Copy
              </button>
              <p className="text-sm leading-relaxed m-text-muted font-serif italic">
                &ldquo;The <strong className="text-[var(--m-text)] not-italic">Midnight Signal Pre-Save</strong> campaign generated <strong className="text-[var(--m-text)] not-italic">3,616</strong> verified fan engagements from <strong className="text-[var(--m-text)] not-italic">8,200</strong> contacted fans at a <strong className="m-text-accent not-italic">$1.12</strong> blended cost per verified action.
                <br /><br />
                The highest-performing segment was <strong className="text-[var(--m-text)] not-italic">Superfans</strong> with an <strong className="m-text-accent-2 not-italic">88%</strong> engagement rate. We captured <strong className="text-[var(--m-text)] not-italic">5,100</strong> total proof records (recordings + verbatim transcripts).
                <br /><br />
                <strong>Recommended Next Action:</strong> Target the highly-engaged <span className="underline decoration-white/20 underline-offset-4">Tour City audience</span> with the secondary VIP Upsell flow ahead of Friday&apos;s general on-sale.&rdquo;
              </p>
            </div>
          </section>

          {/* Segment Analysis */}
          <section>
            <h2 className="m-section-title mb-4 mt-8">
              <Users /> Segment Analysis
            </h2>
            <div className="m-card p-5 space-y-4">
              {topSegmentsData.map((seg) => (
                <div key={seg.segment} className="flex items-center justify-between border-b border-[var(--m-border-2)] pb-4 last:border-0 last:pb-0">
                  <div>
                    <div className="text-xs font-bold">{seg.segment}</div>
                    <div className="text-[10px] m-text-dim uppercase tracking-wider mt-0.5">{formatCompactNumber(seg.count)} Fans Uploaded</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm m-font-mono font-bold m-text-accent-2">{seg.engagement}%</div>
                    <div className="text-[9px] uppercase tracking-wider m-text-dim">Engaged</div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Export Center */}
          <section>
            <h2 className="m-section-title mb-4 mt-8">
              <Download className="!text-[var(--m-accent-2)]" /> Export Center
            </h2>
            <div className="grid grid-cols-1 gap-3">
              <button className="flex items-center justify-between p-4 m-card-flush hover:bg-[var(--m-surface-2)] transition-colors group">
                <div className="flex items-center gap-3">
                  <FileSpreadsheet className="h-5 w-5 m-text-dim group-hover:m-text-accent transition-colors" />
                  <div className="text-left">
                    <div className="text-xs font-bold">Export Campaign Report</div>
                    <div className="text-[10px] m-text-dim">.XLSX • Full metrics and funnel</div>
                  </div>
                </div>
                <Download className="h-4 w-4 m-text-dim" />
              </button>

              <button className="flex items-center justify-between p-4 m-card-flush hover:bg-[var(--m-surface-2)] transition-colors group">
                <div className="flex items-center gap-3">
                  <ShieldCheck className="h-5 w-5 m-text-dim group-hover:m-text-accent-2 transition-colors" />
                  <div className="text-left">
                    <div className="text-xs font-bold">Export Proof Log</div>
                    <div className="text-[10px] m-text-dim">.CSV • Interaction timestamps & IDs</div>
                  </div>
                </div>
                <Download className="h-4 w-4 m-text-dim" />
              </button>

              <button className="flex items-center justify-between p-4 m-card-flush hover:bg-[var(--m-surface-2)] transition-colors group">
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 m-text-dim group-hover:m-text-accent-2 transition-colors" />
                  <div className="text-left">
                    <div className="text-xs font-bold">Download Transcripts</div>
                    <div className="text-[10px] m-text-dim">.ZIP • 3,616 Verbatim TXT files</div>
                  </div>
                </div>
                <Download className="h-4 w-4 m-text-dim" />
              </button>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
