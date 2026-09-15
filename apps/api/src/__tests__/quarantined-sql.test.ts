import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The bulk role SQL stays unreachable, and the report stays read-only.
 *
 * `scripts/quarantine/seed-admin-roles.sql` grants ADMIN to every row in
 * `users` — every account, across every agency — and re-granting it to every
 * account created since, each time it is run. Its sibling deletes an ADMIN
 * grant and assigns nothing in its place, leaving the account with no role at
 * all. Between them they produce the incident in
 * docs/AGENT_AUTHORIZATION_AUDIT.md end to end.
 *
 * They are kept as evidence: `authz-report.sh` identifies the rows they write
 * by the literal ids they use, and you cannot recognise those rows without
 * having read the file that writes them. What must never happen again is one of
 * them being run — so this fails if anything executable in the repository names
 * them, which is the step before somebody runs one by mistake.
 *
 * The second half guards the replacement. `authz-report.sh` is meant to be run
 * against production, and its whole claim is that it cannot change anything. A
 * report that grew a write would be a bulk role migration with no mapping and
 * no dry run, wearing the name of the tool that exists to prevent one.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const SCRIPTS = join(REPO_ROOT, 'scripts');

const QUARANTINED = ['seed-admin-roles.sql', 'demote-user.sql'];

/** Everything that could plausibly execute something, by extension. */
const EXECUTABLE_EXTENSIONS = ['.sh', '.bash', '.mjs', '.js', '.cjs', '.ts', '.yml', '.yaml'];

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'quarantine']);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue; // a broken symlink is not a caller
    }
    if (stat.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

describe('the bulk role SQL is quarantined', () => {
  it('lives only under scripts/quarantine', () => {
    for (const name of QUARANTINED) {
      const quarantined = join(SCRIPTS, 'quarantine', name);
      expect(() => statSync(quarantined), `${name} should be in quarantine`).not.toThrow();
      expect(
        () => statSync(join(SCRIPTS, name)),
        `${name} must not also sit in scripts/, where it is one tab-complete from being run`
      ).toThrow();
    }
  });

  it('is named by nothing that can execute it', () => {
    const candidates = walk(REPO_ROOT)
      .filter(f => EXECUTABLE_EXTENSIONS.some(ext => f.endsWith(ext)))
      // This file has to name them: they are the subject. It is the one
      // exemption, and it is exactly one file rather than a pattern, so a
      // second file cannot quietly join it.
      .filter(f => f !== __filename);
    // Guards the test itself: a walk that found nothing would pass vacuously.
    expect(candidates.length).toBeGreaterThan(100);

    const offenders: string[] = [];
    for (const file of candidates) {
      let source: string;
      try {
        source = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      /*
       * Comments are stripped first, and then ANY remaining mention counts.
       *
       * Explaining these files is the reason for keeping them, so prose names
       * them freely — this test file does, twice. What no executable line may
       * do is name one, whether it pipes it into psql, assigns it to a
       * variable, or merely echoes the path somewhere a person can copy it
       * from. Matching on `psql … <file>` instead would pass a script that
       * builds the path a line earlier, which is the shape this is for.
       */
      const executable = source
        .split('\n')
        .filter(line => {
          const t = line.trimStart();
          return t !== '' && !t.startsWith('#') && !t.startsWith('//') && !t.startsWith('*');
        })
        .join('\n');

      for (const name of QUARANTINED) {
        if (executable.includes(name)) {
          offenders.push(`${relative(REPO_ROOT, file)} names ${name} outside a comment`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('authz-report.sh cannot change anything', () => {
  const report = readFileSync(join(SCRIPTS, 'authz-report.sh'), 'utf8');

  /**
   * Every SQL string the script hands to psql.
   *
   * Extracted rather than keyword-blacklisted. Blacklisting matched the word
   * "grant" in the sentence explaining what a late grant means, which is the
   * usual fate of a blacklist run over a file that also contains prose. What
   * actually matters is narrower and checkable: the script sends SELECTs and
   * nothing else.
   *
   * The three call sites are `q <id> "<sql>"`, `num "<sql>"` and `n "<sql>"`.
   */
  function sqlStatements(): string[] {
    const out: string[] = [];
    const call = /(?:\bq [a-z-]+|\bnum|\bn) "((?:[^"\\]|\\.)*)"/gs;
    for (const match of report.matchAll(call)) {
      const sql = match[1].replace(/\\"/g, '"').trim();
      if (/\b(select|insert|update|delete|create|drop|alter|grant|truncate)\b/i.test(sql)) {
        out.push(sql);
      }
    }
    return out;
  }

  it('sends SQL this test can actually see', () => {
    // Guards the extraction: a regex that matched nothing would make every
    // assertion below vacuously true, which is the failure mode of a test that
    // reads source instead of running it.
    expect(sqlStatements().length).toBeGreaterThan(10);
  });

  it('sends nothing but SELECT', () => {
    const offenders = sqlStatements()
      .filter(sql => !/^select\b/i.test(sql))
      .map(sql => sql.slice(0, 80));
    expect(offenders).toEqual([]);
  });

  it('creates no table, not even a temporary one', () => {
    // The expected-name lists travel into the queries as VALUES/unnest instead,
    // so the script completes against a read-only database — which is how it is
    // verified to write nothing, rather than by reading it.
    const offenders = sqlStatements().filter(sql => /\bcreate\b|\btemp(orary)?\b/i.test(sql));
    expect(offenders).toEqual([]);
  });
});
