/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */
import { Prisma } from '@prisma/client';
import Fastify from 'fastify';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock Redis state
const mockRedisData: Record<string, string> = {};
const mockRedis = {
  get: vi.fn(async key => mockRedisData[key] || null),
  set: vi.fn(async (key, val) => {
    mockRedisData[key] = val;
    return 'OK';
  }),
  setex: vi.fn(async (key, ttl, val) => {
    mockRedisData[key] = val;
    return 'OK';
  }),
  del: vi.fn(async key => {
    delete mockRedisData[key];
    return 1;
  }),
  exists: vi.fn(async key => (mockRedisData[key] ? 1 : 0)),
  expire: vi.fn(async (key, ttl) => 1),
  incr: vi.fn(async key => 1),
};

// Mock Prisma in-memory database
const mockPrismaData = {
  calls: [] as any[],
  pingRequests: [] as any[],
  buyerBids: [] as any[],
  phoneNumbers: [] as any[],
  accrualLedgers: [] as any[],
  buyerTransactions: [] as any[],
  buyers: [] as any[],
  buyerEndpoints: [] as any[],
  campaigns: [] as any[],
  campaignBuyers: [] as any[],
  campaignPublishers: [] as any[],
  publishers: [] as any[],
};

const mockPrisma = {
  $transaction: vi.fn(cb => cb(mockPrisma)),

  /*
   * Phase 3 delivery gating.
   *
   * `GET /api/v1/freeswitch/lookup` now asks the delivery gate before handing
   * over a destination, so these fixtures describe an agency that is
   * deliverable: agreed terms, a valid ACH mandate, a paid block on the ledger
   * and no unpaid settlement. Without them the gate reads an unreadable
   * account and refuses -- which is the correct production behaviour and would
   * make every routing assertion below fail for a reason that has nothing to do
   * with routing.
   *
   * The gate itself is driven against a real database in
   * `src/__tests__/delivery-gating-paths.test.ts`; these are the reads it makes.
   */
  agencyBillingProfile: {
    findUnique: vi.fn(async () => ({
      id: 'billing-profile-1',
      tenantId: 'tenant-1',
      dailyBlockApplications: 45,
      maxDailyDebit: 8978,
      ceilingPctBelowThreshold: 50,
      ceilingPctAtThreshold: 100,
      ceilingCleanSettlementThreshold: 10,
      ceilingPctOverride: null,
      stripeCustomerId: 'cus_test',
      achPaymentMethodId: 'pm_test',
      achMandateStatus: 'ACTIVE',
      achBankName: 'Test Bank',
      achLast4: '6789',
      suspendedAt: null,
      suspensionReason: null,
    })),
    updateMany: vi.fn(async () => ({ count: 1 })),
  },

  agencyRatingState: {
    findUnique: vi.fn(async () => ({
      tenantId: 'tenant-1',
      status: 'OPENING_BLOCK',
      currentRate: 134,
      openingRate: 134,
    })),
  },

  ratingReviewFlag: {
    findFirst: vi.fn(async () => null),
  },

  dailySettlement: {
    findMany: vi.fn(async () => []),
    findFirst: vi.fn(async () => null),
    findUnique: vi.fn(async () => null),
  },

  applicationCreditLedgerEntry: {
    // A paid block with credits left on it: the balance is positive, so the
    // gate allows delivery without touching the Overrun ceiling.
    aggregate: vi.fn(async () => ({ _sum: { quantity: 45 } })),
    groupBy: vi.fn(async () => []),
  },

  deliveryHoldEvent: {
    create: vi.fn(async () => ({ id: 'hold-1' })),
    findFirst: vi.fn(async () => null),
  },

  billingNotification: {
    create: vi.fn(async () => ({ id: 'notification-1' })),
    update: vi.fn(async () => ({ id: 'notification-1' })),
  },

  platformAdmin: {
    findMany: vi.fn(async () => []),
  },
  phoneNumber: {
    findFirst: vi.fn(async () => {
      return mockPrismaData.phoneNumbers[0] || null;
    }),
    update: vi.fn(async ({ where, data }) => {
      const idx = mockPrismaData.phoneNumbers.findIndex(
        p => p.id === where.id || p.number === where.number
      );
      if (idx !== -1) {
        mockPrismaData.phoneNumbers[idx] = { ...mockPrismaData.phoneNumbers[idx], ...data };
        return mockPrismaData.phoneNumbers[idx];
      }
      return null;
    }),
    updateMany: vi.fn(async () => ({ count: 1 })),
    findUnique: vi.fn(async ({ where }) => {
      return (
        mockPrismaData.phoneNumbers.find(p => p.id === where.id || p.number === where.number) ||
        null
      );
    }),
  },
  pingRequest: {
    create: vi.fn(async ({ data }) => {
      const ping = {
        id: `ping-${Date.now()}`,
        status: data.status || 'PROCESSING',
        publisherId: data.publisherId,
        requestId: data.requestId,
        vertical: data.vertical,
        payload: data.payload,
        createdAt: new Date(),
        bids: [],
      };
      mockPrismaData.pingRequests.push(ping);
      return ping;
    }),
    update: vi.fn(async ({ where, data }) => {
      const ping = mockPrismaData.pingRequests.find(p => p.id === where.id);
      if (ping) {
        Object.assign(ping, data);
        return ping;
      }
      return null;
    }),
    findUnique: vi.fn(async ({ where }) => {
      const ping = mockPrismaData.pingRequests.find(p => p.id === where.id);
      if (ping) {
        return {
          ...ping,
          publisher: mockPrismaData.publishers.find(p => p.id === ping.publisherId) || {
            tenantId: 'tenant-1',
          },
          bids: mockPrismaData.buyerBids
            .filter(b => b.pingRequestId === ping.id)
            .map(b => {
              const ep = mockPrismaData.buyerEndpoints.find(e => e.id === b.buyerEndpointId);
              return {
                ...b,
                buyerEndpoint: ep
                  ? {
                      ...ep,
                      buyer: mockPrismaData.buyers.find(by => by.id === ep.buyerId),
                    }
                  : undefined,
              };
            }),
        };
      }
      return null;
    }),
  },
  buyerBid: {
    createMany: vi.fn(async ({ data }) => {
      const bids = data.map((b: any) => ({
        id: `bid-${Math.random()}`,
        ...b,
        createdAt: new Date(),
      }));
      mockPrismaData.buyerBids.push(...bids);
      return { count: bids.length };
    }),
    findFirst: vi.fn(async ({ where }) => {
      return (
        mockPrismaData.buyerBids.find(
          b => b.pingRequestId === where.pingRequestId && b.status === where.status
        ) || null
      );
    }),
  },
  buyerEndpoint: {
    findMany: vi.fn(async () => {
      return mockPrismaData.buyerEndpoints.map(ep => ({
        ...ep,
        buyer: mockPrismaData.buyers.find(b => b.id === ep.buyerId),
      }));
    }),
    findUnique: vi.fn(async ({ where }) => {
      const ep = mockPrismaData.buyerEndpoints.find(e => e.id === where.id);
      if (ep) {
        return {
          ...ep,
          buyer: mockPrismaData.buyers.find(b => b.id === ep.buyerId),
        };
      }
      return null;
    }),
  },
  campaign: {
    findFirst: vi.fn(async () => {
      return mockPrismaData.campaigns[0] || null;
    }),
    findUnique: vi.fn(async ({ where }) => {
      return mockPrismaData.campaigns.find(c => c.id === where.id) || null;
    }),
  },
  campaignBuyer: {
    findMany: vi.fn(async () => {
      return mockPrismaData.campaignBuyers;
    }),
  },
  campaignPublisher: {
    findUnique: vi.fn(async () => {
      return mockPrismaData.campaignPublishers[0] || null;
    }),
  },
  publisher: {
    findUnique: vi.fn(async ({ where }) => {
      return mockPrismaData.publishers.find(p => p.id === where.id) || null;
    }),
  },
  buyer: {
    findUnique: vi.fn(async ({ where }) => {
      return mockPrismaData.buyers.find(b => b.id === where.id) || null;
    }),
    update: vi.fn(async ({ where, data }) => {
      const buyer = mockPrismaData.buyers.find(b => b.id === where.id);
      if (buyer) {
        if (data.walletBalance !== undefined) {
          buyer.walletBalance = data.walletBalance;
        }
        if (data.leadsRemaining !== undefined) {
          buyer.leadsRemaining = data.leadsRemaining;
        }
        if (data.status !== undefined) {
          buyer.status = data.status;
        }
        return buyer;
      }
      return null;
    }),
  },
  call: {
    create: vi.fn(async ({ data }) => {
      const call = {
        id: `call-${Date.now()}`,
        ...data,
        createdAt: new Date(),
      };
      mockPrismaData.calls.push(call);
      return call;
    }),
    update: vi.fn(async ({ where, data }) => {
      const call = mockPrismaData.calls.find(c => c.id === where.id);
      if (call) {
        Object.assign(call, data);
        return call;
      }
      return null;
    }),
    findUnique: vi.fn(async ({ where }) => {
      const call = mockPrismaData.calls.find(c => c.id === where.id);
      if (call) {
        return {
          ...call,
          buyer: mockPrismaData.buyers.find(b => b.id === call.buyerId),
          campaign: mockPrismaData.campaigns.find(c => c.id === call.campaignId),
          publisher: mockPrismaData.publishers.find(p => p.id === call.publisherId),
        };
      }
      return null;
    }),
    count: vi.fn(async () => 0),
  },
  accrualLedger: {
    findUnique: vi.fn(async ({ where }) => {
      return (
        mockPrismaData.accrualLedgers.find(l => l.idempotencyKey === where.idempotencyKey) || null
      );
    }),
    create: vi.fn(async ({ data }) => {
      const ledger = {
        id: `ledger-${Math.random()}`,
        ...data,
        createdAt: new Date(),
      };
      mockPrismaData.accrualLedgers.push(ledger);
      return ledger;
    }),
    update: vi.fn(async ({ where, data }) => {
      const ledger = mockPrismaData.accrualLedgers.find(l => l.id === where.id);
      if (ledger) {
        Object.assign(ledger, data);
        return ledger;
      }
      return null;
    }),
    deleteMany: vi.fn(async () => ({ count: 1 })),
  },
  buyerTransaction: {
    findFirst: vi.fn(async ({ where }) => {
      return (
        mockPrismaData.buyerTransactions.find(
          t => t.buyerId === where.buyerId && t.callId === where.callId && t.type === where.type
        ) || null
      );
    }),
    create: vi.fn(async ({ data }) => {
      const tx = {
        id: `tx-${Math.random()}`,
        ...data,
        createdAt: new Date(),
      };
      mockPrismaData.buyerTransactions.push(tx);
      return tx;
    }),
  },
  billingAccount: {
    findFirst: vi.fn(async () => {
      return { id: 'account-1', tenantId: 'tenant-1' };
    }),
  },
  didRoute: {
    findFirst: vi.fn(async () => null),
    findUnique: vi.fn(async () => null),
  },
};

// vi.mock paths
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

vi.mock('../audit.js', () => ({
  auditLog: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../../lib/geo.js', () => ({
  isCallerStateAccepted: () => true,
}));

vi.mock('../tcpa-validation-service.js', () => ({
  tcpaValidationService: {
    validateNumber: vi.fn().mockResolvedValue({ isLitigator: false }),
  },
}));

vi.mock('../event-bus.js', () => ({
  eventBus: {
    publish: vi.fn().mockResolvedValue(undefined),
  },
}));

// Imports after mocking
import { registerDidRouteRoutes } from '../../routes/did-routes.js';
import { auctionService } from '../auction-service.js';
import { postService } from '../post-service.js';
import {
  internalKeyHeaders,
  useTestInternalKey,
} from '../../__tests__/helpers/internal-key.js';

describe('End-to-End RTB Call Flow Path Test', () => {
  let app: any;

  // This suite drives `/api/v1/freeswitch/*`, which is now behind the
  // shared-secret guard. Authenticate the caller; never relax the guard.
  useTestInternalKey();

  beforeEach(async () => {
    vi.clearAllMocks();

    // Clear in-memory DB and Redis
    for (const key of Object.keys(mockPrismaData)) {
      (mockPrismaData as any)[key] = [];
    }
    for (const key of Object.keys(mockRedisData)) {
      delete mockRedisData[key];
    }

    // Set up mock database records
    mockPrismaData.phoneNumbers = [
      {
        id: 'phone-1',
        number: '+18005550100',
        poolType: 'POOL',
        poolStatus: 'AVAILABLE',
        status: 'ACTIVE',
        lastAssignedAt: null,
      },
    ];

    mockPrismaData.publishers = [
      {
        id: 'pub-1',
        tenantId: 'tenant-1',
        name: 'Traffic Source A',
        code: 'pubcode123',
        status: 'ACTIVE',
        metadata: {},
      },
    ];

    mockPrismaData.buyers = [
      {
        id: 'buyer-1',
        tenantId: 'tenant-1',
        name: 'Upfront Buyer Co',
        code: 'buyer123',
        status: 'ACTIVE',
        billingType: 'UPFRONT',
        walletBalance: new Prisma.Decimal('100.00'),
        leadsRemaining: 100,
        billableDuration: 60,
      },
    ];

    mockPrismaData.buyerEndpoints = [
      {
        id: 'ep-1',
        buyerId: 'buyer-1',
        name: 'Target Main',
        type: 'PSTN',
        destination: '+18005550150',
        status: 'ACTIVE',
        maxCap: 0,
        capPeriod: 'DAY',
        maxConcurrency: 0,
        weight: 100,
        acceptedStates: [],
        hoursOfOperation: null,
        timezone: 'America/New_York',
        basePrice: new Prisma.Decimal('15.00'),
        pricingRules: null,
        metadata: {},
      },
    ];

    mockPrismaData.campaigns = [
      {
        id: 'camp-1',
        tenantId: 'tenant-1',
        publisherId: 'pub-1',
        name: 'Prepaid Campaign',
        status: 'ACTIVE',
        billableDurationSeconds: 60,
        publisherPayoutPerBillableCall: new Prisma.Decimal('10.00'),
        buyerPricePerBillableCall: new Prisma.Decimal('20.00'),
        recordingEnabled: true,
        metadata: {},
      },
    ];

    mockPrismaData.campaignBuyers = [
      {
        id: 'cb-1',
        tenantId: 'tenant-1',
        campaignId: 'camp-1',
        buyerId: 'buyer-1',
        buyerEndpointId: 'ep-1',
        destinationNumber: '+18005550150',
        pricePerBillableCall: new Prisma.Decimal('20.00'),
        status: 'ACTIVE',
      },
    ];

    mockPrismaData.campaignPublishers = [
      {
        id: 'cp-1',
        tenantId: 'tenant-1',
        campaignId: 'camp-1',
        publisherId: 'pub-1',
        payoutPerBillableCall: new Prisma.Decimal('10.00'),
        status: 'ACTIVE',
      },
    ];

    // Setup Fastify App
    app = Fastify();
    await app.register(registerDidRouteRoutes);
    await app.ready();
  });

  it('should successfully complete the entire RTB Ping-Post call flow', async () => {
    // 1. Publisher POSTs ping (auction processes ping, returns bid token)
    const pingResult = await auctionService.processPing('pub-1', {
      request_id: 'ping-req-123',
      vertical: 'insurance',
      caller: { state: 'TN' },
      min_bid: 5,
    });

    expect(pingResult.bid).toBe(15.0);
    expect(pingResult.token).toBeDefined();
    const token = pingResult.token!;
    const pingId = pingResult.ping_id;

    // 2. Publisher POSTs token + caller number (accepts token, leases a number)
    const postResult = await postService.processPost(token, 'pub-1', '+18005550199');
    if (!postResult.accepted) {
      console.log('POST RESULT ERROR:', JSON.stringify(postResult, null, 2));
    }
    expect(postResult.accepted).toBe(true);
    expect(postResult.transfer_number).toBe('+18005550100');
    expect(postResult.ping_id).toBe(pingId);

    // Verify Redis route info was saved correctly
    expect(mockRedisData['route:did:+18005550100']).toBeDefined();
    const routeInfo = JSON.parse(mockRedisData['route:did:+18005550100']);
    expect(routeInfo.ping_id).toBe(pingId);
    expect(routeInfo.buyer_id).toBe('buyer-1');
    expect(routeInfo.rtb_bid_amount).toBe(15.0);
    expect(routeInfo.transfer_number).toBe('+18005550100');

    // 3. FreeSWITCH lookup finds the Redis RTB route before static DidRoute
    const lookupResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/freeswitch/lookup',
      headers: internalKeyHeaders,
      query: { did: '+18005550100', caller: '+18005550199' },
    });
    expect(lookupResponse.statusCode).toBe(200);
    const lookupData = JSON.parse(lookupResponse.body);
    expect(lookupData.destination).toBe('+18005550150');
    expect(lookupData.buyerId).toBe('buyer-1');
    expect(lookupData.routeId).toBe(`rtb-${pingId}`);
    expect(lookupData.routeType).toBe('RTB');

    // 4. FreeSWITCH CDR webhook is hit (creates Call, runs billingService, runs buyerBillingService)
    const cdrResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/freeswitch/cdr',
      headers: internalKeyHeaders,
      body: {
        callId: 'fs-call-uuid-123',
        routeId: `rtb-${pingId}`,
        tenantId: 'tenant-1',
        callerNumber: '+18005550199',
        did: '+18005550100',
        destination: '+18005550150',
        duration: 80,
        connectedDuration: 75,
        hangupCause: 'NORMAL_CLEARING',
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      },
    });

    expect(cdrResponse.statusCode).toBe(201);

    // 5. Assert Call properties are fully populated
    const call = mockPrismaData.calls[0];
    console.log('CALL DETAILS:', JSON.stringify(call, null, 2));
    console.log('ACC_LEDGERS:', JSON.stringify(mockPrismaData.accrualLedgers, null, 2));
    console.log('TRANSACTIONS:', JSON.stringify(mockPrismaData.buyerTransactions, null, 2));
    expect(call).toBeDefined();
    expect(call.buyerId).toBe('buyer-1');
    expect(call.publisherId).toBe('pub-1');
    expect(call.campaignId).toBe('camp-1');
    expect(call.targetId).toBe('ep-1');
    expect(call.billable).toBe(true);
    expect(call.callSource).toBe('INBOUND_RTB');
    expect(call.metadata.rtb).toBeDefined();
    expect(call.metadata.rtb.pingId).toBe(pingId);
    expect(call.metadata.rtb.bidAmount).toBe(15.0);

    // 6. Assert billing details: buyerBillableAmount uses RTB bid amount, payout is correct, cost/profit are correct
    expect(Number(call.buyerBillableAmount)).toBe(15.0); // Prioritized bid amount instead of Campaign default 20.00
    expect(Number(call.publisherPayoutAmount)).toBe(10.0);
    expect(Number(call.cost)).toBeGreaterThan(0); // Estimated rate card cost is resolved
    expect(Number(call.profit)).toBe(15.0 - 10.0 - Number(call.cost));

    // 7. Assert UPFRONT buyer wallet is debited exactly once
    const buyer = mockPrismaData.buyers[0];
    expect(Number(buyer.walletBalance)).toBe(85.0); // 100.00 - 15.00
    expect(buyer.leadsRemaining).toBe(85);
    expect(mockPrismaData.buyerTransactions.length).toBe(1);
    expect(mockPrismaData.buyerTransactions[0].type).toBe('DEBIT');
    expect(Number(mockPrismaData.buyerTransactions[0].amount)).toBe(-15.0);

    // 8. Assert AccrualLedger entries are created (BUYER_REVENUE, PUBLISHER_PAYOUT, CARRIER_COST, PLATFORM_PROFIT)
    const ledgers = mockPrismaData.accrualLedgers;
    expect(ledgers.length).toBe(4);

    const revLedger = ledgers.find(l => l.type === 'BUYER_REVENUE');
    const payLedger = ledgers.find(l => l.type === 'PUBLISHER_PAYOUT');
    const costLedger = ledgers.find(l => l.type === 'CARRIER_COST');
    const profitLedger = ledgers.find(l => l.type === 'PLATFORM_PROFIT');

    expect(revLedger).toBeDefined();
    expect(Number(revLedger.amount)).toBe(15.0);
    expect(payLedger).toBeDefined();
    expect(Number(payLedger.amount)).toBe(-10.0);
    expect(costLedger).toBeDefined();
    expect(Number(costLedger.amount)).toBe(-Number(call.cost));
    expect(profitLedger).toBeDefined();
    expect(Number(profitLedger.amount)).toBe(Number(call.profit));

    // 9. Assert idempotency: Rerunning CDR / billing does not double-charge or duplicate ledger entries
    const { billingService } = await import('../billing-service.js');
    const { buyerBillingService } = await import('../buyer-billing-service.js');

    // Run again
    await billingService.calculateCallBilling(call.id);
    await buyerBillingService.processCallBilling(call.id);

    // Verify buyer balance remains 85.00
    expect(Number(buyer.walletBalance)).toBe(85.0);
    // Verify no new transaction was added
    expect(mockPrismaData.buyerTransactions.length).toBe(1);
    // Verify ledger entries are still 4 (idempotent updates instead of new creates)
    expect(mockPrismaData.accrualLedgers.length).toBe(4);
  });

  it('refuses the same call flow when the caller has no internal key', async () => {
    // The companion to every keyed inject above. `freeswitch-internal-key.test.ts`
    // proves the guard refuses, and proves by static check that these routes
    // carry it; this proves it end to end on the routes as actually registered,
    // so removing the preHandler cannot pass by leaving the static check happy.
    const lookup = await app.inject({
      method: 'GET',
      url: '/api/v1/freeswitch/lookup',
      query: { did: '+18005550100', caller: '+18005550199' },
    });
    expect(lookup.statusCode).toBe(401);
    expect(JSON.parse(lookup.body).error.code).toBe('INTERNAL_KEY_REQUIRED');

    const cdr = await app.inject({
      method: 'POST',
      url: '/api/v1/freeswitch/cdr',
      body: { callId: 'fs-call-uuid-unauthenticated', duration: 10 },
    });
    expect(cdr.statusCode).toBe(401);

    // And nothing was written on the way to being refused.
    expect(mockPrismaData.calls.length).toBe(0);
  });
});
