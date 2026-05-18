import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { email: { contains: 'chris' } },
        { email: { contains: 'cpoleway' } },
        { firstName: { contains: 'chris', mode: 'insensitive' } },
        { firstName: { contains: 'christopher', mode: 'insensitive' } }
      ]
    }
  });
  console.log(JSON.stringify(users, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
