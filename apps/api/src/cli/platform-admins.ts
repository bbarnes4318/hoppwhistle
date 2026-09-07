/**
 * Grant, revoke and list the NetEnroll platform capability.
 *
 *   pnpm --filter @hopwhistle/api platform:admins            # list
 *   pnpm --filter @hopwhistle/api platform:admins -- --sync  # provision the launch set
 *   pnpm --filter @hopwhistle/api platform:admins -- --invite someone@example.com
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
 * `--invite` issues an activation grant for that path, carrying NO tenant, and
 * prints the token. It does not create an account either: the invitee registers
 * with the token themselves, and the account that appears belongs to no agency
 * and holds no role until `--grant` is run for it. The invitation and the
 * capability stay two deliberate acts.
 *
 * Requires DATABASE_URL.
 */

import { grantPlatformAdmin, revokePlatformAdmin } from '../lib/platform-admin.js';
import { getPrismaClient } from '../lib/prisma.js';
import { issueActivationGrant } from '../services/tenant-activation.js';

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
      `  ${email}: no account. Invite them with --invite ${email}, have them ` +
        `register with the token it prints, then re-run.`
    );
    return false;
  }

  const { created } = await grantPlatformAdmin(user.id, { note });
  console.log(`  ${email}: ${created ? 'granted' : 'already a platform admin'}`);
  return true;
}

/**
 * Invite NetEnroll staff: a single-use activation grant carrying NO tenant.
 *
 * ── Why this is here and not on the HTTP surface ─────────────────────────────
 *
 * Self-serve signup requires an invitation (Phase 1). Every invitation the API
 * can issue carries a tenant, because `POST /api/v1/auth/activation-grants`
 * invites into the CALLER'S OWN agency and has deliberately no tenantId field.
 * Inviting NetEnroll staff through one of those would create a NetEnroll
 * employee inside a customer's agency -- visible in that customer's team
 * roster, holding one of its roles -- and a platform admin's `User.tenantId` is
 * null by design.
 *
 * So the grant has to be able to say "no agency", and minting one has to be at
 * least as hard as granting the capability itself. It is: this command needs
 * shell access to the host and DATABASE_URL, which is the same bar. There is no
 * HTTP route that issues a PLATFORM_INVITE, and the closure test asserts no
 * authenticated request of any kind creates a PlatformAdmin row.
 *
 * ── What the invitee gets ────────────────────────────────────────────────────
 *
 * An account with no agency and no role, which can read nothing at all. It
 * becomes a platform admin only when `--grant` is run for it separately. The
 * invitation and the capability are two deliberate acts, not one.
 */
async function invite(email: string): Promise<void> {
  const normalized = email.trim().toLowerCase();

  const existing = await findUser(normalized);
  if (existing) {
    console.log(
      `  ${normalized}: already has an account. No invitation needed \u2014 run\n` +
        `    pnpm --filter @hopwhistle/api platform:admins -- --grant ${normalized}`
    );
    return;
  }

  const grantResult = await issueActivationGrant({
    // No agency. See the note above.
    tenantId: null,
    email: normalized,
    source: 'PLATFORM_INVITE',
  });

  const appUrl = process.env.APP_URL ?? 'https://agents.netenroll.com';

  console.log(`Platform invitation for ${normalized}\n`);
  console.log(`  Activation token (shown once, never stored in plaintext):\n`);
  console.log(`    ${grantResult.token}\n`);
  console.log(`  Expires: ${grantResult.expiresAt.toISOString()}\n`);
  console.log(`  Send them this, and have them register with it:\n`);
  console.log(
    `    curl -sS -X POST ${appUrl}/api/auth/register \\\n` +
      `      -H 'Content-Type: application/json' \\\n` +
      `      -d '{"email":"${normalized}",` +
      `"password":"<their-password>",` +
      `"firstName":"<first>","lastName":"<last>",` +
      `"activationToken":"${grantResult.token}"}'\n`
  );
  console.log(`  Then, on this host:\n`);
  console.log(
    `    pnpm --filter @hopwhistle/api platform:admins -- --grant ${normalized}\n`
  );
  console.log(
    `  The account this creates belongs to no agency and holds no role. It can\n` +
      `  read nothing until that second command is run.`
  );
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

  const inviteIdx = args.indexOf('--invite');
  if (inviteIdx !== -1) {
    const email = args[inviteIdx + 1];
    if (!email) throw new Error('--invite needs an email address');
    await invite(email);
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
