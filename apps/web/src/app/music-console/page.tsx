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

  const togglePlay = (id: string) => {
    setPlayingRecordId(playingRecordId === id ? null : id);
  };

  const toggleTranscript = (id: string) => {
    setExpandedTranscriptId(expandedTranscriptId === id ? null : id);
  };

  return (
    <div className="space-y-8 pb-12">
      {/* ─── SECTION 1: Premium Hero Command Module (Dark Obsidian) ─── */}
      <section className="m-dark-mode bg-[#09090B] text-[#FAFAFA] rounded-2xl border border-[var(--m-border)] p-6 lg:p-8 relative overflow-hidden">
        {/* Glow Highlights */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-[var(--m-accent-dim)] rounded-full blur-[120px] pointer-events-none opacity-40" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-[var(--m-accent-2-dim)] rounded-full blur-[90px] pointer-events-none opacity-30" />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center relative z-10">
          {/* Left Column: Command details & KPI Summary */}
          <div className="lg:col-span-7 space-y-6">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-bold tracking-[0.2em] text-[var(--m-accent)] uppercase">
                  HOPWHISTLE MUSIC // SYSTEM COMMAND
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded border border-[#10B981]/20 bg-[#10B981]/10 text-xs font-semibold text-[#10B981]">
                  <span className="m-pulse-dot h-1.5 w-1.5" />
                  <span className="font-mono text-[9px] uppercase">{livePulse.status}</span>
                </span>
              </div>
              <h1 className="text-3xl font-extrabold tracking-tight text-[var(--m-text)] leading-tight">
                Turn fan attention into <span className="text-[var(--m-accent)]">verified action</span>.
              </h1>
              <p className="text-sm m-text-muted max-w-xl leading-relaxed">
                Configure voice agents to dial opted-in contacts, verify streaming actions, deliver tracking links, and secure conversions in the ledger.
              </p>
            </div>

            {/* Active Console Details Wrapper */}
            <div className="bg-[#121214] border border-[var(--m-border)] rounded-xl p-4 grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-1">
                <div className="text-[9px] font-bold tracking-wider text-[var(--m-muted)] uppercase">Active Project</div>
                <div className="text-sm font-bold text-[var(--m-text)] truncate">{livePulse.campaignName}</div>
                <div className="text-[10px] m-text-dim truncate">{livePulse.artist}</div>
              </div>
              <div className="space-y-1 border-l border-[var(--m-border-2)] pl-4">
                <div className="text-[9px] font-bold tracking-wider text-[var(--m-muted)] uppercase">Current CPA</div>
                <div className="text-base font-mono font-bold text-[var(--m-warning)]">{formatCurrency(livePulse.cpa)}</div>
                <div className="text-[10px] m-text-dim">CPA Efficiency</div>
              </div>
              <div className="space-y-1 border-l border-[var(--m-border-2)] pl-4">
                <div className="text-[9px] font-bold tracking-wider text-[var(--m-muted)] uppercase">Verified Actions</div>
                <div className="text-base font-mono font-bold text-[var(--m-accent-2)]">
                  {formatCompactNumber(topKpis.verifiedEngagements.value)}
                </div>
                <div className="text-[10px] m-text-dim">Attributed saves</div>
              </div>
              <div className="space-y-1 border-l border-[var(--m-border-2)] pl-4">
                <div className="text-[9px] font-bold tracking-wider text-[var(--m-muted)] uppercase">Proof Ledger</div>
                <div className="text-base font-mono font-bold text-[var(--m-accent)]">
                  {formatCompactNumber(topKpis.proofCaptured.value)}
                </div>
                <div className="text-[10px] m-text-dim">Audit logs locked</div>
              </div>
            </div>

            {/* CTA Actions */}
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/music-console/proof">
                <ActionButton variant="primary" className="text-xs font-semibold py-2">
                  View Proof Log <ArrowRight className="h-3.5 w-3.5" />
                </ActionButton>
              </Link>
              <Link href="/music-console/reports">
                <ActionButton variant="secondary" className="text-xs font-semibold py-2">
                  Open Reports
                </ActionButton>
              </Link>
            </div>
          </div>

          {/* Right Column: Premium Rotating Disc Visual */}
          <div className="lg:col-span-5 flex items-center justify-center">
            <div className="m-signal-disc-container">
              {/* Radar expanding ripples */}
              <div className="m-signal-disc-ripple-ring" />
              <div className="m-signal-disc-ripple-ring" />

              {/* Tonearm */}
              <svg
                className="absolute right-4 top-2 w-24 h-32 z-20 pointer-events-none"
                viewBox="0 0 100 120"
              >
                <g className={cn("m-signal-disc-tonearm", playingRecordId !== null && "m-signal-disc-tonearm--active")}>
                  <path
                    d="M90,10 L80,10 L45,65 L35,68 L40,76 L48,72 L82,24 Z"
                    fill="#71717A"
                    stroke="rgba(0,0,0,0.4)"
                    strokeWidth="1"
                  />
                  <circle cx="90" cy="10" r="7" fill="#18181B" />
                  <rect
                    x="33"
                    y="72"
                    width="10"
                    height="8"
                    rx="1"
                    transform="rotate(-35 38 76)"
                    fill="#EF4444"
                  />
                  <circle cx="38" cy="76" r="1.5" fill="#10B981" className="animate-pulse" />
                </g>
              </svg>

              {/* Vinyl Disc Group */}
              <div className="m-signal-disc m-signal-disc-spin">
                {/* Grooves & Concentric Circular Arcs */}
                <div className="m-signal-disc-grooves" />

                {/* SVG Progress Arcs */}
                <svg className="absolute inset-0 w-full h-full" viewBox="0 0 230 230">
                  {/* Contact Rate Arc (Outer: Teal) */}
                  <circle
                    cx="115"
                    cy="115"
                    r="84"
                    fill="none"
                    stroke="#10B981"
                    strokeWidth="3.5"
                    strokeDasharray={`${2 * Math.PI * 84 * (livePulse.contactRate / 100)} ${2 * Math.PI * 84 * (1 - livePulse.contactRate / 100)}`}
                    strokeLinecap="round"
                    transform="rotate(-90 115 115)"
                    opacity="0.9"
                  />
                  {/* Answer Rate Arc (Middle: Violet) */}
                  <circle
                    cx="115"
                    cy="115"
                    r="68"
                    fill="none"
                    stroke="#8B5CF6"
                    strokeWidth="3.5"
                    strokeDasharray={`${2 * Math.PI * 68 * (livePulse.answerRate / 100)} ${2 * Math.PI * 68 * (1 - livePulse.answerRate / 100)}`}
                    strokeLinecap="round"
                    transform="rotate(-45 115 115)"
                    opacity="0.9"
                  />
                  {/* Verified Rate Arc (Inner: Gold) */}
                  <circle
                    cx="115"
                    cy="115"
                    r="52"
                    fill="none"
                    stroke="#F59E0B"
                    strokeWidth="3.5"
                    strokeDasharray={`${2 * Math.PI * 52 * (livePulse.verifiedRate / 100)} ${2 * Math.PI * 52 * (1 - livePulse.verifiedRate / 100)}`}
                    strokeLinecap="round"
                    transform="rotate(30 115 115)"
                    opacity="0.9"
                  />
                </svg>

                {/* Center Record Sticker */}
                <div className="m-signal-disc-center bg-[#8B5CF6]">
                  <div className="m-signal-disc-spindle" />
                </div>
              </div>

              {/* Float Indicators */}
              <div className="absolute top-1/2 left-[-16px] -translate-y-1/2 bg-[#18181B] border border-[var(--m-border)] px-2.5 py-1 rounded shadow-sm text-center">
                <div className="text-[8px] uppercase tracking-wider text-[var(--m-muted)] font-semibold">
                  Contact
                </div>
                <div className="text-xs font-mono font-bold text-[#10B981]">
                  {livePulse.contactRate}%
                </div>
              </div>
              <div className="absolute top-8 right-0 bg-[#18181B] border border-[var(--m-border)] px-2.5 py-1 rounded shadow-sm text-center">
                <div className="text-[8px] uppercase tracking-wider text-[var(--m-muted)] font-semibold">
                  Answers
                </div>
                <div className="text-xs font-mono font-bold text-[#8B5CF6]">
                  {livePulse.answerRate}%
                </div>
              </div>
              <div className="absolute bottom-8 left-4 bg-[#18181B] border border-[var(--m-border)] px-2.5 py-1 rounded shadow-sm text-center">
                <div className="text-[8px] uppercase tracking-wider text-[var(--m-muted)] font-semibold">
                  Verified
                </div>
                <div className="text-xs font-mono font-bold text-[#F59E0B]">
                  {livePulse.verifiedRate}%
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── SECTION 2: KPI Strip ─── */}
      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <MetricCard
          label="Reached Fans"
          tag="FAN SIGNAL"
          value={formatCompactNumber(topKpis.fansContacted.value)}
          change={topKpis.fansContacted.change}
          subtext="Audiences prompted"
          icon={Users}
        />
        <MetricCard
          label="Human Answers"
          tag="VOICE RESPONSE"
          value={formatCompactNumber(topKpis.humanAnswers.value)}
          change={topKpis.humanAnswers.change}
          subtext="Live connections made"
          icon={Headphones}
        />
        <MetricCard
          label="Verified Actions"
          tag="ACTION VERIFIED"
          value={formatCompactNumber(topKpis.verifiedEngagements.value)}
          change={topKpis.verifiedEngagements.change}
          subtext="Conversions recorded"
          icon={ShieldCheck}
        />
        <MetricCard
          label="Pre-Saves"
          tag="CONVERSION"
          value={formatCompactNumber(topKpis.preSaves.value)}
          change={topKpis.preSaves.change}
          subtext="Spotify/Apple Music saves"
          icon={CheckCircle2}
        />
        <MetricCard
          label="Cost / Pre-Save"
          tag="EFFICIENCY"
          value={formatCurrency(topKpis.costPerPreSave.value)}
          change={topKpis.costPerPreSave.change}
          subtext="Target acquisition cost"
          icon={DollarSign}
          trendType="negative-is-good" // Decreases in CPA are positive!
        />
        <MetricCard
          label="Proof Records"
          tag="LEDGER PROOF"
          value={formatCompactNumber(topKpis.proofCaptured.value)}
          change={topKpis.proofCaptured.change}
          subtext="Verbatims & audio locked"
          icon={FileText}
        />
      </section>

      {/* ─── SECTION 3: Stepped Fan Journey Path ─── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between px-1">
          <span className="text-[10px] font-bold tracking-widest text-[var(--m-muted)] uppercase">
            Stepped Fan Journey path
          </span>
          <span className="text-[10px] font-mono text-[var(--m-muted)] bg-[var(--m-surface-2)] border border-[var(--m-border-2)] px-2 py-0.5 rounded">
            Campaign Mode: AI Dialing
          </span>
        </div>

        <div className="flex flex-col lg:flex-row items-stretch gap-2 w-full">
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
              <React.Fragment key={stage.label}>
                <div className="flex-1 bg-[var(--m-surface)] border border-[var(--m-border-2)] rounded-xl p-4 flex flex-col justify-between min-h-[110px] hover:border-[var(--m-border)] transition-colors">
                  <div className="flex justify-between items-start">
                    <span className="text-[10px] font-mono text-[var(--m-dim)]">0{i + 1}</span>
                    <span className="text-[10px] font-mono font-bold text-[var(--m-muted)] bg-[var(--m-surface-2)] px-1.5 py-0.5 rounded">
                      {stage.percentage.toFixed(1)}%
                    </span>
                  </div>

                  <div className="mt-2 space-y-0.5">
                    <div className="text-[10px] uppercase font-bold text-[var(--m-muted)] tracking-wider">
                      {stage.label}
                    </div>
                    <div className="text-xl font-bold font-mono text-[var(--m-text)]">
                      {formatCompactNumber(stage.count)}
                    </div>
                  </div>

                  <div className="mt-2">
                    <div className="text-[9px] italic text-[var(--m-dim)] leading-relaxed">
                      {meanings[stage.label] || stage.label}
                    </div>
                    <div className="h-1 w-full bg-[var(--m-surface-2)] rounded-full overflow-hidden mt-1.5">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${stage.percentage}%`, backgroundColor: stage.color }}
                      />
                    </div>
                  </div>
                </div>

                {/* Drop-off indicator connector with dashed line behind */}
                {i < funnelData.length - 1 && (
                  <div className="relative flex lg:flex-col items-center justify-center py-3 lg:py-0 px-2 lg:px-0 min-w-[36px] lg:min-w-0 min-h-[32px] lg:min-h-full shrink-0">
                    {/* Dashed Line */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      {/* Vertical line on mobile/tablet, Horizontal line on desktop */}
                      <div className="w-px lg:w-full h-full lg:h-px border-l lg:border-l-0 lg:border-t border-dashed border-[var(--m-border)] opacity-50" />
                    </div>
                    {/* Badge on top */}
                    <span className="relative z-10 text-[9px] font-mono font-bold text-[var(--m-danger)] bg-[var(--m-bg)] border border-[var(--m-danger)]/20 px-1.5 py-0.5 rounded whitespace-nowrap shadow-xs">
                      -{(((stage.count - funnelData[i + 1].count) / stage.count) * 100).toFixed(0)}%
                    </span>
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </section>

      {/* ─── SECTION 4: Timeline Chart & Section 5: Segment Heat ─── */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Live Campaign Movement */}
        <div className="lg:col-span-2 m-card p-6 flex flex-col justify-between bg-[var(--m-surface)]">
          <div className="space-y-4 mb-4">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div className="space-y-1">
                <h2 className="m-section-title">
                  <Activity className="h-4 w-4 text-[var(--m-accent)]" /> Live Campaign Movement
                </h2>
                <p className="m-section-subtitle">
                  Visual attribution metrics mapping answer response rates and action rate surges.
                </p>
              </div>

              {/* Legend Badges */}
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[var(--m-accent-dim)] text-[var(--m-accent)] border border-[var(--m-accent)]/10">
                  {livePulse.answerRate}% Answers
                </span>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[var(--m-accent-2-dim)] text-[var(--m-accent-2)] border border-[var(--m-accent-2)]/10">
                  {livePulse.verifiedRate}% Actions
                </span>
              </div>
            </div>

            <p className="text-xs text-[var(--m-text-2)] bg-[var(--m-surface-2)] p-3 rounded-lg border border-[var(--m-border-2)] leading-relaxed">
              <strong>Daily Insight:</strong> verified activations peaked on April 22 following the North American Tour On-Sale launch, showing an 18.4% conversion rate surge among segment cohorts.
            </p>
          </div>

          <div className="h-[240px] w-full mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={campaignTimeSeries}
                margin={{ top: 10, right: 10, left: -15, bottom: 0 }}
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
                  stroke="rgba(9, 9, 11, 0.05)"
                />
                <XAxis
                  dataKey="date"
                  stroke="rgba(9, 9, 11, 0.15)"
                  tick={{ fontSize: 10, fill: '#71717A', fontWeight: 500 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  stroke="rgba(9, 9, 11, 0.15)"
                  tick={{ fontSize: 10, fill: '#71717A', fontWeight: 500 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#FFFFFF',
                    border: '1px solid rgba(9, 9, 11, 0.08)',
                    borderRadius: '8px',
                    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.04)',
                  }}
                  itemStyle={{ fontSize: '11px', color: '#09090B' }}
                  labelStyle={{
                    fontSize: '10px',
                    color: '#71717A',
                    fontWeight: '700',
                    marginBottom: '4px',
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
          </div>
        </div>

        {/* Audience Heat Board */}
        <div className="m-card p-6 flex flex-col justify-between bg-[var(--m-surface)]">
          <div className="space-y-1 mb-6">
            <h2 className="m-section-title">
              <Flame className="h-4 w-4 text-[var(--m-warning)]" /> Audience Heat Board
            </h2>
            <p className="m-section-subtitle">Ranked target cohorts by engagement scores and actions.</p>
          </div>

          <div className="space-y-4 flex-1 justify-center flex flex-col">
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
                Superfans: 'Next Action: Dispatch Early Ticket On-Sale campaign.',
                'Stream save audience': 'Next Action: Activate Album Pre-Save flow.',
                'VIP list': 'Next Action: Queue VIP Ticket Upgrade campaign.',
                'Previous merch buyers': 'Next Action: Dispatch capsule merch alert.',
                'Tour city fans': 'Next Action: Target with venue tour stop coordinates.',
                'Fan club inactive': 'Next Action: Initiate email win-back workflow.',
              };

              return (
                <div
                  key={seg.segment}
                  className="p-3 border border-[var(--m-border-2)] rounded-lg hover:border-[var(--m-border)] transition-colors space-y-2 group"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono font-bold text-[var(--m-dim)]">0{i + 1}</span>
                      <span className="text-xs font-bold text-[var(--m-text)] truncate">{seg.segment}</span>
                    </div>
                    <span className="text-xs font-mono font-bold text-[var(--m-accent-2)] bg-[var(--m-accent-2-dim)] px-1.5 py-0.5 rounded">
                      {seg.engagement}% score
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[10px] m-text-dim">
                    <span>{captions[seg.segment] || 'Target audience segment'}</span>
                    <span className="font-mono">{formatCompactNumber(seg.count)} fans</span>
                  </div>

                  <div className="h-1.5 w-full bg-[var(--m-surface-2)] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[var(--m-accent)] to-[var(--m-warning)] transition-all duration-300"
                      style={{ width: `${seg.engagement}%` }}
                    />
                  </div>

                  <div className="text-[9px] font-semibold text-[var(--m-accent)] border-t border-[var(--m-border-2)] pt-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                    {recommendations[seg.segment] || 'Next Action: Run outreach campaign.'}
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
              <ShieldCheck className="h-4 w-4 text-[var(--m-accent-2)]" /> Proof coming back from the audience
            </h2>
            <p className="m-section-subtitle">
              Verified outcomes, recording proofs, sentiment ratings, and attributed conversions.
            </p>
          </div>
          <Link href="/music-console/proof">
            <ActionButton variant="secondary" className="text-xs font-semibold py-2">
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
                  ? 'bg-[var(--m-danger)]'
                  : 'bg-[var(--m-muted)]';

            return (
              <div
                key={r.id}
                className="m-proof-card pl-6"
              >
                {/* Sentiment vertical bar indicator */}
                <div className={cn('m-proof-card-accent-bar', accentColor)} />

                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  {/* Name and campaign metadata */}
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-sm text-[var(--m-text)]">{r.fanName}</span>
                      <span className="font-mono text-xs m-text-dim">
                        xxxxxx{r.fanPhone.slice(-4)}
                      </span>
                      <SegmentBadge segment={r.segment} />
                      <span
                        className={cn(
                          'text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded border',
                          r.intent === 'high'
                            ? 'bg-[#10B981]/10 text-[#10B981] border-[#10B981]/20'
                            : r.intent === 'medium'
                              ? 'bg-[#F59E0B]/10 text-[#F59E0B] border-[#F59E0B]/20'
                              : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
                        )}
                      >
                        {r.intent} intent
                      </span>
                    </div>

                    <div className="text-xs m-text-muted flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span>Campaign: <strong className="text-[var(--m-text-2)]">{r.campaignName}</strong></span>
                      <span>•</span>
                      <span>Attributed CPA: <strong className="font-mono text-[var(--m-accent)]">{formatCurrency(r.cpaAttribution)}</strong></span>
                    </div>
                  </div>

                  {/* Actions & Proof badges */}
                  <div className="flex flex-wrap items-center justify-between sm:justify-start gap-3 w-full lg:w-auto lg:shrink-0 lg:ml-auto">
                    <div className="flex items-center gap-2 flex-wrap">
                      <ProofBadge outcome={r.outcome} verified={r.verifiedAction} />
                      <span className="text-[10px] font-mono text-[var(--m-dim)] sm:hidden">
                        {formatTimestamp(r.timestamp)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 ml-auto lg:ml-0">
                      {/* Audio Proof Toggle */}
                      {r.hasRecording && (
                        <ActionButton
                          variant={isPlaying ? 'primary' : 'secondary'}
                          onClick={() => togglePlay(r.id)}
                          className="text-xs font-semibold px-2.5 py-1.5 flex items-center gap-2 shrink-0"
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

                      {/* Transcript toggle */}
                      {r.hasTranscript && (
                        <button
                          onClick={() => toggleTranscript(r.id)}
                          className="p-2 hover:bg-[var(--m-surface-3)] rounded border border-[var(--m-border-2)] text-[var(--m-muted)] hover:text-[var(--m-text)] transition-colors flex items-center justify-center"
                          title="Verbatim Transcript"
                        >
                          <FileText className="h-3.5 w-3.5" />
                          {isExpanded ? (
                            <ChevronUp className="h-3.5 w-3.5 ml-1" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5 ml-1" />
                          )}
                        </button>
                      )}

                      <span className="text-[10px] font-mono text-[var(--m-dim)] hidden sm:inline pl-2">
                        {formatTimestamp(r.timestamp)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Simulated Audio Waveform overlay */}
                {isPlaying && (
                  <div className="mt-3 p-3 bg-[var(--m-surface)] border border-[var(--m-border-2)] rounded-lg flex items-center gap-4 animate-fadeIn">
                    <Volume2 className="h-4 w-4 text-[var(--m-accent)] animate-bounce shrink-0" />
                    <div className="flex-1 h-1 bg-[var(--m-surface-2)] rounded-full overflow-hidden relative">
                      <div className="h-full bg-[var(--m-accent)] w-1/3 animate-[pulse_2s_infinite]" />
                    </div>
                    <span className="text-[10px] font-mono text-[var(--m-muted)] shrink-0">0:14 / 1:24</span>
                  </div>
                )}

                {/* Transcript bubble blocks */}
                {isExpanded && r.transcriptSnippet && (
                  <div className="mt-4 p-4 bg-[var(--m-surface)] border border-[var(--m-border-2)] rounded-lg space-y-2 text-xs">
                    <div className="text-[9px] uppercase tracking-wider font-bold text-[var(--m-muted)] border-b border-[var(--m-border-2)] pb-1.5 mb-2">
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
