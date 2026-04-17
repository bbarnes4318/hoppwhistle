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

import { KPICard } from '@/components/dashboard/kpi-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiClient } from '@/lib/api';
import { formatDuration, formatPhoneNumber } from '@/lib/utils';

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
 recordingStatus?: string | null;
 primaryRecordingId?: string | null;
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
 return 'bg-emerald-500/5 text-emerald-400 border-emerald-500/20';
 case 'Quote':
 return 'bg-cyan-500/5 text-cyan-400 border-cyan-500/20';
 case 'Completed':
 return 'bg-blue-500/5 text-blue-400 border-blue-500/20';
 case 'Missed':
 case 'No Answer':
 return 'bg-amber-500/5 text-amber-400 border-amber-500/20';
 case 'Failed':
 case 'Busy':
 return 'bg-red-500/5 text-red-400 border-red-500/20';
 default:
 return 'bg-transparent text-muted-foreground border-border';
 }
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
 <div className="rounded-lg border bg-card text-card-foreground px-4 py-3 shadow-md">
 <p className="mb-2 font-mono text-xs text-muted-foreground">{label}</p>
 {payload.map(entry => (
 <p key={entry.dataKey} className="font-mono text-sm">
 <span className="text-muted-foreground uppercase text-xs">
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
 setLiveClock(now.toLocaleTimeString('en-US', { hour12: false }));
 };
 tick();
 const id = setInterval(tick, 1000);
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
 const response = await apiClient.get<DashboardStats>(
 `/api/v1/dashboard/stats?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`
 );
 if (response.data) {
 setStats(response.data);
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
 const response = await apiClient.get<{ data: CallRecord[]; meta: { totalPages: number } }>(
 '/api/v1/calls?limit=25'
 );
 if (response.data) {
 setCalls(response.data.data || []);
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
 <div className="mb-6 flex items-center justify-between border-b pb-4">
 <div>
 <h1 className="text-2xl font-bold tracking-tight text-foreground">Dashboard</h1>
 <p className="mt-1 text-sm text-muted-foreground">
 Final expense call center performance
 </p>
 </div>
 <div className="flex items-center gap-3">
 <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-1.5">
 <span className="relative flex h-2 w-2">
 <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500/80" />
 </span>
 <span className="font-mono text-xs text-muted-foreground uppercase tracking-widest">Live Connect</span>
 </div>
 <div className="rounded-md border bg-card px-3 py-1.5 font-mono text-xs text-muted-foreground">
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
 ? 'bg-primary text-primary-foreground border-primary hover:bg-primary/90'
 : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent'
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
 className="h-8 w-36 text-xs border-border bg-background"
 id="custom-from"
 name="custom-from"
 />
 <span className="text-xs text-muted-foreground">to</span>
 <Input
 type="date"
 value={customTo}
 onChange={e => setCustomTo(e.target.value)}
 className="h-8 w-36 text-xs border-border bg-background"
 id="custom-to"
 name="custom-to"
 />
 <Button size="sm" variant="outline" onClick={handleCustomApply} className="h-8 text-xs border-border text-muted-foreground hover:bg-accent">
 Apply
 </Button>
 </div>
 )}
 </div>

 {/* ── Metric Cards ──────────────────────────────────────── */}
 <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
 <KPICard
 title="Calls"
 value={stats?.calls || 0}
 icon={Phone}
 loading={loading}
 />
 <KPICard
 title="Quotes"
 value={stats?.quotes || 0}
 icon={FileText}
 loading={loading}
 />
 <KPICard
 title="Applications"
 value={stats?.applications || 0}
 icon={Headphones}
 loading={loading}
 />
 <KPICard
 title="Conversion"
 value={stats?.conversion || 0}
 unit="%"
 icon={Activity}
 loading={loading}
 />
 <KPICard
 title="Premium"
 value={`$${(stats?.premium || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
 icon={DollarSign}
 loading={loading}
 />
 </div>

 {/* ── Call Activity Chart ─────────────────────────────────── */}
 <div className="mb-6 rounded-xl border bg-card text-card-foreground p-6 shadow-sm">
 <div className="mb-4 flex items-center justify-between">
 <div>
 <h2 className="text-lg font-semibold text-foreground">Call Activity</h2>
 <p className="text-xs text-muted-foreground">
 Inbound vs. outbound call volume over the selected period
 </p>
 </div>
 <div className="flex items-center gap-4">
 <div className="flex items-center gap-2">
 <div className="h-2 w-6 rounded-full bg-cyan-500" />
 <span className="text-xs text-muted-foreground">Outbound</span>
 </div>
 <div className="flex items-center gap-2">
 <div className="h-2 w-6 rounded-full bg-primary" />
 <span className="text-xs text-muted-foreground">Inbound</span>
 </div>
 </div>
 </div>
 <div className="h-[340px] w-full">
 <ResponsiveContainer width="100%" height="100%">
 <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
 <defs>
 <linearGradient id="outboundGrad" x1="0" y1="0" x2="0" y2="1">
 <stop offset="5%" stopColor="currentColor" stopOpacity={0.05} />
 <stop offset="95%" stopColor="currentColor" stopOpacity={0} />
 </linearGradient>
 <linearGradient id="inboundGrad" x1="0" y1="0" x2="0" y2="1">
 <stop offset="5%" stopColor="currentColor" stopOpacity={0.15} />
 <stop offset="95%" stopColor="currentColor" stopOpacity={0} />
 </linearGradient>
 </defs>
 <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="4 4" />
 <XAxis
 dataKey="time"
 tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10, fontFamily: 'monospace' }}
 axisLine={false}
 tickLine={false}
 tickMargin={10}
 />
 <YAxis
 tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10, fontFamily: 'monospace' }}
 axisLine={false}
 tickLine={false}
 width={40}
 allowDecimals={false}
 tickMargin={10}
 />
 <Tooltip content={<ChartTooltip />} cursor={{ fill: 'hsl(var(--border))', opacity: 0.1 }} />
 <Area
 type="step"
 dataKey="outbound"
 stroke="hsl(var(--border))"
 strokeWidth={1}
 fill="url(#outboundGrad)"
 dot={false}
 activeDot={{ r: 3, fill: 'hsl(var(--background))', stroke: 'hsl(var(--border))', strokeWidth: 1 }}
 />
 <Area
 type="step"
 dataKey="inbound"
 stroke="hsl(var(--muted-foreground))"
 strokeWidth={2}
 fill="url(#inboundGrad)"
 dot={false}
 activeDot={{ r: 3, fill: 'hsl(var(--background))', stroke: 'hsl(var(--muted-foreground))', strokeWidth: 2 }}
 />
 </AreaChart>
 </ResponsiveContainer>
 </div>
 </div>

 {/* ── Call History ─────────────────────────────────────────── */}
 <div className="rounded-xl border bg-card text-card-foreground p-6 shadow-sm">
 <div className="mb-4">
 <h2 className="text-lg font-semibold text-foreground">Call History</h2>
 <p className="text-xs text-muted-foreground">Recent call activity and disposition outcomes</p>
 </div>
 <div className="overflow-x-auto">
 <table className="w-full">
 <thead>
 <tr className="border-b border-border">
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
 <tbody className="divide-y divide-border">
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
 className="transition-colors duration-150 hover:bg-muted/50"
 >
 <td className="py-1.5 pr-4 font-mono text-xs text-muted-foreground">
 {new Date(call.createdAt).toLocaleString('en-US', {
 month: 'short',
 day: 'numeric',
 hour: '2-digit',
 minute: '2-digit',
 })}
 </td>
 <td className="py-1.5 pr-4 font-mono text-xs text-foreground">
 {call.callSid || call.id.slice(0, 12)}
 </td>
 <td className="py-1.5 pr-4 font-mono text-xs text-foreground">
 {formatPhoneNumber(call.callerId || call.fromNumber?.number || '—')}
 </td>
 <td className="py-1.5 pr-4 font-mono text-xs text-foreground">
 {formatPhoneNumber(call.toNumber || call.targetNumber || call.did || '—')}
 </td>
 <td className="py-1.5 pr-4">
 <Badge
 variant="outline"
 className={
 call.status === 'COMPLETED'
 ? 'bg-emerald-500/5 text-emerald-400 border-emerald-500/20'
 : call.status === 'IN_PROGRESS'
 ? 'bg-blue-500/5 text-blue-400 border-blue-500/20'
 : 'bg-transparent text-muted-foreground border-border'
 }
 >
 {call.status}
 </Badge>
 </td>
 <td className="py-1.5 pr-4 font-mono text-xs text-muted-foreground">
 {call.duration ? formatDuration(call.duration) : '—'}
 </td>
 <td className="py-1.5 pr-4">
 <Badge variant="outline" className={getResultColor(result)}>
 {result}
 </Badge>
 </td>
 <td className="py-1.5 text-right">
 {call.recordingStatus === 'READY' && call.recordingUrl ? (
 <a
 href={call.recordingUrl}
 target="_blank"
 rel="noopener noreferrer"
 className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:bg-accent transition-colors"
 >
 <Play className="h-3 w-3" /> Play
 </a>
 ) : call.recordingStatus === 'PENDING' || call.recordingStatus === 'RECORDING' || call.recordingStatus === 'PROCESSING' ? (
 <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground">
 <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
 <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
 <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
 </svg>
 {call.recordingStatus === 'PENDING' ? 'Pending' : call.recordingStatus === 'RECORDING' ? 'Recording' : 'Processing'}
 </span>
 ) : call.recordingStatus === 'FAILED' ? (
 <span className="inline-flex items-center gap-1 rounded-md border border-red-500/20 bg-red-500/5 px-2 py-1 text-xs text-red-400">
 ✕ Failed
 </span>
 ) : call.recordingUrl ? (
 <a
 href={call.recordingUrl}
 target="_blank"
 rel="noopener noreferrer"
 className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:bg-accent transition-colors"
 >
 <Play className="h-3 w-3" /> Play
 </a>
 ) : (
 <span className="text-xs text-muted-foreground/50">—</span>
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

