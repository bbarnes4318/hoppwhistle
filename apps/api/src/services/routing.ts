import { logger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';
import { extractAreaCode, getStateFromAreaCode, isCallerStateAccepted } from '../lib/geo.js';

/**
 * Call data context for routing decisions.
 * Includes caller identification and geo data.
 */
export interface CallData {
  /** Caller's phone number (ANI) in E.164 or 10-digit format */
  callerId?: string | null;
  /** Pre-resolved caller area code (3 digits) */
  callerAreaCode?: string | null;
  /** Pre-resolved caller state (2-letter code) */
  callerState?: string | null;
  /** Caller's ZIP code if available */
  callerZipCode?: string | null;
}

/**
 * Eligible buyer endpoint with geo-routing and weight metadata.
 */
export interface EligibleEndpoint {
  buyerId: string;
  buyerName: string;
  endpointId: string | null;
  destination: string;
  priority: number;
  weight: number;
  acceptedStates: string[];
  /** Whether this is a "National" endpoint (no state restrictions) */
  isNational: boolean;
}

export class RoutingService {
  private prisma = getPrismaClient();

  /**
   * Resolve caller's state from available call data.
   * Uses pre-resolved state if available, otherwise extracts from callerId.
   */
  resolveCallerState(callData: CallData): string | null {
    // 1. Use pre-resolved state if available
    if (callData.callerState) {
      return callData.callerState.toUpperCase().trim();
    }

    // 2. Use pre-resolved area code if available
    if (callData.callerAreaCode) {
      const state = getStateFromAreaCode(callData.callerAreaCode);
      if (state) return state;
    }

    // 3. Extract from callerId phone number
    if (callData.callerId) {
      const areaCode = extractAreaCode(callData.callerId);
      if (areaCode) {
        return getStateFromAreaCode(areaCode);
      }
    }

    return null;
  }

  /**
   * Get all eligible buyer endpoints for a campaign, filtered by geo-routing and concurrency rules.
   *
   * @param tenantId - Tenant ID for the call
   * @param campaignId - Campaign ID to route for
   * @param callData - Caller data for geo-filtering
   * @returns List of eligible endpoints after geo/concurrency filtering, or empty array if none match
   */
  async getEligibleEndpoints(
    tenantId: string,
    campaignId: string,
    callData: CallData
  ): Promise<EligibleEndpoint[]> {
    // Step 1: Resolve caller's state from callData
    const callerState = this.resolveCallerState(callData);

    logger.info({
      msg: 'Geo-routing: Resolving caller state',
      callerId: callData.callerId,
      callerAreaCode: callData.callerAreaCode,
      resolvedState: callerState,
    });

    // Step 2: Fetch active campaign buyer assignments
    const campaignBuyers = await this.prisma.campaignBuyer.findMany({
      where: {
        campaignId,
        status: 'ACTIVE',
        tenantId,
      },
      include: {
        buyer: {
          select: {
            id: true,
            name: true,
            status: true,
          },
        },
        buyerEndpoint: {
          select: {
            id: true,
            name: true,
            status: true,
            maxConcurrency: true,
            acceptedStates: true,
            weight: true,
          },
        },
      },
    });

    const allEndpoints: EligibleEndpoint[] = [];

    for (const assignment of campaignBuyers) {
      // Exclude if buyer is inactive
      if (assignment.buyer.status !== 'ACTIVE') {
        continue;
      }

      // If buyerEndpoint is attached, verify it is active
      if (assignment.buyerEndpoint && assignment.buyerEndpoint.status !== 'ACTIVE') {
        continue;
      }

      const ep = assignment.buyerEndpoint;
      const acceptedStates = ep?.acceptedStates || [];
      const weight = assignment.weight; // CampaignBuyer.weight is the primary weight

      allEndpoints.push({
        buyerId: assignment.buyerId,
        buyerName: assignment.buyer.name,
        endpointId: assignment.buyerEndpointId,
        destination: assignment.destinationNumber,
        priority: assignment.priority,
        weight: weight,
        acceptedStates: acceptedStates,
        isNational: acceptedStates.length === 0,
      });
    }

    // Step 3: Apply geo-routing filter
    // Logic: IF acceptedStates IS NOT EMPTY AND callerState NOT IN acceptedStates THEN EXCLUDE
    let eligibleEndpoints = allEndpoints.filter(ep => {
      const isAccepted = isCallerStateAccepted(callerState, ep.acceptedStates);

      if (!isAccepted) {
        logger.info({
          msg: 'Geo-routing: Endpoint EXCLUDED (state not accepted)',
          buyerId: ep.buyerId,
          buyerName: ep.buyerName,
          endpointId: ep.endpointId,
          callerState,
          acceptedStates: ep.acceptedStates,
        });
      }

      return isAccepted;
    });

    // Step 4: Apply concurrency routing filter
    const activeTargetIds = eligibleEndpoints
      .map(ep => ep.endpointId)
      .filter((id): id is string => id !== null);

    if (activeTargetIds.length > 0) {
      try {
        const { liveStatusService } = await import('./buyer-live-status-service.js');
        const liveStatusMap = await liveStatusService.getTargetsLiveStatus(activeTargetIds);

        eligibleEndpoints = eligibleEndpoints.filter(ep => {
          if (!ep.endpointId) return true; // Direct route with no endpoint, bypass capacity check

          // Get maxConcurrency from DB campaign buyer's endpoint
          const dbAssignment = campaignBuyers.find(cb => cb.buyerEndpointId === ep.endpointId);
          const maxConcurrency = dbAssignment?.buyerEndpoint?.maxConcurrency ?? 10;

          const liveCalls = liveStatusMap.get(ep.endpointId) || 0;
          const isFull = maxConcurrency > 0 && liveCalls >= maxConcurrency;

          if (isFull) {
            logger.info({
              msg: 'Concurrency-routing: Endpoint EXCLUDED (at capacity)',
              buyerId: ep.buyerId,
              buyerName: ep.buyerName,
              endpointId: ep.endpointId,
              liveCalls,
              maxConcurrency,
            });
          }

          return !isFull;
        });
      } catch (err) {
        logger.error('Error checking concurrency (fail-open):', err);
      }
    }

    logger.info({
      msg: 'Geo/Concurrency-routing: Filtering complete',
      campaignId,
      callerState,
      totalEndpoints: allEndpoints.length,
      eligibleEndpoints: eligibleEndpoints.length,
      excludedCount: allEndpoints.length - eligibleEndpoints.length,
    });

    return eligibleEndpoints;
  }

  /**
   * Select the best buyer for a campaign based on priority tiering, geo-routing, max concurrency, and weight settings.
   *
   * @param tenantId - Tenant ID
   * @param campaignId - Campaign ID
   * @param callData - Optional call data for geo-routing (defaults to no filter)
   * @returns Best buyer endpoint or null if none available
   */
  async selectBestBuyer(
    tenantId: string,
    campaignId: string,
    callData: CallData = {}
  ): Promise<{ buyerId: string; endpoint: string; targetId?: string | null; callerState?: string | null } | null> {
    try {
      // 1. Get geo and concurrency filtered eligible endpoints
      const eligibleEndpoints = await this.getEligibleEndpoints(tenantId, campaignId, callData);

      if (eligibleEndpoints.length === 0) {
        const callerState = this.resolveCallerState(callData);
        logger.warn({
          msg: 'No eligible buyers after dynamic filtering',
          campaignId,
          callerState,
          callerId: callData.callerId,
        });
        return null;
      }

      // 2. Group eligible endpoints by priority (descending)
      const priorityGroups = new Map<number, EligibleEndpoint[]>();
      for (const ep of eligibleEndpoints) {
        const p = ep.priority;
        if (!priorityGroups.has(p)) {
          priorityGroups.set(p, []);
        }
        priorityGroups.get(p)!.push(ep);
      }

      // Get sorted list of unique priorities descending
      const sortedPriorities = [...priorityGroups.keys()].sort((a, b) => b - a);

      // Select highest priority group that is not empty
      const bestGroup = priorityGroups.get(sortedPriorities[0])!;

      // 3. Weighted Random Selection within the selected priority group
      let totalWeight = 0;
      for (const ep of bestGroup) {
        totalWeight += Math.max(1, ep.weight);
      }

      const randomValue = Math.random() * totalWeight;
      let currentSum = 0;
      let selectedEndpoint = bestGroup[0];

      for (const ep of bestGroup) {
        currentSum += Math.max(1, ep.weight);
        if (randomValue <= currentSum) {
          selectedEndpoint = ep;
          break;
        }
      }

      logger.info({
        msg: 'Selected buyer via priority and weight routing',
        campaignId,
        buyerId: selectedEndpoint.buyerId,
        buyerName: selectedEndpoint.buyerName,
        endpointId: selectedEndpoint.endpointId,
        destination: selectedEndpoint.destination,
        weight: selectedEndpoint.weight,
        priority: selectedEndpoint.priority,
        callerState: this.resolveCallerState(callData),
      });

      return {
        buyerId: selectedEndpoint.buyerId,
        endpoint: selectedEndpoint.destination,
        targetId: selectedEndpoint.endpointId,
        callerState: this.resolveCallerState(callData),
      };
    } catch (error) {
      logger.error('Error selecting best buyer:', error);
      return null;
    }
  }
}

export const routingService = new RoutingService();

