import { logger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';
import { extractAreaCode, getStateFromAreaCode, isCallerStateAccepted } from '../lib/geo.js';

const INTERNAL_EXTENSION_RE = /^\d{4}$/;
const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isInternalAgentDestination(destination: string): boolean {
  const normalized = destination.trim();
  return INTERNAL_EXTENSION_RE.test(normalized) || USER_ID_RE.test(normalized);
}

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
    if (callData.callerState) {
      return callData.callerState.toUpperCase().trim();
    }

    if (callData.callerAreaCode) {
      const state = getStateFromAreaCode(callData.callerAreaCode);
      if (state) return state;
    }

    if (callData.callerId) {
      const areaCode = extractAreaCode(callData.callerId);
      if (areaCode) {
        return getStateFromAreaCode(areaCode);
      }
    }

    return null;
  }

  /**
   * Get all eligible buyer endpoints for a campaign, filtered by geo-routing,
   * concurrency, and agent availability rules.
   */
  async getEligibleEndpoints(
    tenantId: string,
    campaignId: string,
    callData: CallData
  ): Promise<EligibleEndpoint[]> {
    const callerState = this.resolveCallerState(callData);

    logger.info({
      msg: 'Geo-routing: Resolving caller state',
      callerId: callData.callerId,
      callerAreaCode: callData.callerAreaCode,
      resolvedState: callerState,
    });

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
      if (assignment.buyer.status !== 'ACTIVE') {
        continue;
      }

      if (assignment.buyerEndpoint && assignment.buyerEndpoint.status !== 'ACTIVE') {
        continue;
      }

      const ep = assignment.buyerEndpoint;
      const acceptedStates = ep?.acceptedStates || [];

      allEndpoints.push({
        buyerId: assignment.buyerId,
        buyerName: assignment.buyer.name,
        endpointId: assignment.buyerEndpointId,
        destination: assignment.destinationNumber,
        priority: assignment.priority,
        weight: assignment.weight,
        acceptedStates,
        isNational: acceptedStates.length === 0,
      });
    }

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

    const activeTargetIds = eligibleEndpoints
      .map(ep => ep.endpointId)
      .filter((id): id is string => id !== null);

    if (activeTargetIds.length > 0) {
      try {
        const { liveStatusService } = await import('./buyer-live-status-service.js');
        const liveStatusMap = await liveStatusService.getTargetsLiveStatus(activeTargetIds);

        eligibleEndpoints = eligibleEndpoints.filter(ep => {
          if (!ep.endpointId) return true;

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

    // Internal softphones register with a four-digit extension. Older campaign
    // assignments may still contain the user's UUID, so translate those legacy
    // destinations before returning the route to FreeSWITCH.
    try {
      const users = await this.prisma.user.findMany({
        where: { tenantId, status: 'ACTIVE' },
        select: { id: true, metadata: true },
      });

      const extensionToUserMap = new Map<string, string>();
      const userIdToExtensionMap = new Map<string, string>();

      for (const user of users) {
        if (!user.metadata || typeof user.metadata !== 'object' || Array.isArray(user.metadata)) {
          continue;
        }

        const extension = (user.metadata as Record<string, unknown>).extension;
        if (typeof extension !== 'string' && typeof extension !== 'number') continue;

        const normalizedExtension = extension.toString().trim();
        if (!normalizedExtension) continue;

        extensionToUserMap.set(normalizedExtension, user.id);
        userIdToExtensionMap.set(user.id, normalizedExtension);
      }

      if (extensionToUserMap.size > 0 || userIdToExtensionMap.size > 0) {
        const { getRedisClient } = await import('./redis.js');
        const redis = getRedisClient();

        const statuses = await Promise.all(
          eligibleEndpoints.map(async ep => {
            const originalDestination = ep.destination.trim();
            const legacyExtension = userIdToExtensionMap.get(originalDestination);
            const normalizedEndpoint = legacyExtension
              ? { ...ep, destination: legacyExtension }
              : ep;
            const userId = legacyExtension
              ? originalDestination
              : extensionToUserMap.get(originalDestination);

            if (legacyExtension) {
              logger.info({
                msg: 'Agent-routing: Translated legacy user UUID to SIP extension',
                userId: originalDestination,
                extension: legacyExtension,
                campaignId,
              });
            }

            if (!userId) {
              return { ep: normalizedEndpoint, eligible: true };
            }

            const key = `agent:status:${userId}`;
            try {
              const data = await redis.get(key);
              if (data) {
                const statusData = JSON.parse(data) as {
                  status?: string;
                  currentCallId?: string | null;
                };

                if (statusData.status !== 'available' || statusData.currentCallId) {
                  logger.info({
                    msg: 'Agent-status: Endpoint EXCLUDED (agent busy/offline)',
                    buyerId: normalizedEndpoint.buyerId,
                    buyerName: normalizedEndpoint.buyerName,
                    destination: normalizedEndpoint.destination,
                    agentStatus: statusData.status,
                    currentCallId: statusData.currentCallId,
                  });
                  return { ep: normalizedEndpoint, eligible: false };
                }
              } else {
                // Redis is advisory; FreeSWITCH registration is authoritative.
                // Failing open prevents a missing/stale status key from turning a
                // valid softphone ring group into an unroutable "Campaign" leg.
                logger.warn({
                  msg: 'Agent-status: No Redis status; leaving endpoint eligible for SIP registration check',
                  buyerId: normalizedEndpoint.buyerId,
                  buyerName: normalizedEndpoint.buyerName,
                  destination: normalizedEndpoint.destination,
                  userId,
                });
              }
            } catch (redisErr) {
              logger.warn({
                msg: 'Agent-status: Redis lookup error (fail-open)',
                userId,
                error: (redisErr as Error).message,
              });
            }

            return { ep: normalizedEndpoint, eligible: true };
          })
        );

        eligibleEndpoints = statuses.filter(status => status.eligible).map(status => status.ep);
      }
    } catch (err) {
      logger.error('Error applying agent status filter:', err);
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
   * Select the best destination for a campaign. Internal softphone-only campaigns
   * behave as ring groups: every available agent at the same priority rings in
   * parallel, with lower-priority groups used as sequential failover steps.
   * External buyer campaigns retain weighted selection behavior.
   */
  async selectBestBuyer(
    tenantId: string,
    campaignId: string,
    callData: CallData = {}
  ): Promise<{
    buyerId: string;
    endpoint: string;
    targetId?: string | null;
    callerState?: string | null;
  } | null> {
    try {
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

      const priorityGroups = new Map<number, EligibleEndpoint[]>();
      for (const endpoint of eligibleEndpoints) {
        const priority = endpoint.priority;
        if (!priorityGroups.has(priority)) {
          priorityGroups.set(priority, []);
        }
        priorityGroups.get(priority)!.push(endpoint);
      }

      const sortedPriorities = [...priorityGroups.keys()].sort((a, b) => a - b);
      const softphoneOnly = eligibleEndpoints.every(endpoint =>
        isInternalAgentDestination(endpoint.destination)
      );

      if (softphoneOnly) {
        const ringSteps = sortedPriorities
          .map(priority => {
            const seen = new Set<string>();
            return priorityGroups
              .get(priority)!
              .map(endpoint => endpoint.destination.trim())
              .filter(destination => {
                if (!destination || seen.has(destination)) return false;
                seen.add(destination);
                return true;
              })
              .join(',');
          })
          .filter(Boolean);

        const primaryEndpoint = priorityGroups.get(sortedPriorities[0])![0];
        const ringGroupDestination = ringSteps.join('|');

        logger.info({
          msg: 'Selected internal softphone ring group',
          campaignId,
          destination: ringGroupDestination,
          agentCount: eligibleEndpoints.length,
          prioritySteps: ringSteps.length,
          callerState: this.resolveCallerState(callData),
        });

        return {
          buyerId: primaryEndpoint.buyerId,
          endpoint: ringGroupDestination,
          targetId: primaryEndpoint.endpointId,
          callerState: this.resolveCallerState(callData),
        };
      }

      const failoverEndpoints: EligibleEndpoint[] = [];
      for (const priority of sortedPriorities) {
        const group = priorityGroups.get(priority)!;
        let totalWeight = 0;
        for (const endpoint of group) {
          totalWeight += Math.max(1, endpoint.weight);
        }

        const randomValue = Math.random() * totalWeight;
        let currentSum = 0;
        let selectedEndpoint = group[0];

        for (const endpoint of group) {
          currentSum += Math.max(1, endpoint.weight);
          if (randomValue <= currentSum) {
            selectedEndpoint = endpoint;
            break;
          }
        }
        failoverEndpoints.push(selectedEndpoint);
      }

      const primaryEndpoint = failoverEndpoints[0];
      const failoverDestinationString = failoverEndpoints
        .map(endpoint => endpoint.destination)
        .join('|');

      logger.info({
        msg: 'Selected buyer via priority and weight routing with failover chain',
        campaignId,
        buyerId: primaryEndpoint.buyerId,
        buyerName: primaryEndpoint.buyerName,
        endpointId: primaryEndpoint.endpointId,
        destination: failoverDestinationString,
        weight: primaryEndpoint.weight,
        priority: primaryEndpoint.priority,
        callerState: this.resolveCallerState(callData),
      });

      return {
        buyerId: primaryEndpoint.buyerId,
        endpoint: failoverDestinationString,
        targetId: primaryEndpoint.endpointId,
        callerState: this.resolveCallerState(callData),
      };
    } catch (error) {
      logger.error('Error selecting best buyer:', error);
      return null;
    }
  }
}

export const routingService = new RoutingService();
