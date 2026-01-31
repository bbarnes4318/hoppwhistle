import { logger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';
import { extractAreaCode, getStateFromAreaCode, isCallerStateAccepted } from '../lib/geo.js';

import { analyticsService } from './analytics.js';

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
 * Eligible buyer endpoint with geo-routing metadata.
 */
export interface EligibleEndpoint {
  buyerId: string;
  buyerName: string;
  endpointId: string;
  destination: string;
  priority: number;
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
   * Get all eligible buyer endpoints for a campaign, filtered by geo-routing rules.
   *
   * @param tenantId - Tenant ID for the call
   * @param campaignId - Campaign ID to route for
   * @param callData - Caller data for geo-filtering
   * @returns List of eligible endpoints after geo-filtering, or empty array if none match
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

    // Step 2: Fetch all active buyer endpoints for the campaign
    const campaign = await this.prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        publisher: {
          include: {
            buyers: {
              where: { status: 'ACTIVE' },
              include: {
                endpoints: {
                  where: { status: 'ACTIVE' },
                  orderBy: { priority: 'desc' },
                },
              },
            },
          },
        },
      },
    });

    if (!campaign || !campaign.publisher) {
      logger.warn(`No campaign or publisher found for campaign ${campaignId}`);
      return [];
    }

    const allEndpoints: EligibleEndpoint[] = [];

    for (const buyer of campaign.publisher.buyers) {
      for (const endpoint of buyer.endpoints) {
        allEndpoints.push({
          buyerId: buyer.id,
          buyerName: buyer.name,
          endpointId: endpoint.id,
          destination: endpoint.destination,
          priority: endpoint.priority,
          acceptedStates: endpoint.acceptedStates || [],
          isNational: !endpoint.acceptedStates || endpoint.acceptedStates.length === 0,
        });
      }
    }

    // Step 3: Apply geo-routing filter
    // Logic: IF acceptedStates IS NOT EMPTY AND callerState NOT IN acceptedStates THEN EXCLUDE
    const eligibleEndpoints = allEndpoints.filter(ep => {
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

    logger.info({
      msg: 'Geo-routing: Filtering complete',
      campaignId,
      callerState,
      totalEndpoints: allEndpoints.length,
      eligibleEndpoints: eligibleEndpoints.length,
      excludedCount: allEndpoints.length - eligibleEndpoints.length,
    });

    return eligibleEndpoints;
  }

  /**
   * Select the best buyer for a campaign based on routing mode and geo-filtering.
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
  ): Promise<{ buyerId: string; endpoint: string; callerState?: string | null } | null> {
    try {
      // 1. Get geo-filtered eligible endpoints
      const eligibleEndpoints = await this.getEligibleEndpoints(tenantId, campaignId, callData);

      if (eligibleEndpoints.length === 0) {
        const callerState = this.resolveCallerState(callData);
        logger.warn({
          msg: 'No eligible buyers after geo-filtering',
          campaignId,
          callerState,
          callerId: callData.callerId,
        });
        return null;
      }

      // 2. Fetch Campaign routing mode
      const campaign = await this.prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { routingMode: true },
      });

      if (!campaign) {
        logger.warn(`Campaign not found: ${campaignId}`);
        return null;
      }

      // 3. Group endpoints by buyer for scoring
      const buyerEndpointsMap = new Map<string, EligibleEndpoint[]>();
      for (const ep of eligibleEndpoints) {
        if (!buyerEndpointsMap.has(ep.buyerId)) {
          buyerEndpointsMap.set(ep.buyerId, []);
        }
        buyerEndpointsMap.get(ep.buyerId)!.push(ep);
      }

      const buyerIds = [...buyerEndpointsMap.keys()];

      // 4. Apply routing mode
      if (campaign.routingMode === 'STATIC') {
        // Static: Pick highest priority endpoint from first eligible buyer
        const bestEndpoint = eligibleEndpoints.sort((a, b) => b.priority - a.priority)[0];

        logger.info({
          msg: 'Selected buyer (STATIC mode)',
          campaignId,
          buyerId: bestEndpoint.buyerId,
          buyerName: bestEndpoint.buyerName,
          isNational: bestEndpoint.isNational,
        });

        return {
          buyerId: bestEndpoint.buyerId,
          endpoint: bestEndpoint.destination,
          callerState: this.resolveCallerState(callData),
        };
      }

      // 5. Performance/Hybrid Routing with scores
      const scores = await analyticsService.getBuyerScores(tenantId, campaignId);

      // Tier 1: Buyers with performance scores
      // Tier 2: Buyers without scores (static fallback)
      const tier1: string[] = [];
      const tier2: string[] = [];

      for (const buyerId of buyerIds) {
        if (scores.has(buyerId)) {
          tier1.push(buyerId);
        } else {
          tier2.push(buyerId);
        }
      }

      // Sort Tier 1 by score DESC
      tier1.sort((a, b) => (scores.get(b) || 0) - (scores.get(a) || 0));

      // Sort Tier 2 by buyer name (stable sort)
      const buyerNames = new Map<string, string>();
      for (const ep of eligibleEndpoints) {
        buyerNames.set(ep.buyerId, ep.buyerName);
      }
      tier2.sort((a, b) => (buyerNames.get(a) || '').localeCompare(buyerNames.get(b) || ''));

      // Merge: Performance tier first, then static fallback
      const sortedBuyerIds = [...tier1, ...tier2];
      const bestBuyerId = sortedBuyerIds[0];
      const bestEndpoints = buyerEndpointsMap.get(bestBuyerId)!;
      const bestEndpoint = bestEndpoints.sort((a, b) => b.priority - a.priority)[0];

      logger.info({
        msg: 'Selected buyer (PERFORMANCE/HYBRID mode)',
        campaignId,
        routingMode: campaign.routingMode,
        buyerId: bestBuyerId,
        buyerName: bestEndpoint.buyerName,
        score: scores.get(bestBuyerId),
        tier: tier1.includes(bestBuyerId) ? 'performance' : 'static_fallback',
        isNational: bestEndpoint.isNational,
        callerState: this.resolveCallerState(callData),
      });

      return {
        buyerId: bestBuyerId,
        endpoint: bestEndpoint.destination,
        callerState: this.resolveCallerState(callData),
      };
    } catch (error) {
      logger.error('Error selecting best buyer:', error);
      return null;
    }
  }
}

export const routingService = new RoutingService();
