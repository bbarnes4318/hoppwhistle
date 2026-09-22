/**
 * The shape `GET /api/v1/leaderboard` answers with.
 *
 * Mirrors `services/leaderboard/leaderboard.ts` on the API side. Two things
 * this file will not do, both because the server already did them and doing
 * them twice is how two screens start disagreeing:
 *
 *   - It computes no rates. `conversionPct`, `closingPct` and `occupancyPct`
 *     arrive computed, and arrive NULL rather than zero when nothing was
 *     measured. A browser deriving them would be a browser deriving the figure
 *     an agency's price is set from.
 *   - It resolves no dates. `from` and `to` come back with the answer, in the
 *     platform's timezone, and the screen renders what was measured rather than
 *     what it would have asked for.
 */

export type PeriodKey =
  | 'TODAY'
  | 'YESTERDAY'
  | 'THIS_WEEK'
  | 'LAST_WEEK'
  | 'THIS_MONTH'
  | 'LAST_MONTH'
  | 'THIS_YEAR'
  | 'LAST_YEAR'
  | 'CUSTOM';

export interface ScoreBreakdown {
  applications: number;
  uniqueCallers: number;
  outboundConnects: number;
  talkTime: number;
  conversionBonus: number;
  total: number;
}

export interface LeaderboardRow {
  userId: string | null;
  name: string;
  email: string | null;

  rank: number | null;
  points: number;
  pointsBreakdown: ScoreBreakdown;
  movement: number | null;
  previousRank: number | null;

  inboundCalls: number;
  uniqueInboundCallers: number;
  outboundCalls: number;
  outboundConnected: number;
  outboundConnectPct: number | null;

  applications: number;
  annualizedPremium: number;

  conversionPct: number | null;
  closingPct: number | null;

  talkTimeSeconds: number;
  hoursWorked: number | null;
  occupancyPct: number | null;
  applicationsPerHour: number | null;

  streakDays: number;
  personalBest: { applications: number; day: string } | null;
  badges: string[];
}

export interface LeaderboardTotals {
  inboundCalls: number;
  uniqueInboundCallers: number;
  outboundCalls: number;
  outboundConnected: number;
  applications: number;
  annualizedPremium: number;
  talkTimeSeconds: number;
  conversionPct: number | null;
  closingPct: number | null;
}

export interface BadgeDefinition {
  id: string;
  label: string;
  rule: string;
  scope: 'leader' | 'threshold';
}

export interface Leaderboard {
  period: {
    key: PeriodKey;
    label: string;
    from: string;
    to: string;
    days: number;
    complete: boolean;
  };
  previousPeriod: { label: string; from: string; to: string };
  agency: LeaderboardTotals;
  previousAgency: LeaderboardTotals;
  /** Null while the period is still open. See the API header. */
  agencyChange: { applications: number; inboundCalls: number; annualizedPremium: number } | null;
  rows: LeaderboardRow[];
  records: {
    bestDay: { userId: string; name: string; applications: number; day: string } | null;
    longestStreak: { userId: string; name: string; days: number } | null;
  };
  you: { userId: string; rank: number | null; row: LeaderboardRow | null } | null;
  scoring: {
    points: {
      perApplication: number;
      perUniqueCaller: number;
      perOutboundConnect: number;
      perTenMinutesTalk: number;
      perConversionPoint: number;
      conversionBonusMinCallers: number;
    };
    badges: BadgeDefinition[];
    streakBadgeDays: number;
    lookbackDays: number;
  };
}
