/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses */
/**
 * The Agents screen's live floor and the per-agent day drawer.
 *
 * ── The properties asserted here ─────────────────────────────────────────────
 *
 *   1. TENANT ISOLATION. Every read is filtered by the acting agency, and the
 *      call id the softphone writes into Redis is read back THROUGH that filter
 *      -- it is a value from outside the database.
 *   2. The principal's view. An AGENT is refused with 403 by the real
 *      `requireAgencyPrincipal`, not a stub of it.
 *   3. Today's figures are `getAgentBreakdown`'s, passed through untouched, so
 *      the floor can never disagree with the table agents are coached from.
 *   4. `:userId` must be an AGENT of this agency, or the drawer is a 404.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  user: { findMany: vi.fn(), findFirst: vi.fn() },
  campaignAgent: { findMany: vi.fn() },
  call: { findMany: vi.fn(), groupBy: vi.fn() },
  agentStateEvent: { findMany: vi.fn() },
}));

vi.mock('../lib/prisma.js', () => ({ getPrismaClient: () => prisma }));

/** Who the stubbed `authenticate` signs in as. */
const principal = vi.hoisted(() => ({
  current: { userId: 'owner-1', tenantId: 'agency-a', roles: ['OWNER'] } as Record<string, any>,
}));
vi.mock('../middleware/auth.js', () => ({
  authenticate: vi.fn((request: { user?: unknown }) => {
    request.user = principal.current;
    return Promise.resolve(undefined);
  }),
}));

const resolveTenant = vi.hoisted(() => vi.fn(() => 'agency-a'));
vi.mock('../lib/tenant-context.js', () => ({
  resolveTenant: (...args: unknown[]) => resolveTenant(...(args as [])),
  getActingUserId: () => 'owner-1',
}));

vi.mock('../services/audit.js', () => ({ auditLog: vi.fn(() => Promise.resolve(undefined)) }));

const mget = vi.hoisted(() => vi.fn());
vi.mock('../services/redis.js', () => ({ getRedisClient: () => ({ mget }) }));

const getAgentBreakdown = vi.hoisted(() => vi.fn());
vi.mock('../services/billing/delivery-view.js', () => ({ getAgentBreakdown }));

import { registerAgentRosterRoutes } from '../routes/agent-roster.js';

/** A floor user row as the query selects it. */
function agentRow(overrides: Record<string, any> = {}) {
  return {
    id: 'u-1',
    email: 'dana@agency.test',
    firstName: 'Dana',
    lastName: 'Reed',
    status: 'ACTIVE',
    availableForCalls: true,
    metadata: { licensedStates: ['TN'] },
    sipCredential: { extension: '1042', status: 'ACTIVE', passwordEncrypted: 'enc:v1:x:y:z' },
    ...overrides,
  };
}

function breakdownRow(overrides: Record<string, any> = {}) {
  return {
    userId: 'u-1',
    name: 'Dana Reed',
    email: 'dana@agency.test',
    callsTaken: 7,
    applications: 2,
    annualizedPremium: 2400,
    closingPct: 28.57,
    talkTimeSeconds: 3300,
    availableSeconds: 5400,
    statusSince: null,
    hoursWorked: null,
    occupancyPct: null,
    currentStatus: 'available',
    ...overrides,
  };
}

let app: FastifyInstance;

beforeEach(async () => {
  vi.clearAllMocks();
  resolveTenant.mockReturnValue('agency-a');
  principal.current = { userId: 'owner-1', tenantId: 'agency-a', roles: ['OWNER'] };

  prisma.user.findMany.mockResolvedValue([]);
  prisma.user.findFirst.mockResolvedValue(null);
  prisma.campaignAgent.findMany.mockResolvedValue([]);
  prisma.call.findMany.mockResolvedValue([]);
  prisma.call.groupBy.mockResolvedValue([]);
  prisma.agentStateEvent.findMany.mockResolvedValue([]);
  mget.mockResolvedValue([]);
  getAgentBreakdown.mockResolvedValue({ agents: [] });

  app = Fastify({ logger: false });
  await app.register(registerAgentRosterRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

/* ── The floor ─────────────────────────────────────────────────────────────── */

describe('GET /api/v1/agent-roster/floor', () => {
  it('reads only the acting agency, and only its agents', async () => {
    prisma.user.findMany.mockResolvedValue([agentRow()]);

    const response = await app.inject({ method: 'GET', url: '/api/v1/agent-roster/floor' });

    expect(response.statusCode).toBe(200);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: 'agency-a', roles: { some: { role: { name: 'AGENT' } } } },
      })
    );
    for (const [args] of prisma.call.findMany.mock.calls) {
      expect(args.where.tenantId).toBe('agency-a');
    }
    expect(prisma.call.groupBy.mock.calls[0][0].where.tenantId).toBe('agency-a');
    expect(getAgentBreakdown).toHaveBeenCalledWith('agency-a', expect.anything());
  });

  it('refuses an AGENT: the floor is the principal view', async () => {
    principal.current = { userId: 'agent-1', tenantId: 'agency-a', roles: ['AGENT'] };

    const response = await app.inject({ method: 'GET', url: '/api/v1/agent-roster/floor' });

    expect(response.statusCode).toBe(403);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it("serves today's figures from getAgentBreakdown untouched", async () => {
    prisma.user.findMany.mockResolvedValue([agentRow(), agentRow({ id: 'u-2', firstName: 'Ari' })]);
    getAgentBreakdown.mockResolvedValue({
      agencyCallsTaken: 9,
      agencyApplications: 2,
      agencyClosingPct: 22.22,
      agents: [breakdownRow(), breakdownRow({ userId: null, name: 'Unattributed' })],
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/agent-roster/floor' });
    const [dana, ari] = response.json().data.agents;

    expect(dana.today).toEqual({
      callsTaken: 7,
      talkTimeSeconds: 3300,
      applications: 2,
      annualizedPremium: 2400,
      closingPct: 28.57,
      availableSeconds: 5400,
      occupancyPct: null,
    });
    // An agent with no row did nothing today: zeros, and no closing rate.
    expect(ari.today).toMatchObject({ callsTaken: 0, applications: 0, closingPct: null });
    // The agency line is the breakdown's own, unattributed calls included.
    expect(response.json().data.agency).toEqual({
      callsTaken: 9,
      applications: 2,
      closingPct: 22.22,
    });
    // Nothing is recomputed from calls here.
    expect(prisma.call.groupBy.mock.calls[0][0]._count).toBeUndefined();
  });

  it('names the answered call an agent is on, with presence from Redis', async () => {
    prisma.user.findMany.mockResolvedValue([agentRow()]);
    prisma.campaignAgent.findMany.mockResolvedValue([{ userId: 'u-1' }]);
    const answeredAt = new Date(Date.now() - 90_000);
    prisma.call.findMany.mockResolvedValueOnce([
      {
        id: 'call-1',
        callerId: '+16155550100',
        campaignName: null,
        buyerName: null,
        campaign: { name: 'Final Expense' },
        buyer: null,
        answeredByUserId: 'u-1',
        answeredAt,
        createdAt: answeredAt,
      },
    ]);
    mget.mockResolvedValue([
      JSON.stringify({ status: 'on-call', lastUpdated: answeredAt.toISOString() }),
    ]);

    const response = await app.inject({ method: 'GET', url: '/api/v1/agent-roster/floor' });
    const agent = response.json().data.agents[0];

    expect(agent).toMatchObject({
      name: 'Dana Reed',
      extension: '1042',
      softphoneStatus: 'on-call',
      statusSince: answeredAt.toISOString(),
      blockedBy: null,
    });
    expect(agent.currentCall).toMatchObject({
      callId: 'call-1',
      callerId: '+16155550100',
      campaignName: 'Final Expense',
      buyerName: null,
    });
    expect(agent.currentCall.seconds).toBeGreaterThanOrEqual(89);
  });

  it("falls back to the softphone's call id, read through the tenant filter", async () => {
    prisma.user.findMany.mockResolvedValue([agentRow()]);
    mget.mockResolvedValue([JSON.stringify({ status: 'on-call', currentCallId: 'call-x' })]);
    // The agency's own filter finds nothing: the id named another agency's call.
    prisma.call.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const response = await app.inject({ method: 'GET', url: '/api/v1/agent-roster/floor' });
    const agent = response.json().data.agents[0];

    expect(prisma.call.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { tenantId: 'agency-a', id: { in: ['call-x'] } } })
    );
    expect(agent.softphoneStatus).toBe('on-call');
    expect(agent.currentCall).toBeNull();
  });

  it('names the blocker, the same way the roster does', async () => {
    prisma.user.findMany.mockResolvedValue([agentRow()]);

    const response = await app.inject({ method: 'GET', url: '/api/v1/agent-roster/floor' });
    const agent = response.json().data.agents[0];

    expect(agent.blockedBy).toBe('NO_CAMPAIGN');
    expect(agent.softphoneStatus).toBe('offline');
  });
});

/* ── One agent's day ───────────────────────────────────────────────────────── */

describe('GET /api/v1/agent-roster/:userId/activity', () => {
  it('404s a user who is not an AGENT of this agency', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/agent-roster/u-other/activity',
    });

    expect(response.statusCode).toBe(404);
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'u-other',
          tenantId: 'agency-a',
          roles: { some: { role: { name: 'AGENT' } } },
        },
      })
    );
    expect(prisma.call.findMany).not.toHaveBeenCalled();
    expect(prisma.agentStateEvent.findMany).not.toHaveBeenCalled();
  });

  it('refuses an AGENT caller', async () => {
    principal.current = { userId: 'u-1', tenantId: 'agency-a', roles: ['AGENT'] };

    const response = await app.inject({ method: 'GET', url: '/api/v1/agent-roster/u-1/activity' });

    expect(response.statusCode).toBe(403);
  });

  it('rejects a malformed day', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/agent-roster/u-1/activity?day=yesterday',
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns that New York day's states and calls, in the agency", async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'u-1' });
    prisma.agentStateEvent.findMany.mockResolvedValue([
      { status: 'available', occurredAt: new Date('2026-09-15T13:00:00Z') },
    ]);
    prisma.call.findMany.mockResolvedValue([
      {
        id: 'call-1',
        createdAt: new Date('2026-09-15T14:00:00Z'),
        callerId: '+16155550100',
        campaignName: 'Final Expense',
        buyerName: null,
        campaign: null,
        buyer: { name: 'Acme Life' },
        connectedDuration: 312,
        disposition: 'SET_APPOINTMENT',
        primaryRecordingId: null,
        recordings: [{ id: 'rec-9' }],
      },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/agent-roster/u-1/activity?day=2026-09-15',
    });

    expect(response.statusCode).toBe(200);
    const eventsWhere = prisma.agentStateEvent.findMany.mock.calls[0][0].where;
    // Midnight in New York (EDT) is 04:00 UTC.
    expect(eventsWhere.occurredAt).toEqual({
      gte: new Date('2026-09-15T04:00:00.000Z'),
      lt: new Date('2026-09-16T04:00:00.000Z'),
    });
    const callArgs = prisma.call.findMany.mock.calls[0][0];
    expect(callArgs.where).toMatchObject({ tenantId: 'agency-a', answeredByUserId: 'u-1' });
    expect(callArgs.take).toBe(200);

    const data = response.json().data;
    expect(data.stateEvents).toEqual([
      { status: 'available', occurredAt: '2026-09-15T13:00:00.000Z' },
    ]);
    expect(data.calls[0]).toEqual({
      id: 'call-1',
      createdAt: '2026-09-15T14:00:00.000Z',
      callerId: '+16155550100',
      campaignName: 'Final Expense',
      buyerName: 'Acme Life',
      connectedDuration: 312,
      disposition: 'SET_APPOINTMENT',
      primaryRecordingId: 'rec-9',
    });
  });
});
