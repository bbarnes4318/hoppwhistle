'use client';

import {
  Activity,
  CheckCircle2,
  DollarSign,
  FileText,
  Headphones,
  Mic,
  ShieldCheck,
  TrendingUp,
  Users,
  ArrowRight,
} from 'lucide-react';
import Link from 'next/link';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  campaignTimeSeries,
  funnelData,
  livePulse,
  proofRecords,
  topKpis,
  topSegmentsData,
} from '@/features/music/data/demo-music-data';
import { formatCompactNumber, formatCurrency, outcomeLabel, segmentLabel } from '@/features/music/lib/utils';
import { cn } from '@/lib/utils';

export default function MusicConsolePage() {
  return (
    <div className="space-y-5">
      
      {/* ─── Header ─── */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[var(--m-border-2)] pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Music Console</h1>
          <p className="mt-1 text-sm m-text-muted max-w-xl">
            Real-time fan engagement, verified actions, and proof-backed campaign performance.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="m-badge m-badge--active">
            <span className="m-pulse-dot" />
            <span>Live Dialing</span>
          </div>
        </div>
      </header>

      {/* ─── 1. Top KPI Cards ─── */}
      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: 'Fans Contacted', data: topKpis.fansContacted, icon: Users },
          { label: 'Human Answers', data: topKpis.humanAnswers, icon: Headphones },
          { label: 'Verified Engagements', data: topKpis.verifiedEngagements, icon: ShieldCheck },
          { label: 'Pre-Saves', data: topKpis.preSaves, icon: CheckCircle2 },
          { label: 'Cost per Pre-Save', data: topKpis.costPerPreSave, icon: DollarSign, isCurrency: true },
          { label: 'Proof Captured', data: topKpis.proofCaptured, icon: FileText },
        ].map((kpi) => (
          <div key={kpi.label} className="m-kpi">
            <div className="flex items-start justify-between">
              <span className="m-kpi-label">{kpi.label}</span>
              <kpi.icon className="h-4 w-4 m-text-dim" />
            </div>
            <div className="flex items-end justify-between">
              <span className="m-kpi-value">
                {kpi.isCurrency ? formatCurrency(kpi.data.value) : formatCompactNumber(kpi.data.value)}
              </span>
              <span className={cn(
                "m-kpi-delta",
                kpi.isCurrency
                  ? (kpi.data.change < 0 ? "m-kpi-delta--up" : "m-kpi-delta--down")
                  : (kpi.data.change > 0 ? "m-kpi-delta--up" : "m-kpi-delta--down")
              )}>
                {kpi.data.change > 0 ? '+' : ''}{kpi.data.change}%
              </span>
            </div>
          </div>
        ))}
      </section>

      {/* ─── Middle Row: Funnel & Pulse ─── */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Funnel */}
        <div className="lg:col-span-2 m-card p-6">
          <h2 className="m-section-title mb-6">
            <TrendingUp /> Fan Engagement Funnel
          </h2>
          <div className="space-y-4">
            {funnelData.map((stage) => (
              <div key={stage.label} className="flex items-center gap-4">
                <div className="w-32 text-xs font-medium m-text-muted text-right">{stage.label}</div>
                <div className="flex-1 h-9 rounded bg-[var(--m-surface-2)] flex items-center overflow-hidden">
                  <div 
                    className="m-funnel-bar"
                    style={{ width: `${stage.percentage}%`, backgroundColor: stage.color }}
                  >
                    <span className="m-funnel-label">
                      {formatCompactNumber(stage.count)}
                    </span>
                  </div>
                </div>
                <div className="w-12 text-right text-[10px] m-font-mono m-text-dim">{stage.percentage.toFixed(1)}%</div>
              </div>
            ))}
          </div>
        </div>

        {/* Live Pulse */}
        <div className="m-card p-6 flex flex-col">
          <h2 className="m-section-title mb-6">
            <Activity className="!text-[var(--m-accent-2)]" /> Live Campaign Pulse
          </h2>
          <div className="flex-1 m-card-deep p-4">
            <div className="mb-4 pb-4 border-b border-[var(--m-border-2)]">
              <div className="text-[10px] font-semibold m-text-accent-2 uppercase tracking-widest mb-1">Active Campaign</div>
              <div className="text-lg font-bold truncate">{livePulse.campaignName}</div>
              <div className="text-xs m-text-muted mt-1">{livePulse.artist} • {livePulse.segment}</div>
            </div>
            
            <div className="grid grid-cols-2 gap-y-4 gap-x-2">
              <div>
                <div className="text-[10px] uppercase m-text-dim">Contact Rate</div>
                <div className="text-base m-font-mono mt-0.5">{livePulse.contactRate}%</div>
              </div>
              <div>
                <div className="text-[10px] uppercase m-text-dim">Answer Rate</div>
                <div className="text-base m-font-mono mt-0.5">{livePulse.answerRate}%</div>
              </div>
              <div>
                <div className="text-[10px] uppercase m-text-dim">Verified Action</div>
                <div className="text-base m-font-mono m-text-accent-2 mt-0.5">{livePulse.verifiedRate}%</div>
              </div>
              <div>
                <div className="text-[10px] uppercase m-text-dim">Current CPA</div>
                <div className="text-base m-font-mono m-text-accent mt-0.5">{formatCurrency(livePulse.cpa)}</div>
              </div>
            </div>
            
            <div className="mt-6 pt-4 border-t border-[var(--m-border-2)] flex items-center justify-between">
              <span className="text-[10px] m-text-dim">Total Spend</span>
              <span className="text-sm m-font-mono">{formatCurrency(livePulse.spend)}</span>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Next Row: Timeline & Top Segments ─── */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Timeline Chart */}
        <div className="lg:col-span-2 m-card p-6">
          <h2 className="m-section-title mb-6">
            <Activity /> Fan Response Timeline
          </h2>
          <div className="h-[250px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={campaignTimeSeries} margin={{ top: 5, right: 0, left: -25, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorAnswers" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#7C5CFF" stopOpacity={0.25}/>
                    <stop offset="95%" stopColor="#7C5CFF" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorVerified" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#18D6A3" stopOpacity={0.25}/>
                    <stop offset="95%" stopColor="#18D6A3" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.06)" />
                <XAxis dataKey="date" stroke="rgba(148,163,184,0.2)" tick={{ fontSize: 10, fill: '#475569' }} axisLine={false} tickLine={false} />
                <YAxis stroke="rgba(148,163,184,0.2)" tick={{ fontSize: 10, fill: '#475569' }} axisLine={false} tickLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#06080D', border: '1px solid rgba(148,163,184,0.1)', borderRadius: '6px' }}
                  itemStyle={{ fontSize: '12px' }}
                  labelStyle={{ fontSize: '10px', color: '#9AA8BD', marginBottom: '4px' }}
                />
                <Area type="monotone" dataKey="humanAnswers" name="Human Answers" stroke="#7C5CFF" strokeWidth={2} fillOpacity={1} fill="url(#colorAnswers)" />
                <Area type="monotone" dataKey="verifiedEngagements" name="Verified Actions" stroke="#18D6A3" strokeWidth={2} fillOpacity={1} fill="url(#colorVerified)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Top Segments */}
        <div className="m-card p-6">
          <h2 className="m-section-title mb-6">
            <Users className="!text-[var(--m-accent-2)]" /> Top Performing Segments
          </h2>
          <div className="space-y-4">
            {topSegmentsData.map((seg, i) => (
              <div key={seg.segment} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="text-[10px] m-font-mono m-text-dim w-4">{i + 1}.</div>
                  <div>
                    <div className="text-xs font-medium">{seg.segment}</div>
                    <div className="text-[10px] m-text-dim">{formatCompactNumber(seg.count)} fans</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs m-font-mono font-medium m-text-accent-2">{seg.engagement}%</div>
                  <div className="text-[9px] uppercase tracking-wider m-text-dim">Engaged</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Bottom Row: Proof Log (Compact) ─── */}
      <section className="m-card overflow-hidden flex flex-col">
        <div className="p-6 border-b border-[var(--m-border-2)] flex items-center justify-between">
          <div>
            <h2 className="m-section-title">
              <ShieldCheck /> Fan Proof Log
            </h2>
            <p className="m-section-subtitle">Recent immutable interaction records.</p>
          </div>
          <Link href="/music-console/proof" className="flex items-center gap-2 px-4 py-2 bg-[var(--m-surface-2)] hover:bg-[var(--m-border-2)] border border-[var(--m-border)] rounded-md text-xs font-semibold transition-colors">
            View Full Log <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        
        <div className="overflow-x-auto">
          <table className="m-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Fan</th>
                <th>Campaign</th>
                <th>Segment</th>
                <th className="text-center">Sentiment</th>
                <th className="text-center">Intent</th>
                <th>Outcome</th>
                <th className="text-center">Proof</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--m-border-2)]">
              {proofRecords.slice(0, 6).map((r) => (
                <tr key={r.id}>
                  <td className="m-font-mono text-[10px] m-text-dim">{new Date(r.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
                  <td className="font-medium text-[var(--m-text)]">{r.fanName}</td>
                  <td className="m-text-muted truncate max-w-[150px]">{r.campaignName}</td>
                  <td className="m-text-muted text-[11px]">{segmentLabel(r.segment)}</td>
                  <td className="text-center">
                    <span className={cn(
                      "inline-flex h-2 w-2 rounded-full",
                      r.sentiment === 'positive' ? 'bg-[var(--m-accent-2)]' : r.sentiment === 'negative' ? 'bg-[var(--m-danger)]' : 'bg-[var(--m-dim)]'
                    )} />
                  </td>
                  <td className="text-center">
                    <span className={cn(
                      "text-[10px] font-bold uppercase tracking-wider",
                      r.intent === 'high' ? 'm-text-accent-2' : r.intent === 'medium' ? 'm-text-warning' : 'm-text-dim'
                    )}>
                      {r.intent}
                    </span>
                  </td>
                  <td>
                    <span className={cn("m-badge", r.verifiedAction ? "m-badge--verified" : "m-badge--neutral")}>
                      {outcomeLabel(r.outcome)}
                    </span>
                  </td>
                  <td>
                    <div className="flex items-center justify-center gap-3">
                      {r.hasRecording ? <Mic className="h-3.5 w-3.5 m-text-accent" /> : <span className="h-3.5 w-3.5 m-text-dim opacity-30" />}
                      {r.hasTranscript ? <FileText className="h-3.5 w-3.5 m-text-accent-2" /> : <span className="h-3.5 w-3.5 m-text-dim opacity-30" />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  );
}
