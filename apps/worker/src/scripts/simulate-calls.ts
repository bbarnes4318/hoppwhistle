#!/usr/bin/env tsx
/**
 * Script to simulate 100 calls for billing testing
 * Usage: tsx src/scripts/simulate-calls.ts --tenant-id=xxx --billing-account-id=xxx
 */

import 'dotenv-flow/config';
import { Redis } from 'ioredis';

async function simulateCalls() {
  const args = process.argv.slice(2);
  const tenantIdArg = args.find((arg) => arg.startsWith('--tenant-id='));
  const billingAccountIdArg = args.find((arg) => arg.startsWith('--billing-account-id='));
  const countArg = args.find((arg) => arg.startsWith('--count='));

  const tenantId = tenantIdArg?.split('=')[1] || process.env.DEFAULT_TENANT_ID || 'test-tenant';
  const billingAccountId = billingAccountIdArg?.split('=')[1] || 'test-billing-account';
  const count = countArg ? parseInt(countArg.split('=')[1], 10) : 100;

  console.log(`Simulating ${count} calls for tenant ${tenantId}...`);

  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

  for (let i = 1; i <= count; i++) {
    const callId = `call_${Date.now()}_${i}`;
    const direction = i % 2 === 0 ? 'INBOUND' : 'OUTBOUND';
    const duration = Math.floor(Math.random() * 300) + 30; // 30-330 seconds
    const answered = Math.random() > 0.2; // 80% answer rate
    const hasRecording = answered && Math.random() > 0.3; // 70% recording rate if answered

    const event = {
      event: 'call.completed',
      tenantId,
      data: {
        callId,
        direction,
        duration,
        answered,
        publisherId: `publisher_${i % 5}`, // 5 different publishers
        buyerId: `buyer_${i % 10}`, // 10 different buyers
        campaignId: `campaign_${i % 3}`, // 3 different campaigns
        hasRecording,
        recordingDuration: hasRecording ? duration : undefined,
      },
    };

    // Publish to Redis stream
    await redis.xadd(
      'events:stream',
      '*',
      'channel',
      'call.*',
      'payload',
      JSON.stringify(event)
    );

    // Also publish to pub/sub
    await redis.publish('call.completed', JSON.stringify(event));

    if (i % 10 === 0) {
      console.log(`Published ${i}/${count} calls...`);
    }
  }

  console.log(`✅ Published ${count} call.completed events`);
  console.log('\nWaiting for billing worker to process...');
  console.log('Check accrual_ledger table for accruals');
  console.log('Then close period and generate invoice via API');

  await redis.quit();
}

simulateCalls().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});

