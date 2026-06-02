#!/usr/bin/env tsx
import 'dotenv-flow/config';
import { getPrismaClient } from '../lib/prisma.js';
import { billingService } from '../services/billing-service.js';
import { Prisma } from '@prisma/client';

async function runTests() {
  console.log('Starting Hopwhistle Billing Service Test Suite...');
  const prisma = getPrismaClient();

  // Create a clean testing tenant to isolate sandbox data
  const testTenantId = 'test-tenant-' + Math.random().toString(36).substring(2, 7);
  const testPublisherId = 'test-pub-' + Math.random().toString(36).substring(2, 7);
  const testBuyerId = 'test-buy-' + Math.random().toString(36).substring(2, 7);
  const testCampaignId = 'test-camp-' + Math.random().toString(36).substring(2, 7);
  const testEndpointId = 'test-ep-' + Math.random().toString(36).substring(2, 7);

  console.log(`Using Sandbox IDs:`);
  console.log(`  Tenant ID: ${testTenantId}`);
  console.log(`  Campaign ID: ${testCampaignId}`);

  let passed = 0;
  let failed = 0;

  const assert = (name: string, condition: boolean, details?: string) => {
    if (condition) {
      console.log(`[PASS] ${name}`);
      passed++;
    } else {
      console.log(`[FAIL] ${name} ${details ? `(${details})` : ''}`);
      failed++;
    }
  };

  try {
    // 1. Seed sandbox schema entities
    await prisma.tenant.create({
      data: {
        id: testTenantId,
        name: 'Billing Test Tenant',
        slug: testTenantId,
        status: 'ACTIVE',
      },
    });

    await prisma.publisher.create({
      data: {
        id: testPublisherId,
        tenantId: testTenantId,
        name: 'Test Publisher',
        code: 'TESTPUB',
        status: 'ACTIVE',
      },
    });

    await prisma.buyer.create({
      data: {
        id: testBuyerId,
        tenantId: testTenantId,
        name: 'Test Buyer',
        code: 'TESTBUY',
        status: 'ACTIVE',
      },
    });

    // Campaign with billableDuration = 60, default payout = $5, default price = $15
    await prisma.campaign.create({
      data: {
        id: testCampaignId,
        tenantId: testTenantId,
        name: 'Test Billing Campaign',
        status: 'ACTIVE',
        publisherId: testPublisherId,
        billableDurationSeconds: 60,
        publisherPayoutPerBillableCall: new Prisma.Decimal(5.0),
        buyerPricePerBillableCall: new Prisma.Decimal(15.0),
      },
    });

    const buyerPhoneId = 'test-phone-' + Math.random().toString(36).substring(2, 7);
    await prisma.phoneNumber.create({
      data: {
        id: buyerPhoneId,
        tenantId: testTenantId,
        number: '+18652637582',
        status: 'ACTIVE',
        provider: 'BULKVS',
      },
    });

    await prisma.buyerEndpoint.create({
      data: {
        id: testEndpointId,
        buyerId: testBuyerId,
        phoneNumberId: buyerPhoneId,
        name: 'Test Buyer Endpoint',
        destination: '+18652637582',
        basePrice: new Prisma.Decimal(12.0),
        status: 'ACTIVE',
        type: 'PSTN',
      },
    });

    console.log('\n--- Running Unit Boundary Tests ---');

    // Case 1: Call below threshold
    // Duration used (connectedDuration) = 59, threshold = 60 -> not billable
    const durBelow = billingService.getBillableDuration({ connectedDuration: 59, duration: 100 });
    const isBillableBelow = billingService.isBillableCall(durBelow, 60);
    assert('1. Call below threshold is NOT billable', isBillableBelow === false && durBelow === 59);

    // Case 2: Call exactly equal to threshold
    // Duration used = 60, threshold = 60 -> not billable
    const durEqual = billingService.getBillableDuration({ connectedDuration: 60, duration: 100 });
    const isBillableEqual = billingService.isBillableCall(durEqual, 60);
    assert('2. Call exactly equal to threshold is NOT billable', isBillableEqual === false && durEqual === 60);

    // Case 3: Call above threshold
    // Duration used = 61, threshold = 60 -> billable
    const durAbove = billingService.getBillableDuration({ connectedDuration: 61, duration: 100 });
    const isBillableAbove = billingService.isBillableCall(durAbove, 60);
    assert('3. Call above threshold IS billable', isBillableAbove === true && durAbove === 61);

    // Case 4: Missing connectedDuration but duration present
    const durFallback = billingService.getBillableDuration({ connectedDuration: null, duration: 75 });
    assert('4. Fallback to duration when connectedDuration is missing', durFallback === 75);

    // Case 5: Missing both durations
    const durZero = billingService.getBillableDuration({ connectedDuration: null, duration: null });
    assert('5. Fallback to 0 when both connectedDuration and duration are missing', durZero === 0);

    console.log('\n--- Running Database Billing Calculation Integration Tests ---');

    // Helper to create a call
    const createCallHelper = async (connectedDuration: number | null, duration: number | null, targetNumber = '+18652637582') => {
      const callId = 'test-call-' + Math.random().toString(36).substring(2, 7);
      return await prisma.call.create({
        data: {
          id: callId,
          tenantId: testTenantId,
          callSid: callId,
          campaignId: testCampaignId,
          publisherId: testPublisherId,
          buyerId: testBuyerId,
          status: 'COMPLETED',
          targetNumber,
          connectedDuration,
          duration,
          cost: new Prisma.Decimal(0.50), // carrier cost
        },
      });
    };

    // Case 6: Default Campaign settings (No overrides)
    // Call duration = 100 (billable), should get payout = $5, revenue = $15, profit = 15 - 5 - 0.50 = 9.50
    const callDefault = await createCallHelper(100, 100);
    const resDefault = await billingService.calculateCallBilling(callDefault.id);
    assert(
      '6. Default Campaign payout/price applies',
      resDefault.success &&
      resDefault.billable === true &&
      resDefault.payout === '5.0000' &&
      resDefault.revenue === '15.0000' &&
      resDefault.profit === '9.5000'
    );

    // Case 7: Campaign Publisher Override
    // Assign publisher with override payout = $7.50
    await prisma.campaignPublisher.create({
      data: {
        tenantId: testTenantId,
        campaignId: testCampaignId,
        publisherId: testPublisherId,
        payoutPerBillableCall: new Prisma.Decimal(7.50),
        status: 'ACTIVE',
      },
    });

    const callPubOverride = await createCallHelper(100, 100);
    const resPubOverride = await billingService.calculateCallBilling(callPubOverride.id);
    assert(
      '7. Campaign Publisher Payout override applies',
      resPubOverride.success &&
      resPubOverride.payout === '7.5000' &&
      resPubOverride.revenue === '15.0000' &&
      resPubOverride.profit === '7.0000'
    );

    // Case 8: Campaign Buyer Override
    // Assign buyer routing with override price = $18.50
    await prisma.campaignBuyer.create({
      data: {
        tenantId: testTenantId,
        campaignId: testCampaignId,
        buyerId: testBuyerId,
        buyerEndpointId: testEndpointId,
        destinationNumber: '+18652637582',
        pricePerBillableCall: new Prisma.Decimal(18.50),
        status: 'ACTIVE',
      },
    });

    const callBuyerOverride = await createCallHelper(100, 100);
    const resBuyerOverride = await billingService.calculateCallBilling(callBuyerOverride.id);
    assert(
      '8. Campaign Buyer Price override applies',
      resBuyerOverride.success &&
      resBuyerOverride.payout === '7.5000' &&
      resBuyerOverride.revenue === '18.5000' &&
      resBuyerOverride.profit === '10.5000'
    );

    // Case 9: BuyerEndpoint.basePrice fallback (when campaign price is 0)
    // Set campaign default price to 0 and remove campaign buyer override for a new destination
    await prisma.campaign.update({
      where: { id: testCampaignId },
      data: { buyerPricePerBillableCall: new Prisma.Decimal(0) },
    });

    // Create a new endpoint with basePrice = $14
    const newEndpointId = 'test-ep-fallback';
    await prisma.buyerEndpoint.create({
      data: {
        id: newEndpointId,
        buyerId: testBuyerId,
        name: 'Fallback Endpoint',
        destination: '+18005551234',
        basePrice: new Prisma.Decimal(14.00),
        status: 'ACTIVE',
        type: 'PSTN',
      },
    });

    const callEndpointFallback = await createCallHelper(100, 100, '+18005551234');
    const resEndpointFallback = await billingService.calculateCallBilling(callEndpointFallback.id);
    assert(
      '9. Fallback to BuyerEndpoint basePrice when campaign default is 0',
      resEndpointFallback.success &&
      resEndpointFallback.revenue === '14.0000' &&
      resEndpointFallback.payout === '7.5000' &&
      resEndpointFallback.profit === '6.0000'
    );

    // Case 10: Recalculation Idempotency & Duplicate Billing Prevention
    const callIdemp = await createCallHelper(120, 120);
    const run1 = await billingService.calculateCallBilling(callIdemp.id);
    const run2 = await billingService.calculateCallBilling(callIdemp.id);
    
    // Check call object in DB
    const dbCall = await prisma.call.findUnique({
      where: { id: callIdemp.id },
    });

    assert(
      '10. Idempotent recalculation yields identical results and prevents duplicate billing',
      run1.success &&
      run2.success &&
      run1.revenue === run2.revenue &&
      run1.payout === run2.payout &&
      run1.profit === run2.profit &&
      dbCall !== null &&
      dbCall.billingRuleSnapshot !== null &&
      (dbCall.billingRuleSnapshot as any).publisherPayoutRate === '7.5'
    );

  } catch (err) {
    console.error('Test execution aborted due to error:', err);
    failed++;
  } finally {
    console.log('\n--- Cleaning up Sandbox Data ---');
    try {
      // Cascade delete the sandbox tenant will clean up everything
      await prisma.tenant.delete({
        where: { id: testTenantId },
      });
      console.log('Cleanup completed successfully.');
    } catch (cleanupErr) {
      console.error('Failed to cleanup sandbox:', cleanupErr);
    }

    console.log(`\n=================== TEST RUN COMPLETE ===================`);
    console.log(`Total Passed: ${passed}`);
    console.log(`Total Failed: ${failed}`);
    console.log(`=========================================================`);

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  }
}

runTests();
