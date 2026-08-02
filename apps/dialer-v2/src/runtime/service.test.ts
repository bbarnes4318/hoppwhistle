/**
 * Runtime tests, against the port implementations the composition root selects.
 *
 * These assert behaviour the runtime is responsible for: which source it treats
 * as authoritative, what it refuses, and what it does when a shared write is
 * rejected. Claims about SHARING — a second replica sees the write, a stale
 * revision loses to a concurrent one — are in the `.live.test.ts` suites,
 * because one in-process object cannot demonstrate them.
 */

import { describe, expect, it } from 'vitest';

import { AgentState } from '../agents/state.js';
import { TelephonyEventType, type NormalizedTelephonyEvent } from '../events/types.js';
import { AgentWriteOutcome } from '../stores/agent-state-store.js';
import { campaignShadowLock, globalLock, type LockDescriptor } from '../stores/coordination.js';
import { SipLifecycle, SipWriteOutcome } from '../stores/sip-store.js';
import { buildHarness, sofiaEvent, type Harness } from '../testing/harness.js';

import { canStartEsl, EslStartRefusal, readEslConfig } from './service.js';

const TENANT = 'tenant-a';
const AGENT = 'agent-1';
const EXT = '1001';
const DOMAIN = 'sip.example.test';

function withAgent(h: Harness): void {
  h.extensionSource.add({
    tenantId: TENANT,
    userId: AGENT,
    agentId: AGENT,
    extension: EXT,
    sipDomain: DOMAIN,
    enabled: true,
    maxConcurrentCalls: 1,
  });
  h.assignmentSource.set(TENANT, AGENT, ['camp-1']);
}

function callEvent(
  tenantId: string,
  agentId: string | null,
  uuid: string,
  occurredAt: number
): NormalizedTelephonyEvent {
  return {
    eventId: `${uuid}-create`,
    eventType: TelephonyEventType.CHANNEL_CREATE,
    tenantId,
    campaignId: 'camp-1',
    agentId,
    channelUuid: uuid,
    callId: `call-${uuid}`,
    leadId: null,
    attemptId: null,
    otherLegUuid: null,
    occurredAt,
    receivedAt: occurredAt,
    hangupCause: null,
  } as NormalizedTelephonyEvent;
}

async function issueAndBeat(h: Harness, uiState: string | null, sequence = 1) {
  const session = await h.runtime.issueSession(TENANT, AGENT, AGENT);
  return h.runtime.recordHeartbeat({
    tenantId: TENANT,
    agentId: AGENT,
    userId: AGENT,
    sessionToken: session?.token ?? '',
    sequence,
    uiState,
  });
}

describe('ESL ingestion refuses to start on its own', () => {
  it('will not start when disabled', () => {
    const config = readEslConfig({} as NodeJS.ProcessEnv);
    expect(canStartEsl(config)).toEqual({ ok: false, refusal: EslStartRefusal.DISABLED });
  });

  it('will not send a password to a host that is not allowlisted', () => {
    // A misconfigured FREESWITCH_ESL_HOST would otherwise hand the ESL password
    // to whatever DNS resolved to.
    const config = readEslConfig({
      TENANT_DIALER_V2_ESL_INGEST_ENABLED: 'true',
      FREESWITCH_ESL_HOST: 'attacker.example',
      FREESWITCH_ESL_PASSWORD: 'secret',
      TENANT_DIALER_V2_ESL_ALLOWED_HOSTS: 'freeswitch',
    } as NodeJS.ProcessEnv);
    expect(canStartEsl(config).refusal).toBe(EslStartRefusal.HOST_NOT_ALLOWLISTED);
  });

  it('will not start without a password', () => {
    const config = readEslConfig({
      TENANT_DIALER_V2_ESL_INGEST_ENABLED: 'true',
      FREESWITCH_ESL_HOST: 'freeswitch',
      TENANT_DIALER_V2_ESL_ALLOWED_HOSTS: 'freeswitch',
    } as NodeJS.ProcessEnv);
    expect(canStartEsl(config).refusal).toBe(EslStartRefusal.NO_PASSWORD);
  });
});

describe('the session token is never invented by the browser', () => {
  it('refuses a heartbeat with no token', async () => {
    const h = buildHarness();
    withAgent(h);
    const result = await h.runtime.recordHeartbeat({
      tenantId: TENANT,
      agentId: AGENT,
      userId: AGENT,
      sessionToken: '',
      sequence: 1,
      uiState: 'AVAILABLE',
    });
    expect(result.accepted).toBe(false);
    expect(result.countedAsCapacity).toBe(false);
  });

  it('refuses a token minted for a different agent', async () => {
    const h = buildHarness();
    withAgent(h);
    const other = await h.runtime.issueSession(TENANT, 'agent-2', 'agent-2');

    const result = await h.runtime.recordHeartbeat({
      tenantId: TENANT,
      agentId: AGENT,
      userId: AGENT,
      sessionToken: other?.token ?? '',
      sequence: 1,
      uiState: 'AVAILABLE',
    });
    expect(result.accepted).toBe(false);
  });

  it('refuses a replayed sequence', async () => {
    const h = buildHarness();
    withAgent(h);
    const session = await h.runtime.issueSession(TENANT, AGENT, AGENT);
    const beat = (sequence: number) =>
      h.runtime.recordHeartbeat({
        tenantId: TENANT,
        agentId: AGENT,
        userId: AGENT,
        sessionToken: session?.token ?? '',
        sequence,
        uiState: 'AVAILABLE',
      });

    expect((await beat(5)).accepted).toBe(true);
    expect((await beat(5)).accepted).toBe(false);
    expect((await beat(4)).accepted).toBe(false);
  });
});

describe('the audit record carries no part of the token', () => {
  it('records the outcome without any session material', async () => {
    const h = buildHarness();
    withAgent(h);
    const session = await h.runtime.issueSession(TENANT, AGENT, AGENT);
    await h.runtime.recordHeartbeat({
      tenantId: TENANT,
      agentId: AGENT,
      userId: AGENT,
      sessionToken: session?.token ?? '',
      sequence: 1,
      uiState: 'AVAILABLE',
    });

    const audit = h.audits.at(-1) ?? {};
    // A six-character prefix used to be written here on every heartbeat: 36
    // bits of a live credential, into whatever aggregator logs are shipped to.
    expect(audit).not.toHaveProperty('sessionIdPrefix');
    expect(JSON.stringify(audit)).not.toContain(session?.token ?? 'NEVER');
    expect(audit.agentId).toBe(AGENT);
  });
});

describe('SIP registration is FreeSWITCH truth, not a browser claim', () => {
  it('does not count an agent whose endpoint never registered', async () => {
    const h = buildHarness();
    withAgent(h);

    const result = await h.runtime.recordHeartbeat({
      tenantId: TENANT,
      agentId: AGENT,
      userId: AGENT,
      sessionToken: (await h.runtime.issueSession(TENANT, AGENT, AGENT))?.token ?? '',
      sequence: 1,
      uiState: 'AVAILABLE',
      browserClaimsSipRegistered: true,
    });

    expect(result.sipRegistered).toBe(false);
    expect(result.countedAsCapacity).toBe(false);
  });

  it('counts the agent once FreeSWITCH says the endpoint registered', async () => {
    const h = buildHarness();
    withAgent(h);
    await h.runtime.handleRegistrationEvent(
      sofiaEvent('sofia::register', { 'Event-Date-Timestamp': String(h.clock.value * 1000) }),
      'sofia::register'
    );

    const result = await issueAndBeat(h, 'AVAILABLE');
    expect(result.sipRegistered).toBe(true);
    expect(result.countedAsCapacity).toBe(true);
  });
});

describe('registration events are ordered by FreeSWITCH, not by lookup latency', () => {
  const at = (ms: number, seq: number): Record<string, string> => ({
    'Event-Date-Timestamp': String(ms * 1000),
    'Event-Sequence': String(seq),
  });

  it('keeps the unregister when the register lookup finishes last', async () => {
    // The exact reordering the unawaited ESL callback produced: the register is
    // emitted first and resolves last.
    const h = buildHarness();
    withAgent(h);

    await h.runtime.handleRegistrationEvent(
      sofiaEvent('sofia::unregister', at(2_000, 11)),
      'sofia::unregister'
    );
    const late = await h.runtime.handleRegistrationEvent(
      sofiaEvent('sofia::register', at(1_000, 10)),
      'sofia::register'
    );

    expect(late).toBe(false);
    const record = await h.sip.get(TENANT, AGENT);
    expect(record?.lifecycle).toBe(SipLifecycle.UNREGISTERED);
    expect(h.runtime.status().registrationsOutOfOrder).toBe(1);
  });

  it('applies a newer register after an unregister', async () => {
    const h = buildHarness();
    withAgent(h);
    await h.runtime.handleRegistrationEvent(
      sofiaEvent('sofia::unregister', at(1_000, 10)),
      'sofia::unregister'
    );
    await h.runtime.handleRegistrationEvent(
      sofiaEvent('sofia::register', at(2_000, 11)),
      'sofia::register'
    );
    expect((await h.sip.get(TENANT, AGENT))?.lifecycle).toBe(SipLifecycle.REGISTERED);
  });

  it('refuses the same event delivered twice', async () => {
    const h = buildHarness();
    withAgent(h);
    const event = sofiaEvent('sofia::register', at(1_000, 10));

    expect(await h.runtime.handleRegistrationEvent(event, 'sofia::register')).toBe(true);
    // Two replicas both see every Sofia event; neither can serialise the other.
    expect(await h.runtime.handleRegistrationEvent(event, 'sofia::register')).toBe(false);
    expect((await h.sip.get(TENANT, AGENT))?.revision).toBe(0);
  });

  it('breaks a timestamp tie with the event sequence', async () => {
    // FreeSWITCH can emit a register and its unregister inside one millisecond.
    // A tie resolved arbitrarily is a coin flip on whether the agent is dialable.
    const h = buildHarness();
    withAgent(h);

    await h.runtime.handleRegistrationEvent(
      sofiaEvent('sofia::register', at(5_000, 40)),
      'sofia::register'
    );
    await h.runtime.handleRegistrationEvent(
      sofiaEvent('sofia::unregister', at(5_000, 41)),
      'sofia::unregister'
    );
    expect((await h.sip.get(TENANT, AGENT))?.lifecycle).toBe(SipLifecycle.UNREGISTERED);
  });

  it('never lets an event without a sequence displace one that has one', async () => {
    const h = buildHarness();
    withAgent(h);

    await h.runtime.handleRegistrationEvent(
      sofiaEvent('sofia::register', at(5_000, 40)),
      'sofia::register'
    );
    // Sequence 0 orders below every real sequence, so an event that cannot
    // prove its position never wins a tie.
    const result = await h.runtime.handleRegistrationEvent(
      { ...sofiaEvent('sofia::unregister', at(5_000, 40)), 'Event-Sequence': '' },
      'sofia::unregister'
    );
    expect(result).toBe(false);
    expect((await h.sip.get(TENANT, AGENT))?.lifecycle).toBe(SipLifecycle.REGISTERED);
  });

  it('rejects a replay after an ESL reconnect', async () => {
    const h = buildHarness();
    withAgent(h);
    await h.runtime.handleRegistrationEvent(
      sofiaEvent('sofia::register', at(1_000, 10)),
      'sofia::register'
    );
    await h.runtime.handleRegistrationEvent(
      sofiaEvent('sofia::unregister', at(2_000, 20)),
      'sofia::unregister'
    );
    // The reconnect redelivers the original register.
    await h.runtime.handleRegistrationEvent(
      sofiaEvent('sofia::register', at(1_000, 10)),
      'sofia::register'
    );
    expect((await h.sip.get(TENANT, AGENT))?.lifecycle).toBe(SipLifecycle.UNREGISTERED);
  });

  it('stops counting a registration past its expiry', async () => {
    const h = buildHarness();
    withAgent(h);
    await h.runtime.handleRegistrationEvent(
      sofiaEvent('sofia::register', { ...at(h.clock.value, 10), expires: '60' }),
      'sofia::register'
    );
    expect(await h.sip.isRegistered(TENANT, AGENT)).toBe(true);

    h.clock.advance(61_000);
    expect(await h.sip.isRegistered(TENANT, AGENT)).toBe(false);
  });

  it('persists the resolved agent, not just the extension', async () => {
    const h = buildHarness();
    withAgent(h);
    await h.runtime.handleRegistrationEvent(sofiaEvent('sofia::register'), 'sofia::register');

    const record = await h.sip.get(TENANT, AGENT);
    expect(record?.agentId).toBe(AGENT);
    expect(record?.extension).toBe(EXT);
  });
});

describe('a registration that cannot be attributed is quarantined', () => {
  it('quarantines an unknown SIP identity rather than guessing', async () => {
    const h = buildHarness();
    const applied = await h.runtime.handleRegistrationEvent(
      sofiaEvent('sofia::register'),
      'sofia::register'
    );
    expect(applied).toBe(false);
    expect(h.runtime.recentQuarantinedRegistrations()).toHaveLength(1);
  });

  it('rejects an event whose tenant variable contradicts the binding', async () => {
    // A forged header must cause rejection, not acceptance under the claim.
    const h = buildHarness();
    withAgent(h);
    const applied = await h.runtime.handleRegistrationEvent(
      sofiaEvent('sofia::register', { variable_hopwhistle_tenant_id: 'tenant-b' }),
      'sofia::register'
    );
    expect(applied).toBe(false);
    expect(h.runtime.status().registrationsForgedTenant).toBe(1);
  });
});

describe('channel ownership requires the tenant', () => {
  it('does not attribute another tenant’s channel to a same-named agent', () => {
    // Agent ids are unique within a tenant, not across the platform. Two
    // tenants that both name an agent `agent-1` collided on every lookup.
    const h = buildHarness();
    const collector = h.runtime.getCollector();
    collector.apply(callEvent('tenant-b', AGENT, 'uuid-b', h.clock.value));

    expect(collector.channelOwnedBy(TENANT, AGENT)).toBeNull();
    expect(collector.channelOwnedBy('tenant-b', AGENT)?.channelUuid).toBe('uuid-b');
  });

  it('carries the tenant, agent, channel and call on every ownership record', () => {
    const h = buildHarness();
    h.runtime.getCollector().apply(callEvent(TENANT, AGENT, 'uuid-a', h.clock.value));

    expect(h.runtime.getCollector().channelOwners().get('uuid-a')).toMatchObject({
      tenantId: TENANT,
      agentId: AGENT,
      channelUuid: 'uuid-a',
      callId: 'call-uuid-a',
    });
  });

  it('does not move a same-named agent in another tenant to ON_CALL', async () => {
    const h = buildHarness();
    withAgent(h);
    await h.runtime.handleRegistrationEvent(
      sofiaEvent('sofia::register', { 'Event-Date-Timestamp': String(h.clock.value * 1000) }),
      'sofia::register'
    );
    await issueAndBeat(h, 'AVAILABLE');

    // A live call in tenant B, owned by an agent with the same id.
    h.runtime.getCollector().apply(callEvent('tenant-b', AGENT, 'uuid-b', h.clock.value));
    await h.runtime.reconcileNow();

    expect(h.agents.get(TENANT, AGENT)?.state).toBe(AgentState.AVAILABLE);
  });
});

describe('the memory cache is never advanced past a refused write', () => {
  it('reports a heartbeat as not durable when the shared write is refused', async () => {
    const h = buildHarness({
      agentStore: {
        backend: 'memory',
        load: () => Promise.resolve(null),
        loadTenant: () => Promise.resolve([]),
        staleWrites: () => 1,
        save: () => Promise.resolve({ outcome: AgentWriteOutcome.UNAVAILABLE }),
      },
    });
    withAgent(h);
    await h.runtime.handleRegistrationEvent(
      sofiaEvent('sofia::register', { 'Event-Date-Timestamp': String(h.clock.value * 1000) }),
      'sofia::register'
    );

    const result = await issueAndBeat(h, 'AVAILABLE');
    // The session was valid and SIP was registered — the ONLY reason this agent
    // is not capacity is that no other replica can see the state.
    expect(result.accepted).toBe(true);
    expect(result.sipRegistered).toBe(true);
    expect(result.durable).toBe(false);
    expect(result.countedAsCapacity).toBe(false);
  });

  it('adopts the authoritative record when its revision is stale', async () => {
    const current = {
      tenantId: TENANT,
      agentId: AGENT,
      revision: 9,
      state: AgentState.ON_CALL,
    };
    const h = buildHarness({
      agentStore: {
        backend: 'memory',
        load: () => Promise.resolve(null),
        loadTenant: () => Promise.resolve([]),
        staleWrites: () => 1,
        save: () =>
          Promise.resolve({
            outcome: AgentWriteOutcome.STALE_REVISION,
            current: current as never,
          }),
      },
    });
    withAgent(h);
    await issueAndBeat(h, 'AVAILABLE');

    // Re-reading would race the same way again; the refusing store already
    // handed back what is current, so that is what the cache holds.
    expect(h.agents.get(TENANT, AGENT)?.revision).toBe(9);
    expect(h.agents.get(TENANT, AGENT)?.state).toBe(AgentState.ON_CALL);
    expect(h.runtime.status().agentStaleWrites).toBe(1);
  });

  it('advances the revision on an accepted write', async () => {
    const h = buildHarness();
    withAgent(h);
    await issueAndBeat(h, 'AVAILABLE');
    expect(h.agents.get(TENANT, AGENT)?.revision).toBe(1);

    await issueAndBeat(h, 'PAUSED', 2);
    expect(h.agents.get(TENANT, AGENT)?.revision).toBe(2);
  });
});

describe('coordination is per campaign and tenant-scoped', () => {
  function recordingLock(taken: LockDescriptor[]) {
    return {
      distributed: true,
      acquire: (lock: LockDescriptor) => {
        taken.push(lock);
        return Promise.resolve({ fencingToken: 1, ownerId: 'r1', lockValue: 'r1:1' });
      },
      renew: () => Promise.resolve(true),
      release: () => Promise.resolve(),
    };
  }

  it('takes one lock per campaign, inside that tenant’s namespace', async () => {
    const taken: LockDescriptor[] = [];
    const h = buildHarness({ lock: recordingLock(taken) });
    h.runtime.getCollector().apply(callEvent(TENANT, null, 'u1', h.clock.value));

    await h.runtime.runShadowPass();

    expect(taken).toHaveLength(1);
    expect(taken[0].key).toBe(campaignShadowLock(TENANT, 'camp-1').key);
    // Inside the tenant, not in the global keyspace where no tenant-scoped
    // sweep or audit would ever find it.
    expect(taken[0].key).toContain(`tenant:${TENANT}:dialer:v2:`);
    expect(taken[0].fenceKey).toBe(`${taken[0].key.replace(/:lock$/, '')}:fence`);
  });

  it('uses the enumerated global lock for reconciliation', async () => {
    const taken: LockDescriptor[] = [];
    const h = buildHarness({ lock: recordingLock(taken) });
    await h.runtime.runReconciliation();

    expect(taken[0].key).toBe(globalLock('reconcile').key);
    // A global lock name is never parameterised, so no caller can put a tenant
    // id into the platform keyspace.
    expect(taken[0].key).not.toContain('tenant:');
  });

  it('skips a campaign whose lock is held elsewhere', async () => {
    const h = buildHarness({
      lock: {
        distributed: true,
        acquire: () => Promise.resolve(null),
        renew: () => Promise.resolve(false),
        release: () => Promise.resolve(),
      },
    });
    h.runtime.getCollector().apply(callEvent(TENANT, null, 'u1', h.clock.value));

    expect(await h.runtime.runShadowPass()).toBe(0);
    expect(h.runtime.status().shadowPassesSkippedForLock).toBe(1);
  });
});

describe('reconstruction happens before evidence is claimed', () => {
  it('reports incomplete until reconstruct has run', async () => {
    const h = buildHarness();
    expect(h.runtime.status().reconstructionComplete).toBe(false);

    await h.runtime.reconstruct([TENANT]);
    expect(h.runtime.status().reconstructionComplete).toBe(true);
  });

  it('rebuilds the agent cache from the shared record', async () => {
    const h = buildHarness();
    await h.agentStore.save(
      { tenantId: TENANT, agentId: AGENT, revision: 0, state: AgentState.AVAILABLE } as never,
      0
    );

    const result = await h.runtime.reconstruct([TENANT]);
    expect(result.agents).toBe(1);
    expect(h.agents.get(TENANT, AGENT)?.state).toBe(AgentState.AVAILABLE);
  });

  it('reports incomplete when a tenant could not be loaded', async () => {
    // A replica that started on a partial view is not observing a quiet
    // deployment; its capacity numbers are a floor, not a measurement.
    const h = buildHarness({
      agentStore: {
        backend: 'memory',
        load: () => Promise.resolve(null),
        loadTenant: () => Promise.reject(new Error('redis down')),
        staleWrites: () => 0,
        save: () => Promise.resolve({ outcome: AgentWriteOutcome.SAVED, revision: 1 }),
      },
    });
    await h.runtime.reconstruct([TENANT]);
    expect(h.runtime.status().reconstructionComplete).toBe(false);
  });

  it('restores a live channel so a mid-call agent is not corrected to WRAP_UP', async () => {
    const h = buildHarness();
    await h.agentStore.save(
      { tenantId: TENANT, agentId: AGENT, revision: 0, state: AgentState.ON_CALL } as never,
      0
    );
    await h.channels.claim(TENANT, AGENT, 'uuid-live', 'call-1');

    await h.runtime.reconstruct([TENANT]);
    expect(h.agents.get(TENANT, AGENT)?.currentChannelUuid).toBe('uuid-live');
  });
});

describe('observations are written under the event’s own timestamp', () => {
  it('files a late event under when it happened, not when it arrived', async () => {
    const h = buildHarness();
    const occurredAt = h.clock.value - 600_000;

    await h.runtime.getIngestor().handleRaw({
      'Event-Name': 'CHANNEL_CREATE',
      'Event-Date-Timestamp': String(occurredAt * 1000),
      'Unique-ID': 'uuid-late',
      variable_hopwhistle_tenant_id: TENANT,
      variable_hopwhistle_campaign_id: 'camp-1',
    });

    // Ten minutes of ingestion lag after an ESL reconnect would otherwise pile
    // the whole backlog into whichever bucket happened to be current.
    expect(h.observations.writes.at(-1)?.eventAtMs).toBe(occurredAt);
  });
});

describe('the shadow pass never originates', () => {
  it('records originated: false on every decision', async () => {
    const h = buildHarness();
    withAgent(h);
    h.runtime.getCollector().apply(callEvent(TENANT, null, 'u1', h.clock.value));

    await h.runtime.runShadowPass();
    const decisions = await h.shadowStore.recent(TENANT, 10, 'camp-1');
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions.every(d => d.originated === false)).toBe(true);
  });
});

describe('SIP write failures are reported, not swallowed', () => {
  it('quarantines when the store is unavailable', async () => {
    const h = buildHarness({
      sip: {
        backend: 'memory',
        apply: () => Promise.resolve({ outcome: SipWriteOutcome.UNAVAILABLE }),
        get: () => Promise.resolve(null),
        isRegistered: () => Promise.resolve(false),
        loadAll: () => Promise.resolve([]),
      },
    });
    withAgent(h);

    expect(
      await h.runtime.handleRegistrationEvent(sofiaEvent('sofia::register'), 'sofia::register')
    ).toBe(false);
    expect(h.runtime.recentQuarantinedRegistrations().at(-1)?.reason).toContain('UNAVAILABLE');
  });
});
