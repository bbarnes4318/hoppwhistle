/**
 * An agent's live status, as the white-label screens say it.
 *
 * The roster reads the softphone's presence from Redis as whatever string the
 * browser last wrote -- 'available', 'READY', 'on_call', 'busy', 'away', or
 * nothing at all. The API's Today summary buckets it with exactly this rule
 * (`routes/white-label-today.ts`), so a count on Today and a chip on a
 * campaign's agents agree.
 */
export type AgentLiveStatus = 'READY' | 'ON_CALL' | 'AWAY' | 'OFFLINE';

export function agentLiveStatus(raw: string | null | undefined): AgentLiveStatus {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'available':
    case 'ready':
      return 'READY';
    case 'busy':
    case 'on_call':
      return 'ON_CALL';
    case 'away':
      return 'AWAY';
    default:
      return 'OFFLINE';
  }
}

export const AGENT_LIVE_STATUS_LABEL: Record<AgentLiveStatus, string> = {
  READY: 'Ready',
  ON_CALL: 'On a call',
  AWAY: 'Away',
  OFFLINE: 'Offline',
};

export const AGENT_LIVE_STATUS_TONE: Record<
  AgentLiveStatus,
  'live' | 'ringing' | 'blocked' | 'neutral'
> = {
  READY: 'live',
  ON_CALL: 'ringing',
  AWAY: 'blocked',
  OFFLINE: 'neutral',
};
