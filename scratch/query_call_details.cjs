const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const nums = ['3604585060', '3612354297'];
  const calls = await prisma.call.findMany({
    where: {
      OR: [
        { toNumber: { in: nums } },
        { callerId: { in: nums } }
      ],
      createdAt: {
        gte: new Date('2026-06-24T00:00:00Z')
      }
    },
    select: {
      id: true,
      toNumber: true,
      createdAt: true,
      duration: true,
      recordingStatus: true,
      recordingError: true,
      recordingUrl: true,
      metadata: true
    },
    orderBy: { createdAt: 'desc' }
  });
  console.log(JSON.stringify(calls, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
