const { getPrismaClient } = require('./dist/index.js');

async function run() {
  const p = getPrismaClient();
  const users = await p.user.findMany({
    include: { roles: { include: { role: true } } },
    take: 30,
  });
  users.forEach(u => {
    const roleNames = u.roles.map(r => r.role.name).join(', ');
    console.log(u.email + ' | ' + (roleNames || 'NO_ROLES') + ' | ' + u.id);
  });
}

run().catch(e => console.error(e));
