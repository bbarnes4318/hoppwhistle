/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses */
/**
 * The agent's own on/off switch.
 *
 * ── What was wrong ───────────────────────────────────────────────────────────
 *
 * An agent had no working way to stop calls reaching them. Two controls looked
 * like they did it: a dropdown in the call-centre header bound to a React
 * `useState` that was never sent anywhere, and `AgentStatusSelector`, which
 * writes a Redis key that `services/routing.ts` deliberately ignores and that
 * the softphone overwrites with an unconditional 'available' on every
 * reconnect. So an agent at lunch kept being rung, and the call went to
 * somebody who could not take it instead of to somebody who could.
 *
 * ── The properties asserted here ─────────────────────────────────────────────
 *
 *   1. The write is SCOPED to the acting agency as well as the acting user. A
 *      toggle must never be able to reach a row outside the caller's agency.
 *   2. ABSENCE IS NOT "OFF". A row that cannot be read answers `true`, because
 *      routing will ring that agent, and a screen that said otherwise would
 *      tell them calls are stopped while the phone keeps ringing.
 *   3. Only a BOOLEAN toggles it. A missing or string body is refused rather
 *      than coerced -- `'false'` is truthy, and coercing it would turn an
 *      agent's phone ON while they were reading the word "false".
 *   4. The transition is LOGGED, under its own status strings, and a failure
 *      to log never fails the toggle.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  user: { findFirst: vi.fn(), updateMany: vi.fn() },
  agentStateEvent: { create: vi.fn() },
  call: { findMany: vi.fn(), findFirst: vi.fn() },
}));

vi.mock('../lib/prisma.js', () => ({ getPrismaClient: () => prisma }));

const actingTenantId = vi.hoisted(() => vi.fn(() => 'agency-a' as string | null));
vi.mock('../lib/tenant-context.js', () => ({
  getActingTenantId: (...args: unknown[]) => actingTenantId(...(args as [])),
  describeTenantRefusal: () => ({
    statusCode: 409,
    error: { code: 'TENANT_REQUIRED', message: 'Pick an agency' },
  }),
}));

vi.mock('../services/event-bus.js', () => ({
  eventBus: { publish: vi.fn(() => Promise.resolve(undefined)) },
}));

vi.mock('../services/redis.js', () => ({
  getRedisClient: () => ({
    get: vi.fn(() => Promise.resolve(null)),
    setex: vi.fn(() => Promise.resolve('OK')),
    del: vi.fn(() => Promise.resolve(1)),
  }),
}));

vi.mock('../services/freeswitch-service.js', () => ({ freeswitchService: {} }));
vi.mock('../services/call-state.js', () => ({ callStateService: {} }));
vi.mock('../services/lead-service.js', () => ({ leadService: {} }));
vi.mock('../services/tcpa-validation-service.js', () => ({ tcpaValidationService: {} }));
vi.mock('../services/billing/delivery-gate.js', () => ({
  isDeliveryAllowed: vi.fn(() => Promise.resolve({ allowed: true })),
}));

import { registerAgentPhoneRoutes } from '../routes/agent-phone.js';

let app: FastifyInstance;
let principal: { userId?: string } | undefined;

beforeEach(async () => {
  vi.clearAllMocks();
  actingTenantId.mockReturnValue('agency-a');
  principal = { userId: 'agent-1' };

  prisma.user.findFirst.mockResolvedValue({
    availableForCalls: true,
    availabilityChangedAt: null,
  });
  prisma.user.updateMany.mockResolvedValue({ count: 1 });
  prisma.agentStateEvent.create.mockResolvedValue({});

  app = Fastify({ logger: false });
  app.addHook('onRequest', (request, _reply, done) => {
    (request as any).user = principal;
    done();
  });
  await app.register(registerAgentPhoneRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('GET /api/v1/agent/availability', () => {
  it('reads the acting agent, inside the acting agency and no wider', async () => {
    await app.inject({ method: 'GET', url: '/api/v1/agent/availability' });

    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'agent-1', tenantId: 'agency-a' } })
    );
  });

  it('reports what the agent declared, and when', async () => {
    prisma.user.findFirst.mockResolvedValue({
      availableForCalls: false,
      availabilityChangedAt: new Date('2026-09-21T12:30:00.000Z'),
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/agent/availability' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      availableForCalls: false,
      changedAt: '2026-09-21T12:30:00.000Z',
    });
  });

  it('answers "available" when there is no row to read', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    const response = await app.inject({ method: 'GET', url: '/api/v1/agent/availability' });

    /*
     * Absence is not a constraint. Routing rings an agent it cannot read a
     * preference for, so the switch has to render ON. Answering `false` would
     * tell an agent their phone is off while it carries on ringing -- the one
     * failure mode this whole feature exists to remove.
     */
    expect(response.json().availableForCalls).toBe(true);
  });

  it('refuses an unauthenticated caller rather than guessing an agent', async () => {
    principal = undefined;

    const response = await app.inject({ method: 'GET', url: '/api/v1/agent/availability' });

    expect(response.statusCode).toBe(401);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });
});

describe('PUT /api/v1/agent/availability', () => {
  it('turns the phone off, scoped to the acting agent and agency', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/agent/availability',
      payload: { availableForCalls: false },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().availableForCalls).toBe(false);
    expect(prisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'agent-1', tenantId: 'agency-a' },
        data: expect.objectContaining({ availableForCalls: false }),
      })
    );
  });

  it('stamps when it changed, so "since when" is answerable', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/v1/agent/availability',
      payload: { availableForCalls: false },
    });

    const data = prisma.user.updateMany.mock.calls[0][0].data;
    expect(data.availabilityChangedAt).toBeInstanceOf(Date);
  });

  it("logs the transition under its own status, not the softphone's", async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/v1/agent/availability',
      payload: { availableForCalls: false },
    });
    expect(prisma.agentStateEvent.create).toHaveBeenCalledWith({
      data: { userId: 'agent-1', status: 'off-queue' },
    });

    await app.inject({
      method: 'PUT',
      url: '/api/v1/agent/availability',
      payload: { availableForCalls: true },
    });
    // A deliberate "I am back" and a tab reconnecting are different acts, and a
    // supervisor reading the log has to be able to tell them apart.
    expect(prisma.agentStateEvent.create).toHaveBeenLastCalledWith({
      data: { userId: 'agent-1', status: 'on-queue' },
    });
  });

  it('still toggles when the state log cannot be written', async () => {
    prisma.agentStateEvent.create.mockRejectedValue(new Error('table gone'));

    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/agent/availability',
      payload: { availableForCalls: false },
    });

    // The cost of a failed log is a gap in a reporting figure. The cost of a
    // failed toggle is an agent who cannot stop the phone ringing.
    expect(response.statusCode).toBe(200);
    expect(prisma.user.updateMany).toHaveBeenCalled();
  });

  it.each([
    ['a string', { availableForCalls: 'false' }],
    ['a number', { availableForCalls: 0 }],
    ['nothing', {}],
  ])('refuses %s rather than coercing it', async (_label, payload) => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/agent/availability',
      payload,
    });

    /*
     * `'false'` is truthy. Coercing it would turn an agent's phone ON while
     * they were looking at the word "false", which is the exact confusion this
     * endpoint exists to end.
     */
    expect(response.statusCode).toBe(400);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('refuses when the update matched no row in this agency', async () => {
    prisma.user.updateMany.mockResolvedValue({ count: 0 });

    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/agent/availability',
      payload: { availableForCalls: false },
    });

    // Answering 200 would tell the agent their phone is off when nothing was
    // written and the call is still coming.
    expect(response.statusCode).toBe(404);
    expect(prisma.agentStateEvent.create).not.toHaveBeenCalled();
  });

  it('refuses a caller with no agency to act in', async () => {
    actingTenantId.mockReturnValue(null);

    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/agent/availability',
      payload: { availableForCalls: false },
    });

    expect(response.statusCode).toBe(409);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });
});
