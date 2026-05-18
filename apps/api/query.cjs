const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const users = await prisma.user.findMany({ where: { name: { contains: 'Chris' } } });
  console.log('USERS:', users);
  
  const routes = await prisma.didRoute.findMany({ where: { did: { contains: '2816991120' } } });
  console.log('ROUTES:', routes);
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
