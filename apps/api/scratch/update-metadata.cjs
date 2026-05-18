const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function run() {
  try {
    // Chris 1
    await prisma.user.update({
      where: { id: "4eda8abc-ed51-457b-ae1d-7f5732145c8b" },
      data: {
        metadata: {
          extension: "1000"
        }
      }
    });
    
    // Chris 2
    await prisma.user.update({
      where: { id: "5c571318-0105-474f-95af-edadb1415cdc" },
      data: {
        metadata: {
          extension: "1001"
        }
      }
    });

    console.log("Successfully updated metadata for Chris 1 and Chris 2");
  } catch (err) {
    console.error("Error updating metadata:", err);
  } finally {
    await prisma.$disconnect();
  }
}
run();
