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

const cache = new Map<string, { chain: ResolvedChain; expiresAt: number }>();

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
        include: { carrier: { select: { id: true, code: true, name: true, status: true } } },
      },
    },
  });
  if (!route) return null;

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
  callType: CallRouteType
): Promise<ResolvedChain> {
  if (!tenantId) return resolveChain(null, callType);

  const cacheId = key(tenantId, callType);
  const now = Date.now();
  const hit = cache.get(cacheId);
  if (hit && hit.expiresAt > now) return hit.chain;

  let chain: ResolvedChain;
  try {
    chain = resolveChain(await loadRoute(prisma, tenantId, callType), callType);
  } catch (error) {
    logger.error({
      msg: 'carrier route lookup failed; falling back to legacy chain',
      tenantId,
      callType,
      err: (error as Error).message,
    });
    chain = resolveChain(null, callType);
  }

  cache.set(cacheId, { chain, expiresAt: now + CACHE_TTL_MS });
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
  const base = await getCarrierChain(prisma, tenantId, callType);

  const counterKey = key(tenantId ?? 'none', callType);
  const rotation = rotationCounters.get(counterKey) ?? 0;
  rotationCounters.set(counterKey, rotation + 1);

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
