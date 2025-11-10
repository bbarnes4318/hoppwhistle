import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create tenant
  const tenant = await prisma.tenant.create({
    data: {
      name: 'Test Organization',
      slug: 'test-org',
      domain: 'test.callfabric.local',
      status: 'ACTIVE',
      metadata: {
        plan: 'enterprise',
        features: ['advanced_routing', 'analytics', 'webhooks'],
      },
    },
  });
  console.log('✅ Created tenant:', tenant.name);

  // Create admin user
  const passwordHash = await bcrypt.hash('password123', 10);
  const adminUser = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'admin@test.callfabric.local',
      passwordHash,
      firstName: 'Admin',
      lastName: 'User',
      status: 'ACTIVE',
    },
  });
  console.log('✅ Created admin user:', adminUser.email);

  // Create roles
  const adminRole = await prisma.role.create({
    data: {
      name: 'admin',
      description: 'Administrator with full access',
      permissions: [
        'users:read',
        'users:write',
        'campaigns:read',
        'campaigns:write',
        'billing:read',
        'billing:write',
        'settings:read',
        'settings:write',
      ],
    },
  });

  const publisherRole = await prisma.role.create({
    data: {
      name: 'publisher',
      description: 'Publisher role for managing campaigns',
      permissions: ['campaigns:read', 'campaigns:write', 'calls:read'],
    },
  });

  const buyerRole = await prisma.role.create({
    data: {
      name: 'buyer',
      description: 'Buyer role for receiving calls',
      permissions: ['calls:read', 'endpoints:read', 'endpoints:write'],
    },
  });
  console.log('✅ Created roles');

  // Assign admin role to user
  await prisma.userRole.create({
    data: {
      userId: adminUser.id,
      roleId: adminRole.id,
    },
  });

  // Create API key
  const apiKeyPrefix = 'cf_test_';
  const apiKeyValue = `${apiKeyPrefix}${Buffer.from(`${tenant.id}:${Date.now()}`).toString('base64')}`;
  const apiKeyHash = await bcrypt.hash(apiKeyValue, 10);

  await prisma.apiKey.create({
    data: {
      tenantId: tenant.id,
      name: 'Test API Key',
      keyHash: apiKeyHash,
      prefix: apiKeyPrefix.substring(0, 8),
      status: 'ACTIVE',
    },
  });
  console.log('✅ Created API key (prefix:', apiKeyPrefix.substring(0, 8) + ')');

  // Create carrier
  const carrier = await prisma.carrier.create({
    data: {
      tenantId: tenant.id,
      name: 'Test Carrier',
      code: 'TEST_CARRIER',
      status: 'ACTIVE',
    },
  });
  console.log('✅ Created carrier');

  // Create trunk
  const trunk = await prisma.trunk.create({
    data: {
      tenantId: tenant.id,
      carrierId: carrier.id,
      name: 'Test SIP Trunk',
      type: 'SIP',
      host: 'sip.example.com',
      port: 5060,
      username: 'test_user',
      password: 'encrypted_password',
      status: 'ACTIVE',
    },
  });
  console.log('✅ Created trunk');

  // Create phone numbers
  const phoneNumber1 = await prisma.phoneNumber.create({
    data: {
      tenantId: tenant.id,
      number: '+15551234567',
      carrierId: carrier.id,
      trunkId: trunk.id,
      status: 'ACTIVE',
      capabilities: ['voice', 'sms'],
    },
  });

  const phoneNumber2 = await prisma.phoneNumber.create({
    data: {
      tenantId: tenant.id,
      number: '+15559876543',
      carrierId: carrier.id,
      trunkId: trunk.id,
      status: 'ACTIVE',
      capabilities: ['voice'],
    },
  });
  console.log('✅ Created phone numbers');

  // Create caller ID pool
  const callerIdPool = await prisma.callerIdPool.create({
    data: {
      tenantId: tenant.id,
      name: 'Default Caller ID Pool',
      status: 'ACTIVE',
      phoneNumbers: {
        create: [
          {
            phoneNumberId: phoneNumber1.id,
            priority: 0,
          },
          {
            phoneNumberId: phoneNumber2.id,
            priority: 1,
          },
        ],
      },
    },
  });
  console.log('✅ Created caller ID pool');

  // Create publisher
  const publisher = await prisma.publisher.create({
    data: {
      tenantId: tenant.id,
      name: 'Test Publisher',
      code: 'TEST_PUB',
      status: 'ACTIVE',
    },
  });
  console.log('✅ Created publisher');

  // Create buyer
  const buyer = await prisma.buyer.create({
    data: {
      tenantId: tenant.id,
      publisherId: publisher.id,
      name: 'Test Buyer',
      code: 'TEST_BUYER',
      status: 'ACTIVE',
      endpoints: {
        create: [
          {
            type: 'SIP',
            destination: 'sip:buyer@example.com:5060',
            priority: 0,
            status: 'ACTIVE',
          },
          {
            type: 'PSTN',
            phoneNumberId: phoneNumber2.id,
            destination: '+15559876543',
            priority: 1,
            status: 'ACTIVE',
          },
        ],
      },
    },
  });
  console.log('✅ Created buyer with endpoints');

  // Create flow with 3 nodes: IVR -> Queue -> Buyer Failover
  const flow = await prisma.flow.create({
    data: {
      tenantId: tenant.id,
      name: 'Sample Campaign Flow',
      description: 'IVR -> Queue -> Buyer Failover',
      status: 'ACTIVE',
    },
  });

  // Create flow version
  const flowVersion = await prisma.flowVersion.create({
    data: {
      flowId: flow.id,
      version: 1,
      isActive: true,
    },
  });

  // Create nodes
  const ivrNode = await prisma.node.create({
    data: {
      flowVersionId: flowVersion.id,
      type: 'IVR',
      name: 'Welcome IVR',
      config: {
        greeting: 'Welcome to CallFabric. Press 1 to continue.',
        timeout: 5,
        maxDigits: 1,
      },
      position: { x: 100, y: 100 },
    },
  });

  const queueNode = await prisma.node.create({
    data: {
      flowVersionId: flowVersion.id,
      type: 'QUEUE',
      name: 'Call Queue',
      config: {
        maxWaitTime: 30,
        maxCallers: 10,
        musicOnHold: 'default',
      },
      position: { x: 300, y: 100 },
    },
  });

  const buyerNode = await prisma.node.create({
    data: {
      flowVersionId: flowVersion.id,
      type: 'BUYER_FORWARD',
      name: 'Buyer Failover',
      config: {
        buyerId: buyer.id,
        timeout: 15,
        retryAttempts: 2,
      },
      position: { x: 500, y: 100 },
    },
  });

  // Create edges: IVR -> Queue -> Buyer
  await prisma.edge.create({
    data: {
      flowVersionId: flowVersion.id,
      fromNodeId: ivrNode.id,
      toNodeId: queueNode.id,
      condition: 'digit == "1"',
      priority: 0,
    },
  });

  await prisma.edge.create({
    data: {
      flowVersionId: flowVersion.id,
      fromNodeId: queueNode.id,
      toNodeId: buyerNode.id,
      condition: 'timeout || no_answer',
      priority: 0,
    },
  });

  console.log('✅ Created flow with IVR -> Queue -> Buyer Failover nodes');

  // Create campaign
  const campaign = await prisma.campaign.create({
    data: {
      tenantId: tenant.id,
      publisherId: publisher.id,
      name: 'Test Campaign',
      status: 'ACTIVE',
      callerIdPoolId: callerIdPool.id,
      flowId: flow.id,
      metadata: {
        description: 'Sample test campaign',
        targetVolume: 1000,
      },
    },
  });
  console.log('✅ Created campaign');

  // Create billing account
  const billingAccount = await prisma.billingAccount.create({
    data: {
      tenantId: tenant.id,
      name: 'Primary Billing Account',
      status: 'ACTIVE',
      currency: 'USD',
      rateCards: {
        create: {
          name: 'Default Rate Card',
          effectiveFrom: new Date(),
          status: 'ACTIVE',
          rates: {
            inbound: { perMinute: 0.01 },
            outbound: { perMinute: 0.02 },
            sms: { perMessage: 0.005 },
          },
        },
      },
      balances: {
        create: {
          amount: 1000.0,
          currency: 'USD',
          type: 'AVAILABLE',
        },
      },
    },
  });
  console.log('✅ Created billing account with rate card and balance');

  // Create DNC list
  const dncList = await prisma.dncList.create({
    data: {
      tenantId: tenant.id,
      name: 'Global DNC List',
      type: 'GLOBAL',
      status: 'ACTIVE',
      entries: {
        create: [
          {
            phoneNumber: '+15551111111',
            reason: 'Customer requested',
            source: 'manual',
          },
          {
            phoneNumber: '+15552222222',
            reason: 'Regulatory compliance',
            source: 'system',
          },
        ],
      },
    },
  });
  console.log('✅ Created DNC list with entries');

  // Create webhook
  await prisma.webhook.create({
    data: {
      tenantId: tenant.id,
      url: 'https://example.com/webhooks/callfabric',
      events: ['call.initiated', 'call.completed', 'call.failed'],
      secret: 'webhook_secret_key_change_in_production',
      status: 'ACTIVE',
    },
  });
  console.log('✅ Created webhook');

  // Create feature flags
  await prisma.featureFlag.createMany({
    data: [
      {
        tenantId: tenant.id,
        key: 'advanced_analytics',
        value: true,
        description: 'Enable advanced analytics dashboard',
      },
      {
        tenantId: tenant.id,
        key: 'ai_transcription',
        value: true,
        description: 'Enable AI-powered transcription',
      },
      {
        tenantId: tenant.id,
        key: 'stir_shaken',
        value: false,
        description: 'Enable STIR/SHAKEN verification',
      },
    ],
  });
  console.log('✅ Created feature flags');

  console.log('\n🎉 Seeding completed successfully!');
  console.log('\n📋 Summary:');
  console.log(`   Tenant: ${tenant.slug} (${tenant.id})`);
  console.log(`   User: ${adminUser.email}`);
  console.log(`   Campaign: ${campaign.name} (${campaign.id})`);
  console.log(`   Flow: ${flow.name} (${flow.id})`);
  console.log(`   Publisher: ${publisher.name} (${publisher.id})`);
  console.log(`   Buyer: ${buyer.name} (${buyer.id})`);
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

