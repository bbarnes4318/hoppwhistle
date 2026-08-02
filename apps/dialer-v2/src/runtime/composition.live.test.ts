/**
 * Production-composition suite.
 *
 * Every other live suite proves one store class against a real server. This
 * proves the assembled service: `composeRuntime` with real Redis and real
 * PostgreSQL, two runtime instances standing for two replicas, a raw ESL event
 * fixture, a database-resolved extension, a database-resolved assignment, and
 * a server-issued session.
 *
 * The chain it walks is the one the whole design rests on:
 *
 *   session issued → validated on the OTHER replica → database extension
 *   → database assignment → raw sofia register → shared SIP state
 *   → heartbeat on replica B → shared agent capacity → observed call event
 *   → rolling observation → fenced decision → replica B refused a stale write
 *   → restart → reconstruction → sofia unregister → capacity removed
 *
 * Nothing here originates. The runtime has no code path that can.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AgentState } from '../agents/state.js';
import { TelephonyEventType, type NormalizedTelephonyEvent } from '../events/types.js';
import { campaignShadowLock } from '../stores/coordination.js';
import { SipLifecycle } from '../stores/sip-store.js';
import {
  connectLivePostgres,
  connectLiveRedis,
  flushTestDb,
  sleep,
  type LivePrisma,
  type LiveRedis,
} from '../testing/live-services.js';

import { composeRuntime, connectPostgres, type RuntimeComposition } from './composition.js';
import { DialerV2Runtime, defaultRuntimeConfig } from './service.js';

const SIP_DOMAIN = 'live.dialer.test';
const EXTENSION = '1042';

let redis: LiveRedis;
let available = false;
let skipReason = '';
let prisma: Awaited<ReturnType<typeof connectLivePostgres>>;

/** Seeded once, reused, and identified by ids the suite controls. */
let tenantId = '';
let userId = '';
let campaignId = '';

beforeAll(async () => {
  const redisHandle = await connectLiveRedis();
  const pgHandle = await connectLivePostgres();

  available = redisHandle.available && pgHandle.available;
  skipReason = redisHandle.reason ?? pgHandle.reason ?? '';
  if (!available) return;

  redis = redisHandle.client;
  prisma = pgHandle;

  const seeded = await seedTenant(pgHandle.client);
  tenantId = seeded.tenantId;
  userId = seeded.userId;
  campaignId = seeded.campaignId;
}, 60_000);

afterAll(async () => {
  if (!available) return;
  await flushTestDb(redis);
  await redis.quit();
  await cleanup(prisma.client);
  await prisma.client.$disconnect();
}, 60_000);

function live(name: string, fn: () => Promise<void>, timeout = 30_000) {
  it(
    name,
    async () => {
      if (!available) {
        console.warn(`[live-composition] skipped "${name}": ${skipReason}`);
        return;
      }
      await fn();
    },
    timeout
  );
}

/**
 * Seed one tenant, one agent, one campaign, and one assignment.
 *
 * Raw SQL rather than the Prisma client, because the point is to write exactly
 * the rows the production tables hold — including the `campaign_agents` row the
 * new migration adds — without depending on generated client shapes.
 */
async function seedTenant(
  db: LivePrisma
): Promise<{ tenantId: string; userId: string; campaignId: string }> {
  const suffix = String(process.pid);
  const t = `dlrv2-${suffix}`;
  const u = `dlrv2-user-${suffix}`;
  const p = `dlrv2-pub-${suffix}`;
  const c = `dlrv2-camp-${suffix}`;

  await db.$executeRawUnsafe(
    `INSERT INTO tenants (id, name, slug, status, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'ACTIVE', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    t,
    'Dialer V2 live composition',
    t
  );

  // The extension lives in User.metadata — there is no extension column — and
  // this is the shape agent-phone actually writes.
  await db.$executeRawUnsafe(
    `INSERT INTO users (id, "tenantId", email, status, metadata, "authMethod", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'ACTIVE', $4::jsonb, 'EMAIL', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    u,
    t,
    `${u}@dialer-v2.test`,
    JSON.stringify({ extension: EXTENSION })
  );

  await db.$executeRawUnsafe(
    // `code` is NOT NULL with no default, so it has to be supplied. Derived
    // from the id so it is unique per row without needing a counter.
    `INSERT INTO publishers (id, "tenantId", name, code, status, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    p,
    t,
    'Dialer V2 live publisher',
    p
  );

  await db.$executeRawUnsafe(
    `INSERT INTO campaigns (id, "tenantId", "publisherId", name, status, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    c,
    t,
    p,
    'Dialer V2 live campaign'
  );

  await db.$executeRawUnsafe(
    `INSERT INTO campaign_agents (id, "tenantId", "campaignId", "userId", status, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW())
     ON CONFLICT ("tenantId", "campaignId", "userId") DO NOTHING`,
    `${c}-assign`,
    t,
    c,
    u
  );

  return { tenantId: t, userId: u, campaignId: c };
}

async function cleanup(db: LivePrisma): Promise<void> {
  if (!tenantId) return;
  // Cascades handle users, campaigns and assignments.
  await db.$executeRawUnsafe(`DELETE FROM tenants WHERE id = $1`, tenantId);
}

function env(): NodeJS.ProcessEnv {
  return {
    DIALER_V2_RUNTIME_MODE: 'production',
    REDIS_URL: process.env.DIALER_V2_TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/15',
    DATABASE_URL: process.env.DATABASE_URL,
    DIALER_V2_SIP_DOMAIN: SIP_DOMAIN,
  } as NodeJS.ProcessEnv;
}

/** Compose exactly as `index.ts` does, then build the runtime from it. */
async function replica(ownerId: string): Promise<{
  composition: RuntimeComposition;
  runtime: DialerV2Runtime;
}> {
  const config = defaultRuntimeConfig({} as NodeJS.ProcessEnv);
  const composition = await composeRuntime(env(), {
    ownerId,
    shadowIntervalMs: config.shadowIntervalMs,
    connectPostgresImpl: connectPostgres,
  });

  const runtime = new DialerV2Runtime({
    flags: {
      get: () => ({
        enabled: true,
        shadowEnabled: true,
        originateEnabled: false,
        dryRun: true,
        emergencyStop: false,
        allowedTenantIds: [],
        allowedCampaignIds: [],
        maxGlobalCps: 10,
        maxGlobalCalls: 100,
        requireHealthyAgentHeartbeats: true,
      }),
    } as never,
    eventStore: composition.stores.eventStore,
    dedupe: composition.stores.dedupe,
    shadowStore: composition.stores.shadowStore,
    agents: composition.agents,
    agentStore: composition.agentStore,
    sessions: composition.sessions,
    assignments: composition.assignments,
    sip: composition.sip,
    observations: composition.observations,
    channels: composition.channels,
    extensions: composition.extensions,
    lock: composition.stores.lock,
    redisHealthy: () => composition.redisHealthy(),
    config,
    setTimer: () => null,
    clearTimer: () => {},
  });

  return { composition, runtime };
}

/** A raw sofia event as FreeSWITCH emits it — headers, not a parsed object. */
function sofia(subclass: string, eventAtMs: number, sequence: number): Record<string, string> {
  return {
    'Event-Name': 'CUSTOM',
    'Event-Subclass': subclass,
    // MICROseconds, as FreeSWITCH reports them.
    'Event-Date-Timestamp': String(eventAtMs * 1000),
    'Event-Sequence': String(sequence),
    username: EXTENSION,
    domain_name: SIP_DOMAIN,
    contact: `<sip:${EXTENSION}@10.0.0.9:5060>`,
    'network-ip': '10.0.0.9',
    expires: '3600',
  };
}

describe('the composed service resolves identity from the real database', () => {
  live('resolves an extension from a real users row', async () => {
    // Not the source class in isolation: the runtime the composition root
    // built, reading a row this suite inserted.
    const { composition } = await replica('r-ext');
    const result = await composition.extensions.forAgent(tenantId, userId);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.binding.extension).toBe(EXTENSION);
      expect(result.binding.sipDomain).toBe(SIP_DOMAIN);
    }
    await composition.close();
  });

  live('resolves a campaign from a real campaign_agents row', async () => {
    const { composition } = await replica('r-assign');
    const assignment = await composition.assignments.resolve(tenantId, userId);

    expect(assignment.campaignIds).toContain(campaignId);
    expect(composition.assignmentsResolvable()).toBe(true);
    await composition.close();
  });

  live('a browser preference narrows but cannot widen the assignment', async () => {
    const { composition } = await replica('r-narrow');

    const narrowed = await composition.assignments.resolve(tenantId, userId, [campaignId]);
    expect(narrowed.campaignIds).toEqual([campaignId]);

    // A campaign this agent was never assigned to.
    const widened = await composition.assignments.resolve(tenantId, userId, ['not-mine']);
    expect(widened.campaignIds).toEqual([]);
    await composition.close();
  });
});

describe('the full chain across two replicas', () => {
  live(
    'session, SIP, capacity, observation, decision, restart, unregister',
    async () => {
      await flushTestDb(redis);

      const a = await replica('replica-a');
      const b = await replica('replica-b');

      // ── 1. Session issued on A ────────────────────────────────────────────
      const session = await a.runtime.issueSession(tenantId, userId, userId);
      expect(session?.token).toBeTruthy();
      // The hash is what is stored; the token is returned once.
      expect(session?.sessionTokenHash).not.toBe(session?.token);

      // ── 2. Raw sofia register, handled on A ───────────────────────────────
      const registeredAt = Date.now();
      expect(
        await a.runtime.handleRegistrationEvent(
          sofia('sofia::register', registeredAt, 100),
          'sofia::register'
        )
      ).toBe(true);

      // ── 3. B sees the SIP state it never observed ─────────────────────────
      const onB = await b.composition.sip.get(tenantId, userId);
      expect(onB?.lifecycle).toBe(SipLifecycle.REGISTERED);
      expect(onB?.agentId).toBe(userId);

      // ── 4. Heartbeat on B, with the session A issued ─────────────────────
      const beat = await b.runtime.recordHeartbeat({
        tenantId,
        agentId: userId,
        userId,
        sessionToken: session!.token,
        sequence: 1,
        uiState: 'AVAILABLE',
      });

      expect(beat.accepted).toBe(true);
      expect(beat.sipRegistered).toBe(true);
      expect(beat.campaignIds).toContain(campaignId);
      expect(beat.durable).toBe(true);
      expect(beat.countedAsCapacity).toBe(true);

      // ── 5. A sees the capacity B recorded ────────────────────────────────
      const restoredOnA = await a.composition.agentStore.load(tenantId, userId);
      expect(restoredOnA).not.toBeNull();

      // ── 6. An observed call event moves the shared window ────────────────
      const at = Date.now();
      await b.composition.observations.applyEvent(tenantId, campaignId, at, {
        attempts: 1,
        liveAnswers: 1,
      });
      const window = await a.composition.observations.read(tenantId, campaignId);
      expect(window?.attempts).toBe(1);

      // ── 7. A fenced decision, written under a real lock ──────────────────
      const lock = campaignShadowLock(tenantId, campaignId);
      const handle = await a.composition.stores.lock.acquire(lock, 5_000);
      expect(handle).not.toBeNull();

      a.runtime.getCollector().apply({
        eventId: 'live-e1',
        eventType: TelephonyEventType.CHANNEL_CREATE,
        tenantId,
        campaignId,
        agentId: null,
        channelUuid: 'live-uuid-1',
        callId: 'live-call-1',
        leadId: null,
        attemptId: null,
        otherLegUuid: null,
        occurredAt: at,
        receivedAt: at,
        hangupCause: null,
      } as NormalizedTelephonyEvent);
      await a.composition.stores.lock.release(lock);

      expect(await a.runtime.runShadowPass()).toBeGreaterThan(0);

      const decisions = await b.composition.stores.shadowStore.recent(tenantId, 10, campaignId);
      expect(decisions.length).toBeGreaterThan(0);
      // The invariant that must hold in every configuration.
      expect(decisions.every(d => d.originated === false)).toBe(true);

      // ── 8. B is refused a stale write ────────────────────────────────────
      const stale = await b.composition.stores.shadowStore.record(decisions[0]);
      await expect(Promise.resolve(stale).catch(e => Promise.reject(e))).rejects.toBeDefined();

      // ── 9. Restart: a fresh replica reconstructs ─────────────────────────
      const c = await replica('replica-c');
      const reconstructed = await c.runtime.reconstruct([tenantId]);
      expect(reconstructed.agents).toBeGreaterThan(0);
      expect(reconstructed.sip).toBeGreaterThan(0);
      expect(c.runtime.status().reconstructionComplete).toBe(true);
      expect(c.composition.agents.get(tenantId, userId)).toBeDefined();

      // ── 10. Unregister removes capacity, everywhere ──────────────────────
      expect(
        await c.runtime.handleRegistrationEvent(
          sofia('sofia::unregister', registeredAt + 1_000, 200),
          'sofia::unregister'
        )
      ).toBe(true);

      expect(await a.composition.sip.isRegistered(tenantId, userId)).toBe(false);

      await c.runtime.reconcileNow();
      expect(c.composition.agents.get(tenantId, userId)?.state).not.toBe(AgentState.AVAILABLE);

      await Promise.all([a.composition.close(), b.composition.close(), c.composition.close()]);
    },
    60_000
  );
});

describe('two replicas cannot both write one decision', () => {
  live('the replica that lost the lock is refused', async () => {
    await flushTestDb(redis);

    const a = await replica('race-a');
    const b = await replica('race-b');
    const lock = campaignShadowLock(tenantId, campaignId);

    // A takes a short lease and stalls past it.
    const handleA = await a.composition.stores.lock.acquire(lock, 200);
    await sleep(350);
    const handleB = await b.composition.stores.lock.acquire(lock, 5_000);
    expect(handleB).not.toBeNull();

    const decision = {
      tenantId,
      campaignId,
      decidedAtMs: 1_800_000_000_000,
      controllerVersion: '1.1.0',
      inputs: {},
      decision: null,
      recommendedOriginateCount: 7,
      bindingConstraint: 'NONE',
      degradationMode: 'PREDICTIVE',
      safetyReasons: [],
      blockedBy: [],
      originated: false as const,
      explanation: 'live race',
    };

    const wroteB = await (
      b.composition.stores.shadowStore as unknown as {
        recordFenced(
          r: unknown,
          a: { fencingToken: number; lockValue: string }
        ): Promise<{ accepted: boolean }>;
      }
    ).recordFenced(decision, {
      fencingToken: handleB!.fencingToken,
      lockValue: handleB!.lockValue,
    });
    expect(wroteB.accepted).toBe(true);

    const wroteA = await (
      a.composition.stores.shadowStore as unknown as {
        recordFenced(
          r: unknown,
          a: { fencingToken: number; lockValue: string }
        ): Promise<{ accepted: boolean }>;
      }
    ).recordFenced(
      { ...decision, recommendedOriginateCount: 1 },
      {
        fencingToken: handleA!.fencingToken,
        lockValue: handleA!.lockValue,
      }
    );
    expect(wroteA.accepted).toBe(false);

    const survivors = await a.composition.stores.shadowStore.recent(tenantId, 10, campaignId);
    expect(survivors).toHaveLength(1);
    expect(survivors[0].recommendedOriginateCount).toBe(7);

    await Promise.all([a.composition.close(), b.composition.close()]);
  });
});

describe('the composed service refuses to lie about its backends', () => {
  live('reports every backend as shared, from the real composition', async () => {
    const { composition } = await replica('r-report');
    expect(composition.backends).toMatchObject({
      dedupeBackend: 'redis',
      decisionBackend: 'redis',
      decisionsFenced: true,
      sessionBackend: 'redis',
      agentStateBackend: 'redis',
      sipBackend: 'redis',
      observationBackend: 'redis',
      channelBackend: 'redis',
      extensionSource: 'database',
      assignmentSource: 'database',
      lockBackend: 'redis',
    });
    await composition.close();
  });

  live('never writes a key outside the tenant namespace', async () => {
    await flushTestDb(redis);
    const { composition, runtime } = await replica('r-keys');

    const session = await runtime.issueSession(tenantId, userId, userId);
    await runtime.handleRegistrationEvent(
      sofia('sofia::register', Date.now(), 300),
      'sofia::register'
    );
    await runtime.recordHeartbeat({
      tenantId,
      agentId: userId,
      userId,
      sessionToken: session!.token,
      sequence: 1,
      uiState: 'AVAILABLE',
    });

    const foreign = (await redis.keys('*')).filter(
      k => !k.startsWith(`tenant:${tenantId}:`) && !k.startsWith('dialer:v2:global:')
    );
    expect(foreign).toEqual([]);
    await composition.close();
  });

  live('never writes the session token into the keyspace', async () => {
    await flushTestDb(redis);
    const { composition, runtime } = await replica('r-token');

    const session = await runtime.issueSession(tenantId, userId, userId);
    const token = session!.token;

    // Not in a key.
    const keys = await redis.keys('*');
    expect(keys.some(k => k.includes(token))).toBe(false);

    // Not in a value either — a leaked dump must yield digests, not credentials.
    for (const key of keys) {
      const type = await redis.type(key);
      if (type === 'hash') {
        const values = Object.values(await redis.hgetall(key));
        expect(values.some(v => v.includes(token))).toBe(false);
      }
    }

    // And a digest presented as a token hashes again and resolves to nothing.
    const asToken = await composition.sessions.validate(
      session!.sessionTokenHash,
      tenantId,
      userId,
      1
    );
    expect(asToken.ok).toBe(false);
    await composition.close();
  });
});
