'use client';

import { Phone, DollarSign, CheckCircle, Receipt, PhoneMissed, AlertTriangle } from 'lucide-react';
import { useEffect, useState, useCallback } from 'react';

import { KPICard } from './kpi-card';

import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

interface DashboardMetrics {
  totalCalls: number;
  billableCalls: number;
  totalRevenue: number;
  totalCost: number;
  missedCalls: number;
  missedCallsInARow: number;
  trends: {
    calls: number;
    billable: number;
    revenue: number;
    cost: number;
    missed: number;
  };
}

interface CallsApiResponse {
  data: Array<{
    id: string;
    status: string;
    paidOut?: boolean;
    missedCall?: boolean;
    revenue?: string | number | null;
    cost?: string | number | null;
    createdAt: string;
  }>;
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

interface DashboardKPIsProps {
  dateRange?: { start: Date; end: Date };
  onFilterChange?: (filter: { type: string; value: string }) => void;
  campaignId?: string;
}

export function DashboardKPIs({ dateRange, onFilterChange, campaignId }: DashboardKPIsProps) {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const now = new Date();
      const startDate = dateRange?.start || new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const endDate = dateRange?.end || now;

      // Previous period for trend comparison
      const periodDuration = endDate.getTime() - startDate.getTime();
      const prevStartDate = new Date(startDate.getTime() - periodDuration);
      const prevEndDate = startDate;

      // Build query params
      const buildParams = (start: Date, end: Date) => {
        const params = new URLSearchParams({
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          limit: '1000', // Fetch enough to calculate metrics
        });
        if (campaignId) {
          params.set('campaignId', campaignId);
        }
        return params;
      };

      const [currentResp, prevResp] = await Promise.all([
        apiClient.get<CallsApiResponse>(
          `/api/v1/calls?${buildParams(startDate, endDate).toString()}`
        ),
        apiClient.get<CallsApiResponse>(
          `/api/v1/calls?${buildParams(prevStartDate, prevEndDate).toString()}`
        ),
      ]);

      if (currentResp.error) {
        throw new Error(currentResp.error.message);
      }

      const currentCalls = currentResp.data?.data || [];
      const prevCalls = prevResp.data?.data || [];

      // Calculate current period metrics
      const totalCalls = currentCalls.length;
      const billableCalls = currentCalls.filter(c => c.paidOut === true).length;
      const totalRevenue = currentCalls.reduce((sum, c) => {
        const rev = typeof c.revenue === 'string' ? parseFloat(c.revenue) : c.revenue || 0;
        return sum + (isNaN(rev) ? 0 : rev);
      }, 0);
      const totalCost = currentCalls.reduce((sum, c) => {
        const cost = typeof c.cost === 'string' ? parseFloat(c.cost) : c.cost || 0;
        return sum + (isNaN(cost) ? 0 : cost);
      }, 0);
      const missedCalls = currentCalls.filter(c => c.missedCall === true).length;

      // Calculate missed calls in a row (check most recent calls)
      const sortedCalls = [...currentCalls].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      let missedCallsInARow = 0;
      for (const call of sortedCalls) {
        if (call.missedCall === true) {
          missedCallsInARow++;
        } else {
          break;
        }
      }

      // Calculate previous period metrics for trends
      const prevTotalCalls = prevCalls.length;
      const prevBillable = prevCalls.filter(c => c.paidOut === true).length;
      const prevRevenue = prevCalls.reduce((sum, c) => {
        const rev = typeof c.revenue === 'string' ? parseFloat(c.revenue) : c.revenue || 0;
        return sum + (isNaN(rev) ? 0 : rev);
      }, 0);
      const prevCost = prevCalls.reduce((sum, c) => {
        const cost = typeof c.cost === 'string' ? parseFloat(c.cost) : c.cost || 0;
        return sum + (isNaN(cost) ? 0 : cost);
      }, 0);
      const prevMissed = prevCalls.filter(c => c.missedCall === true).length;

      const calcTrend = (curr: number, prev: number) => {
        if (prev === 0) return curr > 0 ? 100 : 0;
        return ((curr - prev) / prev) * 100;
      };

      setMetrics({
        totalCalls,
        billableCalls,
        totalRevenue,
        totalCost,
        missedCalls,
        missedCallsInARow,
        trends: {
          calls: calcTrend(totalCalls, prevTotalCalls),
          billable: calcTrend(billableCalls, prevBillable),
          revenue: calcTrend(totalRevenue, prevRevenue),
          cost: calcTrend(totalCost, prevCost),
          missed: calcTrend(missedCalls, prevMissed),
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch metrics');
      setMetrics({
        totalCalls: 0,
        billableCalls: 0,
        totalRevenue: 0,
        totalCost: 0,
        missedCalls: 0,
        missedCallsInARow: 0,
        trends: { calls: 0, billable: 0, revenue: 0, cost: 0, missed: 0 },
      });
    } finally {
      setLoading(false);
    }
  }, [dateRange, campaignId]);

  useEffect(() => {
    void fetchMetrics();
    const interval = setInterval(() => void fetchMetrics(), 30000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  const formatCurrency = (value: number) => {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
    return `$${value.toFixed(2)}`;
  };

  // High Alert Logic: missedCallsInARow > 10 OR missedPercentage > 30%
  const missedPercentage =
    metrics && metrics.totalCalls > 0 ? (metrics.missedCalls / metrics.totalCalls) * 100 : 0;
  const isHighAlert = (metrics?.missedCallsInARow ?? 0) > 10 || missedPercentage > 30;

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
          {error} - Showing default values
        </div>
      )}

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
        {/* Total Calls */}
        <KPICard
          title="Total Calls"
          value={metrics?.totalCalls ?? 0}
          icon={Phone}
          trend={metrics?.trends.calls}
          trendLabel="vs prev period"
          loading={loading}
          onClick={() => onFilterChange?.({ type: 'status', value: 'all' })}
        />

        {/* Billable Calls (paidOut = true) */}
        <KPICard
          title="Billable Calls"
          value={metrics?.billableCalls ?? 0}
          icon={CheckCircle}
          trend={metrics?.trends.billable}
          trendLabel="vs prev period"
          variant="revenue"
          loading={loading}
          onClick={() => onFilterChange?.({ type: 'billable', value: 'true' })}
        />

        {/* Total Revenue */}
        <KPICard
          title="Total Revenue"
          value={formatCurrency(metrics?.totalRevenue ?? 0)}
          icon={DollarSign}
          trend={metrics?.trends.revenue}
          trendLabel="vs prev period"
          variant="revenue"
          loading={loading}
        />

        {/* Total Cost */}
        <KPICard
          title="Total Cost"
          value={formatCurrency(metrics?.totalCost ?? 0)}
          icon={Receipt}
          trend={metrics?.trends.cost}
          trendLabel="vs prev period"
          variant="warning"
          loading={loading}
        />

        {/* Missed Calls with High Alert */}
        <div
          className={cn(
            'relative overflow-hidden rounded-xl border p-5 transition-all duration-200',
            isHighAlert
              ? 'bg-red-500/20 border-red-500 shadow-lg shadow-red-500/10'
              : 'bg-gradient-to-br from-rose-500/10 to-rose-600/5 border-rose-500/20'
          )}
        >
          {/* Background accent */}
          <div className="absolute -right-4 -top-4 opacity-5">
            <PhoneMissed className="h-24 w-24" />
          </div>

          <div className="relative z-10 space-y-3">
            {/* Title with Alert Icon */}
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted-foreground">Missed Calls</span>
              {isHighAlert ? (
                <AlertTriangle className="h-4 w-4 text-red-500 animate-pulse" />
              ) : (
                <PhoneMissed className="h-4 w-4 text-muted-foreground" />
              )}
            </div>

            {/* Value */}
            <div className="flex items-baseline gap-1.5">
              {loading ? (
                <div className="h-9 w-24 animate-pulse rounded bg-muted" />
              ) : (
                <span
                  className={cn(
                    'text-3xl font-bold tracking-tight',
                    isHighAlert ? 'text-red-600 dark:text-red-400' : 'text-foreground'
                  )}
                >
                  {(metrics?.missedCalls ?? 0).toLocaleString()}
                </span>
              )}
            </div>

            {/* Trend and Alert Info */}
            {!loading && (
              <div className="flex items-center gap-2">
                {isHighAlert && (
                  <span className="text-xs font-medium text-red-600 dark:text-red-400">
                    {missedPercentage > 30
                      ? `${missedPercentage.toFixed(0)}% missed`
                      : `${metrics?.missedCallsInARow} in a row`}
                  </span>
                )}
                {metrics?.trends.missed !== undefined && !isHighAlert && (
                  <span className="text-xs text-muted-foreground">
                    {metrics.trends.missed > 0 ? '+' : ''}
                    {metrics.trends.missed.toFixed(1)}% vs prev
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
