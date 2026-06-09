'use client';

import {
  CheckCircle2,
  FileText,
  Headphones,
  ShieldCheck,
  Users,
  Volume2,
  Phone,
  MessageSquare,
  Play,
  TrendingUp,
  MapPin,
  Flame,
  Shield,
  Coins,
} from 'lucide-react';
import Link from 'next/link';
import React from 'react';

import { ProofBadge, StatusBadge } from '@/features/music/components';
import {
  fanCampaigns,
  funnelData,
  livePulse,
  proofRecords,
  topKpis,
  topSegmentsData,
  campaignTimeSeries,
  networkSummary,
} from '@/features/music/data/demo-music-data';
import { formatCompactNumber } from '@/features/music/lib/utils';

// Helper component to render clean micro sparklines for KPI cards
function Sparkline({ data, color = 'var(--m-accent)' }: { data: number[]; color?: string }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const height = 18;
  const width = 64;
  const points = data
    .map((val, index) => {
      const x = (index / (data.length - 1)) * width;
      const y = height - ((val - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      className="h-5 w-16 overflow-visible self-end mb-0.5 opacity-80"
      viewBox={`0 0 ${width} ${height}`}
    >
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

// Business descriptions for each funnel stage
const funnelMeanings: Record<string, string> = {
  'Uploaded Fans': 'Normalized audience list',
  Contacted: 'RPS voice engine streams initiated',
  'Human Answered': 'Human speech verified connections',
  Engaged: 'Active natural convo sustained',
  'Verified Intent': 'Explicit sponsor action opt-in',
  'Action Taken': 'API payload written to platform',
};

// Colors matching each stage in the pipeline
const funnelColors: Record<number, string> = {
  0: '#0B46D9', // signal blue
  1: '#145CFF', // royal blue
  2: '#2F7DFF', // electric blue
  3: '#38BDF8', // sky blue
  4: '#F59E0B', // gold
  5: '#10b981', // emerald
};

function getFunnelIcon(index: number) {
  switch (index) {
    case 0:
      return <Users className="h-4 w-4" style={{ color: funnelColors[0] }} />;
    case 1:
      return <Phone className="h-4 w-4" style={{ color: funnelColors[1] }} />;
    case 2:
      return <Headphones className="h-4 w-4" style={{ color: funnelColors[2] }} />;
    case 3:
      return <MessageSquare className="h-4 w-4" style={{ color: funnelColors[3] }} />;
    case 4:
      return <ShieldCheck className="h-4 w-4" style={{ color: funnelColors[4] }} />;
    case 5:
    default:
      return <CheckCircle2 className="h-4 w-4" style={{ color: funnelColors[5] }} />;
  }
}

const maskPhone = (phone: string) => {
  const parts = phone.split('-');
  if (parts.length === 3) {
    return `${parts[0]}-XXX-${parts[2]}`;
  }
  return phone;
};

export default function MusicConsolePage() {
  // Generate sparkline values from time series
  const fanInteractionsSeries = campaignTimeSeries.map(d => d.fansContacted);
  const verifiedActionsSeries = campaignTimeSeries.map(d => d.humanAnswers);
  const sponsorRevenueSeries = campaignTimeSeries.map(d => d.verifiedEngagements * 2.8);
  const artistPayoutSeries = campaignTimeSeries.map(d => d.preSaves * 3.3);
  const rpsShareSeries = campaignTimeSeries.map(d => d.preSaves * 1.4);

  return (
    <div className="space-y-6 animate-fadeIn music-console-dashboard">
      {/* ─── 1. Executive Hero Strip ─── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[var(--m-surface-2)] border border-[var(--m-border)] p-5 rounded-lg relative overflow-hidden">
        <div className="absolute right-0 top-0 h-full w-1/3 bg-gradient-to-l from-[var(--m-accent-dim)] to-transparent pointer-events-none opacity-40" />
        <div className="space-y-1 relative z-10">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl lg:text-2xl font-black tracking-tight text-[var(--m-text)] uppercase">
              RPS Network Command Center
            </h1>
            <div className="flex items-center gap-1.5 px-2.5 py-0.5 bg-[rgba(16,185,129,0.06)] border border-[rgba(16,185,129,0.15)] rounded-full text-[#10b981] text-[9px] font-bold">
              <span className="h-1.5 w-1.5 rounded-full bg-[#10b981] animate-pulse" />
              <span>NETWORK LIVE</span>
            </div>
          </div>
          <p className="text-xs text-[var(--m-muted)] font-medium italic">
            “Every call becomes a connection, campaign, and revenue opportunity.”
          </p>
        </div>
        <div className="flex items-center gap-3 relative z-10">
          <Link href="/music-console/proof">
            <button className="m-btn m-btn--secondary py-2 px-4 text-xs flex items-center gap-2 font-bold uppercase tracking-wide">
              <FileText className="h-3.5 w-3.5 text-[var(--m-muted)]" /> View Proof Records
            </button>
          </Link>
          <Link href="/music-console/campaigns">
            <button className="m-btn m-btn--primary py-2 px-4 text-xs flex items-center gap-2 font-bold bg-[var(--m-accent)] hover:bg-[#008be5] text-white uppercase tracking-wide">
              <Play className="h-3.5 w-3.5 fill-white" /> Launch Fan Campaign
            </button>
          </Link>
        </div>
      </div>

      {/* ─── 2. Row of 6 Dense Executive KPIs ─── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {/* KPI 1: Active Stations */}
        <div className="m-metric-tile relative">
          <div className="flex justify-between items-start">
            <span className="m-metric-tile-label">Active Stations</span>
            <span className="m-trend-chip m-trend-chip--positive">+12.0%</span>
          </div>
          <div className="flex items-baseline justify-between gap-1.5 mt-2">
            <div className="m-metric-tile-value">{networkSummary.activeStations}</div>
            <Sparkline data={[18, 19, 21, 20, 22, 24, 25]} color="var(--m-accent)" />
          </div>
          <div className="m-metric-tile-subtext mt-1 text-[var(--m-muted)]">Active Station DIDs</div>
        </div>

        {/* KPI 2: Fan Interactions */}
        <div className="m-metric-tile relative">
          <div className="flex justify-between items-start">
            <span className="m-metric-tile-label">Fan Interactions</span>
            <span className="m-trend-chip m-trend-chip--positive">
              +{topKpis.fansContacted.change}%
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-1.5 mt-2">
            <div className="m-metric-tile-value">
              {formatCompactNumber(networkSummary.monthlyFanInteractions)}
            </div>
            <Sparkline data={fanInteractionsSeries} color="var(--m-accent)" />
          </div>
          <div className="m-metric-tile-subtext mt-1 text-[var(--m-muted)]">
            Monthly Interactions
          </div>
        </div>

        {/* KPI 3: Verified Actions */}
        <div className="m-metric-tile relative">
          <div className="flex justify-between items-start">
            <span className="m-metric-tile-label">Verified Actions</span>
            <span className="m-trend-chip m-trend-chip--positive">
              +{topKpis.humanAnswers.change}%
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-1.5 mt-2">
            <div className="m-metric-tile-value text-emerald-400">
              {formatCompactNumber(networkSummary.verifiedActions)}
            </div>
            <Sparkline data={verifiedActionsSeries} color="#10b981" />
          </div>
          <div className="m-metric-tile-subtext mt-1 text-[var(--m-muted)]">Verified Actions Logged</div>
        </div>

        {/* KPI 4: Sponsor Revenue */}
        <div className="m-metric-tile relative">
          <div className="flex justify-between items-start">
            <span className="m-metric-tile-label">Sponsor Revenue</span>
            <span className="m-trend-chip m-trend-chip--positive">
              +{topKpis.verifiedEngagements.change}%
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-1.5 mt-2">
            <div className="m-metric-tile-value font-mono text-[var(--m-accent-gold)]">
              ${formatCompactNumber(networkSummary.sponsorRevenue)}
            </div>
            <Sparkline data={sponsorRevenueSeries} color="#dfc38c" />
          </div>
          <div className="m-metric-tile-subtext mt-1 text-[var(--m-muted)]">Total Sponsor Revenue</div>
        </div>

        {/* KPI 5: Artist Payout */}
        <div className="m-metric-tile relative">
          <div className="flex justify-between items-start">
            <span className="m-metric-tile-label">Artist Payout</span>
            <span className="m-trend-chip m-trend-chip--positive">+{topKpis.preSaves.change}%</span>
          </div>
          <div className="flex items-baseline justify-between gap-1.5 mt-2">
            <div className="m-metric-tile-value font-mono text-[var(--m-accent-gold)]">
              ${formatCompactNumber(networkSummary.artistPayout)}
            </div>
            <Sparkline data={artistPayoutSeries} color="#dfc38c" />
          </div>
          <div className="m-metric-tile-subtext mt-1 text-[var(--m-muted)] font-medium">
            Artist Payout (70%)
          </div>
        </div>

        {/* KPI 6: RPS Share */}
        <div className="m-metric-tile relative">
          <div className="flex justify-between items-start">
            <span className="m-metric-tile-label">RPS Share</span>
            <span className="m-trend-chip m-trend-chip--positive">+10.5%</span>
          </div>
          <div className="flex items-baseline justify-between gap-1.5 mt-2">
            <div className="m-metric-tile-value font-mono text-[var(--m-accent)]">
              ${formatCompactNumber(networkSummary.rpsShare)}
            </div>
            <Sparkline data={rpsShareSeries} color="var(--m-accent)" />
          </div>
          <div className="m-metric-tile-subtext mt-1 text-[var(--m-muted)]">
            RPS Network Share (30%)
          </div>
        </div>
      </div>

      {/* ─── 3. Main 2-Column Operating View ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Media Inventory Pipeline (col-span-2) */}
        <div className="lg:col-span-2 flex flex-col justify-between bg-[var(--m-surface)] border border-[var(--m-border)] p-5 rounded-lg shadow-sm">
          <div>
            <div className="m-executive-header">
              <h3 className="m-executive-title flex items-center gap-2 text-[var(--m-text)]">
                <Coins className="h-4.5 w-4.5 text-[var(--m-accent)]" /> Media Inventory Pipeline
              </h3>
              <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded uppercase font-mono tracking-wider">
                Live Funnel Tracking
              </span>
            </div>

            {/* Premium Pipeline Grid Flow */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 pt-2">
              {funnelData.map((stage, i) => (
                <div
                  key={stage.label}
                  className="p-3 bg-[var(--m-surface-2)] border border-[var(--m-border-2)] rounded-lg hover:border-[var(--m-accent)]/30 hover:bg-[var(--m-surface-3)] hover:-translate-y-0.5 transition-all duration-200 flex flex-col justify-between min-h-[110px] relative z-10 shadow-sm"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-mono font-bold text-[var(--m-muted)]">
                        0{i + 1}
                      </span>
                      {getFunnelIcon(i)}
                    </div>
                    <div className="font-extrabold text-[var(--m-text)] text-[11px] uppercase tracking-wider mt-2.5 leading-snug">
                      {stage.label}
                    </div>
                    <div className="text-[9px] text-[var(--m-muted)] leading-tight mt-1.5 font-medium">
                      {funnelMeanings[stage.label]}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-[var(--m-border-2)] mt-3 flex justify-between items-baseline">
                    <span className="font-mono text-[var(--m-text-2)] font-bold text-[11px]">
                      {formatCompactNumber(stage.count)}
                    </span>
                    <span
                      style={{ color: funnelColors[i] }}
                      className="font-mono font-black text-[10px]"
                    >
                      {stage.percentage.toFixed(0)}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Live Station Pulse (col-span-1) */}
        <div className="lg:col-span-1">
          <div className="m-card p-5 bg-[var(--m-surface)] h-full flex flex-col justify-between border-l-4 border-[var(--m-accent)] shadow-sm">
            <div className="m-executive-header">
              <h3 className="m-executive-title flex items-center gap-2 text-[var(--m-text)]">
                <Volume2 className="h-4.5 w-4.5 text-[var(--m-accent)] animate-pulse" /> Live
                Station Pulse
              </h3>
              <div className="flex items-center gap-1.5 px-2 py-0.5 bg-emerald-50 border border-emerald-150 rounded text-emerald-700 text-[9px] font-bold font-mono tracking-wider">
                DIALING
              </div>
            </div>

            <div className="space-y-3 flex-1 flex flex-col justify-center">
              <div className="flex justify-between items-center border-b border-[var(--m-border-2)] pb-2 text-xs">
                <span className="text-[var(--m-muted)] font-semibold">Active Campaign</span>
                <span className="font-bold text-[var(--m-text)] text-right max-w-[160px] truncate">
                  {livePulse.campaignName}
                </span>
              </div>
              <div className="flex justify-between items-center border-b border-[var(--m-border-2)] pb-2 text-xs">
                <span className="text-[var(--m-muted)] font-semibold">Artist Channel</span>
                <span className="font-bold text-[var(--m-text)]">{livePulse.artist}</span>
              </div>
              <div className="flex justify-between items-center border-b border-[var(--m-border-2)] pb-2 text-xs">
                <span className="text-[var(--m-muted)] font-semibold">Sponsor Target</span>
                <span className="font-semibold text-[var(--m-text-2)] text-right max-w-[160px] truncate">
                  {livePulse.segment}
                </span>
              </div>
              <div className="flex justify-between items-center border-b border-[var(--m-border-2)] pb-2 text-xs">
                <span className="text-[var(--m-muted)] font-semibold">Answer Rate</span>
                <span className="font-bold text-[var(--m-text)] font-mono">{livePulse.answerRate}%</span>
              </div>
              <div className="flex justify-between items-center border-b border-[var(--m-border-2)] pb-2 text-xs">
                <span className="text-[var(--m-muted)] font-semibold">Verified Action Rate</span>
                <span className="font-bold text-emerald-600 font-mono">
                  {livePulse.verifiedRate}%
                </span>
              </div>
              <div className="flex justify-between items-center border-b border-[var(--m-border-2)] pb-2 text-xs">
                <span className="text-[var(--m-muted)] font-semibold">Cost per Action (CPVA)</span>
                <span className="font-bold text-[#D97706] font-mono">
                  ${livePulse.cpa.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between items-center text-xs">
                <span className="text-[var(--m-muted)] font-semibold">Proof Captured</span>
                <div className="flex items-center gap-2">
                  <div className="m-equalizer shrink-0">
                    <span className="m-equalizer-bar bg-[var(--m-accent)]" />
                    <span className="m-equalizer-bar bg-[var(--m-accent)]" />
                    <span className="m-equalizer-bar bg-[var(--m-accent)]" />
                  </div>
                  <span className="font-bold text-[var(--m-text)] font-mono">
                    {formatCompactNumber(7750)}
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-[var(--m-border-2)] space-y-2">
              <div className="text-[8px] font-black uppercase text-[var(--m-accent)] tracking-widest font-mono">
                Next Recommended Action
              </div>
              <button className="w-full py-2 bg-[var(--m-accent)] text-white text-xs font-bold hover:bg-[#008be5] rounded tracking-wider uppercase transition-colors">
                DEPLOY TOUR TICKETING CAMPAIGN
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ─── 4. Bottom Row: Campaigns, Markets, and Proof Stream ─── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Top Campaigns Table */}
        <div className="m-card p-5 bg-[var(--m-surface)] shadow-sm">
          <div className="m-executive-header">
            <h3 className="m-executive-title flex items-center gap-1.5 text-[var(--m-text)]">
              <TrendingUp className="h-4.5 w-4.5 text-[var(--m-accent)]" /> Active Fan Stations
            </h3>
            <span className="text-[9px] font-bold text-[var(--m-muted)] font-mono">5 STATIONS</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs whitespace-nowrap border-collapse m-dense-table">
              <thead>
                <tr className="border-b border-[var(--m-border-2)] text-[9px] uppercase tracking-wider m-text-muted">
                  <th className="py-2.5 font-bold">Campaign / Artist</th>
                  <th className="py-2.5 font-bold">Status</th>
                  <th className="py-2.5 font-bold text-right">Yield</th>
                  <th className="py-2.5 font-bold text-right">CPVA</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--m-border-2)]">
                {fanCampaigns.slice(0, 5).map(camp => (
                  <tr key={camp.id} className="hover:bg-black/[0.015] transition-colors">
                    <td className="py-2.5">
                      <div
                        className="font-bold text-[var(--m-text)] max-w-[130px] truncate"
                        title={camp.name}
                      >
                        {camp.name}
                      </div>
                      <div className="text-[10px] text-[var(--m-muted)] mt-0.5">{camp.artist}</div>
                    </td>
                    <td className="py-2.5">
                      <StatusBadge status={camp.status} className="text-[8px]" />
                    </td>
                    <td className="py-2.5 text-right font-mono font-bold text-[var(--m-text-2)]">
                      {formatCompactNumber(camp.verifiedEngagements)}
                    </td>
                    <td className="py-2.5 text-right font-mono font-bold text-[#D97706]">
                      {camp.cpa > 0 ? `$${camp.cpa.toFixed(2)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Sponsor Cohort Markets */}
        <div className="m-card p-5 bg-[var(--m-surface)] shadow-sm">
          <div className="m-executive-header">
            <h3 className="m-executive-title flex items-center gap-1.5 text-[var(--m-text)]">
              <MapPin className="h-4.5 w-4.5 text-[var(--m-accent)]" /> Sponsor Cohorts
            </h3>
            <span className="text-[9px] font-bold text-[var(--m-accent-2)] font-mono">
              TOP PERFORMANCE
            </span>
          </div>

          <div className="space-y-3.5">
            {topSegmentsData.slice(0, 4).map((seg, i) => (
              <div
                key={seg.segment}
                className="space-y-1.5 bg-[var(--m-surface-2)] p-2.5 border border-[var(--m-border-2)] rounded-lg"
              >
                <div className="flex justify-between items-center text-xs">
                  <div className="flex items-center gap-2 font-bold text-[var(--m-text)]">
                    <span className="w-4 h-4 flex items-center justify-center border border-[var(--m-border-2)] rounded bg-[var(--m-surface-3)] text-[9px] font-mono text-[var(--m-muted)]">
                      {i + 1}
                    </span>
                    <span className="max-w-[120px] truncate" title={seg.segment}>
                      {seg.segment}
                    </span>
                  </div>
                  <span className="text-[10px] font-bold text-emerald-600 font-mono">
                    {seg.engagement}% Yield
                  </span>
                </div>

                <div className="space-y-1">
                  <div className="h-1.5 w-full bg-[var(--m-surface-3)] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full"
                      style={{ width: `${seg.engagement}%` }}
                    />
                  </div>
                  <div className="text-[9px] text-[var(--m-muted)] font-semibold font-mono">
                    Capacity: {formatCompactNumber(seg.count)} Fans
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Live Proof Stream Preview */}
        <div className="m-card p-5 bg-[var(--m-surface)] shadow-sm">
          <div className="m-executive-header">
            <h3 className="m-executive-title flex items-center gap-1.5 text-[var(--m-text)]">
              <Flame className="h-4.5 w-4.5 text-[var(--m-accent)] animate-pulse" /> Live Proof
              Stream
            </h3>
            <Link
              href="/music-console/proof"
              className="text-[10px] text-[var(--m-accent)] hover:underline font-bold font-mono uppercase tracking-wider"
            >
              View All
            </Link>
          </div>

          <div className="space-y-3">
            {proofRecords.slice(0, 3).map(r => (
              <div
                key={r.id}
                className="p-2.5 bg-[var(--m-surface-2)] border border-[var(--m-border-2)] rounded-lg hover:border-[var(--m-accent)]/30 hover:bg-[var(--m-surface-3)] transition-colors flex items-center justify-between gap-3 text-xs"
              >
                <div className="min-w-0">
                  <div className="font-bold text-[var(--m-text)] truncate">{r.fanName}</div>
                  <div className="text-[9px] text-[var(--m-muted)] mt-0.5 font-mono font-medium">
                    {new Date(r.timestamp).toLocaleTimeString('en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}{' '}
                    • {maskPhone(r.fanPhone)}
                  </div>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <ProofBadge
                    outcome={r.outcome}
                    verified={r.verifiedAction}
                    className="px-1.5 py-0.5 text-[8px]"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ─── 5. Investor Narrative Card ─── */}
      <div className="border border-amber-200 bg-amber-50 p-4 rounded-lg flex items-start gap-3 mt-6 shadow-xs">
        <Shield className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <h4 className="text-xs font-bold text-amber-900 uppercase tracking-wider">
            Why This Matters (Investor Context)
          </h4>
          <p className="text-xs text-amber-800 leading-relaxed font-medium">
            RPS turns artist fanbases into measurable media inventory. Every verified call creates
            proof, attribution, and sponsor-ready reporting.
          </p>
        </div>
      </div>
    </div>
  );
}
