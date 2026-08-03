#!/usr/bin/env node
/**
 * HOPPER_KILL_SWITCH_GUARD
 *
 * ── What this protects ───────────────────────────────────────────────────────
 *
 * `apps/worker/src/index.ts` starts the production Hopper unconditionally:
 *
 *     await dialerWorker.start();
 *
 * There is no env kill switch, no feature flag, and no tenant allowlist in front
 * of it. The Hopper polls every second, selects up to 50 leads per cycle, and
 * originates real calls through FreeSWITCH.
 *
 * The only reason it places no calls is audit finding F-1: it writes
 * `'DIALING'::"LeadStatus"` and the enum has no such member, so PostgreSQL
 * raises `invalid_text_representation` on the first lead of every batch and
 * `originateCall()` is never reached.
 *
 * That is an accident being used as a safety control. Adding `DIALING` to the
 * enum — the change that "makes TypeScript compile" — removes it, and outbound
 * dialing begins on the next poll, roughly one second later.
 *
 * ── What this asserts ────────────────────────────────────────────────────────
 *
 * The two facts must move together, in the safe order:
 *
 *   enum contains DIALING  ⟹  dialerWorker.start() is gated
 *
 * Gating first is always allowed. Adding the enum member first is not. The guard
 * is deliberately one-directional: it never requires the enum member, only that
 * the gate exists before it does.
 *
 * See docs/dialer-v2/F1_LEAD_STATUS_DIAGNOSIS.md.
 */

import { readFileSync, existsSync } from 'node:fs';

// Overridable so the guard can be pointed at fixtures and PROVEN to fail in the
// dangerous case. A guard that has only ever been observed passing is not a
// guard — it is an assertion nobody has tested.
const SCHEMA = process.env.GUARD_SCHEMA_PATH ?? 'apps/api/prisma/schema.prisma';
const WORKER_ENTRY = process.env.GUARD_WORKER_ENTRY_PATH ?? 'apps/worker/src/index.ts';
const MIGRATIONS_DIR = process.env.GUARD_MIGRATIONS_DIR ?? 'apps/api/prisma/migrations';
/** Where the gate itself lives. Its defaults are part of the contract. */
const GATE = process.env.GUARD_GATE_PATH ?? 'apps/worker/src/config/hopper-gate.ts';
/** The only permitted call site of `start(` on the Hopper. */
const SUPERVISOR = process.env.GUARD_SUPERVISOR_PATH ?? 'apps/worker/src/services/hopper-supervisor.ts';
/** Searched for stray start call sites. */
const WORKER_SRC = process.env.GUARD_WORKER_SRC ?? 'apps/worker/src';

const problems = [];
const note = m => process.stdout.write(`  ${m}\n`);

/** Remove block and line comments so prose about the guard cannot trip it. */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function read(path) {
  if (!existsSync(path)) {
    problems.push(`${path} does not exist — the guard cannot evaluate its own precondition`);
    return null;
  }
  return readFileSync(path, 'utf8');
}

const schema = read(SCHEMA);
const worker = read(WORKER_ENTRY);

if (schema !== null && worker !== null) {
  // ── Does the authoritative enum contain DIALING? ─────────────────────────
  const enumMatch = schema.match(/enum\s+LeadStatus\s*\{([^}]*)\}/);
  if (!enumMatch) {
    problems.push(`could not locate "enum LeadStatus" in ${SCHEMA}`);
  }

  const members = enumMatch
    ? enumMatch[1]
        .split('\n')
        .map(l => l.replace(/\/\/.*$/, '').trim())
        .filter(Boolean)
    : [];

  const enumHasDialing = members.includes('DIALING');
  note(`LeadStatus members: ${members.join(', ') || '(none parsed)'}`);
  note(`enum contains DIALING: ${enumHasDialing}`);

  // ── Is the Hopper start gated? ───────────────────────────────────────────
  //
  // The gate is an architecture, not a conditional: the supervisor is the only
  // permitted call site, and it consults `permitsStartup` before starting. So
  // four things are checked, and all four must hold.
  const startCall = /\.\s*start\s*\(/;
  const directStartInEntry = /\bdialerWorker\s*\.\s*start\s*\(/.test(worker);

  const gateSource = existsSync(GATE) ? readFileSync(GATE, 'utf8') : null;
  const supervisorSource = existsSync(SUPERVISOR) ? readFileSync(SUPERVISOR, 'utf8') : null;

  // (1) The entrypoint must delegate rather than start the Hopper itself.
  if (directStartInEntry) {
    problems.push(
      `${WORKER_ENTRY} calls dialerWorker.start() directly. The Hopper must be started only ` +
        `through ${SUPERVISOR}, which consults the gate. A direct call is how it came to run ` +
        'unconditionally for the lifetime of this repository.'
    );
  }

  // (2) The supervisor must exist and must consult the gate before starting.
  let supervisorGated = false;
  if (supervisorSource === null) {
    problems.push(`${SUPERVISOR} is missing — there is no gated path to start the Hopper`);
  } else {
    const consultsGate = /permitsStartup\s*\(/.test(supervisorSource);
    const startsSomething = startCall.test(supervisorSource);
    supervisorGated = consultsGate && startsSomething;
    if (!consultsGate) {
      problems.push(
        `${SUPERVISOR} does not consult permitsStartup(); the Hopper would start regardless of configuration`
      );
    }
  }

  // (3) The gate must still require an explicit enable and a non-empty scope.
  let gateRequiresScope = false;
  if (gateSource === null) {
    problems.push(`${GATE} is missing — the gate contract cannot be verified`);
  } else {
    // The default must be disabled: enabling requires the value to be exactly
    // "true", and anything else must not reach ENABLED_SCOPED.
    const enableIsStrict = /enabled\s*!==\s*true/.test(gateSource);
    // An empty allowlist must refuse. "Enabled for everything" is precisely the
    // old behaviour and must remain unreachable.
    gateRequiresScope =
      /tenantIds\.length\s*===\s*0\s*&&\s*campaignIds\.length\s*===\s*0/.test(gateSource);

    if (!enableIsStrict) {
      problems.push(
        `${GATE} no longer refuses everything except an exact "true" enable value; the default may have flipped to enabled`
      );
    }
    if (!gateRequiresScope) {
      problems.push(
        `${GATE} no longer requires a non-empty tenant or campaign allowlist. "Enabled for everything" ` +
          'is the old ungated behaviour and must stay unreachable.'
      );
    }
  }

  // (4) No other file in the worker may start the Hopper.
  if (existsSync(WORKER_SRC)) {
    const { readdirSync, statSync } = await import('node:fs');
    const { join, resolve } = await import('node:path');
    const supervisorPath = resolve(SUPERVISOR);
    const strays = [];
    const walk = dir => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry !== 'node_modules') walk(full);
          continue;
        }
        if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) continue;
        if (resolve(full) === supervisorPath) continue;
        // Comments are stripped first. These files legitimately DISCUSS
        // `dialerWorker.start()` when explaining why the gate exists, and a
        // guard that fires on its own documentation trains people to ignore it.
        const body = stripComments(readFileSync(full, 'utf8'));
        // Only the Hopper. Other workers start themselves and always have.
        if (/\bdialerWorker\s*\.\s*start\s*\(|\bnew\s+DialerWorker\s*\([^)]*\)\s*\.\s*start\s*\(/.test(body)) {
          strays.push(full);
        }
      }
    };
    walk(WORKER_SRC);
    if (strays.length > 0) {
      problems.push(
        `these files start the Hopper outside the supervisor: ${strays.join(', ')}. ` +
          'An alternate entrypoint bypasses the gate entirely.'
      );
    }
  }

  const gated = !directStartInEntry && supervisorGated && gateRequiresScope;
  note(`entrypoint delegates to the supervisor: ${!directStartInEntry}`);
  note(`supervisor consults the gate: ${supervisorGated}`);
  note(`gate requires a scope: ${gateRequiresScope}`);
  note(`Hopper start is gated: ${gated}`);

  if (enumHasDialing && !gated) {
    problems.push(
      'LeadStatus now contains DIALING while the Hopper start is not gated. ' +
        'Adding that enum member repairs the Hopper, so outbound dialing would begin on the ' +
        'next poll (~1s) with no feature flag, no tenant allowlist and no kill switch. ' +
        'Gate the Hopper FIRST — see docs/dialer-v2/F1_LEAD_STATUS_DIAGNOSIS.md.'
    );
  }

  // ── The migration route is guarded the same way ──────────────────────────
  //
  // A migration can add the value without schema.prisma changing, which would
  // otherwise slip past the check above.
  const migrationGlobs = MIGRATIONS_DIR;
  if (existsSync(migrationGlobs)) {
    const { readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const offenders = [];
    const walk = dir => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith('.sql')) {
          const sql = readFileSync(full, 'utf8');
          if (/ALTER\s+TYPE\s+"?LeadStatus"?\s+ADD\s+VALUE/i.test(sql)) offenders.push(full);
        }
      }
    };
    walk(migrationGlobs);

    if (offenders.length > 0) {
      note(`migrations adding a LeadStatus value: ${offenders.join(', ')}`);
      if (!gated) {
        problems.push(
          `a migration adds a LeadStatus value (${offenders.join(', ')}) while ` +
            'dialerWorker.start() is still ungated. Same hazard as above, reached by SQL ' +
            'instead of by the Prisma enum.'
        );
      }
    }
  }
}

if (problems.length > 0) {
  process.stdout.write('\nHOPPER_KILL_SWITCH_GUARD failed:\n');
  for (const p of problems) process.stdout.write(`::error::${p}\n`);
  process.exit(1);
}

process.stdout.write('\nHOPPER_KILL_SWITCH_GUARD: the enum and the kill switch are consistent\n');
