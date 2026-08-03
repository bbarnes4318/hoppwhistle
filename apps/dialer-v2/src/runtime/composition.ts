/**
 * Dialer V2 — the composition root.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────
 *
 * Every durable implementation in this service — Redis sessions, Redis agent
 * state, Redis SIP registrations, rolling observations, the fenced decision
 * store, database extension resolution — was built and tested and then not
 * used, because `index.ts` went on constructing the in-memory ones:
 *
 *     const agents   = new AgentStateService()
 *     const sessions = new AgentSessionRegistry()
 *     const sipRegistry = new SipRegistrationRegistry()
 *     const assignmentSource = new StaticAssignmentSource()
 *     const extensionSource  = new StaticExtensionSource()
 *
 * Nothing in the codebase noticed, because nothing asserted which
 * implementations the running service actually holds. Wiring assembled by hand
 * at the top of an entrypoint is wiring nobody can test.
 *
 * So selection happens here, once, driven by an explicit mode, and it is
 * testable: `composeRuntime` is a function that returns the exact bundle
 * `index.ts` uses, and the composition tests build it the same way.
 *
 * ── Why staging and production refuse rather than degrade ────────────────────
 *
 * The dangerous failure is not "Redis is down" — that is loud. It is "Redis was
 * down at startup, so we quietly used memory, and everything looks fine." A
 * deployment in that state reports healthy, records shadow decisions, and
 * produces per-replica numbers that read exactly like real ones. Any promotion
 * decision taken on them is taken on nothing.
 *
 * In staging and production every required backend must be constructible. If one
 * is not, this throws. The entrypoint then serves liveness — so an orchestrator
 * does not restart-loop a service that is correctly refusing — and fails
 * readiness with the reason.
 */

import { AssignmentResolver, StaticAssignmentSource } from '../agents/assignments.js';
import {
  AssignmentLookupResult,
  AssignmentUnavailableReason,
  DatabaseAssignmentSource,
  DatabaseExtensionSource,
} from '../agents/db-sources.js';
import {
  ExtensionResolver,
  StaticExtensionSource,
  type ExtensionSource,
} from '../agents/extension-resolver.js';
import { AgentStateService } from '../agents/service.js';
import { RedisAgentSessionStore } from '../agents/session-store.js';
import { readPositiveInt } from '../config/env.js';
import { RedisAgentStateStore } from '../stores/agent-state-store.js';
import { RedisChannelOwnershipStore } from '../stores/channel-ownership.js';
import { RedisObservationStore, resolveWindow } from '../stores/observation-store.js';
import {
  buildStores,
  connectRedis,
  type RedisConnection,
  type StoreBundle,
} from '../stores/provider.js';
import { RedisSipRegistrationStore } from '../stores/sip-store.js';

import {
  AssignmentHealth,
  AssignmentLookupOutcome,
  type AssignmentHealthSnapshot,
} from './assignment-health.js';
import {
  MemoryAgentSessionStore,
  MemoryAgentStateRepository,
  MemoryChannelOwnershipRepository,
  MemorySipRegistrationRepository,
  type AgentSessionStore,
  type AgentStateRepository,
  type Backend,
  type CampaignObservationRepository,
  type ChannelOwnershipRepository,
  type SipRegistrationRepository,
} from './ports.js';
import {
  connectPostgres,
  describePostgresFailure,
  PostgresHealthMonitor,
  DEFAULT_PROBE_INTERVAL_MS,
  type PostgresConnectResult,
  type PostgresConnection,
  type PostgresFailure,
  type PostgresHealthSnapshot,
} from './postgres.js';

// Re-exported so callers and tests have one place to import the runtime's
// vocabulary from, rather than reaching into the modules behind it.
export {
  connectPostgres,
  PostgresFailure,
  describePostgresFailure,
  type PostgresConnection,
  type PostgresConnectResult,
  type PostgresHealthSnapshot,
} from './postgres.js';
export { AssignmentCapability, type AssignmentHealthSnapshot } from './assignment-health.js';

export enum RuntimeMode {
  /** Unit tests. Everything in memory, nothing shared, no network. */
  TEST = 'test',
  /** A single developer machine. Memory is allowed and clearly labelled. */
  DEVELOPMENT = 'development',
  STAGING = 'staging',
  PRODUCTION = 'production',
}

/** Modes where a memory or static implementation is a defect, not a choice. */
export function requiresSharedState(mode: RuntimeMode): boolean {
  return mode === RuntimeMode.STAGING || mode === RuntimeMode.PRODUCTION;
}

/**
 * Is a recognised test runner driving this process?
 *
 * Deliberately does NOT consult `NODE_ENV`. `NODE_ENV=test` is set by CI images,
 * task runners, shell profiles and Dockerfiles that have nothing to do with a
 * test process, and treating it as proof would hand the one mode that accepts
 * in-memory state to any environment that happened to be labelled that way.
 * These variables are injected by the runner itself and mean only one thing.
 */
export function isTestRunnerEnvironment(env: NodeJS.ProcessEnv): boolean {
  return (
    env.VITEST === 'true' ||
    env.VITEST_WORKER_ID !== undefined ||
    env.NODE_TEST_CONTEXT !== undefined
  );
}

/**
 * Resolve the runtime mode, refusing anything that is not exact.
 *
 * ── Why the previous default was unsafe ──────────────────────────────────────
 *
 * This used to lowercase the value and fall back to `TEST` for anything it did
 * not recognise. `TEST` sounds like the cautious choice, and as a *destination*
 * it is — it shares nothing and reaches nothing. As a *fallback* it is the
 * dangerous one, because of what it does to the mode that follows it:
 *
 *     DIALER_V2_RUNTIME_MODE=prodution   →   TEST
 *
 * `TEST` is precisely the mode where memory and static sources are permitted, so
 * a single transposed letter turns off every guard that staging and production
 * exist to enforce. The service then starts cleanly, reports healthy, resolves
 * agents from developer fixtures, and records per-replica shadow decisions that
 * read exactly like real ones. There is no error and nothing to notice.
 *
 * A typo must not select a mode. It must stop the process. Every mode is now
 * explicit, and an unrecognised value throws.
 *
 * ── Why the match is case-sensitive ──────────────────────────────────────────
 *
 * Surrounding whitespace is normalized, because a trailing newline out of a
 * secrets file is a transport artefact rather than a different value. Case is
 * not: `PRODUCTION` is not `production`, and accepting near-misses is how a
 * validator drifts back into guessing what was meant.
 */
export function readRuntimeMode(env: NodeJS.ProcessEnv): RuntimeMode {
  const raw = env.DIALER_V2_RUNTIME_MODE;

  if (raw === undefined || raw.trim() === '') {
    if (isTestRunnerEnvironment(env)) return RuntimeMode.TEST;
    throw new CompositionError(
      'unresolved',
      'DIALER_V2_RUNTIME_MODE must be set',
      `expected exactly one of ${ACCEPTED_MODES}; refusing to infer a mode, because inferring one wrongly selects which backends are permitted`
    );
  }

  const normalized = raw.trim();
  if (!(Object.values(RuntimeMode) as string[]).includes(normalized)) {
    // Echoing this one value is safe and useful: the variable holds a mode name
    // from a published set, never a credential, and seeing `prodution` back is
    // what makes the typo obvious. The numeric parser in config/env.ts takes the
    // opposite rule, because it is applied to arbitrary variables.
    throw new CompositionError(
      'unresolved',
      'DIALER_V2_RUNTIME_MODE is not a known mode',
      `got "${normalized}", expected exactly one of ${ACCEPTED_MODES}`
    );
  }

  return normalized as RuntimeMode;
}

const ACCEPTED_MODES = (Object.values(RuntimeMode) as string[]).map(m => `"${m}"`).join(', ');

export class CompositionError extends Error {
  constructor(
    /** `'unresolved'` when the failure is the mode itself. */
    readonly mode: RuntimeMode | 'unresolved',
    readonly requirement: string,
    detail: string
  ) {
    super(
      mode === 'unresolved'
        ? `Dialer V2 cannot start: ${requirement} — ${detail}`
        : `Dialer V2 cannot start in ${mode} mode: ${requirement} — ${detail}`
    );
    this.name = 'CompositionError';
  }
}

/**
 * Which implementation is actually behind each capability.
 *
 * Reported to health individually rather than as one `storeBackend` flag.
 * "Redis is connected" says nothing about whether SESSIONS are in Redis, and
 * the previous single flag let a deployment with in-memory sessions and
 * unfenced decisions describe itself as Redis-backed.
 */
export interface BackendReport {
  dedupeBackend: Backend;
  decisionBackend: Backend;
  decisionsFenced: boolean;
  sessionBackend: Backend;
  agentStateBackend: Backend;
  sipBackend: Backend;
  observationBackend: Backend;
  channelBackend: Backend;
  extensionSource: 'database' | 'static';
  assignmentSource: 'database' | 'static';
  lockBackend: 'redis' | 'noop';
}

export interface RuntimeComposition {
  mode: RuntimeMode;
  stores: StoreBundle;
  agents: AgentStateService;
  agentStore: AgentStateRepository;
  sessions: AgentSessionStore;
  sip: SipRegistrationRepository;
  observations: CampaignObservationRepository;
  channels: ChannelOwnershipRepository;
  extensions: ExtensionResolver;
  assignments: AssignmentResolver;
  backends: BackendReport;
  redisHealthy(): boolean;
  /** Whether PostgreSQL is usable *now*, not whether it once was. */
  postgresHealthy(): boolean;
  /** Full PostgreSQL health detail, or null when no database is configured. */
  postgresHealth(): PostgresHealthSnapshot | null;
  assignmentHealth(): AssignmentHealthSnapshot;
  /**
   * Can campaign assignments be resolved authoritatively right now?
   *
   * Not "has an assigned agent ever been seen" — see `assignment-health.ts` for
   * why those are different questions and why the old latch answered neither.
   */
  assignmentsResolvable(): boolean;
  /** Force a probe. Used by the outage tests to avoid waiting on the interval. */
  probePostgresNow(): Promise<boolean>;
  close(): Promise<void>;
}

export interface ComposeOptions {
  ownerId: string;
  shadowIntervalMs: number;
  log?: (record: Record<string, unknown>) => void;
  /** Injected by tests so composition can be exercised without real servers. */
  connectRedisImpl?: typeof connectRedis;
  connectPostgresImpl?: (url: string) => Promise<PostgresConnectResult>;
}

/**
 * Build the runtime's dependencies for a mode.
 *
 * Throws `CompositionError` in staging and production when a required backend
 * cannot be created. It never substitutes a memory implementation there.
 */
export async function composeRuntime(
  env: NodeJS.ProcessEnv,
  options: ComposeOptions
): Promise<RuntimeComposition> {
  const mode = readRuntimeMode(env);
  const log = options.log ?? (() => {});
  const strict = requiresSharedState(mode);

  const connectRedisFn = options.connectRedisImpl ?? connectRedis;
  const connectPostgresFn = options.connectPostgresImpl ?? connectPostgres;

  // ── Redis ────────────────────────────────────────────────────────────────
  const redisUrl = env.REDIS_URL;
  let redis: RedisConnection | null = null;

  if (redisUrl) {
    redis = await connectRedisFn(redisUrl, (state, detail) => log({ msg: 'redis', state, detail }));
  }
  if (strict && !redis) {
    throw new CompositionError(
      mode,
      'REDIS_URL must point at a reachable Redis',
      redisUrl ? 'connection failed' : 'REDIS_URL is not set'
    );
  }

  const stores = buildStores(
    {
      connection: redis,
      ownerId: options.ownerId,
      shadowIntervalMs: options.shadowIntervalMs,
      onFailure: (operation, error) =>
        log({ msg: 'redis failure', operation, error: error.message }),
      onDecisionRejection: (rejection, tenantId, campaignId) =>
        log({ msg: 'decision refused', rejection, tenantId, campaignId }),
    },
    env
  );

  if (strict && !stores.decisionsFenced) {
    throw new CompositionError(
      mode,
      'shadow decisions must be written through the fenced store',
      `decision backend is ${stores.backend}`
    );
  }
  if (strict && !stores.lock.distributed) {
    throw new CompositionError(
      mode,
      'loop coordination must be distributed',
      'the no-op lock permits two replicas to run the same pass'
    );
  }

  // ── PostgreSQL ───────────────────────────────────────────────────────────
  const databaseUrl = env.DATABASE_URL;
  let postgres: PostgresConnection | null = null;
  let postgresFailure: PostgresFailure | null = null;

  if (databaseUrl) {
    const result = await connectPostgresFn(databaseUrl);
    if (result.ok) {
      postgres = result.connection;
    } else {
      postgresFailure = result.category;
      // The category, not the underlying message. Prisma embeds the datasource
      // URL in its errors and the URL carries the password.
      log({ msg: 'postgres unavailable', category: result.category });
    }
  }
  if (strict && !postgres) {
    throw new CompositionError(
      mode,
      'DATABASE_URL must point at a reachable PostgreSQL',
      postgresFailure ? describePostgresFailure(postgresFailure) : 'DATABASE_URL is not set'
    );
  }

  // Health that keeps asking, rather than a flag set once at startup. Created
  // as soon as there is a connection to probe, and started below only after
  // composition has otherwise succeeded — a monitor left running behind a failed
  // composition would keep a timer alive on a process that is refusing to serve.
  const probeIntervalMs =
    readPositiveInt(env, 'DIALER_V2_POSTGRES_PROBE_INTERVAL_MS') ?? DEFAULT_PROBE_INTERVAL_MS;

  const postgresMonitor: PostgresHealthMonitor | null = postgres
    ? new PostgresHealthMonitor({
        probe: () => postgres.probe(),
        intervalMs: probeIntervalMs,
        onTransition: (connected, category) => log({ msg: 'postgres health', connected, category }),
      })
    : null;
  // The startup probe already ran inside connectPostgres. Recording it rather
  // than re-running it keeps startup to one round trip.
  postgresMonitor?.markInitiallyConnected();

  // The SIP realm is deployment configuration — there is no per-user domain
  // column to read — so it has to be supplied and validated rather than
  // guessed. A wrong realm makes every registration fail to resolve, which
  // presents as "no agent is ever registered" with no error anywhere.
  const sipDomain = (env.DIALER_V2_SIP_DOMAIN ?? '').trim();
  if (strict && sipDomain.length === 0) {
    throw new CompositionError(
      mode,
      'DIALER_V2_SIP_DOMAIN must be set',
      'SIP identities cannot be resolved without the realm agents register against'
    );
  }

  // ── Sources ──────────────────────────────────────────────────────────────
  let extensionSource: ExtensionSource;
  let extensionBackend: 'database' | 'static';

  if (postgres && sipDomain.length > 0) {
    // Wrapped so every lookup reports into health. Real traffic is better
    // evidence than a probe — it finds an outage the moment it happens, where a
    // ten-second probe finds it up to ten seconds late — and a database-backed
    // lookup that throws must grant no capacity rather than resolve to nothing.
    extensionSource = reportingExtensionSource(
      new DatabaseExtensionSource({ db: postgres.db, sipDomain }),
      postgresMonitor
    );
    extensionBackend = 'database';
  } else if (strict) {
    throw new CompositionError(
      mode,
      'extension resolution must be database-backed',
      'the static fixture source resolves developer test data'
    );
  } else {
    extensionSource = new StaticExtensionSource();
    extensionBackend = 'static';
  }

  let assignmentSource;
  let assignmentBackend: 'database' | 'static';

  // Health is created before the source so the source can report into it from
  // its very first lookup. `databaseReachable` is a live read of the monitor,
  // not a snapshot: capability has to fall the moment the database does.
  const assignmentHealth = new AssignmentHealth({
    configured: postgres !== null,
    databaseReachable: () => postgresMonitor?.healthy() ?? false,
  });

  if (postgres) {
    assignmentSource = new DatabaseAssignmentSource({
      db: postgres.db,
      onUnavailable: (reason, detail) => {
        // The reason, never the detail: Prisma messages carry the datasource URL.
        log({ msg: 'assignment source unavailable', reason });
        // A query that errored is first-hand evidence the database is unusable,
        // and better evidence than a probe that has not run yet. A missing table
        // is not — the database answered perfectly well, it simply lacks the
        // migration — so that case deliberately leaves connectivity alone.
        if (reason === AssignmentUnavailableReason.LOOKUP_FAILED) {
          postgresMonitor?.recordQueryFailure(new Error(detail));
        }
      },
      onLookup: outcome => {
        assignmentHealth.recordLookup(
          outcome === AssignmentLookupResult.SUCCESS
            ? AssignmentLookupOutcome.SUCCESS
            : outcome === AssignmentLookupResult.SCHEMA_MISSING
              ? AssignmentLookupOutcome.SCHEMA_MISSING
              : AssignmentLookupOutcome.FAILED
        );
        postgresMonitor?.recordAssignmentLookup(outcome === AssignmentLookupResult.SUCCESS);
      },
    });
    assignmentBackend = 'database';
  } else if (strict) {
    throw new CompositionError(
      mode,
      'campaign assignment must be database-backed',
      'the static fixture source assigns developer test data'
    );
  } else {
    assignmentSource = new StaticAssignmentSource();
    assignmentBackend = 'static';
  }

  // ── State ────────────────────────────────────────────────────────────────
  const redisClient = redis?.client;

  const sessions: AgentSessionStore = redisClient
    ? new RedisAgentSessionStore({
        redis: redisClient,
        onFailure: (op, e) => log({ msg: 'session store failure', op, error: e.message }),
      })
    : new MemoryAgentSessionStore();

  const agentStore: AgentStateRepository = redisClient
    ? new RedisAgentStateStore({
        redis: redisClient,
        onFailure: (op, e) => log({ msg: 'agent store failure', op, error: e.message }),
      })
    : new MemoryAgentStateRepository();

  const sip: SipRegistrationRepository = redisClient
    ? new RedisSipRegistrationStore({
        redis: redisClient,
        onFailure: (op, e) => log({ msg: 'sip store failure', op, error: e.message }),
      })
    : new MemorySipRegistrationRepository();

  // Validated here rather than clamped inside the store, so a deployment that
  // asks for a window this service cannot provide fails at composition — the
  // same rule every other backend follows. `resolveWindow` throws on a bad
  // value; that is caught and reported as a CompositionError like the rest.
  let window: { bucketMs: number; bucketCount: number };
  try {
    window = resolveWindow(
      readPositiveInt(env, 'DIALER_V2_OBSERVATION_BUCKET_MS'),
      readPositiveInt(env, 'DIALER_V2_OBSERVATION_BUCKET_COUNT')
    );
  } catch (error) {
    throw new CompositionError(
      mode,
      'the observation window must be usable',
      (error as Error).message
    );
  }

  const observations: CampaignObservationRepository = redisClient
    ? new RedisObservationStore({
        redis: redisClient,
        bucketMs: window.bucketMs,
        bucketCount: window.bucketCount,
        onFailure: (op, e) => log({ msg: 'observation store failure', op, error: e.message }),
      })
    : new MemoryObservationRepository();

  const channels: ChannelOwnershipRepository = redisClient
    ? new RedisChannelOwnershipStore({
        redis: redisClient,
        onFailure: (op, e) => log({ msg: 'channel store failure', op, error: e.message }),
      })
    : new MemoryChannelOwnershipRepository();

  const backends: BackendReport = {
    dedupeBackend: stores.backend,
    decisionBackend: stores.backend,
    decisionsFenced: stores.decisionsFenced,
    sessionBackend: sessions.backend,
    agentStateBackend: agentStore.backend,
    sipBackend: sip.backend,
    observationBackend: observations.backend,
    channelBackend: channels.backend,
    extensionSource: extensionBackend,
    assignmentSource: assignmentBackend,
    lockBackend: stores.lock.distributed ? 'redis' : 'noop',
  };

  if (strict) {
    const memoryBacked = (Object.entries(backends) as Array<[string, unknown]>).filter(
      ([, value]) => value === 'memory' || value === 'static' || value === 'noop'
    );
    if (memoryBacked.length > 0) {
      throw new CompositionError(
        mode,
        'every backend must be shared',
        `${memoryBacked.map(([name]) => name).join(', ')} resolved to a single-instance implementation`
      );
    }
  }

  // Backend NAMES only. No URL, no credential, no host — a connection string in
  // a startup log is a credential in every log aggregator downstream.
  log({ msg: 'dialer-v2 composition', mode, ...backends });

  // Prove the assignment table exists now, rather than waiting for an agent to
  // log in and reveal it. A migration that was never applied here is a startup
  // fact; discovering it at the first login means capability reads "unknown"
  // through the whole window in which somebody could still have fixed it.
  if (postgres) {
    const schemaPresent = await assignmentHealth.probeSchema(postgres.db);
    if (!schemaPresent) {
      log({ msg: 'assignment schema probe failed', capability: assignmentHealth.capability() });
    }
  }

  const assignments = new AssignmentResolver({ source: assignmentSource });

  // Started only now — after every refusal above has had its chance to throw.
  postgresMonitor?.start();

  return {
    mode,
    stores,
    agents: new AgentStateService(),
    agentStore,
    sessions,
    sip,
    observations,
    channels,
    extensions: new ExtensionResolver({ source: extensionSource }),
    assignments,
    backends,
    redisHealthy: () => stores.redisHealthy(),
    postgresHealthy: () => postgresMonitor?.healthy() ?? false,
    postgresHealth: () => postgresMonitor?.snapshot() ?? null,
    assignmentHealth: () => assignmentHealth.snapshot(),
    assignmentsResolvable: () => assignmentHealth.resolvable(),
    probePostgresNow: async () => (await postgresMonitor?.probeNow()) ?? false,
    close: async () => {
      postgresMonitor?.stop();
      await redis?.disconnect();
      await postgres?.disconnect();
    },
  };
}

/**
 * Report every extension lookup into PostgreSQL health.
 *
 * The failure is rethrown rather than swallowed into an empty result. An empty
 * result means "this agent has no extension", which the resolver correctly
 * treats as no capacity — but so does a thrown error, and collapsing them would
 * make a database outage look like an unconfigured agent for as long as it
 * lasted. The caller sees the failure; health records it.
 */
function reportingExtensionSource(
  inner: ExtensionSource,
  monitor: PostgresHealthMonitor | null
): ExtensionSource {
  const report = async <T>(work: Promise<T>): Promise<T> => {
    try {
      const result = await work;
      monitor?.recordExtensionLookup(true);
      return result;
    } catch (error) {
      monitor?.recordExtensionLookup(false);
      monitor?.recordQueryFailure(error);
      throw error;
    }
  };

  return {
    byAgent: (tenantId, agentId) => report(inner.byAgent(tenantId, agentId)),
    bySipIdentity: (extension, sipDomain) => report(inner.bySipIdentity(extension, sipDomain)),
  };
}

/**
 * In-memory observations behind the async port.
 *
 * Kept private to this module: it exists so `development` and `test` can run,
 * and there is no legitimate reason for anything else to reach for it.
 */
class MemoryObservationRepository implements CampaignObservationRepository {
  readonly backend = 'memory' as const;
  private readonly counters = new Map<string, Record<string, number>>();

  private key(tenantId: string, campaignId: string): string {
    return `${tenantId} ${campaignId}`;
  }

  applyEvent(
    tenantId: string,
    campaignId: string,
    _eventAtMs: number,
    deltas: Record<string, number | undefined>
  ): Promise<ReturnType<typeof this.snapshot>> {
    const key = this.key(tenantId, campaignId);
    const current = this.counters.get(key) ?? {};
    for (const [field, delta] of Object.entries(deltas)) {
      if (typeof delta === 'number' && Number.isFinite(delta)) {
        current[field] = (current[field] ?? 0) + delta;
      }
    }
    this.counters.set(key, current);
    return Promise.resolve(this.snapshot(current));
  }

  read(tenantId: string, campaignId: string): Promise<ReturnType<typeof this.snapshot>> {
    return Promise.resolve(this.snapshot(this.counters.get(this.key(tenantId, campaignId)) ?? {}));
  }

  private snapshot(raw: Record<string, number>) {
    const n = (field: string): number => raw[field] ?? 0;
    const ratio = (sum: number, count: number): number => (count > 0 ? sum / count : 0);
    return {
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
      meanAnswerLatencyMs: ratio(n('answerLatencySumMs'), n('answerLatencyCount')),
      meanBridgeLatencyMs: ratio(n('bridgeLatencySumMs'), n('bridgeLatencyCount')),
      meanCallDurationMs: ratio(n('callDurationSumMs'), n('callDurationCount')),
    };
  }
}
