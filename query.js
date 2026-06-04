import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const users = await p.user.findMany({ select: { id: true, email: true, firstName: true, metadata: true } });
console.log('USERS:', JSON.stringify(users, null, 2));
const numbers = await p.phoneNumber.findMany({ select: { id: true, number: true, userId: true } });
console.log('NUMBERS:', JSON.stringify(numbers, null, 2));
const routes = await p.didRoute.findMany();
console.log('ROUTES:', JSON.stringify(routes, null, 2));
await p.$disconnect();
