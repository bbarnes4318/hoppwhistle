#!/usr/bin/env tsx
/**
 * CLI tool to assign a phone number to a campaign
 * Usage: tsx src/cli/numbers-assign.ts --tenant=t_123 --campaign=c_abc --number=+15551234567
 */

import 'dotenv-flow/config';
import { getPrismaClient } from '../lib/prisma.js';
import { provisioningService } from '../services/provisioning/provisioning-service.js';

interface AssignOptions {
  tenantId: string;
  campaignId: string;
  number: string;
}

function normalizePhoneNumber(phoneNumber: string): string {
  // Remove all non-digit characters except +
  let normalized = phoneNumber.replace(/[^\d+]/g, '');

  // If doesn't start with +, assume US number and add +1
  if (!normalized.startsWith('+')) {
    if (normalized.length === 10) {
      normalized = `+1${normalized}`;
    } else if (normalized.length === 11 && normalized.startsWith('1')) {
      normalized = `+${normalized}`;
    }
  }

  return normalized;
}

async function assignNumber(options: AssignOptions) {
  const prisma = getPrismaClient();

  console.log(`Assigning number ${options.number} to campaign ${options.campaignId}...`);

  // Verify tenant exists
  const tenant = await prisma.tenant.findUnique({
    where: { id: options.tenantId },
  });

  if (!tenant) {
    throw new Error(`Tenant not found: ${options.tenantId}`);
  }

  // Verify campaign exists
  const campaign = await prisma.campaign.findFirst({
    where: {
      id: options.campaignId,
      tenantId: options.tenantId,
    },
  });

  if (!campaign) {
    throw new Error(`Campaign not found: ${options.campaignId} for tenant ${options.tenantId}`);
  }

  const normalizedNumber = normalizePhoneNumber(options.number);

  // Find available number
  const phoneNumber = await prisma.phoneNumber.findFirst({
    where: {
      number: normalizedNumber,
      tenantId: options.tenantId,
      status: 'ACTIVE',
    },
  });

  if (!phoneNumber) {
    throw new Error(`Number ${normalizedNumber} not found or not active for tenant ${options.tenantId}`);
  }

  // Assign using provisioning service
  const assigned = await provisioningService.assignNumberToCampaign(
    {
      tenantId: options.tenantId,
      campaignId: options.campaignId,
      number: normalizedNumber,
    },
    {
      tenantId: options.tenantId,
      ipAddress: '127.0.0.1',
      requestId: `cli-${Date.now()}`,
    }
  );

  console.log(`\n✅ Number assigned successfully:`);
  console.log(`   Number: ${assigned.number}`);
  console.log(`   Campaign: ${options.campaignId}`);
  console.log(`   Tenant: ${options.tenantId}`);
  console.log(`   Provider: ${assigned.provider}`);
}

// Parse command line arguments
const args = process.argv.slice(2);
const options: Partial<AssignOptions> = {};

for (const arg of args) {
  if (arg.startsWith('--tenant=')) {
    options.tenantId = arg.split('=')[1];
  } else if (arg.startsWith('--campaign=')) {
    options.campaignId = arg.split('=')[1];
  } else if (arg.startsWith('--number=')) {
    options.number = arg.split('=')[1];
  }
}

if (!options.tenantId || !options.campaignId || !options.number) {
  console.error('Usage: tsx src/cli/numbers-assign.ts --tenant=t_123 --campaign=c_abc --number=+15551234567');
  console.error('\nOptions:');
  console.error('  --tenant=ID              Tenant ID');
  console.error('  --campaign=ID            Campaign ID');
  console.error('  --number=NUMBER          Phone number (E.164 format)');
  process.exit(1);
}

assignNumber(options as AssignOptions)
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Assignment failed:', error);
    process.exit(1);
  });

