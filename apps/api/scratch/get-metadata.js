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
      }
    });
    console.log("Metadata:", JSON.stringify(users.map(u => ({ email: u.email, id: u.id, metadata: u.metadata })), null, 2));
  } finally {
    await prisma.$disconnect();
  }
}
run();
