/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses */
/**
 * A white-label agency keeps its Leaderboard to its OWNER and ADMIN.
 *
 * Its agents are answered 403 by `GET /api/v1/leaderboard`, and `getAgentToday`
 * is told not to rank them (`withStanding: false`), so Today carries no
 * standing. A normal agency's agents, and every owner, are unchanged.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/prisma.js', () => ({ getPrismaClient: () => ({}) }));

/** Who the stubbed `authenticate` signs in as. */
const principal = vi.hoisted(() => ({ current: {} as Record<string, any> }));
vi.mock('../middleware/auth.js', () => ({
  authenticate: vi.fn((request: { user?: unknown }) => {
    request.user = principal.current;
    return Promise.resolve(undefined);
  }),
}));

vi.mock('../lib/tenant-context.js', () => ({
  resolveTenant: () => 'agency-a',
  getActingUserId: () => 'user-1',
}));

vi.mock('../lib/licensed-states.js', () => ({
  resolveStateAuthority: () => Promise.resolve({ restricted: false, licensed: new Set() }),
}));

const getLeaderboard = vi.hoisted(() => vi.fn());
vi.mock('../services/leaderboard/leaderboard.js', () => ({ getLeaderboard }));

const getAgentToday = vi.hoisted(() => vi.fn());
vi.mock('../services/agent/agent-today.js', () => ({ getAgentToday }));

import { isWhiteLabelAgent } from '../lib/white-label.js';
import { registerAgentTodayRoutes } from '../routes/agent-today.js';
import { registerLeaderboardRoutes } from '../routes/leaderboard.js';

const WL_AGENT = { userId: 'user-1', roles: ['AGENT'], tenantWhiteLabel: true };
const WL_OWNER = { userId: 'user-1', roles: ['OWNER'], tenantWhiteLabel: true };
const AGENT = { userId: 'user-1', roles: ['AGENT'], tenantWhiteLabel: false };

let app: FastifyInstance;

beforeEach(async () => {
  vi.clearAllMocks();
  getLeaderboard.mockResolvedValue({ rows: [] });
  getAgentToday.mockResolvedValue({ standing: null });
  app = Fastify({ logger: false });
  await app.register(registerLeaderboardRoutes);
  await app.register(registerAgentTodayRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('isWhiteLabelAgent', () => {
  it('is an agent on the white-label tier, and nobody else', () => {
    expect(isWhiteLabelAgent(WL_AGENT)).toBe(true);
    expect(isWhiteLabelAgent(WL_OWNER)).toBe(false);
    expect(isWhiteLabelAgent({ ...WL_OWNER, roles: ['ADMIN', 'AGENT'] })).toBe(false);
    expect(isWhiteLabelAgent(AGENT)).toBe(false);
    expect(isWhiteLabelAgent(null)).toBe(false);
  });
});

describe('GET /api/v1/leaderboard', () => {
  it("refuses a white-label agency's agent, and never reads the board", async () => {
    principal.current = WL_AGENT;
    const res = await app.inject({ method: 'GET', url: '/api/v1/leaderboard' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('LEADERBOARD_UNAVAILABLE');
    expect(getLeaderboard).not.toHaveBeenCalled();
  });

  it("answers a white-label owner and a normal agency's agent", async () => {
    for (const who of [WL_OWNER, AGENT]) {
      principal.current = who;
      const res = await app.inject({ method: 'GET', url: '/api/v1/leaderboard' });
      expect(res.statusCode).toBe(200);
    }
    expect(getLeaderboard).toHaveBeenCalledTimes(2);
  });
});

describe('GET /api/v1/agent/today', () => {
  it("does not rank a white-label agency's agent", async () => {
    principal.current = WL_AGENT;
    const res = await app.inject({ method: 'GET', url: '/api/v1/agent/today' });
    expect(res.statusCode).toBe(200);
    expect(getAgentToday.mock.calls[0][2].withStanding).toBe(false);
  });

  it("ranks a normal agency's agent", async () => {
    principal.current = AGENT;
    await app.inject({ method: 'GET', url: '/api/v1/agent/today' });
    expect(getAgentToday.mock.calls[0][2].withStanding).toBe(true);
  });
});
