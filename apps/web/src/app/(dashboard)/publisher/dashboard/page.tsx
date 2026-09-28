'use client';

import { Download, Loader2, PhoneCall, Users } from 'lucide-react';
import { useCallback, useEffect, useState, useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { RoleGuard } from '@/components/auth/role-guard';
import { AXIS_PROPS, GRID_PROPS, StatTile, chartTooltip, tileDollars } from '@/components/domain';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { apiClient, payload } from '@/lib/api';
import type { Envelope } from '@/lib/api';
import { formatDuration, formatPhoneNumber } from '@/lib/utils';

interface Stats {
  totalCalls: number;
  billableCalls: number;
  nonBillableCalls: number;
  payout: number;
  billableRate: number;
  averageConnectedDuration: number;
  pingCount: number;
  noBidCount: number;
  topCampaigns: Array<{
    campaignId: string;
    campaignName: string;
    callsCount: number;
    payout: number;
  }>;
  recentCalls: Array<{
    id: string;
    createdAt: string;
    callerId?: string;
    did?: string;
    toNumber?: string;
    duration?: number;
    connectedDuration?: number;
    status: string;
    payout?: number;
    billable: boolean;
    nonBillableReason?: string;
    campaign?: { name: string } | null;
  }>;
}

type DatePreset = 'last-7' | 'last-30' | 'last-90' | 'custom';

/** One New York calendar day of this publisher's inbound calls. */
interface DailyEntry {
  day: string;
  calls: number;
  billable: number;
  payout: number;
}

/**
 * "Mar 4" for a `YYYY-MM-DD` day key. Read as a UTC date on purpose: the key
 * already names the calendar day, and letting the browser's zone near it would
 * shift every label a day for a reader west of Greenwich.
 */
function dayLabel(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function PublisherDashboard() {
  const { user } = useAuth();
  const publisherId = user?.publisherId;

  const [stats, setStats] = useState<Stats | null>(null);
  const [daily, setDaily] = useState<DailyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [datePreset, setDatePreset] = useState<DatePreset>('last-30');

  // Custom Date range
  const today = new Date().toISOString().split('T')[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const [startDate, setStartDate] = useState(thirtyDaysAgo);
  const [endDate, setEndDate] = useState(today);

  const fetchStats = useCallback(async () => {
    if (!publisherId) return;
    setLoading(true);
    try {
      let start = startDate;
      let end = endDate;

      if (datePreset === 'last-7') {
        start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        end = today;
      } else if (datePreset === 'last-30') {
        start = thirtyDaysAgo;
        end = today;
      } else if (datePreset === 'last-90') {
        start = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        end = today;
      }

      const [res, dailyRes] = await Promise.all([
        apiClient.get<Stats>(
          `/api/v1/publishers/${publisherId}/stats?startDate=${start}&endDate=${end}`
        ),
        apiClient.get<Envelope<{ days: DailyEntry[] }>>(
          `/api/v1/publishers/${publisherId}/daily?period=CUSTOM&from=${start}&to=${end}`
        ),
      ]);
      if (res.data) {
        setStats(res.data);
      } else if (res.error) {
        toast.error('Failed to load dashboard stats', res.error.message);
      }
      setDaily(payload(dailyRes)?.days ?? []);
    } catch (err) {
      console.error('Failed to fetch publisher dashboard stats:', err);
    } finally {
      setLoading(false);
    }
  }, [publisherId, datePreset, startDate, endDate, today, thirtyDaysAgo]);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  const handleExportCSV = async () => {
    if (!publisherId) return;
    setExporting(true);
    try {
      let start = startDate;
      let end = endDate;

      if (datePreset === 'last-7') {
        start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        end = today;
      } else if (datePreset === 'last-30') {
        start = thirtyDaysAgo;
        end = today;
      } else if (datePreset === 'last-90') {
        start = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        end = today;
      }

      // Download CSV
      const token = localStorage.getItem('token');
      // In the header, not the query string: `?token=` is no longer a login.
      const url = `/api/v1/calls/export.csv?startDate=${start}&endDate=${end}`;

      const response = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) throw new Error('Failed to generate export file.');

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.setAttribute('download', `publisher_calls_${start}_to_${end}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      toast.success('Export Complete', 'Your CSV export is ready.');
    } catch (err) {
      console.error('Export failed:', err);
      toast.error('Export Failed', 'An error occurred during CSV export.');
    } finally {
      setExporting(false);
    }
  };

  /*
   * The trend chart plots the publisher's real calls per day, from
   * `GET /api/v1/publishers/:id/daily`. It used to be a curve made up from the
   * period's totals, which drew a trend on days that had none; a day with no
   * calls is in the series as a zero, so a gap in traffic shows as one.
   */
  const chartData = useMemo(
    () =>
      daily.map(entry => ({
        name: dayLabel(entry.day),
        Total: entry.calls,
        Billable: entry.billable,
      })),
    [daily]
  );

  if (loading && !stats) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-brand-ink" />
      </div>
    );
  }

  return (
    <div className="page-canvas">
      <PageHeader
        description="Your calls, what they earned, and which campaigns sent them."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center rounded-lg bg-sunken border border-rule p-1">
              <Button
                variant={datePreset === 'last-7' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setDatePreset('last-7')}
                className="text-xs rounded-md"
              >
                7 Days
              </Button>
              <Button
                variant={datePreset === 'last-30' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setDatePreset('last-30')}
                className="text-xs rounded-md"
              >
                30 Days
              </Button>
              <Button
                variant={datePreset === 'last-90' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setDatePreset('last-90')}
                className="text-xs rounded-md"
              >
                90 Days
              </Button>
              <Button
                variant={datePreset === 'custom' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setDatePreset('custom')}
                className="text-xs rounded-md"
              >
                Custom
              </Button>
            </div>

            {datePreset === 'custom' && (
              <div className="flex items-center gap-2 bg-sunken border border-rule rounded-lg p-1">
                <Input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="h-8 w-32 bg-transparent border-0 text-xs text-ink focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <span className="text-ink-3 text-xs">to</span>
                <Input
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  className="h-8 w-32 bg-transparent border-0 text-xs text-ink focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <Button size="sm" onClick={() => void fetchStats()} className="h-7 px-2 text-xs">
                  Apply
                </Button>
              </div>
            )}

            <Button
              onClick={() => void handleExportCSV()}
              disabled={exporting || !stats?.totalCalls}
              className="gap-2 bg-brand text-brand-fg hover:bg-brand-ink hover:text-surface font-medium"
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Export CSV
            </Button>
          </div>
        }
      />

      {/* The four numbers the range is about */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          size="hero"
          label="Total calls"
          figure={(stats?.totalCalls ?? 0).toLocaleString()}
          sub={
            stats?.pingCount
              ? `${stats.pingCount.toLocaleString()} lead pings received`
              : 'Calls routed through campaigns'
          }
        />
        <StatTile
          size="hero"
          label="Billable calls"
          figure={(stats?.billableCalls ?? 0).toLocaleString()}
          sub={
            stats?.billableRate
              ? `${stats.billableRate.toFixed(1)}% billable rate`
              : 'None billable yet'
          }
        />
        <StatTile
          size="hero"
          label="Payout earnings"
          tone="money"
          figure={tileDollars(stats?.payout ?? 0)}
          sub="What these calls earned you"
        />
        <StatTile
          size="hero"
          label="Avg duration"
          figure={formatDuration(stats?.averageConnectedDuration || 0)}
          sub="Average connected call length"
        />
      </div>

      {/* Main sections: Chart & Top Campaigns */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Call Volume Chart */}
        <Card className="lg:col-span-2 bg-surface border-rule text-ink">
          <CardHeader>
            <CardTitle className="text-lg font-bold">Call performance</CardTitle>
            <CardDescription className="text-ink-2">
              Daily breakdown of total vs billable calls.
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                {/*
                 * Colours are the agency's brand tokens, not hex: a white-label
                 * agency's publishers see its brand here, and dark mode swaps
                 * the grid and tooltip with the rest of the page.
                 */}
                <defs>
                  <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--brand)" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="var(--brand)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorBillable" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--brand-ink)" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="var(--brand-ink)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="name" {...AXIS_PROPS} />
                <YAxis {...AXIS_PROPS} allowDecimals={false} />
                <Tooltip cursor={{ stroke: 'var(--rule-strong)' }} content={chartTooltip({})} />
                <Area
                  type="monotone"
                  dataKey="Total"
                  stroke="var(--brand)"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorTotal)"
                  name="Total calls"
                />
                <Area
                  type="monotone"
                  dataKey="Billable"
                  stroke="var(--brand-ink)"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorBillable)"
                  name="Billable calls"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Top Campaigns */}
        <Card className="bg-surface border-rule text-ink">
          <CardHeader>
            <CardTitle className="text-lg font-bold">Top campaigns</CardTitle>
            <CardDescription className="text-ink-2">
              Top-performing campaign integrations.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {stats && stats.topCampaigns.length > 0 ? (
              <div className="space-y-4">
                {stats.topCampaigns.map((camp, index) => (
                  <div
                    key={camp.campaignId}
                    className="flex items-center justify-between border-b border-rule pb-3 last:border-0 last:pb-0"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-ink-3">#{index + 1}</span>
                        <span className="font-semibold text-sm text-ink">{camp.campaignName}</span>
                      </div>
                      <div className="text-xs text-ink-2">{camp.callsCount} calls sent</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-ink tabular">${camp.payout.toFixed(2)}</div>
                      <div className="text-xs text-ink-3">Earned</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-[200px] flex-col items-center justify-center text-center">
                <Users className="h-8 w-8 text-ink-3 mb-2" />
                <p className="text-sm text-ink-2">No campaigns found for this range.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Calls Table */}
      <Card className="bg-surface border-rule text-ink">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg font-bold">Recent inbound calls</CardTitle>
            <CardDescription className="text-ink-2">
              Latest call traffic generated by your sources.
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            asChild
            className="border-rule text-ink hover:bg-sunken"
          >
            <a href="/publisher/calls">View All Calls</a>
          </Button>
        </CardHeader>
        <CardContent>
          {stats && stats.recentCalls.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-ink-2">
                <thead className="t-caption text-ink-2 border-b border-rule bg-sunken">
                  <tr>
                    <th className="px-4 py-3">Time</th>
                    <th className="px-4 py-3">Caller</th>
                    <th className="px-4 py-3">Campaign</th>
                    <th className="px-4 py-3">Duration</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Payout</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {stats.recentCalls.map(call => (
                    <tr key={call.id} className="hover:bg-sunken transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap text-xs">
                        {new Date(call.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap font-mono text-xs">
                        {formatPhoneNumber(call.callerId || '')}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-xs font-medium">
                        {call.campaign?.name || 'Inbound Routing'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-xs">
                        {formatDuration(call.connectedDuration || call.duration || 0)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {call.billable ? (
                          <Badge className="bg-live-tint text-live-ink border-live/40 text-xs">
                            Billable
                          </Badge>
                        ) : (
                          <Badge
                            variant="outline"
                            className="bg-dropped-tint text-dropped-ink border-dropped/40 text-xs"
                            title={call.nonBillableReason || undefined}
                          >
                            Non-Billable
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right font-semibold text-ink tabular text-xs">
                        {call.payout ? `$${Number(call.payout).toFixed(2)}` : '$0.00'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex h-[150px] flex-col items-center justify-center text-center">
              <PhoneCall className="h-8 w-8 text-ink-3 mb-2" />
              <p className="text-sm text-ink-2">No calls registered for this period.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function GuardedPublisherDashboard() {
  return (
    <RoleGuard allowedRoles={['PUBLISHER']}>
      <PublisherDashboard />
    </RoleGuard>
  );
}
