/**
 * The shape `GET /api/v1/agent/today` answers with.
 *
 * Mirrors `apps/api/src/services/agent/agent-today.ts`. There is no money and
 * no counterparty in it -- not fields this screen chooses not to render, fields
 * the server never sends. Percentages are 0-100 and NULL, not zero, when there
 * was nothing to divide by; nothing here recomputes one.
 */

export type AgentTodayPeriodKey = 'TODAY' | 'YESTERDAY' | 'LAST_7_DAYS';

export interface AgentTotals {
  callsAnswered: number;
  applications: number;
  closingPct: number | null;
  talkTimeSeconds: number;
  averageCallSeconds: number | null;
}

export interface AgentDayFigures {
  day: string;
  callsTaken: number;
  applications: number;
  talkTimeSeconds: number;
}

export interface AgentBucket {
  hour: number | null;
  day: string | null;
  callsAnswered: number;
  applications: number;
}

export interface AgentAttentionItem {
  kind: 'follow_up_overdue' | 'follow_up_due';
  leadId: string;
  name: string;
  phone: string;
  stage: string | null;
  dueAt: string;
  overdue: boolean;
}

export interface AgentRecentCall {
  id: string;
  at: string;
  caller: string | null;
  direction: string;
  connectedSeconds: number | null;
  disposition: string | null;
  application: boolean;
  /** The recording to play, the one the Calls page plays. Null when there is none. */
  recording: { id: string; durationSeconds: number | null } | null;
  /** Recorded, but the file is still being stored. */
  recordingPending: boolean;
}

export interface AgentStanding {
  rank: number | null;
  ranked: number;
  points: number;
  calls: number;
  applications: number;
  closingPct: number | null;
  next: { rank: number; pointsBehind: number } | null;
}

export interface AgentToday {
  generatedAt: string;
  period: {
    key: AgentTodayPeriodKey;
    label: string;
    from: string;
    to: string;
    complete: boolean;
  };
  summary: AgentTotals & {
    availableSeconds: number | null;
    followUpsDue: number;
  };
  comparison: AgentTotals & { label: string };
  agencyBenchmark: { closingPct: number | null };
  trend: AgentDayFigures[];
  byHour: AgentBucket[];
  attention: AgentAttentionItem[];
  recentCalls: AgentRecentCall[];
  standing: AgentStanding | null;
}
