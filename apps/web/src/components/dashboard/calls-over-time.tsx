'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

type TimeRange = 'day' | 'week' | 'month';

interface ChartDataPoint {
  time: string;
  billable: number;
  nonBillable: number;
  total: number;
}

interface MetricsApiResponse {
  period: { start: string; end: string };
  metrics: any;
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

interface CallsOverTimeProps {
  onPeriodSelect?: (start: Date, end: Date) => void;
}

export function CallsOverTime({ onPeriodSelect }: CallsOverTimeProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('day');
  const [data, setData] = useState<ChartDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getDateRange = useCallback((range: TimeRange) => {
    const end = new Date();
    let start: Date;
    let granularity: 'hour' | 'day';

    switch (range) {
      case 'day':
        start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
        granularity = 'hour';
        break;
      case 'week':
        start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
        granularity = 'day';
        break;
      case 'month':
        start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
        granularity = 'day';
        break;
    }

    return { start, end, granularity };
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const { start, end, granularity } = getDateRange(timeRange);

      const params = new URLSearchParams({
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        granularity,
      });

      const response = await apiClient.get<MetricsApiResponse>(
        `/api/v1/reporting/metrics?${params}`
      );

      if (response.error) {
        throw new Error(response.error.message);
      }

      const breakdown = response.data?.breakdown || [];

      const chartData: ChartDataPoint[] = breakdown.map(item => {
        const date = new Date(item.timestamp);
        const billable = Math.floor(item.answeredCalls * 0.7); // Estimate billable as 70% of answered
        const nonBillable = item.totalCalls - billable;

        let timeLabel: string;
        if (timeRange === 'day') {
          timeLabel = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        } else {
          timeLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }

        return {
          time: timeLabel,
          billable,
          nonBillable,
          total: item.totalCalls,
        };
      });

      setData(chartData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [timeRange, getDateRange]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload) return null;

    return (
      <div className="rounded-lg border bg-popover p-3 shadow-lg">
        <p className="mb-2 font-medium text-foreground">{label}</p>
        {payload.map((entry: any, index: number) => (
          <div key={index} className="flex items-center gap-2 text-sm">
            <div className="h-2 w-2 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="text-muted-foreground">{entry.name}:</span>
            <span className="font-medium">{entry.value}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <Card className="col-span-full lg:col-span-2">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-base font-semibold">Calls Over Time</CardTitle>
        <div className="flex items-center gap-1">
          {(['day', 'week', 'month'] as TimeRange[]).map(range => (
            <Button
              key={range}
              variant={timeRange === range ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setTimeRange(range)}
              className={cn(
                'h-7 px-3 text-xs',
                timeRange === range && 'bg-primary text-primary-foreground'
              )}
            >
              {range === 'day' ? '24H' : range === 'week' ? '7D' : '30D'}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/10 p-2 text-xs text-amber-600">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex h-[280px] items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : data.length === 0 ? (
          <div className="flex h-[280px] items-center justify-center text-muted-foreground">
            No call data available
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="billableGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(160 100% 41%)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(160 100% 41%)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="nonBillableGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(45 100% 51%)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(45 100% 51%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                className="fill-muted-foreground"
              />
              <YAxis
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                className="fill-muted-foreground"
              />
              <Tooltip content={<CustomTooltip />} />
              <Legend
                wrapperStyle={{ paddingTop: '16px' }}
                formatter={value => <span className="text-xs text-muted-foreground">{value}</span>}
              />
              <Area
                type="monotone"
                dataKey="billable"
                name="Billable"
                stackId="1"
                stroke="hsl(160 100% 41%)"
                fill="url(#billableGradient)"
                strokeWidth={2}
              />
              <Area
                type="monotone"
                dataKey="nonBillable"
                name="Non-Billable"
                stackId="1"
                stroke="hsl(45 100% 51%)"
                fill="url(#nonBillableGradient)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
