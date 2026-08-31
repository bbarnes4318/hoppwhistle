/**
 * Read-only audit of every account and how it came to exist.
 *
 * Written for one question: did anybody create an account through the public
 * signup route that nobody intended to exist? Until the accompanying fix,
 * `assignDefaultRole()` handed ADMIN to every self-serve signup, so any account
 * whose provenance is SELF_SERVE_* and whose roles include ADMIN or OWNER is a
 * privilege the platform never meant to grant.
 *
 * THIS SCRIPT ONLY READS. It issues no writes of any kind -- no deletes, no
 * role changes, no status changes. Decide what to do about what it finds, then
 * do that deliberately and separately.
 *
 *   pnpm --filter @hopwhistle/api audit:accounts
 *   pnpm --filter @hopwhistle/api audit:accounts -- --json > accounts.json
 *
 * Requires DATABASE_URL to point at the database being audited.
 */

import { getPrismaClient } from '../lib/prisma.js';

type Provenance =
  | 'SELF_SERVE_EMAIL'
  | 'SELF_SERVE_GOOGLE'
  | 'INVITED'
  | 'SEED_OR_MANUAL'
  | 'UNKNOWN';

interface Row {
  email: string;
  createdAt: string;
  status: string;
  authMethod: string | null;
  roles: string[];
  provenance: Provenance;
  privileged: boolean;
  tenantId: string | null;
  lastLoginAt: string | null;
}

/**
 * How the account was made, inferred from the columns each path writes.
 *
 * `/api/v1/users/invite` is the only path that sets metadata.invitedBy and
 * metadata.tempPassword, so it is identifiable outright. Registration is the
 * only path that writes metadata.position and metadata.defaultScript. The
 * Google branch of /api/auth/google sets authMethod GOOGLE and writes no
 * metadata at all. Anything left is a seed script or a hand-made row.
 *
 * Caveat worth knowing before you act on the output: an account created by
 * seed and later linked to Google reads as GOOGLE, and an invited user is
 * identified by metadata that a later profile update could overwrite. Treat
 * SEED_OR_MANUAL and UNKNOWN as "look at this by hand", not as "safe".
 */
function classify(user: {
  authMethod: string | null;
  metadata: unknown;
  passwordHash: string | null;
}): Provenance {
  const meta = (user.metadata ?? {}) as Record<string, unknown>;

  if (meta.invitedBy !== undefined || meta.tempPassword !== undefined) return 'INVITED';
  if (user.authMethod === 'GOOGLE') return 'SELF_SERVE_GOOGLE';
  if (
    user.authMethod === 'EMAIL' &&
    (meta.position !== undefined || meta.defaultScript !== undefined)
  )
    return 'SELF_SERVE_EMAIL';
  if (user.authMethod === 'EMAIL' && user.passwordHash) return 'SEED_OR_MANUAL';

  return 'UNKNOWN';
}

async function main(): Promise<void> {
  const asJson = process.argv.includes('--json');
  const prisma = getPrismaClient();

  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'asc' },
    include: { roles: { include: { role: true } } },
  });

  const rows: Row[] = users.map(user => {
    const roles = user.roles.map(userRole => userRole.role.name as string).sort();
    return {
      email: user.email,
      createdAt: user.createdAt.toISOString(),
      status: user.status,
      authMethod: user.authMethod,
      roles,
      provenance: classify(user),
      privileged: roles.includes('ADMIN') || roles.includes('OWNER'),
      tenantId: user.tenantId,
      lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    };
  });

  if (asJson) {
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    await prisma.$disconnect();
    return;
  }

  const selfServe = rows.filter(
    row => row.provenance === 'SELF_SERVE_EMAIL' || row.provenance === 'SELF_SERVE_GOOGLE'
  );
  const escalated = selfServe.filter(row => row.privileged);

  const pad = (value: string, width: number): string =>
    value.length > width ? value.slice(0, width - 1) + '…' : value.padEnd(width);

  console.log(`\n${users.length} account(s), oldest first\n`);
  console.log(
    pad('CREATED', 22) + pad('EMAIL', 38) + pad('PROVENANCE', 20) + pad('STATUS', 10) + 'ROLES'
  );
  console.log('-'.repeat(118));
  for (const row of rows) {
    const marker =
      row.privileged && row.provenance.startsWith('SELF_SERVE') ? '  <== ESCALATED' : '';
    console.log(
      pad(row.createdAt.replace('T', ' ').slice(0, 19), 22) +
        pad(row.email, 38) +
        pad(row.provenance, 20) +
        pad(row.status, 10) +
        (row.roles.join(',') || '(none)') +
        marker
    );
  }

  console.log('\nSummary');
  console.log(`  total accounts          ${rows.length}`);
  console.log(`  self-serve signups      ${selfServe.length}`);
  console.log(`  invited                 ${rows.filter(r => r.provenance === 'INVITED').length}`);
  console.log(
    `  seed / manual / unknown ${rows.filter(r => r.provenance === 'SEED_OR_MANUAL' || r.provenance === 'UNKNOWN').length}`
  );
  console.log(`  ADMIN or OWNER in total ${rows.filter(r => r.privileged).length}`);
  console.log(`  SELF-SERVE AND PRIVILEGED  ${escalated.length}`);

  if (escalated.length > 0) {
    console.log('\nAccounts that gained ADMIN/OWNER through public signup:');
    for (const row of escalated) {
      console.log(
        `  ${row.email}  created ${row.createdAt.replace('T', ' ').slice(0, 19)}  ` +
          `roles ${row.roles.join(',')}  last login ${row.lastLoginAt ?? 'never'}`
      );
    }
    console.log('\nNothing was changed. Review each one before acting.');
  } else {
    console.log('\nNo account gained ADMIN or OWNER through public signup.');
  }

  await prisma.$disconnect();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
