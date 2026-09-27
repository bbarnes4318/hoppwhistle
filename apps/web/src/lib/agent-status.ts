/**
 * An agent's live status, as the white-label screens say it.
 *
 * The bucketing rule lives in `@hopwhistle/shared` (`agentLiveStatus`) so the
 * API's Today summary (`routes/white-label-today.ts`) and every web chip read
 * the softphone's presence the same way -- 'on-call' and 'on_call' are both on
 * a call, 'dnd' is away -- and a count on Today and a chip on a campaign's
 * agents agree.
 */
import type { AgentLiveStatus } from '@hopwhistle/shared';

export { agentLiveStatus, type AgentLiveStatus } from '@hopwhistle/shared';

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
