'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { apiClient } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Calendar } from 'lucide-react';

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

    const startDate = filters?.startDate ? new Date(filters.startDate) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const endDate = filters?.endDate ? new Date(filters.endDate) : new Date();
    const granularity = filters?.granularity || 'hour';
    
    const hours = granularity === 'hour' 
      ? Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60))
      : Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
    
    const breakdown = Array.from({ length: Math.min(hours, 24) }, (_, i) => {
      const timestamp = new Date(startDate.getTime() + i * (granularity === 'hour' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000));
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
        conversionRate: completedCalls > 0 ? (Math.floor(completedCalls * 0.15) / completedCalls) : 0,
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

      const response = await apiClient.get<MetricsData>(`/api/v1/reporting/metrics?${params.toString()}`);
      
      if (response.data) {
        setData(response.data);
      } else if (demoMode && response.error?.code === 'NETWORK_ERROR') {
        // Fallback to mock data in demo mode if API is unavailable
        console.warn('API unavailable in demo mode, using mock data');
        setData(generateMockData());
      } else {
        setError(response.error?.message || 'Failed to load metrics');
      }
    } catch (err) {
      if (demoMode) {
        // Fallback to mock data in demo mode
        console.warn('API error in demo mode, using mock data:', err);
        try {
          setData(generateMockData());
        } catch (mockErr) {
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
        <Card>
          <CardHeader>
            <CardTitle>Loading...</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] flex items-center justify-center">Loading chart data...</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Loading...</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] flex items-center justify-center">Loading chart data...</div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-destructive">Error: {error}</div>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.breakdown.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-muted-foreground">No data available</div>
        </CardContent>
      </Card>
    );
  }

  const chartData = data.breakdown.map((row) => {
    const date = new Date(row.timestamp);
    return {
      time: date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: date.getHours() !== 0 || filters?.granularity === 'hour' ? '2-digit' : undefined,
        minute: filters?.granularity === 'hour' ? '2-digit' : undefined,
      }),
      calls: row.totalCalls,
      asr: row.asr,
      aht: row.aht,
      billableMinutes: row.billableMinutes,
      cost: row.cost,
    };
  });

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Call Volume</CardTitle>
          <CardDescription>
            {filters?.granularity === 'day' ? 'Daily' : 'Hourly'} breakdown
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="calls" fill="hsl(var(--primary))" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>ASR Trend</CardTitle>
          <CardDescription>
            Answer Seizure Ratio - {filters?.granularity === 'day' ? 'Daily' : 'Hourly'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" />
              <YAxis domain={[0, 1]} />
              <Tooltip formatter={(value: number) => `${(value * 100).toFixed(1)}%`} />
              <Line type="monotone" dataKey="asr" stroke="hsl(var(--primary))" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>AHT Trend</CardTitle>
          <CardDescription>
            Average Handle Time (seconds) - {filters?.granularity === 'day' ? 'Daily' : 'Hourly'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" />
              <YAxis />
              <Tooltip formatter={(value: number) => `${value}s`} />
              <Line type="monotone" dataKey="aht" stroke="hsl(var(--primary))" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Billable Minutes</CardTitle>
          <CardDescription>
            {filters?.granularity === 'day' ? 'Daily' : 'Hourly'} breakdown
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="billableMinutes" fill="hsl(var(--primary))" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}

