/**
 * INSTITUTIONAL MOCK TELEMETRY DATA
 * Phase 2 — Command Center data layer for DTC Music Promotion platform.
 */

export interface TelemetryPoint {
  time: string;
  aiOutreachVolume: number;
  verifiedListens: number;
}

export interface CampaignRecord {
  campaignId: string;
  verifiedAsset: string;
  labelEntity: string;
  status: 'ACTIVE_OUTREACH' | 'SUSPENDED';
}

// Generate 24h of volatile, upward-trending telemetry
function generateLiveChartData(): TelemetryPoint[] {
  const points: TelemetryPoint[] = [];
  let outreachBase = 2200;
  let listensBase = 580;

  for (let h = 0; h < 24; h++) {
    const hour = h.toString().padStart(2, '0') + ':00';

    // Upward trend with high volatility
    const outreachSpike = Math.floor(Math.random() * 1800) - 400;
    const listensSpike = Math.floor(Math.random() * 600) - 100;

    outreachBase += Math.floor(Math.random() * 320) + 60;
    listensBase += Math.floor(Math.random() * 110) + 20;

    points.push({
      time: hour,
      aiOutreachVolume: Math.max(800, outreachBase + outreachSpike),
      verifiedListens: Math.max(200, listensBase + listensSpike),
    });
  }

  return points;
}

export const platformTelemetry = {
  globalScale: {
    totalAlgorithmicImpressions: '14,284,902',
    verifiedListenConversions: '1,845,230',
    concurrentAIVectors: '4,096',
    networkConversionRate: '12.91%',
    liveListenVelocity: '8,420 / hr',
  },
  liveChartData: generateLiveChartData(),
};

export const activeCampaignMatrix: CampaignRecord[] = [
  {
    campaignId: 'TRK-9928-XAU',
    verifiedAsset: 'Midnight Syndicate (Radio Edit)',
    labelEntity: 'Universal Music Group',
    status: 'ACTIVE_OUTREACH',
  },
  {
    campaignId: 'TRK-4412-BETA',
    verifiedAsset: 'Echoes in the Valley',
    labelEntity: 'Sony Music Entertainment',
    status: 'SUSPENDED',
  },
  {
    campaignId: 'TRK-7731-ZULU',
    verifiedAsset: 'Neon Skyline (Remix)',
    labelEntity: 'Warner Records',
    status: 'ACTIVE_OUTREACH',
  },
];
