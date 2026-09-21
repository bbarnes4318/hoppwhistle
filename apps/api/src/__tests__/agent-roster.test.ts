/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses */
/**
 * The agency's own agent roster.
 *
 * ── What this surface is for ─────────────────────────────────────────────────
 *
 * Setting an agent up meant four things in four places, two of which had no
 * agency-facing surface at all. The one that mattered most was putting the
 * agent in a call pool: `CampaignAgent` sat in the schema documented as "the
 * dialer's hot read" and was referenced by NOTHING, so the only way an agent
 * could ring was for NetEnroll staff to hand-build a `BuyerEndpoint` on a
 * screen an agency principal cannot reach.
 *
 * ── The properties asserted here ─────────────────────────────────────────────
 *
 *   1. TENANT ISOLATION, in both directions. `:userId` and every `campaignId`
 *      are client-supplied, and an assignment joins the two. Getting either
 *      wrong puts one agency's agent into another agency's call pool, which is
 *      the defect class this whole area keeps producing.
 *   2. REPLACE, not merge, and in one transaction. A delete followed by an
 *      insert outside a transaction leaves a window where the agent is on no
 *      campaign and the dialer routes nothing to them.
 *   3. `blockedReason` names the EARLIEST blocker. Granting a campaign to an
 *      agent with no licence changes nothing, so telling somebody about the
 *      campaign first sends them to do work that has no effect.
 *   4. The concurrency write MERGES metadata. `metadata` also carries
 *      `licensedStates`; replacing the object would silently revoke an agent's
 *      licence as a side effect of changing their call limit.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  user: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  campaign: { findMany: vi.fn() },
  campaignAgent: { findMany: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() },
  agentSchedule: { upsert: vi.fn(), deleteMany: vi.fn() },
  agencyProfile: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({ getPrismaClient: () => prisma }));

vi.mock('../middleware/auth.js', () => ({
  authenticate: vi.fn(async () => undefined),
}));

vi.mock('../lib/platform-context.js', () => ({
  requireAgencyPrincipal: vi.fn(async () => undefined),
}));

const resolveTenant = vi.hoisted(() => vi.fn(() => 'agency-a'));
vi.mock('../lib/tenant-context.js', () => ({
  resolveTenant: (...args: unknown[]) => resolveTenant(...(args as [])),
  getActingUserId: () => 'owner-1',
}));

vi.mock('../services/audit.js', () => ({ auditLog: vi.fn(async () => undefined) }));

vi.mock('../services/redis.js', () => ({
  getRedisClient: () => ({ mget: vi.fn(async () => []) }),
}));

import { registerAgentRosterRoutes } from '../routes/agent-roster.js';

/** A roster user row as the query selects it. */
function agentRow(overrides: Record<string, any> = {}) {
  return {
    id: 'u-1',
    email: 'dana@agency.test',
    firstName: 'Dana',
    lastName: 'Reed',
    status: 'ACTIVE',
    availableForCalls: true,
    availabilityChangedAt: null,
    lastLoginAt: null,
    metadata: { licensedStates: ['TN'] },
    createdAt: new Date('2026-01-01'),
    roles: [{ role: { name: 'AGENT' } }],
    sipCredential: { extension: '1042', status: 'ACTIVE', passwordEncrypted: 'enc:v1:x:y:z' },
    schedule: null,
    ...overrides,
  };
}

let app: FastifyInstance;

beforeEach(async () => {
  vi.clearAllMocks();
  resolveTenant.mockReturnValue('agency-a');

  prisma.user.findMany.mockResolvedValue([]);
  prisma.campaign.findMany.mockResolvedValue([]);
  prisma.campaignAgent.findMany.mockResolvedValue([]);
  prisma.campaignAgent.deleteMany.mockResolvedValue({ count: 0 });
  prisma.campaignAgent.upsert.mockResolvedValue({});
  prisma.agentSchedule.upsert.mockResolvedValue({});
  prisma.agentSchedule.deleteMany.mockResolvedValue({ count: 0 });
  prisma.agencyProfile.findUnique.mockResolvedValue({ deliveryTimeZone: 'America/New_York' });
  prisma.$transaction.mockResolvedValue([]);

  app = Fastify({ logger: false });
  await app.register(registerAgentRosterRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

/* ── Reading the roster ────────────────────────────────────────────────────── */

describe('GET /api/v1/agent-roster', () => {
  it('reads only the acting agency, and only its agents', async () => {
    await app.inject({ method: 'GET', url: '/api/v1/agent-roster' });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'agency-a', roles: { some: { role: { name: 'AGENT' } } } },
      })
    );
    expect(prisma.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'agency-a', status: 'ACTIVE' } })
    );
  });

  it('reports an agent who is ready as having nothing blocking them', async () => {
    prisma.user.findMany.mockResolvedValue([agentRow()]);
    prisma.campaignAgent.findMany.mockResolvedValue([{ userId: 'u-1', campaignId: 'c-1' }]);

    const response = await app.inject({ method: 'GET', url: '/api/v1/agent-roster' });
    const agent = (response.json() as any).data.agents[0];

    expect(agent.blockedReason).toBeNull();
    expect(agent.extension).toBe('1042');
    expect(agent.hasSipCredential).toBe(true);
    expect(agent.campaignIds).toEqual(['c-1']);
  });

  it('names the licence before the campaign when both are missing', async () => {
    prisma.user.findMany.mockResolvedValue([agentRow({ metadata: {} })]);
    prisma.campaignAgent.findMany.mockResolvedValue([]);

    const response = await app.inject({ method: 'GET', url: '/api/v1/agent-roster' });

    // Granting a campaign to an unlicensed agent changes nothing, so sending
    // somebody to do that first wastes the trip.
    expect((response.json() as any).data.agents[0].blockedReason).toMatch(/licensed states/i);
  });

  it('names the campaign once the licence exists', async () => {
    prisma.user.findMany.mockResolvedValue([agentRow()]);
    prisma.campaignAgent.findMany.mockResolvedValue([]);

    const response = await app.inject({ method: 'GET', url: '/api/v1/agent-roster' });
    expect((response.json() as any).data.agents[0].blockedReason).toMatch(/campaign/i);
  });

  it("names the agent's own switch once every setup blocker is clear", async () => {
    prisma.user.findMany.mockResolvedValue([
      agentRow({
        availableForCalls: false,
        availabilityChangedAt: new Date('2026-09-21T12:30:00.000Z'),
      }),
    ]);
    prisma.campaignAgent.findMany.mockResolvedValue([{ userId: 'u-1', campaignId: 'c-1' }]);

    const response = await app.inject({ method: 'GET', url: '/api/v1/agent-roster' });
    const agent = (response.json() as any).data.agents[0];

    expect(agent.blockedBy).toBe('UNAVAILABLE');
    expect(agent.blockedReason).toMatch(/phone off/i);
    expect(agent.availableForCalls).toBe(false);
    // "Since when" is the question an owner asks next: a lunch break and
    // somebody who went off on Tuesday read identically without it.
    expect(agent.availabilityChangedAt).toBe('2026-09-21T12:30:00.000Z');
  });

  it('names a setup blocker ahead of the agent being off', async () => {
    prisma.user.findMany.mockResolvedValue([agentRow({ availableForCalls: false })]);
    prisma.campaignAgent.findMany.mockResolvedValue([]);

    const response = await app.inject({ method: 'GET', url: '/api/v1/agent-roster' });
    const agent = (response.json() as any).data.agents[0];

    // The campaign is the owner's to fix and will still be missing when the
    // agent comes back. Reporting the break instead sends nobody to fix it.
    expect(agent.blockedBy).toBe('NO_CAMPAIGN');
    expect(agent.blockedReason).toMatch(/campaign/i);
  });

  it('treats a missing availability value as available, never as off', async () => {
    const row = agentRow({});
    delete (row as Record<string, unknown>).availableForCalls;
    prisma.user.findMany.mockResolvedValue([row]);
    prisma.campaignAgent.findMany.mockResolvedValue([{ userId: 'u-1', campaignId: 'c-1' }]);

    const response = await app.inject({ method: 'GET', url: '/api/v1/agent-roster' });

    // Routing rings an agent it has not been told to stop ringing. A roster
    // that showed them as off would describe a state the dialer does not act
    // on, and send an owner looking for a problem that is not there.
    expect((response.json() as any).data.agents[0].blockedBy).toBeNull();
  });

  it('names the invitation before anything else', async () => {
    prisma.user.findMany.mockResolvedValue([
      agentRow({ status: 'PENDING', metadata: {}, sipCredential: null }),
    ]);

    const response = await app.inject({ method: 'GET', url: '/api/v1/agent-roster' });
    expect((response.json() as any).data.agents[0].blockedReason).toMatch(/invitation/i);
  });

  it('treats a RESERVATION as not yet provisioned', async () => {
    prisma.user.findMany.mockResolvedValue([
      agentRow({
        sipCredential: { extension: '1042', status: 'ACTIVE', passwordEncrypted: null },
      }),
    ]);
    prisma.campaignAgent.findMany.mockResolvedValue([{ userId: 'u-1', campaignId: 'c-1' }]);

    const response = await app.inject({ method: 'GET', url: '/api/v1/agent-roster' });
    const agent = (response.json() as any).data.agents[0];

    // A reservation has no password, so it cannot register and cannot ring.
    expect(agent.hasSipCredential).toBe(false);
    expect(agent.blockedReason).toMatch(/softphone/i);
  });
});

/* ── Assigning campaigns ───────────────────────────────────────────────────── */

describe('PUT /api/v1/agent-roster/:userId/campaigns', () => {
  const url = '/api/v1/agent-roster/u-1/campaigns';
  /* `Campaign.id` is `@default(uuid())`, so the schema requires one. */
  const CAMPAIGN_A = '00000000-0000-4000-8000-000000000001';
  const CAMPAIGN_B = '00000000-0000-4000-8000-000000000002';

  it('refuses an agent who is not in the acting agency', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    const response = await app.inject({
      method: 'PUT',
      url,
      payload: { campaignIds: [CAMPAIGN_A] },
    });

    /*
     * The isolation that matters. `:userId` is client-supplied; without the
     * tenant filter this writes an assignment putting ANOTHER agency's user
     * into this agency's call pool.
     */
    expect(response.statusCode).toBe(404);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('looks the agent up scoped to the acting agency', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u-1', roles: [{ role: { name: 'AGENT' } }] });
    prisma.campaign.findMany.mockResolvedValue([{ id: CAMPAIGN_A }]);

    await app.inject({ method: 'PUT', url, payload: { campaignIds: [CAMPAIGN_A] } });

    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u-1', tenantId: 'agency-a' } })
    );
  });

  it('refuses a campaign that is not the acting agencys', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u-1', roles: [{ role: { name: 'AGENT' } }] });
    // The agency owns neither of the ids asked for.
    prisma.campaign.findMany.mockResolvedValue([]);

    const response = await app.inject({
      method: 'PUT',
      url,
      payload: { campaignIds: [CAMPAIGN_B] },
    });

    // The other direction of the same defect: this agency's agent must not be
    // written into another agency's call pool.
    expect(response.statusCode).toBe(400);
    expect((response.json() as any).error.code).toBe('UNKNOWN_CAMPAIGN');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses an account that does not hold the AGENT role', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u-1', roles: [{ role: { name: 'ANALYST' } }] });

    const response = await app.inject({ method: 'PUT', url, payload: { campaignIds: [] } });

    expect(response.statusCode).toBe(400);
    expect((response.json() as any).error.code).toBe('NOT_AN_AGENT');
  });

  it('replaces the set in ONE transaction', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u-1', roles: [{ role: { name: 'AGENT' } }] });
    prisma.campaign.findMany.mockResolvedValue([{ id: CAMPAIGN_A }]);

    const response = await app.inject({
      method: 'PUT',
      url,
      payload: { campaignIds: [CAMPAIGN_A] },
    });

    expect(response.statusCode).toBe(200);
    /*
     * One transaction, not a delete and then an insert. Outside one there is a
     * window in which the agent is assigned to nothing, and a dialer reading
     * during it routes them no calls.
     */
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);

    // Removes what was not listed...
    expect(prisma.campaignAgent.deleteMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'agency-a',
        userId: 'u-1',
        campaignId: { notIn: [CAMPAIGN_A] },
      },
    });
    // ...and adds what was.
    expect(prisma.campaignAgent.upsert).toHaveBeenCalledTimes(1);
  });

  it('takes an agent off every campaign when given an empty set', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u-1', roles: [{ role: { name: 'AGENT' } }] });

    const response = await app.inject({ method: 'PUT', url, payload: { campaignIds: [] } });

    expect(response.statusCode).toBe(200);
    expect(prisma.campaignAgent.upsert).not.toHaveBeenCalled();
    // The sentinel keeps `notIn` non-empty so the delete matches every row.
    expect(prisma.campaignAgent.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: 'agency-a', userId: 'u-1', campaignId: { notIn: ['-'] } },
    });
  });

  it('rejects a body that is not a list of campaign ids', async () => {
    const response = await app.inject({ method: 'PUT', url, payload: { campaignIds: 'c-1' } });
    expect(response.statusCode).toBe(400);
    expect((response.json() as any).error.code).toBe('VALIDATION_ERROR');
  });
});

/* ── Per-agent settings ────────────────────────────────────────────────────── */

describe('PATCH /api/v1/agent-roster/:userId', () => {
  const url = '/api/v1/agent-roster/u-1';

  it('merges metadata rather than replacing it', async () => {
    prisma.user.findFirst.mockResolvedValue({
      id: 'u-1',
      metadata: { licensedStates: ['TN', 'GA'], extension: '1042' },
    });

    await app.inject({ method: 'PATCH', url, payload: { maxConcurrentCalls: 3 } });

    /*
     * The property this exists for. A fresh object here would silently revoke
     * the agent's licence as a side effect of changing their call limit.
     */
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u-1' },
      data: {
        metadata: { licensedStates: ['TN', 'GA'], extension: '1042', maxConcurrentCalls: 3 },
      },
    });
  });

  it('refuses an agent who is not in the acting agency', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    const response = await app.inject({ method: 'PATCH', url, payload: { maxConcurrentCalls: 2 } });

    expect(response.statusCode).toBe(404);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('refuses a concurrency that no human could answer', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url,
      payload: { maxConcurrentCalls: 50 },
    });

    // A typo here delivers calls to somebody who cannot answer them, which the
    // agency then pays for.
    expect(response.statusCode).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('refuses zero', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url,
      payload: { maxConcurrentCalls: 0 },
    });
    expect(response.statusCode).toBe(400);
  });
});

/* ── Working hours ─────────────────────────────────────────────────────────── */

describe('the roster read', () => {
  it('carries each agents schedule and the clock it is written in', async () => {
    prisma.user.findMany.mockResolvedValue([
      agentRow({ schedule: { days: ['MON', 'TUE'], startTime: '09:00', endTime: '17:00' } }),
    ]);
    prisma.campaignAgent.findMany.mockResolvedValue([{ userId: 'u-1', campaignId: 'c-1' }]);

    const response = await app.inject({ method: 'GET', url: '/api/v1/agent-roster' });
    const body = (response.json() as any).data;

    expect(body.agents[0].schedule).toEqual({
      days: ['MON', 'TUE'],
      startTime: '09:00',
      endTime: '17:00',
    });
    /*
     * There is deliberately no per-agent timezone -- the agency's is the clock
     * its billing day is measured on -- so the screen has to be told which one
     * the times mean.
     */
    expect(body.deliveryTimeZone).toBe('America/New_York');
  });

  it('reports null for an agent whose hours are not enforced', async () => {
    prisma.user.findMany.mockResolvedValue([agentRow()]);
    prisma.campaignAgent.findMany.mockResolvedValue([{ userId: 'u-1', campaignId: 'c-1' }]);

    const response = await app.inject({ method: 'GET', url: '/api/v1/agent-roster' });
    // Null, not an empty schedule: the two mean opposite things to routing.
    expect((response.json() as any).data.agents[0].schedule).toBeNull();
  });
});

describe('PUT /api/v1/agent-roster/:userId/schedule', () => {
  const url = '/api/v1/agent-roster/u-1/schedule';

  it('refuses an agent who is not in the acting agency', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    const response = await app.inject({
      method: 'PUT',
      url,
      payload: { days: ['MON'], startTime: '09:00', endTime: '17:00' },
    });

    expect(response.statusCode).toBe(404);
    expect(prisma.agentSchedule.upsert).not.toHaveBeenCalled();
  });

  it('saves a schedule for this agency and agent', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u-1' });

    const response = await app.inject({
      method: 'PUT',
      url,
      payload: { days: ['MON', 'WED'], startTime: '09:00', endTime: '17:00' },
    });

    expect(response.statusCode).toBe(200);
    expect(prisma.agentSchedule.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u-1' },
        create: expect.objectContaining({ tenantId: 'agency-a', userId: 'u-1' }),
      })
    );
  });

  it('accepts an overnight shift rather than reading it as a mistake', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u-1' });

    const response = await app.inject({
      method: 'PUT',
      url,
      payload: { days: ['FRI'], startTime: '21:00', endTime: '05:00' },
    });

    /*
     * A night shift is ordinary in this business. Refusing it would push a
     * night-shift agency back to having no schedule at all.
     */
    expect(response.statusCode).toBe(200);
  });

  it('accepts an empty day list, which is an agent on leave', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u-1' });

    const response = await app.inject({
      method: 'PUT',
      url,
      payload: { days: [], startTime: '09:00', endTime: '17:00' },
    });

    expect(response.statusCode).toBe(200);
    // A row IS written: "works no days" restricts, unlike having no row.
    expect(prisma.agentSchedule.upsert).toHaveBeenCalled();
  });

  it('clears the schedule on DELETE, which is not the same as no days', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u-1' });

    const response = await app.inject({ method: 'DELETE', url });

    expect(response.statusCode).toBe(200);
    /*
     * Deleted, not written empty: this returns the agent to unenforced hours.
     * It is a separate verb rather than a `null` body because a JSON null is
     * not reliably distinguishable from no body -- `apiClient.put(url, null)`
     * in the web app sends nothing, since `null` is falsy.
     */
    expect(prisma.agentSchedule.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: 'agency-a', userId: 'u-1' },
    });
    expect(prisma.agentSchedule.upsert).not.toHaveBeenCalled();
  });

  it('refuses to clear a schedule for an agent outside the acting agency', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    const response = await app.inject({ method: 'DELETE', url });

    expect(response.statusCode).toBe(404);
    expect(prisma.agentSchedule.deleteMany).not.toHaveBeenCalled();
  });

  it('is a no-op when there is no schedule to clear', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u-1' });
    prisma.agentSchedule.deleteMany.mockResolvedValue({ count: 0 });

    // Not a 404 about a row the caller never claimed existed.
    const response = await app.inject({ method: 'DELETE', url });
    expect(response.statusCode).toBe(200);
  });

  it('rejects a time that is not HH:MM', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u-1' });

    const response = await app.inject({
      method: 'PUT',
      url,
      payload: { days: ['MON'], startTime: '9am', endTime: '17:00' },
    });

    expect(response.statusCode).toBe(400);
    expect(prisma.agentSchedule.upsert).not.toHaveBeenCalled();
  });

  it('rejects a day key it does not recognise', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u-1' });

    const response = await app.inject({
      method: 'PUT',
      url,
      payload: { days: ['FUNDAY'], startTime: '09:00', endTime: '17:00' },
    });

    expect(response.statusCode).toBe(400);
  });
});
