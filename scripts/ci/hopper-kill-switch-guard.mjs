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

const problems = [];
const note = m => process.stdout.write(`  ${m}\n`);

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
  // Matched structurally rather than by exact text, so the gate can be written
  // with any reasonable condition. What must be true is that the start call is
  // not a bare statement at the top level of the try block.
  const startCall = /await\s+dialerWorker\s*\.\s*start\s*\(/;
  const hasStart = startCall.test(worker);

  // A gate is any `if (...)` whose body reaches the start call, or an early
  // return/skip guarding it. Look for a conditional within the preceding lines.
  const lines = worker.split('\n');
  const startLine = lines.findIndex(l => startCall.test(l));
  const preceding = startLine === -1 ? [] : lines.slice(Math.max(0, startLine - 6), startLine);
  const gated =
    startLine !== -1 &&
    (/\bif\s*\(/.test(preceding.join('\n')) ||
      // or the call itself is short-circuited
      /&&\s*await\s+dialerWorker/.test(lines[startLine] ?? ''));

  note(`dialerWorker.start() present: ${hasStart}`);
  note(`dialerWorker.start() gated: ${gated}`);

  if (!hasStart) {
    note('dialerWorker.start() is absent entirely — nothing to gate.');
  } else if (enumHasDialing && !gated) {
    problems.push(
      'LeadStatus now contains DIALING while dialerWorker.start() is still ungated. ' +
        'Adding that enum member repairs the Hopper, and the Hopper starts unconditionally, ' +
        'so outbound dialing would begin on the next poll (~1s) with no feature flag, no tenant ' +
        'allowlist and no kill switch. Gate the Hopper FIRST — see ' +
        'docs/dialer-v2/F1_LEAD_STATUS_DIAGNOSIS.md.'
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
