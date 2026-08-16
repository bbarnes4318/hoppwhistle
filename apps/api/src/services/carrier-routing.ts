/**
 * Carrier waterfall routing — data access, caching, and health feedback.
 *
 * The ordering rules live in `@hopwhistle/shared` and are pure. This file is
 * the part that touches Postgres: it loads a tenant's route, caches the
 * resolved chain briefly so a busy dialer does not issue one query per call,
 * and folds call outcomes back into per-gateway health.
 *
 * Every read path here is written so that a database problem degrades to the
 * previously hardcoded FracTEL chain rather than to a failed call. Routing is
 * on the critical path of every origination in the system; it is not allowed
 * to be the thing that stops the phones.
 */

import {
  CALL_ROUTE_LABELS,
  CALL_ROUTE_TYPES,
  DEFAULT_LEG_TIMEOUT_SECONDS,
  applyOutcome,
  buildBridgeString,
  formatForGateway,
  isCarrierFault,
  resolveChain,
  type BridgeOptions,
  type CallRouteType,
  type ResolvedChain,
  type RouteRow,
} from '@hopwhistle/shared';

import { getPrismaClient } from '../lib/prisma.js';
import { INBOUND_DEST_PLACEHOLDER } from '../lib/route-destination.js';

/**
 * How long a resolved chain is reused.
 *
 * Short enough that an admin flipping a carrier in the settings UI sees it take
 * effect within seconds — the point of the feature is that changing carriers
 * during an outage is fast — and long enough that a predictive dialer at full
 * tilt is not issuing a join per originate. Writes through this module also
 * invalidate explicitly, so the TTL only matters for changes made elsewhere.
 */
const CACHE_TTL_MS = 10_000;

interface CacheEntry {
  chain: ResolvedChain;
  expiresAt: number;
}

const chainCache = new Map<string, CacheEntry>();
const cacheKey = (tenantId: string, callType: CallRouteType) => `${tenantId}:${callType}`;

/** Tenant resolved from a caller-ID DID, cached — the DID→tenant map is static. */
const tenantByDidCache = new Map<string, { tenantId: string | null; expiresAt: number }>();
const DID_CACHE_TTL_MS = 60_000;

let defaultTenantCache: { tenantId: string | null; expiresAt: number } | null = null;

export function invalidateCarrierRoutingCache(tenantId?: string): void {
  if (!tenantId) {
    chainCache.clear();
    return;
  }
  for (const key of chainCache.keys()) {
    if (key.startsWith(`${tenantId}:`)) chainCache.delete(key);
  }
}

/** Test seam — the module keeps process-local state that must not leak between tests. */
export function resetCarrierRoutingCaches(): void {
  chainCache.clear();
  tenantByDidCache.clear();
  defaultTenantCache = null;
}

// ────────────────────────────────────────────────────────────────────────────
// Reads
// ────────────────────────────────────────────────────────────────────────────

async function loadRoute(tenantId: string, callType: CallRouteType): Promise<RouteRow | null> {
  const prisma = getPrismaClient();

  const route = await prisma.carrierRoute.findUnique({
    where: { tenantId_callType: { tenantId, callType } },
    include: {
      steps: {
        include: { carrier: { select: { id: true, code: true, name: true, status: true } } },
      },
    },
  });
  if (!route) return null;

  // Gateways are fetched per tenant in one query rather than nested per step:
  // the nesting would issue a join per carrier, and this list is a handful of
  // rows that the cache holds for ten seconds anyway.
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
 * The carrier chain to dial for one tenant and call type.
 *
 * Never throws and never returns an empty chain. A database error is logged and
 * answered with the legacy FracTEL chain, because the alternative — propagating
 * the error — turns a routing outage into a total outage.
 */
export async function getCarrierChain(
  tenantId: string | null | undefined,
  callType: CallRouteType
): Promise<ResolvedChain> {
  if (!tenantId) return resolveChain(null, callType);

  const key = cacheKey(tenantId, callType);
  const hit = chainCache.get(key);
  const now = Date.now();
  if (hit && hit.expiresAt > now) return hit.chain;

  let chain: ResolvedChain;
  try {
    chain = resolveChain(await loadRoute(tenantId, callType), callType);
  } catch (error) {
    console.error(
      `[carrier-routing] route lookup failed for ${tenantId}/${callType}; using legacy chain:`,
      (error as Error).message
    );
    chain = resolveChain(null, callType);
    // Cache the failure briefly too. Without this, a database outage turns into
    // one failed query per call on top of everything else that is already wrong.
  }

  chainCache.set(key, { chain, expiresAt: now + CACHE_TTL_MS });
  return chain;
}

/**
 * Which tenant owns a call, given the caller-ID DID FreeSWITCH presents.
 *
 * The dialplan has no session concept, so the outbound number is the only
 * tenant evidence on the channel. This mirrors the recovery already used by
 * `/api/v1/agent/call/originate`.
 */
export async function resolveTenantForCallerId(callerId?: string | null): Promise<string | null> {
  const last10 = (callerId ?? '').replace(/\D/g, '').slice(-10);
  if (last10.length !== 10) return await getDefaultRoutingTenantId();

  const now = Date.now();
  const hit = tenantByDidCache.get(last10);
  if (hit && hit.expiresAt > now) return hit.tenantId ?? (await getDefaultRoutingTenantId());

  let tenantId: string | null = null;
  try {
    const prisma = getPrismaClient();
    const row = await prisma.phoneNumber.findFirst({
      where: { number: { endsWith: last10 } },
      select: { tenantId: true },
    });
    tenantId = row?.tenantId ?? null;
  } catch (error) {
    console.error('[carrier-routing] tenant lookup by DID failed:', (error as Error).message);
  }

  tenantByDidCache.set(last10, { tenantId, expiresAt: now + DID_CACHE_TTL_MS });
  return tenantId ?? (await getDefaultRoutingTenantId());
}

/**
 * The tenant to route for when nothing on the channel identifies one.
 *
 * `CARRIER_ROUTING_DEFAULT_TENANT_ID` wins when set. Otherwise this picks the
 * tenant owning the most active phone numbers, which is the only signal
 * available that distinguishes a live tenant from the leftover test rows that
 * share this database.
 */
export async function getDefaultRoutingTenantId(): Promise<string | null> {
  const configured = process.env.CARRIER_ROUTING_DEFAULT_TENANT_ID;
  if (configured) return configured;

  const now = Date.now();
  if (defaultTenantCache && defaultTenantCache.expiresAt > now) return defaultTenantCache.tenantId;

  let tenantId: string | null = null;
  try {
    const prisma = getPrismaClient();
    const grouped = await prisma.phoneNumber.groupBy({
      by: ['tenantId'],
      where: { status: 'ACTIVE' },
      _count: { _all: true },
      orderBy: { _count: { tenantId: 'desc' } },
      take: 1,
    });
    tenantId = grouped[0]?.tenantId ?? null;
  } catch (error) {
    console.error('[carrier-routing] default tenant lookup failed:', (error as Error).message);
  }

  defaultTenantCache = { tenantId, expiresAt: now + DID_CACHE_TTL_MS };
  return tenantId;
}

/** Resolve a chain and render it as a FreeSWITCH bridge string in one step. */
export async function getBridgeString(
  tenantId: string | null | undefined,
  callType: CallRouteType,
  destination: string,
  options: BridgeOptions = {}
): Promise<{ bridge: string | null; chain: ResolvedChain }> {
  const chain = await getCarrierChain(tenantId, callType);
  return { bridge: buildBridgeString(chain, destination, options), chain };
}

/**
 * The INBOUND waterfall, in the two shapes `inbound_route.lua` consumes.
 *
 * `gatewaysCsv` is the field the Lua has always read and is kept so an older
 * FreeSWITCH image keeps working against a newer API. `bridgeTemplate` is the
 * full leg list with the destination left as `{DEST}`, which is what carries
 * per-carrier number formatting — a chain that falls from FracTEL (1XXXXXXXXXX)
 * to SignalWire (+1XXXXXXXXXX) cannot be expressed as a list of gateway names.
 */
export async function getInboundCarrierChain(tenantId: string | null | undefined): Promise<{
  gatewaysCsv: string;
  bridgeTemplate: string;
  source: 'db' | 'fallback';
}> {
  const chain = await getCarrierChain(tenantId, 'INBOUND');
  return {
    gatewaysCsv: chain.gateways.map(g => g.gateway).join(','),
    bridgeTemplate: chain.gateways
      .map(
        g =>
          `sofia/gateway/${g.gateway}/${formatForGateway(INBOUND_DEST_PLACEHOLDER, g.numberFormat)}`
      )
      .join('|'),
    source: chain.source,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Health feedback
// ────────────────────────────────────────────────────────────────────────────

/**
 * Fold one call's outcome into a gateway's health.
 *
 * Best-effort by construction: this is called from CDR handling and from the
 * dialer's originate path, and a failure to record statistics must never
 * surface as a failed call. Errors are logged and swallowed.
 */
export async function recordGatewayOutcome(
  gatewayName: string,
  outcome: { ok: boolean; cause?: string | null },
  tenantId?: string | null
): Promise<void> {
  const name = (gatewayName || '').trim();
  if (!name) return;

  // Neither a success nor a carrier fault changes anything except counters we
  // do not need in real time, so skip the write entirely for callee-side
  // outcomes — that is the overwhelming majority of hangups.
  if (!outcome.ok && !isCarrierFault(outcome.cause)) return;

  try {
    const prisma = getPrismaClient();
    const gateways = await prisma.carrierGateway.findMany({
      where: { name, ...(tenantId ? { tenantId } : {}) },
      select: { id: true, tenantId: true, consecutiveFailures: true, circuitOpenUntil: true },
    });
    if (gateways.length === 0) return;

    for (const gateway of gateways) {
      const update = applyOutcome(
        { consecutiveFailures: gateway.consecutiveFailures },
        outcome
      );

      await prisma.carrierGateway.update({
        where: { id: gateway.id },
        data: {
          consecutiveFailures: update.consecutiveFailures,
          // Only ever extend or clear the window; a non-tripping failure must
          // not reopen a gateway that a previous failure already demoted.
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

      if (update.circuitOpenUntil) {
        console.warn(
          `[carrier-routing] gateway ${name} demoted until ${update.circuitOpenUntil.toISOString()} ` +
            `after ${update.consecutiveFailures} consecutive carrier faults (last: ${update.lastFailureCause})`
        );
      }
      invalidateCarrierRoutingCache(gateway.tenantId);
    }
  } catch (error) {
    console.error('[carrier-routing] failed to record gateway outcome:', (error as Error).message);
  }
}

/**
 * The gateway a channel actually used, from a FreeSWITCH channel name.
 * `sofia/gateway/fractel3/+18005551212` → `fractel3`. Returns null rather than
 * guessing for internal, loopback, or unrecognized channel names.
 */
export function gatewayFromChannelName(channelName?: string | null): string | null {
  if (!channelName) return null;
  const match = /^sofia\/gateway\/([^/]+)\//.exec(channelName.trim());
  return match ? match[1] : null;
}

// ────────────────────────────────────────────────────────────────────────────
// Admin reads
// ────────────────────────────────────────────────────────────────────────────

export interface CarrierRouteView {
  callType: CallRouteType;
  label: string;
  enabled: boolean;
  legTimeoutSeconds: number;
  /** Waterfall order as configured, including disabled rungs so the UI can show them. */
  steps: Array<{
    stepId: string | null;
    carrierId: string;
    carrierCode: string;
    carrierName: string;
    carrierStatus: string;
    position: number;
    enabled: boolean;
    gateways: Array<{
      id: string;
      name: string;
      priority: number;
      enabled: boolean;
      numberFormat: string;
      circuitOpen: boolean;
      circuitOpenUntil: string | null;
      consecutiveFailures: number;
      lastFailureAt: string | null;
      lastFailureCause: string | null;
      lastSuccessAt: string | null;
      totalAttempts: number;
      totalFailures: number;
    }>;
  }>;
  /** What would actually be dialed right now, health applied. */
  effectiveChain: string[];
  effectiveSource: 'db' | 'fallback';
}

/** Everything the settings page needs, for all six call types, in one read. */
export async function listCarrierRoutes(tenantId: string): Promise<CarrierRouteView[]> {
  const prisma = getPrismaClient();

  const [routes, carriers, gateways] = await Promise.all([
    prisma.carrierRoute.findMany({
      where: { tenantId },
      include: { steps: true },
    }),
    prisma.carrier.findMany({
      where: { tenantId },
      select: { id: true, code: true, name: true, status: true },
    }),
    prisma.carrierGateway.findMany({ where: { tenantId }, orderBy: { priority: 'asc' } }),
  ]);

  const carrierById = new Map(carriers.map(c => [c.id, c]));
  const gatewaysByCarrier = new Map<string, typeof gateways>();
  for (const g of gateways) {
    const list = gatewaysByCarrier.get(g.carrierId);
    if (list) list.push(g);
    else gatewaysByCarrier.set(g.carrierId, [g]);
  }

  const now = Date.now();
  const routeByType = new Map(routes.map(r => [r.callType as CallRouteType, r]));

  const views: CarrierRouteView[] = [];
  for (const callType of CALL_ROUTE_TYPES) {
    const route = routeByType.get(callType);
    const chain = await getCarrierChain(tenantId, callType);

    const steps = (route?.steps ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .flatMap(s => {
        const carrier = carrierById.get(s.carrierId);
        if (!carrier) return [];
        return [
          {
            stepId: s.id,
            carrierId: carrier.id,
            carrierCode: carrier.code,
            carrierName: carrier.name,
            carrierStatus: carrier.status,
            position: s.position,
            enabled: s.enabled,
            gateways: (gatewaysByCarrier.get(carrier.id) ?? []).map(g => ({
              id: g.id,
              name: g.name,
              priority: g.priority,
              enabled: g.enabled,
              numberFormat: g.numberFormat as string,
              circuitOpen: !!g.circuitOpenUntil && g.circuitOpenUntil.getTime() > now,
              circuitOpenUntil: g.circuitOpenUntil?.toISOString() ?? null,
              consecutiveFailures: g.consecutiveFailures,
              lastFailureAt: g.lastFailureAt?.toISOString() ?? null,
              lastFailureCause: g.lastFailureCause,
              lastSuccessAt: g.lastSuccessAt?.toISOString() ?? null,
              totalAttempts: Number(g.totalAttempts),
              totalFailures: Number(g.totalFailures),
            })),
          },
        ];
      });

    views.push({
      callType,
      label: CALL_ROUTE_LABELS[callType],
      enabled: route?.enabled ?? false,
      legTimeoutSeconds: route?.legTimeoutSeconds ?? DEFAULT_LEG_TIMEOUT_SECONDS,
      steps,
      effectiveChain: chain.gateways.map(g => g.gateway),
      effectiveSource: chain.source,
    });
  }

  return views;
}

// Re-exported so callers get the routing vocabulary from one import.
export { CALL_ROUTE_LABELS, CALL_ROUTE_TYPES, isCallRouteType } from '@hopwhistle/shared';
export type { CallRouteType, ResolvedChain } from '@hopwhistle/shared';
