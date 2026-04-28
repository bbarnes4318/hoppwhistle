'use client';

import {
 Activity,
 Calendar,
 CalendarCheck,
 ChevronDown,
 ClipboardCheck,
 FileText,
 Headphones,
 Phone,
 PhoneIncoming,
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
 totalCalls: number;
 connectedCalls: number;
 appointmentsSet: number;
 callbacksScheduled: number;
 followUpsDue: number;
 appointmentRate: number;
 dispositions: Record<string, number>;
 dateRange: { startDate: string; endDate: string };
}

/** Disposition label map (canonical → display) */
const DISPOSITION_LABELS: Record<string, string> = {
 SET_APPOINTMENT: 'Set Appointment',
 SET_CALLBACK: 'Set Callback',
 FOLLOW_UP: 'Follow-Up',
 NOT_INTERESTED: 'Not Interested',
 NOT_QUALIFIED: 'Not Qualified',
 NO_ANSWER: 'No Answer',
 WRONG_NUMBER: 'Wrong Number',
 DISCONNECTED: 'Disconnected',
};

const DISPOSITION_COLORS: Record<string, string> = {
 SET_APPOINTMENT: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
 SET_CALLBACK: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
 FOLLOW_UP: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
 NOT_INTERESTED: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
 NOT_QUALIFIED: 'bg-orange-500/10 text-orange-400 border-orange-500/30',
 NO_ANSWER: 'bg-slate-500/10 text-slate-400 border-slate-500/30',
 WRONG_NUMBER: 'bg-red-500/10 text-red-400 border-red-500/30',
 DISCONNECTED: 'bg-red-500/10 text-red-300 border-red-500/20',
};

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
 disposition?: string | null;
 dispositionNotes?: string | null;
 callSource?: string | null;
 followUpAt?: string | null;
 followUpStatus?: string | null;
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
 // Prefer disposition field from the database
 if (call.disposition) {
 return DISPOSITION_LABELS[call.disposition] || call.disposition;
 }
 // Fallback to status-based inference
 if (call.missedCall) return 'No Answer';
 if (call.status === 'COMPLETED') return 'Completed';
 if (call.status === 'NO_ANSWER') return 'No Answer';
 if (call.status === 'BUSY') return 'Busy';
 if (call.status === 'FAILED') return 'Failed';
 return call.status || 'Unknown';
}

function getResultColor(result: string): string {
 // Check if it's a known disposition with a mapped color
 for (const [key, label] of Object.entries(DISPOSITION_LABELS)) {
 if (label === result) {
 return DISPOSITION_COLORS[key] || 'bg-transparent text-muted-foreground border-border';
 }
 }
 switch (result) {
 case 'Completed':
 return 'bg-blue-500/5 text-blue-400 border-blue-500/20';
 case 'Busy':
 case 'Failed':
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
 <Calendar className="h-4 w-4 text-muted-foreground" />
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
 <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
 <KPICard
 title="Total Calls"
 value={stats?.totalCalls || 0}
 icon={Phone}
 loading={loading}
 />
 <KPICard
 title="Connected"
 value={stats?.connectedCalls || 0}
 icon={PhoneIncoming}
 loading={loading}
 />
 <KPICard
 title="Appointments"
 value={stats?.appointmentsSet || 0}
 icon={CalendarCheck}
 loading={loading}
 />
 <KPICard
 title="Callbacks"
 value={stats?.callbacksScheduled || 0}
 icon={Headphones}
 loading={loading}
 />
 <KPICard
 title="Follow-Ups Due"
 value={stats?.followUpsDue || 0}
 icon={ClipboardCheck}
 loading={loading}
 />
 <KPICard
 title="Appt. Rate"
 value={stats?.appointmentRate || 0}
 unit="%"
 icon={Activity}
 loading={loading}
 />
 </div>

 {/* ── Disposition Breakdown ──────────────────────────────── */}
 {stats?.dispositions && Object.keys(stats.dispositions).length > 0 && (
 <div className="mb-6 rounded-xl border bg-card text-card-foreground p-6 shadow-sm">
 <div className="mb-4">
 <h2 className="text-lg font-semibold text-foreground">Disposition Breakdown</h2>
 <p className="text-xs text-muted-foreground">Call outcomes for the selected period</p>
 </div>
 <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
 {Object.entries(stats.dispositions).map(([key, count]) => (
 <div key={key} className={`flex items-center justify-between rounded-lg border px-4 py-3 ${DISPOSITION_COLORS[key] || 'border-border'}`}>
 <span className="text-xs font-mono uppercase tracking-widest">{DISPOSITION_LABELS[key] || key}</span>
 <span className="text-sm font-bold font-mono">{count}</span>
 </div>
 ))}
 </div>
 </div>
 )}

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
 <th className="pb-3 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground">
 Time
 </th>
 <th className="pb-3 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground">
 Call ID
 </th>
 <th className="pb-3 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground">
 From
 </th>
 <th className="pb-3 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground">
 To
 </th>
 <th className="pb-3 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground">
 Status
 </th>
 <th className="pb-3 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground">
 Duration
 </th>
 <th className="pb-3 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground">
 Result
 </th>
 <th className="pb-3 text-right text-xs font-semibold uppercase tracking-widest text-muted-foreground">
 Recording
 </th>
 </tr>
 </thead>
 <tbody className="divide-y divide-border">
 {callsLoading ? (
 <tr>
 <td colSpan={8} className="py-12 text-center text-sm text-muted-foreground">
 Loading calls...
 </td>
 </tr>
 ) : calls.length === 0 ? (
 <tr>
 <td colSpan={8} className="py-12 text-center text-sm text-muted-foreground">
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

