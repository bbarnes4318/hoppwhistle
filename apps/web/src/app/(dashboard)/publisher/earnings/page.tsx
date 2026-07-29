'use client';

import {
  DollarSign,
  TrendingUp,
  CreditCard,
  Calendar,
  Loader2,
  FileText,
  HelpCircle,
  TrendingDown,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { apiClient } from '@/lib/api';
import { formatDuration, formatPhoneNumber } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';
import { RoleGuard } from '@/components/auth/role-guard';

interface CallEarningRecord {
  id: string;
  createdAt: string;
  callerId?: string;
  duration?: number;
  connectedDuration?: number;
  billable: boolean;
  payout?: number;
  publisherPayoutStatus?: string | null;
  publisherPayableAt?: string | null;
  campaign?: { name: string } | null;
}

interface PublisherStats {
  payout: number;
  totalCalls: number;
  billableCalls: number;
}

function PublisherEarningsPage() {
  const { user } = useAuth();
  const publisherId = user?.publisherId;

  const [stats, setStats] = useState<PublisherStats | null>(null);
  const [earnings, setEarnings] = useState<CallEarningRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFinancialData = useCallback(async () => {
    if (!publisherId) return;
    setLoading(true);
    try {
      // 1. Fetch Stats for total payout
      const statsRes = await apiClient.get<PublisherStats>(
        `/api/v1/publishers/${publisherId}/stats`
      );
      if (statsRes.data) {
        setStats(statsRes.data);
      }

      // 2. Fetch calls history for transactional log
      const callsRes = await apiClient.get<{ data: CallEarningRecord[] }>(
        `/api/v1/calls?limit=50`
      );
      if (callsRes.data) {
        setEarnings(callsRes.data.data || []);
      }
    } catch (err) {
      console.error('Failed to load financial data:', err);
      toast.error('Failed to load financial logs');
    } finally {
      setLoading(false);
    }
  }, [publisherId]);

  useEffect(() => {
    void fetchFinancialData();
  }, [fetchFinancialData]);

  // Derived financials
  const lifetimeEarnings = stats?.payout || 0;
  
  // Calculate paid and pending based on earnings table
  const paidEarnings = earnings
    .filter(c => c.publisherPayoutStatus === 'PAID')
    .reduce((sum, c) => sum + (c.payout ? Number(c.payout) : 0), 0);

  const pendingEarnings = earnings
    .filter(c => c.publisherPayoutStatus === 'PENDING' || !c.publisherPayoutStatus)
    .reduce((sum, c) => sum + (c.payout ? Number(c.payout) : 0), 0);

  const getPayoutStatusBadge = (status?: string | null) => {
    const s = status || 'PENDING';
    switch (s.toUpperCase()) {
      case 'PAID':
        return <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30">Paid</Badge>;
      case 'PROCESSING':
        return <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/30">Processing</Badge>;
      case 'PAYABLE':
        return <Badge variant="outline" className="bg-cyan-500/10 text-cyan-400 border-cyan-500/30">Payable</Badge>;
      case 'DISPUTED':
        return <Badge variant="outline" className="bg-rose-500/10 text-rose-400 border-rose-500/30">Disputed</Badge>;
      case 'PENDING':
      default:
        return <Badge variant="outline" className="bg-slate-500/10 text-gray-400 border-slate-500/30">Pending</Badge>;
    }
  };

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-white">Earnings & Payouts</h1>
        <p className="text-sm text-gray-400">
          Review your lifetime payout stats, pending balances, and accrual transactions.
        </p>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Card 1: Lifetime Earnings */}
        <Card className="bg-white/5 border-white/10 backdrop-blur-xl relative overflow-hidden group">
          <div className="absolute right-0 bottom-0 translate-x-4 translate-y-4 opacity-5 pointer-events-none group-hover:scale-110 transition-transform">
            <DollarSign className="w-36 h-36 text-white" />
          </div>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">
              Lifetime Earnings
            </span>
            <DollarSign className="h-5 w-5 text-cyan-400" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-extrabold text-white">
              {loading ? (
                <Loader2 className="h-7 w-7 animate-spin text-cyan-400" />
              ) : (
                `$${lifetimeEarnings.toFixed(2)}`
              )}
            </div>
            <p className="text-[10px] text-gray-400 mt-2 flex items-center gap-1">
              <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
              Accumulated earnings from all matching billable calls.
            </p>
          </CardContent>
        </Card>

        {/* Card 2: Paid Out */}
        <Card className="bg-white/5 border-white/10 backdrop-blur-xl relative overflow-hidden group">
          <div className="absolute right-0 bottom-0 translate-x-4 translate-y-4 opacity-5 pointer-events-none group-hover:scale-110 transition-transform">
            <CreditCard className="w-36 h-36 text-white" />
          </div>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">
              Total Paid Out
            </span>
            <CreditCard className="h-5 w-5 text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-extrabold text-white">
              {loading ? (
                <Loader2 className="h-7 w-7 animate-spin text-cyan-400" />
              ) : (
                `$${(lifetimeEarnings > 0 ? (lifetimeEarnings - pendingEarnings) : 0).toFixed(2)}`
              )}
            </div>
            <p className="text-[10px] text-gray-400 mt-2 flex items-center gap-1">
              <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
              Funds successfully dispersed to your billing account.
            </p>
          </CardContent>
        </Card>

        {/* Card 3: Pending Balance */}
        <Card className="bg-white/5 border-white/10 backdrop-blur-xl relative overflow-hidden group">
          <div className="absolute right-0 bottom-0 translate-x-4 translate-y-4 opacity-5 pointer-events-none group-hover:scale-110 transition-transform">
            <Calendar className="w-36 h-36 text-white" />
          </div>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">
              Pending Balance
            </span>
            <Calendar className="h-5 w-5 text-amber-400" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-extrabold text-white">
              {loading ? (
                <Loader2 className="h-7 w-7 animate-spin text-cyan-400" />
              ) : (
                `$${(lifetimeEarnings > 0 ? pendingEarnings : 0).toFixed(2)}`
              )}
            </div>
            <p className="text-[10px] text-gray-400 mt-2 flex items-center gap-1">
              <HelpCircle className="h-3.5 w-3.5 text-amber-400" />
              Outstanding payouts processing in the current billing cycle.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Transaction Ledger Table */}
      <Card className="bg-white/5 border-white/10 backdrop-blur-xl">
        <CardHeader className="flex flex-row items-center justify-between pb-4 border-b border-white/5">
          <div>
            <CardTitle className="text-lg font-bold text-white flex items-center gap-2">
              <FileText className="h-5 w-5 text-cyan-400" />
              Earnings Ledger
            </CardTitle>
            <CardDescription className="text-xs text-gray-400">
              Detailed list of accrued call payouts from traffic campaigns.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-white/10 hover:bg-transparent">
                  <TableHead className="text-gray-400 font-medium pl-6">Date</TableHead>
                  <TableHead className="text-gray-400 font-medium">Campaign</TableHead>
                  <TableHead className="text-gray-400 font-medium">Caller ID</TableHead>
                  <TableHead className="text-gray-400 font-medium">Connected</TableHead>
                  <TableHead className="text-gray-400 font-medium">Type</TableHead>
                  <TableHead className="text-gray-400 font-medium">Payout Status</TableHead>
                  <TableHead className="text-gray-400 font-medium text-right pr-6">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={7} className="h-48 text-center text-gray-500">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
                        <span>Loading transactions...</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : earnings.length === 0 ? (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={7} className="h-48 text-center text-gray-500">
                      <span>No payouts recorded. Send traffic to start earning.</span>
                    </TableCell>
                  </TableRow>
                ) : (
                  earnings.map(entry => (
                    <TableRow key={entry.id} className="border-white/5 hover:bg-white/5 transition-colors">
                      <TableCell className="pl-6 font-mono text-xs text-white">
                        {new Date(entry.createdAt).toLocaleString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </TableCell>
                      <TableCell className="font-medium text-white">
                        {entry.campaign?.name || '—'}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-gray-300">
                        {entry.callerId ? formatPhoneNumber(entry.callerId) : '—'}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-gray-300">
                        {entry.connectedDuration ? formatDuration(entry.connectedDuration) : '0:00'}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={
                            entry.billable
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                              : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                          }
                        >
                          {entry.billable ? 'Billable Call' : 'Non-Billable'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {getPayoutStatusBadge(entry.publisherPayoutStatus)}
                      </TableCell>
                      <TableCell className="text-right pr-6 font-mono font-bold text-emerald-400">
                        {entry.payout !== undefined && entry.payout !== null ? (
                          `$${Number(entry.payout).toFixed(2)}`
                        ) : (
                          '$0.00'
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Help elements
function CheckCircle(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

export default function GuardedPublisherEarningsPage() {
  return (
    <RoleGuard allowedRoles={['PUBLISHER']}>
      <PublisherEarningsPage />
    </RoleGuard>
  );
}

