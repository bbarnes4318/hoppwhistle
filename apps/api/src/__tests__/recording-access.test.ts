/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { RoleName } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * A recording is reachable only by someone entitled to the call it came from.
 *
 * ── The hole this closes ─────────────────────────────────────────────────────
 *
 * `GET /api/v1/recordings/local-stream/*` had no `preHandler`, sat on a plugin
 * with no auth hook, and its handler never read `request.user`. It resolved the
 * wildcard against `LOCAL_STORAGE_DIR` and streamed the file. Anyone at all,
 * from any tenant or from none, holding nothing but the path, got the audio.
 *
 * And the paths travel: `services/storage.ts` returns
 * `/api/v1/recordings/local-stream/<storageKey>` from `getSignedUrl()` whenever
 * the file is on local disk, so the key appears in API responses and in
 * `recording.url`, and from there in access logs and browser history. The key
 * format is `recordings/YYYY/MM/DD/<callId>.<ext>` and names no tenant.
 *
 * ── Why these cases, in this shape ───────────────────────────────────────────
 *
 * The file on disk is REAL in every case below. A test that only ever asked for
 * a missing file would pass against a handler that streamed anything it was
 * given, because the 404 would be the filesystem's rather than the
 * authorization's. So every refusal here is a refusal to serve bytes that exist
 * and that the route can see -- which is the only version of this assertion
 * worth having.
 *
 * The unauthorised answer is 404 rather than 403, deliberately: a 403 confirms
 * to somebody holding a leaked key that it names a real recording in this
 * tenant, which is most of what they wanted to learn.
 */

const gate = databaseGate();
announceSkip('Recording access', gate);

const TEST_JWT_SECRET = 'recording-access-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

const STORAGE_DIR = join('/tmp', `hw-recording-access-${process.pid}`);

describe('Recording access suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `recording access suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('Recording access', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;

  /** One agency, with an owner, two agents, a call and a stored recording. */
  interface Agency {
    tenantId: string;
    ownerId: string;
    agentId: string;
    otherAgentId: string;
    /** The recording of a call the agent took, on their own number. */
    agentStorageKey: string;
    /** The recording of a call the OTHER agent took. Same tenant. */
    otherStorageKey: string;
    /** A Recording Analyzer upload owned by the agent. */
    analysisStorageKey: string;
    /** The id of the agent's recording, for the by-id routes. */
    agentRecordingId: string;
  }

  let a: Agency;
  let b: Agency;

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);
    const { registerRecordingManagementRoutes } = await import('../routes/recordings.js');
    await instance.register(registerRecordingManagementRoutes);
    await instance.ready();
    return instance;
  }

  function tokenFor(tenantId: string, userId: string): Record<string, string> {
    return {
      authorization: `Bearer ${app.jwt.sign({ tenantId, userId, email: `${userId}@t.local` })}`,
    };
  }

  /** Write a real file, so a refusal is never just a missing one. */
  function store(key: string): void {
    const full = join(STORAGE_DIR, key);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, 'RIFF-not-really-audio');
  }

  async function seedAgency(label: string, roleIds: Record<string, string>): Promise<Agency> {
    const slug = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tenant = await prisma.tenant.create({
      data: { name: `${label} Insurance`, slug, status: 'ACTIVE' },
    });

    const mkUser = async (name: string, roleId: string) =>
      prisma.user.create({
        data: {
          tenantId: tenant.id,
          email: `${name}@${slug}.local`,
          status: 'ACTIVE',
          roles: { create: { roleId } },
        },
      });

    const owner = await mkUser('owner', roleIds.OWNER);
    const agent = await mkUser('agent', roleIds.AGENT);
    const otherAgent = await mkUser('other', roleIds.AGENT);

    const mkCall = async (createdById: string, sid: string) =>
      prisma.call.create({
        data: {
          tenantId: tenant.id,
          callSid: sid,
          toNumber: '+15550000000',
          status: 'COMPLETED',
          direction: 'INBOUND',
          createdById,
        },
      });

    const agentCall = await mkCall(agent.id, `sid-agent-${slug}`);
    const otherCall = await mkCall(otherAgent.id, `sid-other-${slug}`);

    // The real key shape: no tenant segment, which is the reason the key can
    // never be the thing that authorises the read.
    const agentStorageKey = `recordings/2026/09/15/${agentCall.id}.wav`;
    const otherStorageKey = `recordings/2026/09/15/${otherCall.id}.wav`;
    const analysisStorageKey = `recordings/2026/09/15/analysis-${slug}.wav`;

    const agentRecording = await prisma.recording.create({
      data: {
        callId: agentCall.id,
        storageKey: agentStorageKey,
        url: `/api/v1/recordings/local-stream/${encodeURIComponent(agentStorageKey)}`,
        status: 'COMPLETED',
      },
    });
    await prisma.recording.create({
      data: {
        callId: otherCall.id,
        storageKey: otherStorageKey,
        url: `/api/v1/recordings/local-stream/${encodeURIComponent(otherStorageKey)}`,
        status: 'COMPLETED',
      },
    });
    await prisma.recordingAnalysis.create({
      data: {
        tenantId: tenant.id,
        userId: agent.id,
        batchId: `batch-${slug}`,
        vertical: 'ACA',
        sourceType: 'upload',
        storageKey: analysisStorageKey,
        selectedFields: [],
        status: 'done',
      },
    });

    store(agentStorageKey);
    store(otherStorageKey);
    store(analysisStorageKey);

    return {
      tenantId: tenant.id,
      ownerId: owner.id,
      agentId: agent.id,
      otherAgentId: otherAgent.id,
      agentStorageKey,
      otherStorageKey,
      analysisStorageKey,
      agentRecordingId: agentRecording.id,
    };
  }

  beforeAll(async () => {
    process.env.LOCAL_STORAGE_DIR = STORAGE_DIR;
    mkdirSync(STORAGE_DIR, { recursive: true });

    prisma = getPrismaClient();
    app = await buildApp();

    for (const table of [
      'recording_analysis',
      'recordings',
      'calls',
      'user_roles',
      'users',
      'roles',
      'tenants',
    ]) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }

    const roleIds: Record<string, string> = {};
    for (const name of [RoleName.OWNER, RoleName.AGENT]) {
      const role = await prisma.role.create({ data: { name, permissions: [] } });
      roleIds[name] = role.id;
    }

    a = await seedAgency('alpha', roleIds);
    b = await seedAgency('beta', roleIds);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
    rmSync(STORAGE_DIR, { recursive: true, force: true });
  });

  const stream = (key: string, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'GET',
      url: `/api/v1/recordings/local-stream/${encodeURIComponent(key)}`,
      headers,
    });

  describe('local-stream requires a credential', () => {
    it('refuses an anonymous request for a file that exists', async () => {
      const res = await stream(a.agentStorageKey);
      expect(res.statusCode).toBe(401);
      expect(res.body).not.toContain('RIFF');
    });

    it('refuses a forged token', async () => {
      const res = await stream(a.agentStorageKey, { authorization: 'Bearer not-a-real-token' });
      expect(res.statusCode).toBe(401);
      expect(res.body).not.toContain('RIFF');
    });
  });

  describe('local-stream enforces the tenant boundary', () => {
    it("refuses tenant B's owner the key of tenant A's recording", async () => {
      const res = await stream(a.agentStorageKey, tokenFor(b.tenantId, b.ownerId));
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain('RIFF');
    });

    it("refuses tenant B's agent the key of tenant A's recording", async () => {
      const res = await stream(a.agentStorageKey, tokenFor(b.tenantId, b.agentId));
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain('RIFF');
    });

    it("refuses tenant B's owner tenant A's analyzer upload", async () => {
      const res = await stream(a.analysisStorageKey, tokenFor(b.tenantId, b.ownerId));
      expect(res.statusCode).toBe(404);
    });
  });

  describe('local-stream enforces the agent boundary inside one tenant', () => {
    it("refuses an agent the recording of a colleague's call", async () => {
      const res = await stream(a.otherStorageKey, tokenFor(a.tenantId, a.agentId));
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain('RIFF');
    });

    it("refuses an agent a colleague's analyzer upload", async () => {
      const res = await stream(a.analysisStorageKey, tokenFor(a.tenantId, a.otherAgentId));
      expect(res.statusCode).toBe(404);
    });
  });

  describe('local-stream still serves the people it should', () => {
    it('serves an agent the recording of their own call', async () => {
      const res = await stream(a.agentStorageKey, tokenFor(a.tenantId, a.agentId));
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('RIFF');
    });

    it("serves the agency owner any of the agency's recordings", async () => {
      const res = await stream(a.otherStorageKey, tokenFor(a.tenantId, a.ownerId));
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('RIFF');
    });

    it('serves an agent their own analyzer upload', async () => {
      const res = await stream(a.analysisStorageKey, tokenFor(a.tenantId, a.agentId));
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('RIFF');
    });

    it("serves the owner an agent's analyzer upload", async () => {
      const res = await stream(a.analysisStorageKey, tokenFor(a.tenantId, a.ownerId));
      expect(res.statusCode).toBe(200);
    });
  });

  describe('the storage key is an identifier, not a credential', () => {
    it('answers an unknown key the same way it answers an unauthorised one', async () => {
      const unknown = await stream(
        'recordings/2026/09/15/no-such-call.wav',
        tokenFor(a.tenantId, a.ownerId)
      );
      const unauthorised = await stream(b.agentStorageKey, tokenFor(a.tenantId, a.ownerId));
      expect(unknown.statusCode).toBe(404);
      expect(unauthorised.statusCode).toBe(404);
      expect(JSON.parse(unknown.body).error.code).toBe(JSON.parse(unauthorised.body).error.code);
    });

    it('still refuses directory traversal', async () => {
      const res = await stream('../../../etc/passwd', tokenFor(a.tenantId, a.ownerId));
      expect([403, 404]).toContain(res.statusCode);
      expect(res.body).not.toContain('root:');
    });
  });

  /**
   * The same class of defect, one route up.
   *
   * `POST /api/v1/recordings/:recordingId/backfill` passed the id straight to
   * the service, which looks it up by primary key. A small write -- size and
   * checksum -- across the agency boundary, reached by naming a uuid the
   * recordings list hands out.
   */
  describe('by-id writes are scoped to the acting tenant', () => {
    const backfill = (id: string, headers: Record<string, string> = {}) =>
      app.inject({ method: 'POST', url: `/api/v1/recordings/${id}/backfill`, headers });

    it('refuses an anonymous caller', async () => {
      expect((await backfill(a.agentRecordingId)).statusCode).toBe(401);
    });

    it("refuses tenant B's owner a recording of tenant A", async () => {
      const res = await backfill(a.agentRecordingId, tokenFor(b.tenantId, b.ownerId));
      expect(res.statusCode).toBe(404);
    });

    it("reaches the handler for the recording's own tenant", async () => {
      // Storage has no metadata for a fixture file, so the service throws and
      // the route answers 400. That is the point: it got PAST authorization,
      // which a 404 or 401 would not have.
      const res = await backfill(a.agentRecordingId, tokenFor(a.tenantId, a.ownerId));
      expect(res.statusCode).not.toBe(404);
      expect(res.statusCode).not.toBe(401);
    });
  });
});
