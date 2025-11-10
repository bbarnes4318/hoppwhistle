'use client';

import { Target, Filter } from 'lucide-react';
import { useState } from 'react';

import { AnalyticsCharts } from '@/components/dashboard/analytics-charts';
import { LiveStats } from '@/components/dashboard/live-stats';
import { DemoToggle } from '@/components/demo/demo-toggle';
import { ScreenshotButton } from '@/components/demo/screenshot-button';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export default function DashboardPage() {
  const [filters, setFilters] = useState<{
    startDate?: string;
    endDate?: string;
    campaignId?: string;
    publisherId?: string;
    buyerId?: string;
    granularity?: 'hour' | 'day';
  }>({
    granularity: 'hour',
  });

  const [showFilters, setShowFilters] = useState(false);

  // Set default date range (last 24 hours)
  const defaultStartDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
  const defaultEndDate = new Date().toISOString().slice(0, 16);

  const handleApplyFilters = () => {
    setFilters({
      ...filters,
      startDate: filters.startDate || defaultStartDate,
      endDate: filters.endDate || defaultEndDate,
    });
    setShowFilters(false);
  };

  return (
    <div id="dashboard" className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between flex-shrink-0 mb-4">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">Real-time call analytics and metrics</p>
        </div>
        <div className="flex items-center gap-4">
          <DemoToggle />
          <ScreenshotButton elementId="dashboard" filename="hopwhistle-dashboard.png" />
          <Button variant="outline" onClick={() => setShowFilters(!showFilters)}>
            <Filter className="mr-2 h-4 w-4" />
            Filters
          </Button>
        </div>
      </div>

      {showFilters && (
        <Card className="flex-shrink-0 mb-4">
          <CardHeader>
            <CardTitle>Filter Analytics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <Label htmlFor="startDate">Start Date</Label>
                <Input
                  id="startDate"
                  type="datetime-local"
                  value={filters.startDate || defaultStartDate}
                  onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="endDate">End Date</Label>
                <Input
                  id="endDate"
                  type="datetime-local"
                  value={filters.endDate || defaultEndDate}
                  onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="granularity">Granularity</Label>
                <Select
                  value={filters.granularity || 'hour'}
                  onValueChange={(value: 'hour' | 'day') =>
                    setFilters({ ...filters, granularity: value })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="hour">Hourly</SelectItem>
                    <SelectItem value="day">Daily</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="campaignId">Campaign ID (optional)</Label>
                <Input
                  id="campaignId"
                  value={filters.campaignId || ''}
                  onChange={(e) => setFilters({ ...filters, campaignId: e.target.value || undefined })}
                  placeholder="Filter by campaign"
                />
              </div>
              <div>
                <Label htmlFor="publisherId">Publisher ID (optional)</Label>
                <Input
                  id="publisherId"
                  value={filters.publisherId || ''}
                  onChange={(e) => setFilters({ ...filters, publisherId: e.target.value || undefined })}
                  placeholder="Filter by publisher"
                />
              </div>
              <div>
                <Label htmlFor="buyerId">Buyer ID (optional)</Label>
                <Input
                  id="buyerId"
                  value={filters.buyerId || ''}
                  onChange={(e) => setFilters({ ...filters, buyerId: e.target.value || undefined })}
                  placeholder="Filter by buyer"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <Button onClick={handleApplyFilters}>Apply Filters</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats Grid */}
      <div className="flex-shrink-0 mb-4">
        <LiveStats />
      </div>

      {/* Charts - Scrollable */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <AnalyticsCharts filters={filters} />
      </div>
    </div>
  );
}

