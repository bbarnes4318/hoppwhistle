// ──────────────────────────────────────────────────────────────
// Music Industry Vertical — Mock Data
// Realistic demonstration data for all music-console views
// ──────────────────────────────────────────────────────────────

import type {
  Fan,
  GenreBreakdown,
  MusicCampaign,
  MusicDashboardKpis,
  MusicReport,
  MusicSettings,
  PlatformBreakdown,
  ProofOfPlay,
  StreamDataPoint,
} from '../types';

// ── Dashboard KPIs ──────────────────────────────────────────

export const dashboardKpis: MusicDashboardKpis = {
  totalStreams: 2_847_392,
  streamsChange: 12.4,
  totalRevenue: 14_236.82,
  revenueChange: 8.7,
  activeFans: 184_291,
  fansChange: 15.2,
  activeCampaigns: 7,
  campaignsChange: 16.7,
  playlistAdds: 3_412,
  playlistAddsChange: 22.1,
  avgEngagement: 73.8,
  engagementChange: 4.3,
};

// ── Stream Time-Series (30 days) ─────────────────────────────

export const streamTimeSeries: StreamDataPoint[] = Array.from({ length: 30 }, (_, i) => {
  const d = new Date();
  d.setDate(d.getDate() - (29 - i));
  const base = 80_000 + Math.sin(i * 0.4) * 20_000;
  return {
    date: d.toISOString().slice(0, 10),
    streams: Math.round(base + Math.random() * 15_000),
    revenue: Math.round((base * 0.005 + Math.random() * 50) * 100) / 100,
    listeners: Math.round(base * 0.35 + Math.random() * 5_000),
  };
});

// ── Platform Breakdown ───────────────────────────────────────

export const platformBreakdown: PlatformBreakdown[] = [
  { platform: 'spotify', streams: 1_423_696, revenue: 7_118.48, share: 50, color: '#1DB954' },
  { platform: 'apple_music', streams: 569_478, revenue: 3_416.87, share: 20, color: '#FC3C44' },
  { platform: 'youtube_music', streams: 427_109, revenue: 1_281.33, share: 15, color: '#FF0000' },
  { platform: 'tidal', streams: 199_318, revenue: 1_594.54, share: 7, color: '#000000' },
  { platform: 'amazon_music', streams: 142_370, revenue: 569.48, share: 5, color: '#FF9900' },
  { platform: 'soundcloud', streams: 85_421, revenue: 256.12, share: 3, color: '#FF5500' },
];

// ── Genre Breakdown ──────────────────────────────────────────

export const genreBreakdown: GenreBreakdown[] = [
  { genre: 'Hip-Hop/Rap', streams: 997_582, percentage: 35, color: '#8B5CF6' },
  { genre: 'Pop', streams: 712_348, percentage: 25, color: '#EC4899' },
  { genre: 'R&B/Soul', streams: 484_456, percentage: 17, color: '#F59E0B' },
  { genre: 'Electronic', streams: 370_561, percentage: 13, color: '#06B6D4' },
  { genre: 'Latin', streams: 170_844, percentage: 6, color: '#10B981' },
  { genre: 'Other', streams: 111_601, percentage: 4, color: '#6B7280' },
];

// ── Campaigns ────────────────────────────────────────────────

export const campaigns: MusicCampaign[] = [
  {
    id: 'mc-001',
    name: 'Summer Vibes Push',
    artist: 'Nova Eclipse',
    genre: 'Pop',
    status: 'active',
    platform: 'spotify',
    budget: 5_000,
    spent: 3_420,
    streams: 482_190,
    saves: 12_840,
    playlistAdds: 892,
    startDate: '2026-03-15',
    endDate: '2026-05-15',
    trackTitle: 'Golden Hour',
  },
  {
    id: 'mc-002',
    name: 'Midnight Sessions',
    artist: 'DJ Phantom',
    genre: 'Electronic',
    status: 'active',
    platform: 'apple_music',
    budget: 3_500,
    spent: 1_890,
    streams: 234_560,
    saves: 8_210,
    playlistAdds: 445,
    startDate: '2026-04-01',
    endDate: '2026-06-01',
    trackTitle: 'Neon Dreams',
  },
  {
    id: 'mc-003',
    name: 'Street Anthems Vol. 3',
    artist: 'Kilo Blaze',
    genre: 'Hip-Hop/Rap',
    status: 'active',
    platform: 'all',
    budget: 8_000,
    spent: 6_780,
    streams: 891_240,
    saves: 24_560,
    playlistAdds: 1_230,
    startDate: '2026-02-01',
    endDate: '2026-04-30',
    trackTitle: 'City Lights',
  },
  {
    id: 'mc-004',
    name: 'Soul Revival',
    artist: 'Aria James',
    genre: 'R&B/Soul',
    status: 'paused',
    platform: 'tidal',
    budget: 2_000,
    spent: 890,
    streams: 98_400,
    saves: 3_120,
    playlistAdds: 210,
    startDate: '2026-03-01',
    endDate: '2026-04-30',
    trackTitle: 'Velvet Nights',
  },
  {
    id: 'mc-005',
    name: 'Latin Heat',
    artist: 'Los Reyes',
    genre: 'Latin',
    status: 'completed',
    platform: 'spotify',
    budget: 4_500,
    spent: 4_500,
    streams: 1_240_000,
    saves: 45_200,
    playlistAdds: 2_100,
    startDate: '2026-01-01',
    endDate: '2026-03-31',
    trackTitle: 'Fuego',
  },
  {
    id: 'mc-006',
    name: 'Indie Discovery',
    artist: 'Willow & Oak',
    genre: 'Pop',
    status: 'draft',
    platform: 'soundcloud',
    budget: 1_500,
    spent: 0,
    streams: 0,
    saves: 0,
    playlistAdds: 0,
    startDate: '2026-05-01',
    endDate: '2026-07-01',
    trackTitle: 'Paper Wings',
  },
  {
    id: 'mc-007',
    name: 'Bass Drop Festival',
    artist: 'SYNTHWAVE',
    genre: 'Electronic',
    status: 'active',
    platform: 'youtube_music',
    budget: 6_000,
    spent: 2_100,
    streams: 312_800,
    saves: 9_870,
    playlistAdds: 678,
    startDate: '2026-04-10',
    endDate: '2026-06-30',
    trackTitle: 'Digital Storm',
  },
];

// ── Fans ─────────────────────────────────────────────────────

export const fans: Fan[] = [
  { id: 'f-001', name: 'Marcus Chen', email: 'marcus@email.com', city: 'Los Angeles', state: 'CA', engagementScore: 94, totalStreams: 2_847, topGenre: 'Hip-Hop/Rap', firstListenDate: '2025-08-12', lastActiveDate: '2026-04-23', source: 'organic', status: 'active' },
  { id: 'f-002', name: 'Sophia Rivera', email: 'sophia@email.com', city: 'Miami', state: 'FL', engagementScore: 88, totalStreams: 1_923, topGenre: 'Latin', firstListenDate: '2025-11-03', lastActiveDate: '2026-04-22', source: 'campaign', status: 'active' },
  { id: 'f-003', name: 'Jake Thompson', email: 'jake@email.com', city: 'Austin', state: 'TX', engagementScore: 76, totalStreams: 1_456, topGenre: 'Electronic', firstListenDate: '2025-09-22', lastActiveDate: '2026-04-20', source: 'social', status: 'active' },
  { id: 'f-004', name: 'Aisha Patel', email: 'aisha@email.com', city: 'New York', state: 'NY', engagementScore: 91, totalStreams: 3_102, topGenre: 'R&B/Soul', firstListenDate: '2025-06-15', lastActiveDate: '2026-04-24', source: 'organic', status: 'active' },
  { id: 'f-005', name: 'Chris Anderson', email: 'chris@email.com', city: 'Chicago', state: 'IL', engagementScore: 62, totalStreams: 834, topGenre: 'Pop', firstListenDate: '2026-01-08', lastActiveDate: '2026-03-15', source: 'referral', status: 'dormant' },
  { id: 'f-006', name: 'Luna Martinez', email: 'luna@email.com', city: 'Denver', state: 'CO', engagementScore: 85, totalStreams: 2_210, topGenre: 'Electronic', firstListenDate: '2025-10-14', lastActiveDate: '2026-04-21', source: 'campaign', status: 'active' },
  { id: 'f-007', name: 'Tyler Brooks', email: 'tyler@email.com', city: 'Nashville', state: 'TN', engagementScore: 71, totalStreams: 1_187, topGenre: 'Pop', firstListenDate: '2025-12-01', lastActiveDate: '2026-04-18', source: 'organic', status: 'active' },
  { id: 'f-008', name: 'Emma Wilson', email: 'emma@email.com', city: 'Seattle', state: 'WA', engagementScore: 45, totalStreams: 412, topGenre: 'Hip-Hop/Rap', firstListenDate: '2026-02-14', lastActiveDate: '2026-02-28', source: 'social', status: 'churned' },
  { id: 'f-009', name: 'Daniel Kim', email: 'daniel@email.com', city: 'Portland', state: 'OR', engagementScore: 82, totalStreams: 1_890, topGenre: 'R&B/Soul', firstListenDate: '2025-07-30', lastActiveDate: '2026-04-23', source: 'organic', status: 'active' },
  { id: 'f-010', name: 'Olivia Harris', email: 'olivia@email.com', city: 'Atlanta', state: 'GA', engagementScore: 93, totalStreams: 3_560, topGenre: 'Hip-Hop/Rap', firstListenDate: '2025-05-20', lastActiveDate: '2026-04-24', source: 'campaign', status: 'active' },
];

// ── Proof of Play ────────────────────────────────────────────

export const proofOfPlayRecords: ProofOfPlay[] = [
  { id: 'pop-001', campaignId: 'mc-001', campaignName: 'Summer Vibes Push', platform: 'spotify', trackTitle: 'Golden Hour', artist: 'Nova Eclipse', playTimestamp: '2026-04-24T08:14:32Z', duration: 214, region: 'US-CA', verified: true, listenerHash: 'a1b2c3d4', royaltyUsd: 0.0042 },
  { id: 'pop-002', campaignId: 'mc-001', campaignName: 'Summer Vibes Push', platform: 'spotify', trackTitle: 'Golden Hour', artist: 'Nova Eclipse', playTimestamp: '2026-04-24T08:15:01Z', duration: 198, region: 'US-NY', verified: true, listenerHash: 'e5f6g7h8', royaltyUsd: 0.0039 },
  { id: 'pop-003', campaignId: 'mc-003', campaignName: 'Street Anthems Vol. 3', platform: 'apple_music', trackTitle: 'City Lights', artist: 'Kilo Blaze', playTimestamp: '2026-04-24T08:16:44Z', duration: 245, region: 'US-TX', verified: true, listenerHash: 'i9j0k1l2', royaltyUsd: 0.0075 },
  { id: 'pop-004', campaignId: 'mc-002', campaignName: 'Midnight Sessions', platform: 'apple_music', trackTitle: 'Neon Dreams', artist: 'DJ Phantom', playTimestamp: '2026-04-24T08:18:22Z', duration: 312, region: 'GB-LDN', verified: true, listenerHash: 'm3n4o5p6', royaltyUsd: 0.0071 },
  { id: 'pop-005', campaignId: 'mc-007', campaignName: 'Bass Drop Festival', platform: 'youtube_music', trackTitle: 'Digital Storm', artist: 'SYNTHWAVE', playTimestamp: '2026-04-24T08:19:55Z', duration: 278, region: 'DE-BE', verified: false, listenerHash: 'q7r8s9t0', royaltyUsd: 0.0028 },
  { id: 'pop-006', campaignId: 'mc-003', campaignName: 'Street Anthems Vol. 3', platform: 'spotify', trackTitle: 'City Lights', artist: 'Kilo Blaze', playTimestamp: '2026-04-24T08:20:11Z', duration: 245, region: 'US-FL', verified: true, listenerHash: 'u1v2w3x4', royaltyUsd: 0.0043 },
  { id: 'pop-007', campaignId: 'mc-001', campaignName: 'Summer Vibes Push', platform: 'spotify', trackTitle: 'Golden Hour', artist: 'Nova Eclipse', playTimestamp: '2026-04-24T08:22:38Z', duration: 214, region: 'CA-ON', verified: true, listenerHash: 'y5z6a7b8', royaltyUsd: 0.0041 },
  { id: 'pop-008', campaignId: 'mc-005', campaignName: 'Latin Heat', platform: 'spotify', trackTitle: 'Fuego', artist: 'Los Reyes', playTimestamp: '2026-04-24T08:24:00Z', duration: 196, region: 'MX-CMX', verified: true, listenerHash: 'c9d0e1f2', royaltyUsd: 0.0035 },
  { id: 'pop-009', campaignId: 'mc-002', campaignName: 'Midnight Sessions', platform: 'tidal', trackTitle: 'Neon Dreams', artist: 'DJ Phantom', playTimestamp: '2026-04-24T08:25:19Z', duration: 312, region: 'US-IL', verified: true, listenerHash: 'g3h4i5j6', royaltyUsd: 0.0125 },
  { id: 'pop-010', campaignId: 'mc-007', campaignName: 'Bass Drop Festival', platform: 'youtube_music', trackTitle: 'Digital Storm', artist: 'SYNTHWAVE', playTimestamp: '2026-04-24T08:27:42Z', duration: 278, region: 'US-WA', verified: true, listenerHash: 'k7l8m9n0', royaltyUsd: 0.0029 },
  { id: 'pop-011', campaignId: 'mc-004', campaignName: 'Soul Revival', platform: 'tidal', trackTitle: 'Velvet Nights', artist: 'Aria James', playTimestamp: '2026-04-24T08:29:01Z', duration: 262, region: 'US-GA', verified: true, listenerHash: 'o1p2q3r4', royaltyUsd: 0.0130 },
  { id: 'pop-012', campaignId: 'mc-003', campaignName: 'Street Anthems Vol. 3', platform: 'spotify', trackTitle: 'City Lights', artist: 'Kilo Blaze', playTimestamp: '2026-04-24T08:30:15Z', duration: 245, region: 'US-CA', verified: true, listenerHash: 's5t6u7v8', royaltyUsd: 0.0044 },
];

// ── Reports ──────────────────────────────────────────────────

export const reports: MusicReport[] = [
  { id: 'rpt-001', period: 'April 2026', totalStreams: 2_847_392, totalRevenue: 14_236.82, uniqueListeners: 184_291, avgStreamDuration: 187, topTrack: 'City Lights', topPlatform: 'spotify', topRegion: 'US-CA', playlistAdds: 3_412, saves: 89_200, shareRate: 4.2 },
  { id: 'rpt-002', period: 'March 2026', totalStreams: 2_534_108, totalRevenue: 12_670.54, uniqueListeners: 162_440, avgStreamDuration: 192, topTrack: 'Fuego', topPlatform: 'spotify', topRegion: 'US-TX', playlistAdds: 2_890, saves: 74_600, shareRate: 3.8 },
  { id: 'rpt-003', period: 'February 2026', totalStreams: 2_198_740, totalRevenue: 10_993.70, uniqueListeners: 141_200, avgStreamDuration: 185, topTrack: 'Golden Hour', topPlatform: 'apple_music', topRegion: 'US-NY', playlistAdds: 2_340, saves: 61_800, shareRate: 3.5 },
  { id: 'rpt-004', period: 'January 2026', totalStreams: 1_876_300, totalRevenue: 9_381.50, uniqueListeners: 118_900, avgStreamDuration: 179, topTrack: 'Neon Dreams', topPlatform: 'spotify', topRegion: 'US-FL', playlistAdds: 1_960, saves: 52_400, shareRate: 3.1 },
];

// ── Settings ─────────────────────────────────────────────────

export const defaultMusicSettings: MusicSettings = {
  artistName: 'Nova Eclipse',
  labelName: 'Pulse Records',
  defaultCurrency: 'USD',
  notificationsEnabled: true,
  emailReports: true,
  reportFrequency: 'weekly',
  royaltyThreshold: 100,
  preferredPlatforms: ['spotify', 'apple_music', 'tidal'],
  timezone: 'America/New_York',
};
