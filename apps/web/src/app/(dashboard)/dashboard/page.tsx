'use client';

/**
 * Project Cortex | Command Grid Dashboard
 *
 * SANITIZED VERSION — Strict Data Only.
 * NO DUPLICATE HEADER — Uses global header from layout.
 */

import { RefreshCw } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';

import { SanitizedKPIs } from '@/components/dashboard/sanitized-kpis';
import { SimpleCallLog } from '@/components/dashboard/simple-call-log';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiClient } from '@/lib/api';

interface Campaign {
  id: string;
  name: string;
}

export default function DashboardPage() {
  const [selectedCampaign, setSelectedCampaign] = useState<string>('all');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchCampaigns = useCallback(async () => {
    setLoadingCampaigns(true);
    try {
      const response = await apiClient.get<{ data: Campaign[] }>('/api/v1/campaigns');
      if (response.data?.data) {
        setCampaigns(response.data.data);
      }
    } catch (err) {
      console.error('Failed to load campaigns:', err);
    } finally {
      setLoadingCampaigns(false);
    }
  }, []);

  useEffect(() => {
    fetchCampaigns();
  }, [fetchCampaigns]);

  const handleRefresh = () => {
    setRefreshKey(prev => prev + 1);
  };

  const handleCampaignChange = (value: string) => {
    setSelectedCampaign(value);
    setRefreshKey(prev => prev + 1);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden p-4 gap-4">
      {/* Inline Controls Bar */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-text-muted uppercase tracking-widest">
            CAMPAIGN:
          </span>
          <Select
            value={selectedCampaign}
            onValueChange={handleCampaignChange}
            disabled={loadingCampaigns}
          >
            <SelectTrigger className="w-[180px] h-7 font-mono text-xs bg-panel/50 border-white/10">
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
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          className="h-7 px-2 text-text-muted hover:text-neon-cyan gap-1"
        >
          <RefreshCw className="h-3 w-3" />
          <span className="font-mono text-[10px]">REFRESH</span>
        </Button>
      </div>

      {/* KPI Cards */}
      <SanitizedKPIs
        key={`kpi-${refreshKey}`}
        campaignId={selectedCampaign === 'all' ? undefined : selectedCampaign}
      />

      {/* Call Log - Takes remaining space */}
      <div className="flex-1 min-h-0">
        <SimpleCallLog
          key={`log-${refreshKey}`}
          campaignId={selectedCampaign === 'all' ? undefined : selectedCampaign}
          className="h-full"
        />
      </div>
    </div>
  );
}
