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

import type { DedupeStore, EventStore } from '../events/store.js';
import { InMemoryDedupeStore, InMemoryEventStore } from '../events/store.js';
import { InMemoryShadowDecisionStore, type ShadowDecisionStore } from '../shadow/engine.js';

import {
  NoOpLock,
  RedisDistributedLock,
  type DistributedLock,
  type LockRedis,
} from './coordination.js';
import { RedisDedupeStore, RedisShadowDecisionStore, type MinimalRedis } from './redis.js';

/** The full client surface these stores need. */
export type DialerRedis = MinimalRedis & LockRedis;

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
}

export interface BuildStoresOptions {
  connection?: RedisConnection | null;
  ownerId: string;
  onFailure?: (operation: string, error: Error) => void;
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
      shadowStore: new InMemoryShadowDecisionStore(),
      lock: new NoOpLock(),
      redisHealthy: () => allowMemory,
      backend: 'memory',
    };
  }

  const connection = options.connection;
  const redis = connection.client;

  return {
    // Raw event bodies stay in memory: they are large, short-lived, and only
    // used for local forensics. Dedupe and decisions are what must be shared.
    eventStore: new InMemoryEventStore(),
    dedupe: new RedisDedupeStore({ redis, onFailure: options.onFailure }),
    shadowStore: new RedisShadowDecisionStore({ redis, onFailure: options.onFailure }),
    lock: new RedisDistributedLock({
      redis,
      ownerId: options.ownerId,
      onFailure: options.onFailure,
    }),
    redisHealthy: () => connection.isHealthy(),
    backend: 'redis',
  };
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
