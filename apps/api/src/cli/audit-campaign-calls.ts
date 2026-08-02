import { getPrismaClient } from '../lib/prisma.js';

/**
 * CLI Audit script to identify any orphaned AI Campaign Calls prior to foreign key enforcement.
 *
 * Usage:
 *   pnpm --filter @hopwhistle/api exec tsx src/cli/audit-campaign-calls.ts
 */
async function main() {
  const prisma = getPrismaClient();
  try {
    const orphans = await prisma.$queryRaw<Array<{ id: string; contactId: string }>>`
      SELECT c.id, c."contactId"
      FROM ai_campaign_calls c
      LEFT JOIN ai_campaign_contacts ac ON ac.id = c."contactId"
      WHERE ac.id IS NULL;
    `;
    console.log(`Orphaned AI Campaign Calls count: ${orphans.length}`);
    if (orphans.length > 0) {
      console.log('Orphaned rows:', JSON.stringify(orphans, null, 2));
    }
  } catch (error) {
    console.error('Audit query failed:', error);
    process.exit(1);
  }
}

main().catch(console.error);
