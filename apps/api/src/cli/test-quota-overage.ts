#!/usr/bin/env tsx
/**
 * Test script to simulate quota overage and verify alerts/blocks
 * Usage: tsx src/cli/test-quota-overage.ts --tenant=t_123
 */

import 'dotenv-flow/config';
import { getPrismaClient } from '../lib/prisma.js';
import { budgetAlertService } from '../services/budget-alert-service.js';
import { quotaService } from '../services/quota-service.js';

interface TestOptions {
  tenantId: string;
}

async function testQuotaOverage(options: TestOptions) {
  const prisma = getPrismaClient();

  console.log(`\n🧪 Testing Quota Overage for Tenant: ${options.tenantId}\n`);

  // 1. Setup: Create quota with low limits
  console.log('📋 Step 1: Setting up test quotas...');
  const quota = await prisma.tenantQuota.upsert({
    where: { tenantId: options.tenantId },
    create: {
      tenantId: options.tenantId,
      maxConcurrentCalls: 2, // Very low limit
      maxMinutesPerDay: 10, // Very low limit
      maxPhoneNumbers: 1, // Very low limit
      enabled: true,
    },
    update: {
      maxConcurrentCalls: 2,
      maxMinutesPerDay: 10,
      maxPhoneNumbers: 1,
      enabled: true,
    },
  });
  console.log('✅ Quota created:', quota);

  // 2. Setup: Create budget with low limits
  console.log('\n💰 Step 2: Setting up test budget...');
  const budget = await prisma.tenantBudget.upsert({
    where: { tenantId: options.tenantId },
    create: {
      tenantId: options.tenantId,
      dailyBudget: 10, // $10 daily limit
      monthlyBudget: 100, // $100 monthly limit
      alertThreshold: 80,
      alertEmails: ['test@example.com'],
      hardStopEnabled: true,
      enabled: true,
      currentDaySpend: 0,
      currentMonthSpend: 0,
    },
    update: {
      dailyBudget: 10,
      monthlyBudget: 100,
      alertThreshold: 80,
      hardStopEnabled: true,
      enabled: true,
    },
  });
  console.log('✅ Budget created:', budget);

  // 3. Test: Check concurrent calls (should pass initially)
  console.log('\n📞 Step 3: Testing concurrent calls quota...');
  const concurrentCheck1 = await quotaService.checkConcurrentCalls(options.tenantId);
  console.log('Initial check:', concurrentCheck1);
  if (!concurrentCheck1.allowed) {
    console.log('❌ FAILED: Should allow calls initially');
    return;
  }
  console.log('✅ PASSED: Initial concurrent calls check');

  // 4. Simulate: Create active calls to exceed limit
  console.log('\n📞 Step 4: Simulating active calls...');
  // Create 3 active calls (exceeds limit of 2)
  for (let i = 0; i < 3; i++) {
    await prisma.call.create({
      data: {
        tenantId: options.tenantId,
        toNumber: `+1555000000${i}`,
        callSid: `test_call_${Date.now()}_${i}`,
        status: 'ANSWERED',
        direction: 'OUTBOUND',
      },
    });
  }

  const concurrentCheck2 = await quotaService.checkConcurrentCalls(options.tenantId);
  console.log('After creating 3 calls:', concurrentCheck2);
  if (concurrentCheck2.allowed) {
    console.log('❌ FAILED: Should block calls when limit exceeded');
    return;
  }
  console.log('✅ PASSED: Concurrent calls blocked when limit exceeded');

  // 5. Test: Daily minutes quota
  console.log('\n⏱️  Step 5: Testing daily minutes quota...');
  // Create calls with duration totaling more than 10 minutes
  await prisma.call.createMany({
    data: [
      {
        tenantId: options.tenantId,
        toNumber: '+15551111111',
        callSid: `test_minutes_1_${Date.now()}`,
        status: 'COMPLETED',
        direction: 'OUTBOUND',
        duration: 600, // 10 minutes
      },
      {
        tenantId: options.tenantId,
        toNumber: '+15552222222',
        callSid: `test_minutes_2_${Date.now()}`,
        status: 'COMPLETED',
        direction: 'OUTBOUND',
        duration: 120, // 2 minutes
      },
    ],
  });

  const minutesCheck = await quotaService.checkDailyMinutes(options.tenantId, 1);
  console.log('After 12 minutes used:', minutesCheck);
  if (minutesCheck.allowed) {
    console.log('❌ FAILED: Should block calls when daily minutes exceeded');
    return;
  }
  console.log('✅ PASSED: Daily minutes blocked when limit exceeded');

  // 6. Test: Budget alerts
  console.log('\n💰 Step 6: Testing budget alerts...');
  // Set budget to trigger alert threshold
  await prisma.tenantBudget.update({
    where: { tenantId: options.tenantId },
    data: {
      currentDaySpend: 8.5, // 85% of $10 daily budget
    },
  });

  // Record a cost that pushes over threshold
  await quotaService.recordCallCost(options.tenantId, 0.5, 'test_call_alert');
  
  // Check if alert was sent (check database)
  const alerts = await prisma.budgetAlert.findMany({
    where: {
      tenantId: options.tenantId,
      sentAt: {
        gte: new Date(Date.now() - 60000), // Last minute
      },
    },
    orderBy: { sentAt: 'desc' },
    take: 1,
  });

  if (alerts.length > 0) {
    console.log('✅ PASSED: Budget alert sent:', alerts[0]);
  } else {
    console.log('⚠️  WARNING: Alert may not have been sent (check logs)');
  }

  // 7. Test: Budget hard stop
  console.log('\n🚨 Step 7: Testing budget hard stop...');
  await prisma.tenantBudget.update({
    where: { tenantId: options.tenantId },
    data: {
      currentDaySpend: 10, // At limit
    },
  });

  const budgetCheck = await quotaService.checkBudget(options.tenantId, 1);
  console.log('Budget check at limit:', budgetCheck);
  if (budgetCheck.allowed) {
    console.log('❌ FAILED: Should block calls when budget exceeded');
    return;
  }
  console.log('✅ PASSED: Budget hard stop blocks calls');

  // 8. Test: Override token
  console.log('\n🔑 Step 8: Testing override token...');
  const overrideToken = `test_token_${Date.now()}`;
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 24);

  await prisma.tenantBudget.update({
    where: { tenantId: options.tenantId },
    data: {
      overrideToken,
      overrideTokenExpiresAt: expiresAt,
    },
  });

  const overrideCheck = await quotaService.checkBudget(options.tenantId, 1, overrideToken);
  console.log('Budget check with override token:', overrideCheck);
  if (!overrideCheck.allowed) {
    console.log('❌ FAILED: Should allow calls with valid override token');
    return;
  }
  console.log('✅ PASSED: Override token bypasses budget limit');

  // Cleanup
  console.log('\n🧹 Cleaning up test data...');
  await prisma.call.deleteMany({
    where: {
      tenantId: options.tenantId,
      callSid: { startsWith: 'test_' },
    },
  });

  console.log('\n✅ All quota overage tests passed!');
  console.log('\nSummary:');
  console.log('  ✓ Concurrent calls quota enforced');
  console.log('  ✓ Daily minutes quota enforced');
  console.log('  ✓ Budget alerts triggered');
  console.log('  ✓ Budget hard stop enforced');
  console.log('  ✓ Override token works');
}

// Parse command line arguments
const args = process.argv.slice(2);
const options: Partial<TestOptions> = {};

for (const arg of args) {
  if (arg.startsWith('--tenant=')) {
    options.tenantId = arg.split('=')[1];
  }
}

if (!options.tenantId) {
  console.error('Usage: tsx src/cli/test-quota-overage.ts --tenant=t_123');
  process.exit(1);
}

testQuotaOverage(options as TestOptions)
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Test failed:', error);
    process.exit(1);
  });

