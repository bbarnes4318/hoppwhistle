import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * The settlement command's two safe modes must not be confusable.
 *
 * ── What went wrong before this existed ──────────────────────────────────────
 *
 * They were `--dry-run` and `--no-charge`. Two flags a character apart, where
 * one writes NOTHING and the other writes EVERYTHING except the debit. On a
 * command that debits real bank accounts, at eleven at night, that is a typo
 * with a bank statement at the end of it. They are now `--plan-only` and
 * `--settle-without-charge`, which share no prefix and say what they do.
 *
 * ── Why the old spellings are refused rather than ignored ────────────────────
 *
 * `process.argv.includes('--no-charge')` on a command that no longer knows that
 * flag is silently false, and the run proceeds -- charging every enrolled
 * agency. An operator with the old name in their fingers, or a cron with it in
 * a crontab, would place real debits believing they had suppressed them. That
 * is the worst of the three possible outcomes, so an old spelling exits
 * non-zero having done nothing at all.
 *
 * This spawns the real command rather than reading its source, because the
 * property is about what the process does with an argument, and a test that
 * grepped for a string would pass on a version that printed the warning and
 * then carried on.
 *
 * `--tenant` names an id no agency has, so the runs that do reach the settlement
 * path settle nobody: this suite is about argument handling, and it should not
 * be able to write a settlement row whatever else is in the database.
 */

const CLI = join(__dirname, '..', 'cli', 'run-daily-settlement.ts');
const TSX = join(__dirname, '..', '..', '..', '..', 'node_modules', '.bin', 'tsx');

/** An id no tenant has, so a run that gets as far as settling settles nobody. */
const NO_SUCH_TENANT = '00000000-0000-4000-8000-00000000dead';

const gate = databaseGate();
announceSkip("the settlement command's flags", gate);

function run(args: string[]) {
  return spawnSync(TSX, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env },
    timeout: 120_000,
  });
}

describe('the settlement command wiring', () => {
  it('can find tsx and the command it is meant to run', () => {
    expect(existsSync(CLI), CLI).toBe(true);
    expect(existsSync(TSX), TSX).toBe(true);
  });
});

describe.skipIf(!gate.available)("the settlement command's flags", () => {
  it('refuses --dry-run and says what replaced it, having run nothing', () => {
    const result = run(['--dry-run']);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--dry-run no longer exists');
    expect(result.stderr).toContain('--plan-only');
    expect(result.stderr).toContain('Nothing has been run');

    // It stopped before doing any work: not even the run's opening banner.
    expect(result.stdout).not.toContain('Delivery Day settled');
  });

  it('refuses --no-charge, which would otherwise have charged everybody', () => {
    const result = run(['--no-charge']);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('--no-charge no longer exists');
    expect(result.stderr).toContain('--settle-without-charge');
    expect(result.stdout).not.toContain('Delivery Day settled');
  });

  it('refuses an old spelling even when a new one is given beside it', () => {
    // Somebody half-way through updating a cron line. Guessing which they
    // meant is worse than stopping.
    const result = run(['--dry-run', '--settle-without-charge']);

    expect(result.status).toBe(2);
    expect(result.stdout).not.toContain('Delivery Day settled');
  });

  it('accepts --plan-only and says it is writing nothing', () => {
    const result = run(['--plan-only', '--day', '2026-09-07', '--tenant', NO_SUCH_TENANT]);

    expect(result.status ?? 0).toBe(0);
    expect(result.stdout).toContain('PLAN ONLY');
    expect(result.stdout).toContain('nothing is written and nobody is charged');
  });

  it('announces --settle-without-charge before it settles anything', () => {
    const result = run([
      '--settle-without-charge',
      '--day',
      '2026-09-07',
      '--tenant',
      NO_SUCH_TENANT,
    ]);

    expect(result.stdout).toContain('no debit will be placed');
    expect(result.stdout).toContain('Delivery Day settled');
  });
});
