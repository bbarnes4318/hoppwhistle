'use client';

import {
 Activity,
 Calendar,
 CalendarCheck,
 ChevronDown,
 ClipboardCheck,
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

import { useRouter } from 'next/navigation';

import { KPICard } from '@/components/dashboard/kpi-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/use-auth';
import { apiClient } from '@/lib/api';
import { formatDuration, formatPhoneNumber, cn } from '@/lib/utils';
import { CompactPageShell, CompactPageHeader, DenseCard } from '@/components/layout/compact-layout';

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

import {
 DISPOSITION_LABELS,
 DISPOSITION_COLORS,
} from '@hopwhistle/shared';

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
 answeredAt?: string | null;
 endedAt?: string | null;
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
 if (call.disposition) {
 return DISPOSITION_LABELS[call.disposition] || call.disposition;
 }
 if (call.missedCall) return 'No Answer';
 if (call.status === 'COMPLETED') return 'Completed';
 if (call.status === 'NO_ANSWER') return 'No Answer';
 if (call.status === 'BUSY') return 'Busy';
 if (call.status === 'FAILED') return 'Failed';
 return call.status || 'Unknown';
}

function getResultColor(result: string): string {
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
  const router = useRouter();
  const { user, isPublisherOnly, isBuyerOnly, isAgentOnly, loading: authLoading } = useAuth();

  useEffect(() => {
    if (authLoading) return;
    if (!user) return;

    if (isPublisherOnly) {
      router.replace('/publisher/dashboard');
    } else if (isBuyerOnly) {
      router.replace('/buyer/dashboard');
    } else if (isAgentOnly) {
      router.replace('/call-center');
    }
  }, [user, isPublisherOnly, isBuyerOnly, isAgentOnly, authLoading, router]);

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
    <CompactPageShell>
      <CompactPageHeader
        title="Dashboard"
        subtitle="Final expense call center performance"
        icon={Activity}
      >
        <div className="flex items-center gap-2 rounded-md border bg-card px-2 py-1">
          <span className="relative flex h-2 w-2">
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500/80" />
          </span>
          <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest">Live Connect</span>
        </div>
        <div className="rounded-md border bg-card px-2 py-1 font-mono text-[10px] text-muted-foreground">
          {liveClock}
        </div>
      </CompactPageHeader>

      {/* Date Range Filters */}
      <div className="flex flex-wrap items-center gap-1.5 flex-shrink-0">
        <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
        {presets.map(p => (
          <Button
            key={p.key}
            variant={activePreset === p.key ? 'default' : 'outline'}
            size="sm"
            className={cn(
              "h-7 text-xs px-2.5",
              activePreset === p.key
                ? 'bg-primary text-primary-foreground border-primary hover:bg-primary/90'
                : 'border-border text-muted-foreground hover:text-foreground hover:bg-accent'
            )}
            onClick={() => handlePresetChange(p.key)}
          >
            {p.label}
            {p.key === 'custom' && <ChevronDown className="ml-1 h-3 w-3" />}
          </Button>
        ))}
        {showCustom && (
          <div className="flex items-center gap-1.5 ml-1.5">
            <Input
              type="date"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
              className="h-7 w-32 text-xs border-border bg-background px-2"
              id="custom-from"
              name="custom-from"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <Input
              type="date"
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
              className="h-7 w-32 text-xs border-border bg-background px-2"
              id="custom-to"
              name="custom-to"
            />
            <Button size="sm" variant="outline" onClick={handleCustomApply} className="h-7 text-xs border-border text-muted-foreground hover:bg-accent px-2">
              Apply
            </Button>
          </div>
        )}
      </div>

      {/* Metric Cards (KPIs) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 flex-shrink-0">
        <KPICard
          title="Total Calls"
          value={stats?.totalCalls || 0}
          icon={Phone}
          loading={loading}
          className="py-2.5"
        />
        <KPICard
          title="Connected"
          value={stats?.connectedCalls || 0}
          icon={PhoneIncoming}
          loading={loading}
          className="py-2.5"
        />
        <KPICard
          title="Appointments"
          value={stats?.appointmentsSet || 0}
          icon={CalendarCheck}
          loading={loading}
          className="py-2.5"
        />
        <KPICard
          title="Callbacks"
          value={stats?.callbacksScheduled || 0}
          icon={Headphones}
          loading={loading}
          className="py-2.5"
        />
        <KPICard
          title="Follow-Ups Due"
          value={stats?.followUpsDue || 0}
          icon={ClipboardCheck}
          loading={loading}
          className="py-2.5"
        />
        <KPICard
          title="Appt. Rate"
          value={stats?.appointmentRate || 0}
          unit="%"
          icon={Activity}
          loading={loading}
          className="py-2.5"
        />
      </div>

      {/* Main Grid: Left Side (Chart & Dispositions) & Right Side (Call History) */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 flex-1 min-h-0 overflow-hidden">
        {/* Left Side: Chart & Dispositions */}
        <div className="lg:col-span-3 flex flex-col gap-3 min-h-0 overflow-hidden">
          <DenseCard title="Call Activity" className="flex-1 min-h-0">
            <div className="h-full flex flex-col">
              <div className="flex items-center justify-between mb-2 flex-shrink-0">
                <p className="text-[10px] text-muted-foreground leading-none">
                  Inbound vs. outbound call volume
                </p>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1">
                    <div className="h-1.5 w-4 rounded-full bg-cyan-500" />
                    <span className="text-[10px] text-muted-foreground">Outbound</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="h-1.5 w-4 rounded-full bg-primary" />
                    <span className="text-[10px] text-muted-foreground">Inbound</span>
                  </div>
                </div>
              </div>
              <div className="flex-1 min-h-0 w-full relative">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
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
                    <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="4 4" opacity={0.3} />
                    <XAxis
                      dataKey="time"
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 9, fontFamily: 'monospace' }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 9, fontFamily: 'monospace' }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                    />
                    <Tooltip content={<ChartTooltip />} cursor={{ fill: 'hsl(var(--border))', opacity: 0.1 }} />
                    <Area
                      type="step"
                      dataKey="outbound"
                      stroke="hsl(var(--border))"
                      strokeWidth={1}
                      fill="url(#outboundGrad)"
                      dot={false}
                    />
                    <Area
                      type="step"
                      dataKey="inbound"
                      stroke="hsl(var(--muted-foreground))"
                      strokeWidth={1.5}
                      fill="url(#inboundGrad)"
                      dot={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </DenseCard>

          {stats?.dispositions && Object.keys(stats.dispositions).length > 0 && (
            <DenseCard title="Disposition Breakdown" className="flex-shrink-0">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {Object.entries(stats.dispositions).map(([key, count]) => (
                  <div key={key} className={cn(
                    "flex items-center justify-between rounded border p-2",
                    DISPOSITION_COLORS[key] || 'border-border'
                  )}>
                    <span className="text-[10px] font-mono uppercase tracking-wider truncate mr-2">
                      {DISPOSITION_LABELS[key] || key}
                    </span>
                    <span className="text-xs font-bold font-mono">{count}</span>
                  </div>
                ))}
              </div>
            </DenseCard>
          )}
        </div>

        {/* Right Side: Call History Ledger */}
        <DenseCard title="Call History" className="lg:col-span-2 flex flex-col min-h-0 overflow-hidden">
          <div className="flex-grow min-h-0 overflow-auto">
            <table className="w-full text-left table-dense">
              <thead>
                <tr className="border-b border-border">
                  <th className="pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Time</th>
                  <th className="pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">From/To</th>
                  <th className="pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Duration</th>
                  <th className="pb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {callsLoading ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-xs text-muted-foreground">Loading calls...</td>
                  </tr>
                ) : calls.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-xs text-muted-foreground">No calls found.</td>
                  </tr>
                ) : (
                  calls.slice(0, 15).map(call => {
                    const result = getCallResult(call);
                    return (
                      <tr key={call.id} className="transition-colors hover:bg-muted/30">
                        <td className="py-1.5 font-mono text-[10px] text-muted-foreground">
                          {new Date(call.createdAt).toLocaleString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                            hour12: false,
                          })}
                        </td>
                        <td className="py-1.5 font-mono text-[10px] text-foreground">
                          <div className="flex flex-col">
                            <span>{formatPhoneNumber(call.callerId || call.fromNumber?.number || '—')}</span>
                            <span className="text-muted-foreground text-[9px]">{formatPhoneNumber(call.toNumber || call.targetNumber || call.did || '—')}</span>
                          </div>
                        </td>
                        <td className="py-1.5 font-mono text-[10px] text-muted-foreground">
                          {(() => {
                            const dur = call.connectedDuration || call.duration;
                            if (dur) return formatDuration(dur);
                            return '—';
                          })()}
                        </td>
                        <td className="py-1.5">
                          <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0", getResultColor(result))}>
                            {result}
                          </Badge>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </DenseCard>
      </div>
    </CompactPageShell>
  );
}
