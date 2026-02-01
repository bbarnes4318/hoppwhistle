'use client';

import { BarChart3, Clock, DollarSign, Phone, TrendingUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { apiClient } from '@/lib/api';

interface BuyerStats {
  callsHour: number;
  callsDay: number;
  callsMonth: number;
  revenueDay: number;
  revenueMonth: number;
}

interface HourlyData {
  hour: string;
  calls: number;
}

export default function BuyerDashboardPage() {
  const [stats, setStats] = useState<BuyerStats | null>(null);
  const [hourlyData, setHourlyData] = useState<HourlyData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Get buyer stats - we need the buyerId from user context
        // For now, we'll simulate with placeholder data
        // In production, this would use the user's linked buyerId

        // Simulated data for now
        setStats({
          callsHour: 12,
          callsDay: 156,
          callsMonth: 2847,
          revenueDay: 4680,
          revenueMonth: 85410,
        });

        // Generate hourly data for chart
        const hours: HourlyData[] = [];
        for (let i = 0; i < 24; i++) {
          const hour = i.toString().padStart(2, '0') + ':00';
          // Simulate call volume with peak hours 9am-5pm
          const baseCalls =
            i >= 9 && i <= 17 ? Math.floor(Math.random() * 15) + 5 : Math.floor(Math.random() * 5);
          hours.push({ hour, calls: baseCalls });
        }
        setHourlyData(hours);
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    void fetchData();
  }, []);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <BarChart3 className="h-6 w-6" />
          Dashboard
        </h1>
        <p className="text-sm text-muted-foreground">Overview of your call performance and spend</p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Calls Today */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Calls Today</CardTitle>
            <Phone className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <div className="text-2xl font-bold">{stats?.callsDay ?? 0}</div>
                <p className="text-xs text-muted-foreground">+{stats?.callsHour ?? 0} this hour</p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Spend Today */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Spend Today</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  ${(stats?.revenueDay ?? 0).toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground">
                  ${(stats?.revenueMonth ?? 0).toLocaleString()} this month
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Avg Duration */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Duration</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <div className="text-2xl font-bold">4:32</div>
                <p className="text-xs text-muted-foreground">Minutes per call</p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Conversion Rate */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Conversion</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <div className="text-2xl font-bold">24%</div>
                <p className="text-xs text-muted-foreground">Of qualified calls</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Hourly Call Volume Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Hourly Call Volume</CardTitle>
          <CardDescription>Number of calls received per hour today</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-[300px] w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={hourlyData}>
                <XAxis
                  dataKey="hour"
                  stroke="#888888"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="#888888"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={value => `${value}`}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="rounded-lg border bg-background p-2 shadow-sm">
                          <div className="grid grid-cols-2 gap-2">
                            <div className="flex flex-col">
                              <span className="text-[0.70rem] uppercase text-muted-foreground">
                                Time
                              </span>
                              <span className="font-bold text-muted-foreground">
                                {payload[0].payload.hour}
                              </span>
                            </div>
                            <div className="flex flex-col">
                              <span className="text-[0.70rem] uppercase text-muted-foreground">
                                Calls
                              </span>
                              <span className="font-bold">{payload[0].value}</span>
                            </div>
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar dataKey="calls" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
