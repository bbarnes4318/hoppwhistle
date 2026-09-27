/**
 * An agent's live status, bucketed from the softphone's presence string.
 *
 * Presence lives in Redis as whatever string the browser last wrote, and the
 * softphone has written several spellings over its life: 'available',
 * 'READY', 'on-call' (what it writes today), 'on_call', 'busy', 'away',
 * 'dnd', or nothing at all. Every screen that counts or colours an agent by
 * presence -- the API's Today summary, the web roster chips, the agents-today
 * table -- reads it through this one rule, so a count on Today and a chip on a
 * campaign's agents agree.
 */
export type AgentLiveStatus = 'READY' | 'ON_CALL' | 'AWAY' | 'OFFLINE';

export function agentLiveStatus(raw: string | null | undefined): AgentLiveStatus {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'available':
    case 'ready':
      return 'READY';
    case 'busy':
    case 'on-call':
    case 'on_call':
      return 'ON_CALL';
    case 'away':
    case 'dnd':
      return 'AWAY';
    default:
      return 'OFFLINE';
  }
}
