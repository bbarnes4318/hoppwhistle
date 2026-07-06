const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        tenantId: true,
        roles: {
          select: {
            role: {
              select: {
                name: true
              }
            }
          }
        }
      }
    });
    console.log("USERS:" + JSON.stringify(users, null, 2));

  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
