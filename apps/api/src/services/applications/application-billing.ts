/**
 * What an application means for its call's money.
 *
 * A campaign bills its buyers, and pays its publishers, either per billable
 * call or per submitted application (`Campaign.billingModel`). On a
 * PER_APPLICATION campaign the call is priced off the applications attributed
 * to it, so writing or voiding one has to re-price the call: that is
 * `rebillCallForApplications`.
 *
 * `callTags` copies the call's campaign, buyer and publisher onto the
 * application, so applications can be priced and reported per campaign
 * without going back through the call.
 *
 * Neither touches NetEnroll's own per-application billing of the agency
 * (`billing/credit-ledger.ts`): that is the platform billing the agency, this
 * is the agency billing its buyers.
 */

import type { PrismaClient } from '@prisma/client';

export interface CallTags {
  campaignId: string | null;
  buyerId: string | null;
  publisherId: string | null;
}

const NO_TAGS: CallTags = { campaignId: null, buyerId: null, publisherId: null };

/** The campaign, buyer and publisher of `callId` in `tenantId`; all null without one. */
export async function callTags(
  prisma: Pick<PrismaClient, 'call'>,
  tenantId: string,
  callId: string | null | undefined
): Promise<CallTags> {
  if (!callId) return NO_TAGS;
  const call = await prisma.call.findFirst({
    where: { id: callId, tenantId },
    select: { campaignId: true, buyerId: true, publisherId: true },
  });
  return call
    ? { campaignId: call.campaignId, buyerId: call.buyerId, publisherId: call.publisherId }
    : NO_TAGS;
}

/**
 * Re-price `callId` after an application on it was written or voided, when its
 * campaign bills per application. A PER_CALL campaign's call is left alone.
 *
 * A call whose CDR has not landed is skipped by `calculateCallBilling` itself
 * (still INITIATED/RINGING); the CDR's own billing pass then counts the
 * application. Failures are logged and swallowed: the application has been
 * written, and re-running billing for the call (or the recalculation CLI) puts
 * the money right.
 */
export async function rebillCallForApplications(
  prisma: Pick<PrismaClient, 'call'>,
  callId: string | null | undefined
): Promise<void> {
  if (!callId) return;
  try {
    const call = await prisma.call.findUnique({
      where: { id: callId },
      select: { campaign: { select: { billingModel: true } } },
    });
    if (call?.campaign?.billingModel !== 'PER_APPLICATION') return;

    const { billingService } = await import('../billing-service.js');
    const result = await billingService.calculateCallBilling(callId);
    if (!result.success) return;

    const { buyerBillingService } = await import('../buyer-billing-service.js');
    await buyerBillingService.processCallBilling(callId);
  } catch (error) {
    console.error(`[billing] Could not re-price call ${callId} for its applications:`, error);
  }
}
