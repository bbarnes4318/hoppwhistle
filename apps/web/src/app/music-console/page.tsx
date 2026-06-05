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
      <div className="bg-[#0f121d] border border-white/10 rounded-lg p-3.5 shadow-lg space-y-1.5">
        <p className="text-[9px] font-mono font-bold text-slate-400 uppercase tracking-wider">{label}</p>
        <div className="space-y-1 font-sans">
          {payload.map((pld: any) => (
            <div key={pld.dataKey} className="flex items-center gap-4 justify-between text-xs">
              <span className="flex items-center gap-1.5 text-slate-300 font-medium">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: pld.stroke || pld.color }} />
                {pld.name}:
              </span>
              <span className="font-mono font-bold text-white">
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
            <span className="text-[9px] font-black tracking-widest text-[#a78bfa] bg-[#a78bfa]/10 border border-[#a78bfa]/15 px-2 py-0.5 rounded">
              CAMPAIGN COCKPIT
            </span>
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-emerald-500/25 bg-emerald-500/10 text-[10px] font-semibold text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-mono uppercase tracking-wider">{livePulse.status}</span>
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
        <div className="m-card p-4.5 flex flex-col justify-between h-28 relative overflow-hidden group">
          <div className="flex justify-between items-start">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Reached Fans</span>
            <Users className="h-4 w-4 text-[#a78bfa]" />
          </div>
          <div>
            <div className="text-2xl font-black font-mono tracking-tight text-white leading-none mt-2">
              {formatCompactNumber(topKpis.fansContacted.value)}
            </div>
            <div className="flex justify-between items-center mt-1 text-[10px]">
              <span className="text-slate-500 font-medium">Outbound</span>
              <span className="text-emerald-400 font-mono font-bold">
                +{topKpis.fansContacted.change}%
              </span>
            </div>
          </div>
        </div>

        {/* Human Answers */}
        <div className="m-card p-4.5 flex flex-col justify-between h-28 relative overflow-hidden group">
          <div className="flex justify-between items-start">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Human Answers</span>
            <Headphones className="h-4 w-4 text-[#a78bfa]" />
          </div>
          <div>
            <div className="text-2xl font-black font-mono tracking-tight text-white leading-none mt-2">
              {formatCompactNumber(topKpis.humanAnswers.value)}
            </div>
            <div className="flex justify-between items-center mt-1 text-[10px]">
              <span className="text-slate-500 font-medium">Pickup Rate</span>
              <span className="text-emerald-400 font-mono font-bold">
                +{topKpis.humanAnswers.change}%
              </span>
            </div>
          </div>
        </div>

        {/* Verified Actions */}
        <div className="m-card p-4.5 flex flex-col justify-between h-28 relative overflow-hidden group">
          <div className="flex justify-between items-start">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Verified Actions</span>
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
          </div>
          <div>
            <div className="text-2xl font-black font-mono tracking-tight text-emerald-400 leading-none mt-2">
              {formatCompactNumber(topKpis.verifiedEngagements.value)}
            </div>
            <div className="flex justify-between items-center mt-1 text-[10px]">
              <span className="text-slate-500 font-medium">Intent Match</span>
              <span className="text-emerald-400 font-mono font-bold">
                +{topKpis.verifiedEngagements.change}%
              </span>
            </div>
          </div>
        </div>

        {/* Pre-Saves */}
        <div className="m-card p-4.5 flex flex-col justify-between h-28 relative overflow-hidden group">
          <div className="flex justify-between items-start">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Pre-Saves</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          </div>
          <div>
            <div className="text-2xl font-black font-mono tracking-tight text-white leading-none mt-2">
              {formatCompactNumber(topKpis.preSaves.value)}
            </div>
            <div className="flex justify-between items-center mt-1 text-[10px]">
              <span className="text-slate-500 font-medium">Conversions</span>
              <span className="text-emerald-400 font-mono font-bold">
                +{topKpis.preSaves.change}%
              </span>
            </div>
          </div>
        </div>

        {/* Cost / Pre-Save */}
        <div className="m-card p-4.5 flex flex-col justify-between h-28 relative overflow-hidden group">
          <div className="flex justify-between items-start">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Cost / Pre-Save</span>
            <DollarSign className="h-4 w-4 text-amber-500" />
          </div>
          <div>
            <div className="text-2xl font-black font-mono tracking-tight text-amber-400 leading-none mt-2">
              {formatCurrency(topKpis.costPerPreSave.value)}
            </div>
            <div className="flex justify-between items-center mt-1 text-[10px]">
              <span className="text-slate-500 font-medium">CPA Avg</span>
              <span className="text-emerald-400 font-mono font-bold">
                {topKpis.costPerPreSave.change}%
              </span>
            </div>
          </div>
        </div>

        {/* Proof Records */}
        <div className="m-card p-4.5 flex flex-col justify-between h-28 relative overflow-hidden group">
          <div className="flex justify-between items-start">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Proof Records</span>
            <FileText className="h-4 w-4 text-[#a78bfa]" />
          </div>
          <div>
            <div className="text-2xl font-black font-mono tracking-tight text-white leading-none mt-2">
              {formatCompactNumber(topKpis.proofCaptured.value)}
            </div>
            <div className="flex justify-between items-center mt-1 text-[10px]">
              <span className="text-slate-500 font-medium">Audit logs</span>
              <span className="text-emerald-400 font-mono font-bold">
                +{topKpis.proofCaptured.change}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Funnel Journey Horizontal Timeline ─── */}
      <section className="m-card p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/[0.04] pb-3 mb-5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">
            Conversion Journey Pipeline
          </h3>
          <span className="text-[10px] font-mono text-slate-400 bg-white/[0.02] border border-white/[0.05] px-2 py-0.5 rounded">
            Operational Funnel State: Active
          </span>
        </div>

        <div className="flex flex-col md:flex-row items-center justify-between gap-4 md:gap-2">
          {funnelData.map((stage, i) => {
            const icons = [
              <Users className="h-3.5 w-3.5" style={{ color: stage.color }} />,
              <Phone className="h-3.5 w-3.5" style={{ color: stage.color }} />,
              <Headphones className="h-3.5 w-3.5" style={{ color: stage.color }} />,
              <MessageSquare className="h-3.5 w-3.5" style={{ color: stage.color }} />,
              <ShieldCheck className="h-3.5 w-3.5" style={{ color: stage.color }} />,
              <CheckCircle2 className="h-3.5 w-3.5" style={{ color: stage.color }} />,
            ];

            return (
              <React.Fragment key={stage.label}>
                <div 
                  className="flex-1 w-full md:w-auto p-3 bg-white/[0.01] hover:bg-white/[0.03] border border-white/[0.04] rounded-lg flex items-center gap-3.5 relative cursor-pointer group transition-colors"
                  onMouseEnter={() => setHoveredStageIndex(i)}
                  onMouseLeave={() => setHoveredStageIndex(null)}
                >
                  <div 
                    className="w-8 h-8 rounded-md flex items-center justify-center border shrink-0 bg-black/30"
                    style={{ borderColor: `${stage.color}40`, boxShadow: `0 2px 4px rgba(0,0,0,0.2)` }}
                  >
                    {icons[i]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="text-[8px] font-bold text-slate-500 uppercase tracking-widest block leading-none">Stage 0{i + 1}</span>
                    <span className="text-[11px] font-bold text-white uppercase tracking-wide truncate block mt-1">{stage.label}</span>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] font-mono">
                      <span className="text-slate-400 font-bold">{formatCompactNumber(stage.count)}</span>
                      <span className="text-slate-600">•</span>
                      <span style={{ color: stage.color }} className="font-extrabold">{stage.percentage.toFixed(0)}%</span>
                    </div>
                  </div>

                  {/* Clean Tooltip Popup */}
                  {hoveredStageIndex === i && (
                    <div className="absolute bottom-[115%] left-1/2 -translate-x-1/2 w-72 bg-[#0f121d] border border-white/10 rounded-lg p-3.5 shadow-2xl z-40 pointer-events-none">
                      <div className="flex justify-between items-center text-[9px] font-mono border-b border-white/5 pb-1.5 mb-2">
                        <span className="text-slate-400">TELEMETRY</span>
                        <span style={{ color: stage.color }} className="font-bold">{stage.percentage.toFixed(1)}% Conversion</span>
                      </div>
                      <p className="text-[10px] text-slate-300 font-medium leading-relaxed">
                        {meanings[stage.label] || stage.label}
                      </p>
                      <div className="mt-2.5 space-y-1">
                        {activityLogs[i]?.slice(0, 2).map((log, logIdx) => (
                          <div key={logIdx} className="font-mono text-[9px] text-slate-500 truncate">
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

      {/* ─── Main Analytics Section (Area Chart & Diagnostics / Heat Board) ─── */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Area Chart Container (col-span-2) */}
        <div className="lg:col-span-2 m-card p-5 flex flex-col justify-between relative overflow-hidden">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/[0.04] pb-4.5 mb-5">
            <div>
              <span className="text-[9px] font-extrabold text-[#a78bfa] uppercase tracking-widest flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#a78bfa] animate-pulse" /> Real-time Conversion Telemetry
              </span>
              <h2 className="text-sm font-bold text-white uppercase tracking-wider mt-1">Live Campaign Movement</h2>
            </div>
            
            <div className="flex items-center gap-2 font-mono text-[10px]">
              <span className="px-2 py-0.5 rounded bg-[#9F7AEA]/10 text-[#a78bfa] border border-[#9F7AEA]/15 font-bold">
                {livePulse.answerRate}% Connects
              </span>
              <span className="px-2 py-0.5 rounded bg-[#06B6D4]/10 text-[#06B6D4] border border-[#06B6D4]/15 font-bold">
                {livePulse.verifiedRate}% Conversions
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-5 items-stretch flex-1">
            
            {/* Left Column: Diagnostics Statistics */}
            <div className="md:col-span-1 space-y-4 flex flex-col justify-between">
              
              <div className="bg-black/20 p-3 rounded-lg border border-white/[0.03] space-y-2">
                <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider border-b border-white/5 pb-1">
                  Diagnostics
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Active Dials</span>
                  <span className="font-mono font-bold text-white">24/s</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Ping Latency</span>
                  <span className="font-mono font-bold text-emerald-400">12ms</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Queue Size</span>
                  <span className="font-mono font-bold text-white">4,124</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Avg Duration</span>
                  <span className="font-mono font-bold text-white">48s</span>
                </div>
              </div>

              <div className="bg-black/20 p-3 rounded-lg border border-white/[0.03] space-y-1.5 flex-1 flex flex-col justify-center">
                <div className="text-[9px] font-bold text-amber-500 uppercase tracking-widest flex items-center gap-1">
                  <Flame className="w-3 h-3" /> Peak Spike
                </div>
                <p className="text-[11px] text-slate-300 leading-normal font-medium mt-1">
                  Verified activations peaked on April 22 following the North American Tour On-Sale launch, showing an 18.4% conversion rate surge.
                </p>
              </div>
            </div>

            {/* Right Column: Next.js Chart */}
            <div className="md:col-span-3 h-[240px] md:h-auto min-h-[220px] w-full relative bg-black/20 rounded-lg border border-white/[0.03] p-3 overflow-hidden">
              {mounted ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={campaignTimeSeries}
                    margin={{ top: 5, right: 5, left: -25, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="colorAnswers" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#9F7AEA" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#9F7AEA" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorVerified" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#06B6D4" stopOpacity={0.15} />
                        <stop offset="95%" stopColor="#06B6D4" stopOpacity={0} />
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
                      tick={{ fontSize: 9, fill: '#9ca3af', fontWeight: 500 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      stroke="#4b5563"
                      tick={{ fontSize: 9, fill: '#9ca3af', fontWeight: 500 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip content={<CustomTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="humanAnswers"
                      name="Answers"
                      stroke="#9F7AEA"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorAnswers)"
                      activeDot={{ r: 4, stroke: '#0f121d', strokeWidth: 1.5, fill: '#9F7AEA' }}
                      dot={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="verifiedEngagements"
                      name="Conversions"
                      stroke="#06B6D4"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorVerified)"
                      activeDot={{ r: 4, stroke: '#0f121d', strokeWidth: 1.5, fill: '#06B6D4' }}
                      dot={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-full text-xs text-slate-500 font-mono">
                  Loading telemetry signal charts...
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Audience Leaderboard / Heat Board (col-span-1) */}
        <div className="m-card p-5 flex flex-col justify-between relative overflow-hidden">
          <div className="border-b border-white/[0.04] pb-4 mb-4">
            <span className="text-[9px] font-bold text-amber-500 uppercase tracking-widest">
              COHORT LEADERS
            </span>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider mt-1">Audience Heat Board</h2>
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
                ? 'text-amber-400 bg-amber-400/10 border-amber-500/20'
                : isWarm
                  ? 'text-violet-400 bg-violet-400/10 border-violet-500/20'
                  : 'text-cyan-400 bg-cyan-400/10 border-cyan-500/20';

              const barColorClass = isCrit
                ? 'from-amber-600 to-amber-400 shadow-[0_0_4px_rgba(245,158,11,0.3)]'
                : isWarm
                  ? 'from-violet-600 to-violet-400 shadow-[0_0_4px_rgba(139,92,246,0.3)]'
                  : 'from-cyan-600 to-cyan-400 shadow-[0_0_4px_rgba(6,182,212,0.3)]';

              return (
                <div
                  key={seg.segment}
                  className="bg-black/15 border border-white/[0.03] hover:border-white/10 rounded-lg p-3 space-y-2.5 transition-colors group"
                >
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-5 h-5 flex items-center justify-center border border-white/10 rounded bg-black/40 text-[10px] font-mono font-bold text-slate-400">
                        {i + 1}
                      </span>
                      <span className="font-bold text-white uppercase tracking-wide block truncate">
                        {seg.segment}
                      </span>
                    </div>
                    <span className={cn("text-[9px] font-mono font-black px-1.5 py-0.5 rounded border tracking-wider", heatColorClass)}>
                      {seg.engagement}% HEAT
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between items-center text-[8px] font-bold text-slate-500 uppercase">
                      <span>Volume: {formatCompactNumber(seg.count)}</span>
                      <span className="font-mono">{seg.engagement}% Target</span>
                    </div>
                    {/* Sleek Continuous Progress Bar */}
                    <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                      <div 
                        className={cn("h-full rounded-full bg-gradient-to-r transition-all duration-500", barColorClass)} 
                        style={{ width: `${seg.engagement}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[8px] font-bold text-slate-500">
                    <span className="text-[8px] font-black uppercase text-slate-400 font-mono tracking-wider">
                      {recommendations[seg.segment] || 'ACTION REQUIRED'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── Telemetry Real-time Console Log Ticker ─── */}
      <section className="m-card p-5">
        <div className="bg-[#090b0f] border border-white/5 rounded-lg overflow-hidden flex flex-col">
          {/* Header Bar */}
          <div className="bg-black/40 px-4 py-2.5 flex items-center justify-between border-b border-white/5 relative z-10 backdrop-blur-md">
            <span className="text-[9px] font-mono font-bold tracking-widest text-slate-400 uppercase select-none flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[#EF4444]/90" /> Live Dial Status Stream
            </span>
            <span className="text-[8px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 uppercase tracking-widest font-black select-none">
              SYSTEM NOMINAL
            </span>
          </div>

          {/* CRT Terminal Screen content with vertical scrolling logs */}
          <div className="p-4 space-y-2 font-mono text-[10px] leading-relaxed text-emerald-400 select-all relative bg-black/40">
            <div className="flex items-start gap-2">
              <span className="text-emerald-500/30 font-bold shrink-0">[17:54:12]</span>
              <span className="text-violet-400 font-bold uppercase tracking-wider shrink-0">▸ OUTBOUND:</span>
              <span className="text-slate-300 font-medium">Initiated contact route for +1865***1182 (Superfans tier) -> Ringing...</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-emerald-500/30 font-bold shrink-0">[17:54:18]</span>
              <span className="text-violet-400 font-bold uppercase tracking-wider shrink-0">▸ ANSWERED:</span>
              <span className="text-slate-300 font-medium">Connect established on Node 02 for +1551***6220 -> Speech synthesis running...</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-emerald-500/30 font-bold shrink-0">[17:54:25]</span>
              <span className="text-amber-400 font-bold uppercase tracking-wider shrink-0">▸ INTENT:</span>
              <span className="text-amber-400 font-medium font-bold">Fan verbal intent captured (Confidence: 94.2%) -> dispatching pre-save hook.</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-emerald-500/30 font-bold shrink-0">[17:54:32]</span>
              <span className="text-emerald-400 font-bold uppercase tracking-wider shrink-0">✔ SUCCESS:</span>
              <span className="text-white font-extrabold">Pre-save completed. CPA attribution: $0.25 (Transaction ref: tx_815a5f70)</span>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Fan Proof Stream Table (Proof records coming back) ─── */}
      <section className="m-card p-5">
        <div className="border-b border-white/[0.04] pb-4.5 mb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-widest">
              CONVERSION VERIFICATION
            </span>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider mt-1">Proof Coming Back from the Audience</h2>
          </div>
          <Link href="/music-console/proof">
            <button className="text-xs font-bold py-2 px-3.5 rounded-md bg-white/[0.03] text-white border border-white/5 hover:bg-white/[0.08] transition-colors">
              Open Full Proof Log <ArrowRight className="ml-1 h-3 w-3 inline" />
            </button>
          </Link>
        </div>

        {/* Proof Stream Table */}
        <div className="overflow-x-auto border border-white/[0.03] rounded-lg bg-black/25">
          <table className="w-full text-xs text-left border-collapse m-table">
            <thead>
              <tr className="border-b border-white/[0.05] bg-black/40">
                <th className="py-2.5 px-4 font-bold text-slate-400 uppercase">Fan Name / Contact</th>
                <th className="py-2.5 px-4 font-bold text-slate-400 uppercase">Segment / Intent</th>
                <th className="py-2.5 px-4 font-bold text-slate-400 uppercase">Campaign Name</th>
                <th className="py-2.5 px-4 font-bold text-slate-400 uppercase text-center">Outcome</th>
                <th className="py-2.5 px-4 font-bold text-slate-400 uppercase text-right">CPA</th>
                <th className="py-2.5 px-4 font-bold text-slate-400 uppercase text-right">Actions</th>
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
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-white">{r.fanName}</div>
                        <div className="font-mono text-[10px] text-slate-500 mt-0.5">xxxxxx{r.fanPhone.slice(-4)}</div>
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <SegmentBadge segment={r.segment} />
                          <span className={cn(
                            'text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded border font-mono',
                            r.intent === 'high'
                              ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20'
                              : r.intent === 'medium'
                                ? 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                                : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                          )}>
                            {r.intent}
                          </span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-slate-300 font-medium">
                        {r.campaignName}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <div className="inline-flex justify-center w-full">
                          <ProofBadge outcome={r.outcome} verified={r.verifiedAction} />
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-amber-400">
                        {formatCurrency(r.cpaAttribution)}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {r.hasRecording && (
                            <button
                              onClick={() => togglePlay(r.id)}
                              className={cn(
                                "text-[10px] font-bold px-2.5 py-1 rounded flex items-center gap-1 border transition-all uppercase font-mono",
                                isPlaying 
                                  ? "bg-violet-600 text-white border-violet-500" 
                                  : "bg-violet-950/20 text-violet-400 border-violet-900/30 hover:bg-violet-900/20"
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
                                "text-[10px] font-bold px-2.5 py-1 rounded flex items-center gap-1 border transition-all uppercase font-mono",
                                isExpanded 
                                  ? "bg-zinc-700 text-white border-zinc-600" 
                                  : "bg-zinc-950/20 text-zinc-400 border-zinc-900/30 hover:bg-zinc-900/20"
                              )}
                            >
                              <FileText className="h-3 w-3" />
                              <span>Logs</span>
                              {isExpanded ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
                            </button>
                          )}
                          <Link href={`/music-console/proof?id=${r.id}`}>
                            <button className="p-1 rounded bg-black/40 border border-white/5 text-slate-400 hover:text-white hover:border-white/20 transition-all">
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                          </Link>
                        </div>
                      </td>
                    </tr>

                    {/* Expandable Waveform Details */}
                    {isPlaying && (
                      <tr className="bg-black/25">
                        <td colSpan={6} className="py-3 px-6">
                          <div className="flex items-center gap-4 bg-black/30 border border-white/[0.03] p-3.5 rounded-lg">
                            <Volume2 className="h-4 w-4 text-violet-400 animate-bounce shrink-0" />
                            <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden relative">
                              <div className="h-full bg-violet-500 w-1/3 animate-[pulse_2s_infinite]" />
                            </div>
                            <span className="text-[10px] font-mono text-slate-400 font-bold shrink-0">0:14 / 1:24</span>
                          </div>
                        </td>
                      </tr>
                    )}

                    {/* Expandable Verbatim Conversation Audit Logs */}
                    {isExpanded && r.transcriptSnippet && (
                      <tr className="bg-black/25">
                        <td colSpan={6} className="py-4 px-6 border-b border-white/[0.04]">
                          <div className="bg-black/30 border border-white/[0.03] p-4 rounded-lg space-y-2">
                            <div className="text-[9px] uppercase tracking-widest font-black text-slate-500 border-b border-white/5 pb-2 mb-2">
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
                                    'w-24 font-black uppercase tracking-wider shrink-0 text-[10px]',
                                    isAi ? 'text-violet-400' : 'text-slate-500'
                                  )}>
                                    {speaker}:
                                  </span>
                                  <span className="text-slate-300 leading-relaxed font-medium">{text}</span>
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
