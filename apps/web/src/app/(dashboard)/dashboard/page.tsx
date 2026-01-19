'use client';

import { useState } from 'react';
import { Calendar, RefreshCw } from 'lucide-react';

import { DashboardKPIs } from '@/components/dashboard/dashboard-kpis';
import { SalesFunnel } from '@/components/dashboard/sales-funnel';
import { TopPerformers } from '@/components/dashboard/top-performers';
import { CallIntelligence } from '@/components/dashboard/call-intelligence';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type DatePreset = 'today' | '7d' | '30d' | 'custom';

export default function DashboardPage() {
  const [datePreset, setDatePreset] = useState<DatePreset>('today');
  const [filters, setFilters] = useState<{
    billable?: boolean;
    sold?: boolean;
    campaign?: string;
  }>({});

  const getDateRange = () => {
    const now = new Date();
    switch (datePreset) {
      case 'today':
        return { start: new Date(now.setHours(0, 0, 0, 0)), end: new Date() };
      case '7d':
        return { start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), end: new Date() };
      case '30d':
        return { start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), end: new Date() };
      default:
        return { start: new Date(now.getTime() - 24 * 60 * 60 * 1000), end: new Date() };
    }
  };

  const handleFilterChange = (filter: { type: string; value: string }) => {
    switch (filter.type) {
      case 'billable':
        setFilters(f => ({ ...f, billable: filter.value === 'true' }));
        break;
      case 'sale':
        setFilters(f => ({ ...f, sold: filter.value === 'true' }));
        break;
      case 'status':
        setFilters({});
        break;
    }
  };

  const handleRefresh = () => {
    window.location.reload();
  };

  return (
    <div className="h-full flex flex-col overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Command Center</h1>
          <p className="text-muted-foreground mt-1">
            Real-time call analytics and revenue insights
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Date Presets */}
          <div className="flex items-center gap-1 rounded-lg border bg-muted/30 p-1">
            {(['today', '7d', '30d'] as DatePreset[]).map(preset => (
              <Button
                key={preset}
                variant={datePreset === preset ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setDatePreset(preset)}
                className={cn(
                  'h-8 px-3',
                  datePreset === preset && 'bg-primary text-primary-foreground shadow-sm'
                )}
              >
                {preset === 'today' ? 'Today' : preset.toUpperCase()}
              </Button>
            ))}
            <Button
              variant={datePreset === 'custom' ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setDatePreset('custom')}
              className="h-8 px-3"
            >
              <Calendar className="h-4 w-4" />
            </Button>
          </div>
          <Button variant="outline" size="icon" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* KPI Cards - Above the Fold */}
      <section className="flex-shrink-0 mb-6">
        <DashboardKPIs dateRange={getDateRange()} onFilterChange={handleFilterChange} />
      </section>

      {/* Mid-Page Insights Grid - 2 columns */}
      <section className="grid gap-6 lg:grid-cols-2 mb-6 flex-shrink-0">
        <SalesFunnel onStageClick={stage => console.log('Stage clicked:', stage)} />
        <TopPerformers />
      </section>

      {/* Call Intelligence Section */}
      <section className="flex-1 min-h-0">
        <CallIntelligence filters={filters} />
      </section>
    </div>
  );
}
