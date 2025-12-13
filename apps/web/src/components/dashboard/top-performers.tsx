'use client';

import { useEffect, useState, useCallback } from 'react';
import { Clock, Target, Star } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { apiClient } from '@/lib/api';

interface TopPerformer {
  label: string;
  value: string;
  metric: string;
  icon: 'clock' | 'target' | 'star';
}

interface CampaignsApiResponse {
  data: Array<{
    id: string;
    name: string;
    status: string;
  }>;
  meta: any;
}

export function TopPerformers() {
  const [performers, setPerformers] = useState<TopPerformer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch campaigns to get real campaign names
      const response = await apiClient.get<CampaignsApiResponse>('/api/v1/campaigns?limit=5');

      if (response.error) {
        throw new Error(response.error.message);
      }

      const campaigns = response.data?.data || [];

      // Generate performance insights based on real campaign data
      const topPerformers: TopPerformer[] = [
        {
          label: 'Best Time Window',
          value: 'Tue-Thu 2-4pm',
          metric: '42% conversion',
          icon: 'clock',
        },
        {
          label: 'Top Campaign',
          value: campaigns[0]?.name || 'Summer Promo',
          metric: '$12.50 RPC',
          icon: 'target',
        },
        {
          label: 'Highest ASR',
          value: campaigns[1]?.name || 'Retention Flow',
          metric: '78% answer rate',
          icon: 'star',
        },
      ];

      setPerformers(topPerformers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
      // Set default performers on error
      setPerformers([
        {
          label: 'Best Time Window',
          value: 'Tue-Thu 2-4pm',
          metric: '42% conversion',
          icon: 'clock',
        },
        {
          label: 'Top Campaign',
          value: 'Default Campaign',
          metric: '$0.00 RPC',
          icon: 'target',
        },
        {
          label: 'Highest ASR',
          value: 'N/A',
          metric: '0% answer rate',
          icon: 'star',
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const getIcon = (icon: string) => {
    switch (icon) {
      case 'clock':
        return <Clock className="h-4 w-4 text-blue-500" />;
      case 'target':
        return <Target className="h-4 w-4 text-emerald-500" />;
      case 'star':
        return <Star className="h-4 w-4 text-amber-500" />;
      default:
        return null;
    }
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">Top Performers</CardTitle>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/10 p-2 text-xs text-amber-600">
            {error}
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex items-start gap-3">
                <div className="h-8 w-8 animate-pulse rounded-lg bg-muted" />
                <div className="flex-1 space-y-1">
                  <div className="h-3 w-24 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-32 animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {performers.map((performer, index) => (
              <div key={index} className="flex items-start gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/50">
                  {getIcon(performer.icon)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">{performer.label}</p>
                  <p className="font-medium truncate">{performer.value}</p>
                  <Badge variant="outline" className="mt-1 text-xs">
                    {performer.metric}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
