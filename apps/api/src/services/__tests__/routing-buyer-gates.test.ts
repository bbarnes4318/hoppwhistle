/**
 * The buyer gates in `getEligibleEndpoints`.
 *
 * A buyer endpoint is not rung when its buyer is not ACTIVE, when it has taken
 * its cap for the period, when it is outside its hours of operation, or when
 * an UPFRONT buyer's wallet cannot cover the price of the call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, redisGet } = vi.hoisted(() => ({
  prismaMock: {
    campaignBuyer: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    phoneNumber: { findMany: vi.fn() },
    campaign: { findFirst: vi.fn() },
    call: { count: vi.fn() },
    agentSipCredential: { findMany: vi.fn() },
    campaignAgent: { findMany: vi.fn() },
    agentSchedule: { findMany: vi.fn() },
    agencyProfile: { findUnique: vi.fn() },
  },
  redisGet: vi.fn(),
}));

vi.mock('../../lib/prisma.js', () => ({ getPrismaClient: () => prismaMock }));
vi.mock('../../lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../redis.js', () => ({ getRedisClient: () => ({ get: redisGet }) }));
vi.mock('../buyer-live-status-service.js', () => ({
  liveStatusService: { getTargetsLiveStatus: vi.fn(() => Promise.resolve(new Map())) },
}));

import { capCounterKey, capPeriodKey, isWithinHoursOfOperation } from '../routing-buyer-gates.js';
import { RoutingService } from '../routing.js';

interface RowOptions {
  buyerStatus?: string;
  billingType?: string;
  walletBalance?: number;
  capConsumedToday?: number;
  maxCap?: number;
  capPeriod?: string;
  hoursOfOperation?: unknown;
  timezone?: string | null;
  basePrice?: number;
  pricePerBillableCall?: number | null;
  campaignPrice?: number;
}

function buyerRow(id: string, options: RowOptions = {}) {
  return {
    buyerId: id,
    buyerEndpointId: `ep-${id}`,
    destinationNumber: '+18005550100',
    priority: 0,
    weight: 100,
    pricePerBillableCall: options.pricePerBillableCall ?? null,
    buyer: {
      id,
      name: id,
      status: options.buyerStatus ?? 'ACTIVE',
      billingType: options.billingType ?? 'TERMS',
      walletBalance: options.walletBalance ?? 0,
      stats: { capConsumedToday: options.capConsumedToday ?? 0 },
    },
    buyerEndpoint: {
      id: `ep-${id}`,
      name: id,
      status: 'ACTIVE',
      maxConcurrency: 0,
      acceptedStates: [],
      weight: 100,
      maxCap: options.maxCap ?? 0,
      capPeriod: options.capPeriod ?? 'DAY',
      hoursOfOperation: options.hoursOfOperation ?? null,
      timezone: options.timezone === undefined ? 'America/New_York' : options.timezone,
      basePrice: options.basePrice ?? 0,
    },
    campaign: { buyerPricePerBillableCall: options.campaignPrice ?? 0 },
  };
}

async function eligibleBuyers(rows: unknown[]): Promise<string[]> {
  prismaMock.campaignBuyer.findMany.mockResolvedValue(rows);
  const eligible = await new RoutingService().getEligibleEndpoints('tenant-1', 'campaign-1', {});
  return eligible.map(ep => ep.buyerId);
}

beforeEach(() => {
  vi.clearAllMocks();
  redisGet.mockResolvedValue(null);
  prismaMock.user.findMany.mockResolvedValue([]);
  prismaMock.phoneNumber.findMany.mockResolvedValue([]);
  prismaMock.campaign.findFirst.mockResolvedValue({ metadata: {} });
  prismaMock.agentSipCredential.findMany.mockResolvedValue([]);
  prismaMock.campaignAgent.findMany.mockResolvedValue([]);
  prismaMock.agentSchedule.findMany.mockResolvedValue([]);
  prismaMock.agencyProfile.findUnique.mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('buyer status', () => {
  it('excludes a PAUSED buyer', async () => {
    expect(
      await eligibleBuyers([buyerRow('paused', { buyerStatus: 'PAUSED' }), buyerRow('live')])
    ).toEqual(['live']);
  });
});

describe('caps', () => {
  it("excludes an endpoint whose Redis counter has reached today's cap", async () => {
    redisGet.mockImplementation((key: string) =>
      Promise.resolve(key.startsWith('routing:cap:ep-capped:') ? '5' : null)
    );

    expect(
      await eligibleBuyers([buyerRow('capped', { maxCap: 5 }), buyerRow('open', { maxCap: 5 })])
    ).toEqual(['open']);
  });

  it('keeps an endpoint below its cap, and one with no cap at all', async () => {
    redisGet.mockResolvedValue('4');
    expect(await eligibleBuyers([buyerRow('below', { maxCap: 5 }), buyerRow('uncapped')])).toEqual([
      'below',
      'uncapped',
    ]);
  });

  it('falls back to BuyerStats.capConsumedToday when Redis cannot be read', async () => {
    redisGet.mockRejectedValue(new Error('redis down'));

    expect(
      await eligibleBuyers([
        buyerRow('capped', { maxCap: 3, capConsumedToday: 3 }),
        buyerRow('open', { maxCap: 3, capConsumedToday: 1 }),
      ])
    ).toEqual(['open']);
  });

  it('keys the counter by endpoint and by the period in the endpoint timezone', () => {
    // 03:30 UTC on the 28th is still the 27th in New York.
    const now = new Date('2026-09-28T03:30:00Z');
    expect(capPeriodKey('DAY', 'America/New_York', now)).toBe('DAY:2026-09-27');
    expect(capPeriodKey('HOUR', 'America/New_York', now)).toBe('HOUR:2026-09-27T23');
    expect(capPeriodKey('MONTH', 'America/New_York', now)).toBe('MONTH:2026-09');
    expect(capCounterKey('ep-1', 'DAY:2026-09-27')).toBe('routing:cap:ep-1:DAY:2026-09-27');
  });
});

describe('hours of operation', () => {
  // Sunday 27 September 2026, 23:00 in New York.
  const SUNDAY_NIGHT = new Date('2026-09-28T03:00:00Z');

  it('excludes an endpoint outside every window for today', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(SUNDAY_NIGHT);

    expect(
      await eligibleBuyers([
        buyerRow('closed', { hoursOfOperation: { sun: [{ start: '09:00', end: '17:00' }] } }),
        buyerRow('late', { hoursOfOperation: { sun: [{ start: '18:00', end: '23:59' }] } }),
        buyerRow('always'),
      ])
    ).toEqual(['late', 'always']);
  });

  it('reads the clock in the endpoint timezone, defaulting to America/New_York', () => {
    const hours = { sun: [{ start: '18:00', end: '23:59' }] };
    expect(isWithinHoursOfOperation(hours, null, SUNDAY_NIGHT)).toBe(true);
    // Monday 03:00 in UTC: no Monday window.
    expect(isWithinHoursOfOperation(hours, 'UTC', SUNDAY_NIGHT)).toBe(false);
  });

  it('treats a day with no windows as closed and no hours at all as open', () => {
    expect(
      isWithinHoursOfOperation({ mon: [{ start: '00:00', end: '23:59' }] }, null, SUNDAY_NIGHT)
    ).toBe(false);
    expect(isWithinHoursOfOperation(null, null, SUNDAY_NIGHT)).toBe(true);
  });
});

describe('UPFRONT wallet', () => {
  it('excludes an UPFRONT buyer whose wallet is below the price of the call', async () => {
    expect(
      await eligibleBuyers([
        buyerRow('broke', { billingType: 'UPFRONT', walletBalance: 20, pricePerBillableCall: 25 }),
        buyerRow('funded', { billingType: 'UPFRONT', walletBalance: 25, pricePerBillableCall: 25 }),
        buyerRow('terms', { billingType: 'TERMS', walletBalance: 0, pricePerBillableCall: 25 }),
      ])
    ).toEqual(['funded', 'terms']);
  });

  it('prices the call the way billing does: override, else campaign, else endpoint base', async () => {
    expect(
      await eligibleBuyers([
        buyerRow('campaign-price', {
          billingType: 'UPFRONT',
          walletBalance: 10,
          campaignPrice: 15,
        }),
        buyerRow('base-price', { billingType: 'UPFRONT', walletBalance: 10, basePrice: 12 }),
        buyerRow('cheap', { billingType: 'UPFRONT', walletBalance: 10, campaignPrice: 8 }),
      ])
    ).toEqual(['cheap']);
  });
});
