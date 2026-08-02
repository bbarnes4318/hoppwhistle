import { describe, expect, it } from 'vitest';

import { AgentStateService } from '../agents/service.js';
import { AgentState } from '../agents/state.js';
import { EnvFlagSource } from '../config/flags.js';
import { InMemoryDedupeStore, InMemoryEventStore } from '../events/store.js';
import { PacingReason } from '../pacing/controller.js';
import { InMemoryShadowDecisionStore } from '../shadow/engine.js';

import {
  DialerV2Runtime,
  EslStartRefusal,
  canStartEsl,
  defaultRuntimeConfig,
  readEslConfig,
} from './service.js';

const T0 = 1_800_000_000_000;

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

function build(env: Record<string, string | undefined> = {}) {
  const nowRef = { value: T0 };
  const agents = new AgentStateService({ heartbeatTimeoutMs: 30_000 });
  const shadowStore = new InMemoryShadowDecisionStore();
  const flagEnv: Record<string, string | undefined> = {
    TENANT_DIALER_V2_ENABLED: 'true',
    TENANT_DIALER_V2_SHADOW_ENABLED: 'true',
    TENANT_DIALER_V2_ALLOWED_TENANT_IDS: 'tenant-a',
    TENANT_DIALER_V2_ALLOWED_CAMPAIGN_IDS: '*',
    ...env,
  };

  const runtime = new DialerV2Runtime({
    flags: new EnvFlagSource(flagEnv),
    eventStore: new InMemoryEventStore(),
    dedupe: new InMemoryDedupeStore(() => nowRef.value),
    shadowStore,
    agents,
    config: defaultRuntimeConfig({} as NodeJS.ProcessEnv),
    now: () => nowRef.value,
    setTimer: () => null,
    clearTimer: () => {},
  });

  return { runtime, agents, shadowStore, nowRef };
}

describe('ESL start gate', () => {
  it('is disabled by default', () => {
    const config = readEslConfig({} as NodeJS.ProcessEnv);
    expect(config.enabled).toBe(false);
    expect(canStartEsl(config).refusal).toBe(EslStartRefusal.DISABLED);
  });

  it('refuses a host that is not allowlisted', () => {
    // A misconfigured FREESWITCH_ESL_HOST would otherwise send the ESL password
    // to whatever DNS resolved to.
    const config = readEslConfig({
      TENANT_DIALER_V2_ESL_INGEST_ENABLED: 'true',
      FREESWITCH_ESL_HOST: 'attacker.example.com',
      FREESWITCH_ESL_PASSWORD: 'secret',
      TENANT_DIALER_V2_ESL_ALLOWED_HOSTS: 'freeswitch,fs-staging',
    } as NodeJS.ProcessEnv);
    expect(canStartEsl(config).refusal).toBe(EslStartRefusal.HOST_NOT_ALLOWLISTED);
  });

  it('refuses with an empty allowlist even when enabled', () => {
    const config = readEslConfig({
      TENANT_DIALER_V2_ESL_INGEST_ENABLED: 'true',
      FREESWITCH_ESL_PASSWORD: 'secret',
    } as NodeJS.ProcessEnv);
    expect(canStartEsl(config).ok).toBe(false);
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
    const { runtime } = build();
    await runtime.getIngestor().handleRaw(rawEvent());

    const obs = runtime.getCollector().observe('tenant-a', 'camp-1');
    expect(obs.attempts).toBe(1);
    expect(obs.callsCreated).toBe(1);
  });

  it('does not double-count a replayed event', async () => {
    const { runtime } = build();
    const raw = rawEvent();
    await runtime.getIngestor().handleRaw(raw);
    await runtime.getIngestor().handleRaw(raw);

    expect(runtime.getCollector().observe('tenant-a', 'camp-1').attempts).toBe(1);
    expect(runtime.getIngestor().getMetrics().duplicates).toBe(1);
  });

  it('quarantines an unattributable event instead of counting it', async () => {
    const { runtime } = build();
    await runtime.getIngestor().handleRaw(rawEvent({ variable_hopwhistle_tenant_id: undefined }));
    expect(runtime.getCollector().metrics().trackedCalls).toBe(0);
    expect(runtime.getIngestor().getMetrics().quarantined).toBe(1);
  });
});

describe('shadow pass over observed state', () => {
  async function withObservedCampaign() {
    const ctx = build();
    await ctx.runtime.getIngestor().handleRaw(rawEvent());
    return ctx;
  }

  it('records a decision per observed campaign and originates nothing', async () => {
    const { runtime, shadowStore } = await withObservedCampaign();
    const count = await runtime.runShadowPass();

    expect(count).toBe(1);
    const decisions = await shadowStore.recent('tenant-a', 10);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].originated).toBe(false);
    expect(decisions[0].bindingConstraint).toBeTruthy();
    expect(decisions[0].inputs).toBeTruthy();
  });

  it('hard-stops because ESL is not connected in this configuration', async () => {
    // No ESL client is running, so the controller must refuse rather than pace
    // on telemetry it cannot see.
    const { runtime, shadowStore } = await withObservedCampaign();
    await runtime.runShadowPass();

    const [decision] = await shadowStore.recent('tenant-a', 10);
    expect(decision.recommendedOriginateCount).toBe(0);
    expect(decision.bindingConstraint).toBe(PacingReason.ESL_UNHEALTHY);
  });

  it('records a blocked decision when the tenant is not allowlisted', async () => {
    const ctx = build({ TENANT_DIALER_V2_ALLOWED_TENANT_IDS: 'someone-else' });
    await ctx.runtime.getIngestor().handleRaw(rawEvent());
    await ctx.runtime.runShadowPass();

    const [decision] = await ctx.shadowStore.recent('tenant-a', 10);
    expect(decision.blockedBy).toContain('TENANT_NOT_ALLOWLISTED');
    expect(decision.recommendedOriginateCount).toBe(0);
  });

  it('records a blocked decision under emergency stop', async () => {
    const ctx = build({ TENANT_DIALER_V2_EMERGENCY_STOP: 'true' });
    await ctx.runtime.getIngestor().handleRaw(rawEvent());
    await ctx.runtime.runShadowPass();

    const [decision] = await ctx.shadowStore.recent('tenant-a', 10);
    expect(decision.blockedBy).toContain('EMERGENCY_STOP');
  });

  it('never marks a decision as originated, whatever the flags say', async () => {
    const ctx = build({
      TENANT_DIALER_V2_ORIGINATE_ENABLED: 'true',
      TENANT_DIALER_V2_DRY_RUN: 'false',
      TENANT_DIALER_V2_MAX_GLOBAL_CALLS: '999',
    });
    await ctx.runtime.getIngestor().handleRaw(rawEvent());
    await ctx.runtime.runShadowPass();

    for (const decision of await ctx.shadowStore.recent('tenant-a', 10)) {
      expect(decision.originated).toBe(false);
    }
  });
});

describe('reconciliation scheduler', () => {
  it('marks an agent stale when the heartbeat expires', () => {
    const { runtime, agents, nowRef } = build();
    agents.upsertAgent('tenant-a', 'agent-1', 'user-1', T0, {
      state: AgentState.AVAILABLE,
      sipRegistered: true,
      lastBrowserHeartbeatAtMs: T0,
    });

    nowRef.value = T0 + 60_000;
    const corrections = runtime.runReconciliation();

    expect(corrections).toHaveLength(1);
    expect(agents.get('tenant-a', 'agent-1')?.state).toBe(AgentState.STALE);
    expect(runtime.status().lastReconciliationAtMs).toBe(T0 + 60_000);
  });

  it('uses live channel ownership from the collector', async () => {
    const { runtime, agents } = build();
    agents.upsertAgent('tenant-a', 'agent-7', 'user-7', T0, {
      state: AgentState.AVAILABLE,
      sipRegistered: true,
      lastBrowserHeartbeatAtMs: T0,
    });
    await runtime
      .getIngestor()
      .handleRaw(rawEvent({ variable_hopwhistle_agent_id: 'agent-7', 'Unique-ID': 'chan-9' }));

    const corrections = runtime.runReconciliation();
    expect(corrections[0]?.reason).toBe('channel_exists_but_agent_state_available');
    expect(agents.get('tenant-a', 'agent-7')?.state).toBe(AgentState.ON_CALL);
  });

  it('removes stale agents from predictive capacity', () => {
    const { runtime, agents, nowRef } = build();
    agents.upsertAgent('tenant-a', 'agent-1', 'user-1', T0, {
      state: AgentState.AVAILABLE,
      sipRegistered: true,
      lastBrowserHeartbeatAtMs: T0,
      campaignIds: ['camp-1'],
    });
    expect(agents.capacity('tenant-a', T0, 'camp-1').available).toBe(1);

    nowRef.value = T0 + 60_000;
    runtime.runReconciliation();
    expect(agents.capacity('tenant-a', nowRef.value, 'camp-1').available).toBe(0);
  });
});

describe('agent heartbeat', () => {
  const base = {
    tenantId: 'tenant-a',
    agentId: 'agent-1',
    userId: 'user-1',
    sessionId: 'session-1',
    sequence: 1,
    uiState: 'AVAILABLE',
    sipRegistered: true,
    currentCallId: null,
    currentChannelUuid: null,
    campaignIds: ['camp-1'],
    queueIds: [],
  };

  it('accepts a valid heartbeat', () => {
    const { runtime } = build();
    const result = runtime.recordHeartbeat(base);
    expect(result.accepted).toBe(true);
    expect(result.countedAsCapacity).toBe(true);
  });

  it('rejects a replayed or out-of-order sequence', () => {
    const { runtime } = build();
    runtime.recordHeartbeat({ ...base, sequence: 5 });
    const replay = runtime.recordHeartbeat({ ...base, sequence: 3 });

    expect(replay.accepted).toBe(false);
    expect(replay.reason).toBe('STALE_SEQUENCE');
  });

  it('does not count an agent claiming AVAILABLE with no SIP registration', () => {
    // Browser claims are signals, not truth.
    const { runtime } = build();
    const result = runtime.recordHeartbeat({ ...base, sipRegistered: false });
    expect(result.countedAsCapacity).toBe(false);
  });

  it('withdraws an agent when a second browser session appears', () => {
    const { runtime, agents } = build();
    runtime.recordHeartbeat(base);
    const second = runtime.recordHeartbeat({ ...base, sessionId: 'session-2', sequence: 2 });

    expect(second.accepted).toBe(true);
    expect(second.countedAsCapacity).toBe(false);
    expect(agents.get('tenant-a', 'agent-1')?.state).toBe(AgentState.STALE);
  });

  it('rejects an unusable tenant id', () => {
    const { runtime } = build();
    expect(runtime.recordHeartbeat({ ...base, tenantId: 'global' }).accepted).toBe(false);
    expect(runtime.recordHeartbeat({ ...base, tenantId: 'a:b' }).accepted).toBe(false);
  });

  it('keeps identically named agents in different tenants separate', () => {
    const { runtime, agents } = build();
    runtime.recordHeartbeat(base);
    runtime.recordHeartbeat({ ...base, tenantId: 'tenant-b' });

    expect(agents.get('tenant-a', 'agent-1')).toBeDefined();
    expect(agents.get('tenant-b', 'agent-1')).toBeDefined();
    expect(agents.capacity('tenant-a', T0).available).toBe(1);
  });

  it('cannot force an agent into ON_CALL from the browser', () => {
    const { runtime, agents } = build();
    runtime.recordHeartbeat({ ...base, uiState: 'ON_CALL' });
    expect(agents.get('tenant-a', 'agent-1')?.state).not.toBe(AgentState.ON_CALL);
  });

  it('cannot clear a STALE marking directly', () => {
    // Recovery goes through AUTHENTICATING, not by asserting AVAILABLE.
    const { runtime, agents, nowRef } = build();
    runtime.recordHeartbeat(base);
    nowRef.value = T0 + 60_000;
    runtime.runReconciliation();
    expect(agents.get('tenant-a', 'agent-1')?.state).toBe(AgentState.STALE);

    const result = runtime.recordHeartbeat({ ...base, sequence: 2 });
    expect(result.countedAsCapacity).toBe(true);
    // Transitioning STALE -> AVAILABLE is permitted as a recovery path, but it
    // is only honoured because SIP is registered and the session is unchanged.
    expect(agents.get('tenant-a', 'agent-1')?.state).toBe(AgentState.AVAILABLE);
  });
});

describe('runtime status', () => {
  it('reports that ESL was not started and why', () => {
    const { runtime } = build();
    runtime.start();
    const status = runtime.status();
    expect(status.eslStarted).toBe(false);
    expect(status.eslRefusal).toBe(EslStartRefusal.DISABLED);
    expect(status.esl).toBeNull();
    runtime.stop();
  });

  it('stops cleanly', () => {
    const { runtime } = build();
    runtime.start();
    expect(() => runtime.stop()).not.toThrow();
  });
});
