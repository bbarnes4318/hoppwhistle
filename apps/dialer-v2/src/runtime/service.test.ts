import { describe, expect, it, vi } from 'vitest';

import { AssignmentResolver, StaticAssignmentSource } from '../agents/assignments.js';
import { AgentStateService } from '../agents/service.js';
import { AgentSessionRegistry, SessionRejection } from '../agents/sessions.js';
import { SipRegistrationRegistry } from '../agents/sip-registry.js';
import { AgentState } from '../agents/state.js';
import { EnvFlagSource } from '../config/flags.js';
import { InMemoryDedupeStore, InMemoryEventStore } from '../events/store.js';
import { PacingReason } from '../pacing/controller.js';
import { InMemoryShadowDecisionStore } from '../shadow/engine.js';
import { NoOpLock, type DistributedLock } from '../stores/coordination.js';

import {
  DialerV2Runtime,
  EslStartRefusal,
  canStartEsl,
  defaultRuntimeConfig,
  readEslConfig,
  type HeartbeatAudit,
} from './service.js';

const T0 = 1_800_000_000_000;
const EXT = '1001';

function rawEvent(overrides: Record<string, string | undefined> = {}) {
  return {
    'Event-Name': 'CHANNEL_CREATE',
    'Event-Date-Timestamp': String(T0 * 1000),
    'Event-Sequence': '1',
    'Unique-ID': 'chan-1',
    'Channel-Name': 'sofia/gateway/fractel1/+18005551212',
    variable_hopwhistle_tenant_id: 'tenant-a',
    variable_hopwhistle_campaign_id: 'camp-1',
    ...overrides,
  };
}

function registerEvent(overrides: Record<string, string | undefined> = {}) {
  return {
    'Event-Name': 'CUSTOM',
    'Event-Subclass': 'sofia::register',
    username: EXT,
    variable_hopwhistle_tenant_id: 'tenant-a',
    expires: '3600',
    ...overrides,
  };
}

function build(
  env: Record<string, string | undefined> = {},
  opts: { lock?: DistributedLock; redisHealthy?: () => boolean } = {}
) {
  const nowRef = { value: T0 };
  const agents = new AgentStateService({ heartbeatTimeoutMs: 30_000 });
  const sessions = new AgentSessionRegistry({ maxBeatsPerWindow: 5, rateWindowMs: 10_000 });
  const sipRegistry = new SipRegistrationRegistry({ now: () => nowRef.value });
  const assignmentSource = new StaticAssignmentSource();
  const assignments = new AssignmentResolver({ source: assignmentSource, now: () => nowRef.value });
  const shadowStore = new InMemoryShadowDecisionStore();
  const audits: HeartbeatAudit[] = [];

  const runtime = new DialerV2Runtime({
    flags: new EnvFlagSource({
      TENANT_DIALER_V2_ENABLED: 'true',
      TENANT_DIALER_V2_SHADOW_ENABLED: 'true',
      TENANT_DIALER_V2_ALLOWED_TENANT_IDS: 'tenant-a',
      TENANT_DIALER_V2_ALLOWED_CAMPAIGN_IDS: '*',
      ...env,
    }),
    eventStore: new InMemoryEventStore(),
    dedupe: new InMemoryDedupeStore(() => nowRef.value),
    shadowStore,
    agents,
    sessions,
    assignments,
    sipRegistry,
    lock: opts.lock ?? new NoOpLock(),
    redisHealthy: opts.redisHealthy ?? (() => true),
    onAudit: a => audits.push(a),
    config: defaultRuntimeConfig({} as NodeJS.ProcessEnv),
    now: () => nowRef.value,
    setTimer: () => null,
    clearTimer: () => {},
  });

  return { runtime, agents, sessions, sipRegistry, assignmentSource, shadowStore, audits, nowRef };
}

/** Register an agent with an extension, a server session, and SIP presence. */
function onboard(ctx: ReturnType<typeof build>, campaigns = ['camp-1']) {
  ctx.agents.upsertAgent('tenant-a', 'agent-1', 'user-1', T0, {
    state: AgentState.AUTHENTICATING,
    extension: EXT,
  });
  ctx.assignmentSource.set('tenant-a', 'agent-1', campaigns);
  ctx.sipRegistry.applyRegistrationEvent(registerEvent());
  const session = ctx.runtime.issueSession('tenant-a', 'agent-1', 'user-1');
  return session!;
}

function beat(
  session: { sessionId: string },
  sequence: number,
  uiState: string | null = 'AVAILABLE'
) {
  return {
    tenantId: 'tenant-a',
    agentId: 'agent-1',
    userId: 'user-1',
    sessionId: session.sessionId,
    sequence,
    uiState,
  };
}

describe('server-issued sessions', () => {
  it('rejects a browser-invented session id', async () => {
    // The browser used to choose this value. Now it must present one the server
    // minted, so a fabricated id carries no authority.
    const ctx = build();
    onboard(ctx);

    const result = await ctx.runtime.recordHeartbeat({
      ...beat({ sessionId: 'i-made-this-up' }, 1),
    });
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe(SessionRejection.UNKNOWN_SESSION);
  });

  it('accepts a server-issued session', async () => {
    const ctx = build();
    const session = onboard(ctx);
    const result = await ctx.runtime.recordHeartbeat(beat(session, 1));
    expect(result.accepted).toBe(true);
  });

  it('refuses a session belonging to another agent', async () => {
    const ctx = build();
    const session = onboard(ctx);
    ctx.agents.upsertAgent('tenant-a', 'agent-2', 'user-2', T0, { extension: '1002' });

    const result = await ctx.runtime.recordHeartbeat({
      ...beat(session, 1),
      agentId: 'agent-2',
      userId: 'user-2',
    });
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe(SessionRejection.WRONG_AGENT);
  });

  it('refuses a session presented under another tenant', async () => {
    const ctx = build();
    const session = onboard(ctx);
    const result = await ctx.runtime.recordHeartbeat({ ...beat(session, 1), tenantId: 'tenant-b' });
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe(SessionRejection.WRONG_TENANT);
  });

  it('expires sessions', async () => {
    const ctx = build();
    const session = onboard(ctx);
    ctx.nowRef.value = T0 + 13 * 60 * 60 * 1000;
    const result = await ctx.runtime.recordHeartbeat(beat(session, 1));
    expect(result.reason).toBe(SessionRejection.EXPIRED);
  });
});

describe('replay and rate limiting', () => {
  it('rejects a replayed sequence', async () => {
    const ctx = build();
    const session = onboard(ctx);
    await ctx.runtime.recordHeartbeat(beat(session, 5));
    const replay = await ctx.runtime.recordHeartbeat(beat(session, 5));
    expect(replay.reason).toBe(SessionRejection.REPLAYED_SEQUENCE);
  });

  it('rejects an out-of-order sequence', async () => {
    const ctx = build();
    const session = onboard(ctx);
    await ctx.runtime.recordHeartbeat(beat(session, 5));
    const older = await ctx.runtime.recordHeartbeat(beat(session, 3));
    expect(older.reason).toBe(SessionRejection.REPLAYED_SEQUENCE);
  });

  it('rejects a sequence far beyond the window', async () => {
    // Otherwise a client could jump to 2^31 and lock itself out permanently.
    const ctx = build();
    const session = onboard(ctx);
    const result = await ctx.runtime.recordHeartbeat(beat(session, 5_000_000));
    expect(result.reason).toBe(SessionRejection.SEQUENCE_TOO_FAR_AHEAD);
  });

  it('rate limits a flood', async () => {
    const ctx = build();
    const session = onboard(ctx);
    for (let i = 1; i <= 5; i++) await ctx.runtime.recordHeartbeat(beat(session, i));

    const flooded = await ctx.runtime.recordHeartbeat(beat(session, 6));
    expect(flooded.reason).toBe(SessionRejection.RATE_LIMITED);
  });

  it('audits every outcome, accepted or not', async () => {
    const ctx = build();
    const session = onboard(ctx);
    await ctx.runtime.recordHeartbeat(beat(session, 1));
    await ctx.runtime.recordHeartbeat(beat(session, 1));

    expect(ctx.audits).toHaveLength(2);
    expect(ctx.audits[0].accepted).toBe(true);
    expect(ctx.audits[1].accepted).toBe(false);
    expect(ctx.audits[1].rejection).toBe(SessionRejection.REPLAYED_SEQUENCE);
  });

  it('never logs a whole session token', async () => {
    const ctx = build();
    const session = onboard(ctx);
    await ctx.runtime.recordHeartbeat(beat(session, 1));
    expect(ctx.audits[0].sessionIdPrefix.length).toBeLessThanOrEqual(6);
    expect(session.sessionId).not.toBe(ctx.audits[0].sessionIdPrefix);
  });
});

describe('SIP registration is taken from FreeSWITCH, not the browser', () => {
  it('counts an agent as capacity only when FreeSWITCH says registered', async () => {
    const ctx = build();
    const session = onboard(ctx);
    const result = await ctx.runtime.recordHeartbeat(beat(session, 1));
    expect(result.sipRegistered).toBe(true);
    expect(result.countedAsCapacity).toBe(true);
  });

  it('ignores a browser claiming registration that FreeSWITCH does not confirm', async () => {
    // This is the failure that produces abandoned calls: a tab whose socket died
    // still asserts it can take calls.
    const ctx = build();
    ctx.agents.upsertAgent('tenant-a', 'agent-1', 'user-1', T0, { extension: EXT });
    ctx.assignmentSource.set('tenant-a', 'agent-1', ['camp-1']);
    const session = ctx.runtime.issueSession('tenant-a', 'agent-1', 'user-1')!;

    const result = await ctx.runtime.recordHeartbeat({
      ...beat(session, 1),
      browserClaimsSipRegistered: true,
    });

    expect(result.sipRegistered).toBe(false);
    expect(result.countedAsCapacity).toBe(false);
    expect(ctx.audits[0].browserClaimedSip).toBe(true);
    expect(ctx.audits[0].freeswitchSip).toBe(false);
  });

  it('drops capacity when FreeSWITCH reports an unregister', async () => {
    const ctx = build();
    const session = onboard(ctx);
    expect((await ctx.runtime.recordHeartbeat(beat(session, 1))).countedAsCapacity).toBe(true);

    ctx.sipRegistry.applyRegistrationEvent(
      registerEvent({ 'Event-Subclass': 'sofia::unregister' })
    );
    expect((await ctx.runtime.recordHeartbeat(beat(session, 2))).countedAsCapacity).toBe(false);
  });

  it('treats a registration that stopped refreshing as gone', async () => {
    const ctx = build();
    const session = onboard(ctx);
    ctx.nowRef.value = T0 + 10 * 60 * 1000;
    const result = await ctx.runtime.recordHeartbeat(beat(session, 1));
    expect(result.sipRegistered).toBe(false);
  });

  it('routes sofia events away from the call ingestor', () => {
    const ctx = build();
    ctx.sipRegistry.applyRegistrationEvent(registerEvent());
    expect(ctx.sipRegistry.metrics().registered).toBe(1);
    expect(ctx.runtime.getCollector().metrics().trackedCalls).toBe(0);
  });
});

describe('campaign membership is resolved server-side', () => {
  it('ignores campaigns the browser asks for but is not assigned to', async () => {
    const ctx = build();
    const session = onboard(ctx, ['camp-1']);

    const result = await ctx.runtime.recordHeartbeat({
      ...beat(session, 1),
      preferredCampaignIds: ['camp-1', 'camp-999-not-mine'],
    });

    expect(result.campaignIds).toEqual(['camp-1']);
    expect(ctx.agents.get('tenant-a', 'agent-1')?.campaignIds).toEqual(['camp-1']);
  });

  it('lets a preference narrow, never widen', async () => {
    const ctx = build();
    const session = onboard(ctx, ['camp-1', 'camp-2']);

    const result = await ctx.runtime.recordHeartbeat({
      ...beat(session, 1),
      preferredCampaignIds: ['camp-2'],
    });
    expect(result.campaignIds).toEqual(['camp-2']);
  });

  it('assigns no campaigns when membership cannot be established', async () => {
    // Unknown assignment means none, not all.
    const ctx = build();
    ctx.agents.upsertAgent('tenant-a', 'agent-1', 'user-1', T0, { extension: EXT });
    ctx.sipRegistry.applyRegistrationEvent(registerEvent());
    const session = ctx.runtime.issueSession('tenant-a', 'agent-1', 'user-1')!;

    const result = await ctx.runtime.recordHeartbeat({
      ...beat(session, 1),
      preferredCampaignIds: ['camp-1'],
    });
    expect(result.campaignIds).toEqual([]);
  });
});

describe('call ids and channel UUIDs come from telephony, not the browser', () => {
  it('ignores any channel the browser might claim', async () => {
    const ctx = build();
    const session = onboard(ctx);

    await ctx.runtime.recordHeartbeat({
      ...beat(session, 1),
      // Not part of the accepted payload type; passed to prove it is inert.
      ...({ currentChannelUuid: 'chan-i-invented', currentCallId: 'call-i-invented' } as object),
    });

    const record = ctx.agents.get('tenant-a', 'agent-1');
    expect(record?.currentChannelUuid).toBeNull();
    expect(record?.currentCallId).toBeNull();
  });

  it('derives the channel from observed events', async () => {
    const ctx = build();
    const session = onboard(ctx);
    await ctx.runtime
      .getIngestor()
      .handleRaw(rawEvent({ variable_hopwhistle_agent_id: 'agent-1', 'Unique-ID': 'chan-real' }));

    await ctx.runtime.recordHeartbeat(beat(session, 1));
    expect(ctx.agents.get('tenant-a', 'agent-1')?.currentChannelUuid).toBe('chan-real');
  });
});

describe('duplicate tabs', () => {
  it('does not count an older session as capacity', async () => {
    const ctx = build();
    const first = onboard(ctx);
    const second = ctx.runtime.issueSession('tenant-a', 'agent-1', 'user-1')!;

    const newer = await ctx.runtime.recordHeartbeat(beat(second, 1));
    expect(newer.countedAsCapacity).toBe(true);

    const older = await ctx.runtime.recordHeartbeat(beat(first, 1));
    expect(older.accepted).toBe(true);
    expect(older.countedAsCapacity).toBe(false);
  });
});

describe('distributed coordination', () => {
  it('skips the shadow pass when the lock is held elsewhere', async () => {
    const denied: DistributedLock = {
      distributed: true,
      acquire: () => Promise.resolve(null),
      renew: () => Promise.resolve(false),
      release: () => Promise.resolve(),
    };
    const ctx = build({}, { lock: denied });
    await ctx.runtime.getIngestor().handleRaw(rawEvent());

    expect(await ctx.runtime.runShadowPass()).toBe(0);
    expect(ctx.runtime.status().shadowPassesSkippedForLock).toBe(1);
    expect(await ctx.shadowStore.recent('tenant-a', 10)).toHaveLength(0);
  });

  it('skips reconciliation when the lock is held elsewhere', async () => {
    const denied: DistributedLock = {
      distributed: true,
      acquire: () => Promise.resolve(null),
      renew: () => Promise.resolve(false),
      release: () => Promise.resolve(),
    };
    const ctx = build({}, { lock: denied });
    expect(await ctx.runtime.runReconciliation()).toEqual([]);
    expect(ctx.runtime.status().reconcilePassesSkippedForLock).toBe(1);
  });

  it('releases the lock after a pass', async () => {
    const release = vi.fn(() => Promise.resolve());
    const lock: DistributedLock = {
      distributed: true,
      acquire: () => Promise.resolve({ fencingToken: 1, ownerId: 'a' }),
      renew: () => Promise.resolve(true),
      release,
    };
    const ctx = build({}, { lock });
    await ctx.runtime.getIngestor().handleRaw(rawEvent());
    await ctx.runtime.runShadowPass();
    expect(release).toHaveBeenCalledWith('shadow');
  });

  it('abandons a pass when ownership is lost mid-way', async () => {
    // The TTL can lapse during a long pass. A holder that has been superseded
    // must stop, not keep writing decisions under stale authority.
    const lock: DistributedLock = {
      distributed: true,
      acquire: () => Promise.resolve({ fencingToken: 1, ownerId: 'a' }),
      renew: () => Promise.resolve(false),
      release: () => Promise.resolve(),
    };
    const ctx = build({}, { lock });
    await ctx.runtime.getIngestor().handleRaw(rawEvent());

    expect(await ctx.runtime.runShadowPass()).toBe(0);
    expect(ctx.runtime.status().shadowPassesAbandonedForLostLock).toBe(1);
    expect(await ctx.shadowStore.recent('tenant-a', 10)).toHaveLength(0);
  });

  it('reports whether coordination is actually distributed', () => {
    expect(build().runtime.status().lockDistributed).toBe(false);
    const distributed: DistributedLock = {
      distributed: true,
      acquire: () => Promise.resolve({ fencingToken: 1, ownerId: 'a' }),
      renew: () => Promise.resolve(true),
      release: () => Promise.resolve(),
    };
    expect(build({}, { lock: distributed }).runtime.status().lockDistributed).toBe(true);
  });
});

describe('redis health is real', () => {
  it('reports the injected health rather than a constant', () => {
    expect(build({}, { redisHealthy: () => false }).runtime.status().redisHealthy).toBe(false);
    expect(build({}, { redisHealthy: () => true }).runtime.status().redisHealthy).toBe(true);
  });

  it('hard-stops pacing when Redis is unhealthy', async () => {
    // Previously impossible: the runtime passed redisHealthy: true unconditionally,
    // so this controller gate could never fire.
    const ctx = build({}, { redisHealthy: () => false });
    await ctx.runtime.getIngestor().handleRaw(rawEvent());
    await ctx.runtime.runShadowPass();

    const [decision] = await ctx.shadowStore.recent('tenant-a', 10);
    expect(decision.recommendedOriginateCount).toBe(0);
    expect(decision.bindingConstraint).toBe(PacingReason.REDIS_UNHEALTHY);
  });
});

describe('ESL start gate', () => {
  it('is disabled by default', () => {
    const config = readEslConfig({} as NodeJS.ProcessEnv);
    expect(config.enabled).toBe(false);
    expect(canStartEsl(config).refusal).toBe(EslStartRefusal.DISABLED);
  });

  it('refuses a host that is not allowlisted', () => {
    const config = readEslConfig({
      TENANT_DIALER_V2_ESL_INGEST_ENABLED: 'true',
      FREESWITCH_ESL_HOST: 'attacker.example.com',
      FREESWITCH_ESL_PASSWORD: 'secret',
      TENANT_DIALER_V2_ESL_ALLOWED_HOSTS: 'freeswitch,fs-staging',
    } as NodeJS.ProcessEnv);
    expect(canStartEsl(config).refusal).toBe(EslStartRefusal.HOST_NOT_ALLOWLISTED);
  });

  it('refuses when no password is configured', () => {
    const config = readEslConfig({
      TENANT_DIALER_V2_ESL_INGEST_ENABLED: 'true',
      FREESWITCH_ESL_HOST: 'freeswitch',
      TENANT_DIALER_V2_ESL_ALLOWED_HOSTS: 'freeswitch',
    } as NodeJS.ProcessEnv);
    expect(canStartEsl(config).refusal).toBe(EslStartRefusal.NO_PASSWORD);
  });

  it('permits a fully configured, allowlisted host', () => {
    const config = readEslConfig({
      TENANT_DIALER_V2_ESL_INGEST_ENABLED: 'true',
      FREESWITCH_ESL_HOST: 'freeswitch',
      FREESWITCH_ESL_PASSWORD: 'secret',
      TENANT_DIALER_V2_ESL_ALLOWED_HOSTS: 'freeswitch',
    } as NodeJS.ProcessEnv);
    expect(canStartEsl(config).ok).toBe(true);
  });

  it('does not enable origination when ingestion is enabled', () => {
    const flags = new EnvFlagSource({
      TENANT_DIALER_V2_ESL_INGEST_ENABLED: 'true',
      TENANT_DIALER_V2_ENABLED: 'true',
    }).get();
    expect(flags.originateEnabled).toBe(false);
    expect(flags.dryRun).toBe(true);
  });
});

describe('event ingestion feeds observation', () => {
  it('routes a normalized event into the collector', async () => {
    const ctx = build();
    await ctx.runtime.getIngestor().handleRaw(rawEvent());
    const obs = ctx.runtime.getCollector().observe('tenant-a', 'camp-1');
    expect(obs.attempts).toBe(1);
  });

  it('does not double-count a replayed event', async () => {
    const ctx = build();
    const raw = rawEvent();
    await ctx.runtime.getIngestor().handleRaw(raw);
    await ctx.runtime.getIngestor().handleRaw(raw);
    expect(ctx.runtime.getCollector().observe('tenant-a', 'camp-1').attempts).toBe(1);
  });
});

describe('shadow pass', () => {
  it('records a decision per observed campaign and originates nothing', async () => {
    const ctx = build();
    await ctx.runtime.getIngestor().handleRaw(rawEvent());
    expect(await ctx.runtime.runShadowPass()).toBe(1);

    const [decision] = await ctx.shadowStore.recent('tenant-a', 10);
    expect(decision.originated).toBe(false);
    expect(decision.bindingConstraint).toBeTruthy();
  });

  it('hard-stops because ESL is not connected in this configuration', async () => {
    const ctx = build();
    await ctx.runtime.getIngestor().handleRaw(rawEvent());
    await ctx.runtime.runShadowPass();
    const [decision] = await ctx.shadowStore.recent('tenant-a', 10);
    expect(decision.bindingConstraint).toBe(PacingReason.ESL_UNHEALTHY);
  });

  it('never marks a decision as originated, whatever the flags say', async () => {
    const ctx = build({
      TENANT_DIALER_V2_ORIGINATE_ENABLED: 'true',
      TENANT_DIALER_V2_DRY_RUN: 'false',
      TENANT_DIALER_V2_MAX_GLOBAL_CALLS: '999',
    });
    await ctx.runtime.getIngestor().handleRaw(rawEvent());
    await ctx.runtime.runShadowPass();
    for (const d of await ctx.shadowStore.recent('tenant-a', 10)) {
      expect(d.originated).toBe(false);
    }
  });
});

describe('reconciliation', () => {
  it('marks an agent stale when the heartbeat expires', async () => {
    const ctx = build();
    const session = onboard(ctx);
    await ctx.runtime.recordHeartbeat(beat(session, 1));

    ctx.nowRef.value = T0 + 60_000;
    const corrections = await ctx.runtime.runReconciliation();

    expect(corrections.length).toBeGreaterThan(0);
    expect(ctx.agents.get('tenant-a', 'agent-1')?.state).toBe(AgentState.STALE);
  });

  it('removes stale agents from predictive capacity', async () => {
    const ctx = build();
    const session = onboard(ctx);
    await ctx.runtime.recordHeartbeat(beat(session, 1));
    expect(ctx.agents.capacity('tenant-a', T0, 'camp-1').available).toBe(1);

    ctx.nowRef.value = T0 + 60_000;
    await ctx.runtime.runReconciliation();
    expect(ctx.agents.capacity('tenant-a', ctx.nowRef.value, 'camp-1').available).toBe(0);
  });

  it('pushes authoritative SIP state in before reconciling', async () => {
    const ctx = build();
    const session = onboard(ctx);
    await ctx.runtime.recordHeartbeat(beat(session, 1));
    expect(ctx.agents.get('tenant-a', 'agent-1')?.sipRegistered).toBe(true);

    ctx.sipRegistry.applyRegistrationEvent(
      registerEvent({ 'Event-Subclass': 'sofia::unregister' })
    );
    await ctx.runtime.runReconciliation();
    expect(ctx.agents.get('tenant-a', 'agent-1')?.sipRegistered).toBe(false);
  });
});

describe('runtime status', () => {
  it('reports that ESL was not started and why', () => {
    const ctx = build();
    ctx.runtime.start();
    expect(ctx.runtime.status().eslRefusal).toBe(EslStartRefusal.DISABLED);
    ctx.runtime.stop();
  });

  it('stops cleanly', () => {
    const ctx = build();
    ctx.runtime.start();
    expect(() => ctx.runtime.stop()).not.toThrow();
  });
});
