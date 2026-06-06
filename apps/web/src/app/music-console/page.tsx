'use client';

import {
  Activity,
  CheckCircle2,
  DollarSign,
  FileText,
  Headphones,
  ShieldCheck,
  TrendingUp,
  Users,
  ArrowRight,
  Volume2,
  Flame,
  Music,
  ChevronDown,
  ChevronUp,
  Phone,
  MessageSquare,
  Radio,
  Eye,
  Settings,
  ShieldAlert,
  HelpCircle,
  Clock,
  Play,
  Square,
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

// Client-safe time extractor to prevent hydration warnings
const formatTimestamp = (ts: string) => {
  const parts = ts.split('T');
  if (parts.length < 2) return '';
  const time = parts[1].slice(0, 5); 
  const [hourStr, minStr] = time.split(':');
  const hour = parseInt(hourStr, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minStr} ${ampm}`;
};

const meanings: Record<string, string> = {
  'Uploaded Fans': 'Audience list imported & normalized',
  'Contacted': 'Dialer connects established',
  'Human Answered': 'Human speech verified calls',
  'Engaged': 'Convo sustained past initial drop',
  'Verified Intent': 'Fan verbal opt-ins captured',
  'Action Taken': 'Pre-saves written to Spotify API',
};

const activityLogs: Record<number, string[]> = {
  0: [
    "04:12:05 PM — Batch import complete: 25,000 records",
    "04:12:05 PM — Consent validation check passed",
    "04:12:06 PM — List assigned to Active Campaign auto-dialer"
  ],
  1: [
    "07:51:33 PM — Outbound call initiated to +1 415-xxx-xxxx",
    "07:51:35 PM — SIP trunk routing allocated",
    "07:51:40 PM — Dial state: Ringing / No Ans (Voicemail left)"
  ],
  2: [
    "07:51:12 PM — Voice detection: Human speech verified",
    "07:51:13 PM — Live SIP stream mapped to AI audio handler",
    "07:51:15 PM — Handshake greeting executed successfully"
  ],
  3: [
    "07:50:45 PM — Conversation duration exceeded 25 seconds",
    "07:50:50 PM — Natural language engagement scored: High",
    "07:50:58 PM — Topic match: 'Midnight Signal Release'"
  ],
  4: [
    "07:50:02 PM — AI agent: 'Shall I set up the Spotify pre-save?'",
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
      <div className="bg-[#141417] border border-[#242427] rounded-lg p-3 shadow-md space-y-1.5 text-xs text-[var(--m-text-2)]">
        <p className="font-semibold text-slate-400">{label}</p>
        <div className="space-y-1 font-sans">
          {payload.map((pld: any) => (
            <div key={pld.dataKey} className="flex items-center gap-4 justify-between">
              <span className="flex items-center gap-1.5 text-slate-300">
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: pld.stroke || pld.color }} />
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
    <div className="space-y-6 pb-12">
      {/* ─── Page Header / Summary Banner ─── */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/[0.05] pb-4.5">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <span className="text-xs font-semibold tracking-wider text-[var(--m-accent)] bg-[var(--m-accent-dim)] border border-[var(--m-accent)]/20 px-2.5 py-1 rounded-md">
              CAMPAIGN COCKPIT
            </span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-emerald-500/20 bg-emerald-500/10 text-xs font-semibold text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="uppercase tracking-wider">{livePulse.status}</span>
            </span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white mt-1">
            {livePulse.campaignName} <span className="text-zinc-500 font-normal">by</span> {livePulse.artist}
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/music-console/proof">
            <button className="flex items-center gap-1.5 text-xs font-semibold py-2 px-3.5 rounded-md bg-white/[0.04] text-white border border-white/10 hover:bg-white/[0.08] transition-all">
              View Proof Log <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </Link>
          <Link href="/music-console/reports">
            <button className="text-xs font-semibold py-2 px-3.5 rounded-md bg-zinc-900 text-zinc-300 border border-zinc-800 hover:bg-zinc-800 hover:text-white transition-all">
              Analytics Reports
            </button>
          </Link>
        </div>
      </header>

      {/* ─── 6 Core KPIs Grid ─── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        
        {/* Reached Fans */}
        <div className="m-card p-5 flex flex-col justify-between h-28 relative overflow-hidden group">
          <div className="flex justify-between items-start">
            <span className="text-xs font-medium text-slate-400">Reached Fans</span>
            <Users className="h-4 w-4 text-[var(--m-accent)]" />
          </div>
          <div>
            <div className="text-3xl font-semibold tracking-tight text-white mt-1.5">
              {formatCompactNumber(topKpis.fansContacted.value)}
            </div>
            <div className="flex justify-between items-center mt-1 text-xs">
              <span className="text-slate-500">Outbound</span>
              <span className="text-emerald-400 font-medium">
                +{topKpis.fansContacted.change}%
              </span>
            </div>
          </div>
        </div>

        {/* Human Answers */}
        <div className="m-card p-5 flex flex-col justify-between h-28 relative overflow-hidden group">
          <div className="flex justify-between items-start">
            <span className="text-xs font-medium text-slate-400">Human Answers</span>
            <Headphones className="h-4 w-4 text-[var(--m-accent)]" />
          </div>
          <div>
            <div className="text-3xl font-semibold tracking-tight text-white mt-1.5">
              {formatCompactNumber(topKpis.humanAnswers.value)}
            </div>
            <div className="flex justify-between items-center mt-1 text-xs">
              <span className="text-slate-500">Pickup Rate</span>
              <span className="text-emerald-400 font-medium">
                +{topKpis.humanAnswers.change}%
              </span>
            </div>
          </div>
        </div>

        {/* Verified Actions */}
        <div className="m-card p-5 flex flex-col justify-between h-28 relative overflow-hidden group">
          <div className="flex justify-between items-start">
            <span className="text-xs font-medium text-slate-400">Verified Actions</span>
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
          </div>
          <div>
            <div className="text-3xl font-semibold tracking-tight text-emerald-400 mt-1.5">
              {formatCompactNumber(topKpis.verifiedEngagements.value)}
            </div>
            <div className="flex justify-between items-center mt-1 text-xs">
              <span className="text-slate-500">Intent Match</span>
              <span className="text-emerald-400 font-medium">
                +{topKpis.verifiedEngagements.change}%
              </span>
            </div>
          </div>
        </div>

        {/* Pre-Saves */}
        <div className="m-card p-5 flex flex-col justify-between h-28 relative overflow-hidden group">
          <div className="flex justify-between items-start">
            <span className="text-xs font-medium text-slate-400">Pre-Saves</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          </div>
          <div>
            <div className="text-3xl font-semibold tracking-tight text-white mt-1.5">
              {formatCompactNumber(topKpis.preSaves.value)}
            </div>
            <div className="flex justify-between items-center mt-1 text-xs">
              <span className="text-slate-500">Conversions</span>
              <span className="text-emerald-400 font-medium">
                +{topKpis.preSaves.change}%
              </span>
            </div>
          </div>
        </div>

        {/* Cost / Pre-Save */}
        <div className="m-card p-5 flex flex-col justify-between h-28 relative overflow-hidden group">
          <div className="flex justify-between items-start">
            <span className="text-xs font-medium text-slate-400">Cost / Action</span>
            <DollarSign className="h-4 w-4 text-[var(--m-accent)]" />
          </div>
          <div>
            <div className="text-3xl font-semibold tracking-tight text-white mt-1.5">
              {formatCurrency(topKpis.costPerPreSave.value)}
            </div>
            <div className="flex justify-between items-center mt-1 text-xs">
              <span className="text-slate-500">CPA Avg</span>
              <span className="text-emerald-400 font-medium">
                {topKpis.costPerPreSave.change}%
              </span>
            </div>
          </div>
        </div>

        {/* Proof Records */}
        <div className="m-card p-5 flex flex-col justify-between h-28 relative overflow-hidden group">
          <div className="flex justify-between items-start">
            <span className="text-xs font-medium text-slate-400">Proof Records</span>
            <FileText className="h-4 w-4 text-[var(--m-accent)]" />
          </div>
          <div>
            <div className="text-3xl font-semibold tracking-tight text-white mt-1.5">
              {formatCompactNumber(topKpis.proofCaptured.value)}
            </div>
            <div className="flex justify-between items-center mt-1 text-xs">
              <span className="text-slate-500">Audit logs</span>
              <span className="text-emerald-400 font-medium">
                +{topKpis.proofCaptured.change}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Funnel Journey Horizontal Timeline ─── */}
      <section className="m-card p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/[0.04] pb-3 mb-5">
          <h3 className="text-base font-semibold text-white">
            Conversion Journey Pipeline
          </h3>
          <span className="text-xs text-slate-400">
            Funnel State: Active
          </span>
        </div>

        <div className="flex flex-col md:flex-row items-center justify-between gap-4 md:gap-2">
          {funnelData.map((stage, i) => {
            const icons = [
              <Users className="h-4 w-4" style={{ color: stage.color }} />,
              <Phone className="h-4 w-4" style={{ color: stage.color }} />,
              <Headphones className="h-4 w-4" style={{ color: stage.color }} />,
              <MessageSquare className="h-4 w-4" style={{ color: stage.color }} />,
              <ShieldCheck className="h-4 w-4" style={{ color: stage.color }} />,
              <CheckCircle2 className="h-4 w-4" style={{ color: stage.color }} />,
            ];

            return (
              <React.Fragment key={stage.label}>
                <div 
                  className="flex-1 w-full md:w-auto p-4 bg-white/[0.01] hover:bg-white/[0.03] border border-white/[0.04] rounded-lg flex items-center gap-3.5 relative cursor-pointer group transition-colors"
                  onMouseEnter={() => setHoveredStageIndex(i)}
                  onMouseLeave={() => setHoveredStageIndex(null)}
                >
                  <div 
                    className="w-9 h-9 rounded-md flex items-center justify-center border shrink-0 bg-black/30"
                    style={{ borderColor: `${stage.color}30`, boxShadow: `0 2px 4px rgba(0,0,0,0.2)` }}
                  >
                    {icons[i]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="text-xs font-semibold text-slate-500 block leading-none">Stage 0{i + 1}</span>
                    <span className="text-sm font-semibold text-white truncate block mt-1">{stage.label}</span>
                    <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-400">
                      <span className="font-medium">{formatCompactNumber(stage.count)}</span>
                      <span className="text-slate-600">•</span>
                      <span style={{ color: stage.color }} className="font-semibold">{stage.percentage.toFixed(0)}%</span>
                    </div>
                  </div>

                  {/* Clean Tooltip Popup */}
                  {hoveredStageIndex === i && (
                    <div className="absolute bottom-[115%] left-1/2 -translate-x-1/2 w-72 bg-[#141417] border border-[#242427] rounded-lg p-3.5 shadow-2xl z-40 pointer-events-none">
                      <div className="flex justify-between items-center text-xs border-b border-zinc-800 pb-1.5 mb-2 font-medium">
                        <span className="text-slate-400">STAGE ANALYSIS</span>
                        <span style={{ color: stage.color }} className="font-semibold">{stage.percentage.toFixed(1)}% Conversion</span>
                      </div>
                      <p className="text-xs text-slate-300 font-normal leading-relaxed">
                        {meanings[stage.label] || stage.label}
                      </p>
                      <div className="mt-2.5 space-y-1">
                        {activityLogs[i]?.slice(0, 2).map((log, logIdx) => (
                          <div key={logIdx} className="text-xs text-slate-500 truncate font-normal">
                            ▸ {log.split(' — ')[1] || log}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Separator Arrow (desktop only) */}
                {i < funnelData.length - 1 && (
                  <ArrowRight className="hidden md:block h-3.5 w-3.5 text-zinc-700 shrink-0 mx-1" />
                )}
              </React.Fragment>
            );
          })}
        </div>
      </section>

      {/* ─── Main Analytics Section (Area Chart & Heat Board) ─── */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Area Chart Container (col-span-2) */}
        <div className="lg:col-span-2 m-card p-5 flex flex-col justify-between relative overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/[0.04] pb-4.5 mb-5">
            <div>
              <span className="text-xs font-semibold text-[var(--m-accent)] uppercase tracking-wider">
                Campaign Performance Monitor
              </span>
              <h2 className="text-base font-semibold text-white mt-1">Campaign Performance Trend</h2>
            </div>
            
            <div className="flex items-center gap-4 text-xs font-medium">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[var(--m-accent)]" />
                <span className="text-slate-400">Answers ({livePulse.answerRate}%)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[var(--m-accent-2)]" />
                <span className="text-slate-400">Conversions ({livePulse.verifiedRate}%)</span>
              </div>
            </div>
          </div>

          <div className="w-full">
            <div className="h-[260px] w-full relative bg-black/20 rounded-lg border border-white/[0.03] p-3 overflow-hidden">
              {mounted ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={campaignTimeSeries}
                    margin={{ top: 5, right: 5, left: -25, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="colorAnswers" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--m-accent)" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="var(--m-accent)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorVerified" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--m-accent-2)" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="var(--m-accent-2)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="rgba(255, 255, 255, 0.02)"
                    />
                    <XAxis
                      dataKey="date"
                      stroke="#4b5563"
                      tick={{ fontSize: 10, fill: '#9ca3af', fontWeight: 500 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      stroke="#4b5563"
                      tick={{ fontSize: 10, fill: '#9ca3af', fontWeight: 500 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="humanAnswers"
                      name="Answers"
                      stroke="var(--m-accent)"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorAnswers)"
                      activeDot={{ r: 4, stroke: '#0c0c0e', strokeWidth: 1.5, fill: 'var(--m-accent)' }}
                      dot={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="verifiedEngagements"
                      name="Conversions"
                      stroke="var(--m-accent-2)"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorVerified)"
                      activeDot={{ r: 4, stroke: '#0c0c0e', strokeWidth: 1.5, fill: 'var(--m-accent-2)' }}
                      dot={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-xs text-slate-500">
                  Loading performance trend charts...
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Audience Leaderboard / Heat Board (col-span-1) */}
        <div className="m-card p-5 flex flex-col justify-between relative overflow-hidden">
          <div className="border-b border-white/[0.04] pb-4 mb-4">
            <span className="text-xs font-semibold text-[var(--m-accent)] uppercase tracking-wider">
              Cohort Rankings
            </span>
            <h2 className="text-base font-semibold text-white mt-1">Audience Heat Board</h2>
          </div>

          <div className="space-y-3 flex-1 flex flex-col justify-center">
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
                ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                : isWarm
                  ? 'text-[var(--m-accent)] bg-[var(--m-accent-dim)] border-[var(--m-accent)]/20'
                  : 'text-slate-400 bg-slate-500/10 border-slate-500/20';

              const barColorClass = isCrit
                ? 'from-emerald-600 to-emerald-400'
                : isWarm
                  ? 'from-[#c2a265] to-[#dfc38c]'
                  : 'from-slate-600 to-slate-400';

              return (
                <div
                  key={seg.segment}
                  className="bg-black/15 border border-white/[0.03] hover:border-white/10 rounded-lg p-3 space-y-2.5 transition-colors group"
                >
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-5 h-5 flex items-center justify-center border border-white/10 rounded bg-black/40 text-[10px] font-bold text-slate-400">
                        {i + 1}
                      </span>
                      <span className="font-semibold text-white truncate block">
                        {seg.segment}
                      </span>
                    </div>
                    <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded border tracking-wider", heatColorClass)}>
                      {seg.engagement}% HEAT
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-[10px] font-medium text-slate-500 uppercase">
                      <span>Volume: {formatCompactNumber(seg.count)}</span>
                      <span>{seg.engagement}% Target</span>
                    </div>
                    {/* Sleek Continuous Progress Bar */}
                    <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                      <div 
                        className={cn("h-full rounded-full bg-gradient-to-r transition-all duration-500", barColorClass)} 
                        style={{ width: `${seg.engagement}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[10px] font-semibold">
                    <span className="uppercase text-slate-400 tracking-wider">
                      {recommendations[seg.segment] || 'ACTION REQUIRED'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── Fan Proof Stream Table (Proof records coming back) ─── */}
      <section className="m-card p-5">
        <div className="border-b border-white/[0.04] pb-4.5 mb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <span className="text-xs font-semibold text-[var(--m-accent)] uppercase tracking-wider">
              CONVERSION VERIFICATION
            </span>
            <h2 className="text-base font-semibold text-white mt-1">Proof Coming Back from the Audience</h2>
          </div>
          <Link href="/music-console/proof">
            <button className="text-xs font-semibold py-2 px-3.5 rounded-md bg-white/[0.03] text-white border border-white/5 hover:bg-white/[0.08] transition-colors">
              Open Full Proof Log <ArrowRight className="ml-1 h-3 w-3 inline" />
            </button>
          </Link>
        </div>

        {/* Proof Stream Table */}
        <div className="border border-white/[0.03] rounded-lg bg-black/25 w-full overflow-hidden">
          <table className="w-full text-xs text-left border-collapse m-table table-fixed">
            <colgroup>
              <col className="w-[20%]" />
              <col className="w-[20%]" />
              <col className="w-[25%]" />
              <col className="w-[15%]" />
              <col className="w-[10%]" />
              <col className="w-[10%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-white/[0.05] bg-black/40">
                <th className="py-3 px-4 font-semibold text-slate-400 uppercase">Fan Name / Contact</th>
                <th className="py-3 px-4 font-semibold text-slate-400 uppercase">Segment / Intent</th>
                <th className="py-3 px-4 font-semibold text-slate-400 uppercase">Campaign Name</th>
                <th className="py-3 px-4 font-semibold text-slate-400 uppercase text-center">Outcome</th>
                <th className="py-3 px-4 font-semibold text-slate-400 uppercase text-right">CPA</th>
                <th className="py-3 px-4 font-semibold text-slate-400 uppercase text-right">Actions</th>
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
                      : 'border-l-slate-500';

                return (
                  <React.Fragment key={r.id}>
                    <tr className={cn("border-b border-white/[0.03] hover:bg-white/[0.01] transition-colors border-l-2", borderLeftColor)}>
                      <td className="py-4 px-4 min-w-0">
                        <div className="font-semibold text-white truncate">{r.fanName}</div>
                        <div className="font-mono text-xs text-slate-500 mt-0.5">xxxxxx{r.fanPhone.slice(-4)}</div>
                      </td>
                      <td className="py-4 px-4 min-w-0">
                        <div className="flex items-center gap-2">
                          <SegmentBadge segment={r.segment} />
                          <span className={cn(
                            'text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded border',
                            r.intent === 'high'
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : r.intent === 'medium'
                                ? 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                                : 'bg-zinc-850 text-zinc-400 border-zinc-700'
                          )}>
                            {r.intent}
                          </span>
                        </div>
                      </td>
                      <td className="py-4 px-4 text-slate-355 font-normal truncate min-w-0">
                        {r.campaignName}
                      </td>
                      <td className="py-4 px-4 text-center">
                        <div className="inline-flex justify-center w-full">
                          <ProofBadge outcome={r.outcome} verified={r.verifiedAction} />
                        </div>
                      </td>
                      <td className="py-4 px-4 text-right font-mono font-semibold text-slate-300">
                        {formatCurrency(r.cpaAttribution)}
                      </td>
                      <td className="py-4 px-4 text-right">
                        <div className="flex items-center justify-end gap-2 shrink-0">
                          {r.hasRecording && (
                            <button
                              onClick={() => togglePlay(r.id)}
                              className={cn(
                                "text-xs font-semibold px-2.5 py-1.5 rounded-md border transition-all flex items-center gap-1",
                                isPlaying 
                                  ? "bg-[var(--m-accent)] text-black border-[var(--m-accent)]" 
                                  : "bg-zinc-900 text-zinc-300 border-zinc-800 hover:bg-zinc-800 hover:text-white"
                              )}
                              title="Listen to Audio Proof"
                            >
                              <Volume2 className="h-3.5 w-3.5" />
                              <span>{isPlaying ? 'Stop' : 'Listen'}</span>
                            </button>
                          )}
                          {r.hasTranscript && (
                            <button
                              onClick={() => toggleTranscript(r.id)}
                              className={cn(
                                "text-xs font-semibold px-2.5 py-1.5 rounded-md border transition-all flex items-center gap-1",
                                isExpanded 
                                  ? "bg-zinc-800 text-white border-zinc-700" 
                                  : "bg-zinc-900 text-zinc-300 border-zinc-800 hover:bg-zinc-800 hover:text-white"
                              )}
                              title="View Logs"
                            >
                              <FileText className="h-3.5 w-3.5" />
                              <span>Transcript</span>
                              {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            </button>
                          )}
                          <Link href={`/music-console/proof?id=${r.id}`}>
                            <button 
                              className="p-2 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-all shrink-0"
                              title="Details"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                          </Link>
                        </div>
                      </td>
                    </tr>

                    {/* Expandable Waveform Details */}
                    {isPlaying && (
                      <tr className="bg-zinc-950/40">
                        <td colSpan={6} className="py-4 px-6">
                          <div className="flex items-center gap-4 bg-zinc-900/60 border border-zinc-800 p-4 rounded-lg">
                            <Volume2 className="h-4 w-4 text-[var(--m-accent)] shrink-0 animate-pulse" />
                            <div className="flex-1 h-1.5 bg-zinc-950 rounded-full overflow-hidden relative border border-zinc-800">
                              <div className="h-full bg-[var(--m-accent)] w-1/3" />
                            </div>
                            <span className="text-xs font-medium text-slate-400 shrink-0">0:14 / 1:24</span>
                          </div>
                        </td>
                      </tr>
                    )}

                    {/* Expandable Verbatim Conversation Audit Logs */}
                    {isExpanded && r.transcriptSnippet && (
                      <tr className="bg-zinc-950/40">
                        <td colSpan={6} className="py-5 px-6 border-b border-zinc-800/80">
                          <div className="bg-zinc-900/60 border border-zinc-800 p-5 rounded-lg space-y-3">
                            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 border-b border-zinc-800 pb-2 mb-2">
                              Verbatim Conversation Audit Log
                            </div>
                            {r.transcriptSnippet.split('\n').map((line, idx) => {
                              const isAi = line.startsWith('AI:');
                              const speaker = isAi ? 'Operator AI' : 'Fan';
                              const text = isAi
                                ? line.replace('AI:', '').trim()
                                : line.replace('Fan:', '').trim();

                              return (
                                <div key={idx} className="flex gap-4 text-xs">
                                  <span className={cn(
                                    'w-28 font-semibold uppercase tracking-wide shrink-0 text-[10px]',
                                    isAi ? 'text-[var(--m-accent)]' : 'text-slate-500'
                                  )}>
                                    {speaker}:
                                  </span>
                                  <span className="text-slate-300 leading-relaxed font-normal">{text}</span>
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
      </section>
    </div>
  );
}
