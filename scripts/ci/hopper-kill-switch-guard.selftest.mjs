#!/usr/bin/env node
/**
 * Self-test for HOPPER_KILL_SWITCH_GUARD.
 *
 * The guard passes against the current tree, which proves nothing on its own —
 * a check that has only ever been seen passing is indistinguishable from one
 * that cannot fail. This drives it over fixtures covering both directions and
 * asserts the exit codes.
 *
 * The dangerous case is the one that matters: enum contains DIALING while the
 * Hopper start is ungated. If that combination ever exits zero, this fails.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const GUARD = resolve(HERE, 'hopper-kill-switch-guard.mjs');

const ENUM_WITHOUT = `enum LeadStatus {
  NEW
  CONTACTED
  QUALIFIED
  CONVERTED
  LOST
  DO_NOT_CALL
}
`;

const ENUM_WITH = `enum LeadStatus {
  NEW
  DIALING
  CONTACTED
  QUALIFIED
  CONVERTED
  LOST
  DO_NOT_CALL
}
`;

const WORKER_UNGATED = `const dialerWorker = new DialerWorker();
async function main() {
  try {
    // Start Dialer Worker (The Hopper)
    await dialerWorker.start();
  } catch (e) {}
}
`;

const WORKER_GATED = `const dialerWorker = new DialerWorker();
async function main() {
  try {
    if (process.env.HOPPER_DIALER_ENABLED === 'true') {
      await dialerWorker.start();
    }
  } catch (e) {}
}
`;

const cases = [
  {
    name: 'no DIALING, ungated — the current tree, allowed',
    schema: ENUM_WITHOUT,
    worker: WORKER_UNGATED,
    migration: null,
    expectExit: 0,
  },
  {
    name: 'no DIALING, gated — gating first is always allowed',
    schema: ENUM_WITHOUT,
    worker: WORKER_GATED,
    migration: null,
    expectExit: 0,
  },
  {
    name: 'DIALING added while ungated — THE DANGEROUS CASE, must fail',
    schema: ENUM_WITH,
    worker: WORKER_UNGATED,
    migration: null,
    expectExit: 1,
  },
  {
    name: 'DIALING added after gating — the safe order, allowed',
    schema: ENUM_WITH,
    worker: WORKER_GATED,
    migration: null,
    expectExit: 0,
  },
  {
    name: 'migration adds the value while ungated — same hazard via SQL, must fail',
    schema: ENUM_WITHOUT,
    worker: WORKER_UNGATED,
    migration: `ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'DIALING';`,
    expectExit: 1,
  },
  {
    name: 'migration adds the value after gating — allowed',
    schema: ENUM_WITHOUT,
    worker: WORKER_GATED,
    migration: `ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'DIALING';`,
    expectExit: 0,
  },
];

let failures = 0;
const root = mkdtempSync(join(tmpdir(), 'hopper-guard-'));

for (const [i, c] of cases.entries()) {
  const dir = join(root, `case-${i}`);
  const migrations = join(dir, 'migrations', '20260101_x');
  mkdirSync(migrations, { recursive: true });
  writeFileSync(join(dir, 'schema.prisma'), c.schema);
  writeFileSync(join(dir, 'index.ts'), c.worker);
  if (c.migration) writeFileSync(join(migrations, 'migration.sql'), c.migration);

  const result = spawnSync(process.execPath, [GUARD], {
    env: {
      ...process.env,
      GUARD_SCHEMA_PATH: join(dir, 'schema.prisma'),
      GUARD_WORKER_ENTRY_PATH: join(dir, 'index.ts'),
      GUARD_MIGRATIONS_DIR: join(dir, 'migrations'),
    },
    encoding: 'utf8',
  });

  const actual = result.status;
  const ok = actual === c.expectExit;
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'}  ${c.name} (exit ${actual}, expected ${c.expectExit})\n`);
  if (!ok) {
    failures += 1;
    process.stdout.write(`${result.stdout}${result.stderr}\n`);
  }
}

rmSync(root, { recursive: true, force: true });

if (failures > 0) {
  process.stdout.write(`\n::error::HOPPER_KILL_SWITCH_GUARD self-test: ${failures} case(s) failed\n`);
  process.exit(1);
}

process.stdout.write(`\nHOPPER_KILL_SWITCH_GUARD self-test: all ${cases.length} cases behaved correctly\n`);
