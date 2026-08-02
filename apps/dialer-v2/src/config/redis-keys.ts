/**
 * Dialer V2 — tenant-scoped Redis key construction.
 *
 * `MULTITENANT_GAP_ANALYSIS.md` §6 records that existing Redis keys are not
 * tenant-scoped. Every Dialer V2 key is built here and nowhere else, so tenant
 * scoping is structural rather than a rule people have to remember.
 *
 * Layout: `dialer2:{tenantId}:{dimension}:{id}:{field}`
 * The tenant segment is always second and always present.
 *
 * `dialer2:global:*` exists only for genuinely platform-wide values (the global
 * concurrency counter, the raw event stream). Those are enumerated explicitly in
 * `globalKey()` — an arbitrary global key cannot be constructed.
 */

const PREFIX = 'dialer2';

/**
 * Redis key segments are colon-delimited, so a segment containing a colon would
 * let a caller forge a key in another tenant's namespace. Braces are rejected
 * too: they are Redis Cluster hash-tag delimiters and would silently change
 * slot routing.
 */
const FORBIDDEN = /[:{}\s]/;

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
      `${label} must not contain ':', '{', '}', or whitespace`
    );
  }
  if (value.length > 128) {
    throw new InvalidKeySegmentError(value, `${label} exceeds 128 characters`);
  }
  return value;
}

/**
 * Segments that may never be used as a tenant id. A tenant literally named
 * `global` would otherwise be able to construct platform-wide keys and read or
 * clobber another tenant's counters.
 */
const RESERVED_TENANT_SEGMENTS = new Set(['global']);

function assertTenantId(tenantId: string): string {
  assertSegment(tenantId, 'tenantId');
  if (RESERVED_TENANT_SEGMENTS.has(tenantId)) {
    throw new InvalidKeySegmentError(tenantId, 'tenantId is reserved for platform-wide keys');
  }
  return tenantId;
}

/** Base namespace for a tenant. All tenant-scoped keys descend from this. */
export function tenantNamespace(tenantId: string): string {
  return `${PREFIX}:${assertTenantId(tenantId)}`;
}

export function campaignKey(tenantId: string, campaignId: string, field: string): string {
  return `${tenantNamespace(tenantId)}:campaign:${assertSegment(campaignId, 'campaignId')}:${assertSegment(field, 'field')}`;
}

export function agentKey(tenantId: string, agentId: string, field: string): string {
  return `${tenantNamespace(tenantId)}:agent:${assertSegment(agentId, 'agentId')}:${assertSegment(field, 'field')}`;
}

export function callerIdKey(tenantId: string, e164: string, field: string): string {
  return `${tenantNamespace(tenantId)}:callerid:${assertSegment(e164, 'e164')}:${assertSegment(field, 'field')}`;
}

export function leadLeaseKey(tenantId: string, leadId: string): string {
  return `${tenantNamespace(tenantId)}:lease:${assertSegment(leadId, 'leadId')}`;
}

export function attemptKey(tenantId: string, attemptId: string): string {
  return `${tenantNamespace(tenantId)}:attempt:${assertSegment(attemptId, 'attemptId')}`;
}

export function eventDedupeKey(tenantId: string, eventId: string): string {
  return `${tenantNamespace(tenantId)}:evt:${assertSegment(eventId, 'eventId')}`;
}

export function tenantCounterKey(tenantId: string, counter: string): string {
  return `${tenantNamespace(tenantId)}:counter:${assertSegment(counter, 'counter')}`;
}

/** Campaign ownership lease — the key behind single-owner distribution. */
export function campaignOwnerKey(tenantId: string, campaignId: string): string {
  return campaignKey(tenantId, campaignId, 'owner');
}

/**
 * The complete set of platform-wide keys. Enumerated rather than parameterised
 * so that "global" stays a short, reviewable list and cannot become a hiding
 * place for un-scoped tenant data.
 */
const GLOBAL_KEYS = {
  activeCalls: 'active_calls',
  cpsWindow: 'cps_window',
  rawEventStream: 'raw',
  quarantineStream: 'quarantine',
  emergencyStop: 'emergency_stop',
} as const;

export type GlobalKeyName = keyof typeof GLOBAL_KEYS;

export function globalKey(name: GlobalKeyName): string {
  return `${PREFIX}:global:${GLOBAL_KEYS[name]}`;
}

/**
 * True if `key` belongs to `tenantId`. Used by tests and by the runtime guard
 * that asserts a command is not touching another tenant's namespace.
 *
 * Matches the namespace root itself as well as its descendants, and always
 * returns false for a reserved segment so `keyBelongsToTenant(k, 'global')`
 * cannot be used to claim ownership of platform keys.
 */
export function keyBelongsToTenant(key: string, tenantId: string): boolean {
  if (RESERVED_TENANT_SEGMENTS.has(tenantId)) return false;
  const base = `${PREFIX}:${tenantId}`;
  return key === base || key.startsWith(`${base}:`);
}

/** Extract the tenant from a V2 key, or null for global/foreign keys. */
export function tenantOfKey(key: string): string | null {
  const parts = key.split(':');
  // Length 2 is the namespace root (`dialer2:{tenantId}`), which is still owned.
  if (parts.length < 2 || parts[0] !== PREFIX) return null;
  if (RESERVED_TENANT_SEGMENTS.has(parts[1])) return null;
  return parts[1] || null;
}
