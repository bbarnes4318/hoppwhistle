/**
 * Carrier waterfall routing for the worker.
 *
 * The worker owns its own PrismaClient and runs in its own container, so it
 * reads the routing tables directly rather than going through the API. That is
 * deliberate: origination must not acquire a dependency on the API process
 * being up, and the dialer resolving a chain over HTTP would add a network hop
 * to the hot path of every call it places.
 *
 * The ordering rules themselves come from `@hopwhistle/shared` and are the same
 * ones the API and the dialplan use — there is one definition of "which carrier
 * is next", not three.
 */

import type { PrismaClient } from '@prisma/client';
import {
  buildBridgeString,
  resolveChain,
  rotatePrimaryGateways,
  type BridgeOptions,
  type CallRouteType,
  type ResolvedChain,
  type RouteRow,
} from '@hopwhistle/shared';

import { logger } from '../lib/logger.js';

const CACHE_TTL_MS = 10_000;

/**
 * The cache holds the raw route, not the resolved chain: resolution picks a
 * caller ID, and caching its output would pin every call in the TTL window to
 * one DID instead of rotating the pool.
 */
const cache = new Map<string, { route: RouteRow | null; expiresAt: number }>();

/** Per-(tenant, callType) rotation, so each waterfall spreads load independently. */
const rotationCounters = new Map<string, number>();

const key = (tenantId: string, callType: CallRouteType) => `${tenantId}:${callType}`;

export function invalidateCarrierRoutingCache(): void {
  cache.clear();
}

async function loadRoute(
  prisma: PrismaClient,
  tenantId: string,
  callType: CallRouteType
): Promise<RouteRow | null> {
  const route = await prisma.carrierRoute.findUnique({
    where: { tenantId_callType: { tenantId, callType } },
    include: {
      steps: {
        include: {
          carrier: {
            select: {
              id: true,
              code: true,
              name: true,
              status: true,
              callerIdStrategy: true,
              callerIdNumber: true,
              numberProvider: true,
            },
          },
        },
      },
    },
  });
  if (!route) return null;

  // Caller-ID pools for any carrier configured to present its own numbers.
  // `phone_numbers.provider` records which carrier issued a DID, and a carrier
  // can only attest to numbers it issued.
  const poolProviders = route.steps
    .filter(s => s.carrier.callerIdStrategy === 'POOL')
    .map(s => s.carrier.numberProvider)
    .filter((p): p is string => !!p);

  const callerIdsByProvider = new Map<string, string[]>();
  if (poolProviders.length > 0) {
    const numbers = await prisma.phoneNumber.findMany({
      where: { tenantId, status: 'ACTIVE', provider: { in: [...new Set(poolProviders)] } },
      select: { number: true, provider: true },
      orderBy: { number: 'asc' },
    });
    for (const n of numbers) {
      if (!n.provider) continue;
      const list = callerIdsByProvider.get(n.provider);
      if (list) list.push(n.number);
      else callerIdsByProvider.set(n.provider, [n.number]);
    }
  }

  const gateways = await prisma.carrierGateway.findMany({
    where: { tenantId },
    select: {
      carrierId: true,
      name: true,
      priority: true,
      enabled: true,
      numberFormat: true,
      circuitOpenUntil: true,
      consecutiveFailures: true,
    },
  });

  const byCarrier = new Map<string, typeof gateways>();
  for (const g of gateways) {
    const list = byCarrier.get(g.carrierId);
    if (list) list.push(g);
    else byCarrier.set(g.carrierId, [g]);
  }

  return {
    callType,
    enabled: route.enabled,
    legTimeoutSeconds: route.legTimeoutSeconds,
    steps: route.steps.map(s => ({
      position: s.position,
      enabled: s.enabled,
      carrierCode: s.carrier.code,
      carrierName: s.carrier.name,
      carrierStatus: s.carrier.status,
      callerIdStrategy: s.carrier.callerIdStrategy,
      callerIdNumber: s.carrier.callerIdNumber,
      callerIdPool: s.carrier.numberProvider
        ? (callerIdsByProvider.get(s.carrier.numberProvider) ?? [])
        : [],
      gateways: (byCarrier.get(s.carrierId) ?? []).map(g => ({
        name: g.name,
        priority: g.priority,
        enabled: g.enabled,
        numberFormat: g.numberFormat,
        circuitOpenUntil: g.circuitOpenUntil,
        consecutiveFailures: g.consecutiveFailures,
      })),
    })),
  };
}

/**
 * The carrier chain for one tenant and call type.
 *
 * Never throws. A database failure here would otherwise stop the dialer
 * entirely, so it degrades to the legacy FracTEL chain — the same behavior the
 * dialer had before this module existed.
 */
export async function getCarrierChain(
  prisma: PrismaClient,
  tenantId: string | null | undefined,
  callType: CallRouteType,
  callerIdRotation = 0,
  currentCallerId?: string | null
): Promise<ResolvedChain> {
  if (!tenantId) return resolveChain(null, callType);

  const cacheId = key(tenantId, callType);
  const now = Date.now();
  const hit = cache.get(cacheId);

  let route: RouteRow | null;
  if (hit && hit.expiresAt > now) {
    route = hit.route;
  } else {
    try {
      route = await loadRoute(prisma, tenantId, callType);
    } catch (error) {
      logger.error({
        msg: 'carrier route lookup failed; falling back to legacy chain',
        tenantId,
        callType,
        err: (error as Error).message,
      });
      route = null;
    }
    cache.set(cacheId, { route, expiresAt: now + CACHE_TTL_MS });
  }

  const chain = resolveChain(route, callType, new Date(), { callerIdRotation, currentCallerId });

  const unavailable = chain.gateways.find(g => g.callerIdUnavailable);
  if (unavailable) {
    logger.warn({
      msg: 'carrier is set to present its own caller ID but owns no usable ACTIVE number',
      carrier: unavailable.carrierCode,
      detail: "leg will present the call's existing caller ID, which this carrier cannot attest to",
    });
  }

  return chain;
}

/**
 * The dial string for one outbound call, load-rotated within the primary carrier.
 *
 * Returns null only when the destination is not a routable number — callers
 * must treat that as "do not dial", never as "dial something else".
 */
export async function getOutboundDialString(
  prisma: PrismaClient,
  tenantId: string | null | undefined,
  callType: CallRouteType,
  destination: string,
  options: BridgeOptions = {}
): Promise<{ dialString: string | null; chain: ResolvedChain }> {
  const counterKey = key(tenantId ?? 'none', callType);
  const rotation = rotationCounters.get(counterKey) ?? 0;
  rotationCounters.set(counterKey, rotation + 1);

  // One counter drives both rotations: which of the primary carrier's gateways
  // leads, and which DID from the pool is presented. They advance together so a
  // single call is internally consistent — every leg presents one number.
  const base = await getCarrierChain(
    prisma,
    tenantId,
    callType,
    rotation,
    options.channelVariables?.origination_caller_id_number as string | undefined
  );
  const chain = rotatePrimaryGateways(base, rotation);
  return { dialString: buildBridgeString(chain, destination, options), chain };
}

/** Fold an origination outcome into gateway health. Best effort; never throws. */
export async function recordGatewayOutcome(
  prisma: PrismaClient,
  gatewayName: string,
  outcome: { ok: boolean; cause?: string | null },
  tenantId?: string | null
): Promise<void> {
  const name = (gatewayName || '').trim();
  if (!name) return;

  const { applyOutcome, isCarrierFault } = await import('@hopwhistle/shared');
  if (!outcome.ok && !isCarrierFault(outcome.cause)) return;

  try {
    const gateways = await prisma.carrierGateway.findMany({
      where: { name, ...(tenantId ? { tenantId } : {}) },
      select: { id: true, consecutiveFailures: true },
    });

    for (const gateway of gateways) {
      const update = applyOutcome({ consecutiveFailures: gateway.consecutiveFailures }, outcome);
      await prisma.carrierGateway.update({
        where: { id: gateway.id },
        data: {
          consecutiveFailures: update.consecutiveFailures,
          ...(update.circuitOpenUntil
            ? { circuitOpenUntil: update.circuitOpenUntil }
            : outcome.ok
              ? { circuitOpenUntil: null }
              : {}),
          ...(update.lastFailureAt ? { lastFailureAt: update.lastFailureAt } : {}),
          ...(update.lastFailureCause ? { lastFailureCause: update.lastFailureCause } : {}),
          ...(update.lastSuccessAt ? { lastSuccessAt: update.lastSuccessAt } : {}),
          totalAttempts: { increment: 1n },
          ...(outcome.ok ? {} : { totalFailures: { increment: 1n } }),
        },
      });
    }

    if (gateways.length > 0) invalidateCarrierRoutingCache();
  } catch (error) {
    logger.error({
      msg: 'failed to record carrier gateway outcome',
      gateway: name,
      err: (error as Error).message,
    });
  }
}

/** `sofia/gateway/fractel3/+18005551212` → `fractel3`; null when not a gateway channel. */
export function gatewayFromChannelName(channelName?: string | null): string | null {
  if (!channelName) return null;
  const match = /^sofia\/gateway\/([^/]+)\//.exec(channelName.trim());
  return match ? match[1] : null;
}
