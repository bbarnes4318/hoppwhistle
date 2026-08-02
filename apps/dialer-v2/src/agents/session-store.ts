/**
 * Dialer V2 — Redis-backed agent sessions with hashed tokens.
 *
 * ── Why the in-memory registry was not enough ────────────────────────────────
 *
 * `AgentSessionRegistry` holds sessions in a `Map`. That is correct for one
 * process and wrong for every real deployment:
 *
 *  - Two API replicas each hold their own map, so a session minted on replica A
 *    is UNKNOWN_SESSION on replica B. Behind a load balancer the agent is
 *    logged out at random.
 *  - `isNewestForAgent` only sees the sessions its own replica issued, so the
 *    duplicate-tab check it exists to perform silently stops working — two tabs
 *    landing on different replicas are each "newest".
 *  - A restart drops every session, and with it every agent's replay window.
 *
 * ── Why the token is hashed ──────────────────────────────────────────────────
 *
 * The session token is a bearer credential: whoever holds it is the agent.
 * Storing it verbatim means anyone who can read the Redis keyspace — a `SCAN`,
 * a `MONITOR`, an RDB snapshot, a support dump, a slow-log entry — can
 * impersonate every logged-in agent. So Redis holds SHA-256 of the token and
 * nothing else. The plaintext is returned exactly once, at issue, and is never
 * written anywhere: not into a key, not into a value, not into a log line.
 *
 * Verification hashes the presented token and looks the digest up. A leaked
 * dump therefore yields digests, which are not credentials.
 *
 * ── Why validation is a Lua script ───────────────────────────────────────────
 *
 * Read-then-write over the network is not safe here. Two heartbeats racing
 * would both read the same `lastSequence`, both find their sequence acceptable,
 * and both write — which is precisely the replay the sequence exists to
 * prevent. The rate-limit window has the same problem. So every check and the
 * resulting update happen in one script, on the server.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { agentSessionIndexKey, agentSessionKey, isValidTenantId } from '../config/redis-keys.js';

import { SessionRejection, type AgentSession } from './sessions.js';

/**
 * Hash a session token for storage and lookup.
 *
 * SHA-256 with no salt and no stretching, deliberately. These are 256-bit
 * random tokens, not passwords: there is no dictionary to attack and no
 * low-entropy guess to slow down, and a per-token salt would make lookup by
 * digest impossible. The property needed is one-wayness, which this gives.
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** 256 bits. A bearer credential, not a display identifier. */
export function mintSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface SessionRedis {
  eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  hgetall(key: string): Promise<Record<string, string>>;
  del(...keys: string[]): Promise<number>;
  smembers(key: string): Promise<string[]>;
}

/**
 * KEYS[1] = session hash key
 * KEYS[2] = the agent's session index (a set of hashes)
 *
 * ARGV[1] = expected tenantId     ARGV[5] = rate window ms
 * ARGV[2] = expected agentId      ARGV[6] = max beats per window
 * ARGV[3] = presented sequence    ARGV[7] = max sequence jump
 * ARGV[4] = now (ms)
 *
 * Replies: 'OK' or one of the SessionRejection names. A rejection reply is the
 * whole answer — nothing is mutated on any path that rejects.
 */
export const VALIDATE_AND_ADVANCE = [
  'local s = redis.call("hgetall", KEYS[1])',
  'if #s == 0 then return "UNKNOWN_SESSION" end',
  'local f = {}',
  'for i = 1, #s, 2 do f[s[i]] = s[i + 1] end',
  '',
  'if f.revokedReason and f.revokedReason ~= "" then return "REVOKED" end',
  'if tonumber(ARGV[4]) >= tonumber(f.expiresAtMs) then return "EXPIRED" end',
  // A stolen token must not work against a different identity.
  'if f.tenantId ~= ARGV[1] then return "WRONG_TENANT" end',
  'if f.agentId ~= ARGV[2] then return "WRONG_AGENT" end',
  '',
  // Rate limit before sequence, so a flood cannot burn through the sequence
  // space and lock the real agent out of its own replay window.
  //
  // `windowStart` stays a string end to end. Lua 5.1 formats numbers with
  // %.14g, so a millisecond timestamp round-tripped through tostring() is one
  // digit of growth away from becoming "1.8e+12" and silently corrupting the
  // window.
  'local windowStart = f.windowStartedAtMs',
  'local windowCount = tonumber(f.windowCount)',
  'if tonumber(ARGV[4]) - tonumber(windowStart) > tonumber(ARGV[5]) then',
  '  windowStart = ARGV[4]',
  '  windowCount = 0',
  'end',
  'if windowCount >= tonumber(ARGV[6]) then return "RATE_LIMITED" end',
  '',
  'local last = tonumber(f.lastSequence)',
  'local seq = tonumber(ARGV[3])',
  'if seq <= last then return "REPLAYED_SEQUENCE" end',
  'if seq > last + tonumber(ARGV[7]) then return "SEQUENCE_TOO_FAR_AHEAD" end',
  '',
  'redis.call("hset", KEYS[1],',
  '  "lastSequence", ARGV[3],',
  '  "lastSeenAtMs", ARGV[4],',
  '  "windowStartedAtMs", windowStart,',
  '  "windowCount", tostring(windowCount + 1))',
  'redis.call("pexpireat", KEYS[1], tonumber(f.expiresAtMs))',
  'redis.call("pexpireat", KEYS[2], tonumber(f.expiresAtMs))',
  'return "OK"',
].join('\n');

/**
 * KEYS[1] = the new session hash key
 * KEYS[2] = the agent's session index
 *
 * ARGV[1] = session hash   ARGV[3] = expiresAtMs
 * ARGV[2] = JSON fields    ARGV[4] = max sessions per agent
 *
 * Returns the list of session hashes evicted for exceeding the cap, so the
 * caller can withdraw their capacity rather than leaving orphaned state.
 */
export const ISSUE_SESSION = [
  // Every value in this JSON is already a string on the JavaScript side, so
  // nothing here passes through Lua's number formatting. See the note in
  // VALIDATE_AND_ADVANCE.
  'local fields = cjson.decode(ARGV[2])',
  'local flat = {}',
  'for k, v in pairs(fields) do',
  '  table.insert(flat, k)',
  '  table.insert(flat, v)',
  'end',
  'redis.call("hset", KEYS[1], unpack(flat))',
  'redis.call("pexpireat", KEYS[1], tonumber(ARGV[3]))',
  // Ordered by issue time so "newest" and "oldest" are server-side facts, not
  // per-replica opinions.
  'redis.call("zadd", KEYS[2], tonumber(fields.issuedAtMs), ARGV[1])',
  'redis.call("pexpireat", KEYS[2], tonumber(ARGV[3]))',
  '',
  'local evicted = {}',
  'local cap = tonumber(ARGV[4])',
  'local total = redis.call("zcard", KEYS[2])',
  'if total > cap then',
  '  local extra = redis.call("zrange", KEYS[2], 0, total - cap - 1)',
  '  for _, hash in ipairs(extra) do',
  '    redis.call("zrem", KEYS[2], hash)',
  '    table.insert(evicted, hash)',
  '  end',
  'end',
  'return evicted',
].join('\n');

export interface RedisSessionStoreOptions {
  redis: SessionRedis;
  ttlMs?: number;
  maxBeatsPerWindow?: number;
  rateWindowMs?: number;
  maxSequenceJump?: number;
  maxSessionsPerAgent?: number;
  now?: () => number;
  mintToken?: () => string;
  onFailure?: (operation: string, error: Error) => void;
}

export interface IssuedSession {
  /** Returned to the caller once. Never stored, never logged. */
  token: string;
  sessionTokenHash: string;
  issuedAtMs: number;
  expiresAtMs: number;
  /** Sessions evicted for exceeding the per-agent cap. */
  evictedHashes: string[];
}

export interface RedisSessionValidation {
  ok: boolean;
  rejection?: SessionRejection;
  /** Present on success. Never contains the token. */
  session?: Omit<AgentSession, 'sessionId'> & { sessionTokenHash: string };
}

const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000;

export class RedisAgentSessionStore {
  /** Satisfies `AgentSessionStore`; reported through health. */
  readonly backend = 'redis' as const;
  private readonly ttlMs: number;
  private readonly maxBeatsPerWindow: number;
  private readonly rateWindowMs: number;
  private readonly maxSequenceJump: number;
  private readonly maxSessionsPerAgent: number;
  private readonly now: () => number;
  private readonly mintToken: () => string;

  constructor(private readonly options: RedisSessionStoreOptions) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxBeatsPerWindow = options.maxBeatsPerWindow ?? 30;
    this.rateWindowMs = options.rateWindowMs ?? 10_000;
    this.maxSequenceJump = options.maxSequenceJump ?? 1_000;
    this.maxSessionsPerAgent = options.maxSessionsPerAgent ?? 3;
    this.now = options.now ?? (() => Date.now());
    this.mintToken = options.mintToken ?? mintSessionToken;
  }

  /**
   * Mint a session for an ALREADY VERIFIED identity.
   *
   * This never derives a tenant or an agent from client input; the caller must
   * have established both before calling.
   */
  async issue(tenantId: string, agentId: string, userId: string): Promise<IssuedSession | null> {
    if (!isValidTenantId(tenantId) || !agentId) return null;

    const token = this.mintToken();
    const sessionTokenHash = hashSessionToken(token);
    const issuedAtMs = this.now();
    const expiresAtMs = issuedAtMs + this.ttlMs;

    try {
      const evicted = await this.options.redis.eval(
        ISSUE_SESSION,
        2,
        agentSessionKey(tenantId, sessionTokenHash),
        agentSessionIndexKey(tenantId, agentId),
        sessionTokenHash,
        // Stringified here, not in Lua: see the note on ISSUE_SESSION.
        JSON.stringify({
          tenantId,
          agentId,
          userId,
          issuedAtMs: String(issuedAtMs),
          expiresAtMs: String(expiresAtMs),
          lastSeenAtMs: String(issuedAtMs),
          lastSequence: '0',
          windowCount: '0',
          windowStartedAtMs: String(issuedAtMs),
          revokedReason: '',
        }),
        String(expiresAtMs),
        String(this.maxSessionsPerAgent)
      );

      const evictedHashes = Array.isArray(evicted) ? evicted.map(String) : [];
      // Evicted sessions are deleted, not left to expire: a session that is no
      // longer in the index but still resolvable would keep passing validation.
      if (evictedHashes.length > 0) {
        await this.options.redis.del(...evictedHashes.map(h => agentSessionKey(tenantId, h)));
      }

      return { token, sessionTokenHash, issuedAtMs, expiresAtMs, evictedHashes };
    } catch (error) {
      this.options.onFailure?.('session.issue', error as Error);
      // Fail closed. No session is better than one whose replay state is not
      // actually shared.
      return null;
    }
  }

  /**
   * Validate a presented token against a verified identity and a sequence.
   *
   * Every check and the resulting mutation happen inside one Lua script, so two
   * concurrent heartbeats cannot both pass the same sequence.
   */
  async validate(
    presentedToken: string,
    tenantId: string,
    agentId: string,
    sequence: number
  ): Promise<RedisSessionValidation> {
    if (typeof presentedToken !== 'string' || presentedToken.length === 0) {
      return { ok: false, rejection: SessionRejection.UNKNOWN_SESSION };
    }
    if (!isValidTenantId(tenantId) || !agentId) {
      return { ok: false, rejection: SessionRejection.WRONG_TENANT };
    }

    const sessionTokenHash = hashSessionToken(presentedToken);
    const nowMs = this.now();

    try {
      const reply = String(
        await this.options.redis.eval(
          VALIDATE_AND_ADVANCE,
          2,
          agentSessionKey(tenantId, sessionTokenHash),
          agentSessionIndexKey(tenantId, agentId),
          tenantId,
          agentId,
          String(sequence),
          String(nowMs),
          String(this.rateWindowMs),
          String(this.maxBeatsPerWindow),
          String(this.maxSequenceJump)
        )
      );

      if (reply !== 'OK') {
        return { ok: false, rejection: asRejection(reply) };
      }

      const session = await this.read(tenantId, sessionTokenHash);
      return session ? { ok: true, session } : { ok: true };
    } catch (error) {
      this.options.onFailure?.('session.validate', error as Error);
      // Fail closed: an unverifiable heartbeat grants no capacity.
      return { ok: false, rejection: SessionRejection.UNKNOWN_SESSION };
    }
  }

  private async read(
    tenantId: string,
    sessionTokenHash: string
  ): Promise<(Omit<AgentSession, 'sessionId'> & { sessionTokenHash: string }) | null> {
    const raw = await this.options.redis.hgetall(agentSessionKey(tenantId, sessionTokenHash));
    if (!raw || Object.keys(raw).length === 0) return null;

    return {
      sessionTokenHash,
      tenantId: raw.tenantId,
      agentId: raw.agentId,
      userId: raw.userId,
      issuedAtMs: Number(raw.issuedAtMs),
      expiresAtMs: Number(raw.expiresAtMs),
      lastSeenAtMs: Number(raw.lastSeenAtMs),
      lastSequence: Number(raw.lastSequence),
      windowCount: Number(raw.windowCount),
      windowStartedAtMs: Number(raw.windowStartedAtMs),
      revokedReason: raw.revokedReason ? raw.revokedReason : null,
    };
  }

  /**
   * Is this the newest live session for the agent, across the whole deployment?
   *
   * The in-memory registry could only answer for sessions its own replica
   * issued, which made the duplicate-tab check useless behind a load balancer.
   * The index is a sorted set in Redis, so this is a shared fact.
   */
  async isNewestForAgent(
    tenantId: string,
    agentId: string,
    sessionTokenHash: string
  ): Promise<boolean> {
    try {
      const newest = (await this.options.redis.eval(
        'return redis.call("zrevrange", KEYS[1], 0, 0)',
        1,
        agentSessionIndexKey(tenantId, agentId)
      )) as string[];
      return Array.isArray(newest) && newest[0] === sessionTokenHash;
    } catch (error) {
      this.options.onFailure?.('session.isNewestForAgent', error as Error);
      // Unknown ⇒ do not count as capacity. Over-counting an agent is what
      // causes over-dialling and abandoned calls.
      return false;
    }
  }

  async revoke(tenantId: string, sessionTokenHash: string, reason: string): Promise<boolean> {
    try {
      const result = await this.options.redis.eval(
        [
          'if redis.call("exists", KEYS[1]) == 0 then return 0 end',
          'local existing = redis.call("hget", KEYS[1], "revokedReason")',
          'if existing and existing ~= "" then return 0 end',
          'redis.call("hset", KEYS[1], "revokedReason", ARGV[1])',
          'return 1',
        ].join('\n'),
        1,
        agentSessionKey(tenantId, sessionTokenHash),
        reason || 'revoked'
      );
      return Number(result) === 1;
    } catch (error) {
      this.options.onFailure?.('session.revoke', error as Error);
      return false;
    }
  }

  /**
   * Revoke every live session for an agent. Used on logout and when an
   * identity is withdrawn.
   *
   * Revoking rather than deleting is deliberate: a deleted session validates as
   * UNKNOWN_SESSION, which is indistinguishable from a forged token, while a
   * revoked one reports REVOKED and tells an operator what actually happened.
   */
  async revokeAllForAgent(tenantId: string, agentId: string, reason: string): Promise<number> {
    const hashes = await this.hashesForAgent(tenantId, agentId);
    let revoked = 0;
    for (const hash of hashes) {
      if (await this.revoke(tenantId, hash, reason)) revoked++;
    }
    return revoked;
  }

  /**
   * Redis expires sessions itself via `PEXPIREAT`, so there is nothing for a
   * periodic sweep to do. Present so the runtime does not have to know which
   * implementation it is holding.
   */
  sweep(_nowMs: number): Promise<number> {
    return Promise.resolve(0);
  }

  /**
   * Live session count is not cheaply available without scanning the keyspace,
   * and a status endpoint is not worth a `SCAN`. Reported as -1 — "not
   * counted" — rather than 0, which would read as "no agent is signed in".
   */
  size(): Promise<number> {
    return Promise.resolve(-1);
  }

  /** Session hashes for an agent, oldest first. Never returns tokens. */
  async hashesForAgent(tenantId: string, agentId: string): Promise<string[]> {
    try {
      const members = (await this.options.redis.eval(
        'return redis.call("zrange", KEYS[1], 0, -1)',
        1,
        agentSessionIndexKey(tenantId, agentId)
      )) as string[];
      return Array.isArray(members) ? members.map(String) : [];
    } catch (error) {
      this.options.onFailure?.('session.hashesForAgent', error as Error);
      return [];
    }
  }
}

/**
 * Confirm a presented token matches a stored digest in constant time.
 *
 * Not needed for the Redis lookup — a hash table lookup on a digest leaks
 * nothing useful about a 256-bit token — but exported for callers that hold a
 * digest and want to compare without a timing signal.
 */
export function tokenMatchesHash(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashSessionToken(token), 'hex');
  let expected: Buffer;
  try {
    expected = Buffer.from(expectedHash, 'hex');
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function asRejection(reply: string): SessionRejection {
  const known = Object.values(SessionRejection) as string[];
  return known.includes(reply)
    ? (reply as SessionRejection)
    : // An unrecognised reply is a bug, and the safe reading of a bug in the
      // credential path is "not authenticated".
      SessionRejection.UNKNOWN_SESSION;
}
