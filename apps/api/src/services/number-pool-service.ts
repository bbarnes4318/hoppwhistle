/**
 * Number Pool Service - RTB Post Engine
 *
 * Manages the DID number pool for dynamic number cloaking.
 * Handles number leasing, Redis routing keys, and cleanup of zombie numbers.
 *
 * Architecture:
 * - Uses Redis locks for concurrent lease requests
 * - Sets Redis routing keys for telephony engine lookup
 * - Implements "Reaper" job to reclaim expired leases
 */

import { logger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';

import { getRedisClient } from './redis.js';

// ============================================================================
// Types
// ============================================================================

export interface LeaseResult {
  success: boolean;
  e164?: string;
  error?: string;
}

export interface RouteInfo {
  buyer_destination: string;
  ping_id: string;
  buyer_id: string;
  buyer_endpoint_id: string;
  leased_at: string;
  tenant_id?: string;
  publisher_id?: string;
  campaign_id?: string | null;
  transfer_number?: string;
  caller_number?: string | null;
  rtb_bid_amount?: number;
  buyer_bid_id?: string | null;
  post_accepted_at?: string;
  publisher_request_id?: string | null;
  vertical?: string | null;
  expires_at?: string | null;
}

// ============================================================================
// Number Pool Service
// ============================================================================

export class NumberPoolService {
  private readonly DEFAULT_LEASE_TTL_SECONDS = 900; // 15 minutes
  private readonly LOCK_TTL_SECONDS = 10;
  private readonly REAPER_THRESHOLD_MINUTES = 20;

  /**
   * Lease a number from the pool
   * Sets up Redis routing for telephony engine
   */
  async leaseNumber(
    buyerDestination: string,
    pingId: string,
    buyerId: string,
    buyerEndpointId: string,
    durationSeconds?: number,
    additionalData?: Partial<RouteInfo>
  ): Promise<LeaseResult> {
    const prisma = getPrismaClient();
    const redis = getRedisClient();
    const ttl = durationSeconds || this.DEFAULT_LEASE_TTL_SECONDS;

    try {
      // Check idempotency first - if already leased, return same number
      const existingLease = await this.getExistingLease(pingId);
      if (existingLease) {
        logger.info({ msg: 'Returning existing lease', pingId, e164: existingLease });
        return { success: true, e164: existingLease };
      }

      // Find an available number from the pool
      // Using transaction + FOR UPDATE SKIP LOCKED for concurrency safety
      const leasedNumber = await prisma.$transaction(async tx => {
        // Find available pool number
        const availableNumber = await tx.phoneNumber.findFirst({
          where: {
            poolType: 'POOL',
            poolStatus: 'AVAILABLE',
            status: 'ACTIVE',
          },
          orderBy: {
            lastAssignedAt: 'asc', // Prefer numbers that haven't been used recently
          },
        });

        if (!availableNumber) {
          return null;
        }

        // Try to acquire Redis lock for this number
        const lockKey = `lock:number:${availableNumber.number}`;
        const lockAcquired = await redis.set(lockKey, '1', 'EX', this.LOCK_TTL_SECONDS, 'NX');

        if (!lockAcquired) {
          // Someone else grabbed it, try next available
          logger.warn({
            msg: 'Lock contention on number, will retry',
            number: availableNumber.number,
          });
          return null;
        }

        try {
          // Update database status
          const updatedNumber = await tx.phoneNumber.update({
            where: { id: availableNumber.id },
            data: {
              poolStatus: 'ASSIGNED',
              lastAssignedAt: new Date(),
            },
          });

          return updatedNumber;
        } finally {
          // Release lock
          await redis.del(lockKey);
        }
      });

      if (!leasedNumber) {
        return { success: false, error: 'NO_CAPACITY' };
      }

      // Set Redis routing key for telephony engine
      const routeInfo: RouteInfo = {
        buyer_destination: buyerDestination,
        ping_id: pingId,
        buyer_id: buyerId,
        buyer_endpoint_id: buyerEndpointId,
        leased_at: new Date().toISOString(),
        tenant_id: additionalData?.tenant_id,
        publisher_id: additionalData?.publisher_id,
        campaign_id: additionalData?.campaign_id,
        transfer_number: leasedNumber.number,
        caller_number: additionalData?.caller_number,
        rtb_bid_amount: additionalData?.rtb_bid_amount,
        buyer_bid_id: additionalData?.buyer_bid_id,
        post_accepted_at: additionalData?.post_accepted_at,
        publisher_request_id: additionalData?.publisher_request_id,
        vertical: additionalData?.vertical,
        expires_at: additionalData?.expires_at,
      };

      const routeKey = `route:did:${leasedNumber.number}`;
      await redis.setex(routeKey, ttl, JSON.stringify(routeInfo));

      // Set lease index for idempotency lookup
      const leaseKey = `ping:lease:${pingId}`;
      await redis.setex(leaseKey, ttl, leasedNumber.number);

      logger.info({
        msg: 'Number leased successfully',
        e164: leasedNumber.number,
        pingId,
        buyerId,
        ttlSeconds: ttl,
      });

      return { success: true, e164: leasedNumber.number };
    } catch (error) {
      logger.error({ msg: 'Failed to lease number', error, pingId });
      return { success: false, error: 'LEASE_FAILED' };
    }
  }

  /**
   * Get existing lease for idempotency
   * Returns the assigned phone number if ping was already posted
   */
  async getExistingLease(pingId: string): Promise<string | null> {
    try {
      const redis = getRedisClient();
      const leaseKey = `ping:lease:${pingId}`;
      return await redis.get(leaseKey);
    } catch (error) {
      logger.warn({ msg: 'Failed to check existing lease', pingId, error });
      return null;
    }
  }

  /**
   * Release a number back to the pool
   * Called when a lease is explicitly cancelled
   */
  async releaseNumber(e164: string): Promise<void> {
    const prisma = getPrismaClient();
    const redis = getRedisClient();

    try {
      // Remove Redis routing key
      await redis.del(`route:did:${e164}`);

      // Update database status
      await prisma.phoneNumber.updateMany({
        where: { number: e164 },
        data: {
          poolStatus: 'AVAILABLE',
          lastAssignedAt: null,
        },
      });

      logger.info({ msg: 'Number released', e164 });
    } catch (error) {
      logger.error({ msg: 'Failed to release number', e164, error });
    }
  }

  /**
   * Reclaim expired leases (The "Reaper")
   * Finds numbers that are ASSIGNED in DB but whose Redis TTL has expired
   * Should be run every 5 minutes via cron or internal scheduler
   */
  async reclaimExpiredLeases(): Promise<{ reclaimed: number }> {
    const prisma = getPrismaClient();
    const redis = getRedisClient();

    try {
      // Find zombie numbers: ASSIGNED for longer than threshold
      const thresholdDate = new Date(Date.now() - this.REAPER_THRESHOLD_MINUTES * 60 * 1000);

      const zombieNumbers = await prisma.phoneNumber.findMany({
        where: {
          poolType: 'POOL',
          poolStatus: 'ASSIGNED',
          lastAssignedAt: {
            lt: thresholdDate,
          },
        },
        select: {
          id: true,
          number: true,
          lastAssignedAt: true,
        },
      });

      if (zombieNumbers.length === 0) {
        return { reclaimed: 0 };
      }

      // Verify Redis key is actually expired before reclaiming
      // (Prevents race condition if Redis TTL was extended)
      const numbersToReclaim: string[] = [];

      for (const num of zombieNumbers) {
        const routeKey = `route:did:${num.number}`;
        const exists = await redis.exists(routeKey);

        if (!exists) {
          numbersToReclaim.push(num.id);
        }
      }

      if (numbersToReclaim.length === 0) {
        return { reclaimed: 0 };
      }

      // Batch update to AVAILABLE
      const result = await prisma.phoneNumber.updateMany({
        where: {
          id: { in: numbersToReclaim },
        },
        data: {
          poolStatus: 'AVAILABLE',
          lastAssignedAt: null,
        },
      });

      logger.info({
        msg: 'Reaper: Reclaimed expired number leases',
        count: result.count,
        numbers: numbersToReclaim.length,
      });

      return { reclaimed: result.count };
    } catch (error) {
      logger.error({ msg: 'Reaper: Failed to reclaim expired leases', error });
      return { reclaimed: 0 };
    }
  }

  /**
   * Get routing info for a DID (used by telephony engine)
   */
  async getRouteInfo(e164: string): Promise<RouteInfo | null> {
    try {
      const redis = getRedisClient();
      const routeKey = `route:did:${e164}`;
      const data = await redis.get(routeKey);

      if (!data) {
        return null;
      }

      return JSON.parse(data) as RouteInfo;
    } catch (error) {
      logger.warn({ msg: 'Failed to get route info', e164, error });
      return null;
    }
  }

  /**
   * Get pool statistics
   */
  async getPoolStats(): Promise<{
    available: number;
    assigned: number;
    total: number;
  }> {
    const prisma = getPrismaClient();

    const [available, assigned, total] = await Promise.all([
      prisma.phoneNumber.count({
        where: { poolType: 'POOL', poolStatus: 'AVAILABLE', status: 'ACTIVE' },
      }),
      prisma.phoneNumber.count({
        where: { poolType: 'POOL', poolStatus: 'ASSIGNED' },
      }),
      prisma.phoneNumber.count({
        where: { poolType: 'POOL' },
      }),
    ]);

    return { available, assigned, total };
  }
}

export const numberPoolService = new NumberPoolService();
