'use client';

/**
 * Project Cortex | Sanitized KPIs
 *
 * STRICT DATA ONLY — No animations, no tickers.
 *
 * KPI Cards (5 total):
 * 1. Total Calls (Int)
 * 2. Billable Calls (Int)
 * 3. Total Revenue ($)
 * 4. Total Cost ($)
 * 5. Missed Calls (Int) — with ALERT LOGIC
 *
 * Alert Logic:
 * - If > 10 Consecutive Missed OR Missed % > 30%:
 *   → Turn Missed Calls card ALARM RED and PULSE
 *
 * Style:
 * - JetBrains Mono for all numbers
 */

import { useEffect, useState, useCallback } from 'react';
import { Phone, DollarSign, CheckCircle, XCircle, PhoneMissed } from 'lucide-react';
import { motion } from 'framer-motion';

import { cn } from '@/lib/utils';
import { apiClient } from '@/lib/api';

interface SanitizedKPIsProps {
  campaignId?: string;
  dateRange?: { start: Date; end: Date };
}

interface MetricsData {
  totalCalls: number;
  billableCalls: number;
  totalRevenue: number;
  totalCost: number;
  missedCalls: number;
  consecutiveMissed: number;
  missedPercentage: number;
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
    totalRevenue?: number;
    averageDuration: number;
    asr: number;
    aht: number;
    missedCalls?: number;
    consecutiveMissed?: number;
  };
}

export function SanitizedKPIs({ campaignId, dateRange }: SanitizedKPIsProps) {
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const now = new Date();
      const startDate = dateRange?.start || new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const endDate = dateRange?.end || now;

      const params = new URLSearchParams({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        granularity: 'hour',
      });

      // Add campaign filter if specified
      if (campaignId) {
        params.append('campaignId', campaignId);
      }

      const response = await apiClient.get<MetricsApiResponse>(
        `/api/v1/reporting/metrics?${params}`
      );

      if (response.error) {
        throw new Error(response.error.message);
      }

      const data = response.data?.metrics;

      if (!data) {
        throw new Error('No metrics data received');
      }

      // Calculate derived metrics
      const totalCalls = data.totalCalls || 0;
      const billableCalls = data.completedCalls || 0;
      const missedCalls = data.missedCalls ?? data.failedCalls ?? 0;
      const consecutiveMissed = data.consecutiveMissed ?? 0;
      const missedPercentage = totalCalls > 0 ? (missedCalls / totalCalls) * 100 : 0;

      setMetrics({
        totalCalls,
        billableCalls,
        totalRevenue: data.totalRevenue ?? data.totalCost ?? 0,
        totalCost: data.totalCost || 0,
        missedCalls,
        consecutiveMissed,
        missedPercentage,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch metrics');
      // Set default values on error
      setMetrics({
        totalCalls: 0,
        billableCalls: 0,
        totalRevenue: 0,
        totalCost: 0,
        missedCalls: 0,
        consecutiveMissed: 0,
        missedPercentage: 0,
      });
    } finally {
      setLoading(false);
    }
  }, [campaignId, dateRange]);

  useEffect(() => {
    fetchMetrics();
    // Refresh every 30 seconds
    const interval = setInterval(fetchMetrics, 30000);
    return () => clearInterval(interval);
  }, [fetchMetrics]);

  // Alert condition: > 10 consecutive missed OR > 30% missed
  const isAlertState =
    (metrics?.consecutiveMissed ?? 0) > 10 || (metrics?.missedPercentage ?? 0) > 30;

  const formatCurrency = (value: number): string => {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(1)}K`;
    return `$${value.toFixed(2)}`;
  };

  const formatNumber = (value: number): string => {
    return value.toLocaleString();
  };

  return (
    <div className="w-full max-w-6xl space-y-4">
      {error && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
          {error} - Showing default values
        </div>
      )}

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-5">
        {/* 1. Total Calls */}
        <KPICard
          title="Total Calls"
          value={formatNumber(metrics?.totalCalls ?? 0)}
          icon={Phone}
          loading={loading}
          variant="default"
        />

        {/* 2. Billable Calls */}
        <KPICard
          title="Billable Calls"
          value={formatNumber(metrics?.billableCalls ?? 0)}
          icon={CheckCircle}
          loading={loading}
          variant="revenue"
        />

        {/* 3. Total Revenue */}
        <KPICard
          title="Total Revenue"
          value={formatCurrency(metrics?.totalRevenue ?? 0)}
          icon={DollarSign}
          loading={loading}
          variant="revenue"
        />

        {/* 4. Total Cost */}
        <KPICard
          title="Total Cost"
          value={formatCurrency(metrics?.totalCost ?? 0)}
          icon={XCircle}
          loading={loading}
          variant="warning"
        />

        {/* 5. Missed Calls - WITH ALERT LOGIC */}
        <KPICard
          title="Missed Calls"
          value={formatNumber(metrics?.missedCalls ?? 0)}
          icon={PhoneMissed}
          loading={loading}
          variant={isAlertState ? 'alarm' : 'default'}
          isAlarm={isAlertState}
          subtitle={metrics ? `${metrics.missedPercentage.toFixed(1)}% of total` : undefined}
        />
      </div>
    </div>
  );
}

// ============================================================================
// KPI Card Component (Internal)
// ============================================================================

interface KPICardProps {
  title: string;
  value: string;
  icon: React.ElementType;
  loading?: boolean;
  variant?: 'default' | 'revenue' | 'warning' | 'alarm';
  isAlarm?: boolean;
  subtitle?: string;
}

function KPICard({
  title,
  value,
  icon: Icon,
  loading,
  variant = 'default',
  isAlarm = false,
  subtitle,
}: KPICardProps) {
  const variantStyles = {
    default: 'bg-panel/60 border-white/10',
    revenue: 'bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 border-emerald-500/20',
    warning: 'bg-gradient-to-br from-amber-500/10 to-amber-600/5 border-amber-500/20',
    alarm: 'bg-gradient-to-br from-red-600/20 to-red-800/10 border-red-500/50',
  };

  const iconStyles = {
    default: 'text-neon-cyan',
    revenue: 'text-emerald-400',
    warning: 'text-amber-400',
    alarm: 'text-red-400',
  };

  const valueStyles = {
    default: 'text-text-primary',
    revenue: 'text-emerald-400',
    warning: 'text-amber-400',
    alarm: 'text-red-400',
  };

  // Alarm pulse animation
  const cardContent = (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border p-5 backdrop-blur-sm transition-all duration-200',
        variantStyles[variant],
        isAlarm && 'shadow-[0_0_20px_rgba(239,68,68,0.3)]'
      )}
    >
      {/* Background Icon */}
      <div className="absolute -right-4 -top-4 opacity-5">
        <Icon className="h-24 w-24" />
      </div>

      <div className="relative z-10 space-y-3">
        {/* Title */}
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs font-medium text-text-muted uppercase tracking-wider">
            {title}
          </span>
          <Icon className={cn('h-4 w-4', iconStyles[variant])} />
        </div>

        {/* Value - JetBrains Mono */}
        <div className="flex items-baseline gap-1.5">
          {loading ? (
            <div className="h-9 w-24 animate-pulse rounded bg-white/10" />
          ) : (
            <span
              className={cn(
                'font-mono text-3xl font-bold tracking-tight tabular-nums',
                valueStyles[variant]
              )}
              style={{ fontFamily: "'JetBrains Mono', monospace" }}
            >
              {value}
            </span>
          )}
        </div>

        {/* Subtitle (for missed calls %) */}
        {subtitle && !loading && (
          <p className="font-mono text-[10px] text-text-muted uppercase tracking-wider">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );

  // Wrap with pulse animation if alarm state
  if (isAlarm) {
    return (
      <motion.div
        animate={{
          boxShadow: [
            '0 0 0 0 rgba(239, 68, 68, 0)',
            '0 0 0 8px rgba(239, 68, 68, 0.3)',
            '0 0 0 0 rgba(239, 68, 68, 0)',
          ],
        }}
        transition={{
          duration: 1.5,
          repeat: Infinity,
          ease: 'easeInOut',
        }}
        className="rounded-xl"
      >
        {cardContent}
      </motion.div>
    );
  }

  return cardContent;
}

export default SanitizedKPIs;
