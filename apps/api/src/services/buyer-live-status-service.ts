/**
 * Buyer Live Status Service
 *
 * Provides real-time concurrency data for buyer targets.
 * Designed with a provider interface for easy swap to Redis in the future.
 *
 * CRITICAL: This calculates live state on-demand - no volatile columns in config tables.
 */

import { getPrismaClient } from '../lib/prisma.js';

export interface TargetLiveStatus {
  targetId: string;
  liveCalls: number;
  maxConcurrency: number;
  isFull: boolean;
}

export interface BuyerLiveStatus {
  buyerId: string;
  totalLiveCalls: number;
  targets: TargetLiveStatus[];
}

/**
 * Provider interface for live status - allows Redis swap
 */
interface LiveStatusProvider {
  getTargetConcurrency(targetId: string): Promise<number>;
  getBuyerLiveStatus(buyerId: string): Promise<BuyerLiveStatus>;
  getTargetsLiveStatus(targetIds: string[]): Promise<Map<string, number>>;
}

/**
 * Database implementation - uses optimized groupBy on active calls
 */
class DatabaseLiveStatusProvider implements LiveStatusProvider {
  async getTargetConcurrency(targetId: string): Promise<number> {
    const prisma = getPrismaClient();

    const count = await prisma.call.count({
      where: {
        targetId,
        status: { in: ['INITIATED', 'RINGING', 'ANSWERED'] },
      },
    });

    return count;
  }

  async getBuyerLiveStatus(buyerId: string): Promise<BuyerLiveStatus> {
    const prisma = getPrismaClient();

    // Get all targets for this buyer
    const targets = await prisma.buyerEndpoint.findMany({
      where: { buyerId },
      select: {
        id: true,
        maxConcurrency: true,
      },
    });

    if (targets.length === 0) {
      return {
        buyerId,
        totalLiveCalls: 0,
        targets: [],
      };
    }

    // Single optimized query with groupBy for all targets
    const activeCalls = await prisma.call.groupBy({
      by: ['targetId'],
      where: {
        buyerId,
        status: { in: ['INITIATED', 'RINGING', 'ANSWERED'] },
        targetId: { not: null },
      },
      _count: true,
    });

    // Build a map for quick lookup
    const callCountMap = new Map<string, number>();
    activeCalls.forEach(row => {
      if (row.targetId) {
        callCountMap.set(row.targetId, row._count);
      }
    });

    // Calculate total and per-target status
    let totalLiveCalls = 0;
    const targetStatuses: TargetLiveStatus[] = targets.map(t => {
      const liveCalls = callCountMap.get(t.id) || 0;
      totalLiveCalls += liveCalls;
      return {
        targetId: t.id,
        liveCalls,
        maxConcurrency: t.maxConcurrency,
        isFull: liveCalls >= t.maxConcurrency,
      };
    });

    return {
      buyerId,
      totalLiveCalls,
      targets: targetStatuses,
    };
  }

  async getTargetsLiveStatus(targetIds: string[]): Promise<Map<string, number>> {
    const prisma = getPrismaClient();

    if (targetIds.length === 0) {
      return new Map();
    }

    const activeCalls = await prisma.call.groupBy({
      by: ['targetId'],
      where: {
        targetId: { in: targetIds },
        status: { in: ['INITIATED', 'RINGING', 'ANSWERED'] },
      },
      _count: true,
    });

    const result = new Map<string, number>();
    activeCalls.forEach(row => {
      if (row.targetId) {
        result.set(row.targetId, row._count);
      }
    });

    return result;
  }
}

/**
 * Redis implementation stub - for future high-scale deployment
 */
class RedisLiveStatusProvider implements LiveStatusProvider {
  async getTargetConcurrency(_targetId: string): Promise<number> {
    // TODO: Implement Redis SCARD on target:${targetId}:active_calls
    throw new Error('Redis provider not implemented');
  }

  async getBuyerLiveStatus(_buyerId: string): Promise<BuyerLiveStatus> {
    // TODO: Implement Redis multi-key lookup
    throw new Error('Redis provider not implemented');
  }

  async getTargetsLiveStatus(_targetIds: string[]): Promise<Map<string, number>> {
    // TODO: Implement Redis MGET
    throw new Error('Redis provider not implemented');
  }
}

// Factory: swap via environment variable
const providerType = process.env.LIVE_STATUS_PROVIDER || 'database';

export const liveStatusService: LiveStatusProvider =
  providerType === 'redis' ? new RedisLiveStatusProvider() : new DatabaseLiveStatusProvider();
