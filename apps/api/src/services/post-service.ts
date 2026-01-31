/**
 * Post Service - RTB Post Engine
 *
 * Handles the POST phase of RTB Ping/Post flow.
 * Accepts a winning bid token, leases a number, and sets up routing.
 */

import { logger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';
import { auctionService } from './auction-service.js';
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
          bids: {
            where: { status: 'WON' },
            include: {
              buyerEndpoint: true,
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

      const buyerDestination = winningBid.buyerEndpoint.destination;
      const buyerEndpointId = winningBid.buyerEndpointId;

      // 4. Lease a number from the pool
      const leaseResult = await numberPoolService.leaseNumber(
        buyerDestination,
        pingId,
        buyerId,
        buyerEndpointId
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
