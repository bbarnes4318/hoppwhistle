'use client';

import { Calendar, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { CallIntelligence } from '@/components/dashboard/call-intelligence';
import { DashboardKPIs } from '@/components/dashboard/dashboard-kpis';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

type DatePreset = 'today' | '7d' | '30d' | 'custom';

interface Campaign {
  id: string;
  name: string;
}

interface CampaignsApiResponse {
  data: Campaign[];
}

export default function DashboardPage() {
  const [datePreset, setDatePreset] = useState<DatePreset>('today');
  const [selectedCampaign, setSelectedCampaign] = useState<string>('all');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [filters, setFilters] = useState<{
    billable?: boolean;
    sold?: boolean;
    campaign?: string;
  }>({});

  // Fetch campaigns for the dropdown
  const fetchCampaigns = useCallback(async () => {
    try {
      const response = await apiClient.get<CampaignsApiResponse>('/api/v1/campaigns');
      if (response.data?.data) {
        setCampaigns(response.data.data);
      }
    } catch {
      // Silently fail - dropdown will just show "All Campaigns"
    }
  }, []);

  useEffect(() => {
    void fetchCampaigns();
  }, [fetchCampaigns]);

  // Update filters when campaign selection changes
  useEffect(() => {
    setFilters(f => ({
      ...f,
      campaign: selectedCampaign === 'all' ? undefined : selectedCampaign,
    }));
  }, [selectedCampaign]);

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
        setFilters(f => ({ ...f, billable: undefined, sold: undefined }));
        break;
    }
  };

  const handleRefresh = () => {
    window.location.reload();
  };

  const campaignId = selectedCampaign === 'all' ? undefined : selectedCampaign;

  return (
    <div className="h-full flex flex-col overflow-auto">
      {/* Header - Ringba-style compact */}
      <div className="flex items-center justify-between flex-shrink-0 mb-4 pb-4 border-b">
        <h1 className="text-xl font-semibold tracking-tight">Command Center</h1>
        <div className="flex items-center gap-3">
          {/* Campaign Filter */}
          <Select value={selectedCampaign} onValueChange={setSelectedCampaign}>
            <SelectTrigger className="w-[200px] h-9">
              <SelectValue placeholder="All Campaigns" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Campaigns</SelectItem>
              {campaigns.map(campaign => (
                <SelectItem key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Date Presets */}
          <div className="flex items-center gap-1 rounded-lg border bg-muted/30 p-1">
            {(['today', '7d', '30d'] as DatePreset[]).map(preset => (
              <Button
                key={preset}
                variant={datePreset === preset ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setDatePreset(preset)}
                className={cn(
                  'h-7 px-3 text-xs',
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
              className="h-7 px-2"
            >
              <Calendar className="h-3.5 w-3.5" />
            </Button>
          </div>
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* KPI Cards Row */}
      <section className="flex-shrink-0 mb-4">
        <DashboardKPIs
          dateRange={getDateRange()}
          onFilterChange={handleFilterChange}
          campaignId={campaignId}
        />
      </section>

      {/* Call Log - Full Width Data Grid */}
      <section className="flex-1 min-h-0">
        <CallIntelligence filters={filters} />
      </section>
    </div>
  );
}
