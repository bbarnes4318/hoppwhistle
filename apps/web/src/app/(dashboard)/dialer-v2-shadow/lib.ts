/**
 * Dialer V2 shadow supervisor — pure presentation logic.
 *
 * Extracted from `page.tsx` so it can be compiled and tested without a DOM.
 * The rules encoded here are the ones that matter for honesty of the display:
 * an unreachable service must not look healthy, and an absence of data must not
 * render as a green zero.
 */

export type Tone = 'neutral' | 'good' | 'warn' | 'bad';

export interface ShadowStatus {
  serviceReachable: boolean;
  serviceDetail: string;
  shadowEnabled: boolean;
  ingestionHealthy: boolean;
  eslConnected: boolean;
  eslDetail: string;
  lastEventAgeMs: number | null;
  staleAgentCount: number;
  unresolvedEventCount: number;
  emergencyStop: boolean;
  originationPermitted: boolean;
  originationImplemented: boolean;
  /**
   * Whether the recorded history is evidence worth promoting on.
   *
   * Deliberately separate from health. A deployment can be entirely healthy and
   * still be recording decisions that mean nothing — because no agent resolves
   * to any campaign, or because state is not shared between replicas. A page
   * that showed those decisions without saying so would let a promotion
   * decision be taken on numbers that were never evidence.
   */
  evidenceTrustworthy: boolean;
  checks: Array<{ name: string; status: string; detail?: string }>;
}

export interface ShadowDecision {
  campaignId: string;
  decidedAtMs: number;
  recommendedOriginateCount: number;
  bindingConstraint: string;
  degradationMode: string;
  safetyReasons: string[];
  blockedBy: string[];
  originated: boolean;
  explanation: string;
  agentsAvailable: number;
  agentsEligible: number;
  callsDialing: number;
  liveAnswersWaiting: number;
  abandonRate: number;
  pLive: number | null;
  confidence: string | null;
}

/** The label the page must always display. Asserted by test. */
export const SHADOW_BANNER = 'SHADOW MODE — NO CALLS ARE BEING PLACED';

export function formatAge(ms: number | null): string {
  if (ms === null) return 'never';
  if (!Number.isFinite(ms) || ms < 0) return 'unknown';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

/**
 * Tone for the ESL tile.
 *
 * Unreachable service reports `bad`, never `neutral` — a grey tile reads as
 * "nothing to report" when the real meaning is "we cannot see the switch".
 */
export function eslTone(status: ShadowStatus | null): Tone {
  if (!status || !status.serviceReachable) return 'bad';
  if (!status.eslConnected) return 'bad';
  return status.ingestionHealthy ? 'good' : 'warn';
}

export function eventFreshnessTone(status: ShadowStatus | null): Tone {
  if (!status || !status.serviceReachable) return 'bad';
  if (status.lastEventAgeMs === null) return 'warn';
  return status.ingestionHealthy ? 'good' : 'warn';
}

/** Abandonment above the internal warning threshold is never shown as good. */
export function abandonTone(rate: number, warnAt = 0.02, hardAt = 0.03): Tone {
  if (!Number.isFinite(rate) || rate < 0) return 'neutral';
  if (rate >= hardAt) return 'bad';
  if (rate >= warnAt) return 'warn';
  return 'good';
}

/**
 * What the empty state should say. Distinguishes the three reasons a table can
 * be empty, because they call for completely different operator actions.
 */
export function emptyStateMessage(
  status: ShadowStatus | null,
  decisions: ShadowDecision[] | null
): string | null {
  if (decisions === null) return null;
  if (decisions.length > 0) return null;

  if (!status || !status.serviceReachable) {
    return 'The Dialer V2 service is not reachable, so no decisions can be read. Nothing below is live.';
  }
  if (!status.shadowEnabled) {
    return 'Shadow mode is disabled. No decisions are being evaluated or recorded.';
  }
  if (!status.evidenceTrustworthy) {
    // Previously indistinguishable from the line below. The decision store used
    // to return an empty list for any query without a campaign filter, so a
    // deployment that could not answer at all rendered as a quiet one.
    return 'No decisions can be read as evidence for this tenant. The service reports that at least one input it depends on is not shared or not resolvable — see the checks below.';
  }
  return 'Shadow mode has not observed any campaign activity for your tenant yet. Nothing is being simulated or filled in.';
}

/**
 * Guard against ever rendering a record that claims a call was placed.
 * Shadow mode cannot originate, so such a record is corrupt.
 */
export function displayableDecisions(decisions: ShadowDecision[] | null): ShadowDecision[] {
  if (!decisions) return [];
  return decisions.filter(d => d.originated === false);
}

/** Origination status text. Reports the absence of a code path, not a config. */
export function originationLabel(status: ShadowStatus | null): { text: string; tone: Tone } {
  if (!status) return { text: 'Unknown', tone: 'neutral' };
  if (status.originationImplemented) {
    return { text: 'IMPLEMENTED', tone: 'bad' };
  }
  return { text: 'No code path', tone: 'good' };
}

/**
 * How a decision list was scoped.
 *
 * Surfaced because "these are every campaign's recent decisions" and "these are
 * one campaign's" are different claims, and an operator reading a short list
 * needs to know which one they are looking at.
 */
export function decisionScopeLabel(campaignId: string | null): string {
  return campaignId
    ? `Recent decisions for campaign ${campaignId}`
    : 'Recent decisions across every campaign in this tenant';
}
