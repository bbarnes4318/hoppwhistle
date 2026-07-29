/**
 * Post Service - RTB Post Engine
 *
 * Handles the POST phase of RTB Ping/Post flow.
 * Accepts a winning bid token, leases a number, and sets up routing.
 */

import { logger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';

import { auctionService, type HoursOfOperation } from './auction-service.js';
import { numberPoolService } from './number-pool-service.js';

// ============================================================================
// Types
// ============================================================================

export interface PostResult {
  status: 'success' | 'error';
  accepted: boolean;
  transfer_number?: string;
  ping_id?: string;
  error_code?: string;
  message?: string;
}

export interface PostRequest {
  token: string;
  caller_number?: string;
}

// ============================================================================
// Post Service
// ============================================================================

export class PostService {
  /**
   * Process a POST request - accept a winning bid and lease a number
   */
  async processPost(token: string, callerNumber?: string): Promise<PostResult> {
    const prisma = getPrismaClient();

    try {
      // 1. Verify the bid token
      const tokenResult = await auctionService.verifyBidToken(token);

      if (!tokenResult.valid) {
        return {
          status: 'error',
          accepted: false,
          error_code: 'INVALID_TOKEN',
          message: tokenResult.error || 'Token verification failed',
        };
      }

      const { pingId, bidAmount, buyerId } = tokenResult;

      if (!pingId || !buyerId) {
        return {
          status: 'error',
          accepted: false,
          error_code: 'INVALID_TOKEN',
          message: 'Token missing required claims',
        };
      }

      // 2. Check idempotency - return existing lease if already posted
      const existingLease = await numberPoolService.getExistingLease(pingId);
      if (existingLease) {
        logger.info({ msg: 'Returning idempotent POST response', pingId, e164: existingLease });
        return {
          status: 'success',
          accepted: true,
          transfer_number: existingLease,
          ping_id: pingId,
        };
      }

      // 3. Fetch and validate PingRequest
      const pingRequest = await prisma.pingRequest.findUnique({
        where: { id: pingId },
        include: {
          publisher: true,
          bids: {
            where: { status: 'WON' },
            include: {
              buyerEndpoint: {
                include: {
                  buyer: true,
                },
              },
            },
          },
        },
      });

      if (!pingRequest) {
        return {
          status: 'error',
          accepted: false,
          error_code: 'PING_NOT_FOUND',
          message: 'Ping request not found',
        };
      }

      // Check status - must be WON (not already SOLD or NO_BID)
      if (pingRequest.status === 'SOLD') {
        // Already sold - check if we have the number in DB
        if (pingRequest.assignedPhoneNumberId) {
          const assignedNumber = await prisma.phoneNumber.findUnique({
            where: { id: pingRequest.assignedPhoneNumberId },
            select: { number: true },
          });
          if (assignedNumber) {
            return {
              status: 'success',
              accepted: true,
              transfer_number: assignedNumber.number,
              ping_id: pingId,
            };
          }
        }
        return {
          status: 'error',
          accepted: false,
          error_code: 'ALREADY_SOLD',
          message: 'Ping already sold but number not found',
        };
      }

      if (pingRequest.status !== 'WON') {
        return {
          status: 'error',
          accepted: false,
          error_code: 'INVALID_STATUS',
          message: `Ping status is ${pingRequest.status}, expected WON`,
        };
      }

      // Get winning bid details
      const winningBid = pingRequest.bids[0];
      if (!winningBid) {
        return {
          status: 'error',
          accepted: false,
          error_code: 'NO_WINNING_BID',
          message: 'No winning bid found for this ping',
        };
      }

      const buyer = winningBid.buyerEndpoint?.buyer;
      if (!buyer) {
        return {
          status: 'error',
          accepted: false,
          error_code: 'BUYER_NOT_FOUND',
          message: 'Buyer not found for winning bid',
        };
      }

      // 1. Buyer is ACTIVE
      if (buyer.status !== 'ACTIVE') {
        return {
          status: 'error',
          accepted: false,
          error_code: 'BUYER_INACTIVE',
          message: 'Buyer is not active',
        };
      }

      // 2. Buyer endpoint is ACTIVE
      if (winningBid.buyerEndpoint.status !== 'ACTIVE') {
        return {
          status: 'error',
          accepted: false,
          error_code: 'ENDPOINT_INACTIVE',
          message: 'Buyer endpoint is not active',
        };
      }

      // 3. Endpoint destination exists
      if (!winningBid.buyerEndpoint.destination) {
        return {
          status: 'error',
          accepted: false,
          error_code: 'NO_DESTINATION',
          message: 'Buyer endpoint destination does not exist',
        };
      }

      // 4. Buyer is currently open based on hoursOfOperation/timezone
      const hoursCheck = auctionService.checkHours(
        winningBid.buyerEndpoint.hoursOfOperation as HoursOfOperation | null,
        winningBid.buyerEndpoint.timezone
      );
      if (!hoursCheck.pass) {
        return {
          status: 'error',
          accepted: false,
          error_code: 'BUYER_CLOSED',
          message: hoursCheck.reason || 'Buyer is closed',
        };
      }

      // 5. Cap check
      const capCheck = await auctionService.checkCap(
        winningBid.buyerEndpointId,
        winningBid.buyerEndpoint.maxCap,
        winningBid.buyerEndpoint.capPeriod
      );
      if (!capCheck.pass) {
        return {
          status: 'error',
          accepted: false,
          error_code: 'CAP_EXCEEDED',
          message: capCheck.reason || 'Buyer endpoint cap exceeded',
        };
      }

      // 6. Concurrency check
      if (winningBid.buyerEndpoint.maxConcurrency > 0) {
        const { liveStatusService } = await import('./buyer-live-status-service.js');
        const liveCalls = await liveStatusService.getTargetConcurrency(winningBid.buyerEndpointId);
        if (liveCalls >= winningBid.buyerEndpoint.maxConcurrency) {
          return {
            status: 'error',
            accepted: false,
            error_code: 'CONCURRENCY_EXCEEDED',
            message: 'Buyer endpoint concurrency limit exceeded',
          };
        }
      }

      // 7. Wallet balance check (if UPFRONT)
      if (buyer.billingType === 'UPFRONT') {
        if (Number(buyer.walletBalance) < bidAmount) {
          return {
            status: 'error',
            accepted: false,
            error_code: 'INSUFFICIENT_FUNDS',
            message: 'Buyer has insufficient wallet balance',
          };
        }
      }

      // 8. Campaign/buyer relationship is active
      const campaign = await prisma.campaign.findFirst({
        where: {
          publisherId: pingRequest.publisherId,
          status: 'ACTIVE',
          buyers: {
            some: {
              buyerId: buyerId,
              status: 'ACTIVE',
            },
          },
        },
      });

      if (!campaign) {
        return {
          status: 'error',
          accepted: false,
          error_code: 'CAMPAIGN_BUYER_INACTIVE',
          message: 'Campaign-buyer relationship is not active',
        };
      }

      const buyerDestination = winningBid.buyerEndpoint.destination;
      const buyerEndpointId = winningBid.buyerEndpointId;

      // 4. Lease a number from the pool
      const leaseResult = await numberPoolService.leaseNumber(
        buyerDestination,
        pingId,
        buyerId,
        buyerEndpointId,
        undefined, // TTL
        {
          tenant_id: pingRequest.publisher.tenantId,
          publisher_id: pingRequest.publisherId,
          campaign_id: campaign.id,
          caller_number: callerNumber || null,
          rtb_bid_amount: bidAmount,
          buyer_bid_id: winningBid.id,
          post_accepted_at: new Date().toISOString(),
          publisher_request_id: pingRequest.requestId || null,
          vertical: pingRequest.vertical || null,
          expires_at: pingRequest.expiresAt ? pingRequest.expiresAt.toISOString() : null,
        }
      );

      if (!leaseResult.success) {
        logger.warn({ msg: 'POST failed - no numbers available', pingId, buyerId });
        return {
          status: 'error',
          accepted: false,
          error_code: leaseResult.error || 'NO_CAPACITY',
          message: 'No numbers available in pool',
        };
      }

      // 5. Update PingRequest to SOLD
      const leasedNumber = await prisma.phoneNumber.findFirst({
        where: { number: leaseResult.e164! },
        select: { id: true },
      });

      await prisma.pingRequest.update({
        where: { id: pingId },
        data: {
          status: 'SOLD',
          postedAt: new Date(),
          assignedPhoneNumberId: leasedNumber?.id || null,
          callerNumber: callerNumber || null,
        },
      });

      logger.info({
        msg: 'POST successful',
        pingId,
        buyerId,
        transferNumber: leaseResult.e164,
        bidAmount,
      });

      return {
        status: 'success',
        accepted: true,
        transfer_number: leaseResult.e164,
        ping_id: pingId,
      };
    } catch (error) {
      logger.error({ msg: 'POST processing failed', error, token: token.substring(0, 20) });
      return {
        status: 'error',
        accepted: false,
        error_code: 'INTERNAL_ERROR',
        message: 'Internal processing error',
      };
    }
  }
}

export const postService = new PostService();
