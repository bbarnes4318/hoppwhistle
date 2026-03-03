'use client';

import { Activity, Radio, Signal, TrendingUp, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { activeCampaignMatrix, platformTelemetry } from '@/lib/mock-telemetry-data';
import type { CampaignRecord } from '@/lib/mock-telemetry-data';

/* ─── Metric Card ───────────────────────────────────────────────── */
function MetricCard({
  label,
  value,
  icon: Icon,
  accentColor = 'emerald',
}: {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  accentColor?: 'emerald' | 'cyan' | 'amber' | 'violet' | 'rose';
}) {
  const colorMap = {
    emerald: 'text-emerald-400',
    cyan: 'text-cyan-400',
    amber: 'text-amber-400',
    violet: 'text-violet-400',
    rose: 'text-rose-400',
  };

  return (
    <div className="relative overflow-hidden rounded-lg border border-white/10 bg-slate-900/40 p-5 backdrop-blur-md transition-all duration-300 hover:border-white/20 hover:bg-slate-900/60">
      {/* Subtle glow */}
      <div className="pointer-events-none absolute -right-4 -top-4 h-24 w-24 rounded-full bg-emerald-500/5 blur-2xl" />
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-widest text-slate-500">{label}</p>
          <p className={`font-mono text-2xl font-bold tracking-tight ${colorMap[accentColor]}`}>
            {value}
          </p>
        </div>
        <div className="rounded-md border border-white/10 bg-white/5 p-2">
          <Icon className={`h-4 w-4 ${colorMap[accentColor]}`} />
        </div>
      </div>
    </div>
  );
}

/* ─── Status Chip ───────────────────────────────────────────────── */
function StatusChip({ status }: { status: CampaignRecord['status'] }) {
  if (status === 'ACTIVE_OUTREACH') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-400">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        Active
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-amber-400">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-pulse rounded-full bg-amber-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
      </span>
      Suspended
    </span>
  );
}

/* ─── Campaign Action Button ────────────────────────────────────── */
function CampaignAction({ status }: { status: CampaignRecord['status'] }) {
  if (status === 'ACTIVE_OUTREACH') {
    return (
      <button className="rounded-md border border-rose-500/40 bg-transparent px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-rose-400 transition-all duration-200 hover:border-rose-400 hover:bg-rose-500/10 hover:text-rose-300 hover:shadow-[0_0_15px_rgba(244,63,94,0.15)]">
        Halt Campaign
      </button>
    );
  }

  return (
    <button className="rounded-md border border-emerald-500/40 bg-emerald-500/15 px-4 py-1.5 text-xs font-bold uppercase tracking-widest text-emerald-400 transition-all duration-200 hover:border-emerald-400 hover:bg-emerald-500/25 hover:text-emerald-300 hover:shadow-[0_0_15px_rgba(16,185,129,0.2)]">
      Initiate Outreach
    </button>
  );
}

/* ─── Custom Chart Tooltip ──────────────────────────────────────── */
function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string }>;
  label?: string;
}) {
  if (!active || !payload) return null;
  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/95 px-4 py-3 shadow-2xl backdrop-blur-xl">
      <p className="mb-2 font-mono text-xs text-slate-500">{label} UTC</p>
      {payload.map(entry => (
        <p key={entry.dataKey} className="font-mono text-sm">
          <span
            className={entry.dataKey === 'aiOutreachVolume' ? 'text-cyan-400' : 'text-emerald-400'}
          >
            {entry.dataKey === 'aiOutreachVolume' ? 'AI Outreach' : 'Verified Listens'}
          </span>
          <span className="ml-3 text-slate-200">{entry.value.toLocaleString()}</span>
        </p>
      ))}
    </div>
  );
}

/* ─── Main Command Center ───────────────────────────────────────── */
export default function CommandCenterPage() {
  const { globalScale, liveChartData } = platformTelemetry;
  const campaigns = activeCampaignMatrix;

  // Simulated live clock
  const [liveClock, setLiveClock] = useState('');
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setLiveClock(
        now.toLocaleTimeString('en-US', { hour12: false }) +
          '.' +
          now.getMilliseconds().toString().padStart(3, '0')
      );
    };
    tick();
    const id = setInterval(tick, 67);
    return () => clearInterval(id);
  }, []);

  // Memoize chart data to avoid re-renders
  const chartData = useMemo(() => liveChartData, [liveChartData]);

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="mb-6 flex items-center justify-between border-b border-white/10 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">Command Center</h1>
          <p className="mt-1 text-sm text-slate-500">
            Global AI Outreach Telemetry &middot; DTC Music Promotion Network
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="font-mono text-xs text-emerald-400">SYSTEMS NOMINAL</span>
          </div>
          <div className="rounded-md border border-white/10 bg-slate-900/40 px-3 py-1.5 font-mono text-xs text-slate-400">
            {liveClock}
          </div>
        </div>
      </div>

      {/* ── Metric Cards ───────────────────────────────────── */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard
          label="Algorithmic Impressions"
          value={globalScale.totalAlgorithmicImpressions}
          icon={TrendingUp}
          accentColor="emerald"
        />
        <MetricCard
          label="Verified Listen Conversions"
          value={globalScale.verifiedListenConversions}
          icon={Radio}
          accentColor="cyan"
        />
        <MetricCard
          label="Concurrent AI Vectors"
          value={globalScale.concurrentAIVectors}
          icon={Zap}
          accentColor="violet"
        />
        <MetricCard
          label="Network Conversion Rate"
          value={globalScale.networkConversionRate}
          icon={Activity}
          accentColor="amber"
        />
        <MetricCard
          label="Live Listen Velocity"
          value={globalScale.liveListenVelocity}
          icon={Signal}
          accentColor="rose"
        />
      </div>

      {/* ── Live Telemetry Chart ───────────────────────────── */}
      <div className="mb-6 rounded-lg border border-white/10 bg-slate-900/40 p-6 backdrop-blur-md">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-200">Live Telemetry Feed</h2>
            <p className="text-xs text-slate-500">
              24-Hour AI Outreach Volume vs. Verified Listen Conversions
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="h-2 w-6 rounded-full bg-gradient-to-r from-cyan-500 to-blue-500" />
              <span className="text-xs text-slate-400">AI Outreach</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-6 rounded-full bg-gradient-to-r from-emerald-500 to-teal-400" />
              <span className="text-xs text-slate-400">Verified Listens</span>
            </div>
          </div>
        </div>
        <div className="h-[340px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="outreachGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="listensGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis
                dataKey="time"
                tick={{ fill: '#64748b', fontSize: 11, fontFamily: 'monospace' }}
                axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: '#64748b', fontSize: 11, fontFamily: 'monospace' }}
                axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
                tickLine={false}
                width={55}
              />
              <Tooltip content={<ChartTooltip />} />
              <Area
                type="monotone"
                dataKey="aiOutreachVolume"
                stroke="#06b6d4"
                strokeWidth={2}
                fill="url(#outreachGrad)"
                dot={false}
                activeDot={{ r: 4, fill: '#06b6d4', stroke: '#0e1629', strokeWidth: 2 }}
              />
              <Area
                type="monotone"
                dataKey="verifiedListens"
                stroke="#10b981"
                strokeWidth={2}
                fill="url(#listensGrad)"
                dot={false}
                activeDot={{ r: 4, fill: '#10b981', stroke: '#0e1629', strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Campaign Execution Matrix ──────────────────────── */}
      <div className="rounded-lg border border-white/10 bg-slate-900/40 p-6 backdrop-blur-md">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-slate-200">Campaign Execution Matrix</h2>
          <p className="text-xs text-slate-500">
            Active asset distribution vectors across label partnerships
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                <th className="pb-3 text-left text-xs font-semibold uppercase tracking-widest text-slate-500">
                  Campaign ID
                </th>
                <th className="pb-3 text-left text-xs font-semibold uppercase tracking-widest text-slate-500">
                  Verified Asset
                </th>
                <th className="pb-3 text-left text-xs font-semibold uppercase tracking-widest text-slate-500">
                  Label Entity
                </th>
                <th className="pb-3 text-left text-xs font-semibold uppercase tracking-widest text-slate-500">
                  Vector Status
                </th>
                <th className="pb-3 text-right text-xs font-semibold uppercase tracking-widest text-slate-500">
                  Execution Control
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {campaigns.map(c => (
                <tr
                  key={c.campaignId}
                  className="transition-colors duration-150 hover:bg-white/[0.02]"
                >
                  <td className="py-4 pr-4 font-mono text-sm font-medium text-slate-300">
                    {c.campaignId}
                  </td>
                  <td className="py-4 pr-4 text-sm text-slate-300">{c.verifiedAsset}</td>
                  <td className="py-4 pr-4 text-sm text-slate-400">{c.labelEntity}</td>
                  <td className="py-4 pr-4">
                    <StatusChip status={c.status} />
                  </td>
                  <td className="py-4 text-right">
                    <CampaignAction status={c.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
