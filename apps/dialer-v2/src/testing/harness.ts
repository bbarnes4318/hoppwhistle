/**
 * Dialer V2 — a runtime built from the port implementations, for tests.
 *
 * Every dependency is the in-memory implementation of a real port, not an
 * ad-hoc fake. That matters: a hand-written fake agrees with the code by
 * construction, so a test using one can pass while the contract is broken. The
 * memory ports implement the same revision and event-ordering rules as the
 * Redis ones, so a test that exercises optimistic concurrency here fails when
 * the rule is wrong rather than when the fake happens to disagree.
 *
 * What they CANNOT show is sharing — one object is trivially consistent with
 * itself — or Redis-specific semantics. Those claims live in the `.live.test.ts`
 * suites, against a real server.
 */

import { AssignmentResolver, StaticAssignmentSource } from '../agents/assignments.js';
import { ExtensionResolver, StaticExtensionSource } from '../agents/extension-resolver.js';
import { AgentStateService } from '../agents/service.js';
import { EnvFlagSource, type DialerV2Flags, type FlagSource } from '../config/flags.js';
import { InMemoryDedupeStore, InMemoryEventStore } from '../events/store.js';
import {
  MemoryAgentSessionStore,
  MemoryAgentStateRepository,
  MemoryChannelOwnershipRepository,
  MemorySipRegistrationRepository,
  type CampaignObservationRepository,
} from '../runtime/ports.js';
import {
  DialerV2Runtime,
  defaultRuntimeConfig,
  type RuntimeConfig,
  type RuntimeDeps,
} from '../runtime/service.js';
import { NoOpLock, type DistributedLock } from '../stores/coordination.js';
import { InMemoryFencedDecisionStore } from '../stores/fenced-decisions.js';
import type { ObservationCounters, ObservationSnapshot } from '../stores/observation-store.js';

/** A controllable clock, so every ageing assertion is exact rather than timed. */
export interface Clock {
  value: number;
  advance(ms: number): void;
}

export function clock(startMs = 1_700_000_000_000): Clock {
  return {
    value: startMs,
    advance(ms: number) {
      this.value += ms;
    },
  };
}

/** Flags with everything on, so a test opts OUT rather than in. */
export function permissiveFlags(overrides: Partial<DialerV2Flags> = {}): FlagSource {
  const flags: DialerV2Flags = {
    ...new EnvFlagSource({
      TENANT_DIALER_V2_ENABLED: 'true',
      TENANT_DIALER_V2_SHADOW_ENABLED: 'true',
    } as NodeJS.ProcessEnv).get(),
    enabled: true,
    shadowEnabled: true,
    ...overrides,
  };
  return { get: () => flags };
}

/** In-memory observations that keep the shape the controller reads. */
export class TestObservationRepository implements CampaignObservationRepository {
  readonly backend = 'memory' as const;
  readonly writes: Array<{ campaignId: string; eventAtMs: number }> = [];
  private readonly totals = new Map<string, Record<string, number>>();

  private key(tenantId: string, campaignId: string): string {
    return `${tenantId} ${campaignId}`;
  }

  applyEvent(
    tenantId: string,
    campaignId: string,
    eventAtMs: number,
    deltas: Partial<ObservationCounters>
  ): Promise<ObservationSnapshot | null> {
    this.writes.push({ campaignId, eventAtMs });
    const current = this.totals.get(this.key(tenantId, campaignId)) ?? {};
    for (const [field, delta] of Object.entries(deltas)) {
      if (typeof delta === 'number') current[field] = (current[field] ?? 0) + delta;
    }
    this.totals.set(this.key(tenantId, campaignId), current);
    return this.read(tenantId, campaignId);
  }

  read(tenantId: string, campaignId: string): Promise<ObservationSnapshot | null> {
    const raw = this.totals.get(this.key(tenantId, campaignId)) ?? {};
    const n = (f: string): number => raw[f] ?? 0;
    return Promise.resolve({
      attempts: n('attempts'),
      liveAnswers: n('liveAnswers'),
      abandons: n('abandons'),
      machineAnswers: n('machineAnswers'),
      busy: n('busy'),
      noAnswer: n('noAnswer'),
      failed: n('failed'),
      answerLatencySumMs: n('answerLatencySumMs'),
      answerLatencyCount: n('answerLatencyCount'),
      bridgeLatencySumMs: n('bridgeLatencySumMs'),
      bridgeLatencyCount: n('bridgeLatencyCount'),
      callDurationSumMs: n('callDurationSumMs'),
      callDurationCount: n('callDurationCount'),
      windowStartMs: 0,
      windowEndMs: 0,
      meanAnswerLatencyMs: 0,
      meanBridgeLatencyMs: 0,
      meanCallDurationMs: 0,
    });
  }
}

export interface Harness {
  runtime: DialerV2Runtime;
  clock: Clock;
  agents: AgentStateService;
  agentStore: MemoryAgentStateRepository;
  sessions: MemoryAgentSessionStore;
  sip: MemorySipRegistrationRepository;
  channels: MemoryChannelOwnershipRepository;
  observations: TestObservationRepository;
  shadowStore: InMemoryFencedDecisionStore;
  lock: DistributedLock;
  extensionSource: StaticExtensionSource;
  assignmentSource: StaticAssignmentSource;
  config: RuntimeConfig;
  audits: Array<Record<string, unknown>>;
  logs: Array<Record<string, unknown>>;
}

export function buildHarness(overrides: Partial<RuntimeDeps> = {}): Harness {
  const config = defaultRuntimeConfig({} as NodeJS.ProcessEnv);
  const now = clock();
  const agents = new AgentStateService();
  const agentStore = new MemoryAgentStateRepository();
  const sessions = new MemoryAgentSessionStore({ now: () => now.value });
  const sip = new MemorySipRegistrationRepository({ now: () => now.value });
  const channels = new MemoryChannelOwnershipRepository({ now: () => now.value });
  const observations = new TestObservationRepository();
  // The runtime always presents authority, so the store must be able to judge
  // it. Pairing the runtime with an unfenced store now throws by design.
  const shadowStore = new InMemoryFencedDecisionStore(config.shadowIntervalMs);
  const lock = new NoOpLock();
  const extensionSource = new StaticExtensionSource();
  const assignmentSource = new StaticAssignmentSource();

  const audits: Array<Record<string, unknown>> = [];
  const logs: Array<Record<string, unknown>> = [];

  const runtime = new DialerV2Runtime({
    flags: permissiveFlags(),
    eventStore: new InMemoryEventStore(),
    dedupe: new InMemoryDedupeStore(),
    shadowStore,
    agents,
    agentStore,
    sessions,
    assignments: new AssignmentResolver({ source: assignmentSource }),
    sip,
    observations,
    channels,
    extensions: new ExtensionResolver({ source: extensionSource }),
    lock,
    redisHealthy: () => true,
    onAudit: record => audits.push({ ...record }),
    config,
    now: () => now.value,
    // Timers never fire on their own: every loop is driven explicitly so a
    // test asserts what it triggered rather than what a scheduler happened to
    // run between assertions.
    setTimer: () => null,
    clearTimer: () => {},
    log: record => logs.push(record),
    ...overrides,
  });

  return {
    runtime,
    clock: now,
    agents,
    agentStore,
    sessions,
    sip,
    channels,
    observations,
    shadowStore,
    lock,
    extensionSource,
    assignmentSource,
    config,
    audits,
    logs,
  };
}

/** A raw sofia registration event, with controllable ordering fields. */
export function sofiaEvent(
  subclass: string,
  overrides: Record<string, string> = {}
): Record<string, string> {
  return {
    'Event-Name': 'CUSTOM',
    'Event-Subclass': subclass,
    // FreeSWITCH reports MICROseconds here.
    'Event-Date-Timestamp': String(1_700_000_000_000 * 1000),
    'Event-Sequence': '100',
    username: '1001',
    domain_name: 'sip.example.test',
    contact: '<sip:1001@10.0.0.5:5060>',
    'network-ip': '10.0.0.5',
    ...overrides,
  };
}
