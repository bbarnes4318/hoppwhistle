/**
 * "Who answers first": the order a campaign offers a call to the agency's own
 * agents and to its buyers.
 *
 * Stored as `campaign.metadata.answerOrder` and applied by
 * `PUT /api/v1/campaigns/:id/answer-order`, which rewrites the priorities the
 * routing engine already rings in order. See `services/campaigns/answer-order.ts`
 * in the API for the arithmetic; this is the vocabulary the screen shows.
 */
export const ANSWER_ORDERS = [
  {
    value: 'AGENTS_FIRST',
    label: 'Your agents first, then buyers',
    detail: 'A call rings your agents first. If none of them can take it, it goes to your buyers.',
  },
  {
    value: 'BUYERS_FIRST',
    label: 'Buyers first, then your agents',
    detail: 'A call goes to your buyers first. Your agents take the ones no buyer will.',
  },
  {
    value: 'TOGETHER',
    label: 'Your agents and buyers at the same time',
    detail: 'Your agents and your top buyers are offered each call together.',
  },
] as const;

export type AnswerOrder = (typeof ANSWER_ORDERS)[number]['value'];

export function isAnswerOrder(value: unknown): value is AnswerOrder {
  return ANSWER_ORDERS.some(order => order.value === value);
}

/** The order a campaign's metadata names, or null when it names none. */
export function answerOrderOf(metadata: unknown): AnswerOrder | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const value = (metadata as { answerOrder?: unknown }).answerOrder;
  return isAnswerOrder(value) ? value : null;
}
