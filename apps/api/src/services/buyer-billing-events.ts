/**
 * Buyer Billing Event Handler
 *
 * Subscribes to call.ended events and processes billing for Upfront buyers.
 * This runs as a background service when the API starts.
 */

import { logger } from '../lib/logger.js';

import { buyerBillingService } from './buyer-billing-service.js';
import { eventBus, EventPayload } from './event-bus.js';

let unsubscribe: (() => Promise<void>) | null = null;

/**
 * Handle call.ended event and process buyer billing
 */
async function handleCallEnded(payload: EventPayload): Promise<void> {
  // Only process call.ended events
  if (payload.event !== 'call.ended') {
    return;
  }

  const callId = payload.data.callId as string | undefined;
  if (!callId) {
    logger.warn({ msg: 'call.ended event missing callId', payload });
    return;
  }

  try {
    const result = await buyerBillingService.processCallBilling(callId);

    if (result.deducted) {
      logger.info({
        msg: 'Buyer billing processed',
        callId,
        buyerId: result.buyerId,
        leadsRemaining: result.leadsRemaining,
        autoPaused: result.autoPaused,
      });
    } else if (!result.success) {
      logger.error({
        msg: 'Buyer billing failed',
        callId,
        reason: result.reason,
      });
    }
    // If success but not deducted, it means billing didn't apply (TERMS buyer, below threshold, etc.)
  } catch (error) {
    logger.error({
      msg: 'Error processing buyer billing',
      callId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Start the buyer billing event handler
 */
export async function startBuyerBillingEventHandler(): Promise<void> {
  try {
    unsubscribe = await eventBus.subscribe('call.*', handleCallEnded, 'buyer-billing-consumer');
    logger.info({ msg: 'Buyer billing event handler started' });
  } catch (error) {
    logger.error({
      msg: 'Failed to start buyer billing event handler',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Stop the buyer billing event handler
 */
export async function stopBuyerBillingEventHandler(): Promise<void> {
  if (unsubscribe) {
    await unsubscribe();
    unsubscribe = null;
    logger.info({ msg: 'Buyer billing event handler stopped' });
  }
}
