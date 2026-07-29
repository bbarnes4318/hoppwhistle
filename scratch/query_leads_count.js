const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    const totalCount = await prisma.insuranceLead.count();
    console.log("TOTAL LEADS IN DB: " + totalCount);

    const tenants = await prisma.tenant.findMany({
      select: { id: true, name: true }
    });
    console.log("TENANTS: " + JSON.stringify(tenants, null, 2));

    const leadsByTenant = await prisma.insuranceLead.groupBy({
      by: ['tenantId'],
      _count: true
    });
    console.log("LEADS BY TENANT: " + JSON.stringify(leadsByTenant, null, 2));

    const sampleLeads = await prisma.insuranceLead.findMany({
      take: 5,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        tenantId: true,
        vertical: true,
        status: true,
        createdAt: true
      }
    });
    console.log("SAMPLE LEADS: " + JSON.stringify(sampleLeads, null, 2));

  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
