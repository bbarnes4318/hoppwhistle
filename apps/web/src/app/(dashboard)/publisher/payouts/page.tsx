'use client';

import {
  DollarSign,
  FileSpreadsheet,
  FileText,
  Loader2,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { RoleGuard } from '@/components/auth/role-guard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { apiClient } from '@/lib/api';

interface RevenueSummary {
  earnings: string;
  paid: string;
  pending: string;
  held: string;
}

interface PayoutRecord {
  id: string;
  amount: number;
  currency: string;
  status: string;
  method: string;
  reference: string | null;
  processedAt: string | null;
  createdAt: string;
}

function PublisherPayoutsPage() {
  const { publisherId } = useAuth();

  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [payouts, setPayouts] = useState<PayoutRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!publisherId) return;
    setLoading(true);
    try {
      // 1. Fetch Earnings Summary from Reports
      const summaryRes = await apiClient.get<{ totals: RevenueSummary }>(
        `/api/v1/reports/publisher-revenue?publisherId=${publisherId}`
      );
      if (summaryRes.data?.totals) {
        setSummary(summaryRes.data.totals);
      }

      // 2. Fetch Payouts list
      const payoutsRes = await apiClient.get<{ data: PayoutRecord[] }>(
        `/api/v1/publishers/${publisherId}/payouts`
      );
      if (payoutsRes.data?.data) {
        setPayouts(payoutsRes.data.data);
      }
    } catch (err) {
      console.error('Failed to load publisher payouts data:', err);
      toast.error('Failed to load payout details');
    } finally {
      setLoading(false);
    }
  }, [publisherId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const getPayoutStatusBadge = (status: string) => {
    const s = status.toUpperCase();
    switch (s) {
      case 'COMPLETED':
        return (
          <Badge variant="success" className="text-xs uppercase font-semibold">
            Completed
          </Badge>
        );
      case 'PROCESSING':
      case 'PENDING':
        return (
          <Badge variant="warning" className="text-xs uppercase font-semibold">
            Processing
          </Badge>
        );
      case 'FAILED':
        return (
          <Badge variant="destructive" className="text-xs uppercase font-semibold">
            Failed
          </Badge>
        );
      case 'CANCELLED':
        return (
          <Badge variant="outline" className="text-xs uppercase font-semibold">
            Cancelled
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-xs uppercase font-semibold">
            {status}
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-ink">Payout Statements</h1>
          <p className="mt-1 text-sm text-ink-2">
            Monitor your earnings settlements, payout history, and payment processing status.
          </p>
        </div>
        <Button onClick={loadData} variant="outline" size="sm">
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="bg-surface border-rule">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-ink-2">
              Total Earnings
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-ink">
              {loading ? '...' : `$${parseFloat(summary?.earnings || '0').toFixed(2)}`}
            </div>
            <p className="text-xs text-ink-3 mt-1">All-time generated earnings</p>
          </CardContent>
        </Card>

        <Card className="bg-surface border-rule">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-ink-2">
              Settled Payouts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-live-ink">
              {loading ? '...' : `$${parseFloat(summary?.paid || '0').toFixed(2)}`}
            </div>
            <p className="text-xs text-ink-3 mt-1">Total successfully paid out</p>
          </CardContent>
        </Card>

        <Card className="bg-surface border-rule">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-ink-2">
              Pending Payable
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-ringing-ink">
              {loading ? '...' : `$${parseFloat(summary?.pending || '0').toFixed(2)}`}
            </div>
            <p className="text-xs text-ink-3 mt-1">Accruing for next payout cycle</p>
          </CardContent>
        </Card>

        <Card className="bg-surface border-rule">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-ink-2">
              Held / Disputed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-dropped-ink">
              {loading ? '...' : `$${parseFloat(summary?.held || '0').toFixed(2)}`}
            </div>
            <p className="text-xs text-ink-3 mt-1">Held due to disputes or reviews</p>
          </CardContent>
        </Card>
      </div>

      {/* Payout History */}
      <Card className="bg-surface border-rule">
        <CardHeader>
          <CardTitle>Payout History</CardTitle>
          <CardDescription>Statement of settlements issued to your accounts.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-rule bg-sunken">
                  <th className="p-4 text-left text-xs font-semibold uppercase tracking-wider text-ink-2">
                    Date Issued
                  </th>
                  <th className="p-4 text-left text-xs font-semibold uppercase tracking-wider text-ink-2">
                    Method
                  </th>
                  <th className="p-4 text-left text-xs font-semibold uppercase tracking-wider text-ink-2">
                    Reference / ID
                  </th>
                  <th className="p-4 text-left text-xs font-semibold uppercase tracking-wider text-ink-2">
                    Date Settled
                  </th>
                  <th className="p-4 text-center text-xs font-semibold uppercase tracking-wider text-ink-2">
                    Status
                  </th>
                  <th className="p-4 text-right text-xs font-semibold uppercase tracking-wider text-ink-2">
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-sm text-ink-2">
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-brand-ink" />
                        <span>Loading payouts history...</span>
                      </div>
                    </td>
                  </tr>
                ) : payouts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-sm text-ink-2">
                      No payout records available yet.
                    </td>
                  </tr>
                ) : (
                  payouts.map(payout => (
                    <tr key={payout.id} className="hover:bg-sunken transition-colors duration-150">
                      <td className="p-4 font-mono text-xs text-ink-2">
                        {new Date(payout.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-4 text-xs text-ink-2 uppercase tracking-wider">
                        {payout.method.replace('_', ' ')}
                      </td>
                      <td className="p-4 font-mono text-xs text-ink-2">
                        {payout.reference || '—'}
                      </td>
                      <td className="p-4 font-mono text-xs text-ink-2">
                        {payout.processedAt
                          ? new Date(payout.processedAt).toLocaleDateString()
                          : '—'}
                      </td>
                      <td className="p-4 text-center">{getPayoutStatusBadge(payout.status)}</td>
                      <td className="p-4 text-right font-mono text-xs text-ink font-semibold">
                        ${Number(payout.amount).toFixed(2)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function GuardedPublisherPayoutsPage() {
  return (
    <RoleGuard allowedRoles={['PUBLISHER']}>
      <PublisherPayoutsPage />
    </RoleGuard>
  );
}
