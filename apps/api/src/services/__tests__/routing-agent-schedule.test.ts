/**
 * Not ringing an agent who is off shift.
 *
 * ── The gap ──────────────────────────────────────────────────────────────────
 *
 * `AgencyProfile` carried delivery days and hours for the WHOLE agency, and
 * routing knew nothing about hours at all -- it gated on licence, SIP
 * registration and concurrency and nothing else. An agency running two shifts
 * could not express it, so an agent who finished at 2pm kept being rung at 7pm:
 * the call reached a phone nobody was sitting at and was not offered to the
 * agent who was.
 *
 * ── The property that must not break ─────────────────────────────────────────
 *
 * An agent with NO schedule is unaffected. Every agent starts without one, so a
 * gate that excluded them would take the whole platform off the queue the
 * moment it shipped. The exclusion is positive-only: an agent is dropped only
 * when they have a schedule and this moment falls outside it. Most of these
 * tests are that direction.
 *
 * The hour arithmetic itself is `agent-schedule.test.ts`; this asserts the
 * wiring -- that routing reads the rows, resolves the agency's clock once, and
 * that the gate composes with the others rather than replacing them.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  campaignBuyer: { findMany: vi.fn() },
  campaignAgent: { findMany: vi.fn() },
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

vi.mock('../telephony/sip-registrations.js', () => ({
  // Registration is its own gate with its own suite; here it never filters.
  getRegisteredExtensions: vi.fn(() => Promise.resolve(null)),
}));

const agencyClock = vi.hoisted(() => vi.fn<Parameters<AgencyClock>, ReturnType<AgencyClock>>());
vi.mock('../telephony/agent-schedule.js', async importOriginal => {
  // The real `isWithinSchedule`, because its behaviour IS what is being wired;
  // only the clock is pinned, so these tests do not depend on the wall time.
  const actual = await importOriginal<typeof import('../telephony/agent-schedule.js')>();
  return { ...actual, agencyClock: (...args: Parameters<AgencyClock>) => agencyClock(...args) };
});

import { RoutingService } from '../routing.js';
import type { agencyClock as realAgencyClock } from '../telephony/agent-schedule.js';

type AgencyClock = typeof realAgencyClock;

function assignment(extension: string) {
  return {
    buyerId: `buyer-${extension}`,
    buyerEndpointId: `endpoint-${extension}`,
    destinationNumber: extension,
    priority: 0,
    weight: 100,
    buyer: { id: `buyer-${extension}`, name: `Agent ${extension}`, status: 'ACTIVE' },
    buyerEndpoint: {
      id: `endpoint-${extension}`,
      name: `Agent ${extension}`,
      status: 'ACTIVE',
      maxConcurrency: 10,
      acceptedStates: [],
      weight: 100,
    },
  };
}

interface Agent {
  userId: string;
  extension: string;
  schedule?: { days: string[]; startTime: string; endTime: string };
  licensedStates?: string[];
}

async function eligibleExtensions(options: {
  agents: Agent[];
  /** The agency-local moment, or null for "could not resolve the zone". */
  clock: { day: string; minutes: number } | null;
  timeZone?: string;
  scheduleError?: Error;
  activeCalls?: number;
}): Promise<string[]> {
  prisma.campaignBuyer.findMany.mockResolvedValue(options.agents.map(a => assignment(a.extension)));
  prisma.campaignAgent.findMany.mockResolvedValue([]);
  prisma.user.findMany.mockResolvedValue(
    options.agents.map(a => ({
      id: a.userId,
      metadata: { licensedStates: a.licensedStates ?? ['TN'] },
    }))
  );
  prisma.agentSipCredential.findMany.mockResolvedValue(
    options.agents.map(a => ({ userId: a.userId, extension: a.extension }))
  );
  prisma.phoneNumber.findMany.mockResolvedValue([]);
  prisma.call.count.mockResolvedValue(options.activeCalls ?? 0);

  if (options.scheduleError) {
    prisma.agentSchedule.findMany.mockRejectedValue(options.scheduleError);
  } else {
    prisma.agentSchedule.findMany.mockResolvedValue(
      options.agents.filter(a => a.schedule).map(a => ({ userId: a.userId, ...a.schedule! }))
    );
  }
  prisma.agencyProfile.findUnique.mockResolvedValue({
    deliveryTimeZone: options.timeZone ?? 'America/New_York',
  });
  agencyClock.mockReturnValue(options.clock);

  const eligible = await new RoutingService().getEligibleEndpoints('tenant-1', 'campaign-1', {
    callerId: '+14235551212',
    callerState: 'TN',
  });
  return eligible.map(ep => ep.destination).sort();
}

const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI'];

beforeEach(() => {
  vi.clearAllMocks();
});

/* ── The thing that did not work ───────────────────────────────────────────── */

describe('an agent outside their working hours', () => {
  it('is not rung', async () => {
    const eligible = await eligibleExtensions({
      agents: [
        {
          userId: 'u-1',
          extension: '1000',
          schedule: { days: WEEKDAYS, startTime: '09:00', endTime: '17:00' },
        },
      ],
      clock: { day: 'WED', minutes: 19 * 60 },
    });

    // 7pm. They finished at 5. This call used to ring a phone nobody was at.
    expect(eligible).toEqual([]);
  });

  it('leaves the call to the agent who IS on shift', async () => {
    const eligible = await eligibleExtensions({
      agents: [
        {
          userId: 'u-morning',
          extension: '1000',
          schedule: { days: WEEKDAYS, startTime: '06:00', endTime: '14:00' },
        },
        {
          userId: 'u-evening',
          extension: '1001',
          schedule: { days: WEEKDAYS, startTime: '14:00', endTime: '22:00' },
        },
      ],
      clock: { day: 'TUE', minutes: 19 * 60 },
    });

    // Two shifts on one agency, which is the case that could not be expressed.
    expect(eligible).toEqual(['1001']);
  });

  it('rings a night-shift agent in the early hours', async () => {
    const eligible = await eligibleExtensions({
      agents: [
        {
          userId: 'u-night',
          extension: '1000',
          schedule: { days: ['FRI'], startTime: '21:00', endTime: '05:00' },
        },
      ],
      clock: { day: 'SAT', minutes: 2 * 60 },
    });

    // The half a naive gate drops: 2am Saturday belongs to Friday's shift.
    expect(eligible).toEqual(['1000']);
  });
});

/* ── Absence is not a constraint ───────────────────────────────────────────── */

describe('an agent with no schedule', () => {
  it('is rung at any hour', async () => {
    /*
     * THE property. Every agent starts here; a gate that excluded them would
     * silence the platform the moment it shipped.
     */
    const eligible = await eligibleExtensions({
      agents: [{ userId: 'u-1', extension: '1000' }],
      clock: { day: 'SUN', minutes: 3 * 60 },
    });

    expect(eligible).toEqual(['1000']);
  });

  it('is unaffected by a colleague who does have one', async () => {
    const eligible = await eligibleExtensions({
      agents: [
        { userId: 'u-1', extension: '1000' },
        {
          userId: 'u-2',
          extension: '1001',
          schedule: { days: WEEKDAYS, startTime: '09:00', endTime: '17:00' },
        },
      ],
      clock: { day: 'SUN', minutes: 3 * 60 },
    });

    expect(eligible).toEqual(['1000']);
  });
});

describe('when the hours cannot be established', () => {
  it('filters nothing when the agency clock will not resolve', async () => {
    const eligible = await eligibleExtensions({
      agents: [
        {
          userId: 'u-1',
          extension: '1000',
          schedule: { days: WEEKDAYS, startTime: '09:00', endTime: '17:00' },
        },
      ],
      clock: null,
    });

    // A bad timezone string must not silence an agency's agents.
    expect(eligible).toEqual(['1000']);
  });

  it('filters nothing when the schedules cannot be read', async () => {
    const eligible = await eligibleExtensions({
      agents: [
        {
          userId: 'u-1',
          extension: '1000',
          schedule: { days: WEEKDAYS, startTime: '09:00', endTime: '17:00' },
        },
      ],
      clock: { day: 'SUN', minutes: 3 * 60 },
      scheduleError: new Error('relation "agent_schedules" does not exist'),
    });

    // Including the window where code is deployed ahead of the migration.
    expect(eligible).toEqual(['1000']);
  });
});

/* ── Composition and cost ──────────────────────────────────────────────────── */

describe('the gate does not replace the ones already there', () => {
  it('still excludes an on-shift agent who is unlicensed for the caller', async () => {
    const eligible = await eligibleExtensions({
      agents: [
        {
          userId: 'u-1',
          extension: '1000',
          licensedStates: ['FL'],
          schedule: { days: WEEKDAYS, startTime: '09:00', endTime: '17:00' },
        },
      ],
      clock: { day: 'WED', minutes: 13 * 60 },
    });

    // Being on shift is not a licence.
    expect(eligible).toEqual([]);
  });

  it('still excludes an on-shift agent at their concurrency limit', async () => {
    const eligible = await eligibleExtensions({
      agents: [
        {
          userId: 'u-1',
          extension: '1000',
          schedule: { days: WEEKDAYS, startTime: '09:00', endTime: '17:00' },
        },
      ],
      clock: { day: 'WED', minutes: 13 * 60 },
      activeCalls: 1,
    });

    expect(eligible).toEqual([]);
  });

  it('resolves the agency clock once, not once per agent', async () => {
    await eligibleExtensions({
      agents: [
        {
          userId: 'u-1',
          extension: '1000',
          schedule: { days: WEEKDAYS, startTime: '09:00', endTime: '17:00' },
        },
        {
          userId: 'u-2',
          extension: '1001',
          schedule: { days: WEEKDAYS, startTime: '09:00', endTime: '17:00' },
        },
        {
          userId: 'u-3',
          extension: '1002',
          schedule: { days: WEEKDAYS, startTime: '09:00', endTime: '17:00' },
        },
      ],
      clock: { day: 'WED', minutes: 13 * 60 },
    });

    /*
     * Per agent it would resolve the same zone N times and, worse, could land
     * two agents in one agency on different days if the reads straddled
     * midnight.
     */
    expect(agencyClock).toHaveBeenCalledTimes(1);
  });

  it('does not resolve a clock at all when nobody has a schedule', async () => {
    await eligibleExtensions({
      agents: [{ userId: 'u-1', extension: '1000' }],
      clock: { day: 'WED', minutes: 13 * 60 },
    });

    // The common case stays free.
    expect(agencyClock).not.toHaveBeenCalled();
  });

  it('reads the schedules scoped to the agency', async () => {
    await eligibleExtensions({
      agents: [{ userId: 'u-1', extension: '1000' }],
      clock: { day: 'WED', minutes: 13 * 60 },
    });

    expect(prisma.agentSchedule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: 'tenant-1' } })
    );
  });
});
