#!/usr/bin/env tsx
import 'dotenv-flow/config';
import { getPrismaClient } from '../lib/prisma.js';

async function run() {
  const prisma = getPrismaClient();
  try {
    const users = await prisma.user.findMany({
      include: {
        roles: { include: { role: true } },
        phoneNumbers: true,
      }
    });
    console.log('=== USERS ===');
    console.log(JSON.stringify(users.map(u => ({
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      metadata: u.metadata,
      roles: u.roles.map(r => r.role.name),
      assignedNumbers: u.phoneNumbers.map(n => n.number),
    })), null, 2));

    const numbers = await prisma.phoneNumber.findMany({
      include: {
        user: true,
        campaign: true,
      }
    });
    console.log('\n=== PHONE NUMBERS ===');
    console.log(JSON.stringify(numbers.map(n => ({
      id: n.id,
      number: n.number,
      userId: n.userId,
      userEmail: n.user?.email,
      campaignName: n.campaign?.name,
      status: n.status,
    })), null, 2));

    const routes = await prisma.didRoute.findMany();
    console.log('\n=== DID ROUTES ===');
    console.log(JSON.stringify(routes, null, 2));
  } catch (err) {
    console.error('Error querying DB:', err);
  } finally {
    await prisma.$disconnect();
  }
}

run();
