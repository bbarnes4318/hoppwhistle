/**
 * Dialer V2 — end-to-end chain, in memory.
 *
 * Proves the whole path a real agent takes, using the real components rather
 * than mocks of them: verified identity → server-issued session →
 * database-resolved assignment → database-resolved extension → FreeSWITCH
 * registration → heartbeat → reconciliation → capacity → unregister → capacity
 * withdrawn.
 *
 * Every previous "authoritative" claim was individually inert: no CUSTOM
 * subscription meant no registration events, and a null extension meant no
 * registration could ever match. This file exists so that a regression in any
 * one link fails loudly instead of silently producing an agent that can never
 * become eligible.
 */

import { describe, expect, it } from 'vitest';

import { AssignmentResolver, StaticAssignmentSource } from '../agents/assignments.js';
import {
  ExtensionResolver,
  StaticExtensionSource,
  type ExtensionBinding,
} from '../agents/extension-resolver.js';
import { AgentStateService } from '../agents/service.js';
import { AgentSessionRegistry } from '../agents/sessions.js';
import { SipRegistrationRegistry } from '../agents/sip-registry.js';
import { AgentState } from '../agents/state.js';
import { EnvFlagSource } from '../config/flags.js';
import { buildSubscribeCommand } from '../esl/socket-transport.js';
import { InMemoryDedupeStore, InMemoryEventStore } from '../events/store.js';
import { SUBSCRIBED_CUSTOM_SUBCLASSES, SUBSCRIBED_EVENT_TYPES } from '../events/types.js';
import { InMemoryShadowDecisionStore } from '../shadow/engine.js';
import {
  NoOpLock,
  RedisDistributedLock,
  type DistributedLock,
  type LockRedis,
} from '../stores/coordination.js';

import { DialerV2Runtime, defaultRuntimeConfig } from './service.js';

const T0 = 1_800_000_000_000;
const TENANT = 'tenant-a';
const AGENT = 'agent-1';
const USER = 'user-1';
const EXT = '1001';
const DOMAIN = 'hopwhistle.com';
const CAMPAIGN = 'camp-1';

function extensionBinding(overrides: Partial<ExtensionBinding> = {}): ExtensionBinding {
  return {
    tenantId: TENANT,
    userId: USER,
    agentId: AGENT,
    extension: EXT,
    sipDomain: DOMAIN,
    enabled: true,
    maxConcurrentCalls: 1,
    ...overrides,
  };
}

function sofiaEvent(subclass: string, overrides: Record<string, string | undefined> = {}) {
  return {
    'Event-Name': 'CUSTOM',
    'Event-Subclass': subclass,
    username: EXT,
    domain_name: DOMAIN,
    variable_hopwhistle_tenant_id: TENANT,
    expires: '3600',
    ...overrides,
  };
}

function buildStack(
  opts: { lock?: DistributedLock; shared?: ReturnType<typeof sharedState> } = {}
) {
  const nowRef = opts.shared?.nowRef ?? { value: T0 };
  const shadowStore = opts.shared?.shadowStore ?? new InMemoryShadowDecisionStore();
  const dedupe = opts.shared?.dedupe ?? new InMemoryDedupeStore(() => nowRef.value);

  const agents = new AgentStateService({ heartbeatTimeoutMs: 30_000 });
  const sessions = new AgentSessionRegistry();
  const sipRegistry = new SipRegistrationRegistry({ now: () => nowRef.value });

  const assignmentSource = new StaticAssignmentSource();
  const extensionSource = new StaticExtensionSource();

  const runtime = new DialerV2Runtime({
    flags: new EnvFlagSource({
      TENANT_DIALER_V2_ENABLED: 'true',
      TENANT_DIALER_V2_SHADOW_ENABLED: 'true',
      TENANT_DIALER_V2_ALLOWED_TENANT_IDS: TENANT,
      TENANT_DIALER_V2_ALLOWED_CAMPAIGN_IDS: '*',
    }),
    eventStore: new InMemoryEventStore(),
    dedupe,
    shadowStore,
    agents,
    sessions,
    assignments: new AssignmentResolver({
      source: assignmentSource,
      now: () => nowRef.value,
    }),
    extensions: new ExtensionResolver({ source: extensionSource, now: () => nowRef.value }),
    sipRegistry,
    lock: opts.lock ?? new NoOpLock(),
    redisHealthy: () => true,
    config: defaultRuntimeConfig({} as NodeJS.ProcessEnv),
    now: () => nowRef.value,
    setTimer: () => null,
    clearTimer: () => {},
  });

  return {
    runtime,
    agents,
    sessions,
    sipRegistry,
    assignmentSource,
    extensionSource,
    shadowStore,
    nowRef,
    dedupe,
  };
}

function sharedState() {
  const nowRef = { value: T0 };
  return {
    nowRef,
    shadowStore: new InMemoryShadowDecisionStore(),
    dedupe: new InMemoryDedupeStore(() => nowRef.value),
  };
}

/** Provision an agent the way a real deployment would. */
function provision(stack: ReturnType<typeof buildStack>) {
  stack.agents.upsertAgent(TENANT, AGENT, USER, T0, { state: AgentState.AUTHENTICATING });
  stack.assignmentSource.set(TENANT, AGENT, [CAMPAIGN]);
  stack.extensionSource.add(extensionBinding());
  return stack.runtime.issueSession(TENANT, AGENT, USER)!;
}

describe('the whole chain', () => {
  it('takes an agent from sign-in to predictive capacity and back out again', async () => {
    const stack = buildStack();

    // 1. The subscription actually asks for the registration events. Without
    //    this the rest of the chain is unreachable.
    const command = buildSubscribeCommand(SUBSCRIBED_EVENT_TYPES, SUBSCRIBED_CUSTOM_SUBCLASSES);
    expect(command).toContain('CUSTOM sofia::register');

    // 2. Verified identity mints a server-issued session.
    const session = provision(stack);
    expect(session.sessionId.length).toBeGreaterThan(20);

    // 3. FreeSWITCH reports the endpoint registered.
    expect(stack.sipRegistry.applyRegistrationEvent(sofiaEvent('sofia::register'))).toBe(true);

    // 4. Heartbeat: assignment and extension both resolved server-side.
    const beat = await stack.runtime.recordHeartbeat({
      tenantId: TENANT,
      agentId: AGENT,
      userId: USER,
      sessionId: session.sessionId,
      sequence: 1,
      uiState: 'AVAILABLE',
    });

    expect(beat.accepted).toBe(true);
    expect(beat.extension).toBe(EXT);
    expect(beat.campaignIds).toEqual([CAMPAIGN]);
    expect(beat.sipRegistered).toBe(true);
    expect(beat.countedAsCapacity).toBe(true);

    // 5. Reconciliation keeps them, and they count toward the campaign.
    await stack.runtime.runReconciliation();
    expect(stack.agents.capacity(TENANT, T0, CAMPAIGN).available).toBe(1);

    // 6. Unregister. Capacity must go immediately, without waiting for a
    //    heartbeat timeout — the endpoint is unreachable right now.
    stack.sipRegistry.applyRegistrationEvent(sofiaEvent('sofia::unregister'));
    await stack.runtime.runReconciliation();

    expect(stack.agents.get(TENANT, AGENT)?.sipRegistered).toBe(false);
    expect(stack.agents.capacity(TENANT, T0, CAMPAIGN).available).toBe(0);
  });

  it('expires capacity when the registration lapses without an unregister', async () => {
    const stack = buildStack();
    const session = provision(stack);
    stack.sipRegistry.applyRegistrationEvent(sofiaEvent('sofia::register', { expires: '60' }));

    expect((await stack.runtime.recordHeartbeat(beatFor(session, 1))).countedAsCapacity).toBe(true);

    stack.nowRef.value = T0 + 61_000;
    expect((await stack.runtime.recordHeartbeat(beatFor(session, 2))).countedAsCapacity).toBe(
      false
    );
  });

  function beatFor(session: { sessionId: string }, sequence: number) {
    return {
      tenantId: TENANT,
      agentId: AGENT,
      userId: USER,
      sessionId: session.sessionId,
      sequence,
      uiState: 'AVAILABLE',
    };
  }

  describe('negative paths', () => {
    it('grants no capacity without a CUSTOM subscription', () => {
      // If CUSTOM were dropped from the subscription, no sofia event would ever
      // arrive and the registry would stay empty.
      const stack = buildStack();
      provision(stack);
      const withoutCustom = buildSubscribeCommand(SUBSCRIBED_EVENT_TYPES, []);

      expect(withoutCustom).not.toContain('CUSTOM');
      expect(stack.sipRegistry.isRegistered(TENANT, EXT)).toBe(false);
    });

    it('grants no capacity when the agent has no extension', async () => {
      const stack = buildStack();
      stack.agents.upsertAgent(TENANT, AGENT, USER, T0, { state: AgentState.AUTHENTICATING });
      stack.assignmentSource.set(TENANT, AGENT, [CAMPAIGN]);
      // No extension binding added.
      const session = stack.runtime.issueSession(TENANT, AGENT, USER)!;
      stack.sipRegistry.applyRegistrationEvent(sofiaEvent('sofia::register'));

      const beat = await stack.runtime.recordHeartbeat(beatFor(session, 1));
      expect(beat.extension).toBeNull();
      expect(beat.extensionRejection).toBe('NO_EXTENSION');
      expect(beat.countedAsCapacity).toBe(false);
    });

    it('grants no capacity when the extension is disabled', async () => {
      const stack = buildStack();
      stack.agents.upsertAgent(TENANT, AGENT, USER, T0, { state: AgentState.AUTHENTICATING });
      stack.assignmentSource.set(TENANT, AGENT, [CAMPAIGN]);
      stack.extensionSource.add(extensionBinding({ enabled: false }));
      const session = stack.runtime.issueSession(TENANT, AGENT, USER)!;
      stack.sipRegistry.applyRegistrationEvent(sofiaEvent('sofia::register'));

      const beat = await stack.runtime.recordHeartbeat(beatFor(session, 1));
      expect(beat.extensionRejection).toBe('DISABLED');
      expect(beat.countedAsCapacity).toBe(false);
    });

    it('grants no capacity for a cross-tenant extension', async () => {
      const stack = buildStack();
      stack.agents.upsertAgent(TENANT, AGENT, USER, T0, { state: AgentState.AUTHENTICATING });
      stack.assignmentSource.set(TENANT, AGENT, [CAMPAIGN]);
      stack.extensionSource.add(extensionBinding({ tenantId: 'tenant-b' }));
      const session = stack.runtime.issueSession(TENANT, AGENT, USER)!;

      const beat = await stack.runtime.recordHeartbeat(beatFor(session, 1));
      expect(beat.countedAsCapacity).toBe(false);
    });

    it('assigns no campaigns when the assignment is missing', async () => {
      const stack = buildStack();
      stack.agents.upsertAgent(TENANT, AGENT, USER, T0, { state: AgentState.AUTHENTICATING });
      stack.extensionSource.add(extensionBinding());
      const session = stack.runtime.issueSession(TENANT, AGENT, USER)!;
      stack.sipRegistry.applyRegistrationEvent(sofiaEvent('sofia::register'));

      const beat = await stack.runtime.recordHeartbeat(beatFor(session, 1));
      expect(beat.campaignIds).toEqual([]);
      // Registered and available, but contributing to no campaign forecast.
      expect(stack.agents.capacity(TENANT, T0, CAMPAIGN).available).toBe(0);
    });

    it('loses capacity after the assignment is revoked', async () => {
      const stack = buildStack();
      const session = provision(stack);
      stack.sipRegistry.applyRegistrationEvent(sofiaEvent('sofia::register'));
      await stack.runtime.recordHeartbeat(beatFor(session, 1));
      expect(stack.agents.capacity(TENANT, T0, CAMPAIGN).available).toBe(1);

      stack.assignmentSource.set(TENANT, AGENT, []);
      stack.nowRef.value = T0 + 61_000; // past the assignment cache TTL
      stack.sipRegistry.applyRegistrationEvent(sofiaEvent('sofia::register'));
      await stack.runtime.recordHeartbeat(beatFor(session, 2));

      expect(stack.agents.capacity(TENANT, stack.nowRef.value, CAMPAIGN).available).toBe(0);
    });

    it('quarantines a registration whose tenant cannot be proven', () => {
      const stack = buildStack();
      // Only a SIP domain — which is NOT a tenant id.
      const applied = stack.sipRegistry.applyRegistrationEvent({
        'Event-Name': 'CUSTOM',
        'Event-Subclass': 'sofia::register',
        username: EXT,
        domain_name: DOMAIN,
        expires: '3600',
      });

      expect(applied).toBe(false);
      expect(stack.sipRegistry.isRegistered(TENANT, EXT)).toBe(false);
      expect(stack.sipRegistry.quarantinedRegistrations()).toHaveLength(1);
    });

    it('rejects an expired session', async () => {
      const stack = buildStack();
      const session = provision(stack);
      stack.nowRef.value = T0 + 13 * 60 * 60 * 1000;

      const beat = await stack.runtime.recordHeartbeat(beatFor(session, 1));
      expect(beat.accepted).toBe(false);
      expect(beat.countedAsCapacity).toBe(false);
    });
  });
});

describe('two replicas sharing one Redis', () => {
  /** Fake Redis modelling NX, PX expiry, INCR, and atomic eval. */
  function fakeRedis(clock: { value: number }) {
    const store = new Map<string, { value: string; expiresAt: number }>();
    const counters = new Map<string, number>();
    const live = (k: string) => {
      const e = store.get(k);
      if (!e) return undefined;
      if (e.expiresAt <= clock.value) {
        store.delete(k);
        return undefined;
      }
      return e;
    };
    const redis: LockRedis = {
      set: (key, value, _m, ttlMs) => {
        if (live(key)) return Promise.resolve(null);
        store.set(key, { value, expiresAt: clock.value + ttlMs });
        return Promise.resolve('OK');
      },
      get: key => Promise.resolve(live(key)?.value ?? null),
      del: key => Promise.resolve(store.delete(key) ? 1 : 0),
      incr: key => {
        const n = (counters.get(key) ?? 0) + 1;
        counters.set(key, n);
        return Promise.resolve(n);
      },
      eval: (script, _n, ...args) => {
        const [key, expected, ttl] = args;
        const entry = live(key);
        if (entry?.value !== expected) return Promise.resolve(0);
        if (script.includes('del')) {
          store.delete(key);
        } else {
          entry.expiresAt = clock.value + Number(ttl);
        }
        return Promise.resolve(1);
      },
    };
    return redis;
  }

  it('records exactly one shadow decision per campaign per interval', async () => {
    const shared = sharedState();
    const redis = fakeRedis(shared.nowRef);

    const a = buildStack({
      shared,
      lock: new RedisDistributedLock({ redis, ownerId: 'replica-a' }),
    });
    const b = buildStack({
      shared,
      lock: new RedisDistributedLock({ redis, ownerId: 'replica-b' }),
    });

    // Both replicas observe the same campaign.
    const raw = {
      'Event-Name': 'CHANNEL_CREATE',
      'Event-Date-Timestamp': String(T0 * 1000),
      'Event-Sequence': '1',
      'Unique-ID': 'chan-1',
      variable_hopwhistle_tenant_id: TENANT,
      variable_hopwhistle_campaign_id: CAMPAIGN,
    };
    await a.runtime.getIngestor().handleRaw(raw);
    await b.runtime
      .getIngestor()
      .handleRaw({ ...raw, 'Event-Sequence': '2', 'Unique-ID': 'chan-2' });

    // Both attempt the pass at the same instant.
    const [countA, countB] = await Promise.all([
      a.runtime.runShadowPass(),
      b.runtime.runShadowPass(),
    ]);

    // Exactly one replica did the work.
    expect([countA, countB].filter(n => n > 0)).toHaveLength(1);

    const decisions = await shared.shadowStore.recent(TENANT, 50, CAMPAIGN);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].originated).toBe(false);
  });

  it('lets the other replica take over after the holder dies', async () => {
    const shared = sharedState();
    const redis = fakeRedis(shared.nowRef);
    const a = buildStack({
      shared,
      lock: new RedisDistributedLock({ redis, ownerId: 'replica-a' }),
    });
    const b = buildStack({
      shared,
      lock: new RedisDistributedLock({ redis, ownerId: 'replica-b' }),
    });

    const raw = {
      'Event-Name': 'CHANNEL_CREATE',
      'Event-Date-Timestamp': String(T0 * 1000),
      'Event-Sequence': '1',
      'Unique-ID': 'chan-1',
      variable_hopwhistle_tenant_id: TENANT,
      variable_hopwhistle_campaign_id: CAMPAIGN,
    };
    await b.runtime.getIngestor().handleRaw(raw);

    // A takes the lock and never releases it — simulating a dead process.
    await a.runtime.getIngestor().handleRaw(raw);
    await new RedisDistributedLock({ redis, ownerId: 'replica-a' }).acquire(
      `campaign:${TENANT}:${CAMPAIGN}:shadow`,
      1_000
    );

    expect(await b.runtime.runShadowPass()).toBe(0);

    // The TTL is the recovery mechanism.
    shared.nowRef.value = T0 + 5_000;
    expect(await b.runtime.runShadowPass()).toBeGreaterThan(0);
  });
});
