'use client';

import {
  CheckCircle2,
  DollarSign,
  FileText,
  Headphones,
  ShieldCheck,
  Users,
  ArrowRight,
  Volume2,
  ChevronDown,
  ChevronUp,
  Phone,
  MessageSquare,
  Eye,
  Play,
} from 'lucide-react';
import Link from 'next/link';
import React, { useState, useEffect } from 'react';
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
import {
  formatCompactNumber,
  formatCurrency,
} from '@/features/music/lib/utils';
import {
  ProofBadge,
  SegmentBadge,
} from '@/features/music/components';
import { cn } from '@/lib/utils';

const meanings: Record<string, string> = {
  'Uploaded Fans': 'Audience list imported & normalized',
  'Contacted': 'RPS voice engine connections established',
  'Human Answered': 'Human speech verified calls',
  'Engaged': 'Natural language interaction sustained past greeting',
  'Verified Intent': 'Fan verbal consent/opt-ins verified',
  'Action Taken': 'Pre-saves written to media platform API',
};

const activityLogs: Record<number, string[]> = {
  0: [
    "04:12:05 PM — Batch import complete: 25,000 records",
    "04:12:05 PM — Consent validation check passed",
    "04:12:06 PM — List assigned to Active Fan Campaign auto-dialer"
  ],
  1: [
    "07:51:33 PM — Outbound interaction initiated to +1 415-xxx-xxxx",
    "07:51:35 PM — SIP trunk routing allocated",
    "07:51:40 PM — Dial state: Ringing / No Ans (Voicemail left)"
  ],
  2: [
    "07:51:12 PM — Voice detection: Human speech verified",
    "07:51:13 PM — Live SIP stream mapped to RPS voice engine",
    "07:51:15 PM — Handshake greeting executed successfully"
  ],
  3: [
    "07:50:45 PM — Conversation duration exceeded 25 seconds",
    "07:50:50 PM — Natural language engagement scored: High",
    "07:50:58 PM — Topic match: 'Midnight Signal Release'"
  ],
  4: [
    "07:50:02 PM — RPS voice engine: 'Shall I set up the Spotify pre-save?'",
    "07:50:04 PM — Fan voice confirmed positive intent: 'Yes, do it'",
    "07:50:05 PM — Semantic analysis marked intent: High Positive"
  ],
  5: [
    "07:49:15 PM — Pre-save request payload sent to Spotify API",
    "07:49:16 PM — OAuth credential handshake confirmed",
    "07:49:16 PM — Spotify Pre-save database entry written (Success)"
  ]
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-[#0e1017] border border-[#1e2232] rounded-lg p-3.5 shadow-lg space-y-1.5 font-sans">
        <p className="text-[10px] font-semibold text-slate-400 tracking-normal capitalize">{label}</p>
        <div className="space-y-1">
          {payload.map((pld: any) => (
            <div key={pld.dataKey} className="flex items-center gap-4 justify-between text-xs">
              <span className="flex items-center gap-1.5 text-slate-300 font-medium">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: pld.stroke || pld.color }} />
                {pld.name}:
              </span>
              <span className="font-semibold text-white">
                {pld.value.toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
};

export default function MusicConsolePage() {
  const [playingRecordId, setPlayingRecordId] = useState<string | null>(null);
  const [expandedTranscriptId, setExpandedTranscriptId] = useState<string | null>(null);
  const [hoveredStageIndex, setHoveredStageIndex] = useState<number | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const togglePlay = (id: string) => {
    setPlayingRecordId(playingRecordId === id ? null : id);
  };

  const toggleTranscript = (id: string) => {
    setExpandedTranscriptId(expandedTranscriptId === id ? null : id);
  };

  return (
    <div className="border border-[var(--m-border)] bg-[var(--m-surface-2)] text-zinc-100 flex flex-col font-sans select-none overflow-hidden rounded-lg">
      
      {/* ─── Row 1: Header / Navigation & Console Details ─── */}
      <header className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[var(--m-border-2)] border-b border-[var(--m-border-2)] bg-[var(--m-surface)]">
        {/* Col 1: Campaign Info */}
        <div className="p-5 flex flex-col justify-center space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-bold tracking-wider uppercase text-[var(--m-accent)] bg-[var(--m-accent-dim)] border border-[var(--m-accent)]/20 px-2 py-0.5 rounded">
              Active Fan Campaign
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-emerald-500/20 bg-emerald-500/5 text-[9px] font-semibold text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="tracking-normal uppercase">{livePulse.status.toLowerCase()}</span>
            </span>
          </div>
          <h1 className="text-lg font-black tracking-tight text-white mt-1.5">
            {livePulse.campaignName}
          </h1>
          <p className="text-[11px] text-[var(--m-muted)]">
            Artist: {livePulse.artist} • Sponsor Inventory: {livePulse.segment}
          </p>
        </div>

        {/* Col 2: Diagnostic Verification Rates */}
        <div className="p-5 flex flex-col justify-center space-y-2.5">
          <div className="text-[9px] font-bold text-[var(--m-muted)] uppercase tracking-wider">
            Live Call Intelligence
          </div>
          <div className="flex items-center gap-4">
            <div className="space-y-0.5">
              <div className="text-[10px] text-[var(--m-dim)]">Connect Rate</div>
              <div className="text-sm font-bold text-white">{livePulse.answerRate}%</div>
            </div>
            <div className="w-px h-6 bg-[var(--m-border)]" />
            <div className="space-y-0.5">
              <div className="text-[10px] text-[var(--m-dim)]">Verified Action Rate</div>
              <div className="text-sm font-bold text-emerald-400">{livePulse.verifiedRate}%</div>
            </div>
            <div className="w-px h-6 bg-[var(--m-border)]" />
            <div className="space-y-0.5">
              <div className="text-[10px] text-[var(--m-dim)]">Avg CPVA</div>
              <div className="text-sm font-bold text-[var(--m-accent-gold)] font-mono">${livePulse.cpa.toFixed(2)}</div>
            </div>
          </div>
        </div>

        {/* Col 3: Actions Banner */}
        <div className="p-5 flex items-center justify-start md:justify-end gap-2.5 bg-black/5">
          <Link href="/music-console/proof">
            <button className="m-btn m-btn--secondary py-2 px-3 text-xs flex items-center gap-1.5">
              Proof Records <ArrowRight className="h-3 w-3" />
            </button>
          </Link>
          <Link href="/music-console/reports">
            <button className="m-btn m-btn--primary py-2 px-3 text-xs bg-[var(--m-accent)] hover:bg-[#008be5] text-white">
              Campaign Yield Reports
            </button>
          </Link>
        </div>
      </header>

      {/* ─── Row 2: 6 Core KPIs (Divider-only horizontal bar) ─── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 divide-x divide-y lg:divide-y-0 divide-[var(--m-border-2)] border-b border-[var(--m-border-2)] bg-[var(--m-surface)]">
        {/* KPI 1 */}
        <div className="p-4 flex flex-col justify-between h-20">
          <span className="text-[9px] font-bold text-[var(--m-muted)] uppercase tracking-wider">Fan Interactions</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-xl font-bold tracking-tight text-white">
              {formatCompactNumber(topKpis.fansContacted.value)}
            </span>
            <span className="text-[9px] font-bold text-emerald-500">+{topKpis.fansContacted.change}%</span>
          </div>
        </div>
        {/* KPI 2 */}
        <div className="p-4 flex flex-col justify-between h-20">
          <span className="text-[9px] font-bold text-[var(--m-muted)] uppercase tracking-wider">Verified Actions</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-xl font-bold tracking-tight text-white">
              {formatCompactNumber(topKpis.humanAnswers.value)}
            </span>
            <span className="text-[9px] font-bold text-emerald-500">+{topKpis.humanAnswers.change}%</span>
          </div>
        </div>
        {/* KPI 3 */}
        <div className="p-4 flex flex-col justify-between h-20">
          <span className="text-[9px] font-bold text-[var(--m-muted)] uppercase tracking-wider">Campaign Yield</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-xl font-bold tracking-tight text-emerald-400">
              {formatCompactNumber(topKpis.verifiedEngagements.value)}
            </span>
            <span className="text-[9px] font-bold text-emerald-500">+{topKpis.verifiedEngagements.change}%</span>
          </div>
        </div>
        {/* KPI 4 */}
        <div className="p-4 flex flex-col justify-between h-20">
          <span className="text-[9px] font-bold text-[var(--m-muted)] uppercase tracking-wider">Artist Payout</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-xl font-bold tracking-tight text-white">
              {formatCompactNumber(topKpis.preSaves.value)}
            </span>
            <span className="text-[9px] font-bold text-emerald-500">+{topKpis.preSaves.change}%</span>
          </div>
        </div>
        {/* KPI 5 */}
        <div className="p-4 flex flex-col justify-between h-20">
          <span className="text-[9px] font-bold text-[var(--m-muted)] uppercase tracking-wider">Cost per Action (CPVA)</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-xl font-bold tracking-tight text-white">
              {formatCurrency(topKpis.costPerPreSave.value)}
            </span>
            <span className="text-[9px] font-bold text-emerald-500">{topKpis.costPerPreSave.change}%</span>
          </div>
        </div>
        {/* KPI 6 */}
        <div className="p-4 flex flex-col justify-between h-20">
          <span className="text-[9px] font-bold text-[var(--m-muted)] uppercase tracking-wider">Proof Captured</span>
          <div className="flex items-baseline justify-between mt-1">
            <span className="text-xl font-bold tracking-tight text-white">
              {formatCompactNumber(topKpis.proofCaptured.value)}
            </span>
            <span className="text-[9px] font-bold text-emerald-500">+{topKpis.proofCaptured.change}%</span>
          </div>
        </div>
      </div>

      {/* ─── Row 3: Pipeline Conversion Journey (Architectural design) ─── */}
      <section className="p-5 border-b border-[var(--m-border-2)] bg-[var(--m-surface-2)]">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[var(--m-border-2)] pb-2 mb-4">
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--m-muted)]">
            Media Inventory Conversion Pipeline
          </h3>
          <span className="text-[9px] font-bold text-emerald-400 bg-emerald-400/10 border border-emerald-500/15 px-2 py-0.5 rounded">
            Operational State: Live Dialing
          </span>
        </div>

        <div className="flex flex-col lg:flex-row items-stretch justify-between divide-y lg:divide-y-0 lg:divide-x divide-[var(--m-border-2)] border border-[var(--m-border-2)] rounded bg-black/10">
          {funnelData.map((stage, i) => {
            const icons = [
              <Users className="h-3.5 w-3.5 text-[var(--m-accent)]" />,
              <Phone className="h-3.5 w-3.5 text-[var(--m-accent)]" />,
              <Headphones className="h-3.5 w-3.5 text-[var(--m-accent)]" />,
              <MessageSquare className="h-3.5 w-3.5 text-[var(--m-accent)]" />,
              <ShieldCheck className="h-3.5 w-3.5 text-[var(--m-accent-2)]" />,
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />,
            ];

            return (
              <div 
                key={stage.label}
                className="flex-1 p-3.5 hover:bg-white/[0.015] flex items-center gap-3 relative cursor-pointer transition-colors group"
                onMouseEnter={() => setHoveredStageIndex(i)}
                onMouseLeave={() => setHoveredStageIndex(null)}
              >
                <div 
                  className="w-7 h-7 rounded flex items-center justify-center border shrink-0 bg-black/20"
                  style={{ borderColor: `${stage.color}25` }}
                >
                  {icons[i]}
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-[8px] font-bold text-[var(--m-muted)] block leading-none">Stage 0{i + 1}</span>
                  <span className="text-[11px] font-bold text-zinc-100 tracking-normal truncate block mt-0.5 capitalize">{stage.label.toLowerCase()}</span>
                  <div className="flex items-center gap-1.5 mt-0.5 text-[10px]">
                    <span className="text-zinc-400 font-medium font-mono">{formatCompactNumber(stage.count)}</span>
                    <span className="text-zinc-600">•</span>
                    <span style={{ color: stage.color }} className="font-bold font-mono">{stage.percentage.toFixed(0)}%</span>
                  </div>
                </div>

                {/* Clean Tooltip Popup */}
                {hoveredStageIndex === i && (
                  <div className="absolute bottom-[115%] left-1/2 -translate-x-1/2 w-72 bg-[#0e1017] border border-[var(--m-border)] rounded p-3 shadow-2xl z-40 pointer-events-none font-sans">
                    <div className="flex justify-between items-center text-[9px] border-b border-[var(--m-border-2)] pb-1.5 mb-2">
                      <span className="text-zinc-400 font-bold uppercase">Stage Telemetry</span>
                      <span style={{ color: stage.color }} className="font-bold font-mono">{stage.percentage.toFixed(1)}% Yield</span>
                    </div>
                    <p className="text-[11px] text-zinc-300 font-normal leading-relaxed">
                      {meanings[stage.label] || stage.label}
                    </p>
                    <div className="mt-2 space-y-1">
                      {activityLogs[i]?.slice(0, 2).map((log, logIdx) => (
                        <div key={logIdx} className="text-[9px] text-zinc-500 truncate font-mono">
                          ▸ {log.split(' — ')[1] || log}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ─── Row 4: split pane for Campaign Trend & Cohort Leaders ─── */}
      <section className="grid grid-cols-1 lg:grid-cols-3 divide-y lg:divide-y-0 lg:divide-x divide-[var(--m-border-2)] border-b border-[var(--m-border-2)] bg-[var(--m-surface-2)]">
        
        {/* Left Col: Area Chart (col-span-2) */}
        <div className="lg:col-span-2 p-5 flex flex-col justify-between">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--m-border-2)] pb-2 mb-4">
            <div>
              <span className="text-[9px] font-bold text-[var(--m-accent)] tracking-wider uppercase flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--m-accent)] animate-pulse" /> Telemetry & Engagement
              </span>
              <h2 className="text-xs font-bold text-white tracking-wider uppercase mt-0.5">Campaign Performance Trend</h2>
            </div>
            
            <div className="flex items-center gap-2 text-[10px]">
              <span className="px-2 py-0.5 rounded bg-[var(--m-surface-3)] text-[var(--m-dim)] border border-[var(--m-border)] font-semibold">
                Fan Answers
              </span>
              <span className="px-2 py-0.5 rounded bg-[var(--m-accent-2-dim)] text-[var(--m-accent-2)] border border-[var(--m-accent-2)]/20 font-semibold">
                Verified Actions
              </span>
            </div>
          </div>

          <div className="h-[250px] w-full relative bg-black/10 border border-[var(--m-border-2)] rounded p-2 overflow-hidden">
            {mounted ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={campaignTimeSeries}
                  margin={{ top: 5, right: 5, left: -25, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="colorAnswers" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--m-accent)" stopOpacity={0.06} />
                      <stop offset="95%" stopColor="var(--m-accent)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="colorVerified" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--m-accent-2)" stopOpacity={0.05} />
                      <stop offset="95%" stopColor="var(--m-accent-2)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="rgba(255, 255, 255, 0.005)"
                  />
                  <XAxis
                    dataKey="date"
                    stroke="#1e2232"
                    tick={{ fontSize: 9, fill: '#8e8e93', fontWeight: 500 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    stroke="#1e2232"
                    tick={{ fontSize: 9, fill: '#8e8e93', fontWeight: 500 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="humanAnswers"
                    name="Fan Answers"
                    stroke="var(--m-accent)"
                    strokeWidth={1.5}
                    fillOpacity={1}
                    fill="url(#colorAnswers)"
                    activeDot={{ r: 4, stroke: 'var(--m-bg)', strokeWidth: 1.5, fill: 'var(--m-accent)' }}
                    dot={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="verifiedEngagements"
                    name="Verified Actions"
                    stroke="var(--m-accent-2)"
                    strokeWidth={1.5}
                    fillOpacity={1}
                    fill="url(#colorVerified)"
                    activeDot={{ r: 4, stroke: 'var(--m-bg)', strokeWidth: 1.5, fill: 'var(--m-accent-2)' }}
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-full text-xs text-zinc-500 font-sans">
                Loading telemetry signal charts...
              </div>
            )}
          </div>
        </div>

        {/* Right Col: Cohort Leaders (col-span-1) */}
        <div className="p-5 flex flex-col justify-between bg-black/5">
          <div className="border-b border-[var(--m-border-2)] pb-2 mb-3">
            <span className="text-[9px] font-bold text-[var(--m-accent)] tracking-wider uppercase">
              Sponsor Inventory
            </span>
            <h2 className="text-xs font-bold text-white tracking-wider uppercase mt-0.5">Audience Heat Board</h2>
          </div>

          <div className="space-y-2 flex-1 flex flex-col justify-center">
            {topSegmentsData.map((seg, i) => {
              const recommendations: Record<string, string> = {
                Superfans: 'DISPATCH EARLY TICKETS',
                'Stream save audience': 'ACTIVATE PRE-SAVE FLOW',
                'VIP list': 'QUEUE VIP UPGRADE',
                'Previous merch buyers': 'DISPATCH CAPSULE ALERT',
                'Tour city fans': 'BROADCAST VENUE DETAILS',
                'Fan club inactive': 'INITIATE WIN-BACK',
              };

              const isCrit = seg.engagement >= 80;
              const isWarm = seg.engagement >= 60 && seg.engagement < 80;

              const heatColorClass = isCrit
                ? 'text-emerald-400 bg-emerald-500/5 border-emerald-500/15'
                : isWarm
                  ? 'text-amber-400 bg-amber-500/5 border-amber-500/15'
                  : 'text-zinc-400 bg-zinc-500/5 border-zinc-500/15';

              const barColorClass = isCrit
                ? 'from-emerald-600 to-emerald-400'
                : isWarm
                  ? 'from-amber-600 to-amber-400'
                  : 'from-zinc-600 to-zinc-400';

              return (
                <div
                  key={seg.segment}
                  className="bg-black/20 border border-[var(--m-border-2)] hover:border-[var(--m-border)] rounded p-2 space-y-1.5 transition-colors"
                >
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="w-4 h-4 flex items-center justify-center border border-[var(--m-border-2)] rounded bg-black/40 text-[9px] font-bold text-zinc-500 font-mono">
                        {i + 1}
                      </span>
                      <span className="font-bold text-zinc-100 tracking-tight block truncate text-[11px]">
                        {seg.segment}
                      </span>
                    </div>
                    <span className={cn("text-[9px] font-bold px-1.5 py-0.2 rounded border tracking-tight font-mono", heatColorClass)}>
                      {seg.engagement}% Heat
                    </span>
                  </div>

                  <div className="space-y-0.5">
                    <div className="flex justify-between items-center text-[9px] font-semibold text-[var(--m-muted)] font-mono">
                      <span>Vol: {formatCompactNumber(seg.count)}</span>
                      <span>Target: {seg.engagement}%</span>
                    </div>
                    {/* Sleek Continuous Progress Bar */}
                    <div className="h-1 w-full bg-zinc-900 rounded-full overflow-hidden">
                      <div 
                        className={cn("h-full rounded-full bg-gradient-to-r transition-all duration-500", barColorClass)} 
                        style={{ width: `${seg.engagement}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[8px] font-bold text-zinc-500 tracking-wider">
                    <span>{recommendations[seg.segment] || 'ACTION REQUIRED'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── Row 5: Verifiable Proof Stream (Proof table) ─── */}
      <section className="p-5 bg-[var(--m-surface-2)]">
        <div className="border-b border-[var(--m-border-2)] pb-2 mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <span className="text-[9px] font-bold text-emerald-400 tracking-wider uppercase">
              Action Verification Logs
            </span>
            <h2 className="text-xs font-bold text-white tracking-wider uppercase mt-0.5">Verified Proof Records</h2>
          </div>
          <Link href="/music-console/proof">
            <button className="m-btn m-btn--ghost text-[11px] py-1.5 px-3">
              Open Proof Records <ArrowRight className="ml-1 h-3 w-3 inline" />
            </button>
          </Link>
        </div>

        {/* Proof Table with Defined Column Widths */}
        <div className="overflow-hidden border border-[var(--m-border)] rounded bg-black/25">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse table-fixed m-table m-dense-table">
              <colgroup>
                <col className="w-[20%]" />
                <col className="w-[18%]" />
                <col className="w-[27%]" />
                <col className="w-[15%]" />
                <col className="w-[10%]" />
                <col className="w-[10%]" />
              </colgroup>
              <thead>
                <tr className="border-b border-[var(--m-border)] bg-black/40">
                  <th className="font-bold text-[var(--m-muted)] uppercase tracking-wider">Fan Name / Contact</th>
                  <th className="font-bold text-[var(--m-muted)] uppercase tracking-wider">Sponsor Segment</th>
                  <th className="font-bold text-[var(--m-muted)] uppercase tracking-wider">Fan Campaign</th>
                  <th className="font-bold text-[var(--m-muted)] uppercase tracking-wider text-center">Outcome</th>
                  <th className="font-bold text-[var(--m-muted)] uppercase tracking-wider text-right">CPVA</th>
                  <th className="font-bold text-[var(--m-muted)] uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {proofRecords.slice(0, 5).map(r => {
                  const isPlaying = playingRecordId === r.id;
                  const isExpanded = expandedTranscriptId === r.id;

                  const borderLeftColor = 
                    r.sentiment === 'positive' 
                      ? 'border-l-emerald-500' 
                      : r.sentiment === 'negative' 
                        ? 'border-l-red-500' 
                        : 'border-l-zinc-500';

                  return (
                    <React.Fragment key={r.id}>
                      <tr className={cn("border-b border-[var(--m-border-2)] hover:bg-white/[0.01] transition-colors border-l-2", borderLeftColor)}>
                        <td>
                          <div className="font-bold text-white text-[11px]">{r.fanName}</div>
                          <div className="font-mono text-[9px] text-[var(--m-muted)] mt-0.5">xxxxxx{r.fanPhone.slice(-4)}</div>
                        </td>
                        <td>
                          <div className="flex items-center gap-1.5">
                            <SegmentBadge segment={r.segment} />
                            <span className={cn(
                              'text-[8px] uppercase tracking-wider font-bold px-1.5 py-0.2 rounded border font-mono',
                              r.intent === 'high'
                                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                                : r.intent === 'medium'
                                  ? 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                                  : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                            )}>
                              {r.intent}
                            </span>
                          </div>
                        </td>
                        <td className="text-zinc-300 font-semibold truncate text-[11px]">
                          {r.campaignName}
                        </td>
                        <td className="text-center">
                          <div className="inline-flex justify-center w-full">
                            <ProofBadge outcome={r.outcome} verified={r.verifiedAction} />
                          </div>
                        </td>
                        <td className="text-right font-mono font-bold text-[var(--m-accent-gold)]">
                          {formatCurrency(r.cpaAttribution)}
                        </td>
                        <td>
                          <div className="flex items-center justify-end gap-1.5">
                            {r.hasRecording && (
                              <button
                                onClick={() => togglePlay(r.id)}
                                className={cn(
                                  "text-[8px] font-bold px-2 py-0.5 rounded flex items-center gap-1 border transition-all uppercase font-mono",
                                  isPlaying 
                                    ? "bg-zinc-800 text-white border-zinc-700" 
                                    : "bg-zinc-950 text-zinc-400 border-zinc-800 hover:bg-zinc-900"
                                )}
                              >
                                <Volume2 className="h-3 w-3" />
                                <span>{isPlaying ? 'Playing' : 'Audio'}</span>
                              </button>
                            )}
                            {r.hasTranscript && (
                              <button
                                onClick={() => toggleTranscript(r.id)}
                                className={cn(
                                  "text-[8px] font-bold px-2 py-0.5 rounded flex items-center gap-1 border transition-all uppercase font-mono",
                                  isExpanded 
                                    ? "bg-zinc-800 text-white border-zinc-700" 
                                    : "bg-zinc-950 text-zinc-400 border-zinc-800 hover:bg-zinc-900"
                                )}
                              >
                                <FileText className="h-3 w-3" />
                                <span>Logs</span>
                                {isExpanded ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
                              </button>
                            )}
                            <Link href={`/music-console/proof?id=${r.id}`}>
                              <button className="p-1 rounded bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-white transition-all flex items-center justify-center">
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                            </Link>
                          </div>
                        </td>
                      </tr>

                      {/* Expandable Waveform Details */}
                      {isPlaying && (
                        <tr className="bg-black/25">
                          <td colSpan={6} className="py-2.5 px-4">
                            <div className="flex items-center gap-4 bg-black/30 border border-[var(--m-border-2)] p-2.5 rounded">
                              <Play className="h-3 w-3 text-zinc-400 shrink-0" />
                              <div className="flex-1 h-1 bg-zinc-900 rounded-full overflow-hidden relative">
                                <div className="h-full bg-[var(--m-accent)] w-1/3" />
                              </div>
                              <span className="text-[10px] font-mono text-zinc-500 font-bold shrink-0">0:14 / 1:24</span>
                            </div>
                          </td>
                        </tr>
                      )}

                      {/* Expandable Verbatim Conversation Audit Logs */}
                      {isExpanded && r.transcriptSnippet && (
                        <tr className="bg-black/25">
                          <td colSpan={6} className="py-3 px-4 border-b border-[var(--m-border-2)]">
                            <div className="bg-black/30 border border-[var(--m-border-2)] p-3 rounded space-y-1.5">
                              <div className="text-[9px] uppercase tracking-wider font-bold text-zinc-500 border-b border-[var(--m-border-2)] pb-1.5 mb-2 font-mono">
                                Verbatim Conversation Audit Log
                              </div>
                              {r.transcriptSnippet.split('\n').map((line, idx) => {
                                const isAi = line.startsWith('AI:');
                                const speaker = isAi ? 'RPS Voice Engine' : 'Fan';
                                const text = isAi
                                  ? line.replace('AI:', '').trim()
                                  : line.replace('Fan:', '').trim();

                                return (
                                  <div key={idx} className="flex gap-4 text-[11px] font-sans">
                                    <span className={cn(
                                      'w-32 font-bold uppercase tracking-wider shrink-0 text-[9px] font-mono',
                                      isAi ? 'text-[var(--m-accent)]' : 'text-zinc-500'
                                    )}>
                                      {speaker}:
                                    </span>
                                    <span className="text-zinc-300 leading-relaxed font-normal">{text}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
