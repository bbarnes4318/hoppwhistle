/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */
import { Prisma } from '@prisma/client';
import Fastify from 'fastify';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { announceSkip, databaseGate, redisGate } from '../../__tests__/helpers/live-services.js';
import { getPrismaClient } from '../../lib/prisma.js';
import { registerAuthRoutes } from '../../routes/auth.js';
import { registerDidRouteRoutes } from '../../routes/did-routes.js';
import {
  registerReportingRoutes,
  registerBillingRoutes,
  registerCallRoutes,
} from '../../routes/index.js';
import { registerPingRoutes } from '../../routes/ping.js';
import { registerPostRoutes } from '../../routes/post.js';
import { auctionService } from '../auction-service.js';
import { BillingService } from '../billing-service.js';
import { BuyerBillingService } from '../buyer-billing-service.js';
import { postService } from '../post-service.js';
import { getRedisClient } from '../redis.js';

// Truncates real tables and uses real Redis. Runs only against services
// explicitly nominated as disposable — never DATABASE_URL/REDIS_URL, which
// point at production.
const dbGate = databaseGate();
const cacheGate = redisGate();
const gate = dbGate.available ? cacheGate : dbGate;
announceSkip('Pay-Per-Call Real Database/Redis Integration Tests', gate);

describe.skipIf(!gate.available)('Pay-Per-Call Real Database/Redis Integration Tests', () => {
  let prisma: any;
  let redis: any;
  let app: any;
  const billingService = new BillingService();
  const buyerBillingService = new BuyerBillingService();

  const tenantId = 'tenant-integration-1';

  beforeAll(async () => {
    // Connect to actual database and redis
    prisma = getPrismaClient();
    redis = getRedisClient();

    // Clean tables
    await cleanDatabase();

    // Seed Roles
    const rolesToCreate = [
      {
        id: 'role-admin-int',
        name: 'ADMIN' as const,
        description: 'Admin',
        permissions: ['admin:*'],
      },
      {
        id: 'role-owner-int',
        name: 'OWNER' as const,
        description: 'Owner',
        permissions: ['admin:*'],
      },
      {
        id: 'role-buyer-int',
        name: 'BUYER' as const,
        description: 'Buyer',
        permissions: ['calls:read', 'billing:read'],
      },
      {
        id: 'role-publisher-int',
        name: 'PUBLISHER' as const,
        description: 'Publisher',
        permissions: ['calls:read', 'payouts:read'],
      },
      {
        id: 'role-agent-int',
        name: 'AGENT' as const,
        description: 'Agent',
        permissions: ['calls:read'],
      },
      {
        id: 'role-readonly-int',
        name: 'READONLY' as const,
        description: 'Readonly',
        permissions: ['calls:read'],
      },
    ];

    for (const r of rolesToCreate) {
      await prisma.role.upsert({
        where: { name: r.name },
        update: {},
        create: r,
      });
    }

    // Seed Tenant
    await prisma.tenant.create({
      data: {
        id: tenantId,
        name: 'Integration Tenant',
        slug: 'integration-tenant',
        status: 'ACTIVE',
      },
    });

    // Seed Users & User Roles
    const usersToCreate = [
      { id: 'usr-admin-int', email: 'admin-int@e2e.com', tenantId, status: 'ACTIVE' as const },
      {
        id: 'usr-buyer-a-int',
        email: 'buyera-int@e2e.com',
        tenantId,
        status: 'ACTIVE' as const,
        buyerId: 'buyer-a-int',
      },
      {
        id: 'usr-buyer-b-int',
        email: 'buyerb-int@e2e.com',
        tenantId,
        status: 'ACTIVE' as const,
        buyerId: 'buyer-b-int',
      },
      {
        id: 'usr-publisher-a-int',
        email: 'puba-int@e2e.com',
        tenantId,
        status: 'ACTIVE' as const,
        publisherId: 'pub-a-int',
      },
      {
        id: 'usr-publisher-b-int',
        email: 'pubb-int@e2e.com',
        tenantId,
        status: 'ACTIVE' as const,
        publisherId: 'pub-b-int',
      },
      { id: 'usr-agent-int', email: 'agent-int@e2e.com', tenantId, status: 'ACTIVE' as const },
      {
        id: 'usr-readonly-int',
        email: 'readonly-int@e2e.com',
        tenantId,
        status: 'ACTIVE' as const,
      },
    ];

    // Seed Buyers & Publishers before linking in user creation
    await prisma.publisher.createMany({
      data: [
        { id: 'pub-a-int', name: 'Pub A Int', code: 'pubaint', status: 'ACTIVE', tenantId },
        { id: 'pub-b-int', name: 'Pub B Int', code: 'pubbint', status: 'ACTIVE', tenantId },
      ],
    });

    await prisma.buyer.createMany({
      data: [
        {
          id: 'buyer-a-int',
          name: 'Buyer A Prepaid Int',
          code: 'buyeraprepaid',
          status: 'ACTIVE',
          tenantId,
          // The auction only considers endpoints whose buyer is managed by the
          // pinging publisher (fetchEligibleEndpoints filters on
          // buyer.publisherId). Without this the RTB ping matched nothing and
          // came back bid: 0, 'No matching buyers'. Buyer B is deliberately
          // left unmanaged: it bids 20 and would outbid A, and this test is
          // about A winning at 15.
          publisherId: 'pub-a-int',
          billingType: 'UPFRONT',
          walletBalance: new Prisma.Decimal('100.00'),
          leadsRemaining: 100,
          billableDuration: 60,
          canDisputeConversions: true,
        },
        {
          id: 'buyer-b-int',
          name: 'Buyer B TERMS Int',
          code: 'buyerbterms',
          status: 'ACTIVE',
          tenantId,
          billingType: 'TERMS',
          walletBalance: new Prisma.Decimal('0.00'),
          leadsRemaining: 0,
          billableDuration: 60,
          canDisputeConversions: false,
        },
      ],
    });

    // Create billing account for tenant
    await prisma.billingAccount.create({
      data: {
        id: 'ba-tenant-int',
        tenantId,
        name: 'Integration Test Billing Account',
        currency: 'USD',
      },
    });

    for (const u of usersToCreate) {
      await prisma.user.create({ data: u });
    }

    const rolesMap = await prisma.role.findMany();
    const adminRole = rolesMap.find((r: any) => r.name === 'ADMIN');
    const buyerRole = rolesMap.find((r: any) => r.name === 'BUYER');
    const publisherRole = rolesMap.find((r: any) => r.name === 'PUBLISHER');
    const agentRole = rolesMap.find((r: any) => r.name === 'AGENT');
    const readonlyRole = rolesMap.find((r: any) => r.name === 'READONLY');

    await prisma.userRole.createMany({
      data: [
        { userId: 'usr-admin-int', roleId: adminRole.id },
        { userId: 'usr-buyer-a-int', roleId: buyerRole.id },
        { userId: 'usr-buyer-b-int', roleId: buyerRole.id },
        { userId: 'usr-publisher-a-int', roleId: publisherRole.id },
        { userId: 'usr-publisher-b-int', roleId: publisherRole.id },
        { userId: 'usr-agent-int', roleId: agentRole.id },
        { userId: 'usr-readonly-int', roleId: readonlyRole.id },
      ],
    });

    // Seed Api Key
    await prisma.apiKey.create({
      data: {
        id: 'apikey-pub-a-int',
        keyHash: 'pub-a-int-key-hash', // matches test key
        prefix: 'apikey-p',
        tenantId,
        publisherId: 'pub-a-int',
        status: 'ACTIVE',
        scopes: ['ping', 'post'],
        name: 'Publisher key',
      },
    });

    // Seed Campaign, Target & DID route
    await prisma.campaign.create({
      data: {
        id: 'camp-int-1',
        tenantId,
        // Campaign requires a publisher. Omitting it made Prisma fall back to
        // the checked create variant and report the confusing `Argument
        // \`tenant\` is missing`, which killed beforeAll and took the whole
        // suite with it before a single test body ran.
        publisherId: 'pub-a-int',
        name: 'Integration Campaign',
        status: 'ACTIVE',
        billableDurationSeconds: 60,
        buyerPricePerBillableCall: new Prisma.Decimal('25.00'),
        publisherPayoutPerBillableCall: new Prisma.Decimal('10.00'),
      },
    });

    await prisma.buyerEndpoint.createMany({
      data: [
        {
          id: 'ep-a-int',
          buyerId: 'buyer-a-int',
          name: 'Target A PSTN Int',
          type: 'PSTN',
          destination: '+18005559999',
          status: 'ACTIVE',
          basePrice: new Prisma.Decimal('15.00'),
          timezone: 'America/New_York',
        },
        {
          id: 'ep-b-int',
          buyerId: 'buyer-b-int',
          name: 'Target B PSTN Int',
          type: 'PSTN',
          destination: '+18005558888',
          status: 'ACTIVE',
          basePrice: new Prisma.Decimal('20.00'),
          timezone: 'America/New_York',
        },
      ],
    });

    await prisma.campaignBuyer.createMany({
      data: [
        // Distinct priorities, because selectBestBuyer picks within a priority
        // group with a weighted Math.random(). Seeded at the same priority and
        // weight, these two were a coin flip and the static-DID assertion below
        // passed about half the time.
        {
          id: 'cb-a-int',
          tenantId,
          campaignId: 'camp-int-1',
          buyerId: 'buyer-a-int',
          buyerEndpointId: 'ep-a-int',
          destinationNumber: '+18005559999',
          pricePerBillableCall: new Prisma.Decimal('25.00'),
          priority: 0,
          status: 'ACTIVE',
        },
        {
          id: 'cb-b-int',
          tenantId,
          campaignId: 'camp-int-1',
          buyerId: 'buyer-b-int',
          buyerEndpointId: 'ep-b-int',
          destinationNumber: '+18005558888',
          pricePerBillableCall: new Prisma.Decimal('25.00'),
          priority: 1,
          status: 'ACTIVE',
        },
      ],
    });

    await prisma.campaignPublisher.create({
      data: {
        id: 'cp-a-int',
        tenantId,
        campaignId: 'camp-int-1',
        publisherId: 'pub-a-int',
        payoutPerBillableCall: new Prisma.Decimal('10.00'),
        status: 'ACTIVE',
      },
    });

    await prisma.phoneNumber.createMany({
      data: [
        {
          id: 'num-a-int',
          number: '+18005550300',
          status: 'ACTIVE',
          tenantId,
          poolType: 'POOL',
          poolStatus: 'AVAILABLE',
        },
        {
          id: 'num-static-int',
          number: '+18005550400',
          status: 'ACTIVE',
          tenantId,
          poolType: 'STATIC',
          poolStatus: 'ASSIGNED',
        },
      ],
    });

    await prisma.didRoute.create({
      data: {
        id: 'route-static-int',
        tenantId,
        phoneNumberId: 'num-static-int',
        // Denormalised copy of the tracking DID's number, which FreeSWITCH
        // looks routes up by. Must match num-static-int above.
        did: '+18005550400',
        destination: '+18005559999',
        campaignId: 'camp-int-1',
        buyerId: 'buyer-a-int',
        publisherId: 'pub-a-int',
      },
    });

    // Fastify app initialization
    app = Fastify();
    await app.register(import('@fastify/jwt'), { secret: 'test-secret' });
    app.addHook('onRequest', async (request: any) => {
      const auth = request.headers.authorization;
      if (auth && auth.startsWith('Bearer ')) {
        try {
          const decoded = app.jwt.verify(auth.substring(7));
          request.user = decoded;
        } catch {
          // ignore
        }
      }
    });

    await app.register(registerDidRouteRoutes);
    await app.register(registerReportingRoutes);
    await app.register(registerBillingRoutes);
    await app.register(registerCallRoutes);
    await app.register(registerPingRoutes);
    await app.register(registerPostRoutes);
    await app.register(registerAuthRoutes);

    await app.ready();
  });

  afterAll(async () => {
    await cleanDatabase();
    if (redis) await redis.quit();
  });

  async function cleanDatabase() {
    const tables = [
      'accrual_ledger',
      'buyer_transactions',
      'calls',
      'did_routes',
      'campaign_buyers',
      'campaign_publishers',
      'campaigns',
      'buyer_endpoints',
      'buyers',
      'publisher_payouts',
      'payouts',
      'invoice_lines',
      'invoices',
      'balances',
      'billing_accounts',
      'phone_numbers',
      'api_keys',
      'user_roles',
      'users',
      'roles',
      'tenants',
    ];
    for (const t of tables) {
      try {
        await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${t}" CASCADE;`);
      } catch (err) {
        // ignore
      }
    }
  }

  const generateToken = (
    userId: string,
    role: string,
    buyerId: string | null = null,
    publisherId: string | null = null
  ) => {
    return app.jwt.sign({
      userId,
      roles: [role],
      tenantId,
      buyerId,
      publisherId,
    });
  };

  // ────────────────────────────────────────────────────────────────────────────
  // Test Path 1: Static DID Call E2E Integration
  // ────────────────────────────────────────────────────────────────────────────
  it('Static DID E2E Integration: verifies lookup, CDR call mapping, actual postgres database persistence and idempotency constraints', async () => {
    // 1. FreeSWITCH lookup
    const lookupResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/freeswitch/lookup',
      query: { did: '+18005550400', caller: '+15551112222' },
    });
    expect(lookupResponse.statusCode).toBe(200);
    const lookupData = JSON.parse(lookupResponse.body);
    // route-static-int carries a campaignId, so the lookup takes the dynamic
    // path: it returns a sequential failover chain across the campaign's
    // priority steps, highest priority first, not the route's own destination.
    expect(lookupData.destination.split('|')).toEqual(['+18005559999', '+18005558888']);

    // 2. FreeSWITCH CDR posting
    const callSid = `sid-integration-${Date.now()}`;
    const cdrResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/freeswitch/cdr',
      body: {
        callId: callSid,
        routeId: 'route-static-int',
        tenantId,
        callerNumber: '+15551112222',
        did: '+18005550400',
        destination: '+18005559999',
        duration: 90,
        connectedDuration: 85,
        hangupCause: 'NORMAL_CLEARING',
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      },
    });
    expect(cdrResponse.statusCode).toBe(201);

    // Get call record from actual DB. The CDR handler namespaces the
    // FreeSWITCH UUID as `fs-<callId>` when it writes the row, so querying the
    // bare id found nothing.
    const dbCall = await prisma.call.findFirst({
      where: { tenantId, callSid: `fs-${callSid}` },
    });
    expect(dbCall).not.toBeNull();
    expect(dbCall.billable).toBe(true);

    // Calculate billing using actual database records
    await billingService.calculateCallBilling(dbCall.id);
    await buyerBillingService.processCallBilling(dbCall.id);

    // Verify fields saved to database
    const finalCall = await prisma.call.findUnique({
      where: { id: dbCall.id },
    });
    expect(Number(finalCall.buyerBillableAmount)).toBe(25.0);
    expect(Number(finalCall.publisherPayoutAmount)).toBe(10.0);

    // Verify ledger row constraints and counts in real database
    const ledgers = await prisma.accrualLedger.findMany({
      where: { callId: dbCall.id },
    });
    expect(ledgers.length).toBe(4); // BUYER_REVENUE, PUBLISHER_PAYOUT, CARRIER_COST, PLATFORM_PROFIT

    // Verify buyer transaction in real database
    const transaction = await prisma.buyerTransaction.findFirst({
      where: { callId: dbCall.id },
    });
    expect(transaction).not.toBeNull();
    expect(Number(transaction.amount)).toBe(-25.0);

    // 3. Verify Idempotency - double billing does not add new ledger rows or transaction debits
    const originalLedgersCount = ledgers.length;
    const originalTxCount = await prisma.buyerTransaction.count({ where: { callId: dbCall.id } });

    await billingService.calculateCallBilling(dbCall.id);
    await buyerBillingService.processCallBilling(dbCall.id);

    const recheckLedgers = await prisma.accrualLedger.findMany({
      where: { callId: dbCall.id },
    });
    const recheckTxCount = await prisma.buyerTransaction.count({ where: { callId: dbCall.id } });

    expect(recheckLedgers.length).toBe(originalLedgersCount);
    expect(recheckTxCount).toBe(originalTxCount);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Test Path 2: RTB Bidding & Redis Integration
  // ────────────────────────────────────────────────────────────────────────────
  it('RTB Bidding/Redis Integration: saves route to real Redis, lookup fetches from Redis, and CDR attributes winner bid', async () => {
    // 1. Process Ping using auctionService
    const pingResult = await auctionService.processPing('pub-a-int', {
      request_id: 'ping-uuid-integration-1',
      vertical: 'insurance',
      caller: { state: 'NY' },
      min_bid: 10,
    });
    expect(pingResult.bid).toBe(15.0);
    expect(pingResult.token).toBeDefined();

    // 2. Process Post using postService (leases '+18005550300' and writes to Redis)
    const postResult = await postService.processPost(pingResult.token!, '+15552223333');
    expect(postResult.accepted).toBe(true);
    expect(postResult.transfer_number).toBe('+18005550300');

    // Verify key in real Redis
    const redisRouteData = await redis.get(`route:did:${postResult.transfer_number}`);
    expect(redisRouteData).not.toBeNull();
    const routeObj = JSON.parse(redisRouteData);
    expect(routeObj.buyer_id).toBe('buyer-a-int');
    expect(routeObj.rtb_bid_amount).toBe(15.0);

    // 3. FreeSWITCH Lookup DID resolves Redis route
    const lookupResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/freeswitch/lookup',
      query: { did: '+18005550300', caller: '+15552223333' },
    });
    expect(lookupResponse.statusCode).toBe(200);
    const lookupData = JSON.parse(lookupResponse.body);
    expect(lookupData.buyerId).toBe('buyer-a-int');
    expect(lookupData.routeType).toBe('RTB');
  });
});
