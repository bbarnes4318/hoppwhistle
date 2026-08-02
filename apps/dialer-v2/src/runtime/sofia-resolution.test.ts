/**
 * Dialer V2 — live Sofia registration resolution.
 *
 * Drives a realistic `CUSTOM sofia::register` frame through the actual
 * transport and runtime dispatch:
 *
 *   SocketEslTransport -> EslClient -> DialerV2Runtime.onRawEvent
 *     -> ExtensionResolver.forSipIdentity -> SipRegistrationRegistry.applyResolved
 *
 * The fixture events deliberately carry NO `variable_hopwhistle_tenant_id`.
 * Identity has to come back from the database binding, because in a real
 * deployment FreeSWITCH has no reason to put a Hoppwhistle tenant id on a
 * REGISTER — which is exactly why the previous code path never resolved
 * anything.
 */

import { EventEmitter } from 'node:events';
import type net from 'node:net';

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
import { EslClient } from '../esl/client.js';
import { SocketEslTransport } from '../esl/socket-transport.js';
import { InMemoryDedupeStore, InMemoryEventStore } from '../events/store.js';
import { InMemoryShadowDecisionStore } from '../shadow/engine.js';
import { NoOpLock } from '../stores/coordination.js';

import { DialerV2Runtime, defaultRuntimeConfig } from './service.js';

const T0 = 1_800_000_000_000;
const TENANT = 'tenant-a';
const AGENT = 'agent-1';
const USER = 'user-1';
const EXT = '1001';
const DOMAIN = 'hopwhistle.com';
const CAMPAIGN = 'camp-1';

/** A realistic sofia frame. No Hoppwhistle tenant variable anywhere. */
function sofiaFrame(subclass: string, fields: Record<string, string> = {}): string {
  const body = Object.entries({
    'Event-Name': 'CUSTOM',
    'Event-Subclass': subclass,
    'Event-Date-Timestamp': String(T0 * 1000),
    'Event-Sequence': '77',
    profile_name: 'internal',
    'from-user': EXT,
    username: EXT,
    domain_name: DOMAIN,
    contact: `sip:${EXT}@10.0.0.5:5060`,
    'network-ip': '10.0.0.5',
    expires: '3600',
    ...fields,
  })
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');

  return `Content-Type: text/event-plain\nContent-Length: ${body.length}\n\n${body}`;
}

class FakeSocket extends EventEmitter {
  written: string[] = [];
  setEncoding(): this {
    return this;
  }
  connect(): this {
    queueMicrotask(() => this.emit('data', 'Content-Type: auth/request\n\n'));
    return this;
  }
  write(data: string): boolean {
    this.written.push(data);
    if (data.startsWith('auth ')) {
      queueMicrotask(() =>
        this.emit('data', 'Content-Type: command/reply\nReply-Text: +OK accepted\n\n')
      );
    }
    return true;
  }
  destroy(): void {}
}

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

function buildLiveStack() {
  const nowRef = { value: T0 };
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
    dedupe: new InMemoryDedupeStore(() => nowRef.value),
    shadowStore: new InMemoryShadowDecisionStore(),
    agents,
    sessions,
    assignments: new AssignmentResolver({ source: assignmentSource, now: () => nowRef.value }),
    extensions: new ExtensionResolver({ source: extensionSource, now: () => nowRef.value }),
    sipRegistry,
    lock: new NoOpLock(),
    redisHealthy: () => true,
    config: defaultRuntimeConfig({} as NodeJS.ProcessEnv),
    now: () => nowRef.value,
    setTimer: () => null,
    clearTimer: () => {},
  });

  // The real transport + client, feeding the runtime's own dispatch. This is
  // what makes the test a live-chain test rather than a direct registry call.
  const socket = new FakeSocket();
  const transport = new SocketEslTransport({
    host: 'freeswitch',
    port: 8021,
    password: 'secret',
    createSocket: () => socket as unknown as net.Socket,
  });
  const client = new EslClient({
    createTransport: () => transport,
    onRawEvent: raw => {
      const subclass = raw['Event-Subclass'];
      if (subclass) void runtime.handleRegistrationEvent(raw, subclass);
    },
    now: () => nowRef.value,
    setTimer: () => 0,
    clearTimer: () => {},
  });

  return {
    runtime,
    agents,
    sessions,
    sipRegistry,
    assignmentSource,
    extensionSource,
    nowRef,
    socket,
    client,
  };
}

/** Deliver a frame through the socket and let the async resolver settle. */
async function deliver(stack: ReturnType<typeof buildLiveStack>, frame: string): Promise<void> {
  stack.socket.emit('data', frame);
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

function provision(stack: ReturnType<typeof buildLiveStack>) {
  stack.agents.upsertAgent(TENANT, AGENT, USER, T0, { state: AgentState.AUTHENTICATING });
  stack.assignmentSource.set(TENANT, AGENT, [CAMPAIGN]);
  stack.extensionSource.add(extensionBinding());
  return stack.runtime.issueSession(TENANT, AGENT, USER)!;
}

function beat(session: { sessionId: string }, sequence: number) {
  return {
    tenantId: TENANT,
    agentId: AGENT,
    userId: USER,
    sessionId: session.sessionId,
    sequence,
    uiState: 'AVAILABLE',
  };
}

describe('live chain: raw sofia frame to agent capacity', () => {
  it('resolves identity from the database and makes the agent eligible', async () => {
    const stack = buildLiveStack();
    const session = provision(stack);
    await stack.client.start();

    // The frame carries only SIP identity — no tenant variable at all.
    const frame = sofiaFrame('sofia::register');
    expect(frame).not.toContain('hopwhistle_tenant_id');
    await deliver(stack, frame);

    // Tenant came back from the binding, not from the event.
    expect(stack.sipRegistry.isRegistered(TENANT, EXT)).toBe(true);
    expect(stack.runtime.status().registrationsResolved).toBe(1);

    const result = await stack.runtime.recordHeartbeat(beat(session, 1));
    expect(result.sipRegistered).toBe(true);
    expect(result.countedAsCapacity).toBe(true);

    await stack.runtime.runReconciliation();
    expect(stack.agents.capacity(TENANT, T0, CAMPAIGN).available).toBe(1);
  });

  it('removes eligibility immediately on unregister', async () => {
    const stack = buildLiveStack();
    const session = provision(stack);
    await stack.client.start();

    await deliver(stack, sofiaFrame('sofia::register'));
    await stack.runtime.recordHeartbeat(beat(session, 1));
    expect(stack.agents.capacity(TENANT, T0, CAMPAIGN).available).toBe(1);

    await deliver(stack, sofiaFrame('sofia::unregister'));
    await stack.runtime.runReconciliation();

    expect(stack.sipRegistry.isRegistered(TENANT, EXT)).toBe(false);
    expect(stack.agents.capacity(TENANT, T0, CAMPAIGN).available).toBe(0);
  });

  it('removes eligibility on expiry', async () => {
    const stack = buildLiveStack();
    const session = provision(stack);
    await stack.client.start();

    await deliver(stack, sofiaFrame('sofia::register'));
    await stack.runtime.recordHeartbeat(beat(session, 1));

    await deliver(stack, sofiaFrame('sofia::expire'));
    await stack.runtime.runReconciliation();

    expect(stack.sipRegistry.isRegistered(TENANT, EXT)).toBe(false);
    expect(stack.agents.capacity(TENANT, T0, CAMPAIGN).available).toBe(0);
  });

  it('does not create capacity from a registration failure', async () => {
    const stack = buildLiveStack();
    const session = provision(stack);
    await stack.client.start();

    await deliver(stack, sofiaFrame('sofia::register_failure'));
    const result = await stack.runtime.recordHeartbeat(beat(session, 1));

    expect(result.sipRegistered).toBe(false);
    expect(result.countedAsCapacity).toBe(false);
  });
});

describe('live chain: attribution failures are quarantined', () => {
  it('quarantines an unknown SIP identity', async () => {
    const stack = buildLiveStack();
    provision(stack);
    await stack.client.start();

    await deliver(stack, sofiaFrame('sofia::register', { username: '9999' }));

    expect(stack.runtime.status().registrationsResolved).toBe(0);
    expect(stack.runtime.status().registrationsQuarantined).toBe(1);
    expect(stack.runtime.status().lastRegistrationRejection).toBe('UNRESOLVED_SIP_IDENTITY');
    expect(stack.sipRegistry.isRegistered(TENANT, '9999')).toBe(false);
  });

  it('quarantines an ambiguous identity rather than picking one', async () => {
    const stack = buildLiveStack();
    provision(stack);
    // A second enabled binding on the same extension@domain.
    stack.extensionSource.add(extensionBinding({ agentId: 'agent-2', userId: 'user-2' }));
    await stack.client.start();

    await deliver(stack, sofiaFrame('sofia::register'));

    expect(stack.runtime.status().registrationsResolved).toBe(0);
    expect(stack.runtime.status().lastRegistrationRejection).toBe('AMBIGUOUS');
    expect(stack.sipRegistry.isRegistered(TENANT, EXT)).toBe(false);
  });

  it('rejects a cross-tenant collision', async () => {
    const stack = buildLiveStack();
    provision(stack);
    stack.extensionSource.add(extensionBinding({ tenantId: 'tenant-b', agentId: 'agent-9' }));
    await stack.client.start();

    await deliver(stack, sofiaFrame('sofia::register'));

    expect(stack.runtime.status().lastRegistrationRejection).toBe('CROSS_TENANT');
    expect(stack.sipRegistry.isRegistered(TENANT, EXT)).toBe(false);
    expect(stack.sipRegistry.isRegistered('tenant-b', EXT)).toBe(false);
  });

  it('quarantines a disabled extension', async () => {
    const stack = buildLiveStack();
    stack.agents.upsertAgent(TENANT, AGENT, USER, T0, { state: AgentState.AUTHENTICATING });
    stack.assignmentSource.set(TENANT, AGENT, [CAMPAIGN]);
    stack.extensionSource.add(extensionBinding({ enabled: false }));
    await stack.client.start();

    await deliver(stack, sofiaFrame('sofia::register'));

    expect(stack.runtime.status().lastRegistrationRejection).toBe('DISABLED');
    expect(stack.sipRegistry.isRegistered(TENANT, EXT)).toBe(false);
  });

  it('rejects a forged tenant variable that contradicts the binding', async () => {
    // The event claims tenant-b; the database says tenant-a. Neither answer is
    // safe, so the registration is refused rather than resolved to either.
    const stack = buildLiveStack();
    provision(stack);
    await stack.client.start();

    await deliver(
      stack,
      sofiaFrame('sofia::register', { variable_hopwhistle_tenant_id: 'tenant-b' })
    );

    expect(stack.runtime.status().registrationsForgedTenant).toBe(1);
    expect(stack.runtime.status().lastRegistrationRejection).toBe(
      'TENANT_VARIABLE_CONTRADICTS_BINDING'
    );
    expect(stack.sipRegistry.isRegistered(TENANT, EXT)).toBe(false);
    expect(stack.sipRegistry.isRegistered('tenant-b', EXT)).toBe(false);
  });

  it('accepts a tenant variable that agrees with the binding', async () => {
    const stack = buildLiveStack();
    provision(stack);
    await stack.client.start();

    await deliver(stack, sofiaFrame('sofia::register', { variable_hopwhistle_tenant_id: TENANT }));

    expect(stack.runtime.status().registrationsResolved).toBe(1);
    expect(stack.sipRegistry.isRegistered(TENANT, EXT)).toBe(true);
  });

  it('quarantines a frame with no SIP identity at all', async () => {
    const stack = buildLiveStack();
    provision(stack);
    await stack.client.start();

    const body = 'Event-Name: CUSTOM\nEvent-Subclass: sofia::register\nprofile_name: internal\n';
    await deliver(
      stack,
      `Content-Type: text/event-plain\nContent-Length: ${body.length}\n\n${body}`
    );

    expect(stack.runtime.status().lastRegistrationRejection).toBe('MISSING_SIP_IDENTITY');
  });
});

describe('registration events never reach the call ingestor', () => {
  it('does not create an observed call from a sofia frame', async () => {
    // The old dispatch fell through to the ingestor whenever attribution
    // failed, so an unattributable REGISTER became a phantom call event.
    const stack = buildLiveStack();
    provision(stack);
    await stack.client.start();

    await deliver(stack, sofiaFrame('sofia::register', { username: '9999' }));

    expect(stack.runtime.getCollector().metrics().trackedCalls).toBe(0);
    expect(stack.runtime.getIngestor().getMetrics().received).toBe(0);
  });
});
