import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const users = await prisma.user.findMany();
  console.log("USERS:", JSON.stringify(users, null, 2));

  const endpoints = await prisma.buyerEndpoint.findMany({
    include: { buyer: true }
  });
  console.log("ENDPOINTS:", JSON.stringify(endpoints, null, 2));
}
main().catch(console.error).finally(() => prisma.$disconnect());
