import { extractAreaCode, getStateFromAreaCode, isCallerStateAccepted } from '../lib/geo.js';
import { logger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';

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
  /**
   * When a campaign destination was an agent-assigned DID that we translated to
   * the agent's softphone extension, this preserves the original external DID.
   * It is only dialed as a final failover step when the campaign explicitly
   * enables external fallback (campaign.metadata.allowAgentDidExternalFallback).
   */
  externalFallbackDestination?: string | null;
}

/** Normalize phone-number-ish strings to their last 10 digits for comparison. */
function normalizeDidKey(value: string | null | undefined): string {
  const digits = (value || '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
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
      // Per-agent call-concurrency limit (users.metadata.maxConcurrentCalls,
      // default 1, global default via env AGENT_DEFAULT_MAX_CONCURRENT_CALLS).
      // Ported from the live-deployed concurrency fix (also in PR #3) — an agent
      // endpoint is excluded only when the agent is actually AT their limit,
      // never merely for a stale offline/DND availability flag.
      const DEFAULT_MAX_CONCURRENT = Math.max(
        1,
        parseInt(process.env.AGENT_DEFAULT_MAX_CONCURRENT_CALLS || '1', 10) || 1
      );

      const users = await this.prisma.user.findMany({
        where: { tenantId, status: 'ACTIVE' },
        select: { id: true, metadata: true },
      });

      const extensionToUserMap = new Map<string, string>();
      const userIdToExtensionMap = new Map<string, string>();
      const agentMaxConcurrent = new Map<string, number>();

      for (const user of users) {
        if (!user.metadata || typeof user.metadata !== 'object' || Array.isArray(user.metadata)) {
          continue;
        }

        const meta = user.metadata as Record<string, unknown>;
        const rawMax = meta.maxConcurrentCalls;
        const parsedMax = typeof rawMax === 'number' ? rawMax : parseInt(String(rawMax), 10);
        agentMaxConcurrent.set(
          user.id,
          Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : DEFAULT_MAX_CONCURRENT
        );

        const extension = meta.extension;
        if (typeof extension !== 'string' && typeof extension !== 'number') continue;

        const normalizedExtension = extension.toString().trim();
        if (!normalizedExtension) continue;

        extensionToUserMap.set(normalizedExtension, user.id);
        userIdToExtensionMap.set(user.id, normalizedExtension);
      }

      // Agent-assigned DIDs. Campaign buyer rows frequently store an agent's
      // external DID (e.g. +18656000039) rather than their extension; dialing
      // that DID out via a PSTN gateway rings nothing when the number simply
      // forwards back to us — the agent's registered softphone is the real
      // destination. Map DID → owning user so those legs ring the extension,
      // and userId → DIDs so live calls landing on a DID count toward the
      // agent's concurrency limit.
      const didToUserMap = new Map<string, string>();
      const userToDids = new Map<string, string[]>();
      const agentDids = await this.prisma.phoneNumber.findMany({
        where: { tenantId, userId: { not: null } },
        select: { number: true, userId: true },
      });
      for (const row of agentDids) {
        if (!row.number || !row.userId) continue;
        didToUserMap.set(normalizeDidKey(row.number), row.userId);
        const arr = userToDids.get(row.userId) || [];
        arr.push(row.number);
        userToDids.set(row.userId, arr);
      }

      if (extensionToUserMap.size > 0 || userIdToExtensionMap.size > 0 || didToUserMap.size > 0) {
        const { getRedisClient } = await import('./redis.js');
        const redis = getRedisClient();

        const statuses = await Promise.all(
          eligibleEndpoints.map(async ep => {
            const originalDestination = ep.destination.trim();
            const legacyExtension = userIdToExtensionMap.get(originalDestination);
            let normalizedEndpoint = legacyExtension ? { ...ep, destination: legacyExtension } : ep;
            let userId = legacyExtension
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

            // Agent DID → softphone extension translation.
            if (!userId) {
              const didUserId = didToUserMap.get(normalizeDidKey(originalDestination));
              const didExtension = didUserId ? userIdToExtensionMap.get(didUserId) : undefined;
              if (didUserId && didExtension) {
                normalizedEndpoint = {
                  ...ep,
                  destination: didExtension,
                  externalFallbackDestination: originalDestination,
                };
                userId = didUserId;
                logger.info({
                  msg: 'Agent-routing: Translated agent-assigned DID to SIP extension',
                  did: originalDestination,
                  extension: didExtension,
                  userId: didUserId,
                  campaignId,
                });
              }
            }

            if (!userId) {
              return { ep: normalizedEndpoint, eligible: true };
            }

            // Concurrency gate ONLY. We deliberately do NOT exclude an agent
            // merely for being offline or DND — the availability flag is often
            // stale and over-blocks transfers. The agent is excluded only when
            // their live active-call count is at their limit. The Redis
            // "on a call" flag (currentCallId) is a floor so a just-started call
            // that hasn't landed in the Call table yet still counts.
            const maxConcurrent = agentMaxConcurrent.get(userId) ?? DEFAULT_MAX_CONCURRENT;

            let onCallFloor = 0;
            try {
              const data = await redis.get(`agent:status:${userId}`);
              if (data) {
                const statusData = JSON.parse(data) as { currentCallId?: string | null };
                if (statusData?.currentCallId) onCallFloor = 1;
              }
            } catch (redisErr) {
              logger.warn({
                msg: 'Agent-status: Redis lookup error (ignored; using DB count)',
                userId,
                error: (redisErr as Error).message,
              });
            }

            let activeCalls = 0;
            try {
              const dids = userToDids.get(userId) || [];
              const orConds: Array<Record<string, unknown>> = [{ createdById: userId }];
              if (dids.length) {
                orConds.push({ toNumber: { in: dids } });
                orConds.push({ targetNumber: { in: dids } });
              }
              // Only count PLAUSIBLY-live calls. Call rows whose CDR never
              // arrived (e.g. a FreeSWITCH restart mid-call) stay open forever
              // and would permanently exclude the agent. A ring can't outlive
              // ~15 minutes; an answered call is capped at 4 hours here.
              const now = Date.now();
              const ringingSince = new Date(now - 15 * 60 * 1000);
              const answeredSince = new Date(now - 4 * 60 * 60 * 1000);
              activeCalls = await this.prisma.call.count({
                where: {
                  tenantId,
                  OR: orConds,
                  AND: [
                    {
                      OR: [
                        {
                          status: { in: ['INITIATED', 'RINGING'] },
                          createdAt: { gte: ringingSince },
                        },
                        { status: 'ANSWERED', createdAt: { gte: answeredSince } },
                      ],
                    },
                  ],
                },
              });
            } catch (countErr) {
              logger.warn({
                msg: 'Agent-concurrency: count error (fail-open)',
                userId,
                error: (countErr as Error).message,
              });
              return { ep: normalizedEndpoint, eligible: true };
            }

            const effectiveActive = Math.max(activeCalls, onCallFloor);
            if (effectiveActive >= maxConcurrent) {
              logger.info({
                msg: 'Agent-concurrency: Endpoint EXCLUDED (agent at call limit)',
                buyerId: normalizedEndpoint.buyerId,
                buyerName: normalizedEndpoint.buyerName,
                destination: normalizedEndpoint.destination,
                userId,
                activeCalls: effectiveActive,
                maxConcurrent,
              });
              return { ep: normalizedEndpoint, eligible: false };
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
      // Build one sequential failover step per priority. Every eligible internal
      // Hopwhistle extension at that priority rings in parallel. When external
      // buyers/cell phones share the priority, choose exactly one external leg by
      // weight and ring it alongside the internal users. Pure external campaigns
      // therefore retain their original weighted single-buyer behavior.
      const pickWeighted = (group: EligibleEndpoint[]): EligibleEndpoint => {
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
        return selectedEndpoint;
      };

      const ringSteps: string[] = [];
      const selectedEndpoints: EligibleEndpoint[] = [];

      for (const priority of sortedPriorities) {
        const group = priorityGroups.get(priority)!;
        const internalEndpoints = group.filter(endpoint =>
          isInternalAgentDestination(endpoint.destination)
        );
        const externalEndpoints = group.filter(
          endpoint => !isInternalAgentDestination(endpoint.destination)
        );

        const stepEndpoints: EligibleEndpoint[] = [...internalEndpoints];
        if (externalEndpoints.length > 0) {
          stepEndpoints.push(pickWeighted(externalEndpoints));
        }

        const seen = new Set<string>();
        const destinations = stepEndpoints
          .map(endpoint => endpoint.destination.trim())
          .filter(destination => {
            if (!destination || seen.has(destination)) return false;
            seen.add(destination);
            return true;
          });

        if (destinations.length > 0) {
          ringSteps.push(destinations.join(','));
          selectedEndpoints.push(...stepEndpoints);
        }
      }

      // Agent-assigned external DIDs are translated to their registered
      // Hopwhistle extension. Only append those DIDs as a final PSTN fallback
      // when the campaign explicitly opts in.
      const externalFallbacks = eligibleEndpoints
        .map(endpoint => endpoint.externalFallbackDestination?.trim())
        .filter((destination): destination is string => !!destination);

      if (externalFallbacks.length > 0) {
        try {
          const campaign = await this.prisma.campaign.findFirst({
            where: { id: campaignId, tenantId },
            select: { metadata: true },
          });
          const meta =
            campaign?.metadata &&
            typeof campaign.metadata === 'object' &&
            !Array.isArray(campaign.metadata)
              ? (campaign.metadata as Record<string, unknown>)
              : {};

          if (meta.allowAgentDidExternalFallback === true) {
            ringSteps.push([...new Set(externalFallbacks)].join(','));
            logger.info({
              msg: 'Agent-routing: External DID fallback step enabled by campaign metadata',
              campaignId,
              fallbackCount: new Set(externalFallbacks).size,
            });
          }
        } catch (metaErr) {
          logger.warn({
            msg: 'Agent-routing: Could not evaluate external-fallback setting (skipping fallback)',
            campaignId,
            error: (metaErr as Error).message,
          });
        }
      }

      if (ringSteps.length === 0) {
        return null;
      }

      const primaryEndpoint = selectedEndpoints[0] || eligibleEndpoints[0];
      const routePlan = ringSteps.join('|');

      logger.info({
        msg: 'Selected campaign mixed destination ring/failover plan',
        campaignId,
        buyerId: primaryEndpoint.buyerId,
        buyerName: primaryEndpoint.buyerName,
        endpointId: primaryEndpoint.endpointId,
        destination: routePlan,
        eligibleCount: eligibleEndpoints.length,
        prioritySteps: ringSteps.length,
        callerState: this.resolveCallerState(callData),
      });

      return {
        buyerId: primaryEndpoint.buyerId,
        endpoint: routePlan,
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
