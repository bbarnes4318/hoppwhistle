const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const last10s = ['3604585060', '3612354297'];
  for (const num of last10s) {
    console.log('=== CALLS FOR ' + num + ' ===');
    const calls = await prisma.call.findMany({
      where: {
        OR: [
          { callerId: { endsWith: num } },
          { toNumber: { endsWith: num } }
        ]
      },
      orderBy: { createdAt: 'desc' }
    });
    console.log(JSON.stringify(calls, null, 2));
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
