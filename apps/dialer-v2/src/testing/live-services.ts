/**
 * Dialer V2 — connections to REAL services for the live test suites.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * The unit suites drive fake Redis and fake Prisma clients. Those fakes are
 * written by the same hand as the code under test, so they agree with it by
 * construction — including where both are wrong. A fake cannot tell you that
 * `redis.call('get', k)` returns `false` rather than `nil` for a missing key,
 * that `EVAL` coerces a Lua `-1` to an integer reply, that `PX` expiry is real
 * wall-clock, or that Prisma rejects a `null` on a non-nullable column.
 *
 * So the live suites connect to an actual Redis and an actual PostgreSQL, both
 * provided as GitHub Actions service containers.
 *
 * ── Skipping is not silent ───────────────────────────────────────────────────
 *
 * On a developer machine with no services running these suites skip, because
 * requiring every contributor to run two daemons to see a green checkout is not
 * a reasonable trade. In CI that would be indistinguishable from passing, so CI
 * sets `DIALER_V2_REQUIRE_LIVE_SERVICES=true`: with that set, an unreachable
 * service throws instead of skipping, and the job fails.
 *
 * A suite that quietly skips in CI is the same false green as a suite that
 * never ran.
 */

export const REQUIRE_LIVE = process.env.DIALER_V2_REQUIRE_LIVE_SERVICES === 'true';

/**
 * Database index 15, not 0.
 *
 * The live suites call FLUSHDB between tests. Deliberately keyed to a database
 * nothing else uses, so a misconfigured URL cannot wipe a real keyspace, and so
 * cleanup does not depend on ioredis's `keyPrefix` — which is applied to plain
 * commands but is not something to rely on for EVAL key arguments.
 */
export const REDIS_URL = process.env.DIALER_V2_TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/15';
export const DATABASE_URL = process.env.DIALER_V2_TEST_DATABASE_URL ?? '';

export interface LiveRedis {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: (string | number)[]): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  exists(key: string): Promise<number>;
  pttl(key: string): Promise<number>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  lpush(key: string, ...values: string[]): Promise<number>;
  ltrim(key: string, start: number, stop: number): Promise<unknown>;
  pexpire(key: string, ms: number): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  flushdb(): Promise<unknown>;
  incr(key: string): Promise<number>;
  hset(key: string, ...args: (string | number)[]): Promise<number>;
  hgetall(key: string): Promise<Record<string, string>>;
  quit(): Promise<unknown>;
  disconnect(): void;
}

export interface LiveHandle<T> {
  available: boolean;
  reason?: string;
  client: T;
}

/**
 * Connect to the live Redis, or report why not.
 *
 * `enableOfflineQueue: false` matters: without it ioredis buffers commands
 * against a dead server and the first failure surfaces as a test timeout rather
 * than a connection error.
 */
export async function connectLiveRedis(): Promise<LiveHandle<LiveRedis>> {
  try {
    const mod = (await import('ioredis')) as unknown as {
      default: new (
        url: string,
        opts: Record<string, unknown>
      ) => LiveRedis & {
        on(event: string, handler: (arg?: unknown) => void): void;
        ping(): Promise<string>;
      };
    };

    const client = new mod.default(REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 3_000,
      lazyConnect: true,
    });
    // Swallow async errors so an unreachable server surfaces at ping(), below,
    // rather than as an unhandled rejection that kills the whole run.
    client.on('error', () => {});

    await client.ping();
    return { available: true, client };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (REQUIRE_LIVE) {
      throw new Error(
        `DIALER_V2_REQUIRE_LIVE_SERVICES is set but Redis at ${REDIS_URL} is unreachable: ${reason}`
      );
    }
    return { available: false, reason, client: null as unknown as LiveRedis };
  }
}

/**
 * Empty the dedicated test database.
 *
 * Blunt on purpose: pattern deletion would have to know every key shape the
 * code under test writes, and a key it missed would leak into the next test as
 * a spurious duplicate-interval rejection.
 */
export async function flushTestDb(client: LiveRedis): Promise<void> {
  await client.flushdb();
}

/** Real elapsed time. Live tests must not fake clocks — TTL expiry is the point. */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * A Prisma client, imported dynamically and typed structurally.
 *
 * Dynamic so `apps/dialer-v2` keeps no build-time dependency on the API's
 * generated client — the production sources take a `DialerV2Db` interface for
 * exactly that reason. This is the one place that reaches for the real thing,
 * because a live database test that used anything else would be testing a
 * different query builder than production runs.
 */
export interface LivePrisma {
  $queryRawUnsafe<T = unknown>(sql: string, ...values: unknown[]): Promise<T>;
  $disconnect(): Promise<void>;
  tenant: {
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    deleteMany(args: { where: Record<string, unknown> }): Promise<unknown>;
  };
  user: {
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    findMany(args: {
      where: Record<string, unknown>;
      select: Record<string, boolean>;
    }): Promise<Array<Record<string, unknown>>>;
    deleteMany(args: { where: Record<string, unknown> }): Promise<unknown>;
  };
}

export async function connectLivePostgres(): Promise<LiveHandle<LivePrisma>> {
  const url = DATABASE_URL;
  try {
    if (!url) throw new Error('DIALER_V2_TEST_DATABASE_URL is not set');

    const mod = (await import('@prisma/client')) as unknown as {
      PrismaClient: new (opts: Record<string, unknown>) => LivePrisma;
    };
    const client = new mod.PrismaClient({ datasources: { db: { url } } });

    // Prove the connection AND that the schema was pushed. A client that
    // connects to an empty database would otherwise fail later, inside a test,
    // as something that reads like a logic bug.
    await client.$queryRawUnsafe('SELECT 1');
    await client.$queryRawUnsafe('SELECT 1 FROM users LIMIT 1');

    return { available: true, client };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (REQUIRE_LIVE) {
      throw new Error(
        `DIALER_V2_REQUIRE_LIVE_SERVICES is set but PostgreSQL is unusable: ${reason}`
      );
    }
    return { available: false, reason, client: null as unknown as LivePrisma };
  }
}
