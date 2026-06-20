import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding BulkVS DIDs...');

  // Find the active tenant
  const tenant = await prisma.tenant.findFirst({
    where: {
      OR: [
        { slug: 'test-org' },
        { domain: 'test.callfabric.local' }
      ]
    }
  });

  if (!tenant) {
    console.error('❌ Active tenant not found!');
    return;
  }
  console.log('🏢 Found active tenant:', tenant.name, `(${tenant.id})`);

  // Find or create default Carrier and Trunk if needed
  let carrier = await prisma.carrier.findFirst();
  let trunk = await prisma.trunk.findFirst();

  if (!carrier) {
    carrier = await prisma.carrier.create({
      data: {
        tenantId: tenant.id,
        name: 'Default Carrier',
        status: 'ACTIVE',
      }
    });
    console.log('✅ Created default carrier:', carrier.name);
  } else {
    console.log('ℹ️ Using existing carrier:', carrier.name);
  }

  if (!trunk) {
    trunk = await prisma.trunk.create({
      data: {
        tenantId: tenant.id,
        carrierId: carrier.id,
        name: 'Default Trunk',
        status: 'ACTIVE',
      }
    });
    console.log('✅ Created default trunk:', trunk.name);
  } else {
    console.log('ℹ️ Using existing trunk:', trunk.name);
  }

  const bulkVsDids = [
    '12816989460', '12816989461',
    '14063165877', '14402992856',
    '14402992860', '16102819660',
    '16102819662', '17038313168',
    '17042283589', '17042286088',
    '18036135410', '18036135412',
    '19124185540', '19124185542',
    '19542083921', '19542083922'
  ];

  const phoneNumbersFormatted = bulkVsDids.map(did => `+${did}`);

  // Delete existing occurrences to avoid duplicates
  const deleted = await prisma.phoneNumber.deleteMany({
    where: {
      tenantId: tenant.id,
      number: { in: phoneNumbersFormatted }
    }
  });
  console.log(`🧹 Deleted ${deleted.count} matching phone numbers to avoid conflicts.`);

  // Create DIDs
  for (const did of bulkVsDids) {
    const formatted = `+${did}`;
    await prisma.phoneNumber.create({
      data: {
        tenantId: tenant.id,
        number: formatted,
        carrierId: carrier.id,
        trunkId: trunk.id,
        status: 'ACTIVE',
        capabilities: ['voice'],
      },
    });
    console.log(`📞 Inserted phone number: ${formatted}`);
  }

  console.log('🎉 Successfully seeded all 16 BulkVS DIDs!');
}

main()
  .catch(err => {
    console.error('❌ Error seeding BulkVS DIDs:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
