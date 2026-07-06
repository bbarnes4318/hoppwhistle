const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    const calls = await prisma.call.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        callerId: true,
        toNumber: true,
        fromNumberId: true,
        direction: true,
        status: true,
        createdAt: true
      }
    });
    console.log("CALLS:" + JSON.stringify(calls, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
