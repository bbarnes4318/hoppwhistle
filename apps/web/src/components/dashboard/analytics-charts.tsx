'use client';

/**
 * Project Cortex | Neon Stream Analytics Charts
 *
 * Stream Graphs with glowing "neon tubing" effect.
 * - Inbound Traffic: Electric Cyan (#00E5FF)
 * - Sales/Conversions: Neon Mint (#00FF9F)
 *
 * Uses existing callStats/data fetching logic (Iron Dome compliant).
 */

import { useEffect, useState } from 'react';
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

import { CommandPanel } from '@/components/ui/command-grid';
import { apiClient } from '@/lib/api';

// Neon Stream Colors
const NEON_COLORS = {
  cyan: '#00E5FF', // Electric Cyan - Inbound Traffic
  mint: '#00FF9F', // Neon Mint - Sales/Conversions
  violet: '#9C4AFF', // Hyper-Violet - ASR/Performance
  lime: '#CCFF00', // Toxic Lime - Revenue
};

// Glow filter for neon effect
const GLOW_FILTER = `drop-shadow(0 0 4px ${NEON_COLORS.cyan})`;

interface AnalyticsFilters {
  startDate?: string;
  endDate?: string;
  campaignId?: string;
  publisherId?: string;
  buyerId?: string;
  granularity?: 'hour' | 'day';
}

interface MetricsData {
  period: {
    start: string;
    end: string;
  };
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

// Custom tooltip with Neon Stream styling
function NeonTooltip({
  active,
  payload,
  label,
  formatter,
}: {
  active?: boolean;
  payload?: Array<{ value: number; dataKey: string; color: string }>;
  label?: string;
  formatter?: (value: number) => string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="glass-panel rounded-lg p-3 border border-grid-line">
      <p className="font-mono text-xs text-text-muted mb-2">{label}</p>
      {payload.map((entry, index) => (
        <div key={index} className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: entry.color, boxShadow: `0 0 6px ${entry.color}` }}
          />
          <span className="font-mono text-sm" style={{ color: entry.color }}>
            {formatter ? formatter(entry.value) : entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export function AnalyticsCharts({ filters }: { filters?: AnalyticsFilters }) {
  const [data, setData] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadMetrics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const generateMockData = (): MetricsData => {
    const demoMode = localStorage.getItem('demoMode') === 'true';
    if (!demoMode) {
      throw new Error('Cannot generate mock data when not in demo mode');
    }

    const startDate = filters?.startDate
      ? new Date(filters.startDate)
      : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const endDate = filters?.endDate ? new Date(filters.endDate) : new Date();
    const granularity = filters?.granularity || 'hour';

    const hours =
      granularity === 'hour'
        ? Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60))
        : Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

    const breakdown = Array.from({ length: Math.min(hours, 24) }, (_, i) => {
      const timestamp = new Date(
        startDate.getTime() + i * (granularity === 'hour' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000)
      );
      const totalCalls = Math.floor(Math.random() * 50) + 20;
      const answeredCalls = Math.floor(totalCalls * (0.4 + Math.random() * 0.3));
      const asr = answeredCalls / totalCalls;
      const aht = Math.floor(Math.random() * 300) + 120;
      const billableMinutes = Math.floor(answeredCalls * (aht / 60));
      const cost = billableMinutes * (0.01 + Math.random() * 0.02);

      return {
        timestamp: timestamp.toISOString(),
        totalCalls,
        answeredCalls,
        asr,
        aht,
        billableMinutes,
        cost,
      };
    });

    const totalCalls = breakdown.reduce((sum, row) => sum + row.totalCalls, 0);
    const answeredCalls = breakdown.reduce((sum, row) => sum + row.answeredCalls, 0);
    const completedCalls = Math.floor(answeredCalls * 0.85);
    const failedCalls = totalCalls - answeredCalls;
    const totalDuration = breakdown.reduce((sum, row) => sum + row.answeredCalls * row.aht, 0);
    const totalBillableMinutes = breakdown.reduce((sum, row) => sum + row.billableMinutes, 0);
    const totalCost = breakdown.reduce((sum, row) => sum + row.cost, 0);
    const averageDuration = answeredCalls > 0 ? totalDuration / answeredCalls : 0;
    const asr = totalCalls > 0 ? answeredCalls / totalCalls : 0;
    const aht = answeredCalls > 0 ? totalDuration / answeredCalls : 0;

    return {
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString(),
      },
      metrics: {
        totalCalls,
        answeredCalls,
        completedCalls,
        failedCalls,
        totalDuration,
        totalBillableMinutes,
        totalCost,
        averageDuration,
        asr,
        aht,
        conversionRate: completedCalls > 0 ? Math.floor(completedCalls * 0.15) / completedCalls : 0,
      },
      breakdown,
    };
  };

  const loadMetrics = async () => {
    setLoading(true);
    setError(null);
    const demoMode = localStorage.getItem('demoMode') === 'true';

    try {
      const params = new URLSearchParams();
      if (filters?.startDate) params.append('startDate', filters.startDate);
      if (filters?.endDate) params.append('endDate', filters.endDate);
      if (filters?.campaignId) params.append('campaignId', filters.campaignId);
      if (filters?.publisherId) params.append('publisherId', filters.publisherId);
      if (filters?.buyerId) params.append('buyerId', filters.buyerId);
      if (filters?.granularity) params.append('granularity', filters.granularity);

      const response = await apiClient.get<MetricsData>(
        `/api/v1/reporting/metrics?${params.toString()}`
      );

      if (response.data) {
        setData(response.data);
      } else if (demoMode && response.error?.code === 'NETWORK_ERROR') {
        console.warn('API unavailable in demo mode, using mock data');
        setData(generateMockData());
      } else {
        setError(response.error?.message || 'Failed to load metrics');
      }
    } catch (err) {
      if (demoMode) {
        console.warn('API error in demo mode, using mock data:', err);
        try {
          setData(generateMockData());
        } catch {
          setError(err instanceof Error ? err.message : 'Failed to load metrics');
        }
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load metrics');
      }
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <CommandPanel title="Loading..." variant="default">
          <div className="h-[300px] flex items-center justify-center">
            <div className="text-text-muted font-mono text-sm">VECTORING DATA...</div>
          </div>
        </CommandPanel>
        <CommandPanel title="Loading..." variant="default">
          <div className="h-[300px] flex items-center justify-center">
            <div className="text-text-muted font-mono text-sm">VECTORING DATA...</div>
          </div>
        </CommandPanel>
      </div>
    );
  }

  if (error) {
    return (
      <CommandPanel title="Error" variant="default">
        <div className="text-center text-status-error font-mono">{error}</div>
      </CommandPanel>
    );
  }

  if (!data || data.breakdown.length === 0) {
    return (
      <CommandPanel title="No Data" variant="default">
        <div className="text-center text-text-muted font-mono">NO SIGNAL DETECTED</div>
      </CommandPanel>
    );
  }

  const chartData = data.breakdown.map(row => {
    const date = new Date(row.timestamp);
    return {
      time: date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: date.getHours() !== 0 || filters?.granularity === 'hour' ? '2-digit' : undefined,
        minute: filters?.granularity === 'hour' ? '2-digit' : undefined,
      }),
      calls: row.totalCalls,
      answered: row.answeredCalls,
      asr: row.asr,
      aht: row.aht,
      billableMinutes: row.billableMinutes,
      cost: row.cost,
      // Derived: conversions (simulated)
      conversions: Math.floor(row.answeredCalls * 0.15),
    };
  });

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Inbound Traffic Stream - Electric Cyan */}
      <CommandPanel
        title="Inbound Signal Flow"
        telemetry={filters?.granularity === 'day' ? 'DAILY' : 'HOURLY'}
        variant="default"
      >
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="gradientCyan" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={NEON_COLORS.cyan} stopOpacity={0.4} />
                <stop offset="100%" stopColor={NEON_COLORS.cyan} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#273140" vertical={false} />
            <XAxis
              dataKey="time"
              tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'JetBrains Mono' }}
              axisLine={{ stroke: '#273140' }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'JetBrains Mono' }}
              axisLine={{ stroke: '#273140' }}
              tickLine={false}
            />
            <Tooltip content={<NeonTooltip />} />
            <Area
              type="monotone"
              dataKey="calls"
              stroke={NEON_COLORS.cyan}
              strokeWidth={2}
              fill="url(#gradientCyan)"
              style={{ filter: GLOW_FILTER }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CommandPanel>

      {/* Conversions Stream - Neon Mint */}
      <CommandPanel title="Conversion Velocity" telemetry="SALES STREAM" variant="default">
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="gradientMint" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={NEON_COLORS.mint} stopOpacity={0.4} />
                <stop offset="100%" stopColor={NEON_COLORS.mint} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#273140" vertical={false} />
            <XAxis
              dataKey="time"
              tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'JetBrains Mono' }}
              axisLine={{ stroke: '#273140' }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'JetBrains Mono' }}
              axisLine={{ stroke: '#273140' }}
              tickLine={false}
            />
            <Tooltip content={<NeonTooltip />} />
            <Area
              type="monotone"
              dataKey="conversions"
              stroke={NEON_COLORS.mint}
              strokeWidth={2}
              fill="url(#gradientMint)"
              style={{ filter: `drop-shadow(0 0 4px ${NEON_COLORS.mint})` }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CommandPanel>

      {/* ASR Trend - Hyper-Violet */}
      <CommandPanel title="ASR Telemetry" telemetry="ANSWER SEIZURE RATIO" variant="default">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#273140" vertical={false} />
            <XAxis
              dataKey="time"
              tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'JetBrains Mono' }}
              axisLine={{ stroke: '#273140' }}
              tickLine={false}
            />
            <YAxis
              domain={[0, 1]}
              tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'JetBrains Mono' }}
              axisLine={{ stroke: '#273140' }}
              tickLine={false}
              tickFormatter={value => `${(value * 100).toFixed(0)}%`}
            />
            <Tooltip
              content={
                <NeonTooltip formatter={(value: number) => `${(value * 100).toFixed(1)}%`} />
              }
            />
            <Line
              type="monotone"
              dataKey="asr"
              stroke={NEON_COLORS.violet}
              strokeWidth={2}
              dot={false}
              style={{ filter: `drop-shadow(0 0 4px ${NEON_COLORS.violet})` }}
            />
          </LineChart>
        </ResponsiveContainer>
      </CommandPanel>

      {/* Billable Minutes Stream - Toxic Lime */}
      <CommandPanel title="Revenue Stream" telemetry="BILLABLE MINUTES" variant="default">
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="gradientLime" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={NEON_COLORS.lime} stopOpacity={0.4} />
                <stop offset="100%" stopColor={NEON_COLORS.lime} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#273140" vertical={false} />
            <XAxis
              dataKey="time"
              tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'JetBrains Mono' }}
              axisLine={{ stroke: '#273140' }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: '#64748b', fontSize: 10, fontFamily: 'JetBrains Mono' }}
              axisLine={{ stroke: '#273140' }}
              tickLine={false}
            />
            <Tooltip content={<NeonTooltip />} />
            <Area
              type="monotone"
              dataKey="billableMinutes"
              stroke={NEON_COLORS.lime}
              strokeWidth={2}
              fill="url(#gradientLime)"
              style={{ filter: `drop-shadow(0 0 4px ${NEON_COLORS.lime})` }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CommandPanel>
    </div>
  );
}
