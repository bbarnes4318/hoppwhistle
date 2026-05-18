const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function run() {
  try {
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { firstName: "Chris" },
          { email: { contains: "chris" } },
          { email: { contains: "cpoleway" } }
        ]
      },
      include: {
        roles: { include: { role: true } }
      }
    });
    console.log("Users:", JSON.stringify(users, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}
run();
