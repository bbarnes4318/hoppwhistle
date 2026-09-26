import type { Prisma } from '@prisma/client';

import { planAnswerOrder, type AnswerOrder, type AnswerOrderPlan } from './answer-order.js';

/**
 * Write a campaign's agent and buyer priorities for `mode`, inside the
 * caller's transaction.
 *
 * The rule itself is `planAnswerOrder`; this only reads the rows it needs and
 * writes what it answers. It takes a transaction client, never opens one: the
 * callers are the answer-order PUT (which also writes the mode and an audit
 * row) and the buyer assignment (which has just inserted the row being
 * placed), and each needs its own writes and these to commit or fail together.
 *
 * Every read and write is scoped to `tenantId` as well as `campaignId`.
 */
export async function applyAnswerOrder(
  tx: Prisma.TransactionClient,
  tenantId: string,
  campaignId: string,
  mode: AnswerOrder
): Promise<AnswerOrderPlan> {
  const [agents, buyers] = await Promise.all([
    tx.campaignAgent.findMany({
      where: { tenantId, campaignId },
      select: { id: true, priority: true },
    }),
    tx.campaignBuyer.findMany({
      where: { tenantId, campaignId },
      select: { id: true, priority: true },
    }),
  ]);

  const plan = planAnswerOrder(mode, { agents, buyers });

  if (plan.agents.length > 0) {
    // One value for every agent under any mode, so one statement.
    await tx.campaignAgent.updateMany({
      where: { tenantId, campaignId },
      data: { priority: plan.agents[0].priority },
    });
  }

  const current = new Map(buyers.map(buyer => [buyer.id, buyer.priority]));
  for (const buyer of plan.buyers) {
    if (current.get(buyer.id) === buyer.priority) continue;
    await tx.campaignBuyer.update({
      where: { id: buyer.id },
      data: { priority: buyer.priority },
    });
  }

  return plan;
}
