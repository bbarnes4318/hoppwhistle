export type FanSegment = 
  | 'superfan'
  | 'vip_list'
  | 'previous_merch'
  | 'tour_city'
  | 'stream_save'
  | 'fan_club_inactive'
  | 'festival_audience';

export type FanSource =
  | 'fan_club'
  | 'pre_save_page'
  | 'merch_checkout'
  | 'ticketing_partner'
  | 'qr_code'
  | 'sms_opt_in'
  | 'vip_waitlist';

export type FanOutcome =
  | 'pre_saved'
  | 'ticket_intent'
  | 'merch_intent'
  | 'vip_interest'
  | 'needs_follow_up'
  | 'no_action'
  | 'opted_out';

export type InteractionStatus =
  | 'completed'
  | 'no_answer'
  | 'voicemail'
  | 'failed'
  | 'opted_out'
  | 'busy';

export type Sentiment = 'positive' | 'neutral' | 'negative';
export type IntentLevel = 'high' | 'medium' | 'low' | 'none';

export type MusicCampaignType = 
  | 'album_presave'
  | 'tour_onsale'
  | 'merch_drop'
  | 'vip_upgrade'
  | 'fan_club_reactivation'
  | 'festival_announcement'
  | 'post_show_feedback';

export interface FanCampaign {
  id: string;
  name: string;
  artist: string;
  type: MusicCampaignType;
  segment: FanSegment;
  status: 'draft' | 'active' | 'paused' | 'completed';
  audienceSize: number;
  fansContacted: number;
  humanAnswers: number;
  answerRate: number;
  verifiedEngagements: number;
  cpa: number;
  proofCaptured: number;
  startDate: string;

  // Enriched campaign economics for business storytelling
  campaignValue?: number;
  sponsorRevenue?: number;
  artistShare?: number;
  rpsShare?: number;
  mediaInventoryUnits?: number;
  proofReadinessScore?: number;
}

export interface ProofRecord {
  id: string;
  interactionId: string;
  campaignId: string;
  campaignName: string;
  fanName: string;
  fanPhone: string;
  artist: string;
  segment: FanSegment;
  status: InteractionStatus;
  sentiment: Sentiment;
  intent: IntentLevel;
  outcome: FanOutcome;
  duration: number;
  timestamp: string;
  verifiedAction: boolean;
  hasRecording: boolean;
  recordingUrl?: string;
  hasTranscript: boolean;
  transcriptSnippet: string;
  engagementScore: number;
  consentSource: string;
  cpaAttribution: number;
}

export interface FunnelStage {
  label: string;
  count: number;
  percentage: number;
  color: string;
}

export interface LivePulseData {
  campaignName: string;
  artist: string;
  segment: string;
  contactRate: number;
  answerRate: number;
  verifiedRate: number;
  spend: number;
  cpa: number;
  status: 'dialing' | 'paused' | 'completed';
}

export interface CampaignTimeSeriesPoint {
  date: string;
  fansContacted: number;
  humanAnswers: number;
  verifiedEngagements: number;
  preSaves: number;
}

export interface FanProfile {
  id: string;
  name: string;
  phone: string;
  city: string;
  segment: FanSegment;
  source: FanSource;
  engagementScore: number;
  lastInteraction: string;
  verifiedActions: number;
  preSaves: number;
  favoriteArtist: string;
  consentStatus: 'opted_in' | 'opted_out' | 'pending';
  totalInteractions: number;
}

export interface MusicSettings {
  organizationName: string;
  defaultAiVoice: string;
  timezone: string;
  complianceMode: 'tcpa_strict' | 'tcpa_standard';
  recordAllInteractions: boolean;
  transcribeAllInteractions: boolean;
  optOutThreshold: number;
  notificationsEnabled: boolean;
  emailReports: boolean;
  reportFrequency: 'daily' | 'weekly' | 'monthly';
  
  defaultArtist: string;
  defaultCampaignOwner: string;
  reportingCurrency: string;
  approvedVoicePersona: string;
  artistSafeMode: boolean;
  requireScriptApproval: boolean;
  allowFreeformAi: boolean;
  boundedScriptMode: boolean;
  maxCallDuration: number;
  brandSafetyNotes: string;
  requireOptInConsent: boolean;
  consentSourceRequired: boolean;
  optOutHandling: string;
  recordingDisclosure: string;
  tcpaConsentMode: string;
  dataRetentionWindow: string;
  defaultCampaignType: MusicCampaignType;
  defaultGoal: string;
  defaultCpaTarget: number;
  defaultAttributionWindow: string;
  alertCampaignLaunch: boolean;
  alertCpaThreshold: boolean;
  alertOptOutSpike: boolean;
  alertHighIntent: boolean;
  weeklyExecutiveReport: boolean;
}

export interface OutcomeBreakdown {
  outcome: string;
  color: string;
  count: number;
  percentage: number;
}

export interface RpsNetworkSummary {
  activeStations: number;
  activeArtists: number;
  monthlyFanInteractions: number;
  verifiedActions: number;
  sponsorRevenue: number;
  artistPayout: number;
  rpsShare: number;
  mediaInventorySold: number;
  sponsorReadyProofRecords: number;
  optOutRate: number;
  averageCostPerVerifiedAction: number;
}

export type ArtistTier = 'Discovery' | 'Growth' | 'Partner' | 'Bronze' | 'Silver' | 'Gold' | 'Platinum';

export interface ArtistTierConfig {
  tier: ArtistTier;
  minMonthlyInteractions: number;
  payoutRate: number; // percentage (e.g., 70 for 70%)
  description: string;
}

export interface RevenueSourceDistribution {
  source: string;
  totalRevenue: number;
  artistSharePercent: number;
  rpsSharePercent: number;
  description: string;
}

export interface SponsorPackage {
  tier: 'Bronze' | 'Silver' | 'Gold' | 'Platinum';
  calls: number;
  price: number;
  cpaTarget: number;
  description: string;
}

