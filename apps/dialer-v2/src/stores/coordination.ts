/**
 * Dialer V2 — distributed loop coordination.
 *
 * The shadow and reconciliation loops must run once per interval across the
 * whole deployment, not once per replica. Two replicas both running the shadow
 * pass write two decisions per second per campaign, which makes the recorded
 * history — the thing Phase 3 gates on — meaningless.
 *
 * ── Why release is a Lua script ──────────────────────────────────────────────
 *
 * An earlier version did GET then DEL. That is a real race:
 *
 *   1. owner A reads its own value
 *   2. A's lock expires
 *   3. owner B acquires the lock
 *   4. A executes DEL and deletes B's valid lock
 *
 * Both replicas then run the same pass. The compare and the delete have to be
 * one operation, so both are done in a Lua script that Redis executes atomically.
 *
 * ── Why there is a fencing token ─────────────────────────────────────────────
 *
 * A TTL sized for one interval is too short for a pass over many campaigns. The
 * holder therefore renews while it works, and carries a monotonic fencing token
 * so a holder that resumes after a long pause can detect that a newer owner has
 * taken over rather than acting on stale authority.
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
  /** Atomic compare-and-act. Required — GET-then-DEL is not safe. */
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
  incr(key: string): Promise<number>;
}

/** Delete the key only if it still holds our exact value. */
export const RELEASE_IF_OWNER = [
  "if redis.call('get', KEYS[1]) == ARGV[1] then",
  "  return redis.call('del', KEYS[1])",
  'end',
  'return 0',
].join('\n');

/** Extend the TTL only if the key still holds our exact value. */
export const RENEW_IF_OWNER = [
  "if redis.call('get', KEYS[1]) == ARGV[1] then",
  "  return redis.call('pexpire', KEYS[1], ARGV[2])",
  'end',
  'return 0',
].join('\n');

export interface LockHandle {
  /** Monotonic fencing token. A holder with a lower token is stale. */
  fencingToken: number;
  ownerId: string;
}

export interface DistributedLock {
  /** Returns a handle when acquired, null when the lock is held elsewhere. */
  acquire(name: string, ttlMs: number): Promise<LockHandle | null>;
  /** Extend the lock. Returns false once ownership has been lost. */
  renew(name: string, ttlMs: number): Promise<boolean>;
  release(name: string): Promise<void>;
  readonly distributed: boolean;
}

/**
 * Single-instance fallback. Every acquisition succeeds.
 *
 * `distributed` is false so health can say plainly that loop coordination is
 * not distributed, rather than implying a guarantee that is not provided.
 */
export class NoOpLock implements DistributedLock {
  readonly distributed = false;
  private token = 0;

  acquire(_name: string, _ttlMs: number): Promise<LockHandle | null> {
    this.token += 1;
    return Promise.resolve({ fencingToken: this.token, ownerId: 'single-instance' });
  }
  renew(_name: string, _ttlMs: number): Promise<boolean> {
    return Promise.resolve(true);
  }
  release(_name: string): Promise<void> {
    return Promise.resolve();
  }
}

export interface RedisLockOptions {
  redis: LockRedis;
  /** Identifies this replica. */
  ownerId: string;
  /** Namespace: a tenant id, or undefined for a platform-wide lock. */
  tenantId?: string;
  onFailure?: (operation: string, error: Error) => void;
}

export class RedisDistributedLock implements DistributedLock {
  readonly distributed = true;
  /** name → the exact value we wrote, so release compares against our own. */
  private readonly held = new Map<string, string>();

  constructor(private readonly options: RedisLockOptions) {}

  private keyFor(name: string): string {
    if (this.options.tenantId && isValidTenantId(this.options.tenantId)) {
      return `${tenantNamespace(this.options.tenantId)}:lock:${name}`;
    }
    return `${globalKey('health').replace(/:health$/, '')}:lock:${name}`;
  }

  private fenceKeyFor(name: string): string {
    return `${this.keyFor(name)}:fence`;
  }

  async acquire(name: string, ttlMs: number): Promise<LockHandle | null> {
    try {
      // Issued before the lock is taken and monotonic across the deployment, so
      // a holder resuming after a pause can tell it has been superseded.
      const fencingToken = await this.options.redis.incr(this.fenceKeyFor(name));
      // Stored value is owner+token, not just owner: two acquisitions by the
      // SAME replica must be distinguishable, or a slow first pass could
      // release the second pass's lock.
      const value = `${this.options.ownerId}:${fencingToken}`;

      const result = await this.options.redis.set(this.keyFor(name), value, 'PX', ttlMs, 'NX');
      if (result !== 'OK') return null;

      this.held.set(name, value);
      return { fencingToken, ownerId: this.options.ownerId };
    } catch (error) {
      this.options.onFailure?.('lock.acquire', error as Error);
      // Fail closed. If coordination cannot be established this replica does
      // not run the loop: skipping a pass costs one interval of history, while
      // running an uncoordinated one corrupts it.
      return null;
    }
  }

  async renew(name: string, ttlMs: number): Promise<boolean> {
    const value = this.held.get(name);
    if (!value) return false;
    try {
      const result = await this.options.redis.eval(
        RENEW_IF_OWNER,
        1,
        this.keyFor(name),
        value,
        String(ttlMs)
      );
      const renewed = Number(result) === 1;
      // Ownership lost — stop believing we hold it, so release cannot fire.
      if (!renewed) this.held.delete(name);
      return renewed;
    } catch (error) {
      this.options.onFailure?.('lock.renew', error as Error);
      this.held.delete(name);
      return false;
    }
  }

  async release(name: string): Promise<void> {
    const value = this.held.get(name);
    if (!value) return;
    this.held.delete(name);
    try {
      await this.options.redis.eval(RELEASE_IF_OWNER, 1, this.keyFor(name), value);
    } catch (error) {
      this.options.onFailure?.('lock.release', error as Error);
      // The TTL is the backstop — an unreleased lock expires on its own.
    }
  }
}
