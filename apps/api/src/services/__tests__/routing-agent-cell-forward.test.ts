/**
 * An agent who takes calls on their own cell.
 *
 * `users.metadata.cellForwardNumber` makes routing dial the agent's mobile as
 * THEIR leg instead of the softphone. The properties asserted here:
 *
 *   1. The destination is the cell, and it needs no SIP credential.
 *   2. It is still the agent: licence, availability and working hours apply,
 *      resolved from the leg's agent id since a cell cannot be mapped back.
 *   3. The softphone registration gate does not apply -- there is no softphone.
 *   4. In `selectBestBuyer` the cell rings WITH the agent group (not as one
 *      weighted external pick) and is reported in `agentCellKeys`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  campaignBuyer: { findMany: vi.fn() },
  campaignAgent: { findMany: vi.fn() },
  campaign: { findFirst: vi.fn() },
  user: { findMany: vi.fn() },
  phoneNumber: { findMany: vi.fn() },
  call: { count: vi.fn() },
  agentSipCredential: { findMany: vi.fn() },
  agentSchedule: { findMany: vi.fn() },
  agencyProfile: { findUnique: vi.fn() },
}));

vi.mock('../../lib/prisma.js', () => ({ getPrismaClient: () => prisma }));

vi.mock('../../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../lib/geo.js', () => ({
  extractAreaCode: vi.fn(() => null),
  getStateFromAreaCode: vi.fn(() => null),
  isCallerStateAccepted: vi.fn(() => true),
}));

vi.mock('../buyer-live-status-service.js', () => ({
  liveStatusService: { getTargetsLiveStatus: vi.fn(() => Promise.resolve(new Map())) },
}));

vi.mock('../redis.js', () => ({
  getRedisClient: () => ({ get: vi.fn(() => Promise.resolve(null)) }),
}));

const getRegisteredExtensions = vi.hoisted(() => vi.fn());
vi.mock('../telephony/sip-registrations.js', () => ({ getRegisteredExtensions }));

import { RoutingService } from '../routing.js';

const CELL = '+18655551234';

function assignment(options: {
  userId: string;
  cell?: string;
  extension?: string | null;
  priority?: number;
}) {
  return {
    userId: options.userId,
    priority: options.priority ?? 0,
    user: {
      id: options.userId,
      status: 'ACTIVE',
      firstName: 'Dana',
      lastName: 'Reed',
      email: `${options.userId}@agency.test`,
      metadata: options.cell ? { cellForwardNumber: options.cell } : {},
      sipCredential: options.extension
        ? { extension: options.extension, status: 'ACTIVE', passwordEncrypted: 'enc:v1:x' }
        : null,
    },
  };
}

interface Scenario {
  assignments: ReturnType<typeof assignment>[];
  users: Array<{ id: string; metadata: Record<string, unknown>; availableForCalls?: boolean }>;
  credentials?: Array<{ userId: string; extension: string }>;
  registered?: string[];
  callerState?: string | null;
  schedules?: Array<{ userId: string; days: string[]; startTime: string; endTime: string }>;
}

function arrange(scenario: Scenario): void {
  prisma.campaignBuyer.findMany.mockResolvedValue([]);
  prisma.campaignAgent.findMany.mockResolvedValue(scenario.assignments);
  prisma.campaign.findFirst.mockResolvedValue({ metadata: {} });
  prisma.user.findMany.mockResolvedValue(
    scenario.users.map(u => ({ availableForCalls: true, ...u }))
  );
  prisma.phoneNumber.findMany.mockResolvedValue([]);
  prisma.call.count.mockResolvedValue(0);
  prisma.agentSipCredential.findMany.mockResolvedValue(scenario.credentials ?? []);
  prisma.agentSchedule.findMany.mockResolvedValue(scenario.schedules ?? []);
  prisma.agencyProfile.findUnique.mockResolvedValue({ deliveryTimeZone: 'America/New_York' });
  getRegisteredExtensions.mockResolvedValue(new Set(scenario.registered ?? []));
}

async function destinations(scenario: Scenario): Promise<string[]> {
  arrange(scenario);
  const eligible = await new RoutingService().getEligibleEndpoints('tenant-1', 'campaign-1', {
    callerId: '+14235551212',
    callerState: scenario.callerState ?? null,
  });
  return eligible.map(ep => ep.destination).sort();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('a cell-forwarding agent', () => {
  it('is rung on their cell, with no softphone credential and no registration', async () => {
    expect(
      await destinations({
        assignments: [assignment({ userId: 'u-1', cell: CELL })],
        users: [{ id: 'u-1', metadata: { cellForwardNumber: CELL } }],
        registered: [],
      })
    ).toEqual([CELL]);
  });

  it('is rung on the cell INSTEAD of a softphone they also have', async () => {
    expect(
      await destinations({
        assignments: [assignment({ userId: 'u-1', cell: CELL, extension: '1042' })],
        users: [{ id: 'u-1', metadata: { cellForwardNumber: CELL } }],
        credentials: [{ userId: 'u-1', extension: '1042' }],
        registered: ['1042'],
      })
    ).toEqual([CELL]);
  });

  it('ignores an unusable number and falls back to the softphone', async () => {
    expect(
      await destinations({
        assignments: [assignment({ userId: 'u-1', cell: 'call me', extension: '1042' })],
        users: [{ id: 'u-1', metadata: { cellForwardNumber: 'call me' } }],
        credentials: [{ userId: 'u-1', extension: '1042' }],
        registered: ['1042'],
      })
    ).toEqual(['1042']);
  });

  it('is still held to their licence', async () => {
    expect(
      await destinations({
        assignments: [assignment({ userId: 'u-1', cell: CELL })],
        users: [{ id: 'u-1', metadata: { cellForwardNumber: CELL, licensedStates: ['GA'] } }],
        callerState: 'TN',
      })
    ).toEqual([]);
  });

  it('is not rung when they have turned their phone off', async () => {
    expect(
      await destinations({
        assignments: [assignment({ userId: 'u-1', cell: CELL })],
        users: [{ id: 'u-1', metadata: { cellForwardNumber: CELL }, availableForCalls: false }],
      })
    ).toEqual([]);
  });

  it('is not rung outside their working hours', async () => {
    expect(
      await destinations({
        assignments: [assignment({ userId: 'u-1', cell: CELL })],
        users: [{ id: 'u-1', metadata: { cellForwardNumber: CELL } }],
        // An empty day list is an agent on leave: never within hours.
        schedules: [{ userId: 'u-1', days: [], startTime: '00:00', endTime: '23:59' }],
      })
    ).toEqual([]);
  });
});

describe('selectBestBuyer with a cell-forwarding agent', () => {
  it('rings the cell alongside softphone agents and reports it as an agent cell', async () => {
    arrange({
      assignments: [
        assignment({ userId: 'u-1', cell: CELL }),
        assignment({ userId: 'u-2', extension: '1043' }),
      ],
      users: [
        { id: 'u-1', metadata: { cellForwardNumber: CELL } },
        { id: 'u-2', metadata: {} },
      ],
      credentials: [{ userId: 'u-2', extension: '1043' }],
      registered: ['1043'],
    });

    const result = await new RoutingService().selectBestBuyer('tenant-1', 'campaign-1');

    expect(result?.endpoint.split(',').sort()).toEqual(['+18655551234', '1043']);
    expect(result?.agentCellKeys).toEqual(['8655551234']);
  });

  it('rings every cell-forwarding agent, not one weighted pick', async () => {
    const other = '+16155550199';
    arrange({
      assignments: [
        assignment({ userId: 'u-1', cell: CELL }),
        assignment({ userId: 'u-2', cell: other }),
      ],
      users: [
        { id: 'u-1', metadata: { cellForwardNumber: CELL } },
        { id: 'u-2', metadata: { cellForwardNumber: other } },
      ],
    });

    const result = await new RoutingService().selectBestBuyer('tenant-1', 'campaign-1');

    expect(result?.endpoint.split(',').sort()).toEqual([other, CELL].sort());
    expect(result?.agentCellKeys?.sort()).toEqual(['6155550199', '8655551234']);
  });

  it('reports no agent cells for a softphone-only plan', async () => {
    arrange({
      assignments: [assignment({ userId: 'u-2', extension: '1043' })],
      users: [{ id: 'u-2', metadata: {} }],
      credentials: [{ userId: 'u-2', extension: '1043' }],
      registered: ['1043'],
    });

    const result = await new RoutingService().selectBestBuyer('tenant-1', 'campaign-1');

    expect(result?.endpoint).toBe('1043');
    expect(result?.agentCellKeys).toBeUndefined();
  });
});
