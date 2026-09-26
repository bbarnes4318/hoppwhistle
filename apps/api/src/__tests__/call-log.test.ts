/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { RoleName } from '@prisma/client';
import { hash } from 'bcryptjs';
import Fastify, { type FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import type { JwtPayload } from '../types/fastify.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * The call-by-call ledger: who took it, how long it ran, how it was written up.
 *
 * ── What was wrong ───────────────────────────────────────────────────────────
 *
 * An agency principal could see every call and could not see who took any of
 * them. The ledger returned `createdBy` -- whoever caused the ROW to exist,
 * which on an inbound call routed to the floor is the inbound handler, so
 * null -- and never `answeredByUserId`, which is who actually picked the phone
 * up and is what the per-agent table and the closing percentage are built on.
 * There was no agent column, no agent filter, and no disposition column: the
 * table showed free-text call notes but not the canonical disposition beside
 * them.
 *
 * The agent's own list was worse than incomplete. The sidebar calls it "My
 * calls -- narrowed server-side to the ones you took", and it was narrowed to
 * the calls they CREATED plus the phone numbers assigned to them. An agent
 * taking inbound calls on a softphone satisfies neither: the row is created by
 * the inbound handler, and the DID belongs to the agency. So the one list an
 * agent opens every day showed everything except the calls they answered.
 *
 * And the attribution itself had a single writer -- the softphone answer
 * endpoint. Every other route to a disposition left `answeredByUserId` null,
 * including the disposition save that CREATES a call row, so an agent who
 * wrote up a call that was never tracked produced a row that counted for
 * nobody.
 *
 * ── The properties asserted here ─────────────────────────────────────────────
 *
 *   1. Every call names the agent who answered it, and a call nobody answered
 *      says so rather than rendering as a blank.
 *   2. The agent filter NARROWS and can never WIDEN. An agent passing an
 *      `agentId` does not thereby read a colleague's calls.
 *   3. An agent sees the calls they ANSWERED in their own list, and can open
 *      one.
 *   4. A disposition save attributes the call, never steals it, and never
 *      stamps `answeredAt` -- that column bills the agency.
 *   5. A stale id from another agency resolves to no name, rather than
 *      printing that agency's employee on this agency's ledger.
 */

const gate = databaseGate();
announceSkip('The call-by-call ledger', gate);

const TEST_JWT_SECRET = 'call-log-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

interface Seeded {
  tenantId: string;
  ownerId: string;
  ownerEmail: string;
  danaId: string;
  danaEmail: string;
  rubenId: string;
  rubenEmail: string;
}

describe('Call ledger suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `call ledger suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('The call-by-call ledger', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;
  let agency: Seeded;
  let other: Seeded;
  let roleIds: Record<string, string>;

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);

    const { registerCallRoutes } = await import('../routes/index.js');
    await instance.register(registerCallRoutes);

    await instance.ready();
    return instance;
  }

  function tokenFor(
    who: { tenantId: string; userId: string; email: string },
    roles: string[]
  ): Record<string, string> {
    return {
      authorization: `Bearer ${app.jwt.sign({ ...who, roles } as JwtPayload)}`,
    };
  }

  const asOwner = (s: Seeded) =>
    tokenFor({ tenantId: s.tenantId, userId: s.ownerId, email: s.ownerEmail }, ['OWNER']);
  const asDana = (s: Seeded) =>
    tokenFor({ tenantId: s.tenantId, userId: s.danaId, email: s.danaEmail }, ['AGENT']);

  async function cleanDatabase() {
    for (const table of ['calls', 'audit_logs', 'user_roles', 'users', 'roles', 'tenants']) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }
  }

  /** One agency: a principal and two agents who take its calls. */
  async function seedAgency(label: string): Promise<Seeded> {
    const slug = `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tenant = await prisma.tenant.create({
      data: { name: `${label} Insurance`, slug, status: 'ACTIVE' },
    });

    const passwordHash = await hash('password123', 10);

    const owner = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `principal@${slug}.local`,
        passwordHash,
        status: 'ACTIVE',
        roles: { create: { roleId: roleIds[RoleName.OWNER] } },
      },
    });

    const dana = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `dana@${slug}.local`,
        firstName: 'Dana',
        lastName: 'Reed',
        passwordHash,
        status: 'ACTIVE',
        roles: { create: { roleId: roleIds[RoleName.AGENT] } },
      },
    });

    const ruben = await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: `ruben@${slug}.local`,
        firstName: 'Ruben',
        lastName: 'Ortiz',
        passwordHash,
        status: 'ACTIVE',
        roles: { create: { roleId: roleIds[RoleName.AGENT] } },
      },
    });

    return {
      tenantId: tenant.id,
      ownerId: owner.id,
      ownerEmail: owner.email,
      danaId: dana.id,
      danaEmail: dana.email,
      rubenId: ruben.id,
      rubenEmail: ruben.email,
    };
  }

  /** One inbound call, answered by whoever is named. */
  async function seedCall(
    s: Seeded,
    params: {
      answeredByUserId?: string | null;
      disposition?: string | null;
      duration?: number;
      connectedDuration?: number;
      answeredAt?: Date | null;
      callerId?: string;
    } = {}
  ): Promise<string> {
    const call = await prisma.call.create({
      data: {
        tenantId: s.tenantId,
        callSid: `sid-${Math.random().toString(36).slice(2, 12)}`,
        toNumber: '+15550000000',
        callerId: params.callerId ?? '+15551230000',
        status: 'COMPLETED',
        direction: 'INBOUND',
        duration: params.duration ?? 240,
        connectedDuration: params.connectedDuration ?? 210,
        answeredAt: params.answeredAt === undefined ? new Date() : params.answeredAt,
        answeredByUserId: params.answeredByUserId ?? null,
        disposition: params.disposition ?? null,
      },
    });
    return call.id;
  }

  /** The ledger rows, as the screen reads them. */
  async function ledger(headers: Record<string, string>, query = ''): Promise<any[]> {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/calls${query ? `?${query}` : ''}`,
      headers,
    });
    expect(response.statusCode, `ledger refused: ${response.body.slice(0, 300)}`).toBe(200);
    return response.json().data;
  }

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    prisma = getPrismaClient();
    await cleanDatabase();

    roleIds = {};
    for (const name of [RoleName.OWNER, RoleName.ADMIN, RoleName.AGENT]) {
      const role = await prisma.role.create({
        data: { name, description: `${name} role`, permissions: [] },
      });
      roleIds[name] = role.id;
    }

    agency = await seedAgency('Alpha');
    other = await seedAgency('Bravo');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 1. The agent's name on every call
  // ══════════════════════════════════════════════════════════════════════════
  describe('every call names the agent who took it', () => {
    it('gives the principal the agent, not whoever created the row', async () => {
      const callId = await seedCall(agency, { answeredByUserId: agency.danaId });

      const rows = await ledger(asOwner(agency));
      const row = rows.find(r => r.id === callId);

      expect(row).toBeDefined();
      expect(row.agentName).toBe('Dana Reed');
      expect(row.answeredByUserId).toBe(agency.danaId);
      // The row was created by nobody -- an inbound call is written by the
      // inbound handler. Reading `createdBy` for the agent is what produced an
      // empty agent column on every inbound call in the product.
      expect(row.createdBy).toBeNull();
    });

    it('reports a call nobody answered as unattributed rather than blank', async () => {
      const callId = await seedCall(agency, { answeredByUserId: null });

      const rows = await ledger(asOwner(agency));
      const row = rows.find(r => r.id === callId);

      /*
       * Null, explicitly, and the screen renders it as its own state. An empty
       * string would be indistinguishable from an agent with no name on file,
       * and a floor lead reading an empty cell concludes something about the
       * call rather than about what was recorded.
       */
      expect(row.agentName).toBeNull();
      expect(row.answeredByUserId).toBeNull();
    });

    it('carries the durations and the disposition beside the name', async () => {
      const callId = await seedCall(agency, {
        answeredByUserId: agency.rubenId,
        disposition: 'APPLICATION_SUBMITTED',
        duration: 615,
        connectedDuration: 590,
      });

      const row = (await ledger(asOwner(agency))).find(r => r.id === callId);

      expect(row.agentName).toBe('Ruben Ortiz');
      expect(row.duration).toBe(615);
      expect(row.connectedDuration).toBe(590);
      expect(row.disposition).toBe('APPLICATION_SUBMITTED');
    });

    it("does not print another agency's employee on this agency's ledger", async () => {
      // A stale id -- from a backfill, or an agent moved between agencies.
      const callId = await seedCall(agency, { answeredByUserId: other.danaId });

      const row = (await ledger(asOwner(agency))).find(r => r.id === callId);

      // The id stays, because it is what the row says. The NAME does not
      // resolve, because that user is not this agency's to name.
      expect(row.agentName).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 2. Filtering
  // ══════════════════════════════════════════════════════════════════════════
  describe('filtering the ledger', () => {
    it('narrows to one agent for the principal', async () => {
      const dana = await seedCall(agency, { answeredByUserId: agency.danaId });
      const ruben = await seedCall(agency, { answeredByUserId: agency.rubenId });

      const rows = await ledger(asOwner(agency), `agentId=${agency.danaId}`);
      const ids = rows.map(r => r.id);

      expect(ids).toContain(dana);
      expect(ids).not.toContain(ruben);
    });

    it('never lets an agent widen past their own calls with agentId', async () => {
      const mine = await seedCall(agency, { answeredByUserId: agency.danaId });
      const theirs = await seedCall(agency, { answeredByUserId: agency.rubenId });

      // Dana asks for Ruben's calls. She is an agent, not a principal.
      const rows = await ledger(asDana(agency), `agentId=${agency.rubenId}`);
      const ids = rows.map(r => r.id);

      /*
       * The parameter is dropped, not honoured and not refused: her list stays
       * her own calls. Refusing would break a link shared from a principal's
       * screen; honouring it would be one agent reading another's calls, on a
       * floor where the closing percentage decides pay.
       */
      expect(ids).toContain(mine);
      expect(ids).not.toContain(theirs);
    });

    it('narrows to one disposition', async () => {
      const submitted = await seedCall(agency, {
        answeredByUserId: agency.danaId,
        disposition: 'APPLICATION_SUBMITTED',
      });
      const notInterested = await seedCall(agency, {
        answeredByUserId: agency.danaId,
        disposition: 'NOT_INTERESTED',
      });

      const ids = (await ledger(asOwner(agency), 'disposition=APPLICATION_SUBMITTED')).map(
        r => r.id
      );

      expect(ids).toContain(submitted);
      expect(ids).not.toContain(notInterested);
    });

    it('answers "which calls has nobody written up" with NONE', async () => {
      const blank = await seedCall(agency, { answeredByUserId: agency.danaId });
      const written = await seedCall(agency, {
        answeredByUserId: agency.danaId,
        disposition: 'NOT_INTERESTED',
      });

      const ids = (await ledger(asOwner(agency), 'disposition=NONE')).map(r => r.id);

      // Leaving the parameter off means "all calls", so the un-dispositioned
      // set is not otherwise expressible -- and it is the question a floor lead
      // asks at the end of every shift.
      expect(ids).toContain(blank);
      expect(ids).not.toContain(written);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 3. The agent's own list
  // ══════════════════════════════════════════════════════════════════════════
  describe("an agent's own calls", () => {
    it('includes the calls they answered', async () => {
      const answered = await seedCall(agency, { answeredByUserId: agency.danaId });

      const ids = (await ledger(asDana(agency))).map(r => r.id);

      /*
       * The defect this file exists for. "My calls" narrowed on `createdById`
       * and on the phone numbers assigned to the agent; an inbound call routed
       * to a softphone matches neither, so the list showed an agent everything
       * except their own work.
       */
      expect(ids).toContain(answered);
    });

    it("still excludes a colleague's calls", async () => {
      const theirs = await seedCall(agency, { answeredByUserId: agency.rubenId });

      const ids = (await ledger(asDana(agency))).map(r => r.id);

      expect(ids).not.toContain(theirs);
    });

    it('lets them open a call they answered', async () => {
      const callId = await seedCall(agency, { answeredByUserId: agency.danaId });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/calls/${callId}`,
        headers: asDana(agency),
      });

      // The detail check matched `createdById` and the agent's own numbers, so
      // an agent could see a call in their figures and be refused when they
      // clicked it to re-read their own notes.
      expect(response.statusCode).toBe(200);
      expect(response.json().agentName).toBe('Dana Reed');
    });

    it('still refuses a call they had nothing to do with', async () => {
      const callId = await seedCall(agency, { answeredByUserId: agency.rubenId });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/calls/${callId}`,
        headers: asDana(agency),
      });

      expect(response.statusCode).toBe(403);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 4. Attribution on the write path
  // ══════════════════════════════════════════════════════════════════════════
  describe('saving a disposition attributes the call', () => {
    it('attributes a call it creates to the agent writing it up', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/calls/disposition',
        headers: asDana(agency),
        payload: {
          callSid: `untracked-${Date.now()}`,
          disposition: 'NOT_INTERESTED',
          callerNumber: '+15557654321',
          direction: 'INBOUND',
        },
      });

      expect(response.statusCode).toBe(201);
      const created = await prisma.call.findUnique({
        where: { id: response.json().id },
      });

      // Without this the row counted for nobody: the agent who made the call
      // and wrote it up did not appear in their own figures.
      expect(created?.answeredByUserId).toBe(agency.danaId);
    });

    it('never stamps answeredAt, which is what bills the agency', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/calls/disposition',
        headers: asDana(agency),
        payload: {
          callSid: `untracked-${Date.now()}`,
          disposition: 'NOT_INTERESTED',
          direction: 'INBOUND',
        },
      });

      const created = await prisma.call.findUnique({
        where: { id: response.json().id },
      });

      /*
       * A delivered call is INBOUND, not blocked, with `answeredAt` in the
       * window. This endpoint is reachable by any agent on the floor: if it
       * stamped `answeredAt`, writing calls up would mint billable delivered
       * calls out of nothing.
       */
      expect(created?.answeredAt).toBeNull();
    });

    it('fills the attribution on an existing call that has none', async () => {
      const callId = await seedCall(agency, { answeredByUserId: null });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/calls/disposition',
        headers: asDana(agency),
        payload: { callId, disposition: 'SET_APPOINTMENT' },
      });

      expect(response.statusCode).toBe(200);
      const updated = await prisma.call.findUnique({ where: { id: callId } });
      expect(updated?.answeredByUserId).toBe(agency.danaId);
    });

    it('never takes a call off the agent who answered it', async () => {
      const callId = await seedCall(agency, { answeredByUserId: agency.rubenId });

      // A supervisor correcting the write-up afterwards, on the same idempotent
      // endpoint the agent used.
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/calls/disposition',
        headers: asOwner(agency),
        payload: { callId, disposition: 'NOT_QUALIFIED' },
      });

      expect(response.statusCode).toBe(200);
      const updated = await prisma.call.findUnique({ where: { id: callId } });

      // The answer handler's record is a fact. This endpoint's guess is not,
      // and must never overwrite one.
      expect(updated?.answeredByUserId).toBe(agency.rubenId);
      expect(updated?.disposition).toBe('NOT_QUALIFIED');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // 5. The export
  // ══════════════════════════════════════════════════════════════════════════
  describe('the CSV export', () => {
    it('carries the agent, the disposition and the notes', async () => {
      await prisma.call.update({
        where: { id: await seedCall(agency, { answeredByUserId: agency.danaId }) },
        data: { disposition: 'SET_CALLBACK', dispositionNotes: 'Calling back Tuesday' },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/calls/export.csv',
        headers: asOwner(agency),
      });

      expect(response.statusCode).toBe(200);
      const [header, ...rows] = response.body.trim().split('\n');

      expect(header).toContain('Agent');
      expect(header.split(',').length, 'header and row widths must agree').toBe(
        rows[0].split(',').length
      );
      expect(rows[0]).toContain('Dana Reed');
      expect(rows[0]).toContain('SET_CALLBACK');
      expect(rows[0]).toContain('Calling back Tuesday');
    });

    it('says "Unattributed" rather than leaving the agent cell empty', async () => {
      await seedCall(agency, { answeredByUserId: null });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/calls/export.csv',
        headers: asOwner(agency),
      });

      // Somebody sorts the export by this column. A blank sorts with every
      // other blank cell in the sheet and says nothing.
      expect(response.body).toContain('Unattributed');
    });
  });
});
