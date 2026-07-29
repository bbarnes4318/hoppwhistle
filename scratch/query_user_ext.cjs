const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { firstName: { contains: 'Kevin', mode: 'insensitive' } },
        { lastName: { contains: 'Kevin', mode: 'insensitive' } },
        { email: { contains: 'Kevin', mode: 'insensitive' } }
      ]
    },
    include: {
      phoneNumbers: true
    }
  });
  console.log(JSON.stringify(users, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
