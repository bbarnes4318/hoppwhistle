/**
 * Grant, revoke and list the NetEnroll platform capability.
 *
 *   pnpm --filter @hopwhistle/api platform:admins            # list
 *   pnpm --filter @hopwhistle/api platform:admins -- --sync  # provision the launch set
 *   pnpm --filter @hopwhistle/api platform:admins -- --grant  someone@example.com
 *   pnpm --filter @hopwhistle/api platform:admins -- --revoke someone@example.com
 *
 * ── Why a command and not a hand-edit ────────────────────────────────────────
 *
 * `INSERT INTO platform_admins` in a psql session works exactly once, on one
 * database, by whoever happened to be at the keyboard, and leaves nothing that
 * says it happened. This capability sees every agency's callers, applications
 * and money. The way it is granted should be readable, re-runnable and the same
 * in staging as in production.
 *
 * `--sync` is idempotent: it grants the launch set to whichever of them have
 * accounts, reports the ones that do not, and never revokes. Re-running it
 * after the missing accounts exist finishes the job. It deliberately does NOT
 * create user accounts -- a login is created by the normal invitation path, and
 * a provisioning script that mints accounts is a second way in.
 *
 * Requires DATABASE_URL.
 */

import { grantPlatformAdmin, revokePlatformAdmin } from '../lib/platform-admin.js';
import { getPrismaClient } from '../lib/prisma.js';

/**
 * The two operators the platform launches with.
 *
 * The repo owner is identified by `PLATFORM_ADMIN_EMAILS` (comma-separated) so
 * the value is not hardcoded to one person's address in a public repository;
 * Joel is named here because the brief names him and because a launch set of
 * one is a single point of failure.
 */
const LAUNCH_SET: string[] = [
  ...(process.env.PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean),
  'joel.vasquez@outlook.com',
];

async function findUser(email: string) {
  const prisma = getPrismaClient();
  return prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, email: true, status: true },
  });
}

async function list(): Promise<void> {
  const prisma = getPrismaClient();
  const admins = await prisma.platformAdmin.findMany({
    include: {
      user: {
        select: {
          email: true,
          status: true,
          platformActingTenant: { select: { enteredAt: true, tenant: { select: { name: true } } } },
        },
      },
    },
    orderBy: { grantedAt: 'asc' },
  });

  if (admins.length === 0) {
    console.log('No platform admins. Run with --sync to provision the launch set.');
    return;
  }

  console.log(`${admins.length} platform admin(s):\n`);
  for (const admin of admins) {
    const inside = admin.user.platformActingTenant;
    const where = inside
      ? `inside "${inside.tenant.name}" since ${inside.enteredAt.toISOString()}`
      : 'cross-agency view';
    console.log(
      `  ${admin.user.email.padEnd(36)} ${admin.user.status.padEnd(10)} ${where}` +
        (admin.note ? `\n    note: ${admin.note}` : '')
    );
  }
}

async function grant(email: string, note?: string): Promise<boolean> {
  const user = await findUser(email);
  if (!user) {
    console.error(
      `  ${email}: no account. Invite them first ` +
        `(POST /api/v1/auth/activation-grants), then re-run.`
    );
    return false;
  }

  const { created } = await grantPlatformAdmin(user.id, { note });
  console.log(`  ${email}: ${created ? 'granted' : 'already a platform admin'}`);
  return true;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes('--sync')) {
    console.log('Provisioning the platform admin launch set...\n');
    if (LAUNCH_SET.length === 1) {
      console.warn(
        'PLATFORM_ADMIN_EMAILS is unset, so only Joel is in the launch set. ' +
          'Set it to the repo owner\'s address and re-run.\n'
      );
    }

    let missing = 0;
    for (const email of LAUNCH_SET) {
      const ok = await grant(email, 'launch set (platform:admins --sync)');
      if (!ok) missing++;
    }

    console.log();
    await list();

    if (missing > 0) {
      console.log(
        `\n${missing} address(es) had no account yet. This command does not create ` +
          'logins; invite them, then re-run --sync. Nothing else is needed.'
      );
    }
    return;
  }

  const grantIdx = args.indexOf('--grant');
  if (grantIdx !== -1) {
    const email = args[grantIdx + 1];
    if (!email) throw new Error('--grant needs an email address');
    await grant(email, 'granted via platform:admins --grant');
    return;
  }

  const revokeIdx = args.indexOf('--revoke');
  if (revokeIdx !== -1) {
    const email = args[revokeIdx + 1];
    if (!email) throw new Error('--revoke needs an email address');
    const user = await findUser(email);
    if (!user) {
      console.error(`  ${email}: no account`);
      return;
    }
    await revokePlatformAdmin(user.id);
    console.log(`  ${email}: revoked (and dropped out of any agency they were inside)`);
    return;
  }

  await list();
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => {
    void getPrismaClient().$disconnect();
  });
