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

/**
 * Which agent owns a live channel.
 *
 * Tenant-scoped because channel ownership was previously answered by agent id
 * alone. Agent ids are only unique within a tenant, so two tenants that both
 * number their agents from 1 would see each other's channels: an active call in
 * tenant A would mark tenant B's agent 1 as ON_CALL and remove them from B's
 * dialable capacity, or — worse in the other direction — make B's agent look
 * busy so A keeps dialling for them.
 */
export function channelOwnerKey(tenantId: string, channelUuid: string): string {
  return `${tenantNamespace(tenantId)}:channel:${assertSegment(channelUuid, 'channelUuid')}:owner`;
}

/** The set of channels currently attributed to a tenant. */
export function channelIndexKey(tenantId: string): string {
  return `${tenantNamespace(tenantId)}:channels`;
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

/**
 * A session record, keyed by the HASH of the bearer token.
 *
 * The plaintext token never becomes part of a key. Redis keys turn up in
 * `SCAN` output, `MONITOR`, slow logs, and RDB dumps; a bearer credential that
 * appears in any of those is a credential that has leaked. The caller hashes
 * first, and this only ever sees the digest.
 */
export function agentSessionKey(tenantId: string, sessionTokenHash: string): string {
  return `${tenantNamespace(tenantId)}:session:${assertSegment(sessionTokenHash, 'sessionTokenHash')}`;
}

/** The set of live session hashes for one agent, so duplicates are detectable. */
export function agentSessionIndexKey(tenantId: string, agentId: string): string {
  return `${tenantNamespace(tenantId)}:agent:${assertSegment(agentId, 'agentId')}:sessions`;
}

/** A SIP registration observed on the wire, keyed by the resolved agent. */
export function sipRegistrationKey(tenantId: string, agentId: string): string {
  return `${tenantNamespace(tenantId)}:agent:${assertSegment(agentId, 'agentId')}:sip`;
}

/**
 * The set of agents with a known SIP registration.
 *
 * Deliberately separate from the agent-state index. A `sofia::register` can
 * arrive before the agent's browser has ever heartbeated — the softphone
 * registers as soon as the tab loads, and often before the agent signs in — so
 * the agent-state index may not exist yet. Reusing it would mean the first
 * registration for an agent is written and then never found again on restart,
 * because reconstruction iterates the index rather than scanning keys.
 */
export function sipIndexKey(tenantId: string): string {
  return `${tenantNamespace(tenantId)}:sip:agents`;
}

/**
 * One fixed observation bucket for a campaign.
 *
 * The window is a set of fixed buckets rather than one key with a sliding TTL.
 * A sliding TTL never expires under continuous traffic — every event pushes the
 * expiry out — so a "one hour rolling window" implemented that way is really a
 * counter that accumulates from the first event to the last, and a campaign's
 * 9am answer rate goes on influencing its 9pm forecast forever.
 *
 * A bucket, in contrast, is written only while its own interval is current.
 * Once time moves past it nothing extends it, and it expires on schedule whether
 * or not the campaign is still busy.
 */
export function observationBucketKey(
  tenantId: string,
  campaignId: string,
  bucketIndex: number
): string {
  const base = `${tenantNamespace(tenantId)}:campaign:${assertSegment(campaignId, 'campaignId')}:observation`;
  return `${base}:${Math.trunc(bucketIndex)}`;
}

export function shadowDecisionKey(tenantId: string, campaignId: string): string {
  return `${tenantNamespace(tenantId)}:campaign:${assertSegment(campaignId, 'campaignId')}:shadow`;
}

/**
 * A tenant-scoped index of every campaign that has recorded a decision.
 *
 * Exists so "recent decisions for this tenant" is answerable. Without it the
 * only way to serve an unfiltered request is a `KEYS`/`SCAN` over the keyspace,
 * and the store previously answered by returning an empty list — which reads
 * identically to "this tenant has never recorded a decision".
 */
export function shadowDecisionIndexKey(tenantId: string): string {
  return `${tenantNamespace(tenantId)}:shadow:campaigns`;
}

/**
 * The campaign shadow lock.
 *
 * ── Why this is not a parameterised global lock name ─────────────────────────
 *
 * The runtime used to build the string `campaign:${tenantId}:${campaignId}:shadow`
 * and hand it to a generic lock provider, which placed it under the GLOBAL
 * namespace. Two things were wrong with that. The tenant and campaign ids never
 * passed segment validation, so a campaign id containing a colon could address
 * another campaign's lock — and a tenant's coordination state lived outside that
 * tenant's namespace, where no tenant-scoped sweep, audit, or eviction policy
 * would ever find it.
 *
 * Building it here means both ids are validated exactly like every other key
 * segment, and the lock lives inside the tenant it belongs to.
 */
export function campaignShadowLockKey(tenantId: string, campaignId: string): string {
  return `${shadowDecisionKey(tenantId, campaignId)}:lock`;
}

/** The monotonic fencing counter for that lock. */
export function campaignShadowFenceKey(tenantId: string, campaignId: string): string {
  return `${shadowDecisionKey(tenantId, campaignId)}:fence`;
}

/**
 * Identity of one decision slot: at most one decision per campaign, per
 * controller version, per interval bucket.
 *
 * The controller version is part of the identity so a deliberate controller
 * upgrade inside one interval is not mistaken for a duplicate write.
 */
export function campaignDecisionBucketKey(
  tenantId: string,
  campaignId: string,
  controllerVersion: string,
  decidedAtMs: number,
  intervalMs: number
): string {
  const bucket = Math.floor(decidedAtMs / Math.max(1, intervalMs));
  return `${shadowDecisionKey(tenantId, campaignId)}:bucket:${assertSegment(controllerVersion, 'controllerVersion')}:${bucket}`;
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

/**
 * Platform-wide locks, enumerated for the same reason as the keys above.
 *
 * A lock whose name is a caller-supplied string is a lock whose namespace a
 * caller can escape. Anything that needs to be locked per tenant or per campaign
 * uses a tenant-scoped builder instead — there is deliberately no way to put a
 * tenant id into this list.
 */
const GLOBAL_LOCKS = {
  reconcile: 'reconcile',
} as const;

export type GlobalLockName = keyof typeof GLOBAL_LOCKS;

export function globalLockKey(name: GlobalLockName): string {
  return `${GLOBAL_PREFIX}:lock:${GLOBAL_LOCKS[name]}`;
}

export function globalLockFenceKey(name: GlobalLockName): string {
  return `${globalLockKey(name)}:fence`;
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
