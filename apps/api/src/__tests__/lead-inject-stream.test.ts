/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { createHash } from 'node:crypto';
import { get as httpGet, IncomingMessage } from 'node:http';
import { AddressInfo } from 'node:net';

import Fastify, { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { authenticateFromSessionCookie } from '../middleware/session-cookie-auth.js';
import { leadEventEmitter, leadChannel } from '../routes/lead-inject.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * The lead-injection stream: who may open it, and whose leads it carries.
 *
 * ── Why this suite exists ────────────────────────────────────────────────────
 *
 * `GET /api/v1/lead-inject/stream` is opened by the browser's `EventSource`,
 * which cannot set request headers. It therefore arrived with no
 * `Authorization`, was refused 401, reconnected, and was refused again — for
 * the entire life of the endpoint. Nothing caught it because nothing had ever
 * opened the stream from a browser; the browser smoke test did, on its first
 * run, and found three refusals per load of /call-center.
 *
 * The fix lets this one read-only GET authenticate from the `hw_session`
 * cookie the web app already maintains. That is a deliberate, narrow exception
 * to "the cookie authenticates reads only" — narrow enough that it needs to be
 * pinned, because the failure modes are quiet ones:
 *
 *   - if the cookie stops being accepted, the stream silently 401s again and
 *     the console loses its screen pop, which no page test would notice;
 *   - if it starts being accepted too widely, a cookie that is not HttpOnly and
 *     rides along automatically becomes the thing authorising writes;
 *   - and if the subscription channel ever stops being per-tenant, one agency's
 *     agents watch another agency's consumers arrive — names, dates of birth
 *     and requested coverage.
 *
 * So all three are asserted here, against the real route, the real auth hook
 * and a real socket.
 *
 * ── Why a real socket ────────────────────────────────────────────────────────
 *
 * `app.inject()` cannot drive this route. An SSE response never ends, so inject
 * waits for a completion that by design never comes. The refusal cases use
 * inject because a refusal is an ordinary reply; the streaming cases listen on
 * a real port and read frames off the wire.
 */

const gate = databaseGate();
announceSkip('Lead injection stream', gate);

const TEST_JWT_SECRET = 'lead-inject-stream-suite-secret-not-used-anywhere-else';

// `middleware/session.ts` reads JWT_SECRET through `secrets.getRequired` when
// the cookie plugin is registered. Set before anything imports it.
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

/*
 * Real API keys for the webhook half of the round trip, hashed the way
 * `authenticateAPIKey` hashes them.
 */
const API_KEY_A = 'lead-inject-suite-key-tenant-a';
const API_KEY_B = 'lead-inject-suite-key-tenant-b';
const hashApiKey = (raw: string): string => createHash('sha256').update(raw).digest('hex');

/** One SSE connection, as the test reads it. */
interface Stream {
  status: number;
  /** Resolves once a frame containing `needle` arrives, or rejects on timeout. */
  waitFor(needle: string, timeoutMs?: number): Promise<string>;
  /** Everything received so far. */
  text(): string;
  close(): void;
}

function openStream(baseUrl: string, headers: Record<string, string>): Promise<Stream> {
  return new Promise((resolve, reject) => {
    const request = httpGet(`${baseUrl}/api/v1/lead-inject/stream`, { headers }, res => {
      let buffer = '';
      const waiters: Array<{ needle: string; resolve: (frame: string) => void }> = [];

      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buffer += chunk;
        for (let i = waiters.length - 1; i >= 0; i--) {
          if (buffer.includes(waiters[i].needle)) {
            waiters[i].resolve(buffer);
            waiters.splice(i, 1);
          }
        }
      });

      resolve({
        status: res.statusCode ?? 0,
        text: () => buffer,
        waitFor(needle: string, timeoutMs = 4000) {
          if (buffer.includes(needle)) return Promise.resolve(buffer);
          return new Promise<string>((ok, fail) => {
            const timer = setTimeout(
              () =>
                fail(new Error(`timed out waiting for ${JSON.stringify(needle)}; saw: ${buffer}`)),
              timeoutMs
            );
            waiters.push({
              needle,
              resolve: frame => {
                clearTimeout(timer);
                ok(frame);
              },
            });
          });
        },
        close: () => {
          request.destroy();
          (res as IncomingMessage).destroy();
        },
      });
    });
    request.on('error', reject);
  });
}

/** A moment for the server to process a close, so listener counts settle. */
const settle = () => new Promise(r => setTimeout(r, 50));

describe('Lead injection stream suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `lead injection stream suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('Lead injection stream', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    app = Fastify();
    await app.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    // The cookie plugin, because the whole point of this route is that it reads
    // one. Registered the same way the real server registers it.
    await app.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(app);

    const { registerLeadInjectRoutes } = await import('../routes/lead-inject.js');
    await app.register(registerLeadInjectRoutes);

    /*
     * A mutating route carrying the read-only authenticator, so the guard that
     * keeps this cookie off writes is exercised rather than trusted. It exists
     * only in this suite.
     */
    app.post(
      '/api/v1/lead-inject/__read_only_guard_probe',
      { preHandler: [authenticateFromSessionCookie] },
      async () => ({ reached: true })
    );

    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;

    /*
     * Two agencies with a webhook key each, so the round trip below is the real
     * one: a vendor POSTs with an API key, and the tenant comes from the key
     * rather than from anything in the payload.
     */
    const prisma = getPrismaClient();
    for (const [id, key] of [
      [TENANT_A, API_KEY_A],
      [TENANT_B, API_KEY_B],
    ] as const) {
      await prisma.tenant.upsert({
        where: { id },
        update: { status: 'ACTIVE' },
        create: {
          id,
          name: `Lead Inject Suite ${id.slice(0, 8)}`,
          slug: `lead-inject-suite-${id.slice(0, 8)}`,
          status: 'ACTIVE',
        },
      });
      await prisma.apiKey.upsert({
        where: { keyHash: hashApiKey(key) },
        update: { tenantId: id, status: 'ACTIVE', expiresAt: null },
        create: {
          tenantId: id,
          name: 'lead inject suite',
          keyHash: hashApiKey(key),
          prefix: key.slice(0, 8),
          status: 'ACTIVE',
          scopes: [],
        },
      });
    }
  });

  afterAll(async () => {
    await app.close();
    const prisma = getPrismaClient();
    // Delete only what this suite created. The keys go with the tenants.
    await prisma.tenant
      .deleteMany({ where: { id: { in: [TENANT_A, TENANT_B] } } })
      .catch(() => undefined);
  });

  const sessionFor = (tenantId: string): string =>
    app.jwt.sign({ tenantId, userId: `user-${tenantId}`, email: `agent@${tenantId}.invalid` });

  describe('who may open it', () => {
    it('refuses a request carrying no credential at all', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/lead-inject/stream' });

      expect(response.statusCode).toBe(401);
      expect(response.body).not.toContain('"type":"connected"');
    });

    it('refuses a forged session cookie', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/lead-inject/stream',
        headers: { cookie: 'hw_session=not-a-real-jwt' },
      });

      expect(response.statusCode).toBe(401);
    });

    it('refuses a cookie signed with the wrong secret', async () => {
      const foreign = Fastify();
      await foreign.register(import('@fastify/jwt'), { secret: 'a-different-secret-entirely' });
      await foreign.ready();
      const forged = foreign.jwt.sign({ tenantId: TENANT_A, userId: 'u', email: 'e@x.invalid' });
      await foreign.close();

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/lead-inject/stream',
        headers: { cookie: `hw_session=${forged}` },
      });

      expect(response.statusCode).toBe(401);
    });

    it('accepts the session cookie the web app already sets', async () => {
      const stream = await openStream(baseUrl, { cookie: `hw_session=${sessionFor(TENANT_A)}` });

      expect(stream.status).toBe(200);
      await stream.waitFor('"type":"connected"');

      stream.close();
      await settle();
    });

    it('still accepts a Bearer token, which the cookie does not replace', async () => {
      const stream = await openStream(baseUrl, {
        authorization: `Bearer ${sessionFor(TENANT_A)}`,
      });

      expect(stream.status).toBe(200);
      await stream.waitFor('"type":"connected"');

      stream.close();
      await settle();
    });
  });

  describe('whose leads it carries', () => {
    it("delivers this agency's lead to this agency's agent", async () => {
      const stream = await openStream(baseUrl, { cookie: `hw_session=${sessionFor(TENANT_A)}` });
      await stream.waitFor('"type":"connected"');

      leadEventEmitter.emit(leadChannel(TENANT_A), {
        caller_id: '+15555550123',
        first_name: 'Dana',
        last_name: 'Okafor',
      });

      const frame = await stream.waitFor('"type":"lead"');
      expect(frame).toContain('Dana');
      expect(frame).toContain('Okafor');

      stream.close();
      await settle();
    });

    it("never carries another agency's lead, which is the whole product", async () => {
      const a = await openStream(baseUrl, { cookie: `hw_session=${sessionFor(TENANT_A)}` });
      const b = await openStream(baseUrl, { cookie: `hw_session=${sessionFor(TENANT_B)}` });
      await a.waitFor('"type":"connected"');
      await b.waitFor('"type":"connected"');

      // One agency's consumer, with the fields that make this matter.
      leadEventEmitter.emit(leadChannel(TENANT_A), {
        caller_id: '+15555550199',
        first_name: 'Marisol',
        dob: '1954-02-11',
        coverage_amount: 15000,
      });

      // A's agent sees it.
      await a.waitFor('Marisol');

      /*
       * B's agent must not. Asserted after A has already received the frame:
       * the emit is synchronous, so by the time A has it, B would have it too
       * if the channel were shared. A bare timeout would pass on a slow
       * machine for the wrong reason.
       */
      expect(b.text()).not.toContain('Marisol');
      expect(b.text()).not.toContain('1954-02-11');
      expect(b.text()).not.toContain('"type":"lead"');

      a.close();
      b.close();
      await settle();
    });

    /*
     * The round trip, end to end, because "the 401 is gone" is not the same
     * claim as "an injected lead reaches the agent". This one goes through the
     * real webhook: a vendor POSTs with an API key, the route derives the
     * tenant from that key, and the agent's open stream receives it.
     */
    it('carries a lead all the way from the vendor webhook to the agent', async () => {
      const mine = await openStream(baseUrl, { cookie: `hw_session=${sessionFor(TENANT_A)}` });
      const theirs = await openStream(baseUrl, { cookie: `hw_session=${sessionFor(TENANT_B)}` });
      await mine.waitFor('"type":"connected"');
      await theirs.waitFor('"type":"connected"');

      const posted = await app.inject({
        method: 'POST',
        url: '/api/v1/lead-inject',
        headers: { 'x-api-key': API_KEY_A },
        payload: {
          caller_id: '+15555550144',
          first_name: 'Yusuf',
          last_name: 'Rahman',
          dob: '1949-06-30',
          coverage_amount: 20000,
        },
      });

      expect(posted.statusCode).toBe(200);

      const frame = await mine.waitFor('Yusuf');
      expect(frame).toContain('Rahman');
      // The route derives age from the date of birth before broadcasting.
      expect(frame).toContain('"age"');

      // And the other agency's agent, watching at the same moment, sees none of it.
      expect(theirs.text()).not.toContain('Yusuf');
      expect(theirs.text()).not.toContain('1949-06-30');

      mine.close();
      theirs.close();
      await settle();
    });

    it('stops listening when the agent closes the tab', async () => {
      const channel = leadChannel(TENANT_A);
      const before = leadEventEmitter.listenerCount(channel);

      const stream = await openStream(baseUrl, { cookie: `hw_session=${sessionFor(TENANT_A)}` });
      await stream.waitFor('"type":"connected"');
      expect(leadEventEmitter.listenerCount(channel)).toBe(before + 1);

      stream.close();

      // The route removes its listener on the socket closing. Give the server
      // the tick it needs to notice, rather than asserting into a race.
      const deadline = Date.now() + 3000;
      while (leadEventEmitter.listenerCount(channel) > before && Date.now() < deadline) {
        await settle();
      }
      expect(leadEventEmitter.listenerCount(channel)).toBe(before);
    });
  });

  describe('the read-only invariant', () => {
    it('refuses to authenticate a mutating request, rather than trusting the caller', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/lead-inject/__read_only_guard_probe',
        headers: { cookie: `hw_session=${sessionFor(TENANT_A)}` },
        payload: {},
      });

      // The guard fires before the handler: the cookie never authorises a write.
      expect(response.statusCode).toBe(500);
      expect(response.body).not.toContain('"reached":true');
    });
  });
});
