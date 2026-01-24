'use client';

/**
 * Project Cortex | Command Center Dashboard
 *
 * Real-time call analytics with Command Grid layout.
 */

import { useState } from 'react';
import { Calendar, RefreshCw } from 'lucide-react';

import { DashboardKPIs } from '@/components/dashboard/dashboard-kpis';
import { SalesFunnel } from '@/components/dashboard/sales-funnel';
import { TopPerformers } from '@/components/dashboard/top-performers';
import { CallIntelligence } from '@/components/dashboard/call-intelligence';
import { Button } from '@/components/ui/button';
import { CommandGrid, CommandPanel, CommandHeader } from '@/components/ui/command-grid';
import { NeuralOrb } from '@/components/ui/neural-orb';
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
      {/* Command Header */}
      <CommandHeader
        title="Command Center"
        subtitle="VECTORING // REAL-TIME TELEMETRY"
        actions={
          <div className="flex items-center gap-4">
            {/* Neural Orb Status */}
            <div className="flex items-center gap-3">
              <NeuralOrb size="sm" />
              <span className="telemetry-label hidden md:block">SYSTEM ACTIVE</span>
            </div>

            {/* Date Presets */}
            <div className="flex items-center gap-1 rounded-lg border border-grid-line bg-surface-panel/50 p-1">
              {(['today', '7d', '30d'] as DatePreset[]).map(preset => (
                <Button
                  key={preset}
                  variant={datePreset === preset ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setDatePreset(preset)}
                  className={cn(
                    'h-8 px-3 font-mono text-xs',
                    datePreset === preset
                      ? 'bg-brand-cyan text-surface-dark'
                      : 'text-text-secondary hover:text-text-primary hover:bg-grid-line/50'
                  )}
                >
                  {preset === 'today' ? 'TODAY' : preset.toUpperCase()}
                </Button>
              ))}
              <Button
                variant={datePreset === 'custom' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setDatePreset('custom')}
                className={cn(
                  'h-8 px-3',
                  datePreset === 'custom'
                    ? 'bg-brand-cyan text-surface-dark'
                    : 'text-text-secondary hover:text-text-primary'
                )}
              >
                <Calendar className="h-4 w-4" />
              </Button>
            </div>

            {/* Refresh */}
            <Button
              variant="outline"
              size="icon"
              onClick={handleRefresh}
              className="border-grid-line text-text-secondary hover:text-brand-cyan hover:border-brand-cyan"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      {/* KPI Cards - Above the Fold */}
      <section className="flex-shrink-0 mb-6">
        <DashboardKPIs dateRange={getDateRange()} onFilterChange={handleFilterChange} />
      </section>

      {/* Mid-Page Insights Grid */}
      <CommandGrid columns={2} gap="md" className="mb-6 flex-shrink-0">
        <CommandPanel title="Sales Funnel" telemetry="LIVE" variant="default">
          <SalesFunnel onStageClick={stage => console.log('Stage clicked:', stage)} />
        </CommandPanel>
        <CommandPanel title="Top Performers" telemetry="24H" variant="default">
          <TopPerformers />
        </CommandPanel>
      </CommandGrid>

      {/* Call Intelligence Section */}
      <CommandPanel
        title="Call Intelligence"
        telemetry="VECTORING"
        variant="accent"
        className="flex-1 min-h-0"
      >
        <CallIntelligence filters={filters} />
      </CommandPanel>
    </div>
  );
}
