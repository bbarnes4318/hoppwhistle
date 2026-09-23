'use client';

import {
  ChevronDown,
  ClipboardCheck,
  FileText,
  Headphones,
  Percent,
  Phone,
  PhoneCall,
  PhoneIncoming,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
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


import {
  EmptyState,
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  Segmented,
  SegmentedItem,
  StatTile,
} from '@/components/domain';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/use-auth';
import { usePlatformContext } from '@/hooks/use-platform-context';
import { apiClient } from '@/lib/api';
import { hasLeftConsole } from '@/lib/console-exit';
import { formatDuration, formatPhoneNumber, cn } from '@/lib/utils';

/* ─── Types ────────────────────────────────────────────────────── */
interface DashboardStats {
  totalCalls: number;
  /** Inbound, unblocked, answered. The denominator the agency is billed on. */
  deliveredCalls: number;
  /** Reached submitted state and not voided. The numerator it is paid for. */
  submittedApplications: number;
  /**
   * Applications over delivered calls, as a percentage. Null -- not zero --
   * when no calls were delivered: an agency that took calls and wrote nothing
   * is a real and serious zero, and a closed day is not that. Rendered as a
   * dash.
   */
  closingPct: number | null;
  connectedCalls: number;
  appointmentsSet: number;
  callbacksScheduled: number;
  followUpsDue: number;
  appointmentRate: number;
  dispositions: Record<string, number>;
  dateRange: { startDate: string; endDate: string };
}

import { DISPOSITION_LABELS } from '@hopwhistle/shared';

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

/*
 * Result pill colours, from the product's own contrast-checked tones rather
 * than DISPOSITION_COLORS: those are the dark console's classes (a -400 text
 * on a 10% tint), and on the light portal both the text and the border all
 * but vanish. Won business is live, a lost connection is dropped, anything
 * still owed a next step is brand, and everything else is neutral.
 */
const RESULT_TONE: Record<string, string> = {
  APPLICATION_SUBMITTED: 'bg-live-tint text-live-ink',
  VERIFIED: 'bg-live-tint text-live-ink',
  SET_APPOINTMENT: 'bg-brand-tint text-brand-ink',
  SET_CALLBACK: 'bg-brand-tint text-brand-ink',
  FOLLOW_UP: 'bg-brand-tint text-brand-ink',
  LIVE_TRANSFER: 'bg-brand-tint text-brand-ink',
  DISCONNECTED: 'bg-dropped-tint text-dropped-ink',
  WRONG_NUMBER: 'bg-dropped-tint text-dropped-ink',
};
const NEUTRAL_RESULT = 'bg-sunken text-ink-2';

function getResultColor(result: string): string {
  for (const [key, label] of Object.entries(DISPOSITION_LABELS)) {
    if (label === result) {
      return `border-transparent ${RESULT_TONE[key] ?? NEUTRAL_RESULT}`;
    }
  }
  switch (result) {
    case 'Completed':
      return 'border-transparent bg-live-tint text-live-ink';
    case 'Busy':
    case 'Failed':
      return 'border-transparent bg-dropped-tint text-dropped-ink';
    default:
      return `border-transparent ${NEUTRAL_RESULT}`;
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
    <div className="rounded-card border border-rule bg-surface px-4 py-3 shadow-pop">
      <p className="t-meta mb-2 text-ink-3">{label}</p>
      {payload.map(entry => (
        <p key={entry.dataKey} className="flex items-center justify-between gap-4 text-sm">
          <span className="t-meta text-ink-3">
            {entry.dataKey === 'outbound' ? 'Outbound' : 'Inbound'}
          </span>
          <span className="t-num font-semibold text-ink">{entry.value.toLocaleString()}</span>
        </p>
      ))}
    </div>
  );
}

/* ─── Main Dashboard ───────────────────────────────────────────── */
export default function DashboardPage() {
  const router = useRouter();
  const { user, isPublisherOnly, isBuyerOnly, isAgentOnly, loading: authLoading } = useAuth();

  /*
   * A platform operator is not one of the roles below, whatever the role list
   * says.
   *
   * `app/(dashboard)/layout.tsx` already returns early on this, with the
   * reasoning in full: an operator holds no agency roles of their own, so the
   * role redirects have nothing to say about them, and `platform.loading` is
   * read rather than `isPlatformAdmin` alone because this effect settles first
   * and a value still loading is not an answer.
   *
   * This page did not, and that asymmetry is what closed a loop on somebody. A
   * role PREVIEW replaces an operator's ADMIN/OWNER with exactly the previewed
   * role, so an operator previewing an agency as AGENT arrives here reading as
   * `isAgentOnly` -- and got sent to /call-center, the one page with no topbar
   * and therefore no "Leave preview" button. The layout let them stay; this
   * effect pushed them out. Two files disagreeing about the same principal.
   */
  const platform = usePlatformContext();

  useEffect(() => {
    if (authLoading) return;
    if (!user) return;
    if (platform.loading || platform.isPlatformAdmin) return;

    if (isPublisherOnly) {
      router.replace('/publisher/dashboard');
    } else if (isBuyerOnly) {
      router.replace('/buyer/dashboard');
    } else if (isAgentOnly && !hasLeftConsole()) {
      /*
       * An agent does not belong here by default.
       *
       * `isAgentOnly` was destructured and listed in this array and then never
       * branched on, so publishers and buyers were sent to their own portals and
       * an agent landed on the tenant-wide admin dashboard: every call the
       * agency took, every application it wrote, the whole floor's numbers. The
       * omission read as deliberate because the dependency was there.
       *
       * /call-center is where an agent works, and it is the same destination
       * `defaultDashboardPath` already names for them.
       *
       * ── Why a default must not be enforced against an explicit request ────
       *
       * The console is fullscreen: no sidebar, no topbar, one "Exit console"
       * button, and that button comes here. So this line and that button were
       * pointed at each other, and anybody holding AGENT and nothing else was
       * sealed inside the call centre -- every route they asked for bounced
       * back to it. The account that found it belonged to the owner, who had
       * been given an AGENT role and could not reach a single admin page.
       *
       * `hasLeftConsole()` is that button having been pressed. Signing in still
       * puts an agent in the console; asking to leave it now works.
       */
      router.replace('/call-center');
    }
  }, [
    user,
    isPublisherOnly,
    isBuyerOnly,
    isAgentOnly,
    authLoading,
    router,
    platform.loading,
    platform.isPlatformAdmin,
  ]);

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
  const fetchStats = useCallback(async (preset: DatePreset, from?: string, to?: string) => {
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
  }, []);

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
    <div className="page-canvas">
      <PageHeader
        description="Final expense call center performance"
        actions={
          <span className="inline-flex items-center gap-2 rounded-full border border-rule bg-surface px-3 py-1.5 shadow-card">
            <span className="relative flex h-2 w-2">
              <span className="relative inline-flex h-2 w-2 rounded-full bg-live" />
            </span>
            <span className="t-meta font-medium text-ink-2">Live Connect</span>
            <span className="t-meta tabular-nums text-ink-3">{liveClock}</span>
          </span>
        }
      />

      {/* Date Range Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Segmented>
          {presets.map(p => (
            <SegmentedItem
              key={p.key}
              active={activePreset === p.key}
              onClick={() => handlePresetChange(p.key)}
            >
              {p.label}
              {p.key === 'custom' && <ChevronDown className="h-3.5 w-3.5" />}
            </SegmentedItem>
          ))}
        </Segmented>
        {showCustom && (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="date"
              value={customFrom}
              onChange={e => setCustomFrom(e.target.value)}
              className="h-9 w-40"
              id="custom-from"
              name="custom-from"
            />
            <span className="t-meta text-ink-3">to</span>
            <Input
              type="date"
              value={customTo}
              onChange={e => setCustomTo(e.target.value)}
              className="h-9 w-40"
              id="custom-to"
              name="custom-to"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={handleCustomApply}
            >
              Apply
            </Button>
          </div>
        )}
      </div>

      {/* Metric Cards (KPIs) */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="Total Calls"
          value={stats?.totalCalls || 0}
          icon={PhoneCall}
          loading={loading}
        />
        <StatTile
          label="Delivered"
          value={stats?.deliveredCalls || 0}
          icon={PhoneIncoming}
          loading={loading}
        />
        <StatTile
          label="Applications"
          value={stats?.submittedApplications || 0}
          icon={FileText}
          loading={loading}
        />
        <StatTile
          label="Callbacks"
          value={stats?.callbacksScheduled || 0}
          icon={Headphones}
          loading={loading}
        />
        <StatTile
          label="Follow-Ups Due"
          value={stats?.followUpsDue || 0}
          icon={ClipboardCheck}
          loading={loading}
        />
        {/* The number that sets the agency's price. `??` and not `||`: a real
            0% must render as 0, and only a null -- no delivered calls at all
            -- becomes the dash. */}
        <StatTile
          label="Closing %"
          value={stats?.closingPct ?? '—'}
          unit={stats?.closingPct == null ? undefined : '%'}
          icon={Percent}
          loading={loading}
        />
      </div>

      {/* Main Grid: Call Activity (2/3) & Call History (1/3) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Panel className="min-w-0 lg:col-span-2">
          <PanelHeader
            action={
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-brand" />
                  <span className="t-meta text-ink-2">Inbound</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-money" />
                  <span className="t-meta text-ink-2">Outbound</span>
                </div>
              </div>
            }
          >
            <PanelTitle>Call Activity</PanelTitle>
            <PanelDescription>Inbound vs. outbound call volume</PanelDescription>
          </PanelHeader>
          <PanelBody>
            <div className="relative h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="inboundGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="var(--brand)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--rule)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="time"
                    tick={{
                      fill: 'var(--ink-3)',
                      fontSize: 12,
                      fontFamily: 'Inter, sans-serif',
                    }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{
                      fill: 'var(--ink-3)',
                      fontSize: 12,
                      fontFamily: 'Inter, sans-serif',
                    }}
                    axisLine={false}
                    tickLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip
                    content={<ChartTooltip />}
                    cursor={{ stroke: 'var(--rule-strong)', strokeWidth: 1 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="outbound"
                    stroke="var(--money)"
                    strokeWidth={2}
                    fill="none"
                    dot={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="inbound"
                    stroke="var(--brand)"
                    strokeWidth={2}
                    fill="url(#inboundGrad)"
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
              {chartData.length === 0 && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <p className="t-meta text-ink-3">No call activity in this period</p>
                </div>
              )}
            </div>
          </PanelBody>
        </Panel>

        {/* Call History Ledger */}
        <Panel className="flex min-w-0 flex-col lg:col-span-1">
          <PanelHeader>
            <PanelTitle>Call History</PanelTitle>
          </PanelHeader>
          <PanelBody flush className="min-h-0 flex-1">
            {!callsLoading && calls.length === 0 ? (
              <EmptyState
                headline="No calls found."
                body="Calls show up here as soon as your agents take one."
                icon={Phone}
              />
            ) : (
              <div className="max-h-[420px] overflow-auto">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-sunken">
                    <tr className="border-b border-rule">
                      <th className="t-label h-10 whitespace-nowrap px-3 text-ink-3">
                        Time
                      </th>
                      <th className="t-label h-10 whitespace-nowrap px-3 text-ink-3">
                        From/To
                      </th>
                      <th className="t-label h-10 whitespace-nowrap px-3 text-ink-3">
                        Duration
                      </th>
                      <th className="t-label h-10 whitespace-nowrap px-3 text-ink-3">
                        Result
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule">
                    {callsLoading ? (
                      <tr>
                        <td colSpan={4} className="t-meta py-8 text-center text-ink-3">
                          Loading calls...
                        </td>
                      </tr>
                    ) : (
                      calls.slice(0, 15).map(call => {
                        const result = getCallResult(call);
                        return (
                          <tr
                            key={call.id}
                            className="transition-colors duration-150 ease-out hover:bg-sunken"
                          >
                            <td className="t-data whitespace-nowrap px-3 py-2.5 text-ink-3">
                              {new Date(call.createdAt).toLocaleString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                                hour12: false,
                              })}
                            </td>
                            <td className="t-data whitespace-nowrap px-3 py-2.5 text-ink">
                              <div className="flex flex-col">
                                <span>
                                  {formatPhoneNumber(call.callerId || call.fromNumber?.number || '—')}
                                </span>
                                <span className="text-meta text-ink-3">
                                  {formatPhoneNumber(
                                    call.toNumber || call.targetNumber || call.did || '—'
                                  )}
                                </span>
                              </div>
                            </td>
                            <td className="t-num whitespace-nowrap px-3 py-2.5 text-ink-2">
                              {(() => {
                                const dur = call.connectedDuration || call.duration;
                                if (dur) return formatDuration(dur);
                                return '—';
                              })()}
                            </td>
                            <td className="px-3 py-2.5">
                              <Badge
                                variant="outline"
                                className={cn('whitespace-nowrap rounded-full', getResultColor(result))}
                              >
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
            )}
          </PanelBody>
        </Panel>
      </div>

      {stats?.dispositions && Object.keys(stats.dispositions).length > 0 && (
        <Panel>
          <PanelHeader>
            <PanelTitle>Disposition Breakdown</PanelTitle>
          </PanelHeader>
          <PanelBody>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {Object.entries(stats.dispositions).map(([key, count]) => (
                <div
                  key={key}
                  className="flex min-w-0 items-center justify-between gap-3 rounded-control border border-rule bg-sunken px-3 py-2.5"
                >
                  <span className="t-meta truncate font-medium text-ink-2">
                    {DISPOSITION_LABELS[key] || key}
                  </span>
                  <span className="t-num font-semibold text-ink">{count}</span>
                </div>
              ))}
            </div>
          </PanelBody>
        </Panel>
      )}
    </div>
  );
}
