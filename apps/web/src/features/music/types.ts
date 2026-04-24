export type FanSegment = 
  | 'superfan'
  | 'vip_list'
  | 'previous_merch'
  | 'tour_city'
  | 'stream_save'
  | 'fan_club_inactive';

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
