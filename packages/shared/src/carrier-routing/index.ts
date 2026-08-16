/**
 * Carrier waterfall routing — pure logic.
 *
 * Everything here is a total function over plain data: no database, no clock
 * beyond an injected `now`, no environment. The API and the worker each own
 * their own Prisma reads and hand the rows to `resolveChain`, which is what
 * makes the failover order testable without a carrier, a socket, or a call.
 *
 * The problem this replaces: carrier choice used to be a literal in six
 * different places — `default.xml`, `vapi_outbound.xml`, `public.xml`,
 * `dialer-worker.ts`, `autodialer.ts`, and an env var read by
 * `route-destination.ts`. All six named FracTEL. The six `fractel1..6`
 * gateways look like failover but are one carrier behind six IPs, so a
 * carrier-level problem — blocked termination, spam labeling, an SBC refusing
 * INVITEs — took down inbound, both dialers, and every softphone at once, and
 * the fix required a FreeSWITCH image rebuild.
 */

/** The call paths that get an independently configurable carrier waterfall. */
export const CALL_ROUTE_TYPES = [
  'INBOUND',
  'CC_MANUAL',
  'CC_POWER_DIALER',
  'SOFTPHONE_MANUAL',
  'PREDICTIVE_DIALER',
  'DOGRAH_AI',
] as const;

export type CallRouteType = (typeof CALL_ROUTE_TYPES)[number];

export function isCallRouteType(value: unknown): value is CallRouteType {
  return typeof value === 'string' && (CALL_ROUTE_TYPES as readonly string[]).includes(value);
}

/** Human labels, shared by the settings UI and the CLI so they never drift. */
export const CALL_ROUTE_LABELS: Record<CallRouteType, string> = {
  INBOUND: 'Inbound Calls (All)',
  CC_MANUAL: 'Call Center — Manual Outbound',
  CC_POWER_DIALER: 'Call Center — Power Dialer',
  SOFTPHONE_MANUAL: 'Agent Softphone — Manual Outbound',
  PREDICTIVE_DIALER: 'Predictive Dialer',
  DOGRAH_AI: 'Dograh AI Auto Dialer',
};

export type CarrierNumberFormat = 'E164' | 'NANP11' | 'NANP10';

/**
 * The chain that was hardcoded in the dialplan before this module existed.
 *
 * This is the answer of last resort — used when the database is unreachable,
 * when a tenant has no route configured, or when a route resolves to nothing.
 * It exists so that a failure in the routing layer degrades to the previous
 * behavior instead of to silence. It must never be empty.
 */
export const LEGACY_FALLBACK_GATEWAYS: readonly string[] = [
  'fractel1',
  'fractel2',
  'fractel3',
  'fractel4',
  'fractel5',
  'fractel6',
];

/** Consecutive failures on one gateway before it is demoted. */
export const CIRCUIT_FAILURE_THRESHOLD = 5;

/** How long a demotion lasts before the gateway is retried at full rank. */
export const CIRCUIT_OPEN_SECONDS = 120;

/** Default per-leg dial timeout. */
export const DEFAULT_LEG_TIMEOUT_SECONDS = 20;

// ────────────────────────────────────────────────────────────────────────────
// Inputs
// ────────────────────────────────────────────────────────────────────────────

export interface GatewayRow {
  name: string;
  priority: number;
  enabled: boolean;
  numberFormat: CarrierNumberFormat;
  circuitOpenUntil?: Date | string | null;
  consecutiveFailures?: number;
}

export type CarrierCallerIdStrategy = 'PRESERVE' | 'POOL' | 'FIXED';

export interface StepRow {
  position: number;
  enabled: boolean;
  carrierCode: string;
  carrierName: string;
  carrierStatus?: string;
  gateways: GatewayRow[];
  /** How this carrier's legs present caller ID. Defaults to PRESERVE. */
  callerIdStrategy?: CarrierCallerIdStrategy;
  /** Used when the strategy is FIXED. */
  callerIdNumber?: string | null;
  /** DIDs this carrier issued, for the POOL strategy. */
  callerIdPool?: string[];
}

export interface RouteRow {
  callType: CallRouteType;
  enabled: boolean;
  legTimeoutSeconds?: number;
  steps: StepRow[];
}

// ────────────────────────────────────────────────────────────────────────────
// Outputs
// ────────────────────────────────────────────────────────────────────────────

export interface ResolvedGateway {
  gateway: string;
  carrierCode: string;
  carrierName: string;
  numberFormat: CarrierNumberFormat;
  /** True when this gateway is only in the chain because nothing healthier was left. */
  demoted: boolean;
  /**
   * Caller ID to present on this leg, or null to keep the call's existing one.
   *
   * Null is also what a POOL carrier that owns no DIDs resolves to. That is the
   * safe answer: an empty caller ID is rejected outright by most carriers, so a
   * misconfiguration degrades to "wrong attestation" rather than "no call".
   */
  callerId: string | null;
  /** Set when the carrier wanted its own caller ID but had none to give. */
  callerIdUnavailable?: boolean;
}

export interface ResolvedChain {
  callType: CallRouteType;
  gateways: ResolvedGateway[];
  legTimeoutSeconds: number;
  /** `db` when a configured route produced the chain, `fallback` when it did not. */
  source: 'db' | 'fallback';
  /** Why the fallback was used, for logging. Empty when `source` is `db`. */
  fallbackReason?: string;
  /** Carrier codes in waterfall order, healthy first. */
  carrierOrder: string[];
}

function toTime(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

function fallbackChain(callType: CallRouteType, reason: string): ResolvedChain {
  return {
    callType,
    gateways: LEGACY_FALLBACK_GATEWAYS.map(name => ({
      gateway: name,
      carrierCode: 'FRACTEL',
      carrierName: 'FracTEL',
      numberFormat: 'NANP11' as const,
      demoted: false,
      callerId: null,
    })),
    legTimeoutSeconds: DEFAULT_LEG_TIMEOUT_SECONDS,
    source: 'fallback',
    fallbackReason: reason,
    carrierOrder: ['FRACTEL'],
  };
}

/** Digits-only form used to compare and emit caller IDs, or null if unusable. */
function normalizeCallerId(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits;
  if (digits.length === 10) return `1${digits}`;
  return null;
}

/**
 * The caller ID one carrier should present.
 *
 * Returns null for "leave the call's own caller ID alone" — which is both the
 * PRESERVE answer and the answer when a carrier is configured to use its own
 * numbers but has none. Emitting an empty caller ID instead would be worse than
 * presenting the wrong one: carriers reject anonymous origination outright,
 * so a configuration mistake would silently stop calls rather than degrade
 * their attestation.
 */
function selectCallerId(
  step: StepRow,
  rotation: number,
  currentCallerId?: string | null
): { callerId: string | null; unavailable: boolean } {
  const strategy = step.callerIdStrategy ?? 'PRESERVE';
  if (strategy === 'PRESERVE') return { callerId: null, unavailable: false };

  const pool = (step.callerIdPool ?? []).map(normalizeCallerId).filter((n): n is string => !!n);

  // If the call already presents a number THIS carrier issued, keep it.
  //
  // The swap exists to stop a carrier being handed a number it cannot attest
  // to. When the number is already its own there is nothing to fix, and
  // overriding would do real damage: an agent's manual softphone call
  // deliberately presents that agent's assigned DID, and a caller-ID pool
  // rotation would replace it with an unrelated number on every call.
  const current = normalizeCallerId(currentCallerId);
  if (current && pool.includes(current)) return { callerId: null, unavailable: false };

  if (strategy === 'FIXED') {
    const fixed = normalizeCallerId(step.callerIdNumber);
    if (fixed && current === fixed) return { callerId: null, unavailable: false };
    return { callerId: fixed, unavailable: fixed === null };
  }

  if (pool.length === 0) return { callerId: null, unavailable: true };
  // Rotation is caller-supplied so one call presents a stable number across
  // every leg of its own chain, while consecutive calls spread across the pool.
  // Sorting first keeps the sequence independent of row order.
  const sorted = [...pool].sort();
  const index = ((rotation % sorted.length) + sorted.length) % sorted.length;
  return { callerId: sorted[index], unavailable: false };
}

/**
 * Flatten a configured route into the ordered gateway list to dial.
 *
 * Ordering is: enabled steps by `position`, then each step's enabled gateways
 * by `priority`. A gateway whose circuit is open is moved to the back of the
 * chain rather than dropped — dropping is how a routing layer turns a degraded
 * carrier into no service at all, and a demoted gateway that happens to work is
 * strictly better than a hangup. Ties break on name so the output is stable
 * across calls and the dialplan's cached string does not churn.
 */
export function resolveChain(
  route: RouteRow | null | undefined,
  callType: CallRouteType,
  now: Date = new Date(),
  options: { callerIdRotation?: number; currentCallerId?: string | null } = {}
): ResolvedChain {
  if (!route) return fallbackChain(callType, 'no route configured for tenant');
  if (!route.enabled) return fallbackChain(callType, 'route disabled');

  const nowMs = now.getTime();
  const healthy: ResolvedGateway[] = [];
  const demoted: ResolvedGateway[] = [];
  const carrierOrder: string[] = [];

  const steps = [...route.steps]
    .filter(s => s.enabled && s.carrierStatus !== 'INACTIVE')
    .sort((a, b) => a.position - b.position || a.carrierCode.localeCompare(b.carrierCode));

  for (const step of steps) {
    const gateways = [...step.gateways]
      .filter(g => g.enabled)
      .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));

    if (gateways.length === 0) continue;
    if (!carrierOrder.includes(step.carrierCode)) carrierOrder.push(step.carrierCode);

    const { callerId, unavailable } = selectCallerId(
      step,
      options.callerIdRotation ?? 0,
      options.currentCallerId
    );

    for (const g of gateways) {
      const openUntil = toTime(g.circuitOpenUntil);
      const isOpen = openUntil !== null && openUntil > nowMs;
      const entry: ResolvedGateway = {
        gateway: g.name,
        carrierCode: step.carrierCode,
        carrierName: step.carrierName,
        numberFormat: g.numberFormat,
        demoted: isOpen,
        callerId,
        ...(unavailable ? { callerIdUnavailable: true } : {}),
      };
      (isOpen ? demoted : healthy).push(entry);
    }
  }

  const gatewaysOut = [...healthy, ...demoted];
  if (gatewaysOut.length === 0) {
    return fallbackChain(callType, 'route has no enabled carrier with an enabled gateway');
  }

  return {
    callType,
    gateways: gatewaysOut,
    legTimeoutSeconds: route.legTimeoutSeconds ?? DEFAULT_LEG_TIMEOUT_SECONDS,
    source: 'db',
    carrierOrder,
  };
}

/**
 * Rotate the starting point within the first carrier's gateways.
 *
 * The predictive dialer used to pick exactly one gateway per call, advancing a
 * counter — load balanced across FracTEL's six IPs, but with no failover
 * whatsoever: a call assigned to a dead IP simply failed. Dialing the whole
 * chain instead fixes that, but would send every call to `fractel1` first and
 * concentrate the load the rotation existed to spread.
 *
 * Rotating only the leading same-carrier run keeps both properties: the load
 * still spreads across that carrier's IPs, and the carrier waterfall below is
 * untouched — a fallback carrier never gets promoted ahead of the primary by
 * an accident of counter arithmetic.
 */
export function rotatePrimaryGateways(chain: ResolvedChain, rotation: number): ResolvedChain {
  if (chain.gateways.length < 2) return chain;

  const primaryCarrier = chain.gateways[0].carrierCode;
  let runLength = 0;
  while (
    runLength < chain.gateways.length &&
    chain.gateways[runLength].carrierCode === primaryCarrier
  ) {
    runLength++;
  }
  if (runLength < 2) return chain;

  const offset = ((rotation % runLength) + runLength) % runLength;
  if (offset === 0) return chain;

  const run = chain.gateways.slice(0, runLength);
  return {
    ...chain,
    gateways: [...run.slice(offset), ...run.slice(0, offset), ...chain.gateways.slice(runLength)],
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Dial strings
// ────────────────────────────────────────────────────────────────────────────

/** Reduce anything phone-shaped to bare NANP digits, or null if it is not. */
export function normalizeNanp(raw: string): string | null {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (digits.length === 10) return digits;
  return null;
}

export function formatForGateway(tenDigits: string, format: CarrierNumberFormat): string {
  switch (format) {
    case 'E164':
      return `+1${tenDigits}`;
    case 'NANP10':
      return tenDigits;
    case 'NANP11':
    default:
      return `1${tenDigits}`;
  }
}

export interface BridgeOptions {
  /** Channel variables applied to every leg, e.g. caller ID. */
  channelVariables?: Record<string, string | number | undefined | null>;
  legTimeoutSeconds?: number;
}

/**
 * FreeSWITCH bridge values are `key=value` inside `{}`, comma separated. A
 * comma or a brace in a value would silently split it into a second variable,
 * so those characters are stripped rather than escaped — there is no escape
 * syntax that mod_dptools honors here.
 */
function encodeChannelVariables(vars: Record<string, string | number | undefined | null>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined || value === null || value === '') continue;
    const clean = String(value).replace(/[{}[\],|]/g, '');
    if (clean === '') continue;
    parts.push(`${key}=${clean}`);
  }
  return parts.join(',');
}

/**
 * Build the `|`-separated bridge string FreeSWITCH dials in order.
 *
 * `|` is sequential failover: leg two is attempted only after leg one fails,
 * which is exactly the waterfall semantics. (`,` would ring them in parallel
 * and bill every carrier for the same call.)
 */
export function buildBridgeString(
  chain: ResolvedChain,
  destination: string,
  options: BridgeOptions = {}
): string | null {
  const tenDigits = normalizeNanp(destination);
  if (!tenDigits) return null;
  if (chain.gateways.length === 0) return null;

  const vars = encodeChannelVariables({
    ...options.channelVariables,
    call_timeout: options.legTimeoutSeconds ?? chain.legTimeoutSeconds,
  });
  const prefix = vars ? `{${vars}}` : '';

  const legs = chain.gateways.map(g => {
    // `{}` applies to every leg; `[]` applies to one. A carrier can only attest
    // to a number it issued, so when the call falls to the next carrier its
    // caller ID has to change with it — that is what the per-leg block is for.
    // Legs with no override inherit the `{}` caller ID unchanged.
    const legVars = g.callerId
      ? encodeChannelVariables({
          origination_caller_id_number: g.callerId,
          effective_caller_id_number: g.callerId,
          sip_from_user: g.callerId,
          hopwhistle_carrier: g.carrierCode,
        })
      : '';
    const legPrefix = legVars ? `[${legVars}]` : '';
    return `${legPrefix}sofia/gateway/${g.gateway}/${formatForGateway(tenDigits, g.numberFormat)}`;
  });

  return `${prefix}${legs.join('|')}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Health
// ────────────────────────────────────────────────────────────────────────────

/**
 * Hangup causes that say something about the carrier rather than the callee.
 *
 * A busy line or a declined call is information about the person being dialed
 * and must never count against a carrier — treating them as carrier faults
 * would open every circuit during a normal calling day.
 */
const CARRIER_FAULT_CAUSES = new Set([
  'NO_ROUTE_DESTINATION',
  'NETWORK_OUT_OF_ORDER',
  'NORMAL_TEMPORARY_FAILURE',
  'SERVICE_UNAVAILABLE',
  'GATEWAY_DOWN',
  'RECOVERY_ON_TIMER_EXPIRE',
  'DESTINATION_OUT_OF_ORDER',
  'INCOMPATIBLE_DESTINATION',
  'MANDATORY_IE_MISSING',
  'CALL_REJECTED',
  'REQUESTED_CHAN_UNAVAIL',
  'CHAN_NOT_IMPLEMENTED',
  'INVALID_GATEWAY',
  'PROGRESS_TIMEOUT',
]);

export function isCarrierFault(cause: string | null | undefined): boolean {
  if (!cause) return false;
  return CARRIER_FAULT_CAUSES.has(cause.trim().toUpperCase());
}

export interface HealthUpdate {
  consecutiveFailures: number;
  circuitOpenUntil: Date | null;
  lastFailureAt?: Date;
  lastFailureCause?: string;
  lastSuccessAt?: Date;
}

/**
 * Fold one call outcome into a gateway's health counters.
 *
 * Success always fully resets — a carrier that just completed a call is not
 * "four failures from being demoted", and without the reset a gateway would
 * accumulate unrelated failures over days and trip during normal operation.
 */
export function applyOutcome(
  current: { consecutiveFailures: number },
  outcome: { ok: boolean; cause?: string | null },
  now: Date = new Date()
): HealthUpdate {
  if (outcome.ok) {
    return { consecutiveFailures: 0, circuitOpenUntil: null, lastSuccessAt: now };
  }

  if (!isCarrierFault(outcome.cause)) {
    // The callee's problem, not the carrier's. Leave the counters alone.
    return { consecutiveFailures: current.consecutiveFailures, circuitOpenUntil: null };
  }

  const consecutiveFailures = current.consecutiveFailures + 1;
  const tripped = consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD;

  return {
    consecutiveFailures,
    circuitOpenUntil: tripped ? new Date(now.getTime() + CIRCUIT_OPEN_SECONDS * 1000) : null,
    lastFailureAt: now,
    lastFailureCause: outcome.cause ?? 'UNKNOWN',
  };
}
