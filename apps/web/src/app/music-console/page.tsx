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
import { cn } from '@/lib/utils';

// Client-safe time extractor to prevent hydration warnings (no timezone reliance)
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

  const togglePlay = (id: string) => {
    setPlayingRecordId(playingRecordId === id ? null : id);
  };

  const toggleTranscript = (id: string) => {
    setExpandedTranscriptId(expandedTranscriptId === id ? null : id);
  };

  return (
    <div className="space-y-8 pb-12">
      {/* ─── SECTION 1: Above-the-fold "Fan Signal Studio" ─── */}
      <section className="m-card p-6 lg:p-8 relative overflow-hidden bg-gradient-to-br from-[var(--m-surface)] to-[var(--m-surface-2)]">
        <div className="absolute top-0 right-0 w-96 h-96 bg-[var(--m-accent-dim)] rounded-full blur-[100px] pointer-events-none opacity-40" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-[var(--m-accent-2-dim)] rounded-full blur-[80px] pointer-events-none opacity-30" />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center relative z-10">
          {/* Left Column: Cockpit Title & Details */}
          <div className="lg:col-span-7 space-y-6">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-bold tracking-[0.2em] text-[var(--m-accent)] uppercase">
                  HOPWHISTLE MUSIC / LIVE FAN SIGNAL
                </span>
                <span className="m-badge m-badge--active flex items-center gap-1.5 py-0.5">
                  <span className="m-pulse-dot" />
                  <span className="font-mono text-[9px]">{livePulse.status}</span>
                </span>
              </div>
              <h1 className="text-3xl lg:text-4xl font-extrabold tracking-tight text-[var(--m-text)] leading-tight">
                Turn fan attention <br />
                into <span className="text-[var(--m-accent)]">verified action</span>.
              </h1>
              <p className="text-sm m-text-muted max-w-xl leading-relaxed">
                Run direct-to-fan voice campaigns for pre-saves, ticket drops, merch, VIP upgrades,
                and fan reactivation — with recordings, transcripts, outcomes, and attribution
                attached to every response.
              </p>
            </div>

            {/* Active Campaign Console Detail */}
            <div className="m-card-deep p-4 flex flex-col md:flex-row gap-6 md:items-center justify-between border border-[var(--m-border)]">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-[10px] font-semibold text-[var(--m-accent)] uppercase tracking-wider">
                  <Music className="h-3 w-3" /> Active Campaign Console
                </div>
                <div className="text-base font-bold text-[var(--m-text)]">
                  {livePulse.campaignName}
                </div>
                <div className="text-xs m-text-muted">
                  Artist:{' '}
                  <span className="font-semibold text-[var(--m-text-2)]">{livePulse.artist}</span>{' '}
                  &bull; Target Segment:{' '}
                  <span className="font-semibold text-[var(--m-text-2)]">{livePulse.segment}</span>
                </div>
              </div>

              <div className="flex items-center gap-4 border-t md:border-t-0 md:border-l border-[var(--m-border)] pt-4 md:pt-0 md:pl-6">
                <div>
                  <div className="text-[9px] uppercase tracking-wider text-[var(--m-dim)]">
                    Total Budget Spent
                  </div>
                  <div className="text-lg font-mono font-bold text-[var(--m-text)] mt-0.5">
                    {formatCurrency(livePulse.spend)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Custom SVG/CSS SignalDisc Visual */}
          <div className="lg:col-span-5 flex flex-col items-center justify-center">
            <div className="m-signal-disc-container">
              {/* Radar Expanding Ripples */}
              <div className="m-signal-disc-ripple-ring" />
              <div className="m-signal-disc-ripple-ring" />
              <div className="m-signal-disc-ripple-ring" />

              {/* Tonearm */}
              <svg
                className="absolute right-4 top-2 w-24 h-32 z-20 pointer-events-none"
                viewBox="0 0 100 120"
              >
                <path
                  d="M90,10 L80,10 L45,65 L35,68 L40,76 L48,72 L82,24 Z"
                  fill="#A39B90"
                  stroke="rgba(0,0,0,0.15)"
                  strokeWidth="1"
                />
                <circle cx="90" cy="10" r="7" fill="#34312C" />
                <rect
                  x="33"
                  y="72"
                  width="10"
                  height="8"
                  rx="1"
                  transform="rotate(-35 38 76)"
                  fill="#D94A38"
                />
                <circle cx="38" cy="76" r="1.5" fill="#08A77A" className="animate-pulse" />
              </svg>

              {/* Vinyl Disc Group */}
              <div className="m-signal-disc m-signal-disc-spin">
                {/* Grooves & Concentric Circular Arcs */}
                <div className="m-signal-disc-grooves" />

                {/* SVG Progress Arcs */}
                <svg className="absolute inset-0 w-full h-full" viewBox="0 0 230 230">
                  {/* Contact Rate Arc (Outer: Green) */}
                  <circle
                    cx="115"
                    cy="115"
                    r="84"
                    fill="none"
                    stroke="var(--m-accent-2)"
                    strokeWidth="4"
                    strokeDasharray={`${2 * Math.PI * 84 * (livePulse.contactRate / 100)} ${2 * Math.PI * 84 * (1 - livePulse.contactRate / 100)}`}
                    strokeLinecap="round"
                    transform="rotate(-90 115 115)"
                    opacity="0.85"
                  />
                  {/* Answer Rate Arc (Middle: Violet) */}
                  <circle
                    cx="115"
                    cy="115"
                    r="68"
                    fill="none"
                    stroke="var(--m-accent)"
                    strokeWidth="4"
                    strokeDasharray={`${2 * Math.PI * 68 * (livePulse.answerRate / 100)} ${2 * Math.PI * 68 * (1 - livePulse.answerRate / 100)}`}
                    strokeLinecap="round"
                    transform="rotate(-45 115 115)"
                    opacity="0.85"
                  />
                  {/* Verified Rate Arc (Inner: Amber) */}
                  <circle
                    cx="115"
                    cy="115"
                    r="52"
                    fill="none"
                    stroke="var(--m-warning)"
                    strokeWidth="4"
                    strokeDasharray={`${2 * Math.PI * 52 * (livePulse.verifiedRate / 100)} ${2 * Math.PI * 52 * (1 - livePulse.verifiedRate / 100)}`}
                    strokeLinecap="round"
                    transform="rotate(30 115 115)"
                    opacity="0.85"
                  />
                </svg>

                {/* Center Record Sticker */}
                <div className="m-signal-disc-center">
                  <div className="m-signal-disc-spindle" />
                </div>
              </div>

              {/* Data Callout Tags Overlaid Around Disc */}
              <div className="absolute top-1/2 left-[-16px] -translate-y-1/2 bg-[var(--m-surface)] border border-[var(--m-border)] px-2.5 py-1 rounded shadow-sm text-center">
                <div className="text-[8px] uppercase tracking-wider text-[var(--m-muted)] font-semibold">
                  Contact
                </div>
                <div className="text-xs font-mono font-bold text-[var(--m-accent-2)]">
                  {livePulse.contactRate}%
                </div>
              </div>
              <div className="absolute top-8 right-0 bg-[var(--m-surface)] border border-[var(--m-border)] px-2.5 py-1 rounded shadow-sm text-center">
                <div className="text-[8px] uppercase tracking-wider text-[var(--m-muted)] font-semibold">
                  Answers
                </div>
                <div className="text-xs font-mono font-bold text-[var(--m-accent)]">
                  {livePulse.answerRate}%
                </div>
              </div>
              <div className="absolute bottom-8 left-4 bg-[var(--m-surface)] border border-[var(--m-border)] px-2.5 py-1 rounded shadow-sm text-center">
                <div className="text-[8px] uppercase tracking-wider text-[var(--m-muted)] font-semibold">
                  Verified
                </div>
                <div className="text-xs font-mono font-bold text-[var(--m-warning)]">
                  {livePulse.verifiedRate}%
                </div>
              </div>
              <div className="absolute bottom-0 right-4 bg-[var(--m-surface)] border border-[var(--m-border)] px-2.5 py-1 rounded shadow-sm text-center">
                <div className="text-[8px] uppercase tracking-wider text-[var(--m-muted)] font-semibold">
                  Current CPA
                </div>
                <div className="text-xs font-mono font-bold text-[var(--m-text)]">
                  {formatCurrency(livePulse.cpa)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── SECTION 2: Metric Ribbon ─── */}
      <section className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <span className="text-[10px] font-bold tracking-widest text-[var(--m-muted)] uppercase">
            LABEL EXECUTIVE SNAPSHOT
          </span>
          <span className="text-[10px] font-mono text-[var(--m-dim)]">Real-Time Data Feed</span>
        </div>

        <div className="m-metric-ribbon no-scrollbar">
          {[
            {
              label: 'Reached Fans',
              tag: 'FAN SIGNAL',
              data: topKpis.fansContacted,
              mean: 'Audiences prompted',
              icon: Users,
            },
            {
              label: 'Human Answers',
              tag: 'VOICE RESPONSE',
              data: topKpis.humanAnswers,
              mean: 'Live connections made',
              icon: Headphones,
            },
            {
              label: 'Verified Actions',
              tag: 'ACTION VERIFIED',
              data: topKpis.verifiedEngagements,
              mean: 'Fans engaged in convo',
              icon: ShieldCheck,
            },
            {
              label: 'Pre-Saves',
              tag: 'CONVERSION',
              data: topKpis.preSaves,
              mean: 'Added to Spotify/Apple',
              icon: CheckCircle2,
            },
            {
              label: 'Cost / Pre-Save',
              tag: 'EFFICIENCY',
              data: topKpis.costPerPreSave,
              mean: 'Target acquisition cost',
              icon: DollarSign,
              isCurrency: true,
            },
            {
              label: 'Proof Records',
              tag: 'LEDGER PROOF',
              data: topKpis.proofCaptured,
              mean: 'Transcripts & audio locked',
              icon: FileText,
            },
          ].map(kpi => (
            <div key={kpi.label} className="m-metric-tile">
              <div>
                <span className="m-metric-tile-label">{kpi.tag}</span>
                <div className="m-metric-tile-value">
                  {kpi.isCurrency
                    ? formatCurrency(kpi.data.value)
                    : formatCompactNumber(kpi.data.value)}
                </div>
              </div>
              <div className="m-metric-tile-footer">
                <span className="m-metric-tile-subtext">{kpi.mean}</span>
                <span
                  className={cn(
                    'm-metric-tile-delta',
                    kpi.isCurrency
                      ? kpi.data.change < 0
                        ? 'm-text-accent-2'
                        : 'm-text-danger'
                      : kpi.data.change > 0
                        ? 'm-text-accent-2'
                        : 'm-text-danger'
                  )}
                >
                  {kpi.data.change > 0 ? '↑' : '↓'} {Math.abs(kpi.data.change)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ─── SECTION 3: Fan Journey Flow ─── */}
      <section className="m-card p-6">
        <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-2">
          <div>
            <h2 className="m-section-title">
              <TrendingUp className="h-4 w-4 text-[var(--m-accent)]" /> Stepped Fan Journey path
            </h2>
            <p className="m-section-subtitle">
              Visual attribution and drop-off metrics along the campaign signal path.
            </p>
          </div>
          <div className="text-[10px] font-mono text-[var(--m-muted)] bg-[var(--m-surface-2)] border border-[var(--m-border-2)] px-2 py-1 rounded">
            Campaign Mode: AI Dialing
          </div>
        </div>

        <div className="m-journey-flow">
          {funnelData.map((stage, i) => {
            // Label mappings and custom meanings
            const meanings: Record<string, string> = {
              'Uploaded Fans': 'Audience loaded',
              Contacted: 'Voice campaign reached',
              'Human Answered': 'Real fan answered',
              Engaged: 'Conversation continued',
              'Verified Intent': 'Intent captured',
              'Action Taken': 'Pre-save / ticket / merch action',
            };

            return (
              <React.Fragment key={stage.label}>
                <div className="m-journey-step">
                  <div className="flex items-start justify-between">
                    <span className="m-journey-step-idx">Step 0{i + 1}</span>
                    <span className="text-[10px] font-mono font-bold text-[var(--m-muted)] bg-[var(--m-surface-2)] px-1.5 py-0.5 rounded">
                      {stage.percentage.toFixed(1)}%
                    </span>
                  </div>

                  <div className="mt-3">
                    <div className="text-[10px] uppercase font-bold text-[var(--m-muted)] tracking-wider">
                      {stage.label}
                    </div>
                    <div className="text-xl font-bold font-mono text-[var(--m-text)] mt-0.5">
                      {formatCompactNumber(stage.count)}
                    </div>
                  </div>

                  <div>
                    <div className="text-[10px] italic text-[var(--m-dim)] mt-2 font-medium">
                      &ldquo;{meanings[stage.label] || stage.label}&rdquo;
                    </div>
                    <div className="m-journey-step-fill-bg">
                      <div
                        className="m-journey-step-fill-val"
                        style={{ width: `${stage.percentage}%`, backgroundColor: stage.color }}
                      />
                    </div>
                  </div>
                </div>

                {/* Arrow Connector between steps */}
                {i < funnelData.length - 1 && (
                  <div className="m-journey-connector">
                    <ArrowRight className="h-5 w-5" />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </section>

      {/* ─── MIDDLE ROW: Timeline Movement & Segment Heat ─── */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* SECTION 4: Live Campaign Movement */}
        <div className="lg:col-span-2 m-card p-6 flex flex-col justify-between">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-6">
            <div className="space-y-1">
              <h2 className="m-section-title">
                <Activity className="h-4 w-4 text-[var(--m-accent)]" /> Live Campaign Movement
              </h2>
              <p className="text-xs m-text-muted max-w-md">
                Fan response over the last 14 days. Watch answer volume, verified actions, and
                action quality move together.
              </p>
            </div>

            {/* Legend / Callout Chips */}
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-[var(--m-accent-dim)] text-[var(--m-accent)] border border-[rgba(109,61,255,0.15)]">
                {livePulse.answerRate}% Answer Rate
              </span>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-[var(--m-accent-2-dim)] text-[var(--m-accent-2)] border border-[rgba(8,167,122,0.15)]">
                {livePulse.verifiedRate}% Action Rate
              </span>
            </div>
          </div>

          <div className="h-[240px] w-full mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={campaignTimeSeries}
                margin={{ top: 10, right: 5, left: -25, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="colorAnswers" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6D3DFF" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#6D3DFF" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorVerified" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#08A77A" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#08A77A" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="4 4"
                  vertical={false}
                  stroke="rgba(42,38,32,0.06)"
                />
                <XAxis
                  dataKey="date"
                  stroke="rgba(42, 38, 32, 0.2)"
                  tick={{ fontSize: 10, fill: '#756F66', fontWeight: 500 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  stroke="rgba(42, 38, 32, 0.2)"
                  tick={{ fontSize: 10, fill: '#756F66', fontWeight: 500 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    border: '1px solid rgba(42, 38, 32, 0.12)',
                    borderRadius: '8px',
                    boxShadow: '0 4px 16px rgba(42, 38, 32, 0.08)',
                  }}
                  itemStyle={{ fontSize: '11px', color: '#171717' }}
                  labelStyle={{
                    fontSize: '10px',
                    color: '#756F66',
                    fontWeight: '700',
                    marginBottom: '4px',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="humanAnswers"
                  name="Human Answers"
                  stroke="#6D3DFF"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorAnswers)"
                />
                <Area
                  type="monotone"
                  dataKey="verifiedEngagements"
                  name="Verified Actions"
                  stroke="#08A77A"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorVerified)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* SECTION 5: Top Segments as "Audience Heat" */}
        <div className="m-card p-6 flex flex-col justify-between">
          <div className="space-y-1 mb-6">
            <h2 className="m-section-title">
              <Flame className="h-4 w-4 text-[var(--m-warning)]" /> Audience Heat Board
            </h2>
            <p className="m-section-subtitle">Ranked target lists by total engagement scores.</p>
          </div>

          <div className="m-heat-board flex-1 justify-center flex flex-col">
            {topSegmentsData.map((seg, i) => {
              // Custom descriptive captions for segments
              const captions: Record<string, string> = {
                Superfans: 'High-frequency streams & social tier',
                'Stream save audience': 'Prior cycle album presavers',
                'VIP list': 'Opted-in SMS premium tier',
                'Previous merch buyers': 'Purchased apparel, prints, or vinyl',
                'Tour city fans': 'Within 50 miles of upcoming venue stops',
                'Fan club inactive': 'Dormant email registers targeted to reactivate',
              };

              return (
                <div key={seg.segment} className="m-heat-row">
                  <div className="m-heat-rank">0{i + 1}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-bold text-[var(--m-text)] truncate">
                        {seg.segment}
                      </div>
                      <div className="text-xs font-mono font-bold text-[var(--m-accent-2)]">
                        {seg.engagement}%
                      </div>
                    </div>

                    <div className="text-[9px] text-[var(--m-muted)] truncate mb-1">
                      {captions[seg.segment] || `${formatCompactNumber(seg.count)} fans`}
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="m-heat-bar-container">
                        <div className="m-heat-bar-fill" style={{ width: `${seg.engagement}%` }} />
                      </div>
                      <span className="text-[9px] font-mono text-[var(--m-dim)] shrink-0">
                        {formatCompactNumber(seg.count)} fans
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ─── SECTION 6: Fan Proof Stream ─── */}
      <section className="m-card p-6">
        <div className="border-b border-[var(--m-border-2)] pb-4 mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div className="space-y-1">
            <h2 className="m-section-title">
              <ShieldCheck className="h-4 w-4 text-[var(--m-accent-2)]" /> Proof coming back from
              the audience
            </h2>
            <p className="m-section-subtitle">
              Every fan answer returns as evidence: recording, transcript, sentiment, intent,
              outcome, and campaign attribution.
            </p>
          </div>
          <Link
            href="/music-console/proof"
            className="m-btn m-btn--secondary py-2 px-4 text-xs font-bold shrink-0 self-start md:self-auto"
          >
            Open full proof log <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {/* Feed Layout */}
        <div className="m-proof-stream">
          {proofRecords.slice(0, 6).map(r => {
            const isPlaying = playingRecordId === r.id;
            const isExpanded = expandedTranscriptId === r.id;

            // Determine border color by sentiment
            const borderCol =
              r.sentiment === 'positive'
                ? 'bg-[var(--m-accent-2)]'
                : r.sentiment === 'negative'
                  ? 'bg-[var(--m-danger)]'
                  : 'bg-[var(--m-dim)]';

            return (
              <div key={r.id} className="m-proof-card pl-6">
                {/* Visual side accent bar */}
                <div className={cn('m-proof-card-accent-bar', borderCol)} />

                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  {/* Fan Identity & Source Info */}
                  <div className="flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-sm text-[var(--m-text)]">{r.fanName}</span>
                      <span className="font-mono text-[10px] text-[var(--m-muted)]">
                        {r.fanPhone.slice(0, 8)}***-****
                      </span>
                      <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-[var(--m-surface-2)] text-[var(--m-text-2)] border border-[var(--m-border-2)]">
                        {segmentLabel(r.segment)}
                      </span>
                      <span
                        className={cn(
                          'm-badge',
                          r.intent === 'high'
                            ? 'm-badge--active'
                            : r.intent === 'medium'
                              ? 'm-badge--paused'
                              : 'm-badge--neutral'
                        )}
                      >
                        {r.intent} intent
                      </span>
                    </div>

                    <div className="text-xs text-[var(--m-muted)] flex flex-wrap items-center gap-y-1 gap-x-2">
                      <span>Campaign:</span>
                      <span className="font-semibold text-[var(--m-text-2)]">{r.campaignName}</span>
                      <span>&bull;</span>
                      <span>Attributed CPA:</span>
                      <span className="font-mono text-[var(--m-accent)] font-semibold">
                        {formatCurrency(r.cpaAttribution)}
                      </span>
                    </div>
                  </div>

                  {/* Outcome, Verifications & Action buttons */}
                  <div className="flex flex-wrap items-center gap-3 shrink-0">
                    <span
                      className={cn(
                        'm-badge py-1 px-3',
                        r.verifiedAction ? 'm-badge--verified' : 'm-badge--neutral'
                      )}
                    >
                      {outcomeLabel(r.outcome)}
                    </span>

                    {/* Audio Player Simulated Button */}
                    {r.hasRecording && (
                      <button
                        onClick={() => togglePlay(r.id)}
                        className={cn(
                          'm-btn py-1.5 px-3 text-xs font-semibold flex items-center gap-2 border transition-all',
                          isPlaying
                            ? 'bg-[var(--m-accent)] text-white border-[var(--m-accent)]'
                            : 'bg-[var(--m-surface-2)] text-[var(--m-text-2)] border-[var(--m-border)] hover:bg-[var(--m-surface-3)]'
                        )}
                      >
                        {isPlaying ? (
                          <>
                            <div className="m-equalizer">
                              <span className="m-equalizer-bar" />
                              <span className="m-equalizer-bar" />
                              <span className="m-equalizer-bar" />
                            </div>
                            <span>Playing Proof</span>
                          </>
                        ) : (
                          <>
                            <Play className="h-3 w-3 text-[var(--m-accent)] fill-[var(--m-accent)]" />
                            <span>Audio Proof</span>
                          </>
                        )}
                      </button>
                    )}

                    {/* Transcript toggle button */}
                    {r.hasTranscript && (
                      <button
                        onClick={() => toggleTranscript(r.id)}
                        className="m-btn py-1.5 px-2.5 text-xs font-semibold bg-[var(--m-surface-2)] text-[var(--m-text-2)] border border-[var(--m-border)] hover:bg-[var(--m-surface-3)] flex items-center gap-1"
                      >
                        <FileText className="h-3 w-3" />
                        {isExpanded ? (
                          <ChevronUp className="h-3 w-3" />
                        ) : (
                          <ChevronDown className="h-3 w-3" />
                        )}
                      </button>
                    )}

                    {/* Static timestamp */}
                    <span className="text-[10px] font-mono text-[var(--m-dim)] pl-2">
                      {formatTimestamp(r.timestamp)}
                    </span>
                  </div>
                </div>

                {/* Expanded Audio Player Simulation */}
                {isPlaying && (
                  <div className="mt-3 p-3 bg-[var(--m-surface-2)] border border-[var(--m-border-2)] rounded-md flex items-center gap-4 animate-fadeIn">
                    <Volume2 className="h-4 w-4 text-[var(--m-accent)] animate-bounce" />
                    <div className="flex-1 h-1.5 bg-[var(--m-surface-3)] rounded-full overflow-hidden relative">
                      <div className="h-full bg-[var(--m-accent)] w-1/3 animate-[pulse_2s_infinite]" />
                    </div>
                    <span className="text-[10px] font-mono text-[var(--m-muted)]">0:14 / 1:24</span>
                  </div>
                )}

                {/* Expanded Transcript Snippet */}
                {isExpanded && r.transcriptSnippet && (
                  <div className="mt-3 p-4 bg-[var(--m-surface-2)] border border-[var(--m-border-2)] rounded-md space-y-2 animate-fadeIn text-xs">
                    <div className="text-[9px] uppercase tracking-wider font-bold text-[var(--m-muted)] border-b border-[var(--m-border-2)] pb-1 mb-2">
                      Voice Signal Transcript Snippet
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
                              'w-20 font-bold uppercase tracking-wider shrink-0 text-[10px]',
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
