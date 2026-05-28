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
  Play,
  Flame,
  Music,
  X,
  ChevronRight,
} from 'lucide-react';
import Link from 'next/link';
import React, { useState } from 'react';
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
import type { ProofRecord } from '@/features/music/types';
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

type TabId = 'overview' | 'journey' | 'movement' | 'audience' | 'proof';

export default function MusicConsolePage() {
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  const [selectedProof, setSelectedProof] = useState<ProofRecord | undefined>(undefined);
  const [isPlayingRecord, setIsPlayingRecord] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  const getWaveformHeight = (id: string, index: number) => {
    const val = Math.sin((id.charCodeAt(id.length - 1) + index) * 127.1 + 311.7) * 43758.5453;
    return Math.floor((val - Math.floor(val)) * 80 + 20);
  };

  const getJitter = (id: string) => {
    const val = Math.sin(id.charCodeAt(0) * 127.1 + 311.7) * 43758.5453;
    return Math.floor((val - Math.floor(val)) * 5) + 1;
  };

  const renderTranscript = (snippet: string) => {
    if (!snippet) return null;
    return snippet.split('\n').map((line, i) => {
      const isAI = line.startsWith('AI:');
      const isFan = line.startsWith('Fan:');
      const content = line.replace(/^(AI|Fan):\s*/, '');
      return (
        <div key={i} className={cn('m-transcript-line', isAI && 'm-transcript-line--ai')}>
          <div
            className={cn(
              'm-transcript-speaker',
              isAI ? 'm-transcript-speaker--ai' : 'm-transcript-speaker--fan'
            )}
          >
            {isAI ? 'AI Agent' : isFan ? 'Fan' : ''}
          </div>
          <div className="m-transcript-text text-[11px] leading-relaxed">{content}</div>
        </div>
      );
    });
  };

  return (
    <div className="m-cockpit-layout select-none">
      {/* ─── MOBILE/TABLET NAVIGATION TABS (Hidden on Desktop) ─── */}
      <div className="lg:hidden flex items-center bg-[var(--m-surface-2)] border border-[var(--m-border)] p-1 rounded-lg shrink-0 gap-1 text-[11px] font-bold">
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'journey', label: 'Signal Chain' },
          { id: 'movement', label: 'Timeline' },
          { id: 'audience', label: 'Audience' },
          { id: 'proof', label: 'Proof & Metrics' },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as TabId)}
            className={cn(
              'flex-1 py-1.5 text-center rounded transition-all',
              activeTab === tab.id
                ? 'bg-[var(--m-accent)] text-white'
                : 'text-[var(--m-muted)] hover:text-[var(--m-text)]'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ─── DESKTOP COCKPIT & MOBILE ROUTING ─── */}

      {/* 1. TOP ZONE: Compact Command Header */}
      <div
        className={cn(
          'm-cockpit-top bg-gradient-to-r from-[var(--m-surface)] to-[var(--m-surface-2)] border border-[var(--m-border)] rounded-xl p-4 lg:p-5',
          'lg:flex',
          activeTab === 'overview' ? 'flex' : 'hidden lg:flex'
        )}
      >
        {/* Left: Headline & Description */}
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-[8px] font-bold tracking-[0.2em] text-[var(--m-accent)] uppercase">
              HOPWHISTLE MUSIC / LIVE FAN SIGNAL
            </span>
            <span className="m-badge m-badge--active py-0 px-1.5 flex items-center gap-1">
              <span className="m-pulse-dot" />
              <span className="font-mono text-[8px]">{livePulse.status}</span>
            </span>
          </div>
          <h1 className="text-lg lg:text-xl font-black tracking-tight text-[var(--m-text)] leading-tight">
            Turn fan attention into <span className="text-[var(--m-accent)]">verified action</span>.
          </h1>
          <p className="text-[10px] lg:text-xs m-text-muted max-w-lg leading-snug">
            Outbound voice campaigns driving pre-saves, tickets, and merch — with transcripts,
            recordings, and campaign attribution locked to every response.
          </p>
        </div>

        {/* Center: Small SignalDisc */}
        <div className="hidden md:flex shrink-0 items-center justify-center relative">
          <div className="m-signal-disc-compact">
            <div className="m-signal-disc-ripple-ring" />
            <div className="m-signal-disc-ripple-ring" />
            <div className="m-signal-disc-ripple-ring" />

            {/* Spinning Vinyl */}
            <div className="m-signal-disc m-signal-disc-spin">
              <div className="m-signal-disc-grooves" />

              <svg className="absolute inset-0 w-full h-full" viewBox="0 0 90 90">
                {/* Contact Rate (Outer: Green) */}
                <circle
                  cx="45"
                  cy="45"
                  r="34"
                  fill="none"
                  stroke="var(--m-accent-2)"
                  strokeWidth="2.5"
                  strokeDasharray={`${2 * Math.PI * 34 * (livePulse.contactRate / 100)} ${2 * Math.PI * 34 * (1 - livePulse.contactRate / 100)}`}
                  strokeLinecap="round"
                  transform="rotate(-90 45 45)"
                  opacity="0.85"
                />
                {/* Answer Rate (Middle: Violet) */}
                <circle
                  cx="45"
                  cy="45"
                  r="27"
                  fill="none"
                  stroke="var(--m-accent)"
                  strokeWidth="2.5"
                  strokeDasharray={`${2 * Math.PI * 27 * (livePulse.answerRate / 100)} ${2 * Math.PI * 27 * (1 - livePulse.answerRate / 100)}`}
                  strokeLinecap="round"
                  transform="rotate(-45 45 45)"
                  opacity="0.85"
                />
                {/* Verified Rate (Inner: Amber) */}
                <circle
                  cx="45"
                  cy="45"
                  r="20"
                  fill="none"
                  stroke="var(--m-warning)"
                  strokeWidth="2.5"
                  strokeDasharray={`${2 * Math.PI * 20 * (livePulse.verifiedRate / 100)} ${2 * Math.PI * 20 * (1 - livePulse.verifiedRate / 100)}`}
                  strokeLinecap="round"
                  transform="rotate(30 45 45)"
                  opacity="0.85"
                />
              </svg>
              <div className="m-signal-disc-center">
                <div className="m-signal-disc-spindle" />
              </div>
            </div>
          </div>
        </div>

        {/* Right: Active Campaign & Tiny Telemetry Block */}
        <div className="flex flex-col justify-between items-end text-right h-full py-1 gap-2 shrink-0">
          <div className="space-y-0.5">
            <div className="flex items-center justify-end gap-1.5 text-[9px] font-bold text-[var(--m-accent)] uppercase">
              <Music className="h-3 w-3" /> {livePulse.artist}
            </div>
            <div className="text-xs font-bold text-[var(--m-text)] truncate max-w-[180px]">
              {livePulse.campaignName}
            </div>
            <div className="text-[9px] m-text-muted">{livePulse.segment}</div>
          </div>

          <div className="flex gap-4 border-t border-[var(--m-border-2)] pt-1.5 w-full justify-end">
            <div>
              <div className="text-[8px] uppercase tracking-wider text-[var(--m-dim)]">
                Answer Rate
              </div>
              <div className="text-xs font-mono font-bold text-[var(--m-accent)]">
                {livePulse.answerRate}%
              </div>
            </div>
            <div>
              <div className="text-[8px] uppercase tracking-wider text-[var(--m-dim)]">
                Action Rate
              </div>
              <div className="text-xs font-mono font-bold text-[var(--m-accent-2)]">
                {livePulse.verifiedRate}%
              </div>
            </div>
            <div>
              <div className="text-[8px] uppercase tracking-wider text-[var(--m-dim)]">
                Current CPA
              </div>
              <div className="text-xs font-mono font-bold text-[var(--m-text)]">
                {formatCurrency(livePulse.cpa)}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. MIDDLE ZONE: Main Operating Surface */}
      <div
        className={cn(
          'm-cockpit-middle',
          'lg:flex',
          activeTab === 'overview' ? 'hidden lg:flex' : ''
        )}
      >
        {/* Left: Fan Journey Signal Chain (takes 22% width on desktop) */}
        <div
          className={cn(
            'flex-col m-card p-3 lg:p-4 lg:w-[22%] shrink-0 justify-between',
            'lg:flex',
            activeTab === 'journey' ? 'flex flex-1 lg:flex-none' : 'hidden lg:flex'
          )}
        >
          <div className="mb-2">
            <h2 className="m-section-title">
              <TrendingUp className="h-3.5 w-3.5" /> Fan Signal Chain
            </h2>
            <p className="m-section-subtitle">Real-time attribution & conversions</p>
          </div>

          <div className="flex-1 flex flex-col gap-1.5 min-h-0 justify-between">
            {funnelData.map((stage, i) => {
              const meanings: Record<string, string> = {
                'Uploaded Fans': 'Audience loaded',
                Contacted: 'Voice campaign reached',
                'Human Answered': 'Real fan answered',
                Engaged: 'Convo continued',
                'Verified Intent': 'Intent captured',
                'Action Taken': 'Pre-save actioned',
              };

              return (
                <div
                  key={stage.label}
                  className="bg-[var(--m-surface-2)] border border-[var(--m-border-2)] rounded p-2 flex flex-col justify-between min-h-0 relative hover:border-[var(--m-border)] transition-all"
                >
                  <div className="flex items-center justify-between text-[8px] font-mono text-[var(--m-dim)]">
                    <span>0{i + 1}</span>
                    <span className="font-bold">{stage.percentage.toFixed(0)}%</span>
                  </div>
                  <div className="my-0.5">
                    <div className="text-[9px] uppercase font-bold text-[var(--m-text-2)] tracking-wider truncate">
                      {stage.label}
                    </div>
                    <div className="text-xs font-bold font-mono text-[var(--m-text)] leading-none mt-0.5">
                      {formatCompactNumber(stage.count)}{' '}
                      <span className="text-[8px] font-normal text-[var(--m-muted)]">
                        &ldquo;{meanings[stage.label] || stage.label}&rdquo;
                      </span>
                    </div>
                  </div>
                  <div className="w-full bg-[var(--m-surface-3)] h-1 rounded-full overflow-hidden">
                    <div
                      className="h-full"
                      style={{ width: `${stage.percentage}%`, backgroundColor: stage.color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Center: Campaign Movement chart (takes 53% width on desktop) */}
        <div
          className={cn(
            'flex-col m-card p-3 lg:p-4 lg:w-[53%] shrink-0 justify-between',
            'lg:flex',
            activeTab === 'movement' ? 'flex flex-1 lg:flex-none' : 'hidden lg:flex'
          )}
        >
          <div className="flex justify-between items-start gap-4 mb-2 shrink-0">
            <div>
              <h2 className="m-section-title">
                <Activity className="h-3.5 w-3.5 text-[var(--m-accent)]" /> Live Campaign Movement
              </h2>
              <p className="m-section-subtitle">Fan response over the last 14 days</p>
            </div>
            <div className="flex gap-2 shrink-0">
              <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-[var(--m-accent-dim)] text-[var(--m-accent)] border border-[rgba(109,61,255,0.1)]">
                Answers
              </span>
              <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-[var(--m-accent-2-dim)] text-[var(--m-accent-2)] border border-[rgba(8,167,122,0.1)]">
                Verified
              </span>
            </div>
          </div>

          <div className="flex-1 min-h-0 w-full mt-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={campaignTimeSeries}
                margin={{ top: 5, right: 0, left: -32, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="colorAnswers" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6D3DFF" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#6D3DFF" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorVerified" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#08A77A" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#08A77A" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="rgba(42,38,32,0.04)"
                />
                <XAxis
                  dataKey="date"
                  stroke="rgba(42, 38, 32, 0.15)"
                  tick={{ fontSize: 9, fill: '#756F66' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  stroke="rgba(42, 38, 32, 0.15)"
                  tick={{ fontSize: 9, fill: '#756F66' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    border: '1px solid rgba(42, 38, 32, 0.1)',
                    borderRadius: '6px',
                    boxShadow: '0 2px 8px rgba(42, 38, 32, 0.05)',
                    padding: '4px 6px',
                  }}
                  itemStyle={{ fontSize: '10px' }}
                  labelStyle={{
                    fontSize: '9px',
                    color: '#756F66',
                    fontWeight: '700',
                    marginBottom: '2px',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="humanAnswers"
                  name="Answers"
                  stroke="#6D3DFF"
                  strokeWidth={1.5}
                  fillOpacity={1}
                  fill="url(#colorAnswers)"
                />
                <Area
                  type="monotone"
                  dataKey="verifiedEngagements"
                  name="Verified"
                  stroke="#08A77A"
                  strokeWidth={1.5}
                  fillOpacity={1}
                  fill="url(#colorVerified)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right: Audience Heat Board (takes 25% width on desktop) */}
        <div
          className={cn(
            'flex-col m-card p-3 lg:p-4 lg:w-[25%] shrink-0 justify-between',
            'lg:flex',
            activeTab === 'audience' ? 'flex flex-1 lg:flex-none' : 'hidden lg:flex'
          )}
        >
          <div className="mb-2 shrink-0">
            <h2 className="m-section-title">
              <Flame className="h-3.5 w-3.5 text-[var(--m-warning)]" /> Audience Heat Board
            </h2>
            <p className="m-section-subtitle">Ranked target lists by engagement scores</p>
          </div>

          <div className="flex-1 flex flex-col gap-1.5 min-h-0 justify-between">
            {topSegmentsData.map((seg, i) => {
              const captions: Record<string, string> = {
                Superfans: 'High-frequency streams & social tier',
                'Stream save audience': 'Prior cycle album presavers',
                'VIP list': 'Opted-in SMS premium tier',
                'Previous merch buyers': 'Purchased apparel, prints, or vinyl',
                'Tour city fans': 'Within 50 miles of tour stops',
                'Fan club inactive': 'Dormant email registrations',
              };

              return (
                <div
                  key={seg.segment}
                  className="bg-[var(--m-surface-2)] border border-[var(--m-border-2)] rounded p-2 flex items-center justify-between gap-2 text-[10px] hover:border-[var(--m-border)] transition-all"
                >
                  <div className="font-mono font-bold text-[var(--m-dim)] w-4 shrink-0 text-center">
                    0{i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <div className="font-bold text-[var(--m-text)] truncate text-[10px]">
                        {seg.segment}
                      </div>
                      <div className="font-mono font-bold text-[var(--m-accent-2)] shrink-0">
                        {seg.engagement}%
                      </div>
                    </div>
                    <div className="text-[8px] text-[var(--m-muted)] truncate mt-0.5">
                      {captions[seg.segment] || `${formatCompactNumber(seg.count)} fans`}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 bg-[var(--m-surface-3)] h-1 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-[var(--m-accent)] to-[var(--m-warning)]"
                          style={{ width: `${seg.engagement}%` }}
                        />
                      </div>
                      <span className="text-[8px] font-mono text-[var(--m-dim)] shrink-0">
                        {formatCompactNumber(seg.count)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 3. BOTTOM ZONE: Proof + Metrics Dock */}
      <div
        className={cn(
          'm-cockpit-bottom',
          'lg:flex',
          activeTab === 'proof' ? 'flex' : 'hidden lg:flex'
        )}
      >
        {/* Row 1: MetricDock (Console Mixing Strip) */}
        <div className="m-mixing-strip no-scrollbar shrink-0">
          {[
            {
              label: 'Reached Fans',
              tag: 'SIGNAL',
              data: topKpis.fansContacted,
              sub: 'Outbounds prompt',
              icon: Users,
            },
            {
              label: 'Human Answers',
              tag: 'ANSWER',
              data: topKpis.humanAnswers,
              sub: 'Connections lock',
              icon: Headphones,
            },
            {
              label: 'Verified Actions',
              tag: 'ACTION',
              data: topKpis.verifiedEngagements,
              sub: 'Convos verified',
              icon: ShieldCheck,
            },
            {
              label: 'Pre-Saves',
              tag: 'GOAL',
              data: topKpis.preSaves,
              sub: 'Added to streaming',
              icon: CheckCircle2,
            },
            {
              label: 'Cost / Pre-Save',
              tag: 'VALUE',
              data: topKpis.costPerPreSave,
              sub: 'Unit CPA target',
              icon: DollarSign,
              isCurrency: true,
            },
            {
              label: 'Proof Records',
              tag: 'LEDGER',
              data: topKpis.proofCaptured,
              sub: 'Evidences saved',
              icon: FileText,
            },
          ].map(kpi => (
            <div key={kpi.label} className="m-mixing-fader">
              <div className="flex justify-between items-start">
                <span className="m-mixing-label">{kpi.tag}</span>
                <span
                  className={cn(
                    'm-mixing-delta',
                    kpi.isCurrency
                      ? kpi.data.change < 0
                        ? 'm-text-accent-2'
                        : 'm-text-danger'
                      : kpi.data.change > 0
                        ? 'm-text-accent-2'
                        : 'm-text-danger'
                  )}
                >
                  {kpi.data.change > 0 ? '↑' : '↓'}
                  {Math.abs(kpi.data.change)}%
                </span>
              </div>
              <div className="flex items-baseline justify-between mt-0.5">
                <div className="m-mixing-value">
                  {kpi.isCurrency
                    ? formatCurrency(kpi.data.value)
                    : formatCompactNumber(kpi.data.value)}
                </div>
                <div className="m-mixing-sub max-w-[60px]">{kpi.sub}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Row 2: ProofTicker (Horizontal Receipt Ticker) */}
        <div className="flex items-center gap-3 min-h-0 flex-1 overflow-hidden">
          {/* Header descriptor */}
          <div className="hidden xl:flex flex-col justify-center shrink-0 w-40 text-left border-r border-[var(--m-border-2)] pr-3 h-full">
            <h3 className="text-[10px] font-bold text-[var(--m-text)] uppercase tracking-wider flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-[var(--m-accent-2)]" /> Live Signal Feed
            </h3>
            <p className="text-[8px] m-text-muted mt-0.5 leading-normal">
              Click a ticket card below to slide open detailed transcripts and verification proofs.
            </p>
          </div>

          {/* Horizontal scroll container */}
          <div className="m-proof-ticker no-scrollbar flex-1">
            {proofRecords.slice(0, 8).map(r => {
              // Sentiment colors
              const borderCol =
                r.sentiment === 'positive'
                  ? 'bg-[var(--m-accent-2)]'
                  : r.sentiment === 'negative'
                    ? 'bg-[var(--m-danger)]'
                    : 'bg-[var(--m-dim)]';

              return (
                <div
                  key={r.id}
                  onClick={() => {
                    setSelectedProof(r);
                    setIsPlayingRecord(false); // Reset playback state when shifting records
                  }}
                  className="m-proof-ticker-card pl-4"
                >
                  <div className={cn('m-proof-card-accent-bar', borderCol)} />
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-bold text-[10px] truncate max-w-[130px] text-[var(--m-text)]">
                      {r.fanName}
                    </span>
                    <span className="text-[8px] font-mono text-[var(--m-dim)] shrink-0">
                      {formatTimestamp(r.timestamp)}
                    </span>
                  </div>

                  <div className="text-[8px] text-[var(--m-muted)] truncate my-0.5">
                    {r.campaignName}
                  </div>

                  <div className="flex items-center justify-between gap-2 mt-auto">
                    <span
                      className={cn(
                        'm-badge py-0 px-1.5 text-[8px] font-bold',
                        r.verifiedAction ? 'm-badge--verified' : 'm-badge--neutral'
                      )}
                    >
                      {outcomeLabel(r.outcome)}
                    </span>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {r.hasRecording && (
                        <div className="m-equalizer">
                          <span className="m-equalizer-bar" />
                          <span className="m-equalizer-bar" />
                          <span className="m-equalizer-bar" />
                        </div>
                      )}
                      {r.hasTranscript && <FileText className="h-3 w-3 text-[var(--m-muted)]" />}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* CTA Link */}
          <Link
            href="/music-console/proof"
            className="m-btn m-btn--secondary py-3 px-3 h-full flex flex-col justify-center items-center gap-1 shrink-0 bg-[var(--m-surface-2)] text-[10px] font-bold border border-[var(--m-border)] hover:bg-[var(--m-surface-3)]"
          >
            <span>Full Ledger</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* ─── COCKPIT DETAILED TRANSCRIPT DRAWER (Single-screen Viewport Safe) ─── */}
      {selectedProof && (
        <div className="m-drawer-overlay">
          <div className="m-drawer">
            {/* Header */}
            <div className="m-drawer-header flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <h2 className="text-sm font-black text-[var(--m-text)]">
                    {selectedProof.fanName}
                  </h2>
                  <span
                    className={cn(
                      'm-badge text-[8px] font-bold',
                      selectedProof.verifiedAction ? 'm-badge--verified' : 'm-badge--neutral'
                    )}
                  >
                    {outcomeLabel(selectedProof.outcome)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-y-1 gap-x-3 text-[10px] m-text-muted">
                  <span>{selectedProof.fanPhone.slice(0, 8)}***-****</span>
                  <span>&bull;</span>
                  <span>{selectedProof.artist}</span>
                  <span>&bull;</span>
                  <span className="font-mono text-[9px] text-[var(--m-dim)] uppercase">
                    ID: {selectedProof.id.split('-')[1]}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setSelectedProof(undefined)}
                className="text-[var(--m-muted)] hover:text-[var(--m-text)] bg-[var(--m-surface-2)] hover:bg-[var(--m-surface-3)] p-1 rounded transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="m-drawer-body space-y-5">
              {/* Campaign Context */}
              <div className="bg-[var(--m-surface)] border border-[var(--m-border-2)] rounded-lg p-3 text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="m-text-dim">Campaign Target</span>
                  <span className="font-semibold text-[var(--m-text-2)]">
                    {selectedProof.campaignName}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="m-text-dim">Fan Segment</span>
                  <span className="font-semibold text-[var(--m-text-2)]">
                    {segmentLabel(selectedProof.segment)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="m-text-dim">Consent Opt-In</span>
                  <span>{selectedProof.consentSource}</span>
                </div>
                <div className="flex justify-between">
                  <span className="m-text-dim">Attributed Value</span>
                  <span className="font-mono text-[var(--m-accent)] font-bold">
                    {formatCurrency(selectedProof.cpaAttribution)}
                  </span>
                </div>
              </div>

              {/* Audio Playback Mock */}
              {selectedProof.hasRecording && (
                <div className="bg-[var(--m-surface)] border border-[var(--m-border-2)] rounded-lg p-3 space-y-2">
                  <div className="text-[9px] uppercase tracking-wider font-bold text-[var(--m-muted)]">
                    Audio Proof Telemetry
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setIsPlayingRecord(!isPlayingRecord)}
                      className={cn(
                        'h-8 w-8 rounded-full flex items-center justify-center text-white transition-colors',
                        isPlayingRecord
                          ? 'bg-[var(--m-accent-2)]'
                          : 'bg-[var(--m-accent)] hover:opacity-90'
                      )}
                    >
                      <Play className="h-3 w-3 ml-0.5 fill-white" />
                    </button>

                    <div className="m-waveform flex-1 h-8">
                      {Array.from({ length: 28 }).map((_, i) => {
                        const h = getWaveformHeight(selectedProof.id, i);
                        return (
                          <div
                            key={i}
                            className="m-waveform-bar"
                            style={{
                              height: `${h}%`,
                              backgroundColor:
                                isPlayingRecord && i % 4 === 0
                                  ? 'var(--m-accent-2)'
                                  : 'var(--m-accent)',
                            }}
                          />
                        );
                      })}
                    </div>
                  </div>
                  <div className="flex justify-between text-[9px] m-text-dim font-mono">
                    <span>{isPlayingRecord ? '0:14' : '0:00'}</span>
                    <span>
                      {Math.floor(selectedProof.duration / 60)}:
                      {(selectedProof.duration % 60).toString().padStart(2, '0')}
                    </span>
                  </div>
                </div>
              )}

              {/* Transcript */}
              {selectedProof.hasTranscript && selectedProof.transcriptSnippet ? (
                <div className="space-y-2">
                  <div className="text-[10px] font-bold text-[var(--m-text-2)] uppercase tracking-wider flex items-center gap-1">
                    <FileText className="h-3.5 w-3.5 text-[var(--m-accent-2)]" /> Verbatim Dialogue
                  </div>
                  <div className="m-transcript">
                    {renderTranscript(selectedProof.transcriptSnippet)}
                  </div>
                </div>
              ) : (
                <div className="p-6 text-center text-xs m-text-dim bg-[var(--m-surface-2)] rounded border border-[var(--m-border-2)]">
                  Transcript logs processing...
                </div>
              )}

              {/* Telemetry metadata block */}
              <div className="grid grid-cols-2 gap-3 text-[11px] border-t border-[var(--m-border-2)] pt-3">
                <div className="space-y-1">
                  <div className="text-[8px] uppercase tracking-wider text-[var(--m-dim)] font-bold">
                    Privacy Compliance
                  </div>
                  <div className="text-[10px] text-[var(--m-text-2)]">STIR/SHAKEN: A-Attest</div>
                  <div className="text-[10px] text-[var(--m-text-2)]">TCPA Disclosure: Played</div>
                </div>
                <div className="space-y-1">
                  <div className="text-[8px] uppercase tracking-wider text-[var(--m-dim)] font-bold">
                    Carrier Telemetry
                  </div>
                  <div className="text-[10px] text-[var(--m-text-2)]">
                    SIP Route: DIDCentral-Prod
                  </div>
                  <div className="text-[10px] text-[var(--m-text-2)]">
                    Signal Jitter: {getJitter(selectedProof.id)}ms
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
