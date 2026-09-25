'use client';

import { FileText, Headphones, Percent, Phone, PhoneCall } from 'lucide-react';
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
  StatTile,
  Toolbar,
  ToolbarActions,
  ToolbarDateRange,
  ToolbarMeta,
  ToolbarSelect,
} from '@/components/domain';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { usePlatformContext } from '@/hooks/use-platform-context';
import { apiClient } from '@/lib/api';
import { hasLeftConsole } from '@/lib/console-exit';
import { formatClock, formatTableDateTime } from '@/lib/format-time';
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

/** The period in words, for the line under each figure. */
const PERIOD_PHRASE: Record<DatePreset, string> = {
  day: 'Today',
  week: 'This week',
  month: 'This month',
  quarter: 'This quarter',
  year: 'This year',
  custom: 'Selected range',
};

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
       * /calls ("My calls") is an agent's home, and it is the same destination
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
      router.replace('/calls');
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

  // Conversion has no meaning without a call to convert.
  const conversionPct = stats?.totalCalls ? (stats.closingPct ?? null) : null;

  // Live clock
  const [liveClock, setLiveClock] = useState('');
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setLiveClock(formatClock(now, { seconds: true }));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  /*
   * The one range everything on this page reads: the tiles, the chart and the
   * call history. Custom only takes effect once both ends are applied; until
   * then the page keeps showing the last range it fetched, rather than falling
   * back to a preset the toolbar no longer says.
   */
  const [range, setRange] = useState<{ startDate: string; endDate: string }>(() => {
    const r = getDateRange('month');
    return { startDate: r.start.toISOString(), endDate: r.end.toISOString() };
  });

  const fetchStats = useCallback(async (startDate: string, endDate: string) => {
    setLoading(true);
    try {
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

  // The period's calls, for the activity chart and the history beside it.
  const fetchCalls = useCallback(async (startDate: string, endDate: string) => {
    setCallsLoading(true);
    try {
      const response = await apiClient.get<{ data: CallRecord[]; meta: { totalPages: number } }>(
        `/api/v1/calls?limit=500&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`
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
    void fetchStats(range.startDate, range.endDate);
    void fetchCalls(range.startDate, range.endDate);
  }, [fetchStats, fetchCalls, range]);

  const handlePresetChange = (preset: DatePreset) => {
    setActivePreset(preset);
    setShowCustom(preset === 'custom');
    if (preset !== 'custom') {
      const r = getDateRange(preset);
      setRange({ startDate: r.start.toISOString(), endDate: r.end.toISOString() });
    }
  };

  const handleCustomApply = () => {
    if (customFrom && customTo) {
      setRange({
        startDate: new Date(`${customFrom}T00:00:00`).toISOString(),
        endDate: new Date(`${customTo}T23:59:59.999`).toISOString(),
      });
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
      {/*
        Period and live status on one toolbar row, KPI tiles straight under it.
        The page title is already in the topbar, so there is no header row of
        its own. The custom range only fetches on Apply: both ends have to be
        set before a range means anything, and fetching on every keystroke of
        a date input would fire half-typed ranges at the API.
      */}
      {/*
        Unboxed. As a card this was a full-width panel holding one select and a
        clock -- a whole row of chrome around two controls. Bare, it is the
        period control sitting directly over the figures it scopes.
      */}
      <Toolbar className="border-0 bg-transparent p-0 shadow-none">
        <ToolbarSelect
          label="Period"
          value={activePreset}
          onChange={value => handlePresetChange(value as DatePreset)}
          options={presets.map(p => ({ value: p.key, label: p.label }))}
          allValue={null}
        />
        {showCustom && (
          <>
            <ToolbarDateRange
              from={customFrom}
              to={customTo}
              onFromChange={setCustomFrom}
              onToChange={setCustomTo}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={handleCustomApply}
              disabled={!customFrom || !customTo}
              className="h-8 text-xs"
            >
              Apply
            </Button>
          </>
        )}
        <ToolbarActions>
          <ToolbarMeta className="inline-flex items-center gap-2">
            <span aria-hidden className="inline-flex h-2 w-2 rounded-full bg-live" />
            <span className="font-medium text-ink-2">Live · {liveClock}</span>
          </ToolbarMeta>
        </ToolbarActions>
      </Toolbar>

      {/* Metric Cards (KPIs) -- every figure is for the period selected above. */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile
          label="Total Calls"
          value={stats?.totalCalls || 0}
          icon={PhoneCall}
          loading={loading}
          sub={PERIOD_PHRASE[activePreset]}
          className="p-4"
        />
        <StatTile
          label="Applications"
          value={stats?.submittedApplications || 0}
          icon={FileText}
          loading={loading}
          sub="Submitted"
          className="p-4"
        />
        {/* A rate with no denominator is not 0%. A real 0% -- calls, and no
            applications from them -- renders as 0; no calls at all in the
            period, or no figure from the server, is the dash. */}
        <StatTile
          label="Conversion %"
          value={conversionPct ?? '—'}
          unit={conversionPct == null ? undefined : '%'}
          icon={Percent}
          loading={loading}
          sub="Applications ÷ calls"
          className="p-4"
        />
        <StatTile
          label="Callbacks"
          value={stats?.callbacksScheduled || 0}
          icon={Headphones}
          loading={loading}
          sub="Scheduled"
          className="p-4"
        />
      </div>

      {/*
        Main grid. Left, two-thirds: call activity with the disposition
        breakdown under it. Right, one-third: the call history, pinned to the
        height of the left column and scrolling inside itself.

        It used to grow with its fifteen rows, which made the row as tall as
        the ledger and left a chart-sized hole under Call Activity -- with the
        disposition breakdown pushed below all of it as a full-width card that
        usually held two chips. On a phone the columns stack and the ledger is
        capped instead.
      */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Panel className="min-w-0">
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

          <DispositionBreakdown dispositions={stats?.dispositions} />
        </div>

        {/* Call History Ledger */}
        <div className="relative min-w-0 lg:col-span-1">
          <Panel className="flex max-h-[560px] min-w-0 flex-col lg:absolute lg:inset-0 lg:max-h-none">
            <PanelHeader>
              <PanelTitle>Call History</PanelTitle>
            </PanelHeader>
            <PanelBody flush className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
              {!callsLoading && calls.length === 0 ? (
                <EmptyState
                  headline="No calls found."
                  body="Calls show up here as soon as your agents take one."
                  icon={Phone}
                />
              ) : (
                /*
                Three columns and nothing wider than the panel: a one-third
                panel at 1366px has about 350px, so the call's two numbers
                stack in one cell, the time may break after its date, and the
                result sits under the time. It never scrolls sideways; it
                scrolls down inside the card, whose height the left column sets.
              */
                <table className="w-full table-fixed text-left text-sm">
                  <colgroup>
                    <col className="w-[140px]" />
                    <col />
                    <col className="w-[92px]" />
                  </colgroup>
                  <thead className="sticky top-0 z-[1] bg-sunken">
                    <tr className="border-b border-rule">
                      <th className="t-label h-10 whitespace-nowrap pl-5 pr-2 text-ink-3">Call</th>
                      <th className="t-label h-10 whitespace-nowrap px-2 text-ink-3">Time</th>
                      <th className="t-label h-10 whitespace-nowrap pl-2 pr-5 text-right text-ink-3">
                        Duration
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-rule">
                    {callsLoading ? (
                      <tr>
                        <td colSpan={3} className="t-meta py-8 text-center text-ink-3">
                          Loading calls...
                        </td>
                      </tr>
                    ) : (
                      calls.slice(0, 25).map(call => {
                        const result = getCallResult(call);
                        return (
                          <tr
                            key={call.id}
                            className="align-top transition-colors duration-150 ease-out hover:bg-sunken"
                          >
                            <td className="py-2.5 pl-5 pr-2">
                              <div className="t-data whitespace-nowrap text-ink">
                                {formatPhoneNumber(
                                  call.callerId || call.fromNumber?.number || ''
                                ) || '—'}
                              </div>
                              {/* Still Plex Mono: a phone number is .t-data at any size. */}
                              <div className="t-meta whitespace-nowrap font-mono text-ink-3">
                                {formatPhoneNumber(
                                  call.toNumber || call.targetNumber || call.did || ''
                                ) || '—'}
                              </div>
                            </td>
                            <td className="px-2 py-2.5">
                              <div className="t-data break-words text-ink-2">
                                {formatTableDateTime(call.createdAt)}
                              </div>
                              <Badge
                                variant="outline"
                                title={result}
                                className={cn(
                                  'mt-1 h-5 max-w-full overflow-hidden rounded-full px-2 text-[11px]',
                                  getResultColor(result)
                                )}
                              >
                                <span className="truncate">{result}</span>
                              </Badge>
                            </td>
                            <td className="t-num whitespace-nowrap py-2.5 pl-2 pr-5 text-right text-ink-2">
                              {(() => {
                                const dur = call.connectedDuration || call.duration;
                                if (dur) return formatDuration(dur);
                                return '—';
                              })()}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              )}
            </PanelBody>
          </Panel>
        </div>
      </div>
    </div>
  );
}

/**
 * How the period's calls were dispositioned, as ranked bars.
 *
 * It was a full-width card of equal chips at the bottom of the page, which
 * gave "No Answer 1" the same weight as a disposition with four hundred calls
 * and usually sat nearly empty. Ranked bars read at a glance -- what most
 * calls ended as, and by how much -- and fit under the chart.
 */
function DispositionBreakdown({
  dispositions,
}: {
  dispositions: Record<string, number> | undefined;
}): JSX.Element | null {
  const rows = Object.entries(dispositions ?? {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
  if (rows.length === 0) return null;

  const total = rows.reduce((sum, [, count]) => sum + count, 0);
  const max = rows[0][1];

  return (
    <Panel className="min-w-0">
      <PanelHeader action={<span className="t-meta text-ink-3">{total} dispositioned</span>}>
        <PanelTitle>Disposition Breakdown</PanelTitle>
      </PanelHeader>
      <PanelBody>
        <ul className="grid grid-cols-1 gap-x-8 gap-y-2.5 md:grid-cols-2">
          {rows.map(([key, count]) => (
            <li key={key} className="min-w-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="t-meta truncate font-medium text-ink-2">
                  {(DISPOSITION_LABELS as Record<string, string>)[key] || key}
                </span>
                <span className="t-num shrink-0 text-sm font-semibold text-ink">
                  {count}
                  <span className="ml-1.5 font-normal text-ink-3">
                    {Math.round((count / total) * 100)}%
                  </span>
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunken" aria-hidden>
                <div
                  className="h-full rounded-full bg-brand"
                  style={{ width: `${Math.max(4, (count / max) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      </PanelBody>
    </Panel>
  );
}
