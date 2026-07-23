const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  try {
    // 1. Get the Role ID for ADMIN and AGENT
    const roles = await prisma.role.findMany();
    console.log("Available Roles:", roles);

    const adminRole = roles.find(r => r.name === 'ADMIN');
    let agentRole = roles.find(r => r.name === 'AGENT');

    if (!adminRole) {
      throw new Error(`Required ADMIN role not found.`);
    }

    if (!agentRole) {
      console.log("AGENT role not found in database. Creating it...");
      agentRole = await prisma.role.create({
        data: {
          name: 'AGENT',
          description: 'Call center agent access',
          permissions: ['calls:read', 'recordings:read']
        }
      });
      console.log("Created AGENT role with ID:", agentRole.id);
    }

    // 2. Find all users who have the ADMIN role
    const adminUserRoles = await prisma.userRole.findMany({
      where: { roleId: adminRole.id },
      include: {
        user: true
      }
    });

    console.log(`Found ${adminUserRoles.length} users with ADMIN role.`);

    // Allowed Admins: Jimmy Barnes and Yazzyl Vasquez
    const allowedAdminEmails = [
      'jimbosky35@gmail.com',
      'admin@americanbeneficiary.com',
      'hallken9@gmail.com'
    ];

    for (const ur of adminUserRoles) {
      const email = ur.user.email?.toLowerCase().trim();
      const name = `${ur.user.firstName || ''} ${ur.user.lastName || ''}`.trim() || ur.user.email;
      
      if (!allowedAdminEmails.includes(email)) {
        console.log(`Demoting user ${name} (${email}) from ADMIN to AGENT...`);

        // Remove ADMIN role
        await prisma.userRole.delete({
          where: {
            userId_roleId: {
              userId: ur.userId,
              roleId: adminRole.id
            }
          }
        });

        // Add AGENT role if they don't already have it
        const hasAgent = await prisma.userRole.findFirst({
          where: { userId: ur.userId, roleId: agentRole.id }
        });

        if (!hasAgent) {
          await prisma.userRole.create({
            data: {
              userId: ur.userId,
              roleId: agentRole.id
            }
          });
          console.log(`Added AGENT role to ${name}.`);
        } else {
          console.log(`${name} already has AGENT role.`);
        }
      } else {
        console.log(`Keeping user ${name} (${email}) as ADMIN.`);
      }
    }

    console.log("Admin role restrictions completed successfully!");
  } catch (err) {
    console.error("Error executing restrict-admins script:", err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
