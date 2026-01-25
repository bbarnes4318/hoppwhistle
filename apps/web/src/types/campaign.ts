/**
 * Project Cortex | Campaign Types
 *
 * Data models for the Traffic Control Matrix (Routing Engine).
 */

export type CampaignStatus = 'draft' | 'active' | 'paused';
export type PayoutModel = 'fixed' | 'revshare';

// ============================================================================
// Column 1: Supply (Publishers)
// ============================================================================

export interface CampaignPublisher {
  id: string;
  publisherId: string;
  publisherName: string;
  promoNumber: string; // Assigned DID from number pool
  payoutModel: PayoutModel;
  payoutAmount: number; // $ for fixed, % for revshare
  blockSpam: boolean;
  blockAnonymous: boolean;
}

// ============================================================================
// Column 2: Logic Gate (Filters)
// ============================================================================

export interface IVRConfig {
  enabled: boolean;
  audioUrl?: string;
  audioName?: string;
  keypresses: { key: string; action: string; routeTo?: string }[];
}

export interface GeoFencingConfig {
  enabled: boolean;
  mode: 'allow' | 'block';
  states: string[];
}

export interface DupeCheckConfig {
  enabled: boolean;
  lookbackDays: number;
  scope: 'campaign' | 'global';
}

export interface ScheduleConfig {
  enabled: boolean;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  timezone: string;
}

export interface CampaignFilters {
  ivr: IVRConfig;
  geoFencing: GeoFencingConfig;
  dupeCheck: DupeCheckConfig;
  schedule: ScheduleConfig;
  blockSpam: boolean;
  blockAnonymous: boolean;
}

// ============================================================================
// Column 3: Demand (Target Waterfall)
// ============================================================================

export interface CampaignTarget {
  id: string;
  targetId: string; // Reference to global target

  // Read-only from global target
  targetName: string;
  buyerName: string;
  destinationNumber: string;
  vertical: string;

  // Campaign-specific overrides
  priorityTier: number; // 1-10 (determines ring order)
  weight: number; // % for round-robin within same tier
  bufferOverride?: number; // Seconds (overrides global buffer)
  revenueOverride?: number; // $ (overrides default payout)

  // Campaign-specific caps
  campaignDailyCap: number;
  campaignConcurrency: number;
  campaignDailyUsed: number;
  campaignCurrentCalls: number;

  // Status
  isSkipped: boolean;
  skipReason?: 'capped' | 'closed' | 'paused' | 'global-capped';
}

// ============================================================================
// Campaign (Full Model)
// ============================================================================

export interface Campaign {
  id: string;
  name: string;
  vertical: string;
  status: CampaignStatus;
  description?: string;

  // Column 1: Supply
  publishers: CampaignPublisher[];

  // Column 2: Logic Gate
  filters: CampaignFilters;

  // Column 3: Demand
  targets: CampaignTarget[];

  // Stats
  todayCalls: number;
  todayRevenue: number;
  todayCost: number;

  // Metadata
  createdAt: string;
  updatedAt: string;
}

// ============================================================================
// Helpers
// ============================================================================

export const US_STATES = [
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
];

export const PRIORITY_ICONS: Record<number, string> = {
  1: '🥇',
  2: '🥈',
  3: '🥉',
  4: '4️⃣',
  5: '5️⃣',
  6: '6️⃣',
  7: '7️⃣',
  8: '8️⃣',
  9: '9️⃣',
  10: '🔟',
};

export function getDefaultFilters(): CampaignFilters {
  return {
    ivr: {
      enabled: false,
      keypresses: [],
    },
    geoFencing: {
      enabled: false,
      mode: 'allow',
      states: [],
    },
    dupeCheck: {
      enabled: false,
      lookbackDays: 30,
      scope: 'campaign',
    },
    schedule: {
      enabled: false,
      daysOfWeek: [1, 2, 3, 4, 5],
      startTime: '08:00',
      endTime: '20:00',
      timezone: 'America/New_York',
    },
    blockSpam: true,
    blockAnonymous: false,
  };
}
