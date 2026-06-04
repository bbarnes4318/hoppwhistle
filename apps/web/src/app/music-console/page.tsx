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

export default function MusicConsolePage() {
  const [playingRecordId, setPlayingRecordId] = useState<string | null>(null);
  const [expandedTranscriptId, setExpandedTranscriptId] = useState<string | null>(null);
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
    <div className="space-y-8 pb-12">
      {/* ─── SECTION 1: Premium Hero Command Module (Dark Obsidian) ─── */}
      {/* ─── SECTION 1: Premium Hero Command Module (Dark Obsidian) ─── */}
      <section className="m-dark-mode bg-[#0B0F19] text-[#FAFAFA] rounded-2xl border border-white/[0.04] p-6 lg:p-8 relative overflow-hidden shadow-[0_24px_48px_rgba(0,0,0,0.3)]">
        {/* Glow Highlights */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-[#8B5CF6]/5 rounded-full blur-[120px] pointer-events-none opacity-40" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-[#10B981]/5 rounded-full blur-[90px] pointer-events-none opacity-30" />

        <div className="relative z-10 space-y-6">
          {/* Header Row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/[0.06] pb-5">
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <span className="text-[9px] font-black tracking-[0.25em] text-[#A78BFA] uppercase">
                  ACTIVE CAMPAIGN
                </span>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-[#10B981]/20 bg-[#10B981]/10 text-xs font-semibold text-[#10B981]">
                  <span className="m-pulse-dot h-1.5 w-1.5" />
                  <span className="font-mono text-[9px] uppercase tracking-wider">{livePulse.status}</span>
                </span>
              </div>
              <h1 className="text-xl font-black text-white leading-tight">
                {livePulse.campaignName} <span className="text-zinc-500 font-medium font-sans text-sm ml-2">by {livePulse.artist}</span>
              </h1>
            </div>

            {/* CTAs */}
            <div className="flex items-center gap-3 shrink-0">
              <Link href="/music-console/proof">
                <ActionButton variant="primary" className="text-xs font-semibold py-2 px-4 shadow-[0_4px_16px_rgba(139,92,246,0.2)] hover:shadow-[0_6px_20px_rgba(139,92,246,0.35)]">
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

          {/* 6 Core KPIs Grid (Premium Horizontal Strip) */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-6 pt-2">
            {/* KPI 1 */}
            <div className="space-y-1">
              <div className="text-[9px] font-black tracking-widest text-zinc-500 uppercase flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-[#A78BFA]" /> Reached Fans
              </div>
              <div className="text-2xl font-black font-mono text-white">
                {formatCompactNumber(topKpis.fansContacted.value)}
              </div>
              <div className="text-[10px] text-zinc-400">
                <span className="text-[#10B981] font-semibold">+{topKpis.fansContacted.change}%</span> vs prev week
              </div>
            </div>

            {/* KPI 2 */}
            <div className="space-y-1 border-l-0 sm:border-l border-white/[0.06] pl-0 sm:pl-4">
              <div className="text-[9px] font-black tracking-widest text-zinc-500 uppercase flex items-center gap-1.5">
                <Headphones className="h-3.5 w-3.5 text-[#8B5CF6]" /> Human Answers
              </div>
              <div className="text-2xl font-black font-mono text-white">
                {formatCompactNumber(topKpis.humanAnswers.value)}
              </div>
              <div className="text-[10px] text-zinc-400">
                <span className="text-[#10B981] font-semibold">+{topKpis.humanAnswers.change}%</span> connects
              </div>
            </div>

            {/* KPI 3 */}
            <div className="space-y-1 border-l-0 md:border-l border-white/[0.06] pl-0 md:pl-4">
              <div className="text-[9px] font-black tracking-widest text-zinc-500 uppercase flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-[#10B981]" /> Verified Actions
              </div>
              <div className="text-2xl font-black font-mono text-[#10B981]">
                {formatCompactNumber(topKpis.verifiedEngagements.value)}
              </div>
              <div className="text-[10px] text-zinc-400">
                <span className="text-[#10B981] font-semibold">+{topKpis.verifiedEngagements.change}%</span> conversions
              </div>
            </div>

            {/* KPI 4 */}
            <div className="space-y-1 border-l-0 lg:border-l border-white/[0.06] pl-0 lg:pl-4">
              <div className="text-[9px] font-black tracking-widest text-zinc-500 uppercase flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 text-sky-400" /> Pre-Saves
              </div>
              <div className="text-2xl font-black font-mono text-white">
                {formatCompactNumber(topKpis.preSaves.value)}
              </div>
              <div className="text-[10px] text-zinc-400">
                <span className="text-[#10B981] font-semibold">+{topKpis.preSaves.change}%</span> DSP actions
              </div>
            </div>

            {/* KPI 5 */}
            <div className="space-y-1 border-l-0 md:border-l border-white/[0.06] pl-0 md:pl-4">
              <div className="text-[9px] font-black tracking-widest text-zinc-500 uppercase flex items-center gap-1.5">
                <DollarSign className="h-3.5 w-3.5 text-[var(--m-warning)]" /> Cost / Pre-Save
              </div>
              <div className="text-2xl font-black font-mono text-[var(--m-warning)]">
                {formatCurrency(topKpis.costPerPreSave.value)}
              </div>
              <div className="text-[10px] text-zinc-400">
                <span className="text-[#10B981] font-semibold">{topKpis.costPerPreSave.change}%</span> CPA yield
              </div>
            </div>

            {/* KPI 6 */}
            <div className="space-y-1 border-l-0 lg:border-l border-white/[0.06] pl-0 lg:pl-4">
              <div className="text-[9px] font-black tracking-widest text-zinc-500 uppercase flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-[#A78BFA]" /> Proof Records
              </div>
              <div className="text-2xl font-black font-mono text-[#A78BFA]">
                {formatCompactNumber(topKpis.proofCaptured.value)}
              </div>
              <div className="text-[10px] text-zinc-400">
                <span className="text-[#10B981] font-semibold">+{topKpis.proofCaptured.change}%</span> verbatims
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── SECTION 3: Stepped Fan Journey Path (Unified Attribution Card) ─── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-xs font-bold tracking-widest text-[var(--m-muted)] uppercase">
            Stepped Fan Journey Path
          </h3>
          <span className="text-[10px] font-mono font-bold text-[var(--m-muted)] bg-[var(--m-surface-2)] border border-[var(--m-border-2)] px-2.5 py-1 rounded">
            Campaign Mode: AI Dialing
          </span>
        </div>

        <PremiumCard className="p-6 bg-[var(--m-surface)]">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-6 relative">
            {funnelData.map((stage, i) => {
              const meanings: Record<string, string> = {
                'Uploaded Fans': 'Audience list uploaded',
                Contacted: 'Fan contacts reached',
                'Human Answered': 'Human connects verified',
                Engaged: 'Convo continued past disclosure',
                'Verified Intent': 'Fan verbal intent captured',
                'Action Taken': 'Pre-save action completed',
              };

              return (
                <div key={stage.label} className="relative flex flex-col justify-between space-y-4 min-h-[120px]">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-mono font-bold text-[var(--m-muted)]">STAGE 0{i + 1}</span>
                    <span className="text-[10px] font-mono font-bold text-[var(--m-accent-2)] bg-[var(--m-accent-2-dim)] px-2 py-0.5 rounded border border-[var(--m-accent-2)]/15">
                      {stage.percentage.toFixed(1)}%
                    </span>
                  </div>

                  <div className="space-y-1">
                    <div className="text-xs font-bold text-[var(--m-text-2)] uppercase tracking-wider">
                      {stage.label}
                    </div>
                    <div className="text-2xl font-black font-mono text-[var(--m-text)]">
                      {formatCompactNumber(stage.count)}
                    </div>
                  </div>

                  <div className="space-y-2 pt-1 border-t border-[var(--m-border-2)]">
                    <div className="text-[10px] italic text-[var(--m-muted)] leading-relaxed">
                      {meanings[stage.label] || stage.label}
                    </div>
                    <div className="h-1.5 w-full bg-[var(--m-surface-2)] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${stage.percentage}%`, backgroundColor: stage.color }}
                      />
                    </div>
                  </div>

                  {/* Drop-off connector pill - horizontally positioned between steps on large displays */}
                  {i < funnelData.length - 1 && (
                    <div className="hidden lg:flex absolute top-1/2 -right-3 -translate-y-1/2 z-10 translate-x-1/2 items-center justify-center">
                      <span className="text-[9px] font-mono font-bold text-[var(--m-danger)] bg-[var(--m-surface)] border border-[var(--m-danger)]/25 px-1.5 py-0.5 rounded shadow-xs select-none">
                        -{(((stage.count - funnelData[i + 1].count) / stage.count) * 100).toFixed(0)}%
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </PremiumCard>
      </section>

      {/* ─── SECTION 4: Timeline Chart & Section 5: Segment Heat ─── */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Live Campaign Movement with side-by-side grid composition */}
        <div className="lg:col-span-2 m-card p-6 flex flex-col bg-[var(--m-surface)]">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-[var(--m-border-2)] pb-4 mb-6">
            <div className="space-y-1">
              <h2 className="m-section-title">
                <Activity className="h-4.5 w-4.5 text-[var(--m-accent)]" /> Live Campaign Movement
              </h2>
              <p className="m-section-subtitle">
                Visual attribution metrics mapping answer response rates and action rate surges.
              </p>
            </div>

            {/* Legend Badges */}
            <div className="flex items-center gap-2 shrink-0">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[var(--m-accent-dim)] text-[10px] font-bold text-[var(--m-accent)] border border-[var(--m-accent)]/10">
                {livePulse.answerRate}% Answers
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[var(--m-accent-2-dim)] text-[10px] font-bold text-[var(--m-accent-2)] border border-[var(--m-accent-2)]/10">
                {livePulse.verifiedRate}% Actions
              </span>
            </div>
          </div>

          {/* Grid split inside card to prevent any vertical empty space */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-stretch flex-1">
            {/* Left Analyst Insight Column */}
            <div className="md:col-span-1 flex flex-col justify-between space-y-4">
              <div className="bg-[var(--m-surface-2)] p-4 rounded-xl border border-[var(--m-border)] space-y-2">
                <div className="text-[9px] font-extrabold uppercase tracking-widest text-[var(--m-muted)]">Analysis Insight</div>
                <p className="text-xs text-[var(--m-text-2)] leading-relaxed">
                  Verified activations peaked on April 22 following the <strong>North American Tour On-Sale</strong> launch, showing an 18.4% conversion rate surge.
                </p>
              </div>

              <div className="space-y-1.5 p-3 rounded-lg border border-[var(--m-border-2)]">
                <div className="text-[9px] font-bold tracking-widest text-[var(--m-muted)] uppercase">Attribution Sync</div>
                <div className="flex items-center gap-2 text-xs font-bold text-[var(--m-accent-2)]">
                  <span className="h-2 w-2 rounded-full bg-[var(--m-accent-2)] animate-pulse" />
                  <span>Sync Lag: 0.4s</span>
                </div>
              </div>
            </div>

            {/* Right Chart Canvas */}
            <div className="md:col-span-3 h-[420px] w-full min-h-[350px] relative flex items-center justify-center">
              {mounted ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={campaignTimeSeries}
                    margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="colorAnswers" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.12} />
                        <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorVerified" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10B981" stopOpacity={0.12} />
                        <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
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
                        borderRadius: '8px',
                        boxShadow: '0 8px 24px rgba(9, 9, 11, 0.08)',
                      }}
                      itemStyle={{ fontSize: '11px', color: 'var(--m-text)' }}
                      labelStyle={{
                        fontSize: '10px',
                        color: 'var(--m-muted)',
                        fontWeight: '800',
                        marginBottom: '4px',
                        textTransform: 'uppercase',
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="humanAnswers"
                      name="Human Answers"
                      stroke="#8B5CF6"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorAnswers)"
                    />
                    <Area
                      type="monotone"
                      dataKey="verifiedEngagements"
                      name="Verified Actions"
                      stroke="#10B981"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorVerified)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-xs text-[var(--m-muted)] font-mono animate-pulse">Loading telemetry signal charts...</div>
              )}
            </div>
          </div>
        </div>

        {/* Audience Heat Board */}
        <div className="m-card p-6 flex flex-col bg-[var(--m-surface)]">
          <div className="space-y-1 mb-6 border-b border-[var(--m-border-2)] pb-4">
            <h2 className="m-section-title">
              <Flame className="h-4.5 w-4.5 text-[var(--m-warning)]" /> Audience Heat Board
            </h2>
            <p className="m-section-subtitle">Ranked target cohorts by engagement scores and actions.</p>
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

              return (
                <div
                  key={seg.segment}
                  className="p-3 bg-[var(--m-surface)] border border-[var(--m-border-2)] rounded-lg hover:border-[var(--m-dim)] hover:shadow-xs transition-all duration-150 space-y-2 group"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <span className="w-5 h-5 flex items-center justify-center bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded text-[9px] font-black text-[var(--m-muted)]">
                        {i + 1}
                      </span>
                      <span className="text-xs font-bold text-[var(--m-text)] truncate">{seg.segment}</span>
                    </div>
                    <span className="text-[10px] font-mono font-bold text-[var(--m-accent-2)] bg-[var(--m-accent-2-dim)] px-2 py-0.5 rounded border border-[var(--m-accent-2)]/10">
                      {seg.engagement}% score
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-[var(--m-muted)] font-medium">
                    <span>{captions[seg.segment] || 'Target audience segment'}</span>
                    <span className="font-mono text-[var(--m-text-2)]">{formatCompactNumber(seg.count)} fans</span>
                  </div>

                  <div className="h-2 w-full bg-[var(--m-surface-2)] rounded-full overflow-hidden border border-[var(--m-border-2)]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[var(--m-accent)] to-[var(--m-warning)] transition-all duration-300"
                      style={{ width: `${seg.engagement}%` }}
                    />
                  </div>

                  <div className="text-[9px] font-extrabold text-[var(--m-accent)] bg-[var(--m-accent-dim)] border border-[var(--m-accent)]/10 rounded px-2 py-1 tracking-wider uppercase">
                    {recommendations[seg.segment] || 'ACTION REQ: DISPATCH OUTREACH'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── SECTION 6: Fan Proof Stream (Proof records coming back) ─── */}
      <section className="m-card p-6 bg-[var(--m-surface)]">
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
                ? 'bg-[#10B981]'
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
                            ? 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/20'
                            : r.intent === 'medium'
                              ? 'bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/20'
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
