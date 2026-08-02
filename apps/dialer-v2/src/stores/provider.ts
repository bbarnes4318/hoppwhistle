/**
 * Dialer V2 — store selection and real Redis health.
 *
 * Chooses Redis-backed or in-memory stores based on configuration, and — this
 * is the part that previously did not exist — reports the ACTUAL Redis
 * connection state. The runtime formerly passed `redisHealthy: true`
 * unconditionally into the pacing controller, which meant the controller's
 * "stop when Redis is unhealthy" hard stop could never fire. A safety gate that
 * cannot trigger is worse than no gate: it reads as protection in review while
 * providing none.
 */

import type { SessionRedis } from '../agents/session-store.js';
import type { DedupeStore, EventStore } from '../events/store.js';
import { InMemoryDedupeStore, InMemoryEventStore } from '../events/store.js';
import type { AgentSessionStore } from '../runtime/ports.js';
import type { ShadowDecisionStore } from '../shadow/engine.js';

import type { AgentStateRedis } from './agent-state-store.js';
import type { ChannelRedis } from './channel-ownership.js';
import {
  NoOpLock,
  RedisDistributedLock,
  type DistributedLock,
  type LockRedis,
} from './coordination.js';
import {
  FencedShadowDecisionStore,
  InMemoryFencedDecisionStore,
  type FencedRedis,
} from './fenced-decisions.js';
import type { ObservationRedis } from './observation-store.js';
import { RedisDedupeStore, type MinimalRedis } from './redis.js';
import type { SipStoreRedis } from './sip-store.js';

/**
 * The full client surface every Dialer V2 store needs.
 *
 * Composed from each store's own narrow interface rather than declared as one
 * list, so adding a command to a store is a compile error here rather than a
 * runtime `client.xyz is not a function` in a code path nobody exercised.
 */
export type DialerRedis = MinimalRedis &
  LockRedis &
  FencedRedis &
  SessionRedis &
  AgentStateRedis &
  SipStoreRedis &
  ChannelRedis &
  ObservationRedis;

export interface RedisConnection {
  client: DialerRedis;
  /** Live connection state, driven by the client's own events. */
  isHealthy(): boolean;
  disconnect(): Promise<void>;
}

export interface StoreBundle {
  eventStore: EventStore;
  dedupe: DedupeStore;
  shadowStore: ShadowDecisionStore;
  lock: DistributedLock;
  redisHealthy: () => boolean;
  /** What was actually selected, for the health surface. */
  backend: 'redis' | 'memory';
  /**
   * Whether decision writes are adjudicated against the campaign lock.
   *
   * Reported separately from `backend`. "Redis is connected" and "decisions are
   * fenced" are different facts, and the previous health surface conflated them:
   * `buildStores` returned an UNFENCED Redis store while the runtime passed
   * fencing tokens into it, so every token was silently discarded and the
   * health page said `storeBackend: 'redis'` the whole time.
   */
  decisionsFenced: boolean;
}

export interface BuildStoresOptions {
  connection?: RedisConnection | null;
  ownerId: string;
  /** Decision bucket width. Must match the shadow loop interval. */
  shadowIntervalMs: number;
  onFailure?: (operation: string, error: Error) => void;
  onDecisionRejection?: (rejection: string, tenantId: string, campaignId: string) => void;
}

/**
 * Build the store bundle.
 *
 * With no connection, everything is in-memory and `redisHealthy` reports
 * **false** — not "true because we are not using Redis". The controller then
 * hard-stops, which is the honest answer for a deployment that has not been
 * given the coordination it needs to guarantee no double-processing.
 *
 * Single-instance operation is still possible via
 * `DIALER_V2_ALLOW_MEMORY_STORES=true`, which reports healthy and uses the
 * no-op lock. That flag exists so the choice is explicit and visible in config
 * rather than implied by an absent environment variable.
 */
export function buildStores(options: BuildStoresOptions, env: NodeJS.ProcessEnv): StoreBundle {
  const allowMemory = env.DIALER_V2_ALLOW_MEMORY_STORES === 'true';

  if (!options.connection) {
    return {
      eventStore: new InMemoryEventStore(),
      dedupe: new InMemoryDedupeStore(),
      // Fenced in the only sense one process can be: monotonic tokens and
      // one decision per interval. It cannot verify lock ownership, so
      // `decisionsFenced` stays false and staging/production refuse it.
      shadowStore: new InMemoryFencedDecisionStore(options.shadowIntervalMs),
      lock: new NoOpLock(),
      redisHealthy: () => allowMemory,
      backend: 'memory',
      decisionsFenced: false,
    };
  }

  const connection = options.connection;
  const redis = connection.client;

  return {
    // Raw event bodies stay in memory: they are large, short-lived, and only
    // used for local forensics. Dedupe and decisions are what must be shared.
    eventStore: new InMemoryEventStore(),
    dedupe: new RedisDedupeStore({ redis, onFailure: options.onFailure }),
    // The FENCED store, not the plain one. The plain `RedisShadowDecisionStore`
    // ignores the fencing token entirely, so wiring it here meant the runtime
    // computed a token, passed it down, and had it dropped on the floor — the
    // race the token exists to close was open the whole time in the only
    // configuration that runs in production.
    shadowStore: new FencedShadowDecisionStore({
      redis,
      intervalMs: options.shadowIntervalMs,
      onFailure: options.onFailure,
      onRejection: (rejection, record) =>
        options.onDecisionRejection?.(rejection, record.tenantId, record.campaignId),
    }),
    lock: new RedisDistributedLock({
      redis,
      ownerId: options.ownerId,
      onFailure: options.onFailure,
    }),
    redisHealthy: () => connection.isHealthy(),
    backend: 'redis',
    decisionsFenced: true,
  };
}

/** Satisfied by any store bundle that can be used behind a load balancer. */
export function bundleIsDistributed(bundle: StoreBundle): boolean {
  return bundle.backend === 'redis' && bundle.decisionsFenced && bundle.lock.distributed;
}

/** Narrowing helper used by the composition root's staging/production gate. */
export function sessionsAreShared(sessions: AgentSessionStore): boolean {
  return sessions.backend === 'redis';
}

/**
 * Connect to Redis using `ioredis`, imported lazily so the module graph does not
 * require it when Redis is not configured.
 *
 * Health is driven by the client's own `ready`/`error`/`end` events rather than
 * by pinging on demand: a health check that issues a command would report
 * healthy right up until the moment it blocks.
 */
export async function connectRedis(
  url: string,
  onEvent?: (state: string, detail?: string) => void
): Promise<RedisConnection | null> {
  try {
    const { default: Redis } = (await import('ioredis')) as unknown as {
      default: new (
        url: string,
        opts: Record<string, unknown>
      ) => DialerRedis & {
        on(event: string, handler: (arg?: unknown) => void): void;
        quit(): Promise<unknown>;
        disconnect(): void;
      };
    };

    const client = new Redis(url, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
      lazyConnect: false,
    });

    let healthy = false;
    client.on('ready', () => {
      healthy = true;
      onEvent?.('ready');
    });
    client.on('error', (err?: unknown) => {
      healthy = false;
      onEvent?.('error', err instanceof Error ? err.message : String(err));
    });
    client.on('end', () => {
      healthy = false;
      onEvent?.('end');
    });

    return {
      client,
      isHealthy: () => healthy,
      disconnect: async () => {
        try {
          await client.quit();
        } catch {
          client.disconnect();
        }
      },
    };
  } catch (error) {
    onEvent?.('unavailable', error instanceof Error ? error.message : String(error));
    return null;
  }
}
