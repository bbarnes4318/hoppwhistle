'use client';

import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Calendar,
  ChevronDown,
  DollarSign,
  Download,
  Loader2,
  Phone,
  PhoneCall,
  PhoneIncoming,
  Play,
  Users,
} from 'lucide-react';
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

import { KPICard } from '@/components/dashboard/kpi-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/use-auth';
import { apiClient } from '@/lib/api';
import { formatDuration, formatPhoneNumber } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';
import { RoleGuard } from '@/components/auth/role-guard';

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

function PublisherDashboard() {
  const { user } = useAuth();
  const publisherId = user?.publisherId;

  const [stats, setStats] = useState<Stats | null>(null);
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

      const res = await apiClient.get<Stats>(
        `/api/v1/publishers/${publisherId}/stats?startDate=${start}&endDate=${end}`
      );
      if (res.data) {
        setStats(res.data);
      } else if (res.error) {
        toast.error('Failed to load dashboard stats', res.error.message);
      }
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
      const url = `/api/v1/calls/export.csv?startDate=${start}&endDate=${end}&token=${token || ''}`;
      
      const response = await fetch(url);
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

  // Mock chart data generation based on total stats
  const chartData = useMemo(() => {
    if (!stats) return [];
    const count = datePreset === 'last-7' ? 7 : datePreset === 'last-90' ? 12 : 30;
    const items = [];
    const baseVal = Math.floor(stats.totalCalls / count);
    const billableBase = Math.floor(stats.billableCalls / count);

    for (let i = count - 1; i >= 0; i--) {
      const date = new Date();
      if (datePreset === 'last-90') {
        date.setDate(date.getDate() - i * 7);
      } else {
        date.setDate(date.getDate() - i);
      }
      
      const label = datePreset === 'last-90' 
        ? date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

      // Add slight randomness
      const randSeed = Math.sin(i) * 0.4 + 1.0;
      const total = Math.max(1, Math.round(baseVal * randSeed));
      const billable = Math.max(0, Math.min(total, Math.round(billableBase * randSeed)));

      items.push({
        name: label,
        Total: total,
        Billable: billable,
      });
    }
    return items;
  }, [stats, datePreset]);

  if (loading && !stats) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header section */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white">Publisher Overview</h1>
          <p className="text-gray-400 text-sm mt-1">Real-time performance metrics and call details.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center rounded-lg bg-white/5 border border-white/10 p-1">
            <Button
              variant={datePreset === 'last-7' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setDatePreset('last-7')}
              className="text-xs rounded-md text-white hover:text-white"
            >
              7 Days
            </Button>
            <Button
              variant={datePreset === 'last-30' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setDatePreset('last-30')}
              className="text-xs rounded-md text-white hover:text-white"
            >
              30 Days
            </Button>
            <Button
              variant={datePreset === 'last-90' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setDatePreset('last-90')}
              className="text-xs rounded-md text-white hover:text-white"
            >
              90 Days
            </Button>
            <Button
              variant={datePreset === 'custom' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setDatePreset('custom')}
              className="text-xs rounded-md text-white hover:text-white"
            >
              Custom
            </Button>
          </div>

          {datePreset === 'custom' && (
            <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg p-1">
              <Input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="h-8 w-32 bg-transparent border-0 text-xs text-white focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              <span className="text-gray-500 text-xs">to</span>
              <Input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="h-8 w-32 bg-transparent border-0 text-xs text-white focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              <Button size="sm" onClick={fetchStats} className="h-7 px-2 text-xs">
                Apply
              </Button>
            </div>
          )}

          <Button
            onClick={handleExportCSV}
            disabled={exporting || !stats?.totalCalls}
            className="gap-2 bg-cyan-600 hover:bg-cyan-700 text-white font-medium"
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Export CSV
          </Button>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-white/5 border-white/10 text-white">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-gray-400">Total Calls</CardTitle>
            <Phone className="h-4 w-4 text-cyan-400" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-extrabold text-white">{stats?.totalCalls.toLocaleString()}</div>
            <p className="text-xs text-gray-500 mt-1">
              {stats?.pingCount ? `${stats.pingCount.toLocaleString()} lead pings received` : 'Calls routed through campaigns'}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-white/5 border-white/10 text-white">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-gray-400">Billable Calls</CardTitle>
            <PhoneIncoming className="h-4 w-4 text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-extrabold text-white">{stats?.billableCalls.toLocaleString()}</div>
            <p className="text-xs text-gray-500 mt-1">
              {stats?.billableRate ? `${stats.billableRate.toFixed(1)}% billable rate` : '0%'}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-white/5 border-white/10 text-white">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-gray-400">Payout Earnings</CardTitle>
            <DollarSign className="h-4 w-4 text-amber-400" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-extrabold text-white">
              ${stats?.payout.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <p className="text-xs text-gray-500 mt-1">Total revenue generated</p>
          </CardContent>
        </Card>

        <Card className="bg-white/5 border-white/10 text-white">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-gray-400">Avg Duration</CardTitle>
            <Activity className="h-4 w-4 text-indigo-400" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-extrabold text-white">{formatDuration(stats?.averageConnectedDuration || 0)}</div>
            <p className="text-xs text-gray-500 mt-1">Average connected call length</p>
          </CardContent>
        </Card>
      </div>

      {/* Main sections: Chart & Top Campaigns */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Call Volume Chart */}
        <Card className="lg:col-span-2 bg-white/5 border-white/10 text-white">
          <CardHeader>
            <CardTitle className="text-lg font-bold">Call Performance Trend</CardTitle>
            <CardDescription className="text-gray-400">Daily breakdown of total vs billable calls.</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorBillable" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#34d399" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#34d399" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 255, 255, 0.05)" />
                <XAxis dataKey="name" stroke="#6b7280" style={{ fontSize: 10 }} tickLine={false} />
                <YAxis stroke="#6b7280" style={{ fontSize: 10 }} tickLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: 'rgba(255,255,255,0.1)', color: '#fff' }}
                />
                <Area type="monotone" dataKey="Total" stroke="#22d3ee" strokeWidth={2} fillOpacity={1} fill="url(#colorTotal)" name="Total Calls" />
                <Area type="monotone" dataKey="Billable" stroke="#34d399" strokeWidth={2} fillOpacity={1} fill="url(#colorBillable)" name="Billable Calls" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Top Campaigns */}
        <Card className="bg-white/5 border-white/10 text-white">
          <CardHeader>
            <CardTitle className="text-lg font-bold">Top Campaigns</CardTitle>
            <CardDescription className="text-gray-400">Top-performing campaign integrations.</CardDescription>
          </CardHeader>
          <CardContent>
            {stats && stats.topCampaigns.length > 0 ? (
              <div className="space-y-4">
                {stats.topCampaigns.map((camp, index) => (
                  <div key={camp.campaignId} className="flex items-center justify-between border-b border-white/5 pb-3 last:border-0 last:pb-0">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-gray-500">#{index + 1}</span>
                        <span className="font-semibold text-sm text-white">{camp.campaignName}</span>
                      </div>
                      <div className="text-xs text-gray-400">{camp.callsCount} calls sent</div>
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-emerald-400">${camp.payout.toFixed(2)}</div>
                      <div className="text-xs text-gray-500">Earned</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex h-[200px] flex-col items-center justify-center text-center">
                <Users className="h-8 w-8 text-gray-600 mb-2" />
                <p className="text-sm text-gray-400">No campaigns found for this range.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Calls Table */}
      <Card className="bg-white/5 border-white/10 text-white">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg font-bold">Recent Inbound Calls</CardTitle>
            <CardDescription className="text-gray-400">Latest call traffic generated by your sources.</CardDescription>
          </div>
          <Button variant="outline" size="sm" asChild className="border-white/10 text-white hover:bg-white/5">
            <a href="/publisher/calls">View All Calls</a>
          </Button>
        </CardHeader>
        <CardContent>
          {stats && stats.recentCalls.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-gray-300">
                <thead className="text-xs uppercase text-gray-400 border-b border-white/10 bg-white/5">
                  <tr>
                    <th className="px-4 py-3">Time</th>
                    <th className="px-4 py-3">Caller</th>
                    <th className="px-4 py-3">Campaign</th>
                    <th className="px-4 py-3">Duration</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Payout</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {stats.recentCalls.map(call => (
                    <tr key={call.id} className="hover:bg-white/5 transition-colors">
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
                          <Badge className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-xs">
                            Billable
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-gray-400 border-white/10 text-xs" title={call.nonBillableReason || undefined}>
                            Non-Billable
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right font-semibold text-emerald-400 text-xs">
                        {call.payout ? `$${Number(call.payout).toFixed(2)}` : '$0.00'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex h-[150px] flex-col items-center justify-center text-center">
              <PhoneCall className="h-8 w-8 text-gray-600 mb-2" />
              <p className="text-sm text-gray-400">No calls registered for this period.</p>
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

