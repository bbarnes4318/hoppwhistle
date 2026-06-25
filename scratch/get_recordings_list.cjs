const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const start = new Date('2026-06-23T00:00:00Z');
  const end = new Date('2026-06-25T23:59:59Z');
  const recordings = await prisma.recording.findMany({
    where: {
      createdAt: {
        gte: start,
        lte: end
      }
    },
    include: {
      call: {
        select: {
          callerId: true,
          toNumber: true,
          status: true,
          direction: true,
          duration: true
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
  
  // Custom replacer to serialize BigInt fields as strings
  const jsonString = JSON.stringify(recordings, (key, val) => 
    typeof val === 'bigint' ? val.toString() : val, 
    2
  );
  console.log(jsonString);
}
main().catch(console.error).finally(() => prisma.$disconnect());
