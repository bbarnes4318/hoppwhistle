/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses */
/**
 * The agent's own "where do my calls ring" control.
 *
 * Agents can send their calls to their own cell instead of the softphone, or
 * back again, without asking the agency. It writes the same
 * `users.metadata.cellForwardNumber` the Agents page writes, so the two always
 * agree, and it must never disturb the other keys in `metadata` (licensed
 * states, call limit) or reach a row outside the acting agency.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  user: { findFirst: vi.fn(), updateMany: vi.fn() },
  auditLog: { create: vi.fn() },
  agentStateEvent: { create: vi.fn() },
}));

vi.mock('../lib/prisma.js', () => ({ getPrismaClient: () => prisma }));

vi.mock('../lib/tenant-context.js', () => ({
  getActingTenantId: () => 'agency-a',
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
  principal = { userId: 'agent-1' };
  prisma.user.findFirst.mockResolvedValue({
    metadata: { licensedStates: ['TN'], maxConcurrentCalls: 2 },
  });
  prisma.user.updateMany.mockResolvedValue({ count: 1 });
  prisma.auditLog.create.mockResolvedValue({});

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

describe('GET /api/v1/agent/call-destination', () => {
  it('reports the softphone when no cell is set', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/agent/call-destination' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ringOn: 'softphone', cellForwardNumber: null });
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'agent-1', tenantId: 'agency-a' } })
    );
  });

  it('reports the cell when one is set', async () => {
    prisma.user.findFirst.mockResolvedValue({ metadata: { cellForwardNumber: '+18655551234' } });

    const response = await app.inject({ method: 'GET', url: '/api/v1/agent/call-destination' });

    expect(response.json()).toEqual({ ringOn: 'cell', cellForwardNumber: '+18655551234' });
  });

  it('refuses an unauthenticated caller', async () => {
    principal = undefined;

    const response = await app.inject({ method: 'GET', url: '/api/v1/agent/call-destination' });

    expect(response.statusCode).toBe(401);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });
});

describe('PUT /api/v1/agent/call-destination', () => {
  it('sends calls to the cell, normalised, keeping the rest of metadata', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/agent/call-destination',
      payload: { cellForwardNumber: '(865) 555-1234' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ringOn: 'cell', cellForwardNumber: '+18655551234' });
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'agent-1', tenantId: 'agency-a' },
      data: {
        metadata: {
          licensedStates: ['TN'],
          maxConcurrentCalls: 2,
          cellForwardNumber: '+18655551234',
        },
      },
    });
  });

  it('goes back to the softphone on null, removing the key', async () => {
    prisma.user.findFirst.mockResolvedValue({
      metadata: { licensedStates: ['TN'], cellForwardNumber: '+18655551234' },
    });

    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/agent/call-destination',
      payload: { cellForwardNumber: null },
    });

    expect(response.json()).toEqual({ ringOn: 'softphone', cellForwardNumber: null });
    expect(prisma.user.updateMany.mock.calls[0][0].data.metadata).toEqual({
      licensedStates: ['TN'],
    });
  });

  it('treats an empty string as the softphone', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/agent/call-destination',
      payload: { cellForwardNumber: '  ' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().ringOn).toBe('softphone');
  });

  it('refuses a number that is not a US phone number, writing nothing', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/agent/call-destination',
      payload: { cellForwardNumber: '555-1234' },
    });

    expect(response.statusCode).toBe(400);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('refuses a missing body rather than turning forwarding off', async () => {
    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/agent/call-destination',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('answers 404 when the agent is not in the acting agency', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/agent/call-destination',
      payload: { cellForwardNumber: '8655551234' },
    });

    expect(response.statusCode).toBe(404);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('still saves when the audit log cannot be written', async () => {
    prisma.auditLog.create.mockRejectedValue(new Error('table gone'));

    const response = await app.inject({
      method: 'PUT',
      url: '/api/v1/agent/call-destination',
      payload: { cellForwardNumber: '8655551234' },
    });

    expect(response.statusCode).toBe(200);
    expect(prisma.user.updateMany).toHaveBeenCalled();
  });
});
