/**
 * Read and set the states an AGENT is licensed to work in.
 *
 *   pnpm --filter @hopwhistle/api agents:licenses                        # report
 *   pnpm --filter @hopwhistle/api agents:licenses -- --list  a@agency.com
 *   pnpm --filter @hopwhistle/api agents:licenses -- --set   a@agency.com TN,FL
 *   pnpm --filter @hopwhistle/api agents:licenses -- --clear a@agency.com
 *
 * ── Why this cannot be a backfill ────────────────────────────────────────────
 *
 * There is no column anywhere in this schema that records an agent's insurance
 * licence. Every `state` the database holds belongs to somebody else: the
 * prospect's address (`Lead.state`, `InsuranceLead.state`, `ProspectIntake.state`),
 * the applicant's (`InsuranceCarrierApplication.state`), the buyer's routing
 * preference (`BuyerEndpoint.acceptedStates`), or the agency's single home state
 * (`AgencyProfile.state`). None of them is a licence, and the two that look
 * closest are the most dangerous:
 *
 *   * the states of the leads an agent has HANDLED is a record of what they were
 *     given, which is the thing the licence is supposed to constrain -- reading
 *     it back as their licence would ratify every past violation;
 *   * the agency's home state is one state for the whole agency, and an agency
 *     in Tennessee employs agents licensed in Florida.
 *
 * So the licence is typed in by somebody who knows it, and this is where they
 * type it. It infers nothing. `--set` takes exactly the states given and no
 * others, which is also what makes it idempotent: running it twice leaves the
 * same list.
 *
 * ── Why a command and not psql ───────────────────────────────────────────────
 *
 * The same reason as `platform-admins.ts`. `UPDATE users SET metadata = ...` in
 * a psql session has to hand-merge a JSON column -- get it wrong and an agent
 * loses their softphone extension -- works once, on one database, and leaves
 * nothing that says it happened. This validates every state through the same
 * `normalizeStateCode()` the enforcement uses, so what an operator is told they
 * granted is exactly what will be enforced, and it prints before and after.
 *
 * It does NOT create accounts and does not grant roles. A licence on an account
 * that holds no AGENT role constrains nothing, and is reported rather than
 * refused: configuring somebody the day before they are made an agent is
 * legitimate.
 *
 * Requires DATABASE_URL. Reads only, unless --set or --clear is given.
 */

import {
  isLicensableState,
  normalizeStateCode,
  partitionLicensedStates,
} from '../lib/licensed-states.js';
import { getPrismaClient } from '../lib/prisma.js';

const prisma = getPrismaClient();

/**
 * The licence as stored, split the way enforcement will read it.
 *
 * Deliberately `partitionLicensedStates` from the enforcement module rather
 * than a second parser here: a report that disagreed with the code it is
 * reporting readiness for would be worse than no report.
 */
function readLicence(metadata: unknown) {
  return partitionLicensedStates((metadata as { licensedStates?: unknown } | null)?.licensedStates);
}

async function report(): Promise<number> {
  const users = await prisma.user.findMany({
    where: { roles: { some: { role: { name: 'AGENT' } } } },
    select: {
      email: true,
      metadata: true,
      tenant: { select: { name: true } },
    },
    orderBy: { email: 'asc' },
  });

  if (users.length === 0) {
    console.log('No account holds the AGENT role. Nothing to configure.');
    return 0;
  }

  const agents = users.map(user => ({
    email: user.email,
    tenant: user.tenant?.name ?? '(no agency)',
    ...readLicence(user.metadata),
  }));

  const width = Math.max(...agents.map(a => a.email.length), 5);
  console.log(`${'EMAIL'.padEnd(width)}  ${'AGENCY'.padEnd(20)}  LICENSED STATES`);
  for (const agent of agents) {
    const shown = agent.licensed.length > 0 ? agent.licensed.join(',') : '(none — blocked)';
    const note =
      agent.rejected.length > 0 ? `   ! dropped: ${agent.rejected.map(String).join(',')}` : '';
    console.log(
      `${agent.email.padEnd(width)}  ${agent.tenant.slice(0, 20).padEnd(20)}  ${shown}${note}`
    );
  }

  const blocked = agents.filter(a => a.licensed.length === 0);
  const rotted = agents.filter(a => a.rejected.length > 0);

  console.log();
  console.log(
    `${agents.length} agent(s); ${agents.length - blocked.length} licensed, ${blocked.length} not.`
  );
  if (rotted.length > 0) {
    console.log(
      `${rotted.length} carry entries enforcement cannot read; those entries grant nothing.`
    );
  }

  if (blocked.length > 0) {
    console.log();
    console.log('These agents can perform no state-authorized operation until a licence is set:');
    for (const agent of blocked) console.log(`  ${agent.email}`);
    console.log();
    console.log('Set each one to the licence they actually hold, e.g.');
    console.log(
      `  pnpm --filter @hopwhistle/api agents:licenses -- --set ${blocked[0].email} TN,FL`
    );
    return 1;
  }

  return 0;
}

async function findAccount(email: string) {
  const user = await prisma.user.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: {
      id: true,
      email: true,
      metadata: true,
      tenant: { select: { name: true } },
      roles: { select: { role: { select: { name: true } } } },
    },
  });
  if (!user) {
    console.error(`No account for ${email}. This command does not create accounts.`);
    return null;
  }
  return user;
}

async function list(email: string): Promise<number> {
  const user = await findAccount(email);
  if (!user) return 1;

  const { licensed, rejected } = readLicence(user.metadata);
  console.log(`${user.email}  (${user.tenant?.name ?? 'no agency'})`);
  console.log(`  roles:    ${user.roles.map(r => r.role.name).join(',') || '(none)'}`);
  console.log(`  licensed: ${licensed.join(',') || '(none — blocked)'}`);
  if (rejected.length > 0) {
    console.log(`  dropped:  ${rejected.map(String).join(',')}  (not US states; grant nothing)`);
  }
  return licensed.length > 0 ? 0 : 1;
}

/**
 * Replace the licence with exactly these states.
 *
 * The whole call is refused if any entry is not a state, rather than the bad
 * entries being dropped: an operator who pastes "Tennesee" and is told nothing
 * has granted a licence they believe they granted, and the agent finds out by
 * being refused a call. Same rule as `PATCH /api/v1/users/:userId`.
 */
async function set(email: string, spec: string): Promise<number> {
  const user = await findAccount(email);
  if (!user) return 1;

  const requested = spec
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  if (requested.length === 0) {
    console.error('No states given. Use --clear to remove a licence.');
    return 2;
  }

  const codes: string[] = [];
  const bad: string[] = [];
  for (const entry of requested) {
    const code = normalizeStateCode(entry);
    if (code && isLicensableState(code)) codes.push(code);
    else bad.push(entry);
  }

  if (bad.length > 0) {
    console.error(`Not US states: ${bad.join(', ')}. Nothing was changed.`);
    return 2;
  }

  const before = readLicence(user.metadata);
  const after = [...new Set(codes)].sort();

  // Merged, never replaced: `metadata` also carries the softphone extension,
  // the agent's position and their scripts.
  const metadata = { ...((user.metadata as Record<string, unknown> | null) ?? {}) };
  metadata.licensedStates = after;

  await prisma.user.update({ where: { id: user.id }, data: { metadata: metadata as object } });

  const roles = user.roles.map(r => r.role.name);
  console.log(`${user.email}`);
  console.log(`  before: ${before.licensed.join(',') || '(none)'}`);
  console.log(`  after:  ${after.join(',')}`);
  if (!roles.includes('AGENT')) {
    console.log(`  note:   this account holds ${roles.join(',') || 'no role'}, not AGENT, so the`);
    console.log('          licence constrains nothing today. It applies if AGENT is granted.');
  }
  return 0;
}

async function clear(email: string): Promise<number> {
  const user = await findAccount(email);
  if (!user) return 1;

  const before = readLicence(user.metadata);
  const metadata = { ...((user.metadata as Record<string, unknown> | null) ?? {}) };
  delete metadata.licensedStates;

  await prisma.user.update({ where: { id: user.id }, data: { metadata: metadata as object } });

  console.log(`${user.email}`);
  console.log(`  before: ${before.licensed.join(',') || '(none)'}`);
  console.log('  after:  (none) — this account can now perform no state-authorized operation.');
  return 0;
}

const USAGE = [
  'agents:licenses — read and set the states an AGENT may work in.',
  '',
  '  (no arguments)           report every AGENT and whether they are licensed',
  '  --list  <email>          one account',
  '  --set   <email> <TN,FL>  replace that account’s licence with exactly these states',
  '  --clear <email>          remove the licence entirely',
  '',
  'Nothing here infers a licence from other data. Requires DATABASE_URL.',
].join('\n');

async function main(): Promise<number> {
  const argv = process.argv.slice(2);

  if (argv.includes('-h') || argv.includes('--help')) {
    console.log(USAGE);
    return 0;
  }

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Nothing was read.');
    return 2;
  }

  const flag = argv[0];
  if (!flag || flag === '--report') return report();
  if (flag === '--list' && argv[1]) return list(argv[1]);
  if (flag === '--clear' && argv[1]) return clear(argv[1]);
  if (flag === '--set' && argv[1] && argv[2]) return set(argv[1], argv[2]);

  console.error('Unrecognised arguments.\n');
  console.error(USAGE);
  return 2;
}

main()
  .then(async code => {
    await prisma.$disconnect();
    process.exit(code);
  })
  .catch(async (err: unknown) => {
    console.error((err as Error).message);
    await prisma.$disconnect();
    process.exit(2);
  });
