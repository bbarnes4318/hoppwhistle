import { getPrismaClient } from '../lib/prisma.js';

async function run() {
  const prisma = getPrismaClient();

  console.log('--- QUERYING DID ROUTES ---');
  const routes = await prisma.didRoute.findMany({
    where: {
      OR: [
        { did: { contains: '8652524607' } },
        { did: { contains: '8666132993' } },
        { destination: { contains: '1b419be1-cccd' } },
        { destination: { contains: '8666132993' } }
      ]
    },
    include: {
      phoneNumber: {
        include: {
          user: true
        }
      }
    }
  });
  console.log('ROUTES:', JSON.stringify(routes, null, 2));

  console.log('--- QUERYING PHONE NUMBERS ---');
  const numbers = await prisma.phoneNumber.findMany({
    where: {
      OR: [
        { number: { contains: '8652524607' } },
        { number: { contains: '8666132993' } }
      ]
    },
    include: {
      user: true
    }
  });
  console.log('NUMBERS:', JSON.stringify(numbers, null, 2));

  console.log('--- QUERYING USER ---');
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { id: '1b419be1-cccd-40cb-99ae-ca88d696e370' },
        { metadata: { path: ['extension'], equals: '8666132993' } }
      ]
    }
  });
  console.log('USERS:', JSON.stringify(users, null, 2));
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
