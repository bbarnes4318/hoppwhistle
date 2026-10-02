/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- assertions run over parsed JSON responses, which are dynamically typed */
import { randomUUID } from 'crypto';

import { Prisma } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import { grantPlatformAdmin } from '../lib/platform-admin.js';
import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * A campaign billed per submitted application.
 *
 *   1. An application is tagged with its call's campaign, buyer and publisher.
 *   2. Its call is charged and paid once per application, whatever its length.
 *   3. Voiding the application takes the charge and the payout back off.
 *   4. An UPFRONT buyer's wallet follows the charge, both ways.
 */

const gate = databaseGate();
announceSkip('Campaign application billing', gate);

const TEST_JWT_SECRET = 'campaign-application-billing-suite-secret';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe.skipIf(!gate.available)('Campaign billed per application', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;

  let tenantId: string;
  let agentId: string;
  let operatorId: string;
  let buyerId: string;
  let publisherId: string;
  let campaignId: string;

  function tokenFor(userId: string, tenant: string | null): Record<string, string> {
    return {
      authorization: `Bearer ${app.jwt.sign({ userId, tenantId: tenant, email: `${userId}@test.local` })}`,
    };
  }

  beforeAll(async () => {
    app = Fastify();
    await app.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await app.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(app);
    const { registerApplicationRoutes } = await import('../routes/applications.js');
    await app.register(registerApplicationRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(async () => {
    prisma = getPrismaClient();
    for (const table of [
      'buyer_transactions',
      'accrual_ledger',
      'billing_accounts',
      'insurance_carrier_applications',
      'calls',
      'campaign_buyers',
      'campaign_publishers',
      'campaigns',
      'buyers',
      'publishers',
      'platform_acting_tenants',
      'platform_admins',
      'audit_logs',
      'user_roles',
      'users',
      'roles',
      'tenants',
    ]) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }

    const agentRole = await prisma.role.create({
      data: { name: 'AGENT', description: 'AGENT role', permissions: [] },
    });
    const tenant = await prisma.tenant.create({
      data: { name: 'Life Leads Test', slug: `llt-${randomUUID()}`, status: 'ACTIVE' },
    });
    tenantId = tenant.id;

    const agent = await prisma.user.create({
      data: {
        tenantId,
        email: `agent-${randomUUID()}@llt.local`,
        status: 'ACTIVE',
        roles: { create: { roleId: agentRole.id } },
      },
    });
    agentId = agent.id;

    const operator = await prisma.user.create({
      data: { email: `operator-${randomUUID()}@netenroll.test`, status: 'ACTIVE', tenantId: null },
    });
    operatorId = operator.id;
    await grantPlatformAdmin(operatorId, { note: 'campaign application billing fixture' });

    const publisher = await prisma.publisher.create({
      data: { tenantId, name: 'Pub', code: randomUUID().replace(/-/g, '') },
    });
    publisherId = publisher.id;
    const buyer = await prisma.buyer.create({
      data: {
        tenantId,
        name: 'Agency Buyer',
        code: 'AGB',
        billingType: 'UPFRONT',
        walletBalance: new Prisma.Decimal(500),
      },
    });
    buyerId = buyer.id;
    const campaign = await prisma.campaign.create({
      data: {
        tenantId,
        publisherId,
        name: 'Final Expense',
        billingModel: 'PER_APPLICATION',
        buyerPricePerBillableCall: new Prisma.Decimal(15),
        publisherPayoutPerBillableCall: new Prisma.Decimal(8),
        buyerPricePerApplication: new Prisma.Decimal(120),
        publisherPayoutPerApplication: new Prisma.Decimal(50),
      },
    });
    campaignId = campaign.id;
  });

  async function answeredCall() {
    return prisma.call.create({
      data: {
        tenantId,
        campaignId,
        buyerId,
        publisherId,
        callSid: `sid-${randomUUID()}`,
        toNumber: '+15550000000',
        status: 'COMPLETED',
        direction: 'INBOUND',
        answeredAt: new Date(),
        answeredByUserId: agentId,
        // Far below the campaign's 60s threshold: irrelevant per application.
        connectedDuration: 20,
        duration: 20,
        cost: new Prisma.Decimal(0),
        blocked: false,
      },
    });
  }

  async function submit(callId: string) {
    const { recordAgentApplication } = await import('../services/applications/agent-entry.js');
    return recordAgentApplication({
      tenantId,
      createdById: agentId,
      clientRequestId: randomUUID(),
      callId,
      carrier: 'Aflac',
      faceAmount: 10000,
      modalPremium: 40,
      paymentMode: 'MONTHLY',
      firstName: 'Ray',
      lastName: 'Whitlock',
    } as Parameters<typeof recordAgentApplication>[0]);
  }

  it('tags the application, charges per application, and gives it back on void', async () => {
    const call = await answeredCall();

    const first = await submit(call.id);
    expect(first.campaignId).toBe(campaignId);
    expect(first.buyerId).toBe(buyerId);
    expect(first.publisherId).toBe(publisherId);

    let billed = await prisma.call.findUniqueOrThrow({ where: { id: call.id } });
    expect(billed.billable).toBe(true);
    expect(billed.buyerBillableAmount?.toString()).toBe('120');
    expect(billed.publisherPayoutAmount?.toString()).toBe('50');
    expect(billed.buyerChargeStatus).toBe('CHARGED');
    let buyer = await prisma.buyer.findUniqueOrThrow({ where: { id: buyerId } });
    expect(buyer.walletBalance.toString()).toBe('380');

    // A couple insuring together: the second application is a second charge.
    const second = await submit(call.id);
    billed = await prisma.call.findUniqueOrThrow({ where: { id: call.id } });
    expect(billed.buyerBillableAmount?.toString()).toBe('240');
    expect(billed.publisherPayoutAmount?.toString()).toBe('100');
    buyer = await prisma.buyer.findUniqueOrThrow({ where: { id: buyerId } });
    expect(buyer.walletBalance.toString()).toBe('260');

    // Voiding one takes exactly one charge back off.
    const voided = await app.inject({
      method: 'POST',
      url: `/api/v1/applications/${String(second.id)}/void`,
      headers: tokenFor(operatorId, null),
      payload: { reason: 'Duplicate of the first application' },
    });
    expect(voided.statusCode).toBe(200);

    billed = await prisma.call.findUniqueOrThrow({ where: { id: call.id } });
    expect(billed.buyerBillableAmount?.toString()).toBe('120');
    buyer = await prisma.buyer.findUniqueOrThrow({ where: { id: buyerId } });
    expect(buyer.walletBalance.toString()).toBe('380');
    const debits = await prisma.buyerTransaction.findMany({ where: { callId: call.id } });
    expect(debits).toHaveLength(1);
    expect(debits[0].amount.toString()).toBe('-120');
  });

  it('charges nothing for a call without an application', async () => {
    const call = await answeredCall();
    const { billingService } = await import('../services/billing-service.js');
    await billingService.calculateCallBilling(call.id);

    const billed = await prisma.call.findUniqueOrThrow({ where: { id: call.id } });
    expect(billed.billable).toBe(false);
    expect(billed.noPayoutReason).toBe('NO_APPLICATION_SUBMITTED');
    expect(billed.buyerBillableAmount?.toString()).toBe('0');
  });
});
