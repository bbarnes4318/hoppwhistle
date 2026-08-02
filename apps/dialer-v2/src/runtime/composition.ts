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
  DatabaseAssignmentSource,
  DatabaseExtensionSource,
  type DialerV2Db,
} from '../agents/db-sources.js';
import {
  ExtensionResolver,
  StaticExtensionSource,
  type ExtensionSource,
} from '../agents/extension-resolver.js';
import { AgentStateService } from '../agents/service.js';
import { RedisAgentSessionStore } from '../agents/session-store.js';
import { RedisAgentStateStore } from '../stores/agent-state-store.js';
import { RedisChannelOwnershipStore } from '../stores/channel-ownership.js';
import { RedisObservationStore } from '../stores/observation-store.js';
import {
  buildStores,
  connectRedis,
  type RedisConnection,
  type StoreBundle,
} from '../stores/provider.js';
import { RedisSipRegistrationStore } from '../stores/sip-store.js';

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

export function readRuntimeMode(env: NodeJS.ProcessEnv): RuntimeMode {
  const raw = (env.DIALER_V2_RUNTIME_MODE ?? '').trim().toLowerCase();
  const known = Object.values(RuntimeMode) as string[];
  if (known.includes(raw)) return raw as RuntimeMode;
  // An unset or unrecognised mode is TEST, the most restrictive option: it
  // shares nothing and reaches nothing. Defaulting to PRODUCTION would make a
  // typo in a deployment variable silently arm the real backends; defaulting to
  // DEVELOPMENT would make it silently accept memory in a real deployment.
  return RuntimeMode.TEST;
}

export class CompositionError extends Error {
  constructor(
    readonly mode: RuntimeMode,
    readonly requirement: string,
    detail: string
  ) {
    super(`Dialer V2 cannot start in ${mode} mode: ${requirement} — ${detail}`);
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
  postgresHealthy(): boolean;
  /** True once assignment resolution can name campaigns for an agent. */
  assignmentsResolvable(): boolean;
  close(): Promise<void>;
}

/** A live PostgreSQL handle. Narrow on purpose — this service only reads. */
export interface PostgresConnection {
  db: DialerV2Db;
  isHealthy(): boolean;
  disconnect(): Promise<void>;
}

export interface ComposeOptions {
  ownerId: string;
  shadowIntervalMs: number;
  log?: (record: Record<string, unknown>) => void;
  /** Injected by tests so composition can be exercised without real servers. */
  connectRedisImpl?: typeof connectRedis;
  connectPostgresImpl?: (url: string) => Promise<PostgresConnection | null>;
}

/**
 * Connect to PostgreSQL through the API's generated Prisma client.
 *
 * Imported lazily so the module graph does not require `@prisma/client` in a
 * mode that never touches a database.
 */
export async function connectPostgres(url: string): Promise<PostgresConnection | null> {
  try {
    const mod = (await import('@prisma/client')) as unknown as {
      PrismaClient: new (opts: Record<string, unknown>) => DialerV2Db & {
        $queryRawUnsafe(sql: string): Promise<unknown>;
        $disconnect(): Promise<void>;
      };
    };

    const client = new mod.PrismaClient({ datasources: { db: { url } } });

    // A connection that has not executed anything has not proved anything. This
    // is the difference between "the client object exists" and "this database
    // is reachable and has the table extension resolution reads".
    await client.$queryRawUnsafe('SELECT 1 FROM users LIMIT 1');

    let healthy = true;
    return {
      db: client,
      isHealthy: () => healthy,
      disconnect: async () => {
        healthy = false;
        await client.$disconnect();
      },
    };
  } catch {
    // The caller decides whether this is fatal. It is, in staging and production.
    return null;
  }
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

  if (databaseUrl) postgres = await connectPostgresFn(databaseUrl);
  if (strict && !postgres) {
    throw new CompositionError(
      mode,
      'DATABASE_URL must point at a reachable PostgreSQL',
      databaseUrl ? 'connection failed or the users table is absent' : 'DATABASE_URL is not set'
    );
  }

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
    extensionSource = new DatabaseExtensionSource({ db: postgres.db, sipDomain });
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

  if (postgres) {
    assignmentSource = new DatabaseAssignmentSource({ db: postgres.db });
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

  const observations: CampaignObservationRepository = redisClient
    ? new RedisObservationStore({
        redis: redisClient,
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

  let assignmentsWork = false;
  const assignments = new AssignmentResolver({
    source: {
      resolve: async (tenantId: string, agentId: string) => {
        const result = await assignmentSource.resolve(tenantId, agentId);
        if (result && result.campaignIds.length > 0) assignmentsWork = true;
        return result;
      },
    },
  });

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
    postgresHealthy: () => postgres?.isHealthy() ?? false,
    assignmentsResolvable: () => assignmentsWork,
    close: async () => {
      await redis?.disconnect();
      await postgres?.disconnect();
    },
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
