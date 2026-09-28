/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/require-await -- assertions run over parsed JSON responses; the Redis fake is async to match the client */
import { CallDirection, CallStatus, RoleName } from '@prisma/client';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { registerStaffOnly } from '../middleware/staff-only.js';
import { computeLiveMetrics } from '../routes/live-metrics.js';
import { getWhiteLabelToday } from '../routes/white-label-today.js';
import { getDeliveryToday } from '../services/billing/delivery-view.js';
import { getAgencyStrip } from '../services/billing/live-strip.js';
import { getAgencyLiveBoard } from '../services/live/agency-board.js';
import {
  IN_FLIGHT_WINDOW_MS,
  callInProgressWhere,
  isCallInProgress,
} from '../services/live/in-progress.js';
import { getLiveBoard } from '../services/live/platform-board.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * One definition of "in progress", asserted on every screen that shows it.
 *
 * The defect: the strip read "Calls 0 · 3 in progress" while Today read "Calls
 * up 0", because the delivery panel counted any answered call with no end time
 * as in progress forever, and the live boards bounded it to four hours. A call
 * answered five hours ago whose hangup was never written is a stuck row, and
 * no screen may show it as up.
 */

const redis = vi.hoisted(() => ({ store: new Map<string, string>() }));

vi.mock('../services/redis.js', () => ({
  getRedisClient: () => ({
    get: async (key: string) => redis.store.get(key) ?? null,
    set: async (key: string, value: string) => {
      redis.store.set(key, value);
      return 'OK';
    },
    setex: async (key: string, _ttl: number, value: string) => {
      redis.store.set(key, value);
      return 'OK';
    },
    mget: async (keys: string[]) => keys.map(key => redis.store.get(key) ?? null),
    del: async (key: string) => (redis.store.delete(key) ? 1 : 0),
  }),
  closeRedisClient: async () => {},
}));

const HOUR = 60 * 60 * 1000;

describe('callInProgressWhere / isCallInProgress', () => {
  const now = new Date('2026-09-28T15:00:00.000Z');

  it('is status in flight, no end time, and created inside the window', () => {
    expect(callInProgressWhere(now)).toEqual({
      status: { in: ['INITIATED', 'RINGING', 'ANSWERED'] },
      endedAt: null,
      createdAt: { gte: new Date(now.getTime() - IN_FLIGHT_WINDOW_MS) },
    });
  });

  it('drops a call answered five hours ago with no end time', () => {
    const stuck = {
      status: 'ANSWERED',
      endedAt: null,
      createdAt: new Date(now.getTime() - 5 * HOUR),
    };
    expect(isCallInProgress(stuck, now)).toBe(false);
  });

  it('keeps a call that connected two minutes ago', () => {
    const up = { status: 'ANSWERED', endedAt: null, createdAt: new Date(now.getTime() - 120_000) };
    expect(isCallInProgress(up, now)).toBe(true);
  });

  it('drops a call that has ended, or has finished in any other way', () => {
    const recent = new Date(now.getTime() - 60_000);
    expect(isCallInProgress({ status: 'ANSWERED', endedAt: now, createdAt: recent }, now)).toBe(
      false
    );
    expect(isCallInProgress({ status: 'COMPLETED', endedAt: null, createdAt: recent }, now)).toBe(
      false
    );
  });
});

const gate = databaseGate();
announceSkip('Call in progress', gate);

const TEST_JWT_SECRET = 'call-in-progress-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('Call in progress suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `call in progress suite cannot run: ${gate.reason}`).toBe(true);
  });
});

describe.skipIf(!gate.available)('a call answered five hours ago with no endedAt', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;
  let fixture: { tenantId: string; ownerId: string; stuckAgent: string; liveAgent: string };

  beforeAll(async () => {
    app = Fastify();
    await app.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await app.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(app);
    registerStaffOnly(app);
    const { registerAgentRosterRoutes } = await import('../routes/agent-roster.js');
    await app.register(registerAgentRosterRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    prisma = getPrismaClient();
    redis.store.clear();
    for (const table of ['audit_logs', 'roles', 'tenants']) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }
    const roleIds: Record<string, string> = {};
    for (const name of [RoleName.OWNER, RoleName.AGENT]) {
      roleIds[name] = (await prisma.role.create({ data: { name, permissions: [] } })).id;
    }
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tenant = await prisma.tenant.create({
      data: {
        name: 'Stuck Row Agency',
        slug: `stuck-${stamp}`,
        status: 'ACTIVE',
        whiteLabel: true,
      },
    });
    const user = async (role: RoleName, label: string) =>
      (
        await prisma.user.create({
          data: {
            tenantId: tenant.id,
            email: `${label}-${stamp}@agency.local`,
            status: 'ACTIVE',
            roles: { create: { roleId: roleIds[role] } },
          },
        })
      ).id;
    fixture = {
      tenantId: tenant.id,
      ownerId: await user(RoleName.OWNER, 'owner'),
      stuckAgent: await user(RoleName.AGENT, 'stuck'),
      liveAgent: await user(RoleName.AGENT, 'live'),
    };

    const now = Date.now();
    const base = {
      tenantId: tenant.id,
      toNumber: '+15550000000',
      direction: CallDirection.INBOUND,
      status: CallStatus.ANSWERED,
      endedAt: null,
    };
    // The stuck row: answered five hours ago, hangup never written.
    await prisma.call.create({
      data: {
        ...base,
        callSid: `stuck-${stamp}`,
        createdAt: new Date(now - 5 * HOUR),
        answeredAt: new Date(now - 5 * HOUR + 10_000),
        answeredByUserId: fixture.stuckAgent,
      },
    });
    // The control: really up, two minutes in.
    await prisma.call.create({
      data: {
        ...base,
        callSid: `live-${stamp}`,
        createdAt: new Date(now - 120_000),
        answeredAt: new Date(now - 110_000),
        answeredByUserId: fixture.liveAgent,
      },
    });
  });

  it('is not in progress on the delivery panel or the strip above every page', async () => {
    expect((await getDeliveryToday(fixture.tenantId, { prisma })).callsInProgress).toBe(1);
    expect((await getAgencyStrip(fixture.tenantId, { prisma })).callsInProgress).toBe(1);
  });

  it('is not in flight on the agency or the platform live board', async () => {
    expect((await getAgencyLiveBoard(fixture.tenantId, { prisma })).totals.callsInFlight).toBe(1);
    const platform = await getLiveBoard({ prisma, includeNonProduction: true });
    expect(platform.agencies.find(row => row.tenantId === fixture.tenantId)?.callsInFlight).toBe(1);
  });

  it('is not up on Today or in the live metrics', async () => {
    const today = await getWhiteLabelToday(fixture.tenantId, {
      prisma,
      readStatuses: async () => new Map(),
    });
    expect(today.now.callsUp).toBe(1);

    const metrics = await computeLiveMetrics(prisma.call, {
      tenantId: fixture.tenantId,
      role: 'admin',
      profile: { isAdminOrOwner: true, publisherId: null, buyerId: null },
    });
    expect(metrics.callsInFlight).toBe(1);
  });

  it('is not the call its agent is on, on the Agents floor', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/agent-roster/floor',
      headers: {
        authorization: `Bearer ${app.jwt.sign({
          userId: fixture.ownerId,
          tenantId: fixture.tenantId,
          email: 'owner@agency.local',
        })}`,
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    const agents = response.json().data.agents as any[];
    expect(agents.find(a => a.id === fixture.stuckAgent).currentCall).toBeNull();
    expect(agents.find(a => a.id === fixture.liveAgent).currentCall).not.toBeNull();
  });
});
