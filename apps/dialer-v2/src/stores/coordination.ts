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
 * ── Why acquisition is also a Lua script ─────────────────────────────────────
 *
 * The previous version did `INCR fence` and then `SET NX`. That advanced the
 * fence counter even when the lock was NOT granted, which is fatal once a write
 * has to prove it presents the LATEST issued token:
 *
 *   1. A acquires; fence = 7; lock = "A:7".
 *   2. B attempts to acquire. Its INCR moves the fence to 8. Its SET NX fails,
 *      so B holds nothing.
 *   3. A — still the legitimate, uninterrupted holder — presents token 7, which
 *      is no longer the latest. Its write is refused.
 *
 * A replica that never obtained the lock could therefore starve the replica that
 * did, simply by trying. So the counter is incremented inside the same script
 * that takes the lock, and only on the branch that succeeds. `EXISTS` followed
 * by `SET` is safe here precisely because Redis runs the whole script without
 * interleaving.
 *
 * ── Why the value is owner AND token ─────────────────────────────────────────
 *
 * The stored value is `{ownerId}:{token}`, not just the owner. Two acquisitions
 * by the SAME replica must be distinguishable, or a slow first pass could
 * release — or write under — the second pass's lock.
 */

import {
  campaignShadowFenceKey,
  campaignShadowLockKey,
  globalLockFenceKey,
  globalLockKey,
  type GlobalLockName,
} from '../config/redis-keys.js';

export interface LockRedis {
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
  /** Atomic compare-and-act. Required — GET-then-DEL is not safe. */
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

/**
 * A fully-built lock identity.
 *
 * Both keys are constructed by a validated builder in `redis-keys.ts`, never
 * assembled from caller strings here. That is what keeps a campaign id
 * containing a colon from addressing another campaign's lock.
 */
export interface LockDescriptor {
  key: string;
  fenceKey: string;
  /** For logs and metrics only. Never used to build a key. */
  label: string;
}

export function globalLock(name: GlobalLockName): LockDescriptor {
  return { key: globalLockKey(name), fenceKey: globalLockFenceKey(name), label: `global:${name}` };
}

export function campaignShadowLock(tenantId: string, campaignId: string): LockDescriptor {
  return {
    key: campaignShadowLockKey(tenantId, campaignId),
    fenceKey: campaignShadowFenceKey(tenantId, campaignId),
    label: 'campaign-shadow',
  };
}

/**
 * KEYS[1] = lock key, KEYS[2] = fence counter
 * ARGV[1] = ownerId, ARGV[2] = lock TTL ms, ARGV[3] = fence TTL ms
 *
 * Returns the granted fencing token, or 0 when the lock is held elsewhere.
 */
export const ACQUIRE_WITH_FENCE = [
  "if redis.call('exists', KEYS[1]) == 1 then return 0 end",
  "local token = redis.call('incr', KEYS[2])",
  // The counter outlives the lock by a wide margin so tokens stay monotonic
  // across an idle period. If it ever did expire and reset, the lock-ownership
  // check below is still the binding one — a reset token cannot match a lock
  // value that no longer exists.
  "redis.call('pexpire', KEYS[2], tonumber(ARGV[3]))",
  "redis.call('set', KEYS[1], ARGV[1] .. ':' .. token, 'PX', tonumber(ARGV[2]))",
  'return token',
].join('\n');

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
  /**
   * The exact string stored in the lock key.
   *
   * Carried on the handle so a downstream write can present it verbatim and
   * have Redis compare it against what the lock key holds AT THE MOMENT OF THE
   * WRITE. Reconstructing it at the call site would let a formatting difference
   * turn a genuine ownership check into a string-equality accident.
   */
  lockValue: string;
}

export interface DistributedLock {
  /** Returns a handle when acquired, null when the lock is held elsewhere. */
  acquire(lock: LockDescriptor, ttlMs: number): Promise<LockHandle | null>;
  /** Extend the lock. Returns false once ownership has been lost. */
  renew(lock: LockDescriptor, ttlMs: number): Promise<boolean>;
  release(lock: LockDescriptor): Promise<void>;
  readonly distributed: boolean;
}

/**
 * Single-instance fallback. Every acquisition succeeds.
 *
 * `distributed` is false so health can say plainly that loop coordination is
 * not distributed, rather than implying a guarantee that is not provided.
 * Staging and production refuse to build with this — see `composition.ts`.
 */
export class NoOpLock implements DistributedLock {
  readonly distributed = false;
  private token = 0;

  acquire(_lock: LockDescriptor, _ttlMs: number): Promise<LockHandle | null> {
    this.token += 1;
    return Promise.resolve({
      fencingToken: this.token,
      ownerId: 'single-instance',
      lockValue: `single-instance:${this.token}`,
    });
  }
  renew(_lock: LockDescriptor, _ttlMs: number): Promise<boolean> {
    return Promise.resolve(true);
  }
  release(_lock: LockDescriptor): Promise<void> {
    return Promise.resolve();
  }
}

export interface RedisLockOptions {
  redis: LockRedis;
  /** Identifies this replica. */
  ownerId: string;
  /**
   * How long the fence counter survives without an acquisition. Far longer than
   * any lock TTL, so tokens remain monotonic across quiet periods.
   */
  fenceTtlMs?: number;
  onFailure?: (operation: string, error: Error) => void;
}

const DEFAULT_FENCE_TTL_MS = 24 * 60 * 60 * 1000;

export class RedisDistributedLock implements DistributedLock {
  readonly distributed = true;
  /** key → the exact value we wrote, so release compares against our own. */
  private readonly held = new Map<string, string>();
  private readonly fenceTtlMs: number;

  constructor(private readonly options: RedisLockOptions) {
    this.fenceTtlMs = options.fenceTtlMs ?? DEFAULT_FENCE_TTL_MS;
  }

  async acquire(lock: LockDescriptor, ttlMs: number): Promise<LockHandle | null> {
    try {
      const token = Number(
        await this.options.redis.eval(
          ACQUIRE_WITH_FENCE,
          2,
          lock.key,
          lock.fenceKey,
          this.options.ownerId,
          String(ttlMs),
          String(this.fenceTtlMs)
        )
      );
      if (!Number.isFinite(token) || token <= 0) return null;

      const lockValue = `${this.options.ownerId}:${token}`;
      this.held.set(lock.key, lockValue);
      return { fencingToken: token, ownerId: this.options.ownerId, lockValue };
    } catch (error) {
      this.options.onFailure?.('lock.acquire', error as Error);
      // Fail closed. If coordination cannot be established this replica does
      // not run the loop: skipping a pass costs one interval of history, while
      // running an uncoordinated one corrupts it.
      return null;
    }
  }

  async renew(lock: LockDescriptor, ttlMs: number): Promise<boolean> {
    const value = this.held.get(lock.key);
    if (!value) return false;
    try {
      const result = await this.options.redis.eval(
        RENEW_IF_OWNER,
        1,
        lock.key,
        value,
        String(ttlMs)
      );
      const renewed = Number(result) === 1;
      // Ownership lost — stop believing we hold it, so release cannot fire.
      if (!renewed) this.held.delete(lock.key);
      return renewed;
    } catch (error) {
      this.options.onFailure?.('lock.renew', error as Error);
      this.held.delete(lock.key);
      return false;
    }
  }

  async release(lock: LockDescriptor): Promise<void> {
    const value = this.held.get(lock.key);
    if (!value) return;
    this.held.delete(lock.key);
    try {
      await this.options.redis.eval(RELEASE_IF_OWNER, 1, lock.key, value);
    } catch (error) {
      this.options.onFailure?.('lock.release', error as Error);
      // The TTL is the backstop — an unreleased lock expires on its own.
    }
  }
}
