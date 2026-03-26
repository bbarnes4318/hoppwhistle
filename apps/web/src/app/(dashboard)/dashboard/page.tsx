'use client';

import {
  Activity,
  Calendar,
  ChevronDown,
  DollarSign,
  FileText,
  Headphones,
  Phone,
  Play,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDuration, formatPhoneNumber } from '@/lib/utils';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

/* ─── Types ────────────────────────────────────────────────────── */
interface DashboardStats {
  calls: number;
  quotes: number;
  applications: number;
  premium: number;
  conversion: number;
  dateRange: { startDate: string; endDate: string };
}

interface CallRecord {
  id: string;
  callSid?: string;
  callerId?: string;
  did?: string;
  toNumber?: string;
  targetNumber?: string;
  status: string;
  duration?: number;
  connectedDuration?: number;
  converted?: boolean;
  paidOut?: boolean;
  missedCall?: boolean;
  recordingUrl?: string | null;
  revenue?: number;
  createdAt: string;
  campaign?: { name: string } | null;
  fromNumber?: { number: string } | null;
}

type DatePreset = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'custom';

/* ─── Helpers ──────────────────────────────────────────────────── */
function getDateRange(preset: DatePreset): { start: Date; end: Date } {
  const now = new Date();
  const end = now;
  let start: Date;
  switch (preset) {
    case 'day':
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;
    case 'week':
      start = new Date(now);
      start.setDate(now.getDate() - 7);
      break;
    case 'month':
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      break;
    case 'quarter':
      start = new Date(now);
      start.setMonth(now.getMonth() - 3);
      break;
    case 'year':
      start = new Date(now.getFullYear(), 0, 1);
      break;
    default:
      start = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  return { start, end };
}

function getCallResult(call: CallRecord): string {
  if (call.converted && call.paidOut) return 'Application';
  if (call.converted) return 'Quote';
  if (call.missedCall) return 'Missed';
  if (call.status === 'COMPLETED') return 'Completed';
  if (call.status === 'NO_ANSWER') return 'No Answer';
  if (call.status === 'BUSY') return 'Busy';
  if (call.status === 'FAILED') return 'Failed';
  return call.status || 'Unknown';
}

function getResultColor(result: string): string {
  switch (result) {
    case 'Application':
      return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
    case 'Quote':
      return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30';
    case 'Completed':
      return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
    case 'Missed':
    case 'No Answer':
      return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
    case 'Failed':
    case 'Busy':
      return 'bg-red-500/20 text-red-300 border-red-500/30';
    default:
      return 'bg-slate-500/20 text-slate-300 border-slate-500/30';
  }
}

/* ─── Metric Card ──────────────────────────────────────────────── */
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

/* ─── Chart Tooltip ────────────────────────────────────────────── */
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
      <p className="mb-2 font-mono text-xs text-slate-500">{label}</p>
      {payload.map(entry => (
        <p key={entry.dataKey} className="font-mono text-sm">
          <span
            className={entry.dataKey === 'outbound' ? 'text-cyan-400' : 'text-emerald-400'}
          >
            {entry.dataKey === 'outbound' ? 'Outbound' : 'Inbound'}
          </span>
          <span className="ml-3 text-slate-200">{entry.value.toLocaleString()}</span>
        </p>
      ))}
    </div>
  );
}

/* ─── Main Dashboard ───────────────────────────────────────────── */
export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [callsLoading, setCallsLoading] = useState(true);
  const [activePreset, setActivePreset] = useState<DatePreset>('month');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  // Live clock
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

  // Fetch dashboard stats
  const fetchStats = useCallback(
    async (preset: DatePreset, from?: string, to?: string) => {
      setLoading(true);
      try {
        let startDate: string;
        let endDate: string;
        if (preset === 'custom' && from && to) {
          startDate = new Date(from).toISOString();
          endDate = new Date(to + 'T23:59:59').toISOString();
        } else {
          const range = getDateRange(preset);
          startDate = range.start.toISOString();
          endDate = range.end.toISOString();
        }
        const res = await fetch(
          `${API_URL}/api/v1/dashboard/stats?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
          { credentials: 'include' }
        );
        if (res.ok) {
          const data: DashboardStats = await res.json();
          setStats(data);
        }
      } catch (error) {
        console.error('Failed to fetch dashboard stats:', error);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Fetch recent calls for table
  const fetchCalls = useCallback(async () => {
    setCallsLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/calls?limit=25`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setCalls(data.data || []);
      }
    } catch (error) {
      console.error('Failed to fetch calls:', error);
    } finally {
      setCallsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStats(activePreset);
    void fetchCalls();
  }, [fetchStats, fetchCalls, activePreset]);

  const handlePresetChange = (preset: DatePreset) => {
    setActivePreset(preset);
    setShowCustom(preset === 'custom');
    if (preset !== 'custom') {
      void fetchStats(preset);
    }
  };

  const handleCustomApply = () => {
    if (customFrom && customTo) {
      void fetchStats('custom', customFrom, customTo);
    }
  };

  // Build chart data from calls
  const chartData = useMemo(() => {
    if (calls.length === 0) return [];
    const hourMap = new Map<string, { inbound: number; outbound: number }>();
    for (let h = 0; h < 24; h++) {
      hourMap.set(h.toString().padStart(2, '0') + ':00', { inbound: 0, outbound: 0 });
    }
    calls.forEach(call => {
      const hour = new Date(call.createdAt).getHours().toString().padStart(2, '0') + ':00';
      const bucket = hourMap.get(hour);
      if (bucket) {
        if (call.status === 'OUTBOUND' || call.toNumber) {
          bucket.outbound++;
        } else {
          bucket.inbound++;
        }
      }
    });
    return Array.from(hourMap.entries()).map(([time, counts]) => ({
      time,
      inbound: counts.inbound,
      outbound: counts.outbound,
    }));
  }, [calls]);

  const presets: { key: DatePreset; label: string }[] = [
    { key: 'day', label: 'Day' },
    { key: 'week', label: 'Week' },
    { key: 'month', label: 'Month' },
    { key: 'quarter', label: 'Quarter' },
    { key: 'year', label: 'Year' },
    { key: 'custom', label: 'Custom' },
  ];

  return (
    <div className="space-y-6">
      {/* ── Header ────────────────────────────────────────────── */}
      <div className="mb-6 flex items-center justify-between border-b border-white/10 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">
            Final expense call center performance
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-3 py-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="font-mono text-xs text-emerald-400">LIVE</span>
          </div>
          <div className="rounded-md border border-white/10 bg-slate-900/40 px-3 py-1.5 font-mono text-xs text-slate-400">
            {liveClock}
          </div>
        </div>
      </div>

      {/* ── Date Range Filters ─────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <Calendar className="h-4 w-4 text-slate-500" />
        {presets.map(p => (
          <Button
            key={p.key}
            variant={activePreset === p.key ? 'default' : 'outline'}
            size="sm"
            className={
              activePreset === p.key
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-500'
                : 'border-white/10 text-slate-400 hover:text-white hover:bg-white/5'
            }
            onClick={() => handlePresetChange(p.key)}
          >
            {p.label}
            {p.key === 'custom' && <ChevronDown className="ml-1 h-3 w-3" />}
          </Button>
        ))}
        {showCustom && (
          <div className="flex items-center gap-2 ml-2">
            <Input
              type="date"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
              className="h-8 w-36 text-xs border-white/10 bg-slate-900/40"
              id="custom-from"
              name="custom-from"
            />
            <span className="text-xs text-slate-500">to</span>
            <Input
              type="date"
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
              className="h-8 w-36 text-xs border-white/10 bg-slate-900/40"
              id="custom-to"
              name="custom-to"
            />
            <Button size="sm" variant="outline" onClick={handleCustomApply} className="h-8 text-xs border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10">
              Apply
            </Button>
          </div>
        )}
      </div>

      {/* ── Metric Cards ──────────────────────────────────────── */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <MetricCard
          label="Calls"
          value={loading ? '—' : stats?.calls.toLocaleString() || '0'}
          icon={Phone}
          accentColor="emerald"
        />
        <MetricCard
          label="Quotes"
          value={loading ? '—' : stats?.quotes.toLocaleString() || '0'}
          icon={FileText}
          accentColor="cyan"
        />
        <MetricCard
          label="Applications"
          value={loading ? '—' : stats?.applications.toLocaleString() || '0'}
          icon={Headphones}
          accentColor="violet"
        />
        <MetricCard
          label="Conversion"
          value={loading ? '—' : `${stats?.conversion || 0}%`}
          icon={Activity}
          accentColor="amber"
        />
        <MetricCard
          label="Premium"
          value={loading ? '—' : `$${(stats?.premium || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
          icon={DollarSign}
          accentColor="rose"
        />
      </div>

      {/* ── Call Activity Chart ─────────────────────────────────── */}
      <div className="mb-6 rounded-lg border border-white/10 bg-slate-900/40 p-6 backdrop-blur-md">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-200">Call Activity</h2>
            <p className="text-xs text-slate-500">
              Inbound vs. outbound call volume over the selected period
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="h-2 w-6 rounded-full bg-gradient-to-r from-cyan-500 to-blue-500" />
              <span className="text-xs text-slate-400">Outbound</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-2 w-6 rounded-full bg-gradient-to-r from-emerald-500 to-teal-400" />
              <span className="text-xs text-slate-400">Inbound</span>
            </div>
          </div>
        </div>
        <div className="h-[340px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="outboundGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="inboundGrad" x1="0" y1="0" x2="0" y2="1">
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
                allowDecimals={false}
              />
              <Tooltip content={<ChartTooltip />} />
              <Area
                type="monotone"
                dataKey="outbound"
                stroke="#06b6d4"
                strokeWidth={2}
                fill="url(#outboundGrad)"
                dot={false}
                activeDot={{ r: 4, fill: '#06b6d4', stroke: '#0e1629', strokeWidth: 2 }}
              />
              <Area
                type="monotone"
                dataKey="inbound"
                stroke="#10b981"
                strokeWidth={2}
                fill="url(#inboundGrad)"
                dot={false}
                activeDot={{ r: 4, fill: '#10b981', stroke: '#0e1629', strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Call History ─────────────────────────────────────────── */}
      <div className="rounded-lg border border-white/10 bg-slate-900/40 p-6 backdrop-blur-md">
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-slate-200">Call History</h2>
          <p className="text-xs text-slate-500">Recent call activity and disposition outcomes</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/10">
                <th className="pb-3 text-left text-xs font-semibold uppercase tracking-widest text-slate-500">
                  Time
                </th>
                <th className="pb-3 text-left text-xs font-semibold uppercase tracking-widest text-slate-500">
                  Call ID
                </th>
                <th className="pb-3 text-left text-xs font-semibold uppercase tracking-widest text-slate-500">
                  From
                </th>
                <th className="pb-3 text-left text-xs font-semibold uppercase tracking-widest text-slate-500">
                  To
                </th>
                <th className="pb-3 text-left text-xs font-semibold uppercase tracking-widest text-slate-500">
                  Status
                </th>
                <th className="pb-3 text-left text-xs font-semibold uppercase tracking-widest text-slate-500">
                  Duration
                </th>
                <th className="pb-3 text-left text-xs font-semibold uppercase tracking-widest text-slate-500">
                  Result
                </th>
                <th className="pb-3 text-right text-xs font-semibold uppercase tracking-widest text-slate-500">
                  Recording
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {callsLoading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-sm text-slate-500">
                    Loading calls...
                  </td>
                </tr>
              ) : calls.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-sm text-slate-500">
                    No calls found for this period.
                  </td>
                </tr>
              ) : (
                calls.map(call => {
                  const result = getCallResult(call);
                  return (
                    <tr
                      key={call.id}
                      className="transition-colors duration-150 hover:bg-white/[0.02]"
                    >
                      <td className="py-3 pr-4 font-mono text-xs text-slate-400">
                        {new Date(call.createdAt).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="py-3 pr-4 font-mono text-xs text-slate-300">
                        {call.callSid || call.id.slice(0, 12)}
                      </td>
                      <td className="py-3 pr-4 text-sm text-slate-300">
                        {formatPhoneNumber(call.callerId || call.fromNumber?.number || '—')}
                      </td>
                      <td className="py-3 pr-4 text-sm text-slate-300">
                        {formatPhoneNumber(call.toNumber || call.targetNumber || call.did || '—')}
                      </td>
                      <td className="py-3 pr-4">
                        <Badge
                          variant="outline"
                          className={
                            call.status === 'COMPLETED'
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                              : call.status === 'IN_PROGRESS'
                                ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
                                : 'bg-slate-500/10 text-slate-400 border-slate-500/30'
                          }
                        >
                          {call.status}
                        </Badge>
                      </td>
                      <td className="py-3 pr-4 font-mono text-xs text-slate-400">
                        {call.duration ? formatDuration(call.duration) : '—'}
                      </td>
                      <td className="py-3 pr-4">
                        <Badge variant="outline" className={getResultColor(result)}>
                          {result}
                        </Badge>
                      </td>
                      <td className="py-3 text-right">
                        {call.recordingUrl ? (
                          <a
                            href={call.recordingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                          >
                            <Play className="h-3 w-3" /> Play
                          </a>
                        ) : (
                          <span className="text-xs text-slate-600">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
