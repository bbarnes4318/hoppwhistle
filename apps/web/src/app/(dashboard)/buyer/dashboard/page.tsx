'use client';

import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Calendar,
  DollarSign,
  Phone,
  Play,
  ShieldAlert,
  Wallet,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';
import { apiClient } from '@/lib/api';
import { formatDuration, formatPhoneNumber } from '@/lib/utils';
import { RoleGuard } from '@/components/auth/role-guard';
import Link from 'next/link';

interface BuyerProfile {
  id: string;
  name: string;
  billingType: 'TERMS' | 'UPFRONT';
  walletBalance: number;
}

interface BuyerStats {
  totalCalls: number;
  billableCalls: number;
  buyerCost: string;
}

interface CallRecord {
  id: string;
  createdAt: string;
  callerId?: string;
  toNumber?: string;
  duration?: number;
  connectedDuration?: number;
  billable: boolean;
  buyerBillableAmount?: number;
  status: string;
}

function BuyerDashboard() {
  const { user, buyerId } = useAuth();
  const [profile, setProfile] = useState<BuyerProfile | null>(null);
  const [stats, setStats] = useState<BuyerStats | null>(null);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!buyerId) return;
    setLoading(true);
    try {
      // 1. Fetch Profile
      const profileRes = await apiClient.get<BuyerProfile>(`/api/v1/buyers/${buyerId}`);
      if (profileRes.data) setProfile(profileRes.data);

      // 2. Fetch Stats via Buyer Costs endpoint
      const statsRes = await apiClient.get<{ totals: BuyerStats }>(
        `/api/v1/reports/buyer-costs?buyerId=${buyerId}`
      );
      if (statsRes.data?.totals) {
        setStats(statsRes.data.totals);
      }

      // 3. Fetch Recent Calls
      const callsRes = await apiClient.get<{ data: CallRecord[] }>(
        `/api/v1/calls?buyerId=${buyerId}&limit=5`
      );
      if (callsRes.data?.data) {
        setCalls(callsRes.data.data);
      }
    } catch (err) {
      console.error('Failed to load buyer dashboard data:', err);
    } finally {
      setLoading(false);
    }
  }, [buyerId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const avgCost =
    stats && stats.billableCalls > 0
      ? parseFloat(stats.buyerCost) / stats.billableCalls
      : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Buyer Portal</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Welcome back, {user?.firstName || 'Buyer'}. Here is your call performance and billing.
          </p>
        </div>
        <Button onClick={loadData} variant="outline" size="sm">
          Refresh
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Total Calls Received
            </CardTitle>
            <Phone className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">
              {loading ? '...' : stats?.totalCalls || 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Incoming routed calls</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Billable Calls
            </CardTitle>
            <Activity className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-primary">
              {loading ? '...' : stats?.billableCalls || 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats?.totalCalls
                ? ((stats.billableCalls / stats.totalCalls) * 100).toFixed(1)
                : '0.0'}
              % billable rate
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Total Cost
            </CardTitle>
            <DollarSign className="h-4 w-4 text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-emerald-400">
              {loading ? '...' : `$${parseFloat(stats?.buyerCost || '0').toFixed(2)}`}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Avg ${avgCost.toFixed(2)} / billable call
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {profile?.billingType === 'UPFRONT' ? 'Wallet Balance' : 'Pending Invoice'}
            </CardTitle>
            <Wallet className="h-4 w-4 text-cyan-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-cyan-400">
              {loading ? '...' : `$${Number(profile?.walletBalance || 0).toFixed(2)}`}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {profile?.billingType === 'UPFRONT' ? 'Pre-paid upfront balance' : 'Billed on terms'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Recent Calls */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Recent Inbound Calls</CardTitle>
              <CardDescription>Review your latest routed calls.</CardDescription>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/buyer/calls" className="flex items-center gap-1">
                View All <ArrowUpRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/20">
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      Time
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      Caller
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      Duration
                    </th>
                    <th className="p-3 text-left text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      Status
                    </th>
                    <th className="p-3 text-right text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      Cost
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                        Loading recent calls...
                      </td>
                    </tr>
                  ) : calls.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                        No recent calls.
                      </td>
                    </tr>
                  ) : (
                    calls.map((call) => (
                      <tr key={call.id} className="hover:bg-muted/35 transition-colors">
                        <td className="p-3 font-mono text-xs text-muted-foreground">
                          {new Date(call.createdAt).toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="p-3 font-mono text-xs text-foreground">
                          {formatPhoneNumber(call.callerId || '—')}
                        </td>
                        <td className="p-3 font-mono text-xs text-muted-foreground">
                          {formatDuration(call.connectedDuration || call.duration || 0)}
                        </td>
                        <td className="p-3">
                          <Badge
                            variant={call.billable ? 'success' : 'outline'}
                            className="text-xs"
                          >
                            {call.billable ? 'Billable' : 'Non-Billable'}
                          </Badge>
                        </td>
                        <td className="p-3 text-right font-mono text-xs text-emerald-400 font-semibold">
                          ${Number(call.buyerBillableAmount || 0).toFixed(2)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Quick Links / Status */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Billing & Invoices</CardTitle>
              <CardDescription>Manage your wallet or post-pay statements.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border p-4 bg-muted/10">
                <div className="text-xs text-muted-foreground uppercase tracking-widest">
                  Billing Class
                </div>
                <div className="text-sm font-bold text-foreground mt-1">
                  {profile?.billingType === 'UPFRONT'
                    ? 'Upfront Pre-payment'
                    : 'Post-payment (Terms)'}
                </div>
              </div>
              <Button asChild className="w-full">
                <Link href="/buyer/wallet">Go to Billing & Wallet</Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Help & Disputes</CardTitle>
              <CardDescription>Dispute invalid calls or request support.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start gap-3 rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3">
                <ShieldAlert className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-yellow-400">
                  You can open disputes for calls that did not meet billable criteria directly from
                  the Disputes tab.
                </div>
              </div>
              <Button asChild variant="outline" className="w-full">
                <Link href="/buyer/disputes">Manage Disputes</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function GuardedBuyerDashboard() {
  return (
    <RoleGuard allowedRoles={['BUYER']}>
      <BuyerDashboard />
    </RoleGuard>
  );
}
