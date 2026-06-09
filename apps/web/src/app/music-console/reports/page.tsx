'use client';

import {
  BarChart3,
  CheckCircle2,
  Copy,
  FileSpreadsheet,
  FileText,
  Printer,
  ShieldCheck,
  Target,
  Users,
  Activity,
  Briefcase,
  PlayCircle,
} from 'lucide-react';
import { useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { campaignTimeSeries } from '../../../features/music/data/demo-music-data';
import { formatCompactNumber, formatCurrency } from '../../../features/music/lib/utils';

import { useToast } from '@/components/ui/use-toast';

// ─── Campaign Reports Data Mapper ───────────────────────────
interface CampaignReportData {
  id: string;
  name: string;
  artist: string;
  audienceSize: number;
  fansContacted: number;
  humanAnswers: number;
  verifiedActions: number;
  cpa: number;
  spend: number;
  sponsorRevenue: number;
  artistPayout: number;
  rpsShare: number;
  proofCaptured: number;
  optOutRate: string;
  topSegment: string;
  narrative: string;
  topSegments: { segment: string; count: number; engagement: number }[];
  topMarkets: { city: string; count: number; conversion: number }[];
  outcomes: { label: string; count: number; rate: number; spend: number; cpa: number; sponsorValue: number; artistShare: number; rpsShare: number; proof: number }[];
}

const CAMPAIGN_REPORTS: Record<string, CampaignReportData> = {
  'c-1': {
    id: 'c-1',
    name: 'Midnight Signal Pre-Save',
    artist: 'Nona Ray',
    audienceSize: 12400,
    fansContacted: 8200,
    humanAnswers: 5166,
    verifiedActions: 3616,
    cpa: 1.12,
    spend: 4050.00,
    sponsorRevenue: 12150.00,
    artistPayout: 8505.00,
    rpsShare: 3645.00,
    proofCaptured: 5100,
    optOutRate: '0.8%',
    topSegment: 'Stream Saver',
    narrative: 'The Midnight Signal campaign generated 3,616 verified fan actions from 8,200 reached fans at a $1.12 cost per verified action. Proof coverage reached 5,100 records, with Superfans producing the strongest engagement. Recommended next move: launch a VIP upsell campaign in the highest-performing tour markets.',
    topSegments: [
      { segment: 'Superfans', count: 4200, engagement: 88 },
      { segment: 'Stream save audience', count: 3800, engagement: 76 },
      { segment: 'Previous merch buyers', count: 2100, engagement: 68 },
    ],
    topMarkets: [
      { city: 'Austin', count: 1540, conversion: 78 },
      { city: 'Nashville', count: 1210, conversion: 72 },
      { city: 'Los Angeles', count: 860, conversion: 65 },
    ],
    outcomes: [
      { label: 'Pre-Save (Spotify/Apple)', count: 3616, rate: 44.1, spend: 3977.60, cpa: 1.10, sponsorValue: 10848.00, artistShare: 7593.60, rpsShare: 3254.40, proof: 3616 },
      { label: 'Feedback Completed', count: 1219, rate: 14.8, spend: 1097.10, cpa: 0.90, sponsorValue: 3047.50, artistShare: 2133.25, rpsShare: 914.25, proof: 1219 },
    ]
  },
  'c-2': {
    id: 'c-2',
    name: 'North American Tour On-Sale',
    artist: 'Jace Vale',
    audienceSize: 45000,
    fansContacted: 15000,
    humanAnswers: 9000,
    verifiedActions: 6300,
    cpa: 2.45,
    spend: 15435.00,
    sponsorRevenue: 46305.00,
    artistPayout: 32413.50,
    rpsShare: 13891.50,
    proofCaptured: 8900,
    optOutRate: '1.1%',
    topSegment: 'Tour City',
    narrative: 'The North American Tour campaign generated 6,300 verified fan actions from 15,000 reached fans at a $2.45 cost per verified action. Proof coverage reached 8,900 records, with Tour City segment producing the strongest engagement. Recommended next move: expand budget weights in Austin and Nashville markets.',
    topSegments: [
      { segment: 'Tour city fans', count: 5400, engagement: 72 },
      { segment: 'VIP list', count: 1500, engagement: 82 },
      { segment: 'Superfans', count: 1200, engagement: 88 },
    ],
    topMarkets: [
      { city: 'Austin', count: 3200, conversion: 74 },
      { city: 'Nashville', count: 2800, conversion: 69 },
      { city: 'Chicago', count: 1800, conversion: 58 },
    ],
    outcomes: [
      { label: 'Ticket Intent (Waitlist)', count: 6300, rate: 42.0, spend: 15435.00, cpa: 2.45, sponsorValue: 44100.00, artistShare: 30870.00, rpsShare: 13230.00, proof: 6300 },
      { label: 'VIP Interest', count: 1500, rate: 10.0, spend: 6750.00, cpa: 4.50, sponsorValue: 10500.00, artistShare: 7350.00, rpsShare: 3150.00, proof: 1500 },
    ]
  },
  'c-3': {
    id: 'c-3',
    name: 'Capsule Merch Drop',
    artist: 'Luma District',
    audienceSize: 5200,
    fansContacted: 5200,
    humanAnswers: 3484,
    verifiedActions: 2613,
    cpa: 1.85,
    spend: 4834.05,
    sponsorRevenue: 14502.15,
    artistPayout: 10151.50,
    rpsShare: 4350.65,
    proofCaptured: 3450,
    optOutRate: '0.9%',
    topSegment: 'Merch Buyer',
    narrative: 'The Capsule Merch Drop campaign generated 2,613 verified fan actions from 5,200 reached fans at a $1.85 cost per verified action. Proof coverage reached 3,450 records, with Previous Merch Buyers producing the strongest engagement. Recommended next move: deploy a cart recovery SMS flow targeting pending checkouts.',
    topSegments: [
      { segment: 'Previous merch buyers', count: 2100, engagement: 68 },
      { segment: 'VIP list', count: 900, engagement: 82 },
      { segment: 'Casual', count: 2200, engagement: 45 },
    ],
    topMarkets: [
      { city: 'Nashville', count: 1100, conversion: 62 },
      { city: 'New York', count: 950, conversion: 58 },
      { city: 'Los Angeles', count: 820, conversion: 54 },
    ],
    outcomes: [
      { label: 'Merch Intent (Capsule)', count: 2613, rate: 50.2, spend: 4834.05, cpa: 1.85, sponsorValue: 13065.00, artistShare: 9145.50, rpsShare: 3919.50, proof: 2613 },
      { label: 'Fan Club Reactivation', count: 890, rate: 17.1, spend: 2759.00, cpa: 3.10, sponsorValue: 4450.00, artistShare: 3115.00, rpsShare: 1335.00, proof: 890 },
    ]
  }
};

export default function MusicReportsPage() {
  const { toast } = useToast();
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('c-1');
  const [selectedDateRange, setSelectedDateRange] = useState<string>('Last 14 Days');

  const selectedData = CAMPAIGN_REPORTS[selectedCampaignId] || CAMPAIGN_REPORTS['c-1'];

  // Scale timeline chart data dynamically
  const chartData = campaignTimeSeries.map(pt => {
    const ratio = selectedData.verifiedActions / 3616;
    return {
      ...pt,
      humanAnswers: Math.round(pt.humanAnswers * ratio),
      verifiedEngagements: Math.round(pt.verifiedEngagements * ratio)
    };
  });

  // Dynamic funnel calculation
  const funnelSteps = [
    { label: 'Uploaded Fans', count: selectedData.audienceSize, percentage: 100, color: '#4c1d95' },
    { label: 'Reached Fans', count: selectedData.fansContacted, percentage: (selectedData.fansContacted / selectedData.audienceSize) * 100, color: '#6d28d9' },
    { label: 'Human Answered', count: selectedData.humanAnswers, percentage: (selectedData.humanAnswers / selectedData.audienceSize) * 100, color: '#8b5cf6' },
    { label: 'Verified Actions', count: selectedData.verifiedActions, percentage: (selectedData.verifiedActions / selectedData.audienceSize) * 100, color: '#06b6d4' },
  ];

  const handleExportPDF = () => {
    toast({
      title: 'Report PDF Compiled',
      description: `Sponsor-ready executive report PDF for "${selectedData.name}" has been prepared.`,
    });
  };

  const handleExportCSV = () => {
    toast({
      title: 'Report CSV Compiled',
      description: `Economics, segment and market datasets exported as spreadsheet for "${selectedData.name}".`,
    });
  };

  const handleCopySummary = () => {
    void navigator.clipboard.writeText(selectedData.narrative);
    toast({
      title: 'Summary Copied',
      description: 'Narrative block copied to clipboard.',
    });
  };

  return (
    <div className="space-y-3">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-[var(--m-border-2)] pb-2 mb-1.5">
        <div>
          <h1 className="text-lg font-black tracking-tight flex items-center gap-2 m-text-text uppercase">
            <Target className="h-4.5 w-4.5 m-text-accent" /> Campaign Reports
          </h1>
          <p className="text-[10px] m-text-muted mt-0.5">
            Executive reporting for fan engagement, sponsor inventory, proof capture, artist payouts, and RPS revenue share.
          </p>
        </div>
        
        <div className="flex flex-wrap items-center gap-2">
          {/* Campaign Selector */}
          <select 
            value={selectedCampaignId}
            onChange={(e) => setSelectedCampaignId(e.target.value)}
            className="bg-black/30 border border-white/10 rounded px-2.5 py-1 text-[10px] text-zinc-300 font-bold focus:outline-none focus:border-[var(--m-accent)] cursor-pointer"
          >
            {Object.values(CAMPAIGN_REPORTS).map(c => (
              <option key={c.id} value={c.id}>{c.name} ({c.artist})</option>
            ))}
          </select>

          {/* Date Selector */}
          <select
            value={selectedDateRange}
            onChange={(e) => setSelectedDateRange(e.target.value)}
            className="bg-black/30 border border-white/10 rounded px-2.5 py-1 text-[10px] text-zinc-300 font-bold focus:outline-none focus:border-[var(--m-accent)] cursor-pointer"
          >
            <option value="Last 14 Days">Last 14 Days</option>
            <option value="Last 30 Days">Last 30 Days</option>
            <option value="All Time">All Time</option>
          </select>

          <button 
            onClick={handleExportPDF}
            className="flex items-center gap-1 px-2.5 py-1 bg-zinc-900/60 border border-zinc-800 rounded text-[10px] font-bold hover:bg-zinc-850 hover:text-white transition-colors"
          >
            <Printer className="h-3 w-3" /> PDF
          </button>
          
          <button 
            onClick={handleExportCSV}
            className="flex items-center gap-1 px-2.5 py-1 bg-zinc-900/60 border border-zinc-800 rounded text-[10px] font-bold hover:bg-zinc-850 hover:text-white transition-colors"
          >
            <FileSpreadsheet className="h-3 w-3" /> CSV
          </button>

          <button 
            onClick={handleCopySummary}
            className="flex items-center gap-1 px-2.5 py-1 bg-zinc-900/60 border border-zinc-800 rounded text-[10px] font-bold hover:bg-zinc-850 hover:text-white transition-colors"
          >
            <Copy className="h-3 w-3" /> Copy Summary
          </button>

          <div className="flex items-center gap-1 px-2.5 py-1 bg-emerald-950/20 border border-emerald-800/30 rounded text-emerald-400 font-bold text-[9px] uppercase tracking-wider">
            <CheckCircle2 className="h-3 w-3" /> Sponsor Ready
          </div>
        </div>
      </div>

      {/* Executive Summary Card */}
      <div className="bg-zinc-950/50 border border-zinc-850 rounded-lg p-3.5 relative group overflow-hidden">
        <div className="absolute top-0 left-0 w-1.5 h-full bg-[var(--m-accent)]" />
        <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1.5">
          <FileText className="h-3.5 w-3.5 text-[var(--m-accent)]" /> Campaign Executive Analysis
        </h2>
        <p className="text-xs leading-relaxed text-zinc-300 font-serif italic max-w-5xl">
          &ldquo;{selectedData.narrative}&rdquo;
        </p>
      </div>

      {/* 12-Card Executive KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
        <div className="m-inset-card p-2 flex flex-col justify-between h-[52px]">
          <span className="text-[8px] font-bold m-text-muted uppercase tracking-wider block">Audience Size</span>
          <span className="text-sm font-bold text-white block mt-0.5 font-mono">{selectedData.audienceSize.toLocaleString()}</span>
        </div>
        <div className="m-inset-card p-2 flex flex-col justify-between h-[52px]">
          <span className="text-[8px] font-bold m-text-muted uppercase tracking-wider block">Fans Reached</span>
          <span className="text-sm font-bold text-white block mt-0.5 font-mono">{selectedData.fansContacted.toLocaleString()}</span>
        </div>
        <div className="m-inset-card p-2 flex flex-col justify-between h-[52px]">
          <span className="text-[8px] font-bold m-text-muted uppercase tracking-wider block">Human Answers</span>
          <span className="text-sm font-bold text-white block mt-0.5 font-mono">{selectedData.humanAnswers.toLocaleString()}</span>
        </div>
        <div className="m-inset-card p-2 flex flex-col justify-between h-[52px] border-l-2 border-l-[var(--m-accent-2)]">
          <span className="text-[8px] font-bold m-text-muted uppercase tracking-wider block">Verified Actions</span>
          <span className="text-sm font-bold text-[var(--m-accent-2)] block mt-0.5 font-mono">{selectedData.verifiedActions.toLocaleString()}</span>
        </div>
        <div className="m-inset-card p-2 flex flex-col justify-between h-[52px]">
          <span className="text-[8px] font-bold m-text-muted uppercase tracking-wider block">Cost / Action</span>
          <span className="text-sm font-bold text-white block mt-0.5 font-mono">{formatCurrency(selectedData.cpa)}</span>
        </div>
        <div className="m-inset-card p-2 flex flex-col justify-between h-[52px]">
          <span className="text-[8px] font-bold m-text-muted uppercase tracking-wider block">Campaign Spend</span>
          <span className="text-sm font-bold text-white block mt-0.5 font-mono">{formatCurrency(selectedData.spend)}</span>
        </div>
        <div className="m-inset-card p-2 flex flex-col justify-between h-[52px] border-l-2 border-l-emerald-500">
          <span className="text-[8px] font-bold m-text-muted uppercase tracking-wider block">Sponsor Revenue</span>
          <span className="text-sm font-bold text-emerald-400 block mt-0.5 font-mono">{formatCurrency(selectedData.sponsorRevenue)}</span>
        </div>
        <div className="m-inset-card p-2 flex flex-col justify-between h-[52px]">
          <span className="text-[8px] font-bold m-text-muted uppercase tracking-wider block">Artist Payout (70%)</span>
          <span className="text-sm font-bold text-white block mt-0.5 font-mono">{formatCurrency(selectedData.artistPayout)}</span>
        </div>
        <div className="m-inset-card p-2 flex flex-col justify-between h-[52px]">
          <span className="text-[8px] font-bold m-text-muted uppercase tracking-wider block">RPS Share (30%)</span>
          <span className="text-sm font-bold text-[var(--m-accent)] block mt-0.5 font-mono">{formatCurrency(selectedData.rpsShare)}</span>
        </div>
        <div className="m-inset-card p-2 flex flex-col justify-between h-[52px]">
          <span className="text-[8px] font-bold m-text-muted uppercase tracking-wider block">Proof Captured</span>
          <span className="text-sm font-bold text-white block mt-0.5 font-mono">{selectedData.proofCaptured.toLocaleString()}</span>
        </div>
        <div className="m-inset-card p-2 flex flex-col justify-between h-[52px]">
          <span className="text-[8px] font-bold m-text-muted uppercase tracking-wider block">Opt-Out Rate</span>
          <span className="text-sm font-bold text-red-400 block mt-0.5 font-mono">{selectedData.optOutRate}</span>
        </div>
        <div className="m-inset-card p-2 flex flex-col justify-between h-[52px]">
          <span className="text-[8px] font-bold m-text-muted uppercase tracking-wider block">Top Segment</span>
          <span className="text-[10px] font-bold text-white block mt-1 truncate">{selectedData.topSegment}</span>
        </div>
      </div>

      {/* 2-Column Report Body */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Left Column: Timeline, Funnel, Economics */}
        <div className="lg:col-span-2 space-y-3">
          
          {/* Timeline Chart */}
          <div className="m-card p-3 h-[210px] flex flex-col justify-between">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5 border-b border-[var(--m-border-2)] pb-1 mb-2">
              <Activity className="h-3.5 w-3.5 text-[var(--m-accent)]" /> Campaign Timeline
            </h3>
            <div className="flex-1 w-full min-h-0">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 5, right: 0, left: -25, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorAnswersRep" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#7C5CFF" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#7C5CFF" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorVerifiedRep" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#18D6A3" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#18D6A3" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148,163,184,0.06)" />
                  <XAxis dataKey="date" stroke="rgba(148,163,184,0.2)" tick={{ fontSize: 9, fill: '#475569' }} axisLine={false} tickLine={false} />
                  <YAxis stroke="rgba(148,163,184,0.2)" tick={{ fontSize: 9, fill: '#475569' }} axisLine={false} tickLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#06080D', border: '1px solid rgba(148,163,184,0.1)', borderRadius: '6px' }}
                    itemStyle={{ fontSize: '11px' }}
                    labelStyle={{ fontSize: '9px', color: '#9AA8BD', marginBottom: '3px' }}
                  />
                  <Area type="monotone" dataKey="humanAnswers" name="Human Answers" stroke="#7C5CFF" strokeWidth={1.5} fillOpacity={1} fill="url(#colorAnswersRep)" />
                  <Area type="monotone" dataKey="verifiedEngagements" name="Verified Actions" stroke="#18D6A3" strokeWidth={1.5} fillOpacity={1} fill="url(#colorVerifiedRep)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Engagement Funnel */}
          <div className="m-card p-3 flex flex-col justify-between">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5 border-b border-[var(--m-border-2)] pb-1 mb-2.5">
              <BarChart3 className="h-3.5 w-3.5 text-[var(--m-accent-2)]" /> Engagement Funnel
            </h3>
            <div className="space-y-2.5">
              {funnelSteps.map((stage) => (
                <div key={stage.label} className="flex items-center gap-4">
                  <div className="w-28 text-[10px] font-bold text-slate-400 text-right">{stage.label}</div>
                  <div className="flex-grow h-8 rounded bg-[var(--m-surface-2)] flex items-center overflow-hidden">
                    <div 
                      className="h-full flex items-center justify-end px-3 transition-all duration-550 rounded"
                      style={{ width: `${stage.percentage}%`, backgroundColor: stage.color }}
                    >
                      <span className="text-[10px] font-black text-white">
                        {stage.count.toLocaleString()}
                      </span>
                    </div>
                  </div>
                  <div className="w-10 text-right text-[10px] font-mono font-bold text-zinc-400">
                    {stage.percentage.toFixed(0)}%
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Outcome Economics Table */}
          <div className="m-card overflow-hidden">
            <div className="p-3 border-b border-[var(--m-border-2)] bg-[var(--m-surface-2)] flex justify-between items-center">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
                <FileSpreadsheet className="h-3.5 w-3.5 text-[var(--m-accent-2)]" /> Detailed Outcome Economics
              </h3>
              <span className="text-[8px] font-bold text-zinc-500 uppercase tracking-widest">Calculated Splits (70 / 30)</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs whitespace-nowrap border-collapse m-table m-dense-table">
                <thead>
                  <tr className="border-b border-white/5 bg-black/40 text-[8px] uppercase tracking-wider m-text-muted">
                    <th className="py-1 px-3">Verified Outcome</th>
                    <th className="text-right py-1 px-3">Count</th>
                    <th className="text-right py-1 px-3">Conv. Rate</th>
                    <th className="text-right py-1 px-3">Spend</th>
                    <th className="text-right py-1 px-3">CPA</th>
                    <th className="text-right py-1 px-3">Sponsor Value</th>
                    <th className="text-right py-1 px-3">Artist Share</th>
                    <th className="text-right py-1 px-3">RPS Share</th>
                    <th className="text-right py-1 px-3">Proof Logs</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedData.outcomes.map((row) => (
                    <tr key={row.label} className="border-b border-white/[0.03] hover:bg-white/[0.01] transition-colors">
                      <td className="font-bold text-white py-1.5 px-3 text-[10px]">{row.label}</td>
                      <td className="text-right font-mono py-1.5 px-3 font-semibold text-[10px]">{row.count.toLocaleString()}</td>
                      <td className="text-right font-mono py-1.5 px-3 font-semibold text-[10px] text-[var(--m-accent-2)]">{row.rate}%</td>
                      <td className="text-right font-mono py-1.5 px-3 text-zinc-400 text-[10px]">{formatCurrency(row.spend)}</td>
                      <td className="text-right font-mono py-1.5 px-3 text-white text-[10px]">{formatCurrency(row.cpa)}</td>
                      <td className="text-right font-mono py-1.5 px-3 text-emerald-400 font-bold text-[10px]">{formatCurrency(row.sponsorValue)}</td>
                      <td className="text-right font-mono py-1.5 px-3 text-zinc-300 text-[10px]">{formatCurrency(row.artistShare)}</td>
                      <td className="text-right font-mono py-1.5 px-3 text-[var(--m-accent)] text-[10px]">{formatCurrency(row.rpsShare)}</td>
                      <td className="text-right font-mono py-1.5 px-3 text-[var(--m-accent-2)] text-[10px]">{row.proof.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </div>

        {/* Right Column: Sponsor readiness, Segment, Market, Plays */}
        <div className="space-y-3">
          
          {/* Sponsor Readiness Checklist */}
          <div className="m-card p-3 bg-[var(--m-surface-2)]">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5 border-b border-[var(--m-border-2)] pb-1.5 mb-2.5">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" /> Sponsor-Readiness Checklist
            </h3>
            
            <div className="space-y-2 text-[10px] font-semibold text-zinc-300">
              <div className="flex items-center justify-between bg-black/20 p-1.5 border border-white/5 rounded">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> Proof Coverage
                </span>
                <span className="text-[9px] font-mono text-emerald-400 font-extrabold uppercase">100% Verified</span>
              </div>
              
              <div className="flex items-center justify-between bg-black/20 p-1.5 border border-white/5 rounded">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> Consent Quality
                </span>
                <span className="text-[9px] font-mono text-emerald-400 font-extrabold uppercase">TCPA Cleared</span>
              </div>
              
              <div className="flex items-center justify-between bg-black/20 p-1.5 border border-white/5 rounded">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> Attribution Completeness
                </span>
                <span className="text-[9px] font-mono text-emerald-400 font-extrabold uppercase">Active Ad Slots</span>
              </div>

              <div className="flex items-center justify-between bg-black/20 p-1.5 border border-white/5 rounded">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> Audio/Transcript Archive
                </span>
                <span className="text-[9px] font-mono text-emerald-400 font-extrabold uppercase">Archived</span>
              </div>

              <div className="flex items-center justify-between bg-black/20 p-1.5 border border-white/5 rounded">
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> Brand Safety Status
                </span>
                <span className="text-[9px] font-mono text-emerald-400 font-extrabold uppercase">Cleared</span>
              </div>
            </div>
          </div>

          {/* Segment Analysis */}
          <div className="m-card p-3 bg-[var(--m-surface-2)]">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5 border-b border-[var(--m-border-2)] pb-1.5 mb-2">
              <Users className="h-3.5 w-3.5 text-[var(--m-accent)]" /> Segment Analysis
            </h3>
            <div className="space-y-1.5">
              {selectedData.topSegments.map((seg) => (
                <div key={seg.segment} className="flex items-center justify-between bg-black/20 px-2 py-1.5 rounded border border-white/5 text-[10px] font-semibold text-zinc-300">
                  <div>
                    <div className="text-white font-bold">{seg.segment}</div>
                    <div className="text-[8px] text-zinc-550 uppercase tracking-widest mt-0.2">{formatCompactNumber(seg.count)} Reached</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-bold text-[var(--m-accent-2)] font-mono text-[11px]">{seg.engagement}%</div>
                    <div className="text-[7px] text-zinc-550 uppercase tracking-widest">Conversion</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Market Analysis */}
          <div className="m-card p-3 bg-[var(--m-surface-2)]">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5 border-b border-[var(--m-border-2)] pb-1.5 mb-2">
              <Target className="h-3.5 w-3.5 text-[var(--m-accent-2)]" /> Market Analysis
            </h3>
            <div className="space-y-1.5">
              {selectedData.topMarkets.map((m) => (
                <div key={m.city} className="flex items-center justify-between bg-black/20 px-2 py-1.5 rounded border border-white/5 text-[10px] font-semibold text-zinc-300">
                  <div>
                    <div className="text-white font-bold">{m.city} Market</div>
                    <div className="text-[8px] text-zinc-550 uppercase tracking-widest mt-0.2">{formatCompactNumber(m.count)} Actions</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-bold text-[var(--m-accent-2)] font-mono text-[11px]">{m.conversion}%</div>
                    <div className="text-[7px] text-zinc-550 uppercase tracking-widest">Rate</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recommended plays actions */}
          <div className="m-card p-3 bg-[var(--m-surface-2)] space-y-2">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5 border-b border-[var(--m-border-2)] pb-1.5 mb-1">
              <Briefcase className="h-3.5 w-3.5 text-[var(--m-warning)]" /> Recommended Next Action Plays
            </h3>
            
            <div className="grid grid-cols-1 gap-1.5">
              <button 
                onClick={() => {
                  toast({
                    title: 'VIP Pre-Sale Deployed',
                    description: `Initiated VIP Pre-Sale Voice Broadcast campaign targeting top conversion markets.`,
                  });
                }}
                className="flex items-center justify-between px-2.5 py-1.5 bg-black/40 hover:bg-black/60 border border-white/5 hover:border-[var(--m-accent)]/40 rounded text-[10px] font-bold text-white transition-all text-left"
              >
                <span>Deploy VIP Pre-Sale Play</span>
                <PlayCircle className="w-3.5 h-3.5 text-[var(--m-accent)] shrink-0" />
              </button>

              <button 
                onClick={() => {
                  toast({
                    title: 'Merchandise Drop Deployed',
                    description: `Initiated Capsule Merchandise broadcast play targeting inactive fan club segments.`,
                  });
                }}
                className="flex items-center justify-between px-2.5 py-1.5 bg-black/40 hover:bg-black/60 border border-white/5 hover:border-[var(--m-accent)]/40 rounded text-[10px] font-bold text-white transition-all text-left"
              >
                <span>Deploy Merch Drop Play</span>
                <PlayCircle className="w-3.5 h-3.5 text-[var(--m-accent)] shrink-0" />
              </button>

              <button 
                onClick={() => {
                  toast({
                    title: 'Sponsor Ad Slot Deployed',
                    description: `Allocated active sponsor ad inventory slots to Dallas & Nashville markets.`,
                  });
                }}
                className="flex items-center justify-between px-2.5 py-1.5 bg-black/40 hover:bg-black/60 border border-white/5 hover:border-emerald-500/40 rounded text-[10px] font-bold text-emerald-400 transition-all text-left"
              >
                <span>Deploy Sponsor Ad Inventory Play</span>
                <PlayCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              </button>
            </div>
          </div>

        </div>
      </div>

    </div>
  );
}
