import type {
  CampaignTimeSeriesPoint,
  FanCampaign,
  FanOutcome,
  FunnelStage,
  LivePulseData,
  ProofRecord,
  InteractionStatus,
  Sentiment,
  IntentLevel,
  FanProfile,
  MusicSettings,
  FanSource,
  FanSegment,
  RpsNetworkSummary,
  ArtistTierConfig,
  RevenueSourceDistribution,
  SponsorPackage
} from '../types';

// ── Seeded PRNG
function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
function pick<T>(arr: readonly T[], seed: number): T {
  return arr[Math.floor(hash(seed) * arr.length)];
}
function range(seed: number, min: number, max: number): number {
  return Math.floor(hash(seed) * (max - min + 1)) + min;
}

// ── Specific Mock Campaigns for Builder ──
export const fanCampaigns: FanCampaign[] = [
  {
    id: 'c-1',
    name: 'Midnight Signal Pre-Save',
    artist: 'Nona Ray',
    type: 'album_presave',
    segment: 'stream_save',
    status: 'active',
    audienceSize: 12400,
    fansContacted: 8200,
    humanAnswers: 5166,
    answerRate: 63,
    verifiedEngagements: 3616,
    cpa: 1.12,
    proofCaptured: 5100,
    startDate: '2026-04-20',
    campaignValue: 10124.8,
    sponsorRevenue: 12300,
    artistShare: 8610,
    rpsShare: 3690,
    mediaInventoryUnits: 8200,
    proofReadinessScore: 94.5,
  },
  {
    id: 'c-2',
    name: 'North American Tour On-Sale',
    artist: 'Jace Vale',
    type: 'tour_onsale',
    segment: 'tour_city',
    status: 'active',
    audienceSize: 45000,
    fansContacted: 15000,
    humanAnswers: 9000,
    answerRate: 60,
    verifiedEngagements: 6300,
    cpa: 2.45,
    proofCaptured: 8900,
    startDate: '2026-04-22',
    campaignValue: 28350.0,
    sponsorRevenue: 33750,
    artistShare: 23625,
    rpsShare: 10125,
    mediaInventoryUnits: 15000,
    proofReadinessScore: 92.0,
  },
  {
    id: 'c-3',
    name: 'Capsule Merch Drop',
    artist: 'Luma District',
    type: 'merch_drop',
    segment: 'previous_merch',
    status: 'paused',
    audienceSize: 5200,
    fansContacted: 5200,
    humanAnswers: 3484,
    answerRate: 67,
    verifiedEngagements: 2613,
    cpa: 1.85,
    proofCaptured: 3450,
    startDate: '2026-04-10',
    campaignValue: 13587.6,
    sponsorRevenue: 15600,
    artistShare: 10920,
    rpsShare: 4680,
    mediaInventoryUnits: 5200,
    proofReadinessScore: 88.5,
  },
  {
    id: 'c-4',
    name: 'VIP Upgrade List',
    artist: 'Aria Stone',
    type: 'vip_upgrade',
    segment: 'vip_list',
    status: 'draft',
    audienceSize: 1500,
    fansContacted: 0,
    humanAnswers: 0,
    answerRate: 0,
    verifiedEngagements: 0,
    cpa: 0,
    proofCaptured: 0,
    startDate: '2026-05-01',
    campaignValue: 0,
    sponsorRevenue: 0,
    artistShare: 0,
    rpsShare: 0,
    mediaInventoryUnits: 0,
    proofReadinessScore: 0,
  },
  {
    id: 'c-5',
    name: 'Fan Club Reactivation',
    artist: 'The Afterhours',
    type: 'fan_club_reactivation',
    segment: 'fan_club_inactive',
    status: 'completed',
    audienceSize: 8500,
    fansContacted: 8500,
    humanAnswers: 4420,
    answerRate: 52,
    verifiedEngagements: 1989,
    cpa: 3.10,
    proofCaptured: 4400,
    startDate: '2026-03-15',
    campaignValue: 11934.0,
    sponsorRevenue: 26350,
    artistShare: 18445,
    rpsShare: 7905,
    mediaInventoryUnits: 8500,
    proofReadinessScore: 99.1,
  },
];

// ── Proof Records Data ──
const FAN_NAMES = ['Marcus Chen', 'Sophia Rivera', 'Jake Thompson', 'Aisha Patel', 'Chris Anderson', 'Luna Martinez', 'Tyler Brooks', 'Emma Wilson'];
const STATUSES: InteractionStatus[] = ['completed', 'completed', 'completed', 'no_answer', 'voicemail', 'opted_out'];
const OUTCOMES: FanOutcome[] = ['pre_saved', 'ticket_intent', 'merch_intent', 'vip_interest', 'needs_follow_up', 'no_action'];
const SENTIMENTS: Sentiment[] = ['positive', 'positive', 'neutral', 'negative'];
const INTENTS: IntentLevel[] = ['high', 'high', 'medium', 'low', 'none'];

const SNIPPETS = [
  "AI: Nona Ray's new album drops Friday. Want me to set up a pre-save?\nFan: Yes! I've been waiting for this.",
  "AI: Tickets for Jace Vale go on sale tomorrow. Want early access?\nFan: Absolutely. Send me the link.",
  "AI: We have a limited merch drop coming up. Interested?\nFan: Yeah, what kind of merch?",
  "AI: VIP upgrades are available for your upcoming show. Want to hear more?\nFan: Definitely, how much is it?",
];

export const proofRecords: ProofRecord[] = Array.from({ length: 300 }, (_, i) => {
  const status = pick(STATUSES, i * 7);
  const isCompleted = status === 'completed';
  const camp = fanCampaigns[i % fanCampaigns.length];
  return {
    id: `pr-${i}`,
    interactionId: `int-${i}`,
    campaignId: camp.id,
    campaignName: camp.name,
    fanName: pick(FAN_NAMES, i * 13),
    fanPhone: `+1 ${range(i*100, 200, 999)}-${range(i*200, 200, 999)}-${range(i*300, 1000, 9999)}`,
    artist: camp.artist,
    segment: camp.segment,
    status,
    sentiment: isCompleted ? pick(SENTIMENTS, i * 23) : 'neutral',
    intent: isCompleted ? pick(INTENTS, i * 29) : 'none',
    outcome: isCompleted ? pick(OUTCOMES, i * 31) : 'no_action',
    duration: isCompleted ? range(i * 37, 30, 180) : range(i * 37, 5, 20),
    timestamp: `2026-04-24T${String(range(i * 41, 8, 16)).padStart(2, '0')}:${String(range(i * 43, 0, 59)).padStart(2, '0')}:00Z`,
    verifiedAction: isCompleted && hash(i * 47) > 0.3,
    hasRecording: isCompleted,
    hasTranscript: isCompleted,
    transcriptSnippet: isCompleted ? pick(SNIPPETS, i * 53) : '',
    engagementScore: range(i * 59, 10, 98),
    consentSource: 'Website Opt-In 2025',
    cpaAttribution: isCompleted ? 1.15 : 0,
  };
});

// ── Top KPIs ──
export const topKpis = {
  fansContacted: { value: 12450, change: 14.2 },
  humanAnswers: { value: 7820, change: 11.8 },
  verifiedEngagements: { value: 4892, change: 18.4 },
  preSaves: { value: 2890, change: 22.1 },
  costPerPreSave: { value: 1.10, change: -8.2 },
  proofCaptured: { value: 7750, change: 16.7 },
};

// ── Funnel ──
export const funnelData: FunnelStage[] = [
  { label: 'Uploaded Fans', count: 25000, percentage: 100, color: '#0B46D9' }, // signal blue
  { label: 'Contacted', count: 12450, percentage: 49.8, color: '#145CFF' }, // royal blue
  { label: 'Human Answered', count: 7820, percentage: 31.3, color: '#2F7DFF' }, // electric blue
  { label: 'Engaged', count: 6200, percentage: 24.8, color: '#38BDF8' }, // sky blue
  { label: 'Verified Intent', count: 4892, percentage: 19.6, color: '#F59E0B' }, // amber/gold
  { label: 'Action Taken', count: 3450, percentage: 13.8, color: '#10B981' }, // emerald-500
];

// ── Live Pulse ──
export const livePulse: LivePulseData = {
  campaignName: 'Midnight Signal Pre-Save',
  artist: 'Nona Ray',
  segment: 'Superfans & Stream Savers',
  contactRate: 85.4,
  answerRate: 62.8,
  verifiedRate: 71.2,
  spend: 3180,
  cpa: 1.10,
  status: 'dialing',
};

// ── Top Segments ──
export const topSegmentsData = [
  { segment: 'Superfans', count: 4200, engagement: 88 },
  { segment: 'Stream save audience', count: 3800, engagement: 76 },
  { segment: 'VIP list', count: 1500, engagement: 82 },
  { segment: 'Previous merch buyers', count: 2100, engagement: 68 },
  { segment: 'Tour city fans', count: 5400, engagement: 54 },
  { segment: 'Fan club inactive', count: 3200, engagement: 31 },
].sort((a, b) => b.engagement - a.engagement);

// ── Time Series ──
export const campaignTimeSeries: CampaignTimeSeriesPoint[] = Array.from({ length: 14 }, (_, i) => ({
  date: `Apr ${i + 10}`,
  fansContacted: range(i * 101, 500, 1200),
  humanAnswers: range(i * 103, 300, 800),
  verifiedEngagements: range(i * 107, 200, 600),
  preSaves: range(i * 109, 100, 400),
}));

// ── Fans Database ──
const FAN_SOURCES: FanSource[] = ['fan_club', 'pre_save_page', 'merch_checkout', 'ticketing_partner', 'qr_code', 'sms_opt_in', 'vip_waitlist'];
const FAN_SEGMENTS: FanSegment[] = ['superfan', 'vip_list', 'previous_merch', 'tour_city', 'stream_save', 'fan_club_inactive', 'festival_audience'];
const CITIES = ['Los Angeles', 'New York', 'Chicago', 'Austin', 'Nashville', 'London', 'Toronto', 'Miami'];
const CONSENT_STATUSES = ['opted_in', 'opted_in', 'opted_in', 'opted_out', 'pending'];

export const fans: FanProfile[] = Array.from({ length: 45 }, (_, i) => {
  return {
    id: `fan-${i}`,
    name: pick(FAN_NAMES, i * 11) + (i > 10 ? ` ${i}` : ''),
    phone: `+1 ${range(i*100, 200, 999)}-${range(i*200, 200, 999)}-${range(i*300, 1000, 9999)}`,
    city: pick(CITIES, i * 17),
    segment: pick(FAN_SEGMENTS, i * 19),
    source: pick(FAN_SOURCES, i * 23),
    engagementScore: range(i * 31, 10, 99),
    lastInteraction: `2026-04-${String(range(i * 37, 10, 24)).padStart(2, '0')}T14:30:00Z`,
    verifiedActions: range(i * 41, 0, 5),
    preSaves: range(i * 43, 0, 3),
    favoriteArtist: pick(['Nona Ray', 'Jace Vale', 'Luma District', 'Aria Stone', 'The Afterhours'], i * 47),
    consentStatus: pick(CONSENT_STATUSES, i * 53) as any,
    totalInteractions: range(i * 59, 1, 12),
  };
});

// ── Default Settings ──
export const defaultMusicSettings: MusicSettings = {
  organizationName: 'Demo Label',
  defaultAiVoice: 'Luna — Warm & Conversational',
  timezone: 'America/New_York',
  complianceMode: 'tcpa_strict',
  recordAllInteractions: true,
  transcribeAllInteractions: true,
  optOutThreshold: 5,
  notificationsEnabled: true,
  emailReports: true,
  reportFrequency: 'weekly',
  
  defaultArtist: 'Nona Ray',
  defaultCampaignOwner: 'Marketing Team',
  reportingCurrency: 'USD',
  approvedVoicePersona: 'Artist-Approved Promo',
  artistSafeMode: true,
  requireScriptApproval: true,
  allowFreeformAi: false,
  boundedScriptMode: true,
  maxCallDuration: 180,
  brandSafetyNotes: 'Do not use profanity. Always mention the tour dates.',
  requireOptInConsent: true,
  consentSourceRequired: true,
  optOutHandling: 'auto_blacklist',
  recordingDisclosure: 'single_party',
  tcpaConsentMode: 'strict',
  dataRetentionWindow: '90_days',
  defaultCampaignType: 'album_presave',
  defaultGoal: 'Maximize Pre-Saves',
  defaultCpaTarget: 1.50,
  defaultAttributionWindow: '7_days',
  alertCampaignLaunch: true,
  alertCpaThreshold: true,
  alertOptOutSpike: true,
  alertHighIntent: true,
  weeklyExecutiveReport: true,
};

// ── RPS Business Model Network Summary ──
export const networkSummary: RpsNetworkSummary = {
  activeStations: 18,
  activeArtists: 42,
  monthlyFanInteractions: 1420000,
  verifiedActions: 954000,
  sponsorRevenue: 6850000,
  artistPayout: 4795000, // 70% artist share
  rpsShare: 2055000,     // 30% RPS platform share
  mediaInventorySold: 1210000, // units sold
  sponsorReadyProofRecords: 924000,
  optOutRate: 2.1,
  averageCostPerVerifiedAction: 1.10,
};

// ── RPS Artist Tiers ──
export const artistTierConfigs: ArtistTierConfig[] = [
  {
    tier: 'Discovery',
    minMonthlyInteractions: 1000,
    payoutRate: 65,
    description: 'Rising indie artists establishing active fan channels.',
  },
  {
    tier: 'Growth',
    minMonthlyInteractions: 10000,
    payoutRate: 68,
    description: 'Breakout artists building recurring media activations.',
  },
  {
    tier: 'Partner',
    minMonthlyInteractions: 50000,
    payoutRate: 70,
    description: 'Established artists with high-density station affinity.',
  },
  {
    tier: 'Bronze',
    minMonthlyInteractions: 100000,
    payoutRate: 72,
    description: 'Bronze tier media channel with verified sponsor proof.',
  },
  {
    tier: 'Silver',
    minMonthlyInteractions: 500000,
    payoutRate: 74,
    description: 'Silver tier channel unlocking premium brand sponsorships.',
  },
  {
    tier: 'Gold',
    minMonthlyInteractions: 1000000,
    payoutRate: 75,
    description: 'Gold tier channel with live audience heatmaps and custom voice personas.',
  },
  {
    tier: 'Platinum',
    minMonthlyInteractions: 5000000,
    payoutRate: 80,
    description: 'Enterprise media channel with exclusive sync licensing and dedicated line pool.',
  },
];

// ── RPS Revenue Share Model ──
export const revenueShareDistribution: RevenueSourceDistribution[] = [
  {
    source: 'Cost per call advertising',
    totalRevenue: 2450000,
    artistSharePercent: 70,
    rpsSharePercent: 30,
    description: 'Sponsored voice engagements and call-to-action payouts.',
  },
  {
    source: 'Sponsored audio',
    totalRevenue: 1850000,
    artistSharePercent: 68,
    rpsSharePercent: 32,
    description: 'Direct brand sponsor audio drop plays during fan stream dial.',
  },
  {
    source: 'Audience insights',
    totalRevenue: 920000,
    artistSharePercent: 60,
    rpsSharePercent: 40,
    description: 'Monetized aggregate fan segment profile data for sponsors.',
  },
  {
    source: 'Music streaming',
    totalRevenue: 550000,
    artistSharePercent: 85,
    rpsSharePercent: 15,
    description: 'Inbound Spotify/Apple DSP pre-save gateway clicks.',
  },
  {
    source: 'Merchandise',
    totalRevenue: 680000,
    artistSharePercent: 75,
    rpsSharePercent: 25,
    description: 'Voice-agent-driven custom apparel drop purchases.',
  },
  {
    source: 'Live events',
    totalRevenue: 820000,
    artistSharePercent: 70,
    rpsSharePercent: 30,
    description: 'Early access tour ticketing verification sales.',
  },
  {
    source: 'Brand partnerships',
    totalRevenue: 1200000,
    artistSharePercent: 65,
    rpsSharePercent: 35,
    description: 'Direct artist-exclusive voice persona sponsorships.',
  },
  {
    source: 'Licensing / sync',
    totalRevenue: 450000,
    artistSharePercent: 80,
    rpsSharePercent: 20,
    description: 'Broadcast usage royalty rights and station routing.',
  },
];

// ── RPS Sponsor Package Examples ──
export const sponsorPackages: SponsorPackage[] = [
  {
    tier: 'Bronze',
    calls: 100000,
    price: 75000,
    cpaTarget: 1.20,
    description: 'Regional brand activation utilizing standard voice engine line pools.',
  },
  {
    tier: 'Silver',
    calls: 500000,
    price: 300000,
    cpaTarget: 1.15,
    description: 'Multi-market campaigns with specialized brand-safe voice scripting.',
  },
  {
    tier: 'Gold',
    calls: 1000000,
    price: 600000,
    cpaTarget: 1.10,
    description: 'National campaigns unlocking dedicated caller IDs and custom artist voice cloning.',
  },
  {
    tier: 'Platinum',
    calls: 5000000,
    price: 2000000,
    cpaTarget: 1.05,
    description: 'Enterprise media partnerships with continuous DSP sync, custom APIs, and guaranteed CPA margins.',
  },
];

// ── Safely derive Campaign Economics ──
export function getCampaignEconomics(campaign: FanCampaign) {
  const campaignValue = campaign.campaignValue ?? (campaign.verifiedEngagements * 2.80);
  const sponsorRevenue = campaign.sponsorRevenue ?? (campaign.fansContacted * 1.50);
  const artistShare = campaign.artistShare ?? (sponsorRevenue * 0.70);
  const rpsShare = campaign.rpsShare ?? (sponsorRevenue * 0.30);
  const mediaInventoryUnits = campaign.mediaInventoryUnits ?? campaign.fansContacted;
  
  // Guard against division by zero
  const rawReadiness = campaign.verifiedEngagements > 0 
    ? (campaign.proofCaptured / campaign.verifiedEngagements) * 100 
    : 0;
  const proofReadinessScore = campaign.proofReadinessScore ?? rawReadiness;

  return {
    campaignValue,
    sponsorRevenue,
    artistShare,
    rpsShare,
    mediaInventoryUnits,
    proofReadinessScore: Math.min(100, Number(proofReadinessScore.toFixed(1))),
  };
}


