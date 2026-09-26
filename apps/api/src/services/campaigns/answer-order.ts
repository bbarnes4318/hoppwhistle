/**
 * "Who answers first" on a campaign: the agency's own agents, its buyers, or
 * both together.
 *
 * ── It is priorities, nothing more ───────────────────────────────────────────
 *
 * Routing (`services/routing.ts`) already ranks a campaign's agents and buyers
 * by `priority`, lower first, and is NOT changed by this. The mode is a way of
 * writing those priorities so an operator can pick a sentence instead of
 * editing numbers:
 *
 *   AGENTS_FIRST   agents 0; buyers 10 + their own rank
 *   BUYERS_FIRST   buyers at their own rank; agents 1000
 *   TOGETHER       agents 0; buyers at their own rank
 *
 * "Their own rank" is `p - min`, where `min` is the lowest CampaignBuyer
 * priority on the campaign (0 when it has none). Shifting rather than
 * renumbering keeps the operator's ordering among buyers exactly as it was --
 * including ties, which is what a weighted split between equal-priority buyers
 * is. Renumbering 0, 1, 2 would quietly turn a 50/50 split into a waterfall.
 *
 * The chosen mode is stored on `campaign.metadata.answerOrder`, so a buyer or
 * agent assigned later is placed by the same rule (`agentPriorityFor`,
 * `answerOrderFromMetadata`).
 *
 * Pure: no database, so every rule here is unit-testable.
 */

export const ANSWER_ORDERS = ['AGENTS_FIRST', 'BUYERS_FIRST', 'TOGETHER'] as const;

export type AnswerOrder = (typeof ANSWER_ORDERS)[number];

/** Where buyers start when agents go first: clear of every agent at 0. */
export const BUYERS_AFTER_AGENTS_OFFSET = 10;

/** Where agents sit when buyers go first: behind any buyer priority in use. */
export const AGENTS_AFTER_BUYERS_PRIORITY = 1000;

export function isAnswerOrder(value: unknown): value is AnswerOrder {
  return typeof value === 'string' && (ANSWER_ORDERS as readonly string[]).includes(value);
}

/** The mode stored on a campaign's metadata, or null when none was ever set. */
export function answerOrderFromMetadata(metadata: unknown): AnswerOrder | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const value = (metadata as { answerOrder?: unknown }).answerOrder;
  return isAnswerOrder(value) ? value : null;
}

/** The priority every agent on the campaign gets under this mode. */
export function agentPriorityFor(mode: AnswerOrder): number {
  return mode === 'BUYERS_FIRST' ? AGENTS_AFTER_BUYERS_PRIORITY : 0;
}

export interface AnswerOrderInput {
  agents: ReadonlyArray<{ id: string; priority: number | null }>;
  buyers: ReadonlyArray<{ id: string; priority: number }>;
}

export interface AnswerOrderPlan {
  /** New priority per CampaignAgent row id. */
  agents: Array<{ id: string; priority: number }>;
  /** New priority per CampaignBuyer row id. */
  buyers: Array<{ id: string; priority: number }>;
}

/** The priorities a campaign's rows should hold under `mode`. */
export function planAnswerOrder(mode: AnswerOrder, rows: AnswerOrderInput): AnswerOrderPlan {
  const min = rows.buyers.length === 0 ? 0 : Math.min(...rows.buyers.map(b => b.priority));
  const buyerOffset = mode === 'AGENTS_FIRST' ? BUYERS_AFTER_AGENTS_OFFSET : 0;
  const agentPriority = agentPriorityFor(mode);

  return {
    agents: rows.agents.map(agent => ({ id: agent.id, priority: agentPriority })),
    buyers: rows.buyers.map(buyer => ({
      id: buyer.id,
      priority: buyerOffset + (buyer.priority - min),
    })),
  };
}
