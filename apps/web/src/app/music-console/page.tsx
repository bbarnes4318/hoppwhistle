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
  Play,
  Flame,
  Music,
  ChevronDown,
  ChevronUp,
  Database,
  Phone,
  MessageSquare,
  Award,
  Radio,
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
  outcomeLabel,
  segmentLabel,
} from '@/features/music/lib/utils';
import {
  MetricCard,
  PremiumCard,
  StatusBadge,
  ProofBadge,
  SegmentBadge,
  ActionButton,
} from '@/features/music/components';
import { cn } from '@/lib/utils';

// Client-safe time extractor to prevent hydration warnings
const formatTimestamp = (ts: string) => {
  const parts = ts.split('T');
  if (parts.length < 2) return '';
  const time = parts[1].slice(0, 5); // extracts "HH:MM"
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
    <div className="space-y-12 pb-16">
      {/* ─── SECTION 1: Premium Hero Command Module (Dark Obsidian) ─── */}
      {/* ─── SECTION 1: Premium Hero Command Module (Dark Obsidian) ─── */}
      <section className="bg-[var(--m-surface)] text-[var(--m-text)] rounded-2xl border border-[var(--m-border)] p-8 lg:p-10 relative overflow-hidden shadow-[0_12px_40px_-4px_rgba(0,0,0,0.35)]">
        {/* Glow Highlights */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-[#8B5CF6]/5 rounded-full blur-[120px] pointer-events-none opacity-40" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-[var(--m-accent-2)]/5 rounded-full blur-[90px] pointer-events-none opacity-30" />

        <div className="relative z-10 space-y-6">
          {/* Header Row */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-[var(--m-border-2)] pb-6">
            <div className="space-y-2.5">
              <div className="flex items-center gap-3">
                <span className="text-[9px] font-black tracking-[0.25em] text-[#A78BFA] uppercase bg-[#A78BFA]/10 border border-[#A78BFA]/20 px-2.5 py-0.5 rounded">
                  ACTIVE CAMPAIGN
                </span>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-[var(--m-accent-2)]/20 bg-[var(--m-accent-2)]/10 text-xs font-semibold text-[var(--m-accent-2)]">
                  <span className="m-pulse-dot h-1.5 w-1.5" />
                  <span className="font-mono text-[9px] uppercase tracking-wider">{livePulse.status}</span>
                </span>
              </div>
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight leading-tight">
                <span className="bg-clip-text text-transparent bg-gradient-to-r from-[var(--m-accent)] via-[#c084fc] to-[#d8b4fe]">
                  {livePulse.campaignName}
                </span>
                <span className="text-[var(--m-text-2)] font-light font-sans text-xl lg:text-2xl block mt-1">
                  by <span className="font-semibold text-[#A78BFA]">{livePulse.artist}</span>
                </span>
              </h1>
            </div>

            {/* CTAs */}
            <div className="flex items-center gap-3 shrink-0 self-start md:self-end">
              <Link href="/music-console/proof">
                <ActionButton variant="primary" className="text-xs font-semibold py-2.5 px-4 shadow-[0_4px_16px_rgba(139,92,246,0.2)] hover:shadow-[0_6px_20px_rgba(139,92,246,0.35)]">
                  View Proof Log <ArrowRight className="h-3.5 w-3.5" />
                </ActionButton>
              </Link>
              <Link href="/music-console/reports">
                <button className="text-xs font-semibold py-2.5 px-4 rounded-lg bg-white/[0.04] text-white border border-white/10 hover:bg-white/[0.08] hover:border-white/20 transition-all">
                  Open Reports
                </button>
              </Link>
            </div>
          </div>

          {/* 6 Core KPIs Grid (Premium Redesigned Horizontal Strip) */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6 pt-4">
            
            {/* KPI 1: Reached Fans */}
            <div className="bg-[var(--m-surface-2)] border border-[var(--m-border)] hover:border-[var(--m-accent)]/30 rounded-2xl p-6 flex flex-col justify-between h-44 transition-all duration-500 hover:shadow-[0_12px_30px_rgba(0,0,0,0.4)] hover:-translate-y-1 relative overflow-hidden group">
              <div className="absolute -right-10 -bottom-10 w-28 h-28 bg-[var(--m-accent)]/10 rounded-full blur-2xl group-hover:bg-[var(--m-accent)]/20 transition-all duration-500 pointer-events-none" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <div className="flex justify-between items-start">
                  <div className="text-3xl lg:text-4xl font-extrabold font-mono text-[var(--m-text)] tracking-tight leading-none">
                    {formatCompactNumber(topKpis.fansContacted.value)}
                  </div>
                  <div className="p-1.5 bg-[var(--m-surface-3)] border border-[var(--m-border)] rounded-lg text-[var(--m-accent)] group-hover:scale-110 transition-transform duration-300">
                    <Users className="h-4 w-4" />
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[10px] font-black text-[var(--m-muted)] uppercase tracking-wider">
                    Reached Fans
                  </span>
                  <span className="text-[9px] text-[#A78BFA] font-mono font-bold flex items-center gap-0.5 bg-[#A78BFA]/10 border border-[#A78BFA]/20 px-1.5 py-0.5 rounded">
                    <TrendingUp className="h-3 w-3" /> +{topKpis.fansContacted.change}%
                  </span>
                </div>
                <div className="mt-4 w-full overflow-visible">
                  <svg className="w-full h-8 overflow-visible" viewBox="0 0 100 24" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="glow-kpi-1" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--m-accent)" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="var(--m-accent)" stopOpacity="0.0" />
                      </linearGradient>
                      <filter id="blur-kpi-1">
                        <feGaussianBlur stdDeviation="1.2" result="blur" />
                        <feMerge>
                          <feMergeNode in="blur" />
                          <feMergeNode in="SourceGraphic" />
                        </feMerge>
                      </filter>
                    </defs>
                    <path d="M0 18 Q20 22 40 10 T80 12 T100 2 L100 24 L0 24 Z" fill="url(#glow-kpi-1)" />
                    <path d="M0 18 Q20 22 40 10 T80 12 T100 2" stroke="var(--m-accent)" strokeWidth="2" fill="none" strokeLinecap="round" filter="url(#blur-kpi-1)" />
                  </svg>
                </div>
              </div>
            </div>

            {/* KPI 2: Human Answers */}
            <div className="bg-[var(--m-surface-2)] border border-[var(--m-border)] hover:border-[var(--m-accent)]/30 rounded-2xl p-6 flex flex-col justify-between h-44 transition-all duration-500 hover:shadow-[0_12px_30px_rgba(0,0,0,0.4)] hover:-translate-y-1 relative overflow-hidden group">
              <div className="absolute -right-10 -bottom-10 w-28 h-28 bg-[var(--m-accent)]/10 rounded-full blur-2xl group-hover:bg-[var(--m-accent)]/20 transition-all duration-500 pointer-events-none" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <div className="flex justify-between items-start">
                  <div className="text-3xl lg:text-4xl font-extrabold font-mono text-[var(--m-text)] tracking-tight leading-none">
                    {formatCompactNumber(topKpis.humanAnswers.value)}
                  </div>
                  <div className="p-1.5 bg-[var(--m-surface-3)] border border-[var(--m-border)] rounded-lg text-[var(--m-accent)] group-hover:scale-110 transition-transform duration-300">
                    <Headphones className="h-4 w-4" />
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[10px] font-black text-[var(--m-muted)] uppercase tracking-wider">
                    Human Answers
                  </span>
                  <span className="text-[9px] text-[#A78BFA] font-mono font-bold flex items-center gap-0.5 bg-[#A78BFA]/10 border border-[#A78BFA]/20 px-1.5 py-0.5 rounded">
                    <TrendingUp className="h-3 w-3" /> +{topKpis.humanAnswers.change}%
                  </span>
                </div>
                <div className="mt-4 w-full overflow-visible">
                  <svg className="w-full h-8 overflow-visible" viewBox="0 0 100 24" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="glow-kpi-2" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--m-accent)" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="var(--m-accent)" stopOpacity="0.0" />
                      </linearGradient>
                      <filter id="blur-kpi-2">
                        <feGaussianBlur stdDeviation="1.2" result="blur" />
                        <feMerge>
                          <feMergeNode in="blur" />
                          <feMergeNode in="SourceGraphic" />
                        </feMerge>
                      </filter>
                    </defs>
                    <path d="M0 16 Q15 6 45 18 T75 8 T100 2 L100 24 L0 24 Z" fill="url(#glow-kpi-2)" />
                    <path d="M0 16 Q15 6 45 18 T75 8 T100 2" stroke="var(--m-accent)" strokeWidth="2" fill="none" strokeLinecap="round" filter="url(#blur-kpi-2)" />
                  </svg>
                </div>
              </div>
            </div>

            {/* KPI 3: Verified Actions */}
            <div className="bg-[var(--m-surface-2)] border border-[var(--m-border)] hover:border-[var(--m-accent-2)]/30 rounded-2xl p-6 flex flex-col justify-between h-44 transition-all duration-500 hover:shadow-[0_12px_30px_rgba(0,0,0,0.4)] hover:-translate-y-1 relative overflow-hidden group">
              <div className="absolute -right-10 -bottom-10 w-28 h-28 bg-[var(--m-accent-2)]/10 rounded-full blur-2xl group-hover:bg-[var(--m-accent-2)]/20 transition-all duration-500 pointer-events-none" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <div className="flex justify-between items-start">
                  <div className="text-3xl lg:text-4xl font-extrabold font-mono text-[var(--m-accent-2)] tracking-tight leading-none">
                    {formatCompactNumber(topKpis.verifiedEngagements.value)}
                  </div>
                  <div className="p-1.5 bg-[var(--m-surface-3)] border border-[var(--m-border)] rounded-lg text-[var(--m-accent-2)] group-hover:scale-110 transition-transform duration-300">
                    <ShieldCheck className="h-4 w-4" />
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[10px] font-black text-[var(--m-muted)] uppercase tracking-wider">
                    Verified Actions
                  </span>
                  <span className="text-[9px] text-[var(--m-accent-2)] font-mono font-bold flex items-center gap-0.5 bg-[var(--m-accent-2)]/10 border border-[var(--m-accent-2)]/20 px-1.5 py-0.5 rounded">
                    <TrendingUp className="h-3 w-3" /> +{topKpis.verifiedEngagements.change}%
                  </span>
                </div>
                <div className="mt-4 w-full overflow-visible">
                  <svg className="w-full h-8 overflow-visible" viewBox="0 0 100 24" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="glow-kpi-3" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--m-accent-2)" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="var(--m-accent-2)" stopOpacity="0.0" />
                      </linearGradient>
                      <filter id="blur-kpi-3">
                        <feGaussianBlur stdDeviation="1.2" result="blur" />
                        <feMerge>
                          <feMergeNode in="blur" />
                          <feMergeNode in="SourceGraphic" />
                        </feMerge>
                      </filter>
                    </defs>
                    <path d="M0 20 Q25 15 50 8 T75 12 T100 3 L100 24 L0 24 Z" fill="url(#glow-kpi-3)" />
                    <path d="M0 20 Q25 15 50 8 T75 12 T100 3" stroke="var(--m-accent-2)" strokeWidth="2" fill="none" strokeLinecap="round" filter="url(#blur-kpi-3)" />
                  </svg>
                </div>
              </div>
            </div>

            {/* KPI 4: Pre-Saves */}
            <div className="bg-[var(--m-surface-2)] border border-[var(--m-border)] hover:border-[var(--m-accent-2)]/30 rounded-2xl p-6 flex flex-col justify-between h-44 transition-all duration-500 hover:shadow-[0_12px_30px_rgba(0,0,0,0.4)] hover:-translate-y-1 relative overflow-hidden group">
              <div className="absolute -right-10 -bottom-10 w-28 h-28 bg-[var(--m-accent-2)]/10 rounded-full blur-2xl group-hover:bg-[var(--m-accent-2)]/20 transition-all duration-500 pointer-events-none" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <div className="flex justify-between items-start">
                  <div className="text-3xl lg:text-4xl font-extrabold font-mono text-[var(--m-text)] tracking-tight leading-none">
                    {formatCompactNumber(topKpis.preSaves.value)}
                  </div>
                  <div className="p-1.5 bg-[var(--m-surface-3)] border border-[var(--m-border)] rounded-lg text-[var(--m-accent-2)] group-hover:scale-110 transition-transform duration-300">
                    <CheckCircle2 className="h-4 w-4" />
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[10px] font-black text-[var(--m-muted)] uppercase tracking-wider">
                    Pre-Saves
                  </span>
                  <span className="text-[9px] text-[var(--m-accent-2)] font-mono font-bold flex items-center gap-0.5 bg-[var(--m-accent-2)]/10 border border-[var(--m-accent-2)]/20 px-1.5 py-0.5 rounded">
                    <TrendingUp className="h-3 w-3" /> +{topKpis.preSaves.change}%
                  </span>
                </div>
                <div className="mt-4 w-full overflow-visible">
                  <svg className="w-full h-8 overflow-visible" viewBox="0 0 100 24" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="glow-kpi-4" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--m-accent-2)" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="var(--m-accent-2)" stopOpacity="0.0" />
                      </linearGradient>
                      <filter id="blur-kpi-4">
                        <feGaussianBlur stdDeviation="1.2" result="blur" />
                        <feMerge>
                          <feMergeNode in="blur" />
                          <feMergeNode in="SourceGraphic" />
                        </feMerge>
                      </filter>
                    </defs>
                    <path d="M0 16 Q20 12 40 16 T80 6 T100 2 L100 24 L0 24 Z" fill="url(#glow-kpi-4)" />
                    <path d="M0 16 Q20 12 40 16 T80 6 T100 2" stroke="var(--m-accent-2)" strokeWidth="2" fill="none" strokeLinecap="round" filter="url(#blur-kpi-4)" />
                  </svg>
                </div>
              </div>
            </div>

            {/* KPI 5: Cost / Pre-Save */}
            <div className="bg-[var(--m-surface-2)] border border-[var(--m-border)] hover:border-[var(--m-warning)]/30 rounded-2xl p-6 flex flex-col justify-between h-44 transition-all duration-500 hover:shadow-[0_12px_30px_rgba(0,0,0,0.4)] hover:-translate-y-1 relative overflow-hidden group">
              <div className="absolute -right-10 -bottom-10 w-28 h-28 bg-[var(--m-warning)]/10 rounded-full blur-2xl group-hover:bg-[var(--m-warning)]/20 transition-all duration-500 pointer-events-none" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <div className="flex justify-between items-start">
                  <div className="text-3xl lg:text-4xl font-extrabold font-mono text-[var(--m-warning)] tracking-tight leading-none">
                    {formatCurrency(topKpis.costPerPreSave.value)}
                  </div>
                  <div className="p-1.5 bg-[var(--m-surface-3)] border border-[var(--m-border)] rounded-lg text-[var(--m-warning)] group-hover:scale-110 transition-transform duration-300">
                    <DollarSign className="h-4 w-4" />
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[10px] font-black text-[var(--m-muted)] uppercase tracking-wider">
                    Cost / Pre-Save
                  </span>
                  <span className="text-[9px] text-[var(--m-warning)] font-mono font-bold flex items-center gap-0.5 bg-[var(--m-warning)]/10 border border-[var(--m-warning)]/20 px-1.5 py-0.5 rounded">
                    <TrendingUp className="h-3 w-3 rotate-180" /> {topKpis.costPerPreSave.change}%
                  </span>
                </div>
                <div className="mt-4 w-full overflow-visible">
                  <svg className="w-full h-8 overflow-visible" viewBox="0 0 100 24" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="glow-kpi-5" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--m-warning)" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="var(--m-warning)" stopOpacity="0.0" />
                      </linearGradient>
                      <filter id="blur-kpi-5">
                        <feGaussianBlur stdDeviation="1.2" result="blur" />
                        <feMerge>
                          <feMergeNode in="blur" />
                          <feMergeNode in="SourceGraphic" />
                        </feMerge>
                      </filter>
                    </defs>
                    <path d="M0 2 Q20 4 40 16 T80 10 T100 20 L100 24 L0 24 Z" fill="url(#glow-kpi-5)" />
                    <path d="M0 2 Q20 4 40 16 T80 10 T100 20" stroke="var(--m-warning)" strokeWidth="2" fill="none" strokeLinecap="round" filter="url(#blur-kpi-5)" />
                  </svg>
                </div>
              </div>
            </div>

            {/* KPI 6: Proof Records */}
            <div className="bg-[var(--m-surface-2)] border border-[var(--m-border)] hover:border-[var(--m-accent)]/30 rounded-2xl p-6 flex flex-col justify-between h-44 transition-all duration-500 hover:shadow-[0_12px_30px_rgba(0,0,0,0.4)] hover:-translate-y-1 relative overflow-hidden group">
              <div className="absolute -right-10 -bottom-10 w-28 h-28 bg-[var(--m-accent)]/10 rounded-full blur-2xl group-hover:bg-[var(--m-accent)]/20 transition-all duration-500 pointer-events-none" />
              <div className="relative z-10 flex flex-col h-full justify-between">
                <div className="flex justify-between items-start">
                  <div className="text-3xl lg:text-4xl font-extrabold font-mono text-[#A78BFA] tracking-tight leading-none">
                    {formatCompactNumber(topKpis.proofCaptured.value)}
                  </div>
                  <div className="p-1.5 bg-[var(--m-surface-3)] border border-[var(--m-border)] rounded-lg text-[var(--m-accent)] group-hover:scale-110 transition-transform duration-300">
                    <FileText className="h-4 w-4" />
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[10px] font-black text-[var(--m-muted)] uppercase tracking-wider">
                    Proof Records
                  </span>
                  <span className="text-[9px] text-[#A78BFA] font-mono font-bold flex items-center gap-0.5 bg-[#A78BFA]/10 border border-[#A78BFA]/20 px-1.5 py-0.5 rounded">
                    <TrendingUp className="h-3 w-3" /> +{topKpis.proofCaptured.change}%
                  </span>
                </div>
                <div className="mt-4 w-full overflow-visible">
                  <svg className="w-full h-8 overflow-visible" viewBox="0 0 100 24" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="glow-kpi-6" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--m-accent)" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="var(--m-accent)" stopOpacity="0.0" />
                      </linearGradient>
                      <filter id="blur-kpi-6">
                        <feGaussianBlur stdDeviation="1.2" result="blur" />
                        <feMerge>
                          <feMergeNode in="blur" />
                          <feMergeNode in="SourceGraphic" />
                        </feMerge>
                      </filter>
                    </defs>
                    <path d="M0 18 Q20 16 40 10 T80 8 T100 2 L100 24 L0 24 Z" fill="url(#glow-kpi-6)" />
                    <path d="M0 18 Q20 16 40 10 T80 8 T100 2" stroke="var(--m-accent)" strokeWidth="2" fill="none" strokeLinecap="round" filter="url(#blur-kpi-6)" />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── SECTION 3: Stepped Fan Journey Path (Redesigned Flow Timeline) ─── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <div className="space-y-1">
            <h3 className="text-xs font-black tracking-[0.2em] text-[var(--m-muted)] uppercase">
              Stepped Fan Journey Path
            </h3>
            <p className="text-[11px] text-[var(--m-muted)]">
              Multi-channel conversion funnel mapping audience progression from contact to conversion.
            </p>
          </div>
          <span className="text-[10px] font-mono font-bold text-[var(--m-muted)] bg-[var(--m-surface-2)] border border-[var(--m-border-2)] px-2.5 py-1 rounded">
            Campaign Mode: AI Dialing
          </span>
        </div>

        <div className="overflow-x-auto m-scrollbar-thin pb-6 relative">
          <div className="flex items-center justify-between min-w-[1000px] lg:min-w-0 px-4 py-8 relative">
            {funnelData.map((stage, i) => {
              // Custom Lucide icons for each stage
              const icons = [
                <Database className="h-4.5 w-4.5" style={{ color: stage.color }} />,
                <Phone className="h-4.5 w-4.5" style={{ color: stage.color }} />,
                <Headphones className="h-4.5 w-4.5" style={{ color: stage.color }} />,
                <MessageSquare className="h-4.5 w-4.5" style={{ color: stage.color }} />,
                <ShieldCheck className="h-4.5 w-4.5" style={{ color: stage.color }} />,
                <Award className="h-4.5 w-4.5" style={{ color: stage.color }} />,
              ];

              return (
                <React.Fragment key={stage.label}>
                  {/* Milestone Node */}
                  <div
                    className="relative flex flex-col items-center group cursor-pointer"
                    onMouseEnter={() => setHoveredStageIndex(i)}
                    onMouseLeave={() => setHoveredStageIndex(null)}
                  >
                    {/* Rich Floating Tooltip */}
                    {hoveredStageIndex === i && (
                      <div className="absolute bottom-[110%] left-1/2 -translate-x-1/2 w-80 bg-[var(--m-surface)] border border-[var(--m-border)] rounded-2xl p-5 shadow-[0_20px_50px_rgba(0,0,0,0.6)] z-50 pointer-events-none animate-in fade-in slide-in-from-bottom-2 duration-200">
                        <div className="flex items-center justify-between mb-3 border-b border-[var(--m-border-2)] pb-2">
                          <span className="text-[9px] font-mono font-black tracking-wider uppercase text-[var(--m-muted)]">
                            STAGE 0{i + 1} INTEL
                          </span>
                          <span
                            className="px-2 py-0.5 rounded text-[9px] font-mono font-bold border"
                            style={{
                              backgroundColor: `${stage.color}15`,
                              borderColor: `${stage.color}35`,
                              color: stage.color
                            }}
                          >
                            {stage.percentage.toFixed(1)}% Conversion
                          </span>
                        </div>

                        <h4 className="text-xs font-black uppercase text-[var(--m-text)] tracking-wider">
                          {stage.label}
                        </h4>
                        <p className="text-[10px] text-[var(--m-muted)] mt-0.5 leading-snug">
                          {meanings[stage.label] || stage.label}
                        </p>

                        <div className="grid grid-cols-2 gap-4 py-3 my-3 border-y border-[var(--m-border-2)]">
                          <div>
                            <div className="text-[8px] font-bold text-[var(--m-muted)] uppercase tracking-wider">Volume</div>
                            <div className="text-base font-mono font-extrabold text-[var(--m-text)] mt-0.5">
                              {stage.count.toLocaleString()}
                            </div>
                          </div>
                          <div>
                            <div className="text-[8px] font-bold text-[var(--m-muted)] uppercase tracking-wider">Drop-off</div>
                            <div className="text-base font-mono font-extrabold text-[var(--m-danger)] mt-0.5">
                              {i === 0 ? "0%" : `-${(((funnelData[i-1].count - stage.count) / funnelData[i-1].count) * 100).toFixed(0)}%`}
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="text-[8px] font-black uppercase tracking-widest text-[var(--m-accent-2)]">
                            Telemetry Feed
                          </div>
                          <div className="space-y-1 font-mono text-[9px] leading-relaxed text-[var(--m-muted)]">
                            {activityLogs[i]?.map((log, index) => (
                              <div key={index} className="flex items-start gap-1">
                                <span className="text-[var(--m-accent-2)]">▸</span>
                                <span className="truncate">{log}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Diffused colored glow behind the milestone */}
                    <div
                      className="absolute w-16 h-16 rounded-full blur-xl opacity-15 group-hover:opacity-30 transition-all duration-300 pointer-events-none"
                      style={{ backgroundColor: stage.color }}
                    />

                    {/* Circular milestone node */}
                    <div
                      className="relative w-16 h-16 rounded-full flex items-center justify-center bg-[var(--m-surface-2)] border-2 transition-all duration-300 group-hover:scale-110 shadow-lg"
                      style={{ borderColor: stage.color }}
                    >
                      {/* Pulsing ring animation */}
                      <div
                        className="absolute inset-0 rounded-full animate-ping opacity-20 pointer-events-none"
                        style={{ backgroundColor: stage.color, animationDuration: '3s' }}
                      />

                      {/* Icon container */}
                      <div className="w-12 h-12 rounded-full flex items-center justify-center bg-[var(--m-surface)] border border-[var(--m-border)]">
                        {icons[i] || <Activity className="h-4.5 w-4.5" />}
                      </div>

                      {/* Stage percentage floating badge */}
                      <div
                        className="absolute -top-1 -right-1 text-[8px] font-black font-mono px-1.5 py-0.5 rounded-full border text-white"
                        style={{ backgroundColor: stage.color, borderColor: 'var(--m-bg)' }}
                      >
                        {stage.percentage.toFixed(0)}%
                      </div>
                    </div>

                    {/* Label and numbers below */}
                    <div className="mt-3.5 text-center space-y-1">
                      <span className="text-[8px] font-mono font-black text-[var(--m-muted)] tracking-widest uppercase block">
                        STAGE 0{i + 1}
                      </span>
                      <span className="text-[10px] font-black text-[var(--m-text)] tracking-wider uppercase block max-w-[110px] truncate group-hover:text-[var(--m-accent)] transition-colors duration-300">
                        {stage.label}
                      </span>
                      <span className="text-xs font-bold font-mono text-[var(--m-text-2)] block">
                        {formatCompactNumber(stage.count)}
                      </span>
                    </div>
                  </div>

                  {/* Connected line with running flow telemetry dot */}
                  {i < funnelData.length - 1 && (
                    <div className="flex-1 min-w-[30px] max-w-[90px] h-[3px] bg-white/[0.04] relative rounded-full mx-2 z-0 hidden md:block">
                      <div
                        className="absolute top-0 bottom-0 left-0 rounded-full bg-gradient-to-r transition-all duration-300"
                        style={{
                          right: 0,
                          backgroundImage: `linear-gradient(to right, ${stage.color}, ${funnelData[i+1]?.color || stage.color})`,
                          boxShadow: `0 0 8px ${stage.color}25`
                        }}
                      />
                      <div
                        className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full animate-flow-dot pointer-events-none"
                        style={{
                          backgroundColor: funnelData[i+1]?.color || stage.color,
                          boxShadow: `0 0 6px ${funnelData[i+1]?.color || stage.color}`
                        }}
                      />
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── SECTION 4: Timeline Chart & Section 5: Segment Heat ─── */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Live Campaign Movement with side-by-side grid composition */}
        <div className="lg:col-span-2 m-card p-8 lg:p-10 flex flex-col bg-[var(--m-surface)] relative overflow-hidden group">
          {/* Subtle background mesh glow */}
          <div className="absolute top-0 right-0 w-80 h-80 bg-[var(--m-accent)]/5 rounded-full blur-[80px] pointer-events-none opacity-30" />

          {/* Section Header */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-[var(--m-border-2)] pb-5 mb-6">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[var(--m-accent-2)] animate-pulse" />
                <span className="text-[9px] font-black tracking-[0.2em] text-[var(--m-accent-2)] uppercase">
                  REAL-TIME TELEMETRY FEED
                </span>
              </div>
              <h2 className="m-section-title text-base font-black">
                <Activity className="h-4.5 w-4.5 text-[var(--m-accent)] animate-pulse" /> Live Campaign Movement
              </h2>
              <p className="m-section-subtitle">
                Geographic attribution surge tracking call answer rate vs pre-save completions.
              </p>
            </div>

            {/* Live Metrics Overlay */}
            <div className="flex items-center flex-wrap gap-2.5">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[var(--m-accent-dim)] text-[10px] font-bold text-[var(--m-accent)] border border-[var(--m-accent)]/15">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--m-accent)]" />
                {livePulse.answerRate}% Connects
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[var(--m-accent-2-dim)] text-[10px] font-bold text-[var(--m-accent-2)] border border-[var(--m-accent-2)]/15">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--m-accent-2)]" />
                {livePulse.verifiedRate}% Conversions
              </span>
            </div>
          </div>

          {/* Grid split inside card to prevent any vertical empty space */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-stretch flex-1">
            {/* Left Analyst Insight Column */}
            <div className="md:col-span-1 flex flex-col justify-between space-y-4">
              <div className="bg-[var(--m-surface-2)] p-4 rounded-xl border border-[var(--m-border)] space-y-3 shadow-xs">
                <div className="flex items-center gap-1.5 text-[9px] font-extrabold uppercase tracking-widest text-[var(--m-muted)] border-b border-[var(--m-border)] pb-1.5">
                  <Flame className="w-3.5 h-3.5 text-[var(--m-warning)] animate-bounce" /> Telemetry Insight
                </div>
                <p className="text-xs text-[var(--m-text-2)] leading-relaxed font-medium">
                  Verified activations peaked on April 22 following the <strong>North American Tour On-Sale</strong> launch, showing an 18.4% conversion rate surge.
                </p>
              </div>

              <div className="space-y-2 p-3 bg-[var(--m-surface-2)]/60 rounded-xl border border-[var(--m-border-2)]">
                <div className="text-[9px] font-extrabold tracking-widest text-[var(--m-muted)] uppercase">Voice Node Status</div>
                <div className="flex items-center justify-between text-xs font-bold text-[var(--m-text-2)]">
                  <div className="flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5 text-[var(--m-accent)] animate-pulse" />
                    <span>Active Dials</span>
                  </div>
                  <span className="font-mono text-[var(--m-accent)]">24/s</span>
                </div>
                <div className="flex items-center justify-between text-xs font-bold text-[var(--m-text-2)]">
                  <div className="flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-[var(--m-accent-2)]" />
                    <span>Ping Latency</span>
                  </div>
                  <span className="font-mono text-[var(--m-accent-2)]">12ms</span>
                </div>
              </div>

              <div className="space-y-2 p-3 bg-[var(--m-surface-2)]/60 rounded-xl border border-[var(--m-border-2)]">
                <div className="text-[9px] font-extrabold tracking-widest text-[var(--m-muted)] uppercase font-bold">Queue Diagnostics</div>
                <div className="flex items-center justify-between text-xs font-semibold text-[var(--m-text-2)]">
                  <span>Queue Size</span>
                  <span className="font-mono text-[var(--m-text)]">4,124</span>
                </div>
                <div className="flex items-center justify-between text-xs font-semibold text-[var(--m-text-2)]">
                  <span>Avg Duration</span>
                  <span className="font-mono text-[var(--m-text)]">48s</span>
                </div>
              </div>
            </div>

            {/* Right Chart & Ticker Column */}
            <div className="md:col-span-3 flex flex-col justify-between space-y-4">
              {/* Chart Canvas */}
              <div className="h-[340px] w-full relative flex items-center justify-center">
                {mounted ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={campaignTimeSeries}
                      margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="colorAnswers" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="colorVerified" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#06B6D4" stopOpacity={0.15} />
                          <stop offset="95%" stopColor="#06B6D4" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="var(--m-border)"
                      />
                      <XAxis
                        dataKey="date"
                        stroke="var(--m-dim)"
                        tick={{ fontSize: 10, fill: 'var(--m-muted)', fontWeight: 600 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        stroke="var(--m-dim)"
                        tick={{ fontSize: 10, fill: 'var(--m-muted)', fontWeight: 600 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'var(--m-surface)',
                          border: '1px solid var(--m-border)',
                          borderRadius: '12px',
                          boxShadow: '0 12px 32px rgba(9, 9, 11, 0.12)',
                        }}
                        itemStyle={{ fontSize: '11px', color: 'var(--m-text)', fontWeight: 600 }}
                        labelStyle={{
                          fontSize: '9px',
                          color: 'var(--m-muted)',
                          fontWeight: '850',
                          marginBottom: '6px',
                          textTransform: 'uppercase',
                          letterSpacing: '0.08em'
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="humanAnswers"
                        name="Human Answers"
                        stroke="#8B5CF6"
                        strokeWidth={3}
                        fillOpacity={1}
                        fill="url(#colorAnswers)"
                      />
                      <Area
                        type="monotone"
                        dataKey="verifiedEngagements"
                        name="Verified Actions"
                        stroke="#06B6D4"
                        strokeWidth={3}
                        fillOpacity={1}
                        fill="url(#colorVerified)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="text-xs text-[var(--m-muted)] font-mono animate-pulse">Loading telemetry signal charts...</div>
                )}
              </div>

              {/* Real-Time Live Activity Terminal Ticker */}
              <div className="border border-[var(--m-border)] rounded-xl bg-[var(--m-surface-2)] p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-[var(--m-border)] pb-2">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--m-accent)] opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--m-accent)]"></span>
                    </span>
                    <span className="text-[10px] font-black tracking-widest text-[var(--m-text)] uppercase">
                      Live Telemetry Output
                    </span>
                  </div>
                  <span className="text-[8px] font-mono text-[var(--m-muted)] bg-[var(--m-surface-3)] px-1.5 py-0.5 rounded border border-[var(--m-border)]">
                    STREAM STATUS: NOMINAL
                  </span>
                </div>

                <div className="font-mono text-[10px] space-y-1.5 text-[var(--m-text-2)] leading-relaxed">
                  <div className="flex items-start gap-2">
                    <span className="text-[var(--m-muted)]">[17:54:12]</span>
                    <span className="text-[#8B5CF6] font-bold">OUTBOUND:</span>
                    <span>Initiated contact route for +1865***1182 (Superfans tier) -> Ringing...</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-[var(--m-muted)]">[17:54:18]</span>
                    <span className="text-[var(--m-accent-2)] font-bold">ANSWERED:</span>
                    <span>Connect established on Node 02 for +1551***6220 -> Speech synthesis running...</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-[var(--m-muted)]">[17:54:25]</span>
                    <span className="text-[var(--m-warning)] font-bold">INTENT:</span>
                    <span>Fan verbal intent captured (Confidence: 94.2%) -> dispatching pre-save hook.</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-[var(--m-muted)]">[17:54:32]</span>
                    <span className="text-[var(--m-accent-2)] font-bold">SUCCESS:</span>
                    <span>Pre-save completed. CPA attribution: $0.25 (Transaction ref: tx_815a5f70)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Audience Heat Board */}
        <div className="m-card p-8 lg:p-10 flex flex-col bg-[var(--m-surface)] relative overflow-hidden group">
          <div className="absolute bottom-0 right-0 w-80 h-80 bg-[var(--m-warning)]/5 rounded-full blur-[80px] pointer-events-none opacity-20" />

          {/* Section Header */}
          <div className="space-y-1 mb-6 border-b border-[var(--m-border-2)] pb-5">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-black tracking-[0.2em] text-[var(--m-warning)] uppercase">
                COHORT CLASSIFICATION
              </span>
            </div>
            <h2 className="m-section-title text-base font-black">
              <Flame className="h-4.5 w-4.5 text-[var(--m-warning)]" /> Audience Heat Board
            </h2>
            <p className="m-section-subtitle">Ranked target cohorts sorted by engagement metrics.</p>
          </div>

          <div className="space-y-3.5 flex-1 justify-center flex flex-col">
            {topSegmentsData.map((seg, i) => {
              const captions: Record<string, string> = {
                Superfans: 'High-frequency stream & social tier',
                'Stream save audience': 'Prior cycle pre-save responders',
                'VIP list': 'Opted-in SMS premium members',
                'Previous merch buyers': 'Purchased apparel, prints, or vinyl',
                'Tour city fans': 'Within 50 miles of stopping venues',
                'Fan club inactive': 'Dormant registers targeted to reactivate',
              };

              const recommendations: Record<string, string> = {
                Superfans: 'ACTION REQ: DISPATCH EARLY TICKET ON-SALE',
                'Stream save audience': 'ACTION REQ: ACTIVATE ALBUM PRE-SAVE FLOW',
                'VIP list': 'ACTION REQ: QUEUE VIP UPGRADE CAMPAIGN',
                'Previous merch buyers': 'ACTION REQ: DISPATCH CAPSULE MERCH ALERT',
                'Tour city fans': 'ACTION REQ: BROADCAST VENUE TOUR COORDINATES',
                'Fan club inactive': 'ACTION REQ: INITIATE WIN-BACK WORKFLOW',
              };

              // Determine Heat Colors and Icons based on engagement score
              const isCrit = seg.engagement >= 90;
              const isWarm = seg.engagement >= 75 && seg.engagement < 90;
              const tempClass = isCrit
                ? 'text-[var(--m-danger)] bg-[var(--m-danger)]/5 border-[var(--m-danger)]/15'
                : isWarm
                  ? 'text-[var(--m-warning)] bg-[var(--m-warning)]/5 border-[var(--m-warning)]/15'
                  : 'text-[var(--m-accent)] bg-[var(--m-accent-dim)] border-[var(--m-accent)]/15';

              return (
                <div
                  key={seg.segment}
                  className="p-4 bg-[var(--m-surface)] border border-[var(--m-border-2)] rounded-xl hover:border-[var(--m-accent-2)]/30 hover:shadow-lg transition-all duration-300 space-y-3.5 group relative overflow-hidden"
                >
                  <div className="flex items-center justify-between gap-3 relative z-10">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-6 h-6 flex items-center justify-center bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded-lg text-[10px] font-black text-[var(--m-muted)] shadow-2xs">
                        0{i + 1}
                      </span>
                      <span className="text-xs font-black text-[var(--m-text)] truncate">{seg.segment}</span>
                    </div>
                    <span className={cn("text-[9px] font-mono font-black px-2 py-0.5 rounded-lg border tracking-wider", tempClass)}>
                      {seg.engagement}% TEMP
                    </span>
                  </div>

                  <div className="space-y-1.5 relative z-10">
                    <div className="flex items-center justify-between text-[10px] text-[var(--m-muted)] font-bold">
                      <span className="truncate pr-2">{captions[seg.segment] || 'Target audience segment'}</span>
                      <span className="font-mono text-[var(--m-text-2)] whitespace-nowrap">{formatCompactNumber(seg.count)} FANS</span>
                    </div>

                    {/* Styled glowing cylinder progress bar */}
                    <div className="h-1.5 w-full bg-[var(--m-surface-2)] rounded-full overflow-hidden border border-[var(--m-border-2)]">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-500",
                          isCrit
                            ? "bg-gradient-to-r from-[var(--m-warning)] to-[var(--m-danger)]"
                            : isWarm
                              ? "bg-gradient-to-r from-[var(--m-accent)] to-[var(--m-warning)]"
                              : "bg-gradient-to-r from-[var(--m-accent-dim)] to-[var(--m-accent)]"
                        )}
                        style={{ width: `${seg.engagement}%` }}
                      />
                    </div>
                  </div>

                  {/* Recommendation action tag: elegant small tag */}
                  <div className="text-[8px] font-black text-[var(--m-muted)] bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded-lg px-2.5 py-1 tracking-widest uppercase transition-colors duration-200 group-hover:border-[var(--m-accent)]/20 group-hover:bg-[var(--m-accent-dim)] group-hover:text-[var(--m-accent)] relative z-10">
                    {recommendations[seg.segment] || 'ACTION REQ: DISPATCH OUTREACH'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── SECTION 6: Fan Proof Stream (Proof records coming back) ─── */}
      <section className="m-card p-8 lg:p-10 bg-[var(--m-surface)]">
        <div className="border-b border-[var(--m-border-2)] pb-4 mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="space-y-1">
            <h2 className="m-section-title">
              <ShieldCheck className="h-4.5 w-4.5 text-[var(--m-accent-2)]" /> Proof Coming Back from the Audience
            </h2>
            <p className="m-section-subtitle">
              Verified outcomes, recording proofs, sentiment ratings, and attributed conversions.
            </p>
          </div>
          <Link href="/music-console/proof">
            <ActionButton variant="secondary" className="text-xs font-bold py-2 border border-black/10">
              Open Full Proof Log <ArrowRight className="h-3.5 w-3.5" />
            </ActionButton>
          </Link>
        </div>

        {/* Proof Stream Container */}
        <div className="space-y-4">
          {proofRecords.slice(0, 6).map(r => {
            const isPlaying = playingRecordId === r.id;
            const isExpanded = expandedTranscriptId === r.id;

            const accentColor =
              r.sentiment === 'positive'
                ? 'bg-[var(--m-accent-2)]'
                : r.sentiment === 'negative'
                  ? 'bg-[#EF4444]'
                  : 'bg-[var(--m-muted)]';

            return (
              <div
                key={r.id}
                className="m-proof-card pl-6"
              >
                {/* Sentiment vertical bar indicator */}
                <div className={cn('m-proof-card-accent-bar w-1.5', accentColor)} />

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
                  {/* Left Column: Fan Identity */}
                  <div className="lg:col-span-4 space-y-1.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-extrabold text-sm text-[var(--m-text)]">{r.fanName}</span>
                      <span className="font-mono text-xs text-[var(--m-muted)] bg-[var(--m-surface-2)] border border-[var(--m-border-2)] px-1.5 py-0.5 rounded">
                        xxxxxx{r.fanPhone.slice(-4)}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <SegmentBadge segment={r.segment} />
                      <span
                        className={cn(
                          'text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded border',
                          r.intent === 'high'
                            ? 'bg-[var(--m-accent-2)]/10 text-[var(--m-accent-2)] border-[var(--m-accent-2)]/20'
                            : r.intent === 'medium'
                              ? 'bg-[var(--m-warning)]/10 text-[var(--m-warning)] border-[var(--m-warning)]/20'
                              : 'bg-zinc-500/10 text-zinc-500 border-zinc-500/20'
                        )}
                      >
                        {r.intent} intent
                      </span>
                    </div>
                  </div>

                  {/* Middle Column: Campaign and Cost metrics */}
                  <div className="lg:col-span-4 space-y-1">
                    <div className="text-xs text-[var(--m-muted)] font-medium">
                      Campaign: <strong className="text-[var(--m-text-2)] font-semibold">{r.campaignName}</strong>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase font-bold text-[var(--m-muted)] tracking-wider">CPA Attribution:</span>
                      <span className="font-mono text-xs font-bold text-[var(--m-warning)] bg-[#F59E0B]/10 border border-[#F59E0B]/20 px-2 py-0.5 rounded">
                        {formatCurrency(r.cpaAttribution)}
                      </span>
                    </div>
                  </div>

                  {/* Right Column: Badges and Controls */}
                  <div className="lg:col-span-4 flex items-center justify-between lg:justify-end gap-3">
                    <ProofBadge outcome={r.outcome} verified={r.verifiedAction} />
                    
                    <div className="flex items-center gap-2 ml-auto lg:ml-0">
                      {/* Audio Proof Toggle */}
                      {r.hasRecording && (
                        <ActionButton
                          variant={isPlaying ? 'primary' : 'secondary'}
                          onClick={() => togglePlay(r.id)}
                          className="text-xs font-semibold px-2.5 py-1.5 flex items-center gap-2 shrink-0 border border-black/10"
                        >
                          {isPlaying ? (
                            <>
                              <div className="m-equalizer mb-[1px]">
                                <span className="m-equalizer-bar" />
                                <span className="m-equalizer-bar" />
                                <span className="m-equalizer-bar" />
                              </div>
                              <span>Playing</span>
                            </>
                          ) : (
                            <>
                              <Play className="h-3 w-3 text-[var(--m-accent)] fill-[var(--m-accent)]" />
                              <span>Audio Proof</span>
                            </>
                          )}
                        </ActionButton>
                      )}

                      {/* Transcript Toggle */}
                      {r.hasTranscript && (
                        <button
                          onClick={() => toggleTranscript(r.id)}
                          className={cn(
                            "p-2 rounded border transition-colors flex items-center justify-center gap-1 text-xs font-semibold",
                            isExpanded 
                              ? "bg-[var(--m-surface-3)] border-[var(--m-dim)] text-[var(--m-text)]" 
                              : "bg-[var(--m-surface-2)] border-[var(--m-border-2)] text-[var(--m-muted)] hover:text-[var(--m-text)]"
                          )}
                          title="Verbatim Transcript"
                        >
                          <FileText className="h-3.5 w-3.5" />
                          <span>Audit</span>
                          {isExpanded ? (
                            <ChevronUp className="h-3 w-3" />
                          ) : (
                            <ChevronDown className="h-3 w-3" />
                          )}
                        </button>
                      )}

                      <span className="text-[10px] font-mono text-[var(--m-muted)] font-medium pl-1 whitespace-nowrap">
                        {formatTimestamp(r.timestamp)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Simulated Audio Waveform player overlay */}
                {isPlaying && (
                  <div className="mt-4 p-4 bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded-lg flex items-center gap-4 animate-fadeIn">
                    <Volume2 className="h-4.5 w-4.5 text-[var(--m-accent)] animate-bounce shrink-0" />
                    <div className="flex-1 h-1 bg-[var(--m-surface-3)] rounded-full overflow-hidden relative">
                      <div className="h-full bg-[var(--m-accent)] w-1/3 animate-[pulse_2s_infinite]" />
                    </div>
                    <span className="text-[10px] font-mono text-[var(--m-muted)] font-bold shrink-0">0:14 / 1:24</span>
                  </div>
                )}

                {/* Monospaced Audit Log Transcript snippets */}
                {isExpanded && r.transcriptSnippet && (
                  <div className="mt-4 p-4 bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded-lg space-y-2 text-xs font-medium">
                    <div className="text-[9px] uppercase tracking-widest font-black text-[var(--m-muted)] border-b border-[var(--m-border-2)] pb-2 mb-2">
                      Verbatim Conversation Audit Log
                    </div>
                    {r.transcriptSnippet.split('\n').map((line, idx) => {
                      const isAi = line.startsWith('AI:');
                      const speaker = isAi ? 'Operator AI' : 'Fan';
                      const text = isAi
                        ? line.replace('AI:', '').trim()
                        : line.replace('Fan:', '').trim();

                      return (
                        <div key={idx} className="flex gap-4">
                          <span
                            className={cn(
                              'w-20 font-black uppercase tracking-wider shrink-0 text-[10px]',
                              isAi ? 'text-[var(--m-accent)]' : 'text-[var(--m-muted)]'
                            )}
                          >
                            {speaker}:
                          </span>
                          <span className="text-[var(--m-text-2)] leading-relaxed">{text}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
