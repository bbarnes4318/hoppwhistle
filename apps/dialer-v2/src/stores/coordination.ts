/**
 * Dialer V2 — distributed loop coordination.
 *
 * The shadow and reconciliation loops must run once per interval across the
 * whole deployment, not once per replica. Two replicas both running the shadow
 * pass write two decisions per second per campaign, which makes the recorded
 * history — the thing Phase 3 gates on — meaningless. Two replicas both
 * reconciling can race a correction against the heartbeat that would have
 * cleared it.
 *
 * The lock is `SET key <owner> PX ttl NX`: acquire-or-fail in one atomic
 * operation. Release is a compare-and-delete so a slow holder cannot delete a
 * lock that has since been acquired by someone else.
 *
 * With no Redis configured, `NoOpLock` grants every acquisition. That is correct
 * for single-instance operation and is reported in health so nobody mistakes it
 * for distributed safety.
 */

import { globalKey, isValidTenantId, tenantNamespace } from '../config/redis-keys.js';

export interface LockRedis {
  set(
    key: string,
    value: string,
    mode: 'PX',
    ttlMs: number,
    condition: 'NX'
  ): Promise<string | null>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
}

export interface DistributedLock {
  /** True when this caller now holds the lock. */
  acquire(name: string, ttlMs: number): Promise<boolean>;
  release(name: string): Promise<void>;
  readonly distributed: boolean;
}

/**
 * Single-instance fallback. Every acquisition succeeds.
 *
 * `distributed` is false so health can say plainly that loop coordination is
 * not distributed, rather than implying a guarantee that is not being provided.
 */
export class NoOpLock implements DistributedLock {
  readonly distributed = false;

  acquire(): Promise<boolean> {
    return Promise.resolve(true);
  }
  release(): Promise<void> {
    return Promise.resolve();
  }
}

export interface RedisLockOptions {
  redis: LockRedis;
  /** Identifies this replica. Used for compare-and-delete on release. */
  ownerId: string;
  /** Namespace: a tenant id, or undefined for a platform-wide lock. */
  tenantId?: string;
  onFailure?: (operation: string, error: Error) => void;
}

export class RedisDistributedLock implements DistributedLock {
  readonly distributed = true;
  private readonly held = new Set<string>();

  constructor(private readonly options: RedisLockOptions) {}

  private keyFor(name: string): string {
    if (this.options.tenantId && isValidTenantId(this.options.tenantId)) {
      return `${tenantNamespace(this.options.tenantId)}:lock:${name}`;
    }
    return `${globalKey('health').replace(/:health$/, '')}:lock:${name}`;
  }

  async acquire(name: string, ttlMs: number): Promise<boolean> {
    try {
      const result = await this.options.redis.set(
        this.keyFor(name),
        this.options.ownerId,
        'PX',
        ttlMs,
        'NX'
      );
      const acquired = result === 'OK';
      if (acquired) this.held.add(name);
      return acquired;
    } catch (error) {
      this.options.onFailure?.('lock.acquire', error as Error);
      // Fail closed. If coordination cannot be established, this replica does
      // not run the loop: skipping a shadow pass costs one second of history,
      // while running an uncoordinated one corrupts it.
      return false;
    }
  }

  async release(name: string): Promise<void> {
    if (!this.held.has(name)) return;
    this.held.delete(name);
    try {
      const key = this.keyFor(name);
      // Compare-and-delete: never delete a lock another replica now owns.
      const current = await this.options.redis.get(key);
      if (current === this.options.ownerId) {
        await this.options.redis.del(key);
      }
    } catch (error) {
      this.options.onFailure?.('lock.release', error as Error);
      // The TTL is the backstop — an unreleased lock expires on its own.
    }
  }
}
