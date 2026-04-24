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
  FanSegment
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
    artist: 'Nova Ray',
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
  },
];

// ── Proof Records Data ──
const FAN_NAMES = ['Marcus Chen', 'Sophia Rivera', 'Jake Thompson', 'Aisha Patel', 'Chris Anderson', 'Luna Martinez', 'Tyler Brooks', 'Emma Wilson'];
const STATUSES: InteractionStatus[] = ['completed', 'completed', 'completed', 'no_answer', 'voicemail', 'opted_out'];
const OUTCOMES: FanOutcome[] = ['pre_saved', 'ticket_intent', 'merch_intent', 'vip_interest', 'needs_follow_up', 'no_action'];
const SENTIMENTS: Sentiment[] = ['positive', 'positive', 'neutral', 'negative'];
const INTENTS: IntentLevel[] = ['high', 'high', 'medium', 'low', 'none'];

const SNIPPETS = [
  "AI: Nova Ray's new album drops Friday. Want me to set up a pre-save?\nFan: Yes! I've been waiting for this.",
  "AI: Tickets for Jace Vale go on sale tomorrow. Want early access?\nFan: Absolutely. Send me the link.",
  "AI: We have a limited merch drop coming up. Interested?\nFan: Yeah, what kind of merch?",
  "AI: VIP upgrades are available for your upcoming show. Want to hear more?\nFan: Definitely, how much is it?",
];

export const proofRecords: ProofRecord[] = Array.from({ length: 15 }, (_, i) => {
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
  { label: 'Uploaded Fans', count: 25000, percentage: 100, color: '#4c1d95' }, // violet-900
  { label: 'Contacted', count: 12450, percentage: 49.8, color: '#6d28d9' }, // violet-700
  { label: 'Human Answered', count: 7820, percentage: 31.3, color: '#8b5cf6' }, // violet-500
  { label: 'Engaged', count: 6200, percentage: 24.8, color: '#a78bfa' }, // violet-400
  { label: 'Verified Intent', count: 4892, percentage: 19.6, color: '#06b6d4' }, // cyan-500
  { label: 'Action Taken', count: 3450, percentage: 13.8, color: '#10b981' }, // emerald-500
];

// ── Live Pulse ──
export const livePulse: LivePulseData = {
  campaignName: 'Midnight Signal Pre-Save',
  artist: 'Nova Ray',
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
    favoriteArtist: pick(['Nova Ray', 'Jace Vale', 'Luma District', 'Aria Stone', 'The Afterhours'], i * 47),
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
  
  defaultArtist: 'Nova Ray',
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

