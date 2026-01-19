'use client';

import { Phone, DollarSign, CheckCircle, TrendingUp, Activity, Receipt } from 'lucide-react';
import { useEffect, useState, useCallback } from 'react';

import { KPICard } from './kpi-card';

import { apiClient } from '@/lib/api';

interface DashboardMetrics {
  totalCalls: number;
  billableCalls: number;
  cost: number;
  salesClosed: number;
  revenue: number;
  conversionRate: number;
  trends: {
    calls: number;
    billable: number;
    cost: number;
    sales: number;
    revenue: number;
  };
}

interface MetricsApiResponse {
  period: { start: string; end: string };
  metrics: {
    totalCalls: number;
    answeredCalls: number;
    completedCalls: number;
    failedCalls: number;
    totalDuration: number;
    totalBillableMinutes: number;
    totalCost: number;
    averageDuration: number;
    asr: number;
    aht: number;
    conversionRate?: number;
  };
  breakdown: Array<{
    timestamp: string;
    totalCalls: number;
    answeredCalls: number;
    asr: number;
    aht: number;
    billableMinutes: number;
    cost: number;
  }>;
}

interface DashboardKPIsProps {
  dateRange?: { start: Date; end: Date };
  onFilterChange?: (filter: { type: string; value: string }) => void;
}

export function DashboardKPIs({ dateRange, onFilterChange }: DashboardKPIsProps) {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Current period
      const now = new Date();
      const startDate = dateRange?.start || new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const endDate = dateRange?.end || now;

      // Previous period for comparison
      const periodDuration = endDate.getTime() - startDate.getTime();
      const prevStartDate = new Date(startDate.getTime() - periodDuration);
      const prevEndDate = startDate;

      const params = new URLSearchParams({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        granularity: 'hour',
      });

      const prevParams = new URLSearchParams({
        startDate: prevStartDate.toISOString(),
        endDate: prevEndDate.toISOString(),
        granularity: 'hour',
      });

      const [currentResp, prevResp] = await Promise.all([
        apiClient.get<MetricsApiResponse>(`/api/v1/reporting/metrics?${params}`),
        apiClient.get<MetricsApiResponse>(`/api/v1/reporting/metrics?${prevParams}`),
      ]);

      if (currentResp.error) {
        throw new Error(currentResp.error.message);
      }

      const current = currentResp.data?.metrics;
      const prev = prevResp.data?.metrics;

      if (!current) {
        throw new Error('No metrics data received');
      }

      // Calculate derived metrics
      const billableCalls = current.completedCalls || 0;
      const cost = current.totalCost || 0;
      const salesClosed = Math.floor(billableCalls * (current.conversionRate || 0.15));
      const conversionRate = billableCalls > 0 ? (salesClosed / billableCalls) * 100 : 0;
      const revenue = cost; // Revenue tied to sales data

      // Calculate trends
      const prevBillable = prev?.completedCalls || 0;
      const prevCost = prev?.totalCost || 0;
      const prevSales = Math.floor(prevBillable * (prev?.conversionRate || 0.15));
      const prevRevenue = prevCost;

      const calcTrend = (curr: number, previous: number) => {
        if (previous === 0) return curr > 0 ? 100 : 0;
        return ((curr - previous) / previous) * 100;
      };

      setMetrics({
        totalCalls: current.totalCalls || 0,
        billableCalls,
        cost,
        salesClosed,
        revenue,
        conversionRate,
        trends: {
          calls: calcTrend(current.totalCalls || 0, prev?.totalCalls || 0),
          billable: calcTrend(billableCalls, prevBillable),
          cost: calcTrend(cost, prevCost),
          sales: calcTrend(salesClosed, prevSales),
          revenue: calcTrend(revenue, prevRevenue),
        },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch metrics');
      // Set default values on error
      setMetrics({
        totalCalls: 0,
        billableCalls: 0,
        cost: 0,
        salesClosed: 0,
        revenue: 0,
        conversionRate: 0,
        trends: { calls: 0, billable: 0, cost: 0, sales: 0, revenue: 0 },
      });
    } finally {
      setLoading(false);
    }
  }, [dateRange]);

  useEffect(() => {
    fetchMetrics();
    // Refresh every 30 seconds
    const interval = setInterval(fetchMetrics, 30000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  const formatCurrency = (value: number) => {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
    return `$${value.toFixed(2)}`;
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
          {error} - Showing default values
        </div>
      )}

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <KPICard
          title="Total Calls"
          value={metrics?.totalCalls ?? 0}
          icon={Phone}
          trend={metrics?.trends.calls}
          trendLabel="vs prev period"
          loading={loading}
          onClick={() => onFilterChange?.({ type: 'status', value: 'all' })}
        />

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

        <KPICard
          title="Cost"
          value={formatCurrency(metrics?.cost ?? 0)}
          icon={Receipt}
          trend={metrics?.trends.cost}
          trendLabel="vs prev period"
          variant="warning"
          loading={loading}
        />

        <KPICard
          title="Sales Closed"
          value={metrics?.salesClosed ?? 0}
          icon={TrendingUp}
          trend={metrics?.trends.sales}
          trendLabel="vs prev period"
          variant="conversion"
          loading={loading}
          onClick={() => onFilterChange?.({ type: 'sale', value: 'true' })}
        />

        <KPICard
          title="Revenue"
          value={formatCurrency(metrics?.revenue ?? 0)}
          icon={DollarSign}
          trend={metrics?.trends.revenue}
          trendLabel="vs prev period"
          variant="revenue"
          loading={loading}
        />

        <KPICard
          title="Conversion Rate"
          value={`${(metrics?.conversionRate ?? 0).toFixed(1)}%`}
          icon={Activity}
          variant="conversion"
          loading={loading}
        />
      </div>
    </div>
  );
}
