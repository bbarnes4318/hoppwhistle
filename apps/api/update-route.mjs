import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  try {
    // We need a tenant ID. Let's just grab the first one, or see if the user is associated with one
    const tenant = await prisma.tenant.findFirst();
    if (!tenant) {
      console.log('No tenant found');
      return;
    }
    
    // We need to find or create the phone number so we can link it
    let phone = await prisma.phoneNumber.findFirst({
      where: { number: '+12816991120' }
    });
    
    if (!phone) {
      phone = await prisma.phoneNumber.findFirst({
        where: { number: '2816991120' }
      });
    }

    if (!phone) {
      console.log('Phone number not found in DB. Creating one...');
      phone = await prisma.phoneNumber.create({
        data: {
          tenantId: tenant.id,
          number: '+12816991120',
          provider: 'bulkvs',
          status: 'ACTIVE'
        }
      });
    }

    // Now upsert the DidRoute
    const route = await prisma.didRoute.findFirst({
      where: { did: '+12816991120' }
    });

    if (route) {
       await prisma.didRoute.update({
         where: { id: route.id },
         data: { destination: '1000,1001|+16465838647' }
       });
       console.log('Updated existing route');
    } else {
       await prisma.didRoute.create({
         data: {
           tenantId: tenant.id,
           phoneNumberId: phone.id,
           did: '+12816991120',
           destination: '1000,1001|+16465838647'
         }
       });
       console.log('Created new route');
    }

    console.log('Successfully assigned 2816991120 to 1000,1001|+16465838647');

  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}
run();
