#!/usr/bin/env node
/**
 * Self-test for HOPPER_KILL_SWITCH_GUARD.
 *
 * The guard passes against the current tree, which proves nothing on its own —
 * a check that has only ever been seen passing is indistinguishable from one
 * that cannot fail. This drives it over fixtures covering every way the gate
 * could be dismantled and asserts the exit codes.
 *
 * The dangerous cases are the ones that matter. If any of them ever exits zero,
 * this fails.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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

const ENUM_WITH = ENUM_WITHOUT.replace('  NEW\n', '  NEW\n  DIALING\n');

/** An entrypoint that delegates, as the real one does. */
const ENTRY_DELEGATES = `import { superviseLegacyHopper } from './services/hopper-supervisor.js';
const dialerWorker = new DialerWorker();
async function main() {
  const status = await superviseLegacyHopper(process.env, dialerWorker, logger);
}
`;

/** An entrypoint that starts the Hopper itself — the original defect. */
const ENTRY_DIRECT = `const dialerWorker = new DialerWorker();
async function main() {
  await dialerWorker.start();
}
`;

/** A supervisor that consults the gate. */
const SUPERVISOR_GATED = `import { permitsStartup, resolveHopperGate } from '../config/hopper-gate.js';
export async function superviseLegacyHopper(env, hopper, log) {
  const gate = resolveHopperGate(env);
  if (!permitsStartup(gate)) return { state: gate.state };
  await hopper.start({ scope: gate.scope, originationEnabled: gate.originationEnabled });
}
`;

/** A supervisor that starts unconditionally. */
const SUPERVISOR_UNGATED = `import { resolveHopperGate } from '../config/hopper-gate.js';
export async function superviseLegacyHopper(env, hopper, log) {
  const gate = resolveHopperGate(env);
  await hopper.start({ scope: gate.scope, originationEnabled: gate.originationEnabled });
}
`;

/** A gate with both required properties: strict enable, mandatory scope. */
const GATE_STRICT = `export function resolveHopperGate(env) {
  if (enabled !== true) return { state: 'disabled' };
  if (tenantIds.length === 0 && campaignIds.length === 0) return { state: 'refused_configuration' };
  return { state: 'enabled_scoped' };
}
`;

/** A gate whose default flipped to enabled. */
const GATE_DEFAULT_ENABLED = `export function resolveHopperGate(env) {
  const enabled = env.LEGACY_HOPPER_ENABLED !== 'false';
  if (tenantIds.length === 0 && campaignIds.length === 0) return { state: 'refused_configuration' };
  return { state: 'enabled_scoped' };
}
`;

/** A gate that no longer requires an allowlist — "enabled for everything". */
const GATE_NO_SCOPE = `export function resolveHopperGate(env) {
  if (enabled !== true) return { state: 'disabled' };
  return { state: 'enabled_scoped' };
}
`;

/** A second entrypoint that bypasses the supervisor entirely. */
const STRAY_ENTRYPOINT = `import { DialerWorker } from './dialer-worker.js';
const dialerWorker = new DialerWorker();
export async function alsoStartTheHopper() {
  await dialerWorker.start({ scope: { tenantIds: [], campaignIds: [] }, originationEnabled: true });
}
`;

/** A file that merely mentions the call in prose. Must NOT trip the guard. */
const DOC_ONLY = `/**
 * This module explains why \`dialerWorker.start()\` used to be unconditional.
 */
export const NOTE = 'see the diagnosis';
`;

const cases = [
  {
    name: 'the current architecture, no DIALING — allowed',
    enum: ENUM_WITHOUT, entry: ENTRY_DELEGATES, supervisor: SUPERVISOR_GATED, gate: GATE_STRICT,
    expectExit: 0,
  },
  {
    name: 'DIALING added on top of a correct gate — the safe order, allowed',
    enum: ENUM_WITH, entry: ENTRY_DELEGATES, supervisor: SUPERVISOR_GATED, gate: GATE_STRICT,
    expectExit: 0,
  },
  {
    name: 'entrypoint starts the Hopper directly — must fail',
    enum: ENUM_WITHOUT, entry: ENTRY_DIRECT, supervisor: SUPERVISOR_GATED, gate: GATE_STRICT,
    expectExit: 1,
  },
  {
    name: 'supervisor stops consulting the gate — must fail',
    enum: ENUM_WITHOUT, entry: ENTRY_DELEGATES, supervisor: SUPERVISOR_UNGATED, gate: GATE_STRICT,
    expectExit: 1,
  },
  {
    name: 'gate default flips to enabled — must fail',
    enum: ENUM_WITHOUT, entry: ENTRY_DELEGATES, supervisor: SUPERVISOR_GATED, gate: GATE_DEFAULT_ENABLED,
    expectExit: 1,
  },
  {
    name: 'allowlist requirement removed — must fail',
    enum: ENUM_WITHOUT, entry: ENTRY_DELEGATES, supervisor: SUPERVISOR_GATED, gate: GATE_NO_SCOPE,
    expectExit: 1,
  },
  {
    name: 'an alternate entrypoint appears — must fail',
    enum: ENUM_WITHOUT, entry: ENTRY_DELEGATES, supervisor: SUPERVISOR_GATED, gate: GATE_STRICT,
    stray: STRAY_ENTRYPOINT,
    expectExit: 1,
  },
  {
    name: 'the supervisor is deleted — must fail',
    enum: ENUM_WITHOUT, entry: ENTRY_DELEGATES, supervisor: null, gate: GATE_STRICT,
    expectExit: 1,
  },
  {
    name: 'DIALING added while the gate is dismantled — must fail',
    enum: ENUM_WITH, entry: ENTRY_DIRECT, supervisor: SUPERVISOR_UNGATED, gate: GATE_NO_SCOPE,
    expectExit: 1,
  },
  {
    name: 'a migration adds the value while the gate is dismantled — must fail',
    enum: ENUM_WITHOUT, entry: ENTRY_DELEGATES, supervisor: SUPERVISOR_GATED, gate: GATE_NO_SCOPE,
    migration: `ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'DIALING';`,
    expectExit: 1,
  },
  {
    name: 'a migration adds the value with the gate intact — allowed',
    enum: ENUM_WITHOUT, entry: ENTRY_DELEGATES, supervisor: SUPERVISOR_GATED, gate: GATE_STRICT,
    migration: `ALTER TYPE "LeadStatus" ADD VALUE IF NOT EXISTS 'DIALING';`,
    expectExit: 0,
  },
  {
    name: 'prose mentioning the call does not trip the stray check — allowed',
    enum: ENUM_WITHOUT, entry: ENTRY_DELEGATES, supervisor: SUPERVISOR_GATED, gate: GATE_STRICT,
    stray: DOC_ONLY,
    expectExit: 0,
  },
];

let failures = 0;
const root = mkdtempSync(join(tmpdir(), 'hopper-guard-'));

for (const [i, c] of cases.entries()) {
  const dir = join(root, `case-${i}`);
  const src = join(dir, 'src');
  const services = join(src, 'services');
  const migrations = join(dir, 'migrations', '20260101_x');
  mkdirSync(services, { recursive: true });
  mkdirSync(migrations, { recursive: true });

  writeFileSync(join(dir, 'schema.prisma'), c.enum);
  writeFileSync(join(src, 'index.ts'), c.entry);
  writeFileSync(join(dir, 'gate.ts'), c.gate);
  const supervisorPath = join(services, 'hopper-supervisor.ts');
  if (c.supervisor !== null) writeFileSync(supervisorPath, c.supervisor);
  if (c.stray) writeFileSync(join(services, 'stray.ts'), c.stray);
  if (c.migration) writeFileSync(join(migrations, 'migration.sql'), c.migration);

  const result = spawnSync(process.execPath, [GUARD], {
    env: {
      ...process.env,
      GUARD_SCHEMA_PATH: join(dir, 'schema.prisma'),
      GUARD_WORKER_ENTRY_PATH: join(src, 'index.ts'),
      GUARD_MIGRATIONS_DIR: join(dir, 'migrations'),
      GUARD_GATE_PATH: join(dir, 'gate.ts'),
      GUARD_SUPERVISOR_PATH: supervisorPath,
      GUARD_WORKER_SRC: src,
    },
    encoding: 'utf8',
  });

  const actual = result.status;
  const ok = actual === c.expectExit;
  process.stdout.write(
    `${ok ? 'ok  ' : 'FAIL'}  ${c.name} (exit ${actual}, expected ${c.expectExit})\n`
  );
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

process.stdout.write(
  `\nHOPPER_KILL_SWITCH_GUARD self-test: all ${cases.length} cases behaved correctly\n`
);
