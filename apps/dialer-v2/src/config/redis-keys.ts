/**
 * Dialer V2 — tenant-scoped Redis key construction.
 *
 * `MULTITENANT_GAP_ANALYSIS.md` §6 records that existing Redis keys are not
 * tenant-scoped. Every Dialer V2 key is built here and nowhere else, so tenant
 * scoping is structural rather than a rule people have to remember.
 *
 * Layout:  tenant:{tenantId}:dialer:v2:{dimension}:{id}:{field}
 * Global:  dialer:v2:global:{name}   — enumerated, never parameterised
 *
 * The tenant segment is always second and always present.
 */

const TENANT_PREFIX = 'tenant';
const NAMESPACE = 'dialer:v2';
const GLOBAL_PREFIX = `${NAMESPACE}:global`;

/**
 * Redis key segments are colon-delimited, so a segment containing a colon would
 * let a caller forge a key in another tenant's namespace. Braces are rejected
 * too: they are Redis Cluster hash-tag delimiters and would silently change slot
 * routing. Newlines are rejected because they terminate commands in the inline
 * RESP protocol.
 */
const FORBIDDEN = /[:{}\s*?[\]\\]/;

/**
 * Tenant ids that would collide with structural parts of the keyspace or with
 * the platform namespace. A tenant literally named `global` must not be able to
 * address platform-wide counters; `admin` and `platform` are reserved for the
 * same reason before anything starts using them.
 */
const RESERVED_TENANT_IDS = new Set(['global', 'platform', 'admin', 'system', 'dialer', 'tenant']);

export class InvalidKeySegmentError extends Error {
  constructor(segment: string, reason: string) {
    super(`Invalid Redis key segment ${JSON.stringify(segment)}: ${reason}`);
    this.name = 'InvalidKeySegmentError';
  }
}

function assertSegment(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new InvalidKeySegmentError(String(value), `${label} must be a non-empty string`);
  }
  if (FORBIDDEN.test(value)) {
    throw new InvalidKeySegmentError(
      value,
      `${label} must not contain ':', '{', '}', whitespace, or glob characters`
    );
  }
  if (value.length > 128) {
    throw new InvalidKeySegmentError(value, `${label} exceeds 128 characters`);
  }
  return value;
}

function assertTenantId(tenantId: string): string {
  assertSegment(tenantId, 'tenantId');
  if (RESERVED_TENANT_IDS.has(tenantId.toLowerCase())) {
    throw new InvalidKeySegmentError(tenantId, 'tenantId is reserved');
  }
  return tenantId;
}

/** Returns true when a tenant id is safe to use in a key. Never throws. */
export function isValidTenantId(tenantId: unknown): tenantId is string {
  if (typeof tenantId !== 'string') return false;
  try {
    assertTenantId(tenantId);
    return true;
  } catch {
    return false;
  }
}

/** Base namespace for a tenant. All tenant-scoped keys descend from this. */
export function tenantNamespace(tenantId: string): string {
  return `${TENANT_PREFIX}:${assertTenantId(tenantId)}:${NAMESPACE}`;
}

export function agentStateKey(tenantId: string, agentId: string): string {
  return `${tenantNamespace(tenantId)}:agent:${assertSegment(agentId, 'agentId')}:state`;
}

export function agentIndexKey(tenantId: string): string {
  return `${tenantNamespace(tenantId)}:agents`;
}

export function campaignRuntimeKey(tenantId: string, campaignId: string): string {
  return `${tenantNamespace(tenantId)}:campaign:${assertSegment(campaignId, 'campaignId')}:runtime`;
}

export function campaignOwnerKey(tenantId: string, campaignId: string): string {
  return `${tenantNamespace(tenantId)}:campaign:${assertSegment(campaignId, 'campaignId')}:owner`;
}

export function callStateKey(tenantId: string, callId: string): string {
  return `${tenantNamespace(tenantId)}:call:${assertSegment(callId, 'callId')}:state`;
}

export function eventDedupeKey(tenantId: string, eventId: string): string {
  return `${tenantNamespace(tenantId)}:events:dedupe:${assertSegment(eventId, 'eventId')}`;
}

export function callerIdUsageKey(tenantId: string, e164: string, window: string): string {
  return `${tenantNamespace(tenantId)}:callerid:${assertSegment(e164, 'e164')}:${assertSegment(window, 'window')}`;
}

export function leadLeaseKey(tenantId: string, leadId: string): string {
  return `${tenantNamespace(tenantId)}:lease:${assertSegment(leadId, 'leadId')}`;
}

export function attemptKey(tenantId: string, attemptId: string): string {
  return `${tenantNamespace(tenantId)}:attempt:${assertSegment(attemptId, 'attemptId')}`;
}

export function tenantCounterKey(tenantId: string, counter: string): string {
  return `${tenantNamespace(tenantId)}:counter:${assertSegment(counter, 'counter')}`;
}

export function tenantHealthKey(tenantId: string): string {
  return `${tenantNamespace(tenantId)}:health`;
}

export function shadowDecisionKey(tenantId: string, campaignId: string): string {
  return `${tenantNamespace(tenantId)}:campaign:${assertSegment(campaignId, 'campaignId')}:shadow`;
}

/**
 * The complete set of platform-wide keys. Enumerated rather than parameterised
 * so that "global" stays a short, reviewable list and cannot become a hiding
 * place for un-scoped tenant data.
 */
const GLOBAL_KEYS = {
  activeCalls: 'active_calls',
  cpsWindow: 'cps_window',
  rawEventStream: 'events:raw',
  quarantineStream: 'events:quarantine',
  emergencyStop: 'emergency_stop',
  health: 'health',
} as const;

export type GlobalKeyName = keyof typeof GLOBAL_KEYS;

export function globalKey(name: GlobalKeyName): string {
  return `${GLOBAL_PREFIX}:${GLOBAL_KEYS[name]}`;
}

/** True if `key` belongs to `tenantId`. Always false for a reserved id. */
export function keyBelongsToTenant(key: string, tenantId: string): boolean {
  if (!isValidTenantId(tenantId)) return false;
  const base = `${TENANT_PREFIX}:${tenantId}:${NAMESPACE}`;
  return key === base || key.startsWith(`${base}:`);
}

/** Extract the tenant from a V2 key, or null for global/foreign/malformed keys. */
export function tenantOfKey(key: string): string | null {
  if (typeof key !== 'string') return null;
  const parts = key.split(':');
  if (parts.length < 4) return null;
  if (parts[0] !== TENANT_PREFIX) return null;
  if (parts[2] !== 'dialer' || parts[3] !== 'v2') return null;
  const tenantId = parts[1];
  return isValidTenantId(tenantId) ? tenantId : null;
}
