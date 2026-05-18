import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  try {
    const endpoints = await prisma.buyerEndpoint.findMany({
      where: {
        name: {
          contains: 'Chris'
        }
      }
    });
    console.log('ENDPOINTS:', endpoints);

    const routes = await prisma.didRoute.findMany({ where: { did: { contains: '2816991120' } } });
    console.log('ROUTES:', routes);

  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}
run();
