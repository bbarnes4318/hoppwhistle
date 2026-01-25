'use client';

/**
 * Project Cortex | Traffic Control Matrix (Campaign Builder)
 *
 * 3-Column Routing Circuit Board:
 * - Column 1: SUPPLY (Publishers)
 * - Column 2: LOGIC GATE (Filters)
 * - Column 3: DEMAND (Target Waterfall)
 */

import { useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { Save, Play, Pause, ArrowLeft, Zap } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { CommandHeader } from '@/components/ui/command-grid';
import { VerticalBadge } from '@/components/ppcall';
import {
  SupplyColumn,
  LogicGateColumn,
  DemandColumn,
  ColumnConnector,
} from '@/components/campaigns';
import type {
  Campaign,
  CampaignPublisher,
  CampaignTarget,
  CampaignFilters,
} from '@/types/campaign';
import { getDefaultFilters } from '@/types/campaign';
import { cn } from '@/lib/utils';

// Mock available numbers
const mockNumbers = [
  { id: 'did_001', number: '+1 (800) 555-1234' },
  { id: 'did_002', number: '+1 (888) 555-5678' },
  { id: 'did_003', number: '+1 (877) 555-9012' },
  { id: 'did_004', number: '+1 (866) 555-3456' },
];

// Mock campaign data
const mockCampaign: Campaign = {
  id: 'cmp_medicare_aep_2026',
  name: 'Medicare AEP 2026',
  vertical: 'medicare',
  status: 'active',
  description: 'Annual Enrollment Period campaign for Medicare supplements',

  publishers: [
    {
      id: 'pub_001',
      publisherId: 'pub_leadgenius',
      publisherName: 'LeadGenius Marketing',
      promoNumber: '+1 (800) 555-1234',
      payoutModel: 'fixed',
      payoutAmount: 25,
      blockSpam: true,
      blockAnonymous: false,
    },
    {
      id: 'pub_002',
      publisherId: 'pub_mediabuyers',
      publisherName: 'MediaBuyers Direct',
      promoNumber: '+1 (888) 555-5678',
      payoutModel: 'revshare',
      payoutAmount: 15,
      blockSpam: true,
      blockAnonymous: true,
    },
  ],

  filters: {
    ivr: {
      enabled: true,
      audioUrl: '/audio/medicare_greeting.mp3',
      audioName: 'medicare_greeting.mp3',
      keypresses: [{ key: '1', action: 'Continue to Medicare' }],
    },
    geoFencing: {
      enabled: true,
      mode: 'allow',
      states: ['TX', 'FL', 'NY', 'CA', 'AZ'],
    },
    dupeCheck: {
      enabled: true,
      lookbackDays: 30,
      scope: 'campaign',
    },
    schedule: {
      enabled: true,
      daysOfWeek: [1, 2, 3, 4, 5],
      startTime: '08:00',
      endTime: '20:00',
      timezone: 'America/New_York',
    },
    blockSpam: true,
    blockAnonymous: false,
  },

  targets: [
    {
      id: 'ct_001',
      targetId: 'tgt_001',
      targetName: 'Call Center A - Medicare',
      buyerName: 'Mutual of Omaha',
      destinationNumber: '+1 (800) 555-1234',
      vertical: 'medicare',
      priorityTier: 1,
      weight: 100,
      bufferOverride: 120,
      revenueOverride: 45,
      campaignDailyCap: 50,
      campaignConcurrency: 5,
      campaignDailyUsed: 23,
      campaignCurrentCalls: 2,
      isSkipped: false,
    },
    {
      id: 'ct_002',
      targetId: 'tgt_002',
      targetName: 'Medicare Inbound Team',
      buyerName: 'SelectQuote',
      destinationNumber: '+1 (888) 555-9876',
      vertical: 'medicare',
      priorityTier: 2,
      weight: 60,
      bufferOverride: 90,
      revenueOverride: 35,
      campaignDailyCap: 40,
      campaignConcurrency: 8,
      campaignDailyUsed: 40,
      campaignCurrentCalls: 0,
      isSkipped: true,
      skipReason: 'capped',
    },
    {
      id: 'ct_003',
      targetId: 'tgt_005',
      targetName: 'ACA Enrollment Center',
      buyerName: 'UnitedHealthcare',
      destinationNumber: '+1 (800) 555-7890',
      vertical: 'aca',
      priorityTier: 3,
      weight: 40,
      campaignDailyCap: 30,
      campaignConcurrency: 4,
      campaignDailyUsed: 12,
      campaignCurrentCalls: 1,
      isSkipped: false,
    },
  ],

  todayCalls: 342,
  todayRevenue: 8550,
  todayCost: 3420,
  createdAt: '2024-01-10T10:00:00Z',
  updatedAt: '2024-01-24T16:00:00Z',
};

export default function CampaignBuilderPage() {
  const params = useParams();
  const campaignId = params?.id as string;

  // State
  const [campaign, setCampaign] = useState<Campaign>(mockCampaign);
  const [isSaving, setIsSaving] = useState(false);

  // Derived
  const isValid = useMemo(() => {
    return campaign.publishers.length > 0 && campaign.targets.length > 0;
  }, [campaign]);

  // Handlers
  const handlePublishersChange = (publishers: CampaignPublisher[]) => {
    setCampaign(prev => ({ ...prev, publishers }));
  };

  const handleFiltersChange = (filters: CampaignFilters) => {
    setCampaign(prev => ({ ...prev, filters }));
  };

  const handleTargetsChange = (targets: CampaignTarget[]) => {
    setCampaign(prev => ({ ...prev, targets }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    // Simulate API call
    await new Promise(r => setTimeout(r, 1000));
    setIsSaving(false);
  };

  const handleToggleStatus = () => {
    setCampaign(prev => ({
      ...prev,
      status: prev.status === 'active' ? 'paused' : 'active',
    }));
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-white/5">
        <div className="flex items-center justify-between px-4 py-3">
          {/* Left: Back + Title */}
          <div className="flex items-center gap-4">
            <Link href="/campaigns">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-text-muted hover:text-text-primary"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>

            <div>
              <div className="flex items-center gap-3">
                <h1 className="font-display text-lg font-bold text-text-primary uppercase tracking-wider">
                  {campaign.name}
                </h1>
                <VerticalBadge vertical={campaign.vertical} size="sm" />
                <span
                  className={cn(
                    'px-2 py-0.5 rounded font-mono text-[10px] uppercase',
                    campaign.status === 'active'
                      ? 'bg-neon-mint/10 text-neon-mint'
                      : 'bg-status-warning/10 text-status-warning'
                  )}
                >
                  {campaign.status}
                </span>
              </div>
              <p className="font-mono text-[10px] text-neon-cyan uppercase tracking-widest">
                TRAFFIC CONTROL MATRIX // ROUTING ENGINE
              </p>
            </div>
          </div>

          {/* Right: Circuit Status + Actions */}
          <div className="flex items-center gap-4">
            {/* Circuit Status */}
            <div className="flex items-center gap-2">
              <Zap
                className={cn(
                  'h-4 w-4 transition-colors',
                  isValid ? 'text-neon-cyan' : 'text-text-muted'
                )}
              />
              <span
                className={cn(
                  'font-mono text-xs uppercase',
                  isValid ? 'text-neon-cyan' : 'text-text-muted'
                )}
              >
                {isValid ? 'CIRCUIT VALID' : 'INCOMPLETE'}
              </span>
            </div>

            {/* Status Toggle */}
            <Button
              variant={campaign.status === 'active' ? 'outline' : 'default'}
              size="sm"
              onClick={handleToggleStatus}
              className={cn(
                'gap-2 font-mono text-xs',
                campaign.status === 'active'
                  ? 'border-status-warning/30 text-status-warning hover:bg-status-warning/10'
                  : 'bg-neon-mint text-void hover:bg-neon-mint/90'
              )}
            >
              {campaign.status === 'active' ? (
                <>
                  <Pause className="h-3 w-3" />
                  PAUSE
                </>
              ) : (
                <>
                  <Play className="h-3 w-3" />
                  ACTIVATE
                </>
              )}
            </Button>

            {/* Save */}
            <Button
              onClick={handleSave}
              disabled={isSaving}
              className={cn(
                'gap-2 font-mono text-xs',
                'bg-neon-cyan text-void hover:bg-neon-cyan/90',
                'shadow-[0_0_15px_rgba(0,229,255,0.2)]'
              )}
            >
              <Save className="h-3 w-3" />
              {isSaving ? 'SAVING...' : 'SAVE'}
            </Button>
          </div>
        </div>
      </div>

      {/* 3-Column Grid (No Scroll) */}
      <div className="flex-1 grid grid-cols-[1fr_auto_1fr_auto_1fr] gap-0 p-4 overflow-hidden">
        {/* Column 1: Supply */}
        <SupplyColumn
          publishers={campaign.publishers}
          onChange={handlePublishersChange}
          availableNumbers={mockNumbers}
        />

        {/* Connector 1→2 */}
        <ColumnConnector isValid={isValid} />

        {/* Column 2: Logic Gate */}
        <LogicGateColumn filters={campaign.filters} onChange={handleFiltersChange} />

        {/* Connector 2→3 */}
        <ColumnConnector isValid={isValid} />

        {/* Column 3: Demand */}
        <DemandColumn
          targets={campaign.targets}
          onChange={handleTargetsChange}
          onAttachTarget={() => {
            // Would open target selector modal
            console.log('Attach target');
          }}
        />
      </div>
    </div>
  );
}
