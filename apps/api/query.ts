import { getPrismaClient } from './src/lib/prisma.js';

async function run() {
  const prisma = getPrismaClient();
  const users = await prisma.user.findMany({ where: { name: { contains: 'Chris' } } });
  console.log('USERS:', users.map(u => ({ id: u.id, name: u.name, email: u.email })));
  
  const routes = await prisma.didRoute.findMany({ where: { did: { contains: '2816991120' } } });
  console.log('ROUTES:', routes);

  // find extensions for chris
  // First check if the extension table exists or something equivalent
  // We'll see if the User model has extensions
  const extensions = await prisma.user.findMany({ 
    where: { name: { contains: 'Chris' } },
    include: { sipAccount: true, extensions: true }
  }).catch(() => null);
  console.log('EXTENSIONS (if any):', JSON.stringify(extensions, null, 2));
}

run()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
