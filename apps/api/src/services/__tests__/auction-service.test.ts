/**
 * Auction Service Unit Tests
 *
 * Tests for the RTB Ping Engine auction logic
 */

import { Decimal } from '@prisma/client/runtime/library';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import { callerStateUnresolvedTotal } from '../../lib/metrics.js';

// Mock data must be defined before vi.mock calls
const mockPrisma = {
  buyerEndpoint: {
    findMany: vi.fn(),
  },
  call: {
    count: vi.fn(),
  },
  pingRequest: {
    create: vi.fn(),
    update: vi.fn(),
  },
  buyerBid: {
    createMany: vi.fn(),
    findFirst: vi.fn(),
  },
  apiKey: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
};

const mockRedis = {
  get: vi.fn(),
  incr: vi.fn(),
  expire: vi.fn(),
  setex: vi.fn(),
};

// Mock dependencies - paths are relative to the module being mocked
vi.mock('../../lib/prisma.js', () => ({
  getPrismaClient: () => mockPrisma,
}));

vi.mock('../redis.js', () => ({
  getRedisClient: () => mockRedis,
}));

vi.mock('../../lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Import after mocking
import { AuctionService, PingPayload } from '../auction-service.js';

describe('AuctionService', () => {
  let auctionService: AuctionService;

  // Test buyer endpoints
  const tnBuyer = {
    id: 'endpoint-tn',
    buyerId: 'buyer-tn',
    destination: 'sip:tn@example.com',
    basePrice: new Decimal('30.00'),
    pricingRules: null,
    acceptedStates: ['TN', 'KY', 'AL'],
    hoursOfOperation: null, // 24/7
    timezone: 'America/New_York',
    maxCap: 100,
    capPeriod: 'DAY',
    status: 'ACTIVE',
    buyer: {
      id: 'buyer-tn',
      name: 'TN Insurance Co',
    },
  };

  const flBuyer = {
    id: 'endpoint-fl',
    buyerId: 'buyer-fl',
    destination: 'sip:fl@example.com',
    basePrice: new Decimal('35.00'), // Higher base price
    pricingRules: null,
    acceptedStates: ['FL', 'GA', 'SC'],
    hoursOfOperation: null,
    timezone: 'America/New_York',
    maxCap: 100,
    capPeriod: 'DAY',
    status: 'ACTIVE',
    buyer: {
      id: 'buyer-fl',
      name: 'FL Insurance Co',
    },
  };

  const nationalBuyer = {
    id: 'endpoint-national',
    buyerId: 'buyer-national',
    destination: 'sip:national@example.com',
    basePrice: new Decimal('25.00'),
    pricingRules: [
      { field: 'age', op: 'gte', val: 65, adjustment: '10.00' }, // +$10 for seniors
    ],
    acceptedStates: [], // National = accepts all
    hoursOfOperation: null,
    timezone: 'America/New_York',
    maxCap: 0, // Unlimited
    capPeriod: 'DAY',
    status: 'ACTIVE',
    buyer: {
      id: 'buyer-national',
      name: 'National Insurance Co',
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    callerStateUnresolvedTotal.reset();
    auctionService = new AuctionService();

    // Default mock implementations
    mockRedis.get.mockResolvedValue(null);
    mockRedis.incr.mockResolvedValue(1);
    mockRedis.expire.mockResolvedValue(1);
    mockRedis.setex.mockResolvedValue('OK');
    mockPrisma.call.count.mockResolvedValue(0);
    mockPrisma.pingRequest.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: 'ping-123',
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    );
    mockPrisma.buyerBid.createMany.mockResolvedValue({ count: 1 });
    mockPrisma.buyerBid.findFirst.mockResolvedValue({ id: 'bid-123' });
    mockPrisma.pingRequest.update.mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Geo-Routing', () => {
    it('should pick TN buyer over FL buyer for TN caller', async () => {
      // Setup: Both TN and FL buyers available
      mockPrisma.buyerEndpoint.findMany.mockResolvedValue([tnBuyer, flBuyer]);

      const payload: PingPayload = {
        caller: {
          state: 'TN',
          zip: '37901',
          age: 55,
        },
        source: 'test',
      };

      const result = await auctionService.processPing('publisher-1', payload);

      // TN buyer should win (FL buyer should be filtered out)
      expect(result.bid).toBe(30); // TN buyer's price
      expect(result.ping_id).toBe('ping-123');
      expect(result.token).toBeDefined();
    });

    it('should pick FL buyer over TN buyer for FL caller', async () => {
      mockPrisma.buyerEndpoint.findMany.mockResolvedValue([tnBuyer, flBuyer]);

      const payload: PingPayload = {
        caller: {
          state: 'FL',
          zip: '33101',
          age: 55,
        },
        source: 'test',
      };

      const result = await auctionService.processPing('publisher-1', payload);

      // FL buyer should win (TN buyer should be filtered out)
      expect(result.bid).toBe(35); // FL buyer's price
    });

    it('should use national buyer when regional buyers are filtered out', async () => {
      mockPrisma.buyerEndpoint.findMany.mockResolvedValue([tnBuyer, flBuyer, nationalBuyer]);

      const payload: PingPayload = {
        caller: {
          state: 'CA', // California - not in TN or FL
          zip: '90210',
          age: 55,
        },
        source: 'test',
      };

      const result = await auctionService.processPing('publisher-1', payload);

      // National buyer should win (accepts all states)
      expect(result.bid).toBe(25); // National buyer's base price
    });

    it('resolves the state from ZIP when the publisher did not supply one', async () => {
      mockPrisma.buyerEndpoint.findMany.mockResolvedValue([tnBuyer, flBuyer]);

      const payload: PingPayload = {
        caller: { zip: '37901' }, // Knoxville, TN - no explicit state
        source: 'test',
      };

      const result = await auctionService.processPing('publisher-1', payload);

      expect(result.bid).toBe(30); // TN buyer wins via ZIP resolution
    });

    it('excludes a state-restricted buyer when the caller state cannot be resolved at all (fail-closed)', async () => {
      mockPrisma.buyerEndpoint.findMany.mockResolvedValue([tnBuyer, flBuyer]);

      const payload: PingPayload = {
        caller: {}, // no state, no zip, no phone
        source: 'test',
      };

      const result = await auctionService.processPing('publisher-1', payload);

      expect(result.bid).toBe(0);
      expect(result.message).toBe('No matching buyers after filtering');

      // The rejection reason must be distinguishable from an ordinary geo mismatch.
      const savedBids = mockPrisma.buyerBid.createMany.mock.calls[0][0].data as Array<{
        rejectionReason: string | null;
      }>;
      expect(savedBids.every(b => b.rejectionReason?.startsWith('STATE_UNRESOLVED'))).toBe(true);
    });

    it('still admits a National buyer when the caller state is unresolved', async () => {
      mockPrisma.buyerEndpoint.findMany.mockResolvedValue([tnBuyer, flBuyer, nationalBuyer]);

      const payload: PingPayload = {
        caller: {},
        source: 'test',
      };

      const result = await auctionService.processPing('publisher-1', payload);

      expect(result.bid).toBe(25); // National buyer, unaffected by unresolved state
    });

    it('emits the unresolved-state counter tagged with the rtb_ping ingress path', async () => {
      mockPrisma.buyerEndpoint.findMany.mockResolvedValue([nationalBuyer]);

      await auctionService.processPing('publisher-1', { caller: {}, source: 'test' });
      const afterUnresolved = await callerStateUnresolvedTotal.get();
      expect(afterUnresolved.values).toContainEqual(
        expect.objectContaining({ labels: { ingress_path: 'rtb_ping' }, value: 1 })
      );

      // A resolved caller state must not increment it further.
      await auctionService.processPing('publisher-1', { caller: { state: 'TN' }, source: 'test' });
      const afterResolved = await callerStateUnresolvedTotal.get();
      expect(afterResolved.values).toContainEqual(
        expect.objectContaining({ labels: { ingress_path: 'rtb_ping' }, value: 1 })
      );
    });
  });

  describe('Dynamic Pricing Rules', () => {
    it('should apply age-based pricing adjustment for seniors', async () => {
      mockPrisma.buyerEndpoint.findMany.mockResolvedValue([nationalBuyer]);

      const payload: PingPayload = {
        caller: {
          state: 'TN',
          age: 67, // Senior (>= 65)
        },
        source: 'test',
      };

      const result = await auctionService.processPing('publisher-1', payload);

      // Base $25 + $10 senior adjustment = $35
      expect(result.bid).toBe(35);
    });

    it('should NOT apply senior pricing for younger callers', async () => {
      mockPrisma.buyerEndpoint.findMany.mockResolvedValue([nationalBuyer]);

      const payload: PingPayload = {
        caller: {
          state: 'TN',
          age: 45, // Not a senior
        },
        source: 'test',
      };

      const result = await auctionService.processPing('publisher-1', payload);

      // Just base price, no adjustment
      expect(result.bid).toBe(25);
    });
  });

  describe('Cap Limits', () => {
    it('should filter out buyers that have exceeded their cap', async () => {
      // TN buyer is at cap
      const tnBuyerAtCap = { ...tnBuyer, maxCap: 50 };
      mockPrisma.buyerEndpoint.findMany.mockResolvedValue([tnBuyerAtCap, nationalBuyer]);
      mockPrisma.call.count.mockImplementation(({ where }) => {
        if (where.targetId === 'endpoint-tn') {
          return Promise.resolve(50); // At cap
        }
        return Promise.resolve(0);
      });

      const payload: PingPayload = {
        caller: { state: 'TN', age: 55 },
        source: 'test',
      };

      const result = await auctionService.processPing('publisher-1', payload);

      // National buyer should win since TN is at cap
      expect(result.bid).toBe(25);
    });

    it('should respect Redis reserved cap (thundering herd protection)', async () => {
      const tnBuyerNearCap = { ...tnBuyer, maxCap: 50 };
      mockPrisma.buyerEndpoint.findMany.mockResolvedValue([tnBuyerNearCap, nationalBuyer]);

      // SQL count = 45, Redis reserved = 10 → Total = 55 > 50 cap
      mockPrisma.call.count.mockImplementation(({ where }) => {
        if (where.targetId === 'endpoint-tn') {
          return Promise.resolve(45);
        }
        return Promise.resolve(0);
      });
      mockRedis.get.mockImplementation((key: string) => {
        if (key.includes('endpoint-tn')) {
          return Promise.resolve('10');
        }
        return Promise.resolve(null);
      });

      const payload: PingPayload = {
        caller: { state: 'TN', age: 55 },
        source: 'test',
      };

      const result = await auctionService.processPing('publisher-1', payload);

      // TN buyer should be filtered due to Redis reserved cap
      expect(result.bid).toBe(25); // National buyer wins
    });
  });

  describe('Idempotency', () => {
    it('should return cached result for duplicate request_id', async () => {
      const cachedResult = {
        ping_id: 'cached-ping',
        bid: 42.5,
        token: 'cached-token',
        expires_at: new Date().toISOString(),
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(cachedResult));

      const payload: PingPayload = {
        request_id: 'duplicate-123',
        caller: { state: 'TN' },
      };

      const result = await auctionService.processPing('publisher-1', payload);

      expect(result.ping_id).toBe('cached-ping');
      expect(result.bid).toBe(42.5);
      expect(mockPrisma.buyerEndpoint.findMany).not.toHaveBeenCalled();
    });
  });

  describe('No Matching Buyers', () => {
    it('should return bid=0 when all buyers are filtered', async () => {
      // Only FL buyer available, caller from TN
      mockPrisma.buyerEndpoint.findMany.mockResolvedValue([flBuyer]);

      const payload: PingPayload = {
        caller: { state: 'TN' },
      };

      const result = await auctionService.processPing('publisher-1', payload);

      expect(result.bid).toBe(0);
      expect(result.message).toContain('No matching buyers');
    });

    it('should return bid=0 when no buyers exist', async () => {
      mockPrisma.buyerEndpoint.findMany.mockResolvedValue([]);

      const payload: PingPayload = {
        caller: { state: 'TN' },
      };

      const result = await auctionService.processPing('publisher-1', payload);

      expect(result.bid).toBe(0);
      expect(result.message).toBe('No matching buyers');
    });
  });

  describe('Token Verification', () => {
    it('should generate valid signed tokens', async () => {
      mockPrisma.buyerEndpoint.findMany.mockResolvedValue([tnBuyer]);

      const payload: PingPayload = {
        caller: { state: 'TN' },
      };

      const result = await auctionService.processPing('publisher-1', payload);

      expect(result.token).toBeDefined();
      expect(result.token).toContain('.');

      // Verify the token
      const verification = await auctionService.verifyBidToken(result.token!);
      expect(verification.valid).toBe(true);
      expect(verification.pingId).toBe('ping-123');
      expect(verification.bidAmount).toBe(30);
      expect(verification.buyerId).toBe('buyer-tn');
    });

    it('should reject tampered tokens', async () => {
      const fakeToken = 'eyJhbGciOiJIUzI1NiJ9.eyJwaW5nX2lkIjoiZmFrZSJ9.invalid';
      const verification = await auctionService.verifyBidToken(fakeToken);

      expect(verification.valid).toBe(false);
      expect(verification.error).toBe('Invalid signature');
    });
  });
});
