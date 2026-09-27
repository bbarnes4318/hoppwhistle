/**
 * How long a campaign's call rings an agent, and a buyer, before moving on.
 *
 * Stored as `campaign.metadata.agentRingSeconds` and
 * `campaign.metadata.buyerRingSeconds`, and read by the API's routing engine
 * (`ringSeconds` in `services/routing.ts`) with the same defaults and the
 * same 10-120 second bounds, so what this screen saves is what rings.
 */
export const MIN_RING_SECONDS = 10;
export const MAX_RING_SECONDS = 120;
export const DEFAULT_AGENT_RING_SECONDS = 20;
export const DEFAULT_BUYER_RING_SECONDS = 30;

/**
 * A ring time as a whole number of seconds within the bounds; the fallback
 * for anything that is not a positive number (blank, zero, text).
 */
export function clampRingSeconds(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(MAX_RING_SECONDS, Math.max(MIN_RING_SECONDS, Math.round(parsed)));
}

/** The two ring times a campaign's metadata names, defaulted and clamped. */
export function ringTimesOf(metadata: unknown): {
  agentRingSeconds: number;
  buyerRingSeconds: number;
} {
  const meta =
    metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>) : {};
  return {
    agentRingSeconds: clampRingSeconds(meta.agentRingSeconds, DEFAULT_AGENT_RING_SECONDS),
    buyerRingSeconds: clampRingSeconds(meta.buyerRingSeconds, DEFAULT_BUYER_RING_SECONDS),
  };
}
