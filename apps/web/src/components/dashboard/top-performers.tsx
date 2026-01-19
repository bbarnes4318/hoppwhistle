'use client';

import { useEffect, useState, useCallback } from 'react';
import { Clock, Target, Star, TrendingUp } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiClient } from '@/lib/api';

interface MetricsApiResponse {
  metrics: {
    totalCalls: number;
    answeredCalls: number;
    completedCalls: number;
    asr: number;
    aht: number;
    conversionRate?: number;
    totalCost: number;
  };
  breakdown: Array<{
    timestamp: string;
    totalCalls: number;
    answeredCalls: number;
    asr: number;
    cost: number;
  }>;
}

interface CampaignsApiResponse {
  data: Array<{
    id: string;
    name: string;
    status: string;
  }>;
}

interface PerformerMetric {
  label: string;
  value: string;
  subtext: string;
  icon: React.ReactNode;
  color: string;
}

export function TopPerformers() {
  const [metrics, setMetrics] = useState<PerformerMetric[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const now = new Date();
      const startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

      const params = new URLSearchParams({
        startDate: startDate.toISOString(),
        endDate: now.toISOString(),
        granularity: 'day',
      });

      const [metricsResp, campaignsResp] = await Promise.all([
        apiClient.get<MetricsApiResponse>(`/api/v1/reporting/metrics?${params}`),
        apiClient.get<CampaignsApiResponse>('/api/v1/campaigns?limit=5'),
      ]);

      const data = metricsResp.data?.metrics;
      const campaigns = campaignsResp.data?.data || [];
      const breakdown = metricsResp.data?.breakdown || [];

      // Find best performing time window from breakdown
      const bestHour = breakdown.reduce(
        (best, curr) => (curr.asr > (best?.asr || 0) ? curr : best),
        breakdown[0]
      );

      const bestTimeLabel = bestHour
        ? new Date(bestHour.timestamp).toLocaleString('en-US', {
            weekday: 'short',
            hour: 'numeric',
          })
        : 'N/A';

      const topCampaign = campaigns[0]?.name || 'No campaigns';
      const asr = data?.asr || 0;
      const convRate = data?.conversionRate || 0;

      setMetrics([
        {
          label: 'Best Time',
          value: bestTimeLabel,
          subtext: `${(bestHour?.asr || 0).toFixed(0)}% ASR`,
          icon: <Clock className="h-4 w-4" />,
          color: 'text-blue-500',
        },
        {
          label: 'Top Campaign',
          value: topCampaign.length > 12 ? topCampaign.slice(0, 12) + '…' : topCampaign,
          subtext: `${(convRate * 100).toFixed(0)}% conv`,
          icon: <Target className="h-4 w-4" />,
          color: 'text-emerald-500',
        },
        {
          label: 'Answer Rate',
          value: `${asr.toFixed(0)}%`,
          subtext: 'ASR',
          icon: <Star className="h-4 w-4" />,
          color: 'text-amber-500',
        },
        {
          label: 'Conversion',
          value: `${(convRate * 100).toFixed(1)}%`,
          subtext: 'of billable',
          icon: <TrendingUp className="h-4 w-4" />,
          color: 'text-purple-500',
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
      setMetrics([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">Top Performers</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        {error && (
          <div className="mb-3 rounded border border-amber-500/20 bg-amber-500/10 p-2 text-xs text-amber-600">
            {error}
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {metrics.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2 rounded-lg bg-muted/50 p-3">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-md bg-background ${item.color}`}
                >
                  {item.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {item.label}
                  </p>
                  <p className="truncate text-sm font-semibold">{item.value}</p>
                  <p className="text-[10px] text-muted-foreground">{item.subtext}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
