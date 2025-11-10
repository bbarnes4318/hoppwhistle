'use client';

import { PhoneCall, TrendingUp, DollarSign, Target } from 'lucide-react';
import { useEffect, useState } from 'react';

import { useWebSocket } from '@/components/hooks/use-websocket';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { mockData } from '@/lib/api';
import { formatDuration } from '@/lib/utils';

export function LiveStats() {
  const [stats, setStats] = useState({
    activeCalls: 0,
    asr: 0,
    aht: 0,
    billableMinutes: 0,
    cpa: { conversions: 0, revenue: 0 },
  });

  const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001';
  // Only enable WebSocket if backend is likely available (check happens in hook)
  const { isConnected } = useWebSocket(`${wsUrl}/ws/events`, {
    enabled: true, // Hook will check backend availability internally
    onMessage: (message) => {
      // Update stats based on real-time events
      if (message.type === 'event' && (message).payload?.event === 'call.completed') {
        setStats((prev) => ({
          ...prev,
          activeCalls: Math.max(0, prev.activeCalls - 1),
          billableMinutes: prev.billableMinutes + Math.floor(Math.random() * 5) + 1,
        }));
      } else if (message.type === 'event' && (message).payload?.event === 'call.started') {
        setStats((prev) => ({
          ...prev,
          activeCalls: prev.activeCalls + 1,
        }));
      }
    },
  });

  useEffect(() => {
    // Initialize with mock data
    setStats({
      activeCalls: mockData.activeCalls(),
      asr: mockData.asr(),
      aht: mockData.aht(),
      billableMinutes: mockData.billableMinutes(),
      cpa: mockData.cpaStats(),
    });

    // Update stats periodically
    const interval = setInterval(() => {
      setStats((prev) => ({
        ...prev,
        asr: mockData.asr(),
        aht: mockData.aht(),
      }));
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Active Calls</CardTitle>
          <PhoneCall className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.activeCalls}</div>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-500'}`} />
            {isConnected ? 'Live' : 'Disconnected'}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">ASR</CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{(stats.asr * 100).toFixed(1)}%</div>
          <p className="text-xs text-muted-foreground">Answer Seizure Ratio</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">AHT</CardTitle>
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{formatDuration(stats.aht)}</div>
          <p className="text-xs text-muted-foreground">Average Handle Time</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Billable Minutes</CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.billableMinutes.toLocaleString()}</div>
          <p className="text-xs text-muted-foreground">Today&apos;s total</p>
        </CardContent>
      </Card>
    </div>
  );
}

